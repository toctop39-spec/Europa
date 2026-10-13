// ===== V3 EXT6: давление войны, капитуляция, мирные договоры, пересмотр границ =====
function capLost(c) { return !!(c && c._home0 && territoryOwner[c._home0.y * OFF_W + c._home0.x] !== c.numericId); }
function warPressure(w, cid) {
  let c = countryMap[cid], parts = [], p = 0, cells = w.stats[cid] || 0; w.s0 = w.s0 || {}; if (!w.s0[cid]) w.s0[cid] = Math.max(cells, 1);
  let loss = Math.max(0, 1 - cells / w.s0[cid]); if (loss > 0.005) { p += loss * 110; parts.push(`потеряно ${Math.round(loss * 100)}% территории`); }
  if (capLost(c)) { p += 35; parts.push('столица захвачена'); }
  let avg = (w.tavg || {})[cid]; if (avg !== undefined && avg < 4) { p += 25 * (1 - avg / 4); parts.push('армия разгромлена'); }
  let wy = isHuman(cid) ? (c.gov.weary || 0) * 0.3 : Math.min(40, (currentTurn - (w.t0 || currentTurn)) * 0.25); if (wy > 3) { p += wy; parts.push('усталость от войны'); }
  if (isHuman(cid) && c._bldLost) { p += c._bldLost * 8; parts.push('потеряны ключевые здания'); }
  let e = c.economy; if (e.budget <= 0.1 && e.debt > e.gdp * 2) { p += 10; parts.push('финансовый крах'); }
  return { p: Math.min(150, p), parts };
}
function capitulationCheck() {
  activeWars.slice().forEach(w => {
    let ca = countryMap[w.a], cb = countryMap[w.b]; if (!ca || !cb || !w.stats) return; const T = territoryOwner, { minX, minY, maxX, maxY } = w.bbox, aN = ca.numericId, bN = cb.numericId; let sa = 0, sb = 0;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) { let i = y * OFF_W + x, o = T[i]; if (o === aN) sa += warTroops[i]; else if (o === bN) sb += warTroops[i]; }
    w.tavg = { [w.a]: sa / Math.max(1, w.stats[w.a] || 1), [w.b]: sb / Math.max(1, w.stats[w.b] || 1) };
    let pa = warPressure(w, w.a), pb = warPressure(w, w.b); w.press = { [w.a]: pa, [w.b]: pb };
    if (currentTurn - (w.t0 || currentTurn) < 8) return;
    if (pa.p >= 100 || pb.p >= 100) endByCapitulation(w, pa.p >= pb.p ? w.a : w.b);
  });
}
function endByCapitulation(w, loserId) { warFinished(loserId, loserId === w.a ? w.b : w.a, w); }
// Единая точка окончания войны (капитуляция). Выполняется у всех игроков одинаково.
function warFinished(loserId, winnerId, w) {
  let L = countryMap[loserId], W = countryMap[winnerId]; if (!L || !W) return;
  addNewsEvent(`${L.name} капитулирует перед ${W.name}!`, 'war');
  if (loserId === LOCAL || winnerId === LOCAL || !isHuman(LOCAL)) toast(`🏳 ${L.name} капитулирует перед ${W.name}`, 'war');
  activeWars = activeWars.filter(x => x !== w); mapDirty = true; updateWarOverlay();
  if (isHuman(winnerId)) {
    [[winnerId, loserId], [loserId, winnerId]].forEach(([x, y]) => { if (diplomaticRelations[x] && diplomaticRelations[x][y]) diplomaticRelations[x][y].status = 'hostile'; });
    truces[winnerId + loserId] = truces[loserId + winnerId] = currentTurn + 10;
    if (isHuman(loserId)) { L.economy.reparations = { to: winnerId, percent: 0.15 }; L.gov.stability -= 10; L.gov.approval -= 10; }
    W._peace = { loser: loserId, war: w, turn: currentTurn };
    if (winnerId === LOCAL) showPeaceFor(W);
  } else { processBotSurrender(loserId, winnerId, w); endBotWar(w); }
}
// Победитель-человек должен выбрать условия мира. Окно открывается только у него (и после синхронизации тоже).
function showPeaceFor(W) {
  if (!W || !W._peace || suppressUI || W.id !== LOCAL) return;
  if (currentSurrenderTarget) return; openSurrenderModal(W._peace.loser, W._peace.war);
}
window.doSurrender = function (p) {
  let W = me(), P = W && W._peace; if (!P || P.loser !== p.target) return; let L = countryMap[p.target]; if (!L) { W._peace = null; return; }
  const war = P.war; W._peace = null;
  if (p.annex && !isHuman(L.id)) { annexCountry(L.id, W.id); addNewsEvent(`${W.name} полностью присоединила ${L.name}!`, 'war'); }
  else {
    if (p.repar > 0) L.economy.reparations = { to: W.id, percent: clamp(+p.repar, 0, 60) / 100 };
    if (p.army < 100 && L.army) L.army.divisions = L.army.divisions.slice(0, Math.round(L.army.divisions.length * clamp(+p.army, 0, 100) / 100));
    if (p.withdraw) { restoreWarBorders(war); addNewsEvent(`${W.name} вернула территории ${L.name} и вывела войска`, 'war'); }
    else applyProportionalTerritoryTransfer(war);
    if (p.status) { [[W.id, L.id], [L.id, W.id]].forEach(([x, y]) => { if (diplomaticRelations[x] && diplomaticRelations[x][y]) diplomaticRelations[x][y].status = 'neutral'; }); }
    if (p.nap) { [[W.id, L.id], [L.id, W.id]].forEach(([x, y]) => { if (diplomaticRelations[x] && diplomaticRelations[x][y]) diplomaticRelations[x][y].status = 'friendly'; });
      treaties.push({ id: nextId('t'), name: `Пакт о ненападении ${W.name}-${L.name}`, type: 'non_aggression', content: 'Пакт о ненападении на 10 лет', parties: [W.id, L.id], status: 'active', startDate: new Date(simDate), duration: 3650 }); }
    addNewsEvent(`${W.name} и ${L.name} подписали мирный договор`, 'war');
    if (isHuman(L.id) && cellsOf(L.numericId) < 60) { L._defeated = true; if (L.id === LOCAL && window.showDefeat) showDefeat(`${W.name} разгромила ${L.name}. Ваше государство потеряло почти всю территорию.`); }
  }
  mapDirty = true; computeAdjacency(); updatePlayerInfo(); renderCountryList();
};
// --- сделка (мирный договор / пересмотр границы)
let deal = null;
function cellsOf(num) { let n = 0; const T = territoryOwner; for (let i = 0; i < T.length; i++) if (T[i] === num) n++; return n; }
function transferStrip(fromNum, toNum, count) {
  const T = territoryOwner, N = OFF_W * OFF_H; _bId++; let h = 0, tl = 0, moved = 0;
  for (let i = 0; i < N; i++) { if (T[i] !== fromNum) continue; let x = i % OFF_W; if ((x > 0 && T[i - 1] === toNum) || (x < OFF_W - 1 && T[i + 1] === toNum) || (i >= OFF_W && T[i - OFF_W] === toNum) || (i < N - OFF_W && T[i + OFF_W] === toNum)) { _bS[i] = _bId; _bQ[tl++] = i; } }
  while (h < tl && moved < count) { let k = _bQ[h++]; T[k] = toNum; moved++; let x = k % OFF_W, nb;
    if (x > 0) { nb = k - 1; if (T[nb] === fromNum && _bS[nb] !== _bId) { _bS[nb] = _bId; _bQ[tl++] = nb; } } if (x < OFF_W - 1) { nb = k + 1; if (T[nb] === fromNum && _bS[nb] !== _bId) { _bS[nb] = _bId; _bQ[tl++] = nb; } }
    if (k >= OFF_W) { nb = k - OFF_W; if (T[nb] === fromNum && _bS[nb] !== _bId) { _bS[nb] = _bId; _bQ[tl++] = nb; } } if (k < N - OFF_W) { nb = k + OFF_W; if (T[nb] === fromNum && _bS[nb] !== _bId) { _bS[nb] = _bId; _bQ[tl++] = nb; } } }
  return moved;
}
function warBetween(a, b) { return activeWars.find(x => (x.a === a && x.b === b) || (x.a === b && x.b === a)); }
A.deal = function (id) { deal = { id, border: 0, line: 'front', repar: 0, army: false, pact: false }; renderDeal(); $('dealModal').style.display = 'flex'; A.hubClose(); };
A.dealSet = function (k, v) { deal[k] = v; renderDeal(); };
A.dealClose = function () { $('dealModal').style.display = 'none'; };
function dealChance(d) {
  let c = me(), o = countryMap[d.id], w = warBetween(c.id, d.id), base;
  if (w) { let ep = ((w.press || {})[d.id] || { p: 0 }).p, mp = ((w.press || {})[c.id] || { p: 0 }).p; base = 0.1 + ep / 100 * 0.9 - mp / 100 * 0.3; }
  else { let st = getDiplomaticStatus(d.id); base = (st === 'allied' ? 0.6 : st === 'friendly' ? 0.3 : st === 'neutral' ? 0.12 : 0.04) + (c.army.divisions.length > o.army.divisions.length * 1.5 ? 0.1 : 0); }
  let cost = d.border * 0.022 + d.repar * 0.006 + (d.army ? 0.18 : 0) + (d.line === 'prewar' && w ? 0.05 : 0) - (d.pact ? 0.05 : 0);
  return clamp(base - cost, 0.02, 0.97);
}
function renderDeal() {
  let c = me(), o = countryMap[d_().id], w = warBetween(c.id, deal.id), ch = dealChance(deal), pr = w && w.press ? w.press[deal.id] : null, B = (k, v, t) => `<button class="btn small ${deal[k] === v ? 'green' : ''}" onclick="A.dealSet('${k}',${typeof v === 'string' ? "'" + v + "'" : v})">${t}</button>`;
  $('dealBody').innerHTML = `<h4>${flagImg(o.id, 22)} ${w ? 'Мирный договор с ' : 'Пересмотр границы: '}${o.name}</h4>${pr ? `Давление на них: <b>${Math.round(pr.p)}</b>/100${pr.parts.length ? ' (' + pr.parts.join(', ') + ')' : ''}<br>` : ''}
  ${w ? `<div class="row"><span><b>Линия границы</b></span><span>${B('line', 'front', 'По текущему фронту')}${B('line', 'prewar', 'Вывод войск: довоенная')}</span></div>` : ''}
  <div class="row"><span><b>Пересмотр границы</b>: отдать нам <b>${deal.border}%</b> территории вдоль границы</span><input type="range" min="0" max="40" value="${deal.border}" onchange="A.dealSet('border',+this.value)"></div>
  <div class="row"><span><b>Репарации</b>: ${deal.repar}%</span><input type="range" min="0" max="30" value="${deal.repar}" onchange="A.dealSet('repar',+this.value)"></div>
  <div class="row"><span><b>Сократить армию врага вдвое</b></span><span>${B('army', true, 'Да')}${B('army', false, 'Нет')}</span></div>
  <div class="row"><span><b>Пакт о ненападении</b></span><span>${B('pact', true, 'Подписать')}${B('pact', false, 'Нет')}</span></div>
  <div style="margin:8px 0">Вероятность согласия: <b>${Math.round(ch * 100)}%</b><div class="pb"><div style="width:${ch * 100}%;background:#16a34a"></div></div></div>
  <button class="btn green small" style="display:inline-block" onclick="A.dealSend()">ПРЕДЛОЖИТЬ</button> <button class="btn small" style="display:inline-block" onclick="A.dealClose()">ОТМЕНА</button>`;
}
const d_ = () => deal;
A.dealSend = function () {
  const d = { border: deal.border, line: deal.line, repar: deal.repar, army: deal.army, pact: deal.pact };
  sendCmd('dealExec', [deal.id, d]); A.dealClose();
};
// Выполняется у всех: me() = отправитель
function applyDeal(aId, bId, d) {
  let c = countryMap[aId], o = countryMap[bId], w = warBetween(aId, bId); if (!c || !o) return;
  if (w && d.line === 'prewar') restoreWarBorders(w);
  let moved = 0; if (d.border > 0) { let total = cellsOf(o.numericId), want = Math.round(total * clamp(d.border, 0, 40) / 100); moved = transferStrip(o.numericId, c.numericId, want); if (moved) transferEconomyShare(o, c, moved / Math.max(1, total)); }
  if (d.repar > 0) o.economy.reparations = { to: c.id, percent: clamp(d.repar, 0, 30) / 100 }; if (d.army) o.army.divisions = o.army.divisions.slice(0, Math.ceil(o.army.divisions.length / 2));
  if (w) { activeWars = activeWars.filter(x => x !== w); endWarPeace(w); }
  if (d.pact) { truces[c.id + o.id] = truces[o.id + c.id] = currentTurn + 150; if (diplomaticRelations[c.id][o.id]) diplomaticRelations[c.id][o.id].status = 'friendly'; if (diplomaticRelations[o.id][c.id]) diplomaticRelations[o.id][c.id].status = 'friendly'; treaties.push({ id: nextId('t'), name: `Пакт о ненападении ${c.name}-${o.name}`, type: 'non_aggression', content: 'Пакт о ненападении', parties: [c.id, o.id], status: 'active', startDate: new Date(simDate), duration: 3650 }); }
  mapDirty = true; computeAdjacency(); addNewsEvent(`${c.name} и ${o.name} подписали ${w ? 'мирный договор' : 'соглашение о границе'}${moved ? ` (передано ${moved} секторов)` : ''}`, 'war');
  if (c.id === LOCAL || o.id === LOCAL) toast(`📜 ${w ? 'Мир подписан' : 'Договор подписан'}: ${c.name} — ${o.name}${moved ? `, передано ${moved} секторов` : ''}`, 'good');
  updatePlayerInfo();
}
window.dealExec = function (id, d) {
  let c = me(), o = countryMap[id]; if (!c || !o || id === c.id) return; d = d || {};
  d = { border: clamp(+d.border || 0, 0, 40), line: d.line === 'prewar' ? 'prewar' : 'front', repar: clamp(+d.repar || 0, 0, 30), army: !!d.army, pact: !!d.pact };
  let w = warBetween(c.id, id);
  if (isHuman(id)) {
    const aId = c.id, bId = id; const desc = `${w ? 'Мирный договор' : 'Пересмотр границы'} от ${c.name}: граница ${d.border}%, репарации ${d.repar}%${d.army ? ', сокращение армии' : ''}${d.pact ? ', пакт о ненападении' : ''}`;
    runAs(bId, () => mkDoc(w ? '📜 Предложение мира' : '📜 Пересмотр границы', desc, c.name, [
      ['Принять условия', () => { if (!warBetween(aId, bId) !== !w) return; applyDeal(aId, bId, d); }],
      ['Отклонить', () => { if (diplomaticRelations[aId] && diplomaticRelations[aId][bId]) diplomaticRelations[aId][bId].trust -= 5; addNewsEvent(`${o.name} отклонила предложение ${c.name}`, 'diplomacy'); }]], 150, 1));
    if (c.id === LOCAL) toast(`📨 Предложение отправлено: ${o.name} (решает игрок)`, 'info'); return;
  }
  let ok = RNG() < dealChance({ id, ...d });
  if (!ok) { if (diplomaticRelations[id] && diplomaticRelations[id][c.id]) diplomaticRelations[id][c.id].trust -= 10; if (c.id === LOCAL) toast(`${o.name} отклонила предложение`, 'warn'); return; }
  applyDeal(c.id, id, d);
};
