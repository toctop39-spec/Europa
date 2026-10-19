// ===== MP: мультиплеер (детерминированный lockstep), лобби, чат, дипломатия между игроками =====
// Все клиенты получают от сервера одни и те же команды каждые 2 секунды и считают игру одинаково.
'use strict';
let LOCAL = '';            // страна ЭТОГО игрока ('' = наблюдатель)
let suppressUI = false;    // идёт догон/перемотка: интерфейс не трогаем
let replaying = false;
let ctxActor = '';         // чьи команды выполняются сейчас ('' = мировая симуляция)
let ctxDepth = 0;
const humans = new Set();  // страны, управляемые людьми
const isHuman = id => !!id && humans.has(id);
const detNow = () => simDate.getTime();
let tickNo = 0, PRES = { players: [], paused: false }, MYNAME = '', netReady = false, CHAT = [];
const CMDS = {};
const params = new URLSearchParams(location.search);
const SOLO = location.protocol === 'file:' || params.has('solo');

function visible() { return !suppressUI && (!ctxActor || ctxActor === LOCAL); }
function runAs(actor, fn) {
  const pc = playerCountryId, ca = ctxActor, dn = Date.now;
  playerCountryId = actor; ctxActor = actor; Date.now = detNow; ctxDepth++;
  try { return fn(); } finally { ctxDepth--; playerCountryId = pc; ctxActor = ca; Date.now = dn; }
}
// Интерфейсные функции не должны срабатывать, когда команда чужого игрока считается у нас
['toast', 'mark', 'alertBox', 'updatePlayerInfo', 'renderCountryList', 'openSurrenderModal', 'hubRender'].forEach(n => {
  const f = window[n]; if (typeof f !== 'function') return;
  window[n] = function () { if (!visible()) return; return f.apply(this, arguments); };
});
{ const f = A.hub; A.hub = function () { if (!visible()) return; return f.apply(this, arguments); }; }
['updateWarOverlay', 'refreshUnits'].forEach(n => { const f = window[n]; if (typeof f !== 'function') return; window[n] = function () { if (suppressUI) return; return f.apply(this, arguments); }; });
['renderOffscreenMap', 'draw'].forEach(n => {
  const f = window[n]; if (typeof f !== 'function') return;
  window[n] = function () {
    if (suppressUI) { mapDirty = true; return; }
    const pc = playerCountryId; playerCountryId = LOCAL; try { return f.apply(this, arguments); } finally { playerCountryId = pc; }
  };
});
// старые окна (чаты/договоры/кредиты) заменены вкладкой «Дипломатия»
['openDiplomacyModal', 'openChatModal', 'openTreatiesModal', 'openCustomTreatyModal', 'openCreditModal', 'openNotificationsModal', 'openCreateTreatyModal'].forEach(n => { window[n] = () => { if (n === 'openChatModal') chatToggle(true); else A.hub('dipl'); }; });
['trainDivision', 'buyFactory', 'buyHousing', 'makeInvestment', 'openEconomyModal', 'openConstructionModal', 'openArmyModal', 'openInvestmentModal'].forEach(n => { window[n] = () => A.hub(n.includes('Army') || n === 'trainDivision' ? 'mil' : n.includes('Constr') || n.includes('buy') ? 'build' : 'econ'); });

window.gotoCountry = function (id) { const c = countryMap[id]; const p = c && ((typeof capitalOf === 'function' && capitalOf(c)) || c._lc); if (p) A.goto(p.x, p.y); };
// ---------- команды ----------
function sendCmd(name, args) {
  if (replaying) return;
  if (!isHuman(LOCAL)) { toast('Вы наблюдатель: выберите страну, чтобы играть', 'warn'); openLobby(); return; }
  NET.send({ t: 'cmd', name, args: JSON.parse(JSON.stringify(args || [])) });
}
const WRAP = ['newProject', 'orderDiv', 'saveTpl', 'reinf', 'disband', 'hireGen', 'newArmy', 'setStance', 'armyGen', 'divArmy', 'setPost', 'setArmyPost', 'reinfAll', 'train', 'setTarget', 'clearTargets', 'setLine', 'setCiv', 'research', 'reinfWar', 'recall', 'autoSend', 'ceasefire', 'cb', 'warDoc', 'docDo', 'invest', 'issueBond', 'printMoney', 'trade', 'setLvl', 'setTax', 'setRate', 'law', 'decree', 'hire', 'fire', 'sanction', 'aid', 'spy', 'sabotage', 'buildShip', 'cancelP', 'pauseP', 'prioP'];
WRAP.forEach(n => {
  const impl = A[n]; if (typeof impl !== 'function') { console.warn('нет A.' + n); return; }
  CMDS[n] = impl;
  A[n] = function () { const a = Array.prototype.slice.call(arguments); if (ctxDepth > 0 || replaying) return impl.apply(null, a); if (!replaying && isHuman(LOCAL)) { try { if (n === 'docDo') { const d = docs.find(x => x.id === a[0]); if (d) d._sent = 1; } else if (n === 'divArmy') { const d = countryMap[LOCAL].army.divisions.find(x => x.id === a[0]); if (d) d._pend = +a[1]; } else toast('⏳ Приказ отдан — вступит в силу в начале следующего дня', 'info'); } catch (e) { } if (window.hubRender) hubRender(true); } return sendCmd(n, a); };
});
CMDS.seaOrder = (x, y, n) => seaOrder(+x | 0, +y | 0, +n | 0);
CMDS.dealExec = (id, d) => window.dealExec(id, d);
CMDS.doSurrender = p => window.doSurrender(p);
CMDS.flag = spec => {
  const hex = s => typeof s === 'string' && /^#[0-9a-fA-F]{3,6}$/.test(s);
  if (!spec || typeof spec.p !== 'string' || !Array.isArray(spec.c) || spec.c.length > 4 || !spec.c.every(hex)) return;
  const clean = { p: spec.p.slice(0, 10), c: spec.c.slice(0, 4), e: spec.e ? String(spec.e).slice(0, 10) : null }; if (hex(spec.ec)) clean.ec = spec.ec;
  A.setFlag(clean);
};
CMDS.$join = function (name) {
  const c = countryMap[ctxActor]; if (!c || humans.has(c.id) || c._defeated) return;
  humans.add(c.id); c._pname = String(name || 'Игрок').slice(0, 24); initHuman(c, true);
  addNewsEvent(`Игрок ${c._pname} принял управление страной ${c.name}`, 'diplomacy'); mapDirty = true;
  if (c.id === LOCAL && !suppressUI) { toast(`Вы управляете страной ${c.name}`, 'good'); setTimeout(() => { gotoCountry(c.id); A.hub('hq'); }, 100); }
};
CMDS.$leave = function () {
  const c = countryMap[ctxActor]; if (!c || !humans.has(c.id)) return;
  humans.delete(c.id); addNewsEvent(`Игрок ${c._pname || ''} покинул страну ${c.name} — управление перешло к ИИ`, 'diplomacy'); mapDirty = true;
};

