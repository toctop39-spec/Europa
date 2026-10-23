// ===== ТОРГОВЛЯ между странами, управление выпуском ресурсов, морская блокада =====
let routes = [], routeId = 1; const RES_N = { food: 'Продовольствие', steel: 'Сталь', oil: 'Нефть' }, SHIP_CAP = 3000;
window._trD = { to: '', res: 'food', amt: 1000, dir: 'sell', bt: '' }; window._outP = {};
const portsOf = cid => buildings.filter(b => b.type === 'port' && b.ownerId === cid && b.status === 'active');
const hasPort = cid => !isHuman(cid) || portsOf(cid).length > 0;
const routeMode = (a, b) => { const A_ = countryMap[a]; return A_ && A_.neighbors && A_.neighbors.has(b) && !atWarWith(a, b) ? 'land' : 'sea'; };
const shipOwner = r => isHuman(r.from) ? r.from : isHuman(r.to) ? r.to : null;
const depCount = (cid, res) => { const n = countryMap[cid].numericId; return deposits.reduce((q, d) => q + (d.k === res && territoryOwner[d.y * OFF_W + d.x] === n ? 1 : 0), 0); };   // месторождения в пределах страны
const botCap = (cid, res) => depCount(cid, res) * 400;   // бот может поставлять до 400 ед./день с каждого своего месторождения
const committed = (cid, res) => routes.filter(r => r.status === 'active' && r.from === cid && r.res === res).reduce((q, r) => q + r.amt, 0);
const freeShips = c => c.ships.total - c.ships.busy - (c.ships.trade || 0);
function blockFactor(r) {   // насколько морская блокада режет доставку: зависит от портов блокирующих рядом с трассой
  let pa = portsOf(r.from)[0] || capitalOf(countryMap[r.from]), pb = portsOf(r.to)[0] || capitalOf(countryMap[r.to]); if (!pa || !pb) return 0;
  let mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2, f = 0;
  countries.forEach(B => { if (!isHuman(B.id) || !B.gov || !B.gov.block || B.id === r.from || B.id === r.to || !(B.gov.block[r.from] || B.gov.block[r.to])) return;
    portsOf(B.id).forEach(p => { f += Math.max(0, 1 - (Math.abs(p.x - mx) + Math.abs(p.y - my)) / 350) * 0.5; }); });
  return Math.min(0.9, f);
}
function releaseShips(r) { if (r.ships && r.shipOwner) { const c = countryMap[r.shipOwner]; if (c && c.ships) c.ships.trade = Math.max(0, (c.ships.trade || 0) - r.ships); } r.ships = 0; }
function activateRoute(r) {
  r.mode = routeMode(r.from, r.to);
  if (r.mode === 'sea') {
    if (!hasPort(r.from) || !hasPort(r.to)) { r.status = 'rejected'; return false; }
    const o = shipOwner(r), n = Math.ceil(r.amt / SHIP_CAP);
    if (o) { const c = countryMap[o]; if (freeShips(c) < n) { r.status = 'rejected'; if (o === LOCAL) toast(`Не хватает кораблей для маршрута: нужно ${n}`, 'warn'); return false; } c.ships.trade = (c.ships.trade || 0) + n; r.ships = n; r.shipOwner = o; }
  }
  r.status = 'active'; addNewsEvent(`${countryMap[r.from].name} поставляет ${RES_N[r.res].toLowerCase()} стране ${countryMap[r.to].name}`, 'economy');
  if (r.from === LOCAL || r.to === LOCAL) toast(`🚢 Торговый маршрут открыт: ${RES_N[r.res]} · ${countryMap[r.from].name} → ${countryMap[r.to].name}`, 'good');
  return true;
}
A.tradeOffer = function (to, res, amt, dir) {
  const c = me(), t = countryMap[to]; if (!c || !t || to === c.id || !RES_N[res]) return; amt = clamp(Math.round(+amt || 0), 10, 30000);
  if (atWarWith(c.id, to)) return toast('С воюющей страной торговать нельзя', 'warn');
  if (routes.filter(r => r.status === 'active' && (r.from === c.id || r.to === c.id)).length >= 6) return toast('Не более 6 активных маршрутов', 'warn');
  const r = { id: routeId++, from: dir === 'sell' ? c.id : to, to: dir === 'sell' ? to : c.id, res, amt, price: +MARKET[res].p.toFixed(4), status: 'proposed', by: c.id };
  if (routeMode(r.from, r.to) === 'sea') { if (!hasPort(c.id) || !hasPort(to)) return toast('Нет сухопутного коридора: нужен порт у обеих стран (Строительство → Порт)', 'warn'); if (isHuman(c.id) && freeShips(c) < Math.ceil(amt / SHIP_CAP)) return toast(`Нужно кораблей: ${Math.ceil(amt / SHIP_CAP)} (1 корабль = ${SHIP_CAP} ед.). Постройте корабли`, 'warn'); }
  routes.push(r);
  if (isHuman(to)) {
    runAs(to, () => mkDoc(`Торговое предложение от ${c.name}`, `${c.name} предлагает: ${dir === 'sell' ? 'продать вам' : 'купить у вас'} ${RES_N[r.res].toLowerCase()}, ${amt} ед./день по ${(r.price * 1000).toFixed(1)} за ед. (${fM(r.price * amt)}/день). Маршрут: ${routeMode(r.from, r.to) === 'sea' ? 'морской' : 'по суше'}.`, c.name,
      [['Принять', () => { if (r.status === 'proposed') activateRoute(r); }], ['Отклонить', () => { r.status = 'rejected'; }]], 40, 1));
    if (c.id === LOCAL) toast('📨 Торговое предложение отправлено игроку', 'info');
  } else {
    let why = ''; if (!isHuman(r.from)) { const left = botCap(r.from, res) - committed(r.from, res); if (left < 10) why = 'у этой страны нет свободных месторождений этого ресурса'; else r.amt = Math.min(amt, left); }
    else if (depCount(r.to, res) > 0) why = 'страна сама добывает этот ресурс и не нуждается в нём'; else r.amt = Math.min(amt, 600);
    if (!why && RNG() < botAcceptChance(c.id, to, 'trade') && activateRoute(r)) { } else { r.status = 'rejected'; if (c.id === LOCAL) toast(`${t.name} отклонила предложение${why ? ': ' + why : ''}`, 'warn'); }
  }
  hubRender();
};
A.tradeCancel = function (id) { const c = me(), r = routes.find(x => x.id === id); if (!r || (r.from !== c.id && r.to !== c.id)) return; releaseShips(r); r.status = 'cancelled'; hubRender(); };
A.blockade = function (id) {
  const c = me(), t = countryMap[id]; if (!c || !t || id === c.id) return; c.gov.block = c.gov.block || {};
  if (c.gov.block[id]) { delete c.gov.block[id]; toast(`Блокада ${t.name} снята`, 'info'); hubRender(); return; }
  if (!portsOf(c.id).length) return toast('Для блокады нужен порт (чем ближе к торговым путям цели, тем эффективнее)', 'warn');
  c.gov.block[id] = 1; const r = diplomaticRelations[id] && diplomaticRelations[id][c.id]; if (r && r.status !== 'at_war') { r.status = 'hostile'; if (diplomaticRelations[c.id][id]) diplomaticRelations[c.id][id].status = 'hostile'; }
  addNewsEvent(`${c.name} объявила морскую блокаду ${t.name}`, 'war'); toast(`⚓ Морская блокада ${t.name} объявлена`, 'good'); mapDirty = true; hubRender();
};
A.warAid = function (wid, kind) {
  const c = me(), w = activeWars.find(x => x.id === wid); if (!w || w.a === c.id || w.b === c.id) return; const def = countryMap[w.b], att = countryMap[w.a], e = c.economy;
  if (kind === 'sanction') { if (!att.economy.sanct) { att.economy.sanct = 1; addNewsEvent(`${c.name} вводит санкции против ${att.name}`, 'diplomacy'); } toast(`Санкции против ${att.name} введены`, 'good'); return; }
  if (kind === 'money') { if (e.budget < 10) return toast('Нужно 10', 'warn'); e.budget -= 10; def.economy.budget += 10; }
  else if (kind === 'men') { if (e.manpower < 20000) return toast('Нужно 20 000 человек', 'warn'); e.manpower -= 20000; def.economy.manpower += 20000; }
  else if (RES_N[kind]) { if (e.res[kind] < 200) return toast('Нужно 200 ед. на складе', 'warn'); e.res[kind] -= 200; if (def.economy.res) def.economy.res[kind] += 200; else def.militaryStock = (def.militaryStock || 0) + 20; } else return;
  [[w.b, c.id, 10], [w.a, c.id, -10]].forEach(([x, y, d]) => { const r = diplomaticRelations[x] && diplomaticRelations[x][y]; if (r) r.trust = clamp((r.trust || 50) + d, 0, 100); });
  addNewsEvent(`${c.name} помогает ${def.name} в войне против ${att.name}`, 'diplomacy'); toast(`Помощь отправлена: ${def.name}`, 'good'); hubRender();
};
A.setOut = function (key, pct) {
  const c = me(); pct = clamp(Math.round(+pct) || 0, 0, 100); delete _outP[key];
  if (/^\d+$/.test(String(key))) { const b = buildings.find(x => x.id === +key && x.ownerId === c.id); if (b) b.out = pct; } else if (key === 'steelmill' || key === 'refinery') { c.out = c.out || {}; c.out[key] = pct; }
  hubRender();
};
function warSupportDaily() {   // страны-друзья защищающегося сами помогают деньгами и санкциями
  if (currentTurn % 10) return;
  activeWars.forEach(w => { const def = countryMap[w.b], att = countryMap[w.a]; if (!def || !att || !(isHuman(w.a) || isHuman(w.b))) return;
    countries.forEach(B => { if (isHuman(B.id) || B.id === w.a || B.id === w.b || B._defeated || !B.economy) return; const r = diplomaticRelations[B.id] && diplomaticRelations[B.id][w.b];
      if (!r || (r.status !== 'allied' && r.status !== 'friendly') || RNG() > 0.12) return; const amt = Math.min(3, Math.max(0, B.economy.budget * 0.05)); B.economy.budget -= amt; def.economy.budget += amt; if (RNG() < 0.4) att.economy.sanct = 1;
      addNewsEvent(`${B.name} поддерживает ${def.name} в войне против ${att.name}`, 'diplomacy'); if (w.b === LOCAL && !suppressUI) toast(`🤝 ${B.name} поддержала вас деньгами`, 'good'); }); });
}
function tradeDaily() {
  goalsDaily(); warSupportDaily();
  routes.forEach(r => {
    if (r.status !== 'active') return; const E = countryMap[r.from], I = countryMap[r.to];
    if (!E || !I || E._defeated || I._defeated) { releaseShips(r); r.status = 'cancelled'; return; }
    if (atWarWith(r.from, r.to)) { r.paused = true; return; } r.paused = false; r.mode = routeMode(r.from, r.to); r.blk = 0; let f = 1;
    if (r.mode === 'sea') { if (!hasPort(r.from) || !hasPort(r.to)) { r.blk = 1; return; } r.blk = blockFactor(r); f = 1 - r.blk; }
    if (!isHuman(r.from) && botCap(r.from, r.res) <= 0) { r.paused = true; return; }
    const er = isHuman(r.from) ? E.economy.res : null, ir = isHuman(r.to) ? I.economy.res : null; let q = r.amt * f; if (er) q = Math.min(q, Math.max(0, er[r.res] - 50)); if (q <= 0.5) return;
    let cost = q * r.price; if (I.economy.budget < cost) { q = Math.max(0, I.economy.budget) / r.price; cost = q * r.price; } if (q <= 0.5) return;
    if (er) er[r.res] -= q; if (ir) ir[r.res] += q; E.economy.budget += cost; I.economy.budget -= cost; r.done = (r.done || 0) + q;
  });
  if (routes.length > 120) routes = routes.filter(r => r.status === 'active' || r.status === 'proposed');
}
{ const _dx = window.dailyExt; window.dailyExt = function () { _dx(); tradeDaily(); }; }

