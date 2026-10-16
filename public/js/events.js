// ===== V3 EXT4: сложность, союзы, маркеры событий, потеря узлов =====
let difficulty = 1, mapMarks = [], captures = {}, lastMarkAt = {};
const DIFFS = [['Лёгкая', 0.6], ['Нормальная', 1], ['Жёсткая', 1.35]];
// --- маркеры
function mark(x, y, ic, text, kind = 'info', ttl = 15) {
  mapMarks.push({ x, y, ic, text, kind, born: currentTurn, ttl, t: simDate.toLocaleDateString('ru-RU') });
  if (mapMarks.length > 70) mapMarks.shift();
}
const MC = { good: '#22c55e', bad: '#ef4444', warn: '#f59e0b', war: '#dc2626', info: '#38bdf8' };
function drawMarks() {
  if (!mapMarks.length) return; let pulse = (Math.sin(performance.now() / 300) + 1) / 2, fs = 15 / scale;
  ctx.font = `${fs}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  mapMarks.forEach(m => {
    let age = currentTurn - m.born; if (age > m.ttl) return; let a = age > m.ttl - 3 ? (m.ttl - age) / 3 : 1;
    ctx.globalAlpha = a * 0.55; ctx.fillStyle = MC[m.kind] || '#fff'; ctx.beginPath(); ctx.arc(m.x, m.y, fs * (0.75 + pulse * 0.35), 0, 7); ctx.fill();
    ctx.globalAlpha = a; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.2 / scale; ctx.beginPath(); ctx.arc(m.x, m.y, fs * 0.75, 0, 7); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.fillText(m.ic, m.x, m.y + fs * 0.05);
  });
  ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic';
}
function markAt(sx, sy) {
  let w = screenToWorld(sx, sy), best = null, bd = 14 / scale;
  mapMarks.forEach(m => { if (currentTurn - m.born > m.ttl) return; let d = Math.hypot(m.x - w.x, m.y - w.y); if (d < bd) { bd = d; best = m; } }); return best;
}
canvas.addEventListener('mousemove', e => {
  let r = canvas.getBoundingClientRect(), m = markAt(e.clientX - r.left, e.clientY - r.top), t = $('mapTip'); if (!t) return;
  if (m) { t.style.display = 'block'; t.style.left = (e.clientX + 12) + 'px'; t.style.top = (e.clientY + 12) + 'px'; t.innerHTML = `${m.ic} <b>${m.text}</b><br><small>${m.t}</small>`; } else t.style.display = 'none';
});
A.goto = function (x, y) { A.hubClose(); scale = Math.max(scale, 6); panX = width / 2 - x * scale; panY = height / 2 - y * scale; draw(); };
// --- захваты секторов -> маркеры
function noteCapture(att, def, x, y) {
  if (att !== LOCAL && def !== LOCAL) return; let k = att + def + Math.floor(x / 30) + ',' + Math.floor(y / 30);
  let b = captures[k] || (captures[k] = { att, def, sx: 0, sy: 0, n: 0 }); b.n++; b.sx += x; b.sy += y;
}
function flushCaptures() {
  Object.keys(captures).forEach(k => { let b = captures[k]; if (b.n >= 3 && (currentTurn - (lastMarkAt[k] || -99)) >= 5) {
    lastMarkAt[k] = currentTurn; let x = b.sx / b.n, y = b.sy / b.n;
    if (b.att === LOCAL) { mark(x, y, '✔', `Наступление: заняли ${b.n} секторов у ${countryMap[b.def].name}`, 'good', 8); toast(`✔ Успех на фронте (${b.n} секторов)`, 'good'); }
    else { mark(x, y, '✖', `Потеряно ${b.n} секторов: прорыв ${countryMap[b.att].name}`, 'bad', 8); toast(`✖ Прорыв противника: потеряно ${b.n} секторов`, 'bad'); } } });
  captures = {};
}
// --- потеря военных зданий
function buildingsLostCheck() {
  let c = me(); if (!c) return; let n = c.numericId;
  buildings = buildings.filter(b => { if (b.ownerId !== c.id) return true; if (territoryOwner[Math.round(b.y) * OFF_W + Math.round(b.x)] === n) return true;
    c._bldLost = (c._bldLost || 0) + 1; mark(b.x, b.y, '🏚', `Потеряно: ${BT[b.type] ? BT[b.type].n : b.type} (захвачено противником)`, 'bad', 40); toast(`🏚 Потеряно здание: ${BT[b.type] ? BT[b.type].n : b.type}`, 'bad'); addNewsEvent(`Противник захватил ${BT[b.type] ? BT[b.type].n : b.type}`, 'war'); return false; });
  if (activeWars.some(w => w.a === c.id || w.b === c.id) && !validHubs(c.id).length && currentTurn % 10 === 0) toast('⚠ У вас нет ни одного военного узла: подкрепления не идут!', 'warn');
}
// --- союзы
function initAlliances() { countries.forEach(c => c.allies = new Set()); countries.forEach(c => { [...c.neighbors].forEach(n => { if (c.id < n && RNG() < 0.22 && c.allies.size < 2) { let o = countryMap[n]; if (o.allies.size < 2) { c.allies.add(n); o.allies.add(c.id); } } }); }); }
function alliesOf(id) {
  let c = countryMap[id], s = new Set(c.allies || []);
  countries.forEach(o => {
    if (o.id === id || !(isHuman(id) || isHuman(o.id))) return;
    let r = diplomaticRelations[id] && diplomaticRelations[id][o.id], r2 = diplomaticRelations[o.id] && diplomaticRelations[o.id][id];
    if (r && r2 && r.status === 'allied' && r2.status === 'allied') s.add(o.id);
  });
  return s;
}
function activePact(a, b) { return treaties.some(t => t.status === 'active' && (t.type === 'non_aggression' || t.type === 'alliance') && t.parties.includes(a) && t.parties.includes(b)); }
function breakPacts(a, b) {
  let n = 0; treaties.forEach(t => { if (t.status === 'active' && (t.type === 'non_aggression' || t.type === 'alliance') && t.parties.includes(a) && t.parties.includes(b)) { t.status = 'broken'; n++; } });
  if (n) { let c = countryMap[a]; if (c) { c.influence = Math.max(0, c.influence - 10); if (c.gov) c.gov.approval -= 3; } addNewsEvent(`${countryMap[a].name} нарушает договор с ${countryMap[b].name}`, 'diplomacy'); }
}
function joinWar(o, enemy) {
  if (atWarWith(o, enemy) || (truces[o + enemy] || 0) > currentTurn || activeWars.length >= 9) return false;
  [[o, enemy], [enemy, o]].forEach(([x, y]) => { if (diplomaticRelations[x] && diplomaticRelations[x][y]) diplomaticRelations[x][y].status = 'at_war'; });
  startWar(o, enemy); mapDirty = true; addNewsEvent(`${countryMap[o].name} вступает в войну против ${countryMap[enemy].name}!`, 'war');
  if (o === LOCAL || enemy === LOCAL) toast(`⚔ ${countryMap[o].name} вступает в войну против ${countryMap[enemy].name}`, 'war'); return true;
}
function callAllies(att, def) {
  [[def, att, 0.6], [att, def, 0.4]].forEach(([side, foe, p]) => {
    alliesOf(side).forEach(o => { if (o === foe || o === side) return;
      if (isHuman(o)) { if (atWarWith(o, foe)) return; runAs(o, () => mkDoc(`Союзник ${countryMap[side].name} просит помощи`, `${countryMap[side].name} воюет против ${countryMap[foe].name}. По союзному договору просят вступить в войну.`, 'МИД', [['Вступить в войну', () => { joinWar(o, foe); hubRender(); }], ['Отказать (доверие и влияние падают)', () => { me().influence = Math.max(0, me().influence - 5); if (diplomaticRelations[o][side]) diplomaticRelations[o][side].trust -= 25; }]], 6, 1)); return; }
      if (RNG() < p * (side === def ? 1 : 0.8)) joinWar(o, foe); });
  });
}
window.declareWar = function (id) {
  const a = playerCountryId, t = countryMap[id], A_ = countryMap[a]; if (!a || !t || !A_ || id === a || atWarWith(a, id)) return;
  [[a, id], [id, a]].forEach(([x, y]) => { if (diplomaticRelations[x] && diplomaticRelations[x][y]) diplomaticRelations[x][y].status = 'at_war'; });
  breakPacts(a, id); let n0 = activeWars.length; startWar(a, id); mapDirty = true; if (activeWars.length === n0) return;
  addNewsEvent(`${A_.name} объявляет войну ${t.name}!`, 'war');
  let cp = capitalOf(t);
  if (a === LOCAL) { if (cp) mark(cp.x, cp.y, '⚔', `Вы объявили войну ${t.name}`, 'war', 20); }
  else if (id === LOCAL) { toast(`⚔ ${A_.name} объявила вам войну!`, 'war'); if (cp) mark(cp.x, cp.y, '⚔', `${A_.name} объявила вам войну`, 'war', 20); }
  callAllies(a, id);
  if (isHuman(id)) runAs(id, () => mkDoc(`Нота о начале войны от ${A_.name}`, 'Враг пересёк границу. Генеральный штаб ждёт ваших приказов.', 'Генеральный штаб', [['К исполнению: мобилизация (стабильность -3, люди +10%)', () => { t.economy.manpower = Math.min(t.economy.manpowerCap, t.economy.manpower + t.economy.manpowerCap * .1); t.gov.stability -= 3; }], ['Принять к сведению', () => { }]], 6, 1));
};
const _startWar = startWar; window.startWar = function (a, b) { [a, b].forEach(x => { let cc = countryMap[x]; if (cc && !activeWarsOf(x)) cc._home0 = capitalOf(cc); if (cc && isHuman(x)) cc._bldLost = 0; }); _startWar(a, b); let w = activeWars[activeWars.length - 1]; if (w && !w.t0) w.t0 = currentTurn; };
// --- ежедневное
function botWarDaily() {
  countries.forEach(c => { if (isHuman(c.id) || !activeWarsOf(c.id)) return;
    c.factoryCivRatio = 0.1;
    if (c.economy.budget > 3 && c.army.divisions.length < 18 && currentTurn % (difficulty > 1.2 ? 3 : 4) === 0) { c.army.divisions.push({ id: c.army.divisions.length + 1, name: `${c.name} ${c.army.divisions.length + 1}-я дивизия`, strength: 100, max: 100, status: 'active', daysLeft: 0 }); c.economy.budget -= 3; }
  });
  activeWars.slice().forEach(w => { let pw = isHuman(w.a) || isHuman(w.b); if (!pw && currentTurn - (w.t0 || currentTurn) > 45 && RNG() < 0.03) { activeWars = activeWars.filter(x => x !== w); endBotWar(w); addNewsEvent(`${countryMap[w.a].name} и ${countryMap[w.b].name} заключили перемирие`, 'war'); } });
}
function diffuseTroops() {
  if (currentTurn % 3) return;
  activeWars.forEach(war => {
    let ca = countryMap[war.a], cb = countryMap[war.b]; if (!ca || !cb) return; const T = territoryOwner, { minX, minY, maxX, maxY } = war.bbox, W = maxX - minX + 1, H = maxY - minY + 1, aN = ca.numericId, bN = cb.numericId, d = new Float32Array(W * H);
    for (let y = Math.max(1, minY); y <= Math.min(OFF_H - 2, maxY); y++) for (let x = Math.max(1, minX); x <= Math.min(OFF_W - 2, maxX); x++) {
      let i = y * OFF_W + x, o = T[i]; if (o !== aN && o !== bN) continue; let t = warTroops[i]; if (t < 5) continue;
      let rate = Math.min(0.7, (((isHuman(war.a) && o === aN) || (isHuman(war.b) && o === bN)) ? 0.25 : 0.15 * difficulty) * 2.5), bt = t, bi = -1, nb;
      nb = i - 1; if (T[nb] === o && warTroops[nb] < bt) { bt = warTroops[nb]; bi = nb; } nb = i + 1; if (T[nb] === o && warTroops[nb] < bt) { bt = warTroops[nb]; bi = nb; }
      nb = i - OFF_W; if (T[nb] === o && warTroops[nb] < bt) { bt = warTroops[nb]; bi = nb; } nb = i + OFF_W; if (T[nb] === o && warTroops[nb] < bt) { bt = warTroops[nb]; bi = nb; }
      if (bi < 0 || t - bt < 2) continue; let mv = (t - bt) * rate; d[(y - minY) * W + (x - minX)] -= mv; let by = (bi / OFF_W) | 0, bx = bi % OFF_W; d[(by - minY) * W + (bx - minX)] += mv;
    }
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) { let v = d[(y - minY) * W + (x - minX)]; if (v) warTroops[y * OFF_W + x] = Math.max(0, warTroops[y * OFF_W + x] + v); }
  });
}
const _annex = annexCountry; window.annexCountry = function (s, t) { _annex(s, t); countries.forEach(c => { if (c.neighbors) c.neighbors.delete(s); if (c.allies) c.allies.delete(s); }); activeWars = activeWars.filter(w => w.a !== s && w.b !== s); mapDirty = true; computeAdjacency(); };
function dailyExt2() {
  capitulationCheck(); diffuseTroops(); flushCaptures(); botWarDaily(); if (currentTurn % 10 === 0) { computeAdjacency(); }
  mapMarks = mapMarks.filter(m => currentTurn - m.born <= m.ttl);
}