// ---------- договоры, кредиты (игрок ↔ игрок и игрок ↔ ИИ) ----------
const TREATY_NAMES = { trade: 'Торговое соглашение', non_aggression: 'Пакт о ненападении', alliance: 'Военный союз', cultural_exchange: 'Культурный обмен', passage: 'Право прохода войск' };
function relSet(a, b, st, onlyIf) {
  [[a, b], [b, a]].forEach(([x, y]) => { const r = diplomaticRelations[x] && diplomaticRelations[x][y]; if (r && (!onlyIf || onlyIf.includes(r.status))) r.status = st; });
}
function treatyEffects(t) {
  const [a, b] = t.parties;
  if (t.type === 'alliance') relSet(a, b, 'allied', ['neutral', 'friendly', 'hostile', 'allied']);
  else relSet(a, b, 'friendly', ['neutral', 'hostile']);
  if (t.type === 'non_aggression') truces[a + b] = truces[b + a] = Math.max(truces[a + b] || 0, currentTurn + 365);
  if (t.type === 'trade') [a, b].forEach(x => { const e = countryMap[x].economy; if (e) e.gdp *= 1.002; });
  mapDirty = true;
}
function treatySign(t) {
  t.status = 'active'; treatyEffects(t);
  addNewsEvent(`${countryMap[t.parties[0]].name} и ${countryMap[t.parties[1]].name} подписали «${t.name}»`, 'diplomacy');
  t.parties.forEach(p => { if (p === LOCAL) toast(`📜 Подписано: «${t.name}»`, 'good'); });
}
function treatyRefuse(t) {
  t.status = 'rejected'; addNewsEvent(`${countryMap[t.parties[1]].name} отклонила «${t.name}» от ${countryMap[t.parties[0]].name}`, 'diplomacy');
  if (t.parties[0] === LOCAL) toast(`${countryMap[t.parties[1]].name} отклонила «${t.name}»`, 'warn');
}
function botAcceptChance(from, to, type) {
  const r = diplomaticRelations[to] && diplomaticRelations[to][from]; const st = r ? r.status : 'neutral'; const tr = r ? (r.trust || 50) : 50;
  let p = { allied: 0.9, friendly: 0.7, neutral: 0.4, hostile: 0.08, at_war: 0 }[st]; if (p === undefined) p = 0.3;
  p += (tr - 50) / 250; if (type === 'alliance') p -= 0.15; if (type === 'cultural_exchange') p += 0.1; return clamp(p, 0, 0.95);
}
function proposeTreaty(fromId, toId, tr) {
  tr.id = nextId('t'); tr.parties = [fromId, toId]; tr.startDate = new Date(simDate); tr.status = 'proposed'; tr.expire = currentTurn + 170; tr.createdBy = fromId; treaties.push(tr);
  addNewsEvent(`${countryMap[fromId].name} предлагает ${countryMap[toId].name} «${tr.name}»`, 'diplomacy');
  if (isHuman(toId)) {
    tr.human = true;
    runAs(toId, () => mkDoc(`Договор: «${tr.name}»`, `${countryMap[fromId].name} предлагает заключить «${tr.name}».${tr.content ? ' Текст: ' + tr.content : ''}`, countryMap[fromId].name, [['Подписать', () => { if (tr.status === 'proposed') treatySign(tr); }], ['Отклонить', () => { if (tr.status === 'proposed') treatyRefuse(tr); }]], 150, 1));
    if (fromId === LOCAL) toast(`📨 Предложение отправлено игроку: ${countryMap[toId].name}`, 'info');
  } else if (fromId === LOCAL) toast(`📨 Предложение отправлено: ${countryMap[toId].name} рассмотрит его в ближайшие дни`, 'info');
}
CMDS.treaty = function (to, type) {
  const c = me(); if (!c || !countryMap[to] || to === c.id || !TREATY_NAMES[type]) return;
  if (treaties.some(t => t.status === 'proposed' && t.parties[0] === c.id && t.parties[1] === to && t.type === type)) { if (c.id === LOCAL) toast('Такое предложение уже отправлено', 'warn'); return; }
  if (treaties.some(t => t.status === 'active' && t.type === type && t.parties.includes(c.id) && t.parties.includes(to))) { if (c.id === LOCAL) toast('Такой договор уже действует', 'warn'); return; }
  if (atWarWith(c.id, to)) { if (c.id === LOCAL) toast('С воюющей страной — только мирный договор', 'warn'); return; }
  proposeTreaty(c.id, to, { type, name: TREATY_NAMES[type] });
};
CMDS.customTreaty = function (to, name, text) {
  const c = me(); if (!c || !countryMap[to] || to === c.id) return; name = String(name || '').slice(0, 60).trim(); text = String(text || '').slice(0, 600);
  if (!name) return; proposeTreaty(c.id, to, { type: 'custom', name, content: text });
};
CMDS.cancelTreaty = function (id) {
  const t = treaties.find(x => x.id === id), c = me(); if (!t || !c || !t.parties.includes(c.id) || (t.status !== 'active' && t.status !== 'proposed')) return;
  t.status = 'cancelled'; const o = t.parties.find(p => p !== c.id); addNewsEvent(`${c.name} расторгла «${t.name}» с ${countryMap[o].name}`, 'diplomacy');
  if (t.type === 'alliance') relSet(c.id, o, 'friendly', ['allied']);
  if (c.id === LOCAL || o === LOCAL) toast(`«${t.name}» расторгнут`, 'warn');
};
CMDS.credit = function (lenderId, amount, rate, days) {
  const b = me(), l = countryMap[lenderId]; amount = clamp(+amount || 0, 1, 5000); rate = clamp(+rate || 0, 0, 40); days = clamp(Math.round(+days || 0), 10, 720);
  if (!b || !l || lenderId === b.id || !l.economy) return;
  const cr = { id: nextId('c'), lender: lenderId, borrower: b.id, amount, interestRate: rate, duration: days, startDate: new Date(simDate), endDate: new Date(simDate.getTime() + days * 86400000), status: 'proposed', remainingAmount: amount };
  credits.push(cr); addNewsEvent(`${b.name} просит у ${l.name} кредит $${amount.toFixed(1)}M`, 'economy');
  if (isHuman(lenderId)) {
    runAs(lenderId, () => mkDoc('Просьба о кредите', `${b.name} просит кредит $${amount.toFixed(1)}M под ${rate}% на ${days} дн.`, b.name, [['Выдать кредит', () => { if (cr.status === 'proposed') { if (l.economy.budget >= cr.amount) acceptCredit(cr.id); else { cr.status = 'rejected'; } } }], ['Отказать', () => { if (cr.status === 'proposed') rejectCredit(cr.id); }]], 150, 1));
    if (b.id === LOCAL) toast('📨 Запрос кредита отправлен игроку', 'info');
  } else cr.bot = true;
};
function botDecideCredit(cr) {
  const l = countryMap[cr.lender], b = countryMap[cr.borrower]; if (!l || !b) { cr.status = 'rejected'; return; }
  const r = diplomaticRelations[cr.lender] && diplomaticRelations[cr.lender][cr.borrower]; const st = r ? r.status : 'neutral';
  let p = { allied: 0.85, friendly: 0.6, neutral: 0.3, hostile: 0.03, at_war: 0 }[st] || 0.2; p += (cr.interestRate - 5) / 60; if (b.economy.debt > b.economy.gdp * 1.5) p -= 0.3;
  if (l.economy.budget < cr.amount * 1.5) p = 0;
  if (RNG() < clamp(p, 0, 0.9)) acceptCredit(cr.id); else rejectCredit(cr.id);
  if (cr.borrower === LOCAL) toast(cr.status === 'active' ? `💰 ${l.name} выдала кредит $${cr.amount.toFixed(1)}M` : `${l.name} отказала в кредите`, cr.status === 'active' ? 'good' : 'warn');
}
// ИИ: случайные дипломатические изменения и предложения договоров (замена randomAIActions/processTreatyProposals)
window.randomAIActions = function () {
  countries.forEach(c => {
    if (isHuman(c.id) || !c.army) return;
    c.militaryStock = (c.militaryStock || 0) + 3;
    if (c.army.divisions.filter(d => d.status === 'active').length < 10 && RNG() < 0.03) { const id = c.army.divisions.length + 1; c.army.divisions.push({ id, name: `${c.name} ${id}-я дивизия`, strength: 100, status: 'active', daysLeft: 0 }); }
  });
  countries.forEach(c => {
    if (isHuman(c.id) || RNG() >= 0.1) return;
    const t = countries[Math.floor(RNG() * countries.length)];
    if (t.id !== c.id && diplomaticRelations[c.id] && diplomaticRelations[c.id][t.id] && diplomaticRelations[c.id][t.id].status !== 'at_war') {
      const st = ['neutral', 'friendly', 'hostile'][Math.floor(RNG() * 3)]; if (diplomaticRelations[c.id][t.id].status !== 'allied') diplomaticRelations[c.id][t.id].status = st;
    }
  });
  if (RNG() < 0.15) {
    const p = countries[Math.floor(RNG() * countries.length)], t = countries[Math.floor(RNG() * countries.length)];
    if (p.id !== t.id && !isHuman(p.id) && !atWarWith(p.id, t.id) && (isHuman(t.id) || RNG() < 0.5)) {
      const type = ['trade', 'non_aggression', 'cultural_exchange'][Math.floor(RNG() * 3)];
      if (!treaties.some(x => (x.status === 'proposed' || x.status === 'active') && x.type === type && x.parties.includes(p.id) && x.parties.includes(t.id))) proposeTreaty(p.id, t.id, { type, name: TREATY_NAMES[type] });
    }
  }
};
window.processTreatyProposals = function () {
  treaties.forEach(t => {
    if (t.status !== 'proposed' || t.human) return;
    if (RNG() < 0.3) { if (RNG() < botAcceptChance(t.parties[0], t.parties[1], t.type)) treatySign(t); else treatyRefuse(t); }
  });
  credits.forEach(cr => { if (cr.status === 'proposed' && cr.bot) botDecideCredit(cr); });
  // документы-предложения, которые игрок не успел решить, закрываются документами по умолчанию (docDeadlines);
  // «зависшие» договоры без документа закрываем сами
  treaties.forEach(t => { if (t.status === 'proposed' && t.human && currentTurn > (t.expire || 1e9)) t.status = 'rejected'; });
  if (treaties.length > 400) treaties = treaties.filter(t => t.status === 'active' || t.status === 'proposed').concat(treaties.filter(t => t.status !== 'active' && t.status !== 'proposed').slice(-100));
  if (credits.length > 300) credits = credits.filter(c => c.status === 'active' || c.status === 'proposed').concat(credits.filter(c => c.status !== 'active' && c.status !== 'proposed').slice(-80));
};