window.tTrade = function (c) {
  const D = _trD, my = routes.filter(r => (r.status === 'active' || r.status === 'proposed') && (r.from === c.id || r.to === c.id)), e = c.economy, r_ = e.res;
  if (!D.to || D.to === c.id) D.to = ([...c.neighbors][0]) || (countries.find(o => o.id !== c.id) || {}).id;
  const rows = my.map(r => { const o = countryMap[r.from === c.id ? r.to : r.from], out = r.from === c.id; return `<div class="row"><span>${out ? '📤 Продаю' : '📥 Покупаю'}: <b>${RES_N[r.res]}</b> ${r.amt}/д ${out ? '→' : '←'} ${o.name} · ${fM(r.price * r.amt)}/д · ${r.status === 'proposed' ? 'ожидает ответа' : (r.mode === 'sea' ? '🚢 море' + (r.ships ? ', кораблей ' + r.ships : '') + (r.blk ? ' · <b style="color:#b91c1c">блокада ' + Math.round(r.blk * 100) + '%</b>' : '') : '🚛 по суше')}${r.paused ? ' · пауза (война)' : ''}</span><span>${btn('Отменить', `A.tradeCancel(${r.id})`, 'red')}</span></div>`; }).join('') || '<i>нет маршрутов</i>';
  const okC = o => isHuman(o.id) || (D.dir === 'buy' ? depCount(o.id, D.res) > 0 : depCount(o.id, D.res) === 0);
  { const l = countries.filter(o => o.id !== c.id && okC(o)); if (l.length && !l.some(o => o.id === D.to)) D.to = l[0].id; }
  const opt = (id, flt) => countries.filter(o => o.id !== c.id && (!flt || okC(o))).sort((a, b) => a.name.localeCompare(b.name)).map(o => `<option value="${o.id}" ${id === o.id ? 'selected' : ''}>${o.name}${c.neighbors.has(o.id) ? ' (сосед)' : ''}</option>`).join('');
  const sl = (key, v) => { const val = _outP[key] !== undefined ? _outP[key] : v; return `<input type="range" min="0" max="100" step="10" value="${val}" oninput="this.nextElementSibling.textContent=this.value+'%'" onchange="_outP['${key}']=this.value;A.setOut('${key}',this.value)"><b>${val}%</b>`; };
  const prod = buildings.filter(b => b.ownerId === c.id && b.status === 'active' && ['farm', 'mine', 'oilrig'].includes(b.type)).map(b => `<div class="row"><span>${BT[b.type].n} (${Math.round(b.x)},${Math.round(b.y)}) · ${BT[b.type].eff.split(',')[0]}</span><span>${sl(b.id, b.out === undefined ? 100 : b.out)}</span></div>`).join('')
    + ['steelmill', 'refinery'].filter(k => bcount(c, k)).map(k => `<div class="row"><span>${BT[k].n} ×${bcount(c, k)}</span><span>${sl(k, c.out && c.out[k] !== undefined ? c.out[k] : 100)}</span></div>`).join('');
  const bl = Object.keys(c.gov.block || {}).map(id => `<div class="row"><span>⚓ Блокада: <b>${countryMap[id].name}</b></span><span>${btn('Снять', `A.blockade('${id}')`)}</span></div>`).join('');
  return `<div class="g2"><div>
  <div class="cd"><h4>Склад</h4>Еда ${r_.food.toFixed(0)} · Сталь ${r_.steel.toFixed(0)} · Нефть ${r_.oil.toFixed(0)} · Бюджет ${fM(e.budget)}<br>Кораблей: ${c.ships.total} (на маршрутах ${c.ships.trade || 0}, в операциях ${c.ships.busy}, свободно ${freeShips(c)}${c.ships.q.length ? ', строится ' + c.ships.q.length : ''}) · портов ${portsOf(c.id).length} ${btn('Построить корабль', 'A.buildShip()')}<br><i>1 корабль возит до ${SHIP_CAP} ед. ресурса в день. Соседи торгуют по суше, остальные — по морю между портами.</i></div>
  <div class="cd"><h4>Мои маршруты</h4>${rows}</div>
  <div class="cd"><h4>Новый маршрут</h4><select onchange="_trD.dir=this.value;hubRender()"><option value="sell" ${D.dir === 'sell' ? 'selected' : ''}>Продаю</option><option value="buy" ${D.dir === 'buy' ? 'selected' : ''}>Покупаю</option></select>
  <select onchange="_trD.res=this.value;hubRender()">${Object.keys(RES_N).map(k => `<option value="${k}" ${D.res === k ? 'selected' : ''}>${RES_N[k]} (≈${(MARKET[k].p * 1000).toFixed(1)}/ед.)</option>`).join('')}</select>
  <input type="number" min="10" max="30000" value="${D.amt}" style="width:70px" onchange="_trD.amt=+this.value"> ед./день · страна: <select onchange="_trD.to=this.value">${opt(D.to, 1)}</select><br><i>Покупать можно у стран с месторождениями этого ресурса, продавать — странам, у которых их нет (и игрокам). Свободного рынка нет.</i><br>Продавцы сейчас: ${Object.keys(RES_N).map(k => RES_N[k] + ' — ' + (countries.filter(o => o.id !== c.id && depCount(o.id, k) > 0).slice(0, 8).map(o => o.name).join(', ') || 'никто')).join('; ')} ${btn('Предложить', 'A.tradeGo()', 'green')}</div></div>
  <div><div class="cd"><h4>Помощь воюющим</h4>${activeWars.filter(w => w.a !== c.id && w.b !== c.id).slice(0, 8).map(w => `<div class="row"><span><b>${countryMap[w.a].name}</b> напал на <b>${countryMap[w.b].name}</b></span><span>${btn('10 денег', `A.warAid(${w.id},'money')`)}${btn('20k чел', `A.warAid(${w.id},'men')`)}${btn('200 еды', `A.warAid(${w.id},'food')`)}${btn('200 стали', `A.warAid(${w.id},'steel')`)}${btn('200 нефти', `A.warAid(${w.id},'oil')`)}${btn('Санкции', `A.warAid(${w.id},'sanction')`, 'red')}</span></div>`).join('') || '<i>сейчас нет войн</i>'}<i>Помощь идёт защищающейся стороне; санкции — против напавшего.</i></div>
  <div class="cd"><h4>Выпуск ресурсов</h4>Регулируйте, сколько даёт каждый объект (рудники, вышки, агрокомплексы стоят 0.04 в день на полном выпуске).${prod || '<br><i>нет добывающих объектов</i>'}</div>
  <div class="cd"><h4>Морская блокада</h4>Порты рядом с трассой чужой торговли режут её доставку (до 90%). Нужен порт.<br><select onchange="_trD.bt=this.value"><option value="">— страна —</option>${opt(D.bt)}</select> ${btn('Объявить / снять блокаду', 'if(_trD.bt)A.blockade(_trD.bt)', 'red')}${bl}</div></div></div>`;
};
A.tradeGo = () => { if (!_trD.to) return toast('Выберите страну', 'warn'); A.tradeOffer(_trD.to, _trD.res, _trD.amt, _trD.dir); };
