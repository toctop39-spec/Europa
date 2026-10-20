// ===== V3 EXT5: морской транспорт =====
BUILDING_TYPES.port = { name: 'Порт', color: '#0ea5e9', baseCost: 0.4 }; BT.port.map = 1;
let seaGroups = [], seaId = 1; const SHIP_SPEED = 14;
function isCoast(x, y) { x = Math.round(x); y = Math.round(y); for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { let xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < OFF_W && yy < OFF_H && territoryOwner[yy * OFF_W + xx] === 0) return true; } return false; }
function nearestSea(x, y, r = 6) { x = Math.round(x); y = Math.round(y); let best = null, bd = 1e9; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { let xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= OFF_W || yy >= OFF_H || territoryOwner[yy * OFF_W + xx] !== 0) continue; let d = dx * dx + dy * dy; if (d < bd) { bd = d; best = { x: xx, y: yy }; } } return best; }
function seaPath(a, b) {
  const T = territoryOwner, N = OFF_W * OFF_H, s = a.y * OFF_W + a.x, t = b.y * OFF_W + b.x; _bId++; let h = 0, tl = 0, ok = false; _bQ[tl++] = s; _bS[s] = _bId; _bP[s] = -1;
  while (h < tl) { let k = _bQ[h++]; if (k === t) { ok = true; break; } let x = k % OFF_W, nb;
    if (x > 0) { nb = k - 1; if (_bS[nb] !== _bId && T[nb] === 0) { _bS[nb] = _bId; _bP[nb] = k; _bQ[tl++] = nb; } } if (x < OFF_W - 1) { nb = k + 1; if (_bS[nb] !== _bId && T[nb] === 0) { _bS[nb] = _bId; _bP[nb] = k; _bQ[tl++] = nb; } }
    if (k >= OFF_W) { nb = k - OFF_W; if (_bS[nb] !== _bId && T[nb] === 0) { _bS[nb] = _bId; _bP[nb] = k; _bQ[tl++] = nb; } } if (k < N - OFF_W) { nb = k + OFF_W; if (_bS[nb] !== _bId && T[nb] === 0) { _bS[nb] = _bId; _bP[nb] = k; _bQ[tl++] = nb; } } }
  if (!ok) return null; let p = []; for (let k = t; k !== -1; k = _bP[k]) p.push([k % OFF_W, (k / OFF_W) | 0]); return p.reverse();
}
A.buildShip = function () {
  let c = me(); let ports = buildings.filter(b => b.type === 'port' && b.ownerId === c.id && b.status === 'active' && territoryOwner[Math.round(b.y) * OFF_W + Math.round(b.x)] === c.numericId);
  if (!ports.length) return toast('Нужен порт на вашем побережье (Строительство → Порт)', 'warn'); let cost = +(3 * costMult(c)).toFixed(2);
  if (c.economy.budget < cost) return toast('Не хватает денег', 'warn'); c.economy.budget -= cost; c.ships.q.push({ left: 6 }); toast('Заложен транспортный корабль (6 дн.)', 'good'); hubRender();
};
A.seaMode = function (n) {
  let c = me(), free = c.ships.total - c.ships.busy - (c.ships.trade || 0), divs = c.army.divisions.filter(d => d.status === 'active');
  if (!buildings.some(b => b.type === 'port' && b.ownerId === c.id && b.status === 'active')) return toast('Нет порта. Постройте порт на побережье', 'warn');
  if (free < n) return toast(`Не хватает кораблей: нужно ${n}, свободно ${free} (1 корабль = 1 дивизия)`, 'warn'); if (divs.length < n) return toast('Не хватает свободных дивизий', 'warn');
  window._seaN = n; currentTool = 'sea_' + n; A.hubClose(); toast('Кликните по побережью, куда высадить дивизии (своё или вражеское)', 'info');
};
canvas.addEventListener('mousedown', e => {
  if (e.button !== 0 || e.shiftKey || !String(currentTool).startsWith('sea_')) return; let r = canvas.getBoundingClientRect(), w = screenToWorld(e.clientX - r.left, e.clientY - r.top); currentTool = 'inspect'; sendCmd('seaOrder', [Math.round(w.x), Math.round(w.y), window._seaN]);
});
function seaOrder(tx, ty, n) {
  let c = me(), gi = ty * OFF_W + tx, o = territoryOwner[gi];
  if (!isHuman(c.id) || c._defeated) return; if (!(n >= 1 && n <= 20)) return; if (!o) return toast('Выберите сушу на побережье', 'warn'); let oc = countries.find(x => x.numericId === o);
  if (o !== c.numericId && !(oc && atWarWith(c.id, oc.id))) return toast('Высаживаться можно на своей земле или на земле страны, с которой вы воюете', 'warn');
  if (!isCoast(tx, ty)) return toast('Это не побережье', 'warn'); let sEnd = nearestSea(tx, ty); if (!sEnd) return toast('Рядом нет моря', 'warn');
  let ports = buildings.filter(b => b.type === 'port' && b.ownerId === c.id && b.status === 'active' && territoryOwner[Math.round(b.y) * OFF_W + Math.round(b.x)] === c.numericId).sort((a, b) => Math.hypot(a.x - tx, a.y - ty) - Math.hypot(b.x - tx, b.y - ty));
  let port = null, path = null, sStart = null; for (let p of ports) { sStart = nearestSea(p.x, p.y); if (!sStart) continue; path = seaPath(sStart, sEnd); if (path) { port = p; break; } }
  if (!port) return toast('Нет морского пути от ваших портов до этой точки', 'warn');
  let org = getHubPosition(c.id) || capitalOf(c), land = org ? ownPath(org.x, org.y, Math.round(port.x), Math.round(port.y), c.numericId) : null; let landDays = land ? Math.ceil(land.length / convoySpeed(c.id)) : 3;
  let divs = c.army.divisions.filter(d => d.status === 'active').sort((a, b) => b.strength - a.strength).slice(0, n);
  divs.forEach(d => { d.status = 'sea'; d.sea = 'toport'; }); c.ships.busy += n;
  seaGroups.push({ owner: c.id, id: seaId++, divs: divs.map(d => d.id), n, port, path, idx: 0, prev: 0, stage: 'toport', left: Math.max(1, landDays), target: { x: tx, y: ty } });
  toast(`🚢 ${n} див.: к порту ~${landDays} дн., загрузка 2 дн., переход ~${Math.ceil(path.length / SHIP_SPEED)} дн.`, 'good');
}
const SEA_NAMES = { toport: 'идут к порту', loading: 'погрузка', sailing: 'в море', unloading: 'высадка', return: 'корабли возвращаются' };
function seaDaily() {
  let c = me(); if (!c || !isHuman(c.id)) return;
  c.ships.q.forEach(q => q.left--); let fin = c.ships.q.filter(q => q.left <= 0).length; if (fin) { c.ships.total += fin; c.ships.q = c.ships.q.filter(q => q.left > 0); toast(`⚓ Построено кораблей: ${fin}`, 'good'); }
  seaGroups.forEach(g => {
    if (g.done || g.owner !== c.id) return;
    if (g.stage === 'toport') { if (--g.left <= 0) { g.stage = 'loading'; g.left = 2; setSea(g, 'loading'); } else setSea(g, 'toport'); }
    else if (g.stage === 'loading') { if (--g.left <= 0) { g.stage = 'sailing'; setSea(g, 'sailing'); } }
    else if (g.stage === 'sailing') { g.prev = g.idx; g.idx = Math.min(g.path.length - 1, g.idx + SHIP_SPEED); if (g.idx >= g.path.length - 1) { g.stage = 'unloading'; g.left = 1; setSea(g, 'unloading'); } }
    else if (g.stage === 'unloading') { if (--g.left <= 0) { landing(g); g.stage = 'return'; g.prev = g.idx; } }
    else if (g.stage === 'return') { g.prev = g.idx; g.idx = Math.max(0, g.idx - SHIP_SPEED); if (g.idx <= 0) { c.ships.busy = Math.max(0, c.ships.busy - g.n); g.done = true; } }
  }); seaGroups = seaGroups.filter(g => !g.done);
}
function setSea(g, st) { let c = me(); g.divs.forEach(id => { let d = c.army.divisions.find(x => x.id === id); if (d) { d.status = 'sea'; d.sea = st; } }); }
function landing(g) {
  let c = me(), divs = g.divs.map(id => c.army.divisions.find(d => d.id === id)).filter(Boolean), tx = g.target.x, ty = g.target.y, gi = ty * OFF_W + tx, o = territoryOwner[gi], P = divs.reduce((s, d) => s + d.strength, 0);
  let war = activeWars.find(w => w.a === c.id || w.b === c.id);
  if (o === c.numericId) { if (war) { spreadTroops(c.numericId, tx, ty, P); divs.forEach(d => { d.status = 'front'; d.warId = war.id; }); } else divs.forEach(d => d.status = 'active'); mark(tx, ty, '⚓', 'Дивизии высадились на своём побережье', 'good', 8); return; }
  let oc = countries.find(x => x.numericId === o);
  if (!oc || !atWarWith(c.id, oc.id)) { divs.forEach(d => d.status = 'active'); mark(tx, ty, '⚓', 'Высадка отменена: цель больше не враг', 'warn', 8); return; }
  let cells = [], E = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { let k = (ty + dy) * OFF_W + tx + dx; if (territoryOwner[k] === o) { cells.push([Math.abs(dx) <= 1 && Math.abs(dy) <= 1, k]); E += warTroops[k]; } }
  let att = P * getCombatMult(c.id, oc.id, 'att') * 0.8, def = E * getCombatMult(oc.id, c.id, 'def');
  if (att > def * 1.2) {
    let take = cells.filter(x => x[0]).map(x => x[1]); take.forEach(k => { territoryOwner[k] = c.numericId; warTroops[k] = att * 0.8 / take.length; }); mapDirty = true;
    divs.forEach(d => { d.status = 'front'; d.warId = war ? war.id : 0; d.strength = Math.max(20, d.strength * 0.85); }); mark(tx, ty, '⚓', `Плацдарм захвачен в ${oc.name}`, 'good', 10); toast(`⚓ Высадка в ${oc.name} успешна!`, 'good'); addNewsEvent(`Морской десант ${c.name} высадился в ${oc.name}`, 'war');
  } else {
    cells.forEach(x => warTroops[x[1]] = Math.max(0, warTroops[x[1]] - att * 0.3 / cells.length)); divs.forEach(d => { d.strength = Math.max(15, d.strength * 0.4); d.status = 'active'; });
    mark(tx, ty, '⚓', `Высадка в ${oc.name} отбита`, 'bad', 10); toast(`✖ Высадка в ${oc.name} отбита, потери 60%`, 'bad');
  }
}
function drawSea() {
  if (!seaGroups.length) return; const t = easeT(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; let r = 7 / scale;
  seaGroups.forEach(g => {
    if (g.stage !== 'sailing' && g.stage !== 'return' && g.stage !== 'unloading') return; let i = clamp(g.prev + (g.idx - g.prev) * t, 0, g.path.length - 1), p = g.path[Math.floor(i)];
    ctx.font = `${r * 1.8}px sans-serif`; ctx.fillStyle = '#fff'; ctx.fillText('🚢', p[0], p[1]); let fw = r * 1.4; ctx.drawImage(getFlagCanvas(g.owner), p[0] - fw / 2, p[1] - r * 1.9, fw, fw * 0.667);
    if (g.n > 1) { ctx.font = `bold ${r}px Verdana`; ctx.fillStyle = '#fde047'; ctx.fillText('×' + g.n, p[0] + r * 1.4, p[1]); } });
  ctx.textBaseline = 'alphabetic';
}