// ---------- шаг симуляции ----------
function stateHash() {
  let h = 17; const mix = x => { h = (Math.imul(h, 31) + (Math.round(x * 100) | 0)) | 0; };
  mix(currentTurn); mix(rngState()); mix(idState()); mix(humans.size); mix(docs.length); mix(treaties.length); mix(credits.length); mix(activeWars.length);
  countries.forEach(c => { const e = c.economy || {}; mix(e.budget || 0); mix(e.gdp || 0); mix(e.manpower || 0); mix((c.army && c.army.divisions.length) || 0); });
  for (let i = 0; i < territoryOwner.length; i += 97) mix(territoryOwner[i]);
  for (let i = 0; i < warTroops.length; i += 193) mix(warTroops[i]);
  return h >>> 0;
}
let subLeft = 0, subTimer = 0;
function runSub() {
  if (subLeft <= 0) return; subLeft--;
  const pc = playerCountryId;
  try { playerCountryId = ''; ctxActor = ''; Date.now = detNow; ctxDepth++; try { processWars(true); } catch (e) { console.error('sub', e); } finally { ctxDepth--; } }
  finally { playerCountryId = pc; ctxActor = ''; Date.now = realNow; }
  if (!suppressUI) { mapDirty = true; try { refreshUnits(); if (subLeft % 6 === 0) updateWarOverlay(); } catch (e) { } }
}
function flushSubs() { clearInterval(subTimer); subTimer = 0; while (subLeft > 0) runSub(); }
function stepTick(n, cmds) {
  flushSubs();
  const pc = playerCountryId;
  try {
    cmds.forEach(c => { if (c.name === '$join' || c.name === '$leave' || isHuman(c.f)) { if (CMDS[c.name]) runAs(c.f, () => { try { CMDS[c.name].apply(null, c.args || []); } catch (e) { console.error('cmd', c.name, e); } }); } });
    playerCountryId = ''; ctxActor = ''; Date.now = detNow; ctxDepth++;
    try { simulateOneDay(); } catch (e) { console.error('tick', e); } finally { ctxDepth--; }
  } finally { playerCountryId = pc; ctxActor = ''; Date.now = realNow; }
  tickNo = n; dayCounter++;
  if (n % 30 === 0) NET.send({ t: 'hash', n, h: stateHash() });
  if (activeWars.length) { subLeft = WAR_SUB; if (remaining() <= 1 && !suppressUI) subTimer = setInterval(runSub, DAY_MS / (WAR_SUB + 1)); }
}
const realNow = Date.now.bind(Date);
let queue = [], replay = null, pumping = false, bootDone = false;
function remaining() { return (replay ? replay.end - replay.n + 1 : 0) + queue.length; }
function afterTickUI() {
  playerCountryId = LOCAL;
  dayStart = performance.now(); dayProgress = 0;
  try { refreshDateDisplays(); updatePlayerInfo(); if (mapDirty) { mapDirty = false; renderOffscreenMap(); } refreshUnits(); if (window.hubRefresh) hubRefresh(); chatPresence(); } catch (e) { console.error('ui', e); }
}
function pump() {
  if (pumping) return; pumping = true; replaying = false;
  const run = () => {
    const t0 = performance.now();
    while (remaining() > 0 && performance.now() - t0 < 14) {
      let n, cmds;
      if (replay && replay.n <= replay.end) { n = replay.n++; cmds = replay.log.get(n) || []; } else { const m = queue.shift(); n = m.n; cmds = m.cmds; if (n <= tickNo) continue; if (n !== tickNo + 1) { location.reload(); return; } }
      suppressUI = remaining() > 0;
      stepTick(n, cmds);
      if (!suppressUI) afterTickUI();
    }
    if (remaining() > 0) { suppressUI = true; syncOverlay(true, tickNo); setTimeout(run, 0); return; }
    pumping = false; replay = null; suppressUI = false; syncOverlay(false); finishCatchup();
  };
  run();
}
function finishCatchup() {
  playerCountryId = LOCAL; mapDirty = false; renderOffscreenMap(); refreshUnits(); refreshDateDisplays(); updatePlayerInfo(); renderCountryList(); startPanel(); if (window.hubRefresh) hubRefresh(); draw();
  if (!bootDone) { bootDone = true; if (!isHuman(LOCAL)) { LOCAL = ''; playerCountryId = ''; openLobby(); } else { gotoCountry(LOCAL); setTimeout(() => A.hub('hq'), 200); } }
  if (isHuman(LOCAL)) { const W = countryMap[LOCAL]; if (W && W._peace) showPeaceFor(W); if (W && W._defeated && window.showDefeat) showDefeat('Ваше государство разгромлено.'); }
}

// ---------- сеть ----------
const NET = {
  ws: null, tokenKey: 'europa_token', token: '',
  send(m) { if (SOLO) return Local.recv(m); if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); },
};
function getToken() {
  try { let t = localStorage.getItem(NET.tokenKey); if (!t) { t = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); localStorage.setItem(NET.tokenKey, t); } return t; } catch (e) { return window._tok || (window._tok = Math.random().toString(36).slice(2) + Date.now()); }
}
function getSavedName() { try { return localStorage.getItem('europa_name') || ''; } catch (e) { return ''; } }
function saveName(n) { try { localStorage.setItem('europa_name', n); } catch (e) { } }
let netDownTimer = null, everInit = false;
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`); NET.ws = ws; NET.token = getToken();
  ws.onopen = () => { if (everInit) { location.reload(); return; } netBanner(''); ws.send(JSON.stringify({ t: 'hello', token: NET.token, name: getSavedName() })); };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } onMsg(m); };
  ws.onclose = () => { if (everInit) netBanner('⚠ Соединение потеряно. Переподключаюсь…'); else netBanner('Подключение к серверу… (бесплатный сервер Render просыпается до минуты)'); setTimeout(connect, 2500); };
  ws.onerror = () => { };
}
function onMsg(m) {
  switch (m.t) {
    case 'init': initWorld(m); break;
    case 'tick': queue.push(m); if (netReady) pump(); break;
    case 'presence': PRES = m; humansOnline(); break;
    case 'chat': CHAT.push(m.msg); chatRender(true); break;
    case 'desync': desyncBanner(m); break;
    case 'error': toast(m.msg || 'Ошибка', 'bad'); if (m.fatal) netBanner('Ошибка: ' + m.msg); break;
    case 'joined': MYNAME = m.name; saveName(m.name); break;
  }
}
async function initWorld(m) {
  everInit = true; netBanner('');
  if (netReady) { location.reload(); return; }
  syncOverlay(true, 0, 'Загрузка мира…'); suppressUI = true; replaying = true;
  seedRNG(m.seed); difficulty = m.difficulty || 1; humans.clear(); PRES = m.presence || PRES; CHAT = m.chat || []; MYNAME = (m.you && m.you.name) || getSavedName();
  LOCAL = (m.you && m.you.country) || ''; playerCountryId = '';
  Date.now = realNow;
  await initGrid(); gameStarted = true;
  replay = { n: 1, end: m.tick, log: new Map((m.log || []).map(x => [x[0], x[1]])) };
  queue = queue.filter(q => q.n > m.tick);
  playerCountryId = LOCAL; netReady = true; replaying = false; $('loadingOverlay') && ($('loadingOverlay').style.display = 'none');
  requestAnimationFrame(frame);
  if (!isHuman(LOCAL) && LOCAL) { /* страна могла быть освобождена */ }
  pump();
}
// server tells us our country only via init; $join keeps LOCAL in sync when we joined in this session
const _join = CMDS.$join;
CMDS.$join = function (name) { _join(name); };
function joinGame(country, name) {
  if (!bootDone) { toast('Подождите, мир ещё синхронизируется…', 'warn'); return; }
  name = (name || '').trim().slice(0, 24); if (!name) { toast('Введите имя', 'warn'); return; } saveName(name); MYNAME = name;
  NET.send({ t: 'join', country, name });
}
function leaveGame() { NET.send({ t: 'leave' }); }
// ответ сервера на join: пришёл 'joined' и затем команда $join в тике; здесь запоминаем свою страну
const _onMsg = onMsg;
onMsg = function (m) { if (m.t === 'joined') { LOCAL = m.country; playerCountryId = LOCAL; } if (m.t === 'left') { LOCAL = ''; playerCountryId = ''; } _onMsg(m); };

// ---------- локальный режим (без сервера: file:// или ?solo=1) ----------
const Local = {
  tick: 0, log: [], pending: [], timer: null, seed: (Math.random() * 4294967295) >>> 0,
  start() {
    setTimeout(() => {
      onMsg({ t: 'init', seed: this.seed, difficulty: 1, tick: 0, log: [], you: { country: '', name: getSavedName() }, presence: { players: [], paused: false }, chat: [] });
      this.timer = setInterval(() => { this.tick++; const cmds = this.pending; this.pending = []; onMsg({ t: 'tick', n: this.tick, cmds }); }, DAY_MS);
    }, 50);
  },
  recv(m) {
    if (m.t === 'join') { if (!countryMap[m.country]) return; onMsg({ t: 'joined', country: m.country, name: m.name }); this.pending.push({ f: m.country, name: '$join', args: [m.name] }); }
    else if (m.t === 'leave') { this.pending.push({ f: LOCAL, name: '$leave', args: [] }); onMsg({ t: 'left' }); }
    else if (m.t === 'cmd') this.pending.push({ f: LOCAL, name: m.name, args: m.args });
    else if (m.t === 'chat') onMsg({ t: 'chat', msg: { id: Date.now(), from: LOCAL, name: MYNAME, scope: m.scope, to: m.to, text: m.text, ts: Date.now() } });
  }
};

// ---------- интерфейс: оверлеи ----------
function el(html, id) { let d = document.createElement('div'); d.id = id; d.innerHTML = html; document.body.appendChild(d); return d; }
const css = document.createElement('style'); css.textContent = `
#mpBanner{position:fixed;top:0;left:0;right:0;z-index:99999;background:#b91c1c;color:#fff;text-align:center;font:bold 12px Verdana;padding:5px;display:none}
#syncOv{position:fixed;inset:0;z-index:99998;background:rgba(15,23,42,.88);color:#fff;display:none;align-items:center;justify-content:center;flex-direction:column;font:bold 15px Verdana}
#lobby{position:fixed;inset:0;z-index:99997;background:rgba(15,23,42,.82);display:none;align-items:center;justify-content:center;font:12px Verdana}
#lobby .box{background:#e5e7eb;border:3px outset #fff;width:min(720px,94vw);max-height:92vh;overflow:auto;padding:12px}
#lobby input[type=text]{padding:4px;border:2px inset #999;font:12px Verdana}
#lobby .cl{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:3px;max-height:300px;overflow:auto;margin:6px 0}
#chatDock{position:fixed;left:6px;bottom:6px;z-index:9000;width:310px;font:11px Verdana;background:#e5e7eb;border:2px outset #fff}
#chatDock .hd{background:#1e3a8a;color:#fff;padding:3px 6px;cursor:pointer;font-weight:bold;display:flex;justify-content:space-between}
#chatLog{height:150px;overflow:auto;background:#fff;border:2px inset #999;margin:3px;padding:3px}
#chatLog .dm{color:#7c2d12}#chatLog .me{color:#065f46}
#defeat{position:fixed;inset:0;z-index:99996;background:rgba(127,29,29,.92);color:#fff;display:none;align-items:center;justify-content:center;flex-direction:column;font:bold 16px Verdana;text-align:center;padding:20px}
`; document.head.appendChild(css);
el('', 'mpBanner'); el('<div id="syncTxt">Синхронизация…</div><div id="syncSub" style="font-size:11px;margin-top:6px;font-weight:normal"></div>', 'syncOv');
el('', 'lobby'); el('<div id="defTxt"></div><br><button class="btn" id="defBtn" style="width:auto">ВЫБРАТЬ ДРУГУЮ СТРАНУ / НАБЛЮДАТЬ</button>', 'defeat');
function netBanner(t) { const b = $('mpBanner'); b.style.display = t ? 'block' : 'none'; b.innerText = t; }
function syncOverlay(on, n, txt) { const o = $('syncOv'); o.style.display = on ? 'flex' : 'none'; if (on) { $('syncTxt').innerText = txt || 'Синхронизация с миром…'; $('syncSub').innerText = n ? `день ${n}` : ''; } }
function desyncBanner(m) { const b = $('mpBanner'); b.style.display = 'block'; b.innerHTML = `⚠ Рассинхронизация (день ${m.n}). <a href="#" style="color:#fff" onclick="location.reload();return false">Пересинхронизироваться</a>`; }
window.showDefeat = function (txt) { if ($('defeat').style.display === 'flex') return; $('defTxt').innerText = '☠ ' + txt; $('defeat').style.display = 'flex'; };
$('defBtn').onclick = () => { $('defeat').style.display = 'none'; leaveGame(); LOCAL = ''; playerCountryId = ''; openLobby(); };

function humansOnline() { renderCountryList(); startPanel(); if (hubOpen && hubTab === 'dipl') hubRender(true); chatRender(); }
function playerOf(cid) { return (PRES.players || []).find(p => p.country === cid); }
function openLobby() {
  const L = $('lobby'); const cur = isHuman(LOCAL) ? countryMap[LOCAL] : null;
  const taken = new Map((PRES.players || []).map(p => [p.country, p]));
  const q = (L._q || '').toLowerCase();
  const list = countries.filter(c => !q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)).sort((a, b) => b.economy.gdp - a.economy.gdp).slice(0, 150);
  L.innerHTML = `<div class="box"><h3 style="margin:0 0 6px">EUROPA STRATEGY ONLINE — ${cur ? 'смена страны' : 'вход в игру'}</h3>
  Ваше имя: <input type="text" id="lbName" value="${(MYNAME || getSavedName()).replace(/"/g, '')}" maxlength="24"> &nbsp; Поиск: <input type="text" id="lbQ" value="${L._q || ''}" placeholder="страна…">
  <div style="margin:6px 0;font-size:11px">Игроков: ${(PRES.players || []).length}. Мир идёт, пока в нём есть хотя бы один игрок онлайн. Выбранные страны заняты другими игроками.</div>
  <div class="cl">${list.map(c => { const p = taken.get(c.id); return `<button class="btn small" ${p && p.country !== LOCAL ? 'disabled' : ''} onclick="lobbyPick('${c.id}')">${flagImg(c.id, 16)}${c.name}${p ? ` 🧑 ${p.name.replace(/</g, '')}` : ''}</button>`; }).join('')}</div>
  <button class="btn small" style="width:auto" onclick="lobbyClose()">${cur ? 'ЗАКРЫТЬ' : 'ПРОСТО НАБЛЮДАТЬ'}</button> ${cur ? '<button class="btn small red" style="width:auto" onclick="lobbyLeave()">ПОКИНУТЬ СТРАНУ (передать ИИ)</button>' : ''}</div>`;
  L.style.display = 'flex'; const qi = $('lbQ'); qi.oninput = () => { L._q = qi.value; const pos = qi.selectionStart; openLobby(); const n = $('lbQ'); n.focus(); n.setSelectionRange(pos, pos); };
}
window.lobbyClose = () => { $('lobby').style.display = 'none'; };
window.lobbyLeave = () => { leaveGame(); LOCAL = ''; playerCountryId = ''; lobbyClose(); };
window.lobbyPick = id => {
  const name = ($('lbName').value || '').trim(); if (!name) { toast('Введите имя', 'warn'); return; }
  if (isHuman(LOCAL) && id !== LOCAL) { leaveGame(); }
  if (id !== LOCAL || !isHuman(LOCAL)) joinGame(id, name); lobbyClose();
  setTimeout(() => { gotoCountry(id); }, 2500);
};

// ---------- панель игрока (вместо выбора страны) ----------
window.renderCountryList = (function (orig) {
  return function () {
    if (!visible()) return; const box = $('countryListContainer'); if (!box) return; box.innerHTML = '';
    const qq = (($('countrySearch') || {}).value || '').toLowerCase(); const taken = new Map((PRES.players || []).map(p => [p.country, p]));
    countries.filter(c => c.name.toLowerCase().includes(qq) || c.id.toLowerCase().includes(qq)).sort((a, b) => (taken.has(b.id) - taken.has(a.id)) || (b.id === LOCAL) - (a.id === LOCAL) || a.name.localeCompare(b.name)).slice(0, 80).forEach(c => {
      const p = taken.get(c.id); const b = document.createElement('button'); b.className = 'btn ' + (c.id === LOCAL ? 'green' : '');
      b.innerHTML = flagImg(c.id, 16) + c.name + (c.id === LOCAL ? ' (ВЫ)' : p ? ` 🧑${p.name.replace(/</g, '')}${p.online ? '' : ' 💤'}` : ''); b.onclick = () => { gotoCountry(c.id); }; box.appendChild(b);
    });
  };
})();
window.pickCountry = id => { gotoCountry(id); };
window.startPanel = function () {
  // Панель игрока — компактная строка в верхней панели карты (раньше была окном посреди карты)
  const sp = $('startPanel'); if (sp) sp.style.display = 'none';
  let bar = $('mpBar'); if (!bar) { const tb = document.querySelector('.map-toolbar'); if (!tb) return; bar = document.createElement('span'); bar.id = 'mpBar'; bar.style.cssText = 'margin-left:auto;display:inline-flex;gap:4px;align-items:center'; tb.appendChild(bar); }
  const pl = (PRES.players || []), human = isHuman(LOCAL);
  bar.innerHTML = `<span style="font-size:10px;color:#475569">👥 ${pl.filter(x => x.online).length}/${pl.length}${PRES.paused ? ' ⏸' : ''}</span>` +
    (human ? `<button class="btn small" style="width:auto;margin:0" onclick="openLobby()">СМЕНИТЬ СТРАНУ</button><button class="btn small" style="width:auto;margin:0" onclick="A.flagEditor()">ФЛАГ</button>`
      : `<button class="btn small green" style="width:auto;margin:0;font-weight:bold" onclick="openLobby()">▶ НАЧАТЬ ИГРУ</button>`) +
    `<button class="btn small" style="width:auto;margin:0" onclick="chatToggle()">ЧАТ</button>`;
};

// ---------- чат ----------
let chatOpen = false, chatTo = 'all', chatUnread = 0;
const chatDock = el('', 'chatDock');
function chatToggle(v) { chatOpen = v === undefined ? !chatOpen : v; if (chatOpen) chatUnread = 0; chatRender(); }
function chatPresence() { }
function chatRender(newMsg) {
  const d = $('chatDock'); const who = (PRES.players || []).filter(p => p.country !== LOCAL);
  if (newMsg && !chatOpen) chatUnread++;
  const mine = m => m.scope === 'all' || m.from === LOCAL || m.to === LOCAL;
  const chan = chatTo === 'all' ? CHAT.filter(m => m.scope === 'all') : CHAT.filter(m => m.scope === 'dm' && ((m.from === LOCAL && m.to === chatTo) || (m.from === chatTo && m.to === LOCAL)));
  const prev = $('chatLog'), atEnd = !prev || prev.scrollTop + prev.clientHeight >= prev.scrollHeight - 20; const inVal = $('chatIn') ? $('chatIn').value : '';
  d.innerHTML = `<div class="hd" onclick="chatToggle()"><span>💬 ЧАТ${chatUnread ? ` (${chatUnread})` : ''}</span><span>${chatOpen ? '▼' : '▲'}</span></div>` + (chatOpen ? `
  <div style="padding:3px"><select id="chatSel" onchange="chatTo=this.value;chatRender()" style="width:100%"><option value="all">Общий чат</option>${who.map(p => `<option value="${p.country}" ${chatTo === p.country ? 'selected' : ''}>✉ ${countryMap[p.country] ? countryMap[p.country].name : p.country} — ${p.name.replace(/</g, '')}${p.online ? '' : ' (не в сети)'}</option>`).join('')}</select></div>
  <div id="chatLog">${chan.slice(-120).map(m => `<div class="${m.scope === 'dm' ? 'dm' : ''} ${m.from === LOCAL ? 'me' : ''}"><b>${(m.name || '?').replace(/</g, '&lt;')}${m.from && countryMap[m.from] ? ' [' + m.from + ']' : ''}:</b> ${String(m.text).replace(/</g, '&lt;')}</div>`).join('') || '<i>Сообщений нет</i>'}</div>
  <div style="display:flex;gap:3px;padding:3px"><input id="chatIn" type="text" maxlength="300" style="flex:1;border:2px inset #999" placeholder="${isHuman(LOCAL) || true ? 'Сообщение…' : ''}"><button class="btn small" style="width:auto" onclick="chatSend()">▶</button></div>` : '');
  if (chatOpen) { const l = $('chatLog'); if (l && (atEnd || !newMsg)) l.scrollTop = l.scrollHeight; const i = $('chatIn'); if (i) { i.value = inVal; i.onkeydown = e => { if (e.key === 'Enter') chatSend(); }; } }
}
window.chatSend = () => { const i = $('chatIn'); const t = (i.value || '').trim(); if (!t) return; i.value = ''; NET.send({ t: 'chat', scope: chatTo === 'all' ? 'all' : 'dm', to: chatTo === 'all' ? '' : chatTo, text: t }); };
window.chatDm = id => { const p = playerOf(id); if (!p) { toast('Это страна ИИ: письменных ответов она не даёт — используйте договоры и предложения', 'info'); return; } chatTo = id; chatToggle(true); };
chatRender();

// ---------- вкладка «Дипломатия» ----------
let dipSel = '', dipQ = '';
A.dipSel = id => { dipSel = id; hubRender(); };
A.dipQ = v => { dipQ = v; hubRender(); };
A.trty = (id, type) => sendCmd('treaty', [id, type]);
A.crd = id => { const g = k => +document.getElementById(k).value; sendCmd('credit', [id, g('crAmt'), g('crRate'), g('crDays')]); };
A.cust = id => { const n = document.getElementById('ctName').value, t = document.getElementById('ctText').value; if (!n.trim()) return toast('Введите название договора', 'warn'); sendCmd('customTreaty', [id, n, t]); };
A.untreaty = id => sendCmd('cancelTreaty', [id]);
window.tDipl = function (c) {
  const taken = new Map((PRES.players || []).map(p => [p.country, p]));
  const st = id => getDiplomaticStatus(id), q = dipQ.toLowerCase();
  const all = countries.filter(o => o.id !== c.id && (!q || o.name.toLowerCase().includes(q) || o.id.toLowerCase().includes(q)));
  const rows = all.sort((a, b) => (taken.has(b.id) - taken.has(a.id)) || (c.neighbors.has(b.id) - c.neighbors.has(a.id)) || b.economy.gdp - a.economy.gdp).slice(0, 25).map(o => {
    const p = taken.get(o.id); return `<div class="row"><span>${flagImg(o.id, 16)}<b>${o.name}</b>${p ? ` 🧑 ${p.name.replace(/</g, '')}${p.online ? '' : ' 💤'}` : ''} · ${st(o.id)}${c.neighbors.has(o.id) ? ' · сосед' : ''}${o.economy.sanct ? ' · 🚫' : ''}</span><span>${btn('Действия', `A.dipSel('${o.id}')`, dipSel === o.id ? 'green' : '')}${p ? btn('✉', `chatDm('${o.id}')`) : ''}</span></div>`;
  }).join('');
  let sel = '';
  if (dipSel && countryMap[dipSel]) {
    const o = countryMap[dipSel], p = taken.get(o.id), warNow = atWarWith(c.id, o.id);
    sel = `<div class="cd"><h4>${flagImg(o.id, 22)} ${o.name}${p ? ` — игрок ${p.name.replace(/</g, '')}` : ' — ИИ'}</h4>
    <div>${p ? 'Предложения попадут в «Канцелярию» игрока, решает он.' : 'ИИ решит в течение нескольких дней по отношениям и доверию.'}</div>
    <div style="margin:5px 0"><b>Договоры:</b> ${Object.keys(TREATY_NAMES).map(k => btn(TREATY_NAMES[k], `A.trty('${o.id}','${k}')`)).join(' ')}</div>
    <div style="margin:5px 0"><b>Мир / граница:</b> ${btn(warNow ? 'Мирный договор' : 'Пересмотр границы', `A.deal('${o.id}')`, 'green')}
    ${btn('Помощь 5M', `A.aid('${o.id}')`)}${btn('Санкции', `A.sanction('${o.id}')`)}${btn('Разведка', `A.spy('${o.id}')`)}${btn('Диверсия', `A.sabotage('${o.id}')`, 'red')}</div>
    <div style="margin:5px 0"><b>Запросить кредит:</b> сумма <input id="crAmt" type="number" value="20" min="1" style="width:60px">M · ставка <input id="crRate" type="number" value="6" min="0" max="40" style="width:44px">% · дней <input id="crDays" type="number" value="120" min="10" max="720" style="width:54px"> ${btn('Запросить', `A.crd('${o.id}')`, 'green')}</div>
    <div style="margin:5px 0"><b>Свой договор:</b> <input id="ctName" type="text" placeholder="Название" style="width:150px"><br><textarea id="ctText" rows="2" style="width:98%" placeholder="Текст условий (свободная форма; исполнение — на доверии сторон)"></textarea>${btn('Предложить', `A.cust('${o.id}')`, 'green')}</div></div>`;
  }
  const mt = treaties.filter(t => t.parties.includes(c.id) && (t.status === 'active' || t.status === 'proposed')).slice(-15).reverse();
  const mc = credits.filter(x => (x.lender === c.id || x.borrower === c.id) && (x.status === 'active' || x.status === 'proposed')).slice(-10).reverse();
  const nm = id => countryMap[id] ? countryMap[id].name : id;
  return `<div class="cd"><h4>Страны</h4>Поиск: <input type="text" value="${dipQ.replace(/"/g, '')}" onchange="A.dipQ(this.value)" style="width:150px"> ${btn('Общий чат', 'chatToggle(true)')} ${btn('Новости', 'A.hubClose();openNewsModal()')} ${btn('Статистика стран', 'A.hubClose();openCountryInfoModal()')}${rows}</div>${sel}
  <div class="cd"><h4>Мои договоры</h4>${mt.map(t => `<div class="row"><span><b>${t.name}</b> · ${nm(t.parties[0])} ↔ ${nm(t.parties[1])} · ${t.status === 'active' ? '✅ действует' : '⏳ ожидает ответа'}${t.content ? `<br><i style="font-size:10px">${String(t.content).replace(/</g, '&lt;')}</i>` : ''}</span><span>${btn('Расторгнуть', `A.untreaty('${t.id}')`, 'red')}</span></div>`).join('') || '<i>Нет</i>'}</div>
  <div class="cd"><h4>Кредиты</h4>${mc.map(x => `<div class="row"><span>${nm(x.lender)} → ${nm(x.borrower)} · $${x.amount.toFixed(1)}M · ${x.interestRate}% · ${x.status === 'active' ? 'действует' : 'ожидает'}</span></div>`).join('') || '<i>Нет</i>'}</div>`;
};

// ---------- старт ----------
window.onload = () => {
  window.addEventListener('resize', resizeCanvas); resizeCanvas();
  const lo = $('loadingOverlay'); if (lo) lo.style.display = 'flex';
  if (SOLO) Local.start(); else connect();
};
