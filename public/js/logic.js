// ===== V3 LOGIC: government, economy, projects, military, research, documents, events, bot AI =====
const K_REV = 60;
let docs = [], docId = 1, projects = [], projId = 1, genId = 1, armyId = 1;
const MARKET = { food: { n: 'Продовольствие', base: 0.02, p: 0.02 }, steel: { n: 'Сталь', base: 0.05, p: 0.05 }, oil: { n: 'Нефть', base: 0.04, p: 0.04 } };
const LAWS = {
  conscr: { n: 'Закон о призыве', o: [['Добровольная армия', 'Мало людей, высокий моральный дух', 0.6], ['Ограниченный призыв', 'Баланс', 1], ['Расширенный призыв', 'Больше людей, недовольство', 1.5], ['Всеобщая мобилизация', 'Максимум людей, стабильность падает', 2.2]] },
  econ: { n: 'Экономический закон', o: [['Свободный рынок', 'Рост +, заводы -', 0], ['Смешанная экономика', 'Баланс', 1], ['Плановая экономика', 'Заводы +15%, рост -', 2], ['Военная экономика', 'Заводы +30%, потребление -, рост --', 3]] },
  trade: { n: 'Торговый закон', o: [['Открытая торговля', 'Низкая наценка рынка 5%', 0.05], ['Умеренная', 'Наценка 10%', 0.1], ['Протекционизм', 'Наценка 20%, местная сталь +', 0.2], ['Автаркия', 'Наценка 35%, ресурсы +', 0.35]] },
  press: { n: 'Закон о прессе', o: [['Свобода слова', 'Наука +, стабильность -', 0], ['Умеренная цензура', 'Баланс', 1], ['Жёсткая цензура', 'Стабильность +, наука -', 2]] }
};
const MINISTRIES = { fin: ['Министр финансов', 'Сбор налогов +1.5%/ур.'], def: ['Министр обороны', 'Обучение дивизий быстрее'], ind: ['Министр промышленности', 'Заводы и стройки быстрее'], sci: ['Министр науки', 'Исследования быстрее'], int: ['Министр внутренних дел', 'Стабильность +'], for: ['Министр иностранных дел', 'Повод к войне готовится быстрее'] };
const DECREES = [
  ['mob', 'Частичная мобилизация', 'Людские ресурсы +20% от лимита, стабильность -5', 40, 0, 60, c => { c.economy.manpower = Math.min(c.economy.manpowerCap, c.economy.manpower + c.economy.manpowerCap * .2); c.gov.stability -= 5; }],
  ['prop', 'Пропагандистская кампания', 'Одобрение +10, расход 3M', 25, 3, 30, c => { c.gov.approval += 10; }],
  ['stim', 'Стимулирование экономики', 'Рост +1.5% на 30 дней, расход 8M', 50, 8, 45, c => addMod(c, 'Стимулирование', 30, { growth: 1.5 })],
  ['aust', 'Режим жёсткой экономии', 'Расходы -15% на 30 дней, одобрение -6', 40, 0, 60, c => { addMod(c, 'Жёсткая экономия', 30, { spend: -0.15 }); c.gov.approval -= 6; }],
  ['mart', 'Военное положение', 'Стабильность +15, одобрение -10, 30 дн.', 60, 0, 90, c => { addMod(c, 'Военное положение', 30, { stab: 0.5, appr: -0.3, mil: 0.05 }); c.gov.stability += 15; c.gov.approval -= 10; }],
  ['amn', 'Амнистия', 'Одобрение +6, стабильность -3', 20, 0, 40, c => { c.gov.approval += 6; c.gov.stability -= 3; }],
  ['corr', 'Борьба с коррупцией', 'Сбор налогов +8% на 60 дней', 60, 2, 90, c => addMod(c, 'Антикоррупция', 60, { coll: 0.08 })],
  ['parade', 'Военный парад', 'Опыт дивизий +5, влияние +3, расход 3M', 30, 3, 40, c => { c.mil.divs && 0; c.army.divisions.forEach(d => d.xp = (d.xp || 0) + 5); c.influence = Math.min(100, c.influence + 3); }],
  ['border', 'Укрепление границ', 'Оборона +8% на 40 дней, расход 4M', 35, 4, 60, c => addMod(c, 'Укрепление границ', 40, { def: 0.08 })],
  ['hol', 'Национальный праздник', 'Одобрение +4, расход 2M', 15, 2, 30, c => { c.gov.approval += 4; }]
];
const TECH = [
  ['inf1', 'Стрелковое оружие обр.2', 12, 3, null, { att: .05, def: .05 }], ['inf2', 'Автоматическое оружие', 18, 5, 'inf1', { att: .06, def: .06 }],
  ['art1', 'Полевая артиллерия', 12, 3, null, { att: .07 }], ['art2', 'Тяжёлая артиллерия', 18, 5, 'art1', { att: .08 }],
  ['arm1', 'Лёгкие танки', 14, 4, null, { att: .06 }], ['arm2', 'Средние танки', 20, 6, 'arm1', { att: .09 }],
  ['eng1', 'Фортификация', 12, 3, null, { def: .08 }], ['eng2', 'Глубокоэшелонированная оборона', 18, 5, 'eng1', { def: .1 }],
  ['log1', 'Мотострелковые перевозки', 12, 3, null, { att: .03, def: .03, ind: .03 }], ['ind1', 'Конвейерное производство', 14, 4, null, { ind: .1 }], ['ind2', 'Станкостроение', 20, 6, 'ind1', { ind: .12 }],
  ['sci1', 'Научные школы', 12, 3, null, { sci: .15 }], ['eco1', 'Финансовая реформа', 14, 4, null, { gr: .5 }], ['eco2', 'Индустриализация', 20, 6, 'eco1', { gr: .8 }]
];
const BAT = { inf: ['Пехота', 6, 8, 1000, 0.25, 'rifles', 8], art: ['Артиллерия', 12, 4, 600, 0.45, 'guns', 6], tank: ['Танки', 16, 8, 600, 0.8, 'tanks', 5], rec: ['Разведка', 2, 2, 200, 0.15, 'rifles', 2], eng: ['Инженеры', 2, 6, 500, 0.2, 'rifles', 4] };
const BT = {
  factory: { n: 'Завод', cost: 6, steel: 60, d: [3, 4, 10], eff: 'Больше производства (гражд./воен.)' }, housing: { n: 'Жилой район', cost: 3, steel: 30, d: [2, 3, 6], eff: 'Прирост людей +' },
  power: { n: 'Электростанция', cost: 8, steel: 80, d: [3, 4, 12], eff: 'Заводы +8% выпуска' }, steelmill: { n: 'Сталелитейный комбинат', cost: 8, steel: 40, d: [3, 4, 10], eff: 'Сталь +3/день' },
  refinery: { n: 'НПЗ', cost: 8, steel: 60, d: [3, 4, 10], eff: 'Нефть +3/день' }, port: { n: 'Порт', cost: 9, steel: 80, d: [3, 5, 12], eff: 'Рынок: наценка -2%' },
  airfield: { n: 'Аэродром', cost: 7, steel: 50, d: [3, 4, 9], eff: 'Боевая мощь +1.5%' }, university: { n: 'Университет', cost: 10, steel: 50, d: [4, 5, 14], eff: 'Науч. скорость +, слот исследования' },
  hospital: { n: 'Больница', cost: 5, steel: 30, d: [2, 3, 7], eff: 'Одобрение +1, прирост людей' }, railway: { n: 'Железная дорога', cost: 7, steel: 90, d: [3, 5, 12], eff: 'Стройки быстрее +4%' },
  supply: { n: 'Центр снабжения (карта)', cost: 4, steel: 30, d: [2, 3, 6], map: 1, eff: 'Подкрепление x1.4 рядом' }, defense: { n: 'Оборонительный штаб (карта)', cost: 5, steel: 40, d: [2, 3, 7], map: 1, eff: 'Оборона x2 рядом' },
  military: { n: 'Военный узел (карта)', cost: 7, steel: 60, d: [3, 4, 8], map: 1, eff: 'Точка выхода войск на фронт' }
};
const CONTR = { gov: ['Госстройтрест', 1, 1], priv: ['Частная компания', 1.15, 0.8], for: ['Иностранный подрядчик', 1.3, 0.65] };
const INV = { bonds: ['Гособлигации', 8, 14, .04, .08, .03], infra: ['Инфраструктура', 14, 24, .1, .18, .1], tech: ['Технологии', 20, 34, .18, .4, .2], startup: ['Стартапы', 10, 26, .1, .7, .35], foreign: ['Иностранные активы', 14, 28, .08, .3, .15] };
const SURN = ['Кох', 'Браун', 'Вебер', 'Зиммер', 'Лоренц', 'Ренн', 'Иванов', 'Морель', 'Росси', 'Новак', 'Кларк', 'Свенсон', 'Ортега', 'Тоцци', 'Вагнер', 'Мюллер'], NAMES = ['Ганс', 'Пётр', 'Жан', 'Марко', 'Ян', 'Ульрих', 'Эрик', 'Карл', 'Лука', 'Томаш'];
const personName = () => pick(NAMES) + ' ' + pick(SURN);

function addMod(c, name, days, fx) { c.gov.mods.push({ name, until: currentTurn + days, fx }); }
function modSum(c, k) { return c.gov.mods.reduce((s, m) => s + (m.fx[k] || 0), 0); }
function me() { return countryMap[playerCountryId]; }
function minSkill(c, k) { let m = c.gov.min[k]; return m ? m.skill : 0; }
function costMult(c) { return (1 + (c.economy.inflation || 0) / 100) * getCostMultiplier(c.id); }
function techFx(c, k) { let s = 0; TECH.forEach(t => { if (c.mil.done[t[0]]) s += t[5][k] || 0; }); return s; }
// ---- цены: дивизии и здания дорожают с каждой уже имеющейся единицей, дивизии требуют много людей ----
const DIV_COST_K = 4, DIV_MP_K = 3.5, BLD_COST_K = 1.6;
function divCost(c, s) { return s.cost * DIV_COST_K * costMult(c) * (1 + Math.min(2.5, (c.army ? c.army.divisions.length : 0) * 0.07)); }
function divMp(c, s) { return Math.round(s.mp * DIV_MP_K * (1 + Math.min(1.5, (c.army ? c.army.divisions.length : 0) * 0.03))); }
function bldCost(c, type, contrMult) { return BT[type].cost * BLD_COST_K * (contrMult || 1) * costMult(c) * (1 + bcount(c, type) * 0.12); }
function bcount(c, t) { return c.bld[t] || 0; }
function tplStats(t) {
  let s = { atk: 0, def: 0, mp: 0, cost: 0, rifles: 0, guns: 0, tanks: 0, n: 0 };
  Object.keys(BAT).forEach(k => { let n = t.b[k] || 0, b = BAT[k]; s.atk += n * b[1]; s.def += n * b[2]; s.mp += n * b[3]; s.cost += n * b[4]; s[b[5]] += n * b[6]; s.n += n; });
  s.q = (s.atk + s.def) / 124; s.days = 5 + Math.ceil(s.n / 2); return s;
}

// ---------- инициализация ----------
function initExt(c) {
  let e = c.economy; if (!e) return;
  e.taxes = { inc: 20, corp: 20, vat: 20 }; e.lvl = { def: 50, edu: 50, hlth: 50, infra: 50, sci: 50, soc: 50 }; e.inflation = 2; e.rate = 5;
  e.res = { food: 300, steel: 120, oil: 100 }; e.bonds = []; e.inv = [];
  e.manpowerGrowth = Math.round(e.population * 20); e.manpowerCap = Math.round(e.population * 30000); e.manpower = Math.round(e.manpowerCap * 0.35);
  c.gov = { approval: 55 + rnd(-8, 8), stability: 60, pp: 50, laws: { conscr: 1, econ: 1, press: 1, trade: 1 }, min: {}, mods: [], cd: {}, cb: {} };
  c.mil = { tpl: [{ name: 'Стандартная пехотная', b: { inf: 6, art: 2, eng: 1 } }, { name: 'Бронетанковая', b: { inf: 3, tank: 3, art: 2, rec: 1 } }], done: {}, cur: [], gens: [], armies: [], equip: { rifles: 0, guns: 0, tanks: 0 }, lines: { rifles: 50, guns: 30, tanks: 20 }, q: rnd(.92, 1.12), botTech: 0, pool: [], mpool: {}, mix: { inf: .55 + rnd(-.1, .1), art: .15, tank: .08 + rnd(0, .1), rec: .07, eng: .1 } };
  c.bld = {}; c.mil.cand = null; c.ships = { total: 0, busy: 0, q: [] };
  if (countryLeaders[c.id]) { countryLeaders[c.id].name = personName(); countryLeaders[c.id].ideology = pick(['демократия', 'республика', 'монархия', 'коммунизм', 'автократия']); }
}
function genPool(c) { c.mil.pool = []; for (let i = 0; i < 3; i++) c.mil.pool.push({ id: genId++, name: personName(), atk: rint(1, 5), def: rint(1, 5), log: rint(1, 5), cost: 2 }); }
function minPool(c, k) { c.mil.mpool[k] = []; for (let i = 0; i < 3; i++) c.mil.mpool[k].push({ name: personName(), skill: rint(1, 5), sal: 0 }); }
function initHuman(c, late) {
  let e = c.economy; e.gdp = Math.max(e.gdp, 30);
  const mkDiv = i => ({ id: i, name: `${c.name} ${i}-я дивизия`, tpl: 'Стандартная пехотная', max: 100, strength: 100, xp: 0, status: 'active', daysLeft: 0, army: 0, gen: 0 });
  if (!late) {
    e.budget = 70; e.manpower = Math.round(e.manpowerCap * 0.4); c.army.divisions = [mkDiv(1), mkDiv(2)];
    c.factoryCount = 2; c.housingCount = 1;
  } else {
    // игрок занимает страну посреди партии: сохраняем то, что у страны уже есть
    e.budget = Math.max(e.budget, 50); e.manpower = Math.max(e.manpower, Math.round(e.manpowerCap * 0.25));
    c.army.divisions.forEach(d => { d.tpl = d.tpl || 'Стандартная пехотная'; d.max = d.max || 100; d.xp = d.xp || 0; d.army = 0; d.gen = 0; });
    if (!c.army.divisions.length) c.army.divisions = [mkDiv(1), mkDiv(2)];
    c.factoryCount = Math.max(c.factoryCount || 0, 2); c.housingCount = Math.max(c.housingCount || 0, 1);
  }
  c.mil.equip = { rifles: 60, guns: 20, tanks: 0 }; c._joinTurn = currentTurn; c._defeated = false;
  if (!validHubs(c.id).length) { let cap = capitalOf(c); if (cap) buildings.push({ id: buildingIdCounter++, type: 'military', x: cap.x, y: cap.y, ownerId: c.id, civRatio: .5, status: 'active', daysLeft: 0 }); }
  c.autoSend = true; genPool(c); Object.keys(MINISTRIES).forEach(k => minPool(c, k));
  c.gov.min.fin = { name: personName(), skill: 2 }; c.gov.min.def = { name: personName(), skill: 2 };
  mkDoc('Приказ №1 о вступлении в должность', `Правительство страны «${c.name}» приступает к работе. Время идёт непрерывно: 1 день = 2 секунды. Изучите разделы «Правительство», «Экономика», «Строительство» и «Армия» в Штабе.`, 'Канцелярия', [['К исполнению', () => { }]], 60);
}

// ---------- документы ----------
function mkDoc(title, body, from, opts, dl = 10, defIdx = -1) {
  let d = { id: docId++, owner: playerCountryId, no: `${playerCountryId || 'XXX'}-${simDate.getFullYear()}/${String(docId).padStart(4, '0')}`, title, body, from, date: new Date(simDate), opts, deadline: currentTurn + dl, def: defIdx, status: 'pending' };
  docs.unshift(d); toast(`📄 Новый документ: ${title}`, 'doc'); return d;
}
A.docDo = function (id, i) {
  let d = docs.find(x => x.id === id); if (!d || d.status !== 'pending' || d.owner !== playerCountryId || !d.opts[i]) return; d.status = 'done'; d.result = d.opts[i][0].replace(/\s*\([^)]*\)/g, ''); d.opts[i][1](); updatePlayerInfo(); if (window.hubRender) hubRender();
};
function docDeadlines() { docs.forEach(d => { if (d.owner !== playerCountryId || d.status !== 'pending' || currentTurn <= d.deadline) return; d.status = 'expired'; d.result = 'Срок истёк'; if (d.def >= 0) { d.opts[d.def][1](); d.result = 'Срок истёк: ' + d.opts[d.def][0].replace(/\s*\([^)]*\)/g, ''); } else { let c = me(); if (c) c.gov.approval -= 1; } }); }

// ---------- боевой множитель ----------
window.getCombatMult = function (cid, eid, role) {
  let k = cid + eid + role; if (cmCache[k] !== undefined) return cmCache[k];
  let c = countryMap[cid], m;
  if (!c || !c.mil) m = 1;
  else if (!isHuman(cid)) m = (0.9 + c.mil.q * 0.1 + c.mil.botTech * 0.03) * (1 + (difficulty - 1) * 0.35);
  else {
    let ag = armyAgg(c); m = 1 + techFx(c, role === 'att' ? 'att' : 'def') + (role === 'def' ? modSum(c, 'def') : 0) + modSum(c, 'mil') + (c.gov.stability - 50) / 500 + ag.gen * 0.03 + ag.xp * 0.001 + Math.min(0.1, bcount(c, 'airfield') * 0.015) + (role === 'att' ? ag.att : ag.def) + (c.economy.lvl.def - 50) / 500;
    if (c.economy.res.oil <= 0) m -= 0.15;
    let nw = activeWarsOf(c.id); if (nw > 1) m *= Math.max(0.5, 1 - 0.07 * (nw - 1)); m -= Math.min(0.2, (c.gov.weary || 0) / 400);
  }
  m *= matchupFactor(cid, eid);
  return cmCache[k] = Math.max(0.25, m);
};
const E_ = { inf: { inf: 1, art: 2, tank: .25, rec: 2, eng: 1 }, art: { inf: .5, art: 1, tank: 1.25, rec: 1, eng: 2 }, tank: { inf: 3, art: .8, tank: 1, rec: 3, eng: 1.5 }, rec: { inf: .5, art: 1, tank: .3, rec: 1, eng: .5 }, eng: { inf: 1, art: 1, tank: .5, rec: 2, eng: 1 } };
const TN = { inf: 'пехота', art: 'артиллерия', tank: 'танки', rec: 'разведка', eng: 'инженеры' };
function mixOf(cid) {
  let c = countryMap[cid], mix = {}, tot = 0; if (!c) return { inf: 1 };
  if (isHuman(cid)) {
    let ds = c.army.divisions.filter(d => d.status === 'front'); if (!ds.length) ds = c.army.divisions.filter(d => d.status === 'active');
    ds.forEach(d => { let tp = c.mil.tpl.find(x => x.name === d.tpl) || c.mil.tpl[0]; Object.keys(tp.b).forEach(k => { let w = tp.b[k] * d.strength; mix[k] = (mix[k] || 0) + w; tot += w; }); });
  } else { mix = Object.assign({}, c.mil.mix || { inf: .7, art: .15, eng: .15 }); mix.tank = (mix.tank || 0) + c.mil.botTech * 0.012; Object.keys(mix).forEach(k => tot += mix[k]); }
  if (!tot) return { inf: 1 }; Object.keys(mix).forEach(k => mix[k] /= tot); return mix;
}
function mixPower(a, b) { let s = 0; for (let i in a) for (let j in b) s += a[i] * b[j] * E_[i][j]; return s; }
function matchupFactor(cid, eid) { if (!eid || !countryMap[eid]) return 1; let a = mixOf(cid), b = mixOf(eid); return clamp(Math.sqrt(mixPower(a, b) / Math.max(.05, mixPower(b, a))), .5, 2); }
function armyAgg(c) {
  let ds = c.army.divisions.filter(d => d.status === 'active' || d.status === 'front'), tot = 0, att = 0, def = 0, gen = 0, xp = 0;
  ds.forEach(d => {
    let w = d.strength, a = c.mil.armies.find(x => x.id === d.army), g = c.mil.gens.find(x => x.id === (a ? a.gen : d.gen)); tot += w;
    let st = a ? a.stance : 1; att += w * (st === 2 ? .15 : st === 0 ? -.08 : 0); def += w * (st === 0 ? .15 : st === 2 ? -.08 : 0); gen += w * (g ? (g.atk + g.def + g.log) / 3 : 0); xp += w * (d.xp || 0);
  });
  if (!tot) return { att: 0, def: 0, gen: 0, xp: 0 }; return { att: att / tot, def: def / tot, gen: gen / tot, xp: xp / tot };
}
window.computeTotalWarPower = function (cid) {
  let c = countryMap[cid]; if (!c) return 0;
  if (isHuman(cid)) { if (!validHubs(cid).length) return 0; return validHubs(cid).length * 1.5 + (c._milToday || 0) * 0.15; }
  let dp = Math.min(400, c.army.divisions.filter(d => d.status === 'active').reduce((s, d) => s + d.strength, 0)), st = (c.militaryStock || 0) * 0.3; c.militaryStock -= st;
  let age = 0; activeWars.forEach(w => { if (w.a === cid || w.b === cid) age = Math.max(age, currentTurn - (w.t0 || currentTurn)); });
  return (dp * 0.03 + 1.5 + st * 0.15) * difficulty * (1 + Math.min(0.5, age / 200));
};

// ---------- экономика ----------
function econDay(c) {
  let e = c.economy, me_ = isHuman(c.id), g = c.gov;
  let eff = me_ ? e.taxes.inc * .45 + e.taxes.corp * .3 + e.taxes.vat * .25 : 20; e.taxRate = eff;
  let coll = 1 + (me_ ? minSkill(c, 'fin') * .015 + modSum(c, 'coll') : 0);
  let rev = e.gdp * K_REV * (eff / 100) / 365 * coll, repar = 0;
  if (e.reparations && countryMap[e.reparations.to]) { repar = rev * e.reparations.percent; countryMap[e.reparations.to].economy.budget += repar; }
  rev -= repar; e.income = rev;
  let atWar = activeWars.filter(w => w.a === c.id || w.b === c.id).length, divs = c.army ? c.army.divisions.filter(d => d.status === 'active').length : 0;
  let upkeep = (atWar * 0.12 + divs * 0.07 * (1 + divs * 0.02)) * costMult(c), exp;
  if (me_) {
    let L = e.lvl, sp = (L.def * .14 + L.edu * .08 + L.hlth * .08 + L.infra * .08 + L.sci * .04 + L.soc * .10) / 50 * rev;
    sp *= 1 + modSum(c, 'spend'); let sal = Object.values(g.min).length * 0.02, coupons = 0;
    e.bonds.forEach(b => coupons += b.amt * b.rate / 100 / 60);
    exp = sp + sal + coupons + upkeep + e.debt * 0.0004 + (c._projSpend || 0) * 0; e.bondCoupons = coupons;
  } else exp = rev * 0.8 + upkeep * 0.3 + e.debt * 0.0004;
  e.expenses = exp; e.budget += rev - exp;
  if (e.budget < 0) { e.debt -= e.budget; e.budget = 0; }
  if (e.debt > 0 && e.budget > e.debt * 0.1) { let p = Math.min(e.budget * 0.5, e.debt * 0.05); e.debt -= p; e.budget -= p; }
  // рост
  let gr = e.growth * 0.3 + 1.2;
  if (me_) {
    gr += techFx(c, 'gr') + modSum(c, 'growth') + (e.lvl.infra - 50) / 40 + (e.lvl.edu - 50) / 80 - Math.max(0, eff - 22) * 0.12 - Math.max(0, (e.inflation || 0) - 4) * 0.2 - (e.rate - 5) * 0.08;
    gr += [0.4, 0, -0.3, -0.7][g.laws.econ] || 0;
  }
  Object.values(diplomaticRelations[c.id] || {}).forEach(r => { if (r.status === 'allied' || r.status === 'friendly') gr += 0.04; else if (r.status === 'at_war') gr -= 0.15; });
  if (e.sanct) gr -= 0.5 * e.sanct;
  gr = clamp(gr, -10, 12); c.economy.curGrowth = gr; e.gdp *= 1 + gr / 100 / 120; e.population *= 1 + (me_ ? (e.lvl.hlth - 40) / 20 : 0.5) / 100 / 365 * 3;
  let dd = e.debt / Math.max(1, e.gdp * 10); e.creditRating = dd < .3 ? 'AAA' : dd < .5 ? 'AA' : dd < .7 ? 'A' : dd < .9 ? 'BBB' : dd < 1.2 ? 'BB' : 'CCC';
  // люди
  let mult = me_ ? LAWS.conscr.o[g.laws.conscr][2] : 1;
  e.manpowerGrowth = Math.round(e.population * 20 * mult * (1 + bcount(c, 'housing') * .03 + (c.housingCount || 0) * .04 + bcount(c, 'hospital') * .03)); e.manpowerCap = Math.round(e.population * 30000 * mult);
  e.manpower = Math.min(e.manpowerCap, e.manpower + e.manpowerGrowth);
  // заводы
  c.factoryCount = c.factoryCount || 0;
  let ind = 1 + (me_ ? techFx(c, 'ind') + bcount(c, 'power') * .08 + minSkill(c, 'ind') * .03 + [0, 0, .15, .3][g.laws.econ] : 0);
  let out = (5.5 + c.factoryCount * 8) * ind * (me_ ? clamp(1 - modSum(c, 'strike'), .3, 1) : 1), civ = out * c.factoryCivRatio, mil = out - civ;
  e.budget += civ * 0.08; e.income += civ * 0.08;   // доход от гражданских заводов тоже виден в «Доход/день»
  if (me_) {
    c._milToday = mil; let L = c.mil.lines, tot = L.rifles + L.guns + L.tanks || 1, q = c.mil.equip;
    if (e.res.steel > 0) { e.res.steel -= mil * 0.1; q.rifles += mil * L.rifles / tot * 3; q.guns += mil * L.guns / tot * 1.2; q.tanks += mil * L.tanks / tot * 0.6; }
    else e.res.steel = 0;
  } else { c.militaryStock = (c.militaryStock || 0) + mil * 0.5; }
  if (me_) resDay(c);
  // политика
  if (me_) govDay(c); else { c.gov.approval = clamp(c.gov.approval, 20, 90); }
  c.influence = clamp(c.influence + (gr > 3 ? 0.02 : gr < 0 ? -0.02 : 0), 0, 100); if (!me_ && c.influence < 30) c.influence += .05;
}
function resDay(c) {
  let e = c.economy, r = e.res, g = c.gov, aut = g.laws.trade === 3 ? 1.25 : g.laws.trade === 2 ? 1.1 : 1;
  r.food += e.population * 0.4 * (c._agri = c._agri || rnd(.85, 1.15)) * aut * (1 + modSum(c, 'food')) - e.population * 0.4;
  r.steel += (3 + bcount(c, 'steelmill') * 3 + e.gdp * 0.03) * aut - c.factoryCount * 0.1;
  r.oil += (3 + bcount(c, 'refinery') * 3) * aut - (c.army.divisions.filter(d => d.status === 'active').length * 0.15 + c.factoryCount * 0.1);
  if (r.food < 0) { r.food = 0; g.approval -= 0.4; if (currentTurn % 7 === 0) toast('⚠ Нехватка продовольствия! Закупите на рынке', 'warn'); }
  if (r.oil < 0) { r.oil = 0; if (currentTurn % 7 === 0) toast('⚠ Нет нефти: армия теряет боеспособность', 'warn'); }
  if (r.steel < 0) r.steel = 0;
  Object.keys(MARKET).forEach(k => { let m = MARKET[k]; m.p = clamp(m.p * (1 + rnd(-.025, .025) + (m.base - m.p) / m.base * .03), m.base * .5, m.base * 2.5); });
}
function govDay(c) {
  let g = c.gov, e = c.economy; g.pp = Math.min(400, g.pp + 1.2 + (g.stability > 60 ? .3 : 0) + minSkill(c, 'for') * .1);
  g.mods = g.mods.filter(m => m.until > currentTurn);
  let ta = 58 - Math.max(0, e.taxRate - 22) * 1.3 - Math.max(0, e.inflation - 4) * 1.5 + (e.lvl.soc - 50) * .25 + (e.lvl.hlth - 50) * .12 + (e.curGrowth || 0) * 1.5 + bcount(c, 'hospital') + modSum(c, 'appr') * 20 - activeWars.filter(w => w.a === c.id || w.b === c.id).length * 4 - (LAWS.conscr.o[g.laws.conscr][2] - 1) * 6;
  let nwars = activeWarsOf(c.id); g.weary = clamp((g.weary || 0) + (nwars ? 0.12 * nwars : -0.4), 0, 100); ta -= g.weary * 0.25;
  g.approval += (ta - g.approval) * 0.03;
  let ts = 52 + (g.approval - 50) * .4 + minSkill(c, 'int') * 3 + (g.laws.press === 2 ? 8 : g.laws.press === 0 ? -4 : 0) + modSum(c, 'stab') * 10 - (g.laws.conscr === 3 ? 10 : 0);
  ts -= (g.weary || 0) * 0.2; g.stability += (ts - g.stability) * 0.04; g.approval = clamp(g.approval, 0, 100); g.stability = clamp(g.stability, 0, 100);
  e.inflation = clamp(e.inflation + (0.02 - (e.rate - 5) * 0.012) + (c._printed || 0), 0, 60); e.inflation -= Math.max(0, e.inflation - 2) * 0.01; c._printed = 0;
  Object.keys(c.gov.cd).forEach(k => { if (c.gov.cd[k] <= currentTurn) delete c.gov.cd[k]; });
  if (g.stability < 10 && currentTurn % 15 === 0 && !g.crisis) { g.crisis = 1; mkDoc('Правительственный кризис', 'Массовые беспорядки. Требуются срочные меры.', 'Служба безопасности', [['Подавить силой (стабильность +10, одобрение -10)', () => { g.stability += 10; g.approval -= 10; g.crisis = 0; }], ['Объявить реформы (расход 6M, стабильность +20)', () => { e.budget -= 6; g.stability += 20; g.crisis = 0; }]], 6, 0); }
  if (c.army.divisions.length) c.army.divisions.forEach(d => { if (d.status === 'active' && d.strength < d.max && e.res.oil > 0) d.strength = Math.min(d.max, d.strength + 0.15); if (d.status === 'active') d.xp = Math.min(100, (d.xp || 0) + 0.02); if (d.status === 'front') { d.xp = Math.min(100, (d.xp || 0) + 0.15); d.strength = Math.max(20, d.strength - 0.25); if (!activeWars.some(w => w.id === d.warId)) { d.status = 'active'; } } });
}
window.updateCountryEconomics = function () {
  countries.forEach(c => {
    if (!c.economy) return; econDay(c);
    buildings.filter(b => b.ownerId === c.id && b.status === 'building').forEach(b => { b.daysLeft--; if (b.daysLeft <= 0) b.status = 'active'; });
    if (c.army) c.army.divisions.forEach(d => { if (d.status === 'training') { d.daysLeft--; if (d.daysLeft <= 0) { d.status = 'active'; d.returning = 0; if (c.id === LOCAL) { toast(`🎖 «${d.name}» завершила формирование`, 'good'); addNewsEvent(`Дивизия "${d.name}" готова к бою`, 'war'); } } } });
  });
  processWars(); processConvoys(); humans.forEach(h => runAs(h, invDay));
};

// ---------- проекты строительства ----------
const STAGES = ['Проектирование', 'Разрешение (документ)', 'Закупка материалов', 'Строительство', 'Приёмка (документ)'];
A.newProject = function (type, contr, site) {
  let c = me(), t = BT[type], k = CONTR[contr];
  if (projects.filter(p => !p.done).length >= 8) { toast('Не более 8 проектов одновременно', 'warn'); return; }
  let cost = +bldCost(c, type, k[1]).toFixed(2);
  let p = { id: projId++, type, name: t.n, contr, cost, stage: 0, left: t.d[0] * k[2], steelNeed: t.steel, steelGot: 0, paused: false, site: site || null, prio: 1, done: false, note: 'Идёт проектирование' };
  projects.push(p); addNewsEvent(`Заложен проект «${t.n}»`, 'economy'); toast(`🏗 Проект «${t.n}» запущен (смета ${fM(cost)})`, 'good'); if (window.hubRender) hubRender();
};
function projSpeed(c) { return clamp(1 + (c.economy.lvl.infra - 50) / 200 + bcount(c, 'railway') * .04 + minSkill(c, 'ind') * .03, .5, 2); }
function payProj(c, p, amt) { if (c.economy.budget < amt) { p.note = 'Нет средств!'; return false; } c.economy.budget -= amt; return true; }
function projectsDay() {
  let c = me(); if (!c || !isHuman(c.id)) return; let sp = projSpeed(c), t;
  projects.filter(p => !p.done).sort((a, b) => b.prio - a.prio).forEach(p => {
    t = BT[p.type]; if (p.paused) { p.note = 'Приостановлен'; return; }
    if (p.stage === 0) { if (!payProj(c, p, p.cost * 0.05 / Math.max(1, t.d[0]))) return; p.left -= sp; p.note = 'Проектные работы'; if (p.left <= 0) { p.stage = 1; p.note = 'Ожидает подписи'; permitDoc(p); } }
    else if (p.stage === 2) {
      let per = p.steelNeed / t.d[1], take = Math.min(per, c.economy.res.steel, p.steelNeed - p.steelGot);
      if (take < per * 0.999 && p.steelNeed - p.steelGot > take) { p.note = 'Не хватает стали'; if (take <= 0) return; }
      if (!payProj(c, p, p.cost * 0.35 / t.d[1] * (take / per))) return; c.economy.res.steel -= take; p.steelGot += take; p.note = `Материалы ${Math.round(p.steelGot)}/${p.steelNeed}`;
      if (p.steelGot >= p.steelNeed - 0.01) { p.stage = 3; p.left = t.d[2] * CONTR[p.contr][2]; }
    }
    else if (p.stage === 3) {
      if (!payProj(c, p, p.cost * 0.6 / (t.d[2] * CONTR[p.contr][2]) * sp)) return; p.left -= sp; p.note = 'Идёт стройка';
      if (RNG() < 0.015) { p.paused = true; incident(p); }
      if (p.left <= 0) { p.stage = 4; p.note = 'Ожидает приёмки'; acceptDoc(p); }
    }
  });
}
function permitDoc(p) {
  mkDoc(`Разрешение на строительство: ${p.name}`, `Канцелярия подготовила пакет документов на «${p.name}» (смета ${fM(p.cost)}, подрядчик: ${CONTR[p.contr][0]}${p.site ? ', участок [' + Math.round(p.site.x) + ',' + Math.round(p.site.y) + ']' : ''}). Экологическая и земельная экспертиза завершены.`, 'Министерство строительства',
    [['Подписать разрешение', () => { p.stage = 2; p.note = 'Закупка материалов'; }], ['Вернуть на доработку (+3 дн.)', () => { p.stage = 0; p.left = 3; }], ['Отклонить проект (возврат 30% затрат)', () => { p.done = true; p.note = 'Отменён'; me().economy.budget += p.cost * 0.05 * 0.3; }]], 12, 0);
}
function acceptDoc(p) {
  mkDoc(`Акт приёмки: ${p.name}`, `Комиссия завершила осмотр объекта «${p.name}». Замечаний: ${rint(0, 3)}.`, 'Госинспекция',
    [['Подписать акт и ввести в эксплуатацию', () => finishProject(p)], ['Потребовать устранить замечания (расход 3% сметы, +2 дн.)', () => { me().economy.budget -= p.cost * 0.03; p.stage = 3; p.left = 2; p.note = 'Доработка'; }]], 12, 0);
}
function finishProject(p) {
  let c = me(); p.done = true; p.note = 'Готово'; c.bld[p.type] = (c.bld[p.type] || 0) + 1;
  if (p.type === 'factory') c.factoryCount++; else if (p.type === 'housing') c.housingCount++;
  else if (BT[p.type].map && p.site) buildings.push({ id: buildingIdCounter++, type: p.type, x: p.site.x, y: p.site.y, ownerId: c.id, civRatio: .5, status: 'active', daysLeft: 0 });
  toast(`✅ Объект «${p.name}» введён в эксплуатацию`, 'good'); addNewsEvent(`Введён в эксплуатацию: ${p.name}`, 'economy'); c.gov.approval += 0.5;
  { let pt = p.site || capitalOf(c); if (pt) mark(pt.x, pt.y, '🏗', `Введён в эксплуатацию: ${p.name}`, 'good'); }
}
function incident(p) {
  { let cp = capitalOf(me()), pt = p.site || cp; if (pt) mark(pt.x, pt.y, '⚠', `Происшествие на объекте «${p.name}»`, 'warn'); }
  mkDoc(`Происшествие на объекте «${p.name}»`, pick(['Забастовка рабочих требует повышения оплаты.', 'Обнаружены дефекты фундамента.', 'Поставщик сорвал сроки доставки.', 'Проверка выявила нарушения техники безопасности.']), 'Прораб',
    [['Оплатить устранение (8% сметы)', () => { me().economy.budget -= p.cost * .08; p.paused = false; }], ['Принять задержку (+4 дн.)', () => { p.left += 4; p.paused = false; }]], 6, 1);
}
window.tryPlaceBuilding = function (type, wPos, targetC) {
  if (!BT[type] || !BT[type].map) return;
  if (!targetC || targetC.id !== playerCountryId) { toast('Строить можно только на своей территории', 'warn'); return; }
  if (type === 'port' && !isCoast(wPos.x, wPos.y)) { toast('Порт строится только на побережье', 'warn'); return; }
  if (getBuildingsNear(type, playerCountryId, wPos.x, wPos.y, BUILD_CLUSTER_RADIUS).length >= BUILD_CLUSTER_HARD_CAP) { toast('Слишком плотная застройка', 'warn'); return; }
  if (territoryOwner[Math.floor(wPos.y) * OFF_W + Math.floor(wPos.x)] !== targetC.numericId) { toast('Выберите клетку на своей территории', 'warn'); return; }
  A.newProject(type, window._pendContr || 'gov', { x: Math.floor(wPos.x), y: Math.floor(wPos.y) }); setTool('inspect'); A.hub('build');
};

// ---------- армия ----------
A.orderDiv = function (ti, n) {
  let c = me(), t = c.mil.tpl[ti]; if (!t) return; let s = tplStats(t), cm = costMult(c);
  for (let i = 0; i < n; i++) {
    let cost = +divCost(c, s).toFixed(2), mpNeed = divMp(c, s), q = c.mil.equip;
    if (c.economy.budget < cost) return toast('Не хватает денег', 'warn'); if (c.economy.manpower < mpNeed) return toast(`Не хватает людей: нужно ${mpNeed.toLocaleString('ru-RU')}`, 'warn');
    if (q.rifles < s.rifles || q.guns < s.guns || q.tanks < s.tanks) return toast(`Не хватает вооружения: нужно ${s.rifles} ружей, ${s.guns} орудий, ${s.tanks} танков`, 'warn');
    c.economy.budget -= cost; c.economy.manpower -= mpNeed; q.rifles -= s.rifles; q.guns -= s.guns; q.tanks -= s.tanks;
    let days = Math.max(2, Math.round(s.days * (1 - minSkill(c, 'def') * .04))); let nid = c.army.divisions.reduce((m, d) => Math.max(m, d.id), 0) + 1;
    c.army.divisions.push({ id: nid, name: `${nid}-я ${t.name.split(' ')[0].toLowerCase()} дивизия`, tpl: t.name, max: Math.round(100 * s.q), strength: Math.round(100 * s.q), xp: 0, status: 'training', daysLeft: days, army: 0, gen: 0 });
  }
  toast('Формирование начато', 'good'); hubRender();
};
A.saveTpl = function (name, b) {
  let c = me(), d = { name: String(name || '').slice(0, 40), b: b || {} }; Object.keys(d.b).forEach(k => { d.b[k] = clamp(Math.floor(+d.b[k] || 0), 0, 14); }); if (!d.name.trim()) return toast('Введите название шаблона', 'warn'); if (tplStats(d).n < 1 || tplStats(d).n > 14) return toast('Шаблон: 1-14 батальонов', 'warn');
  c.mil.tpl.push({ name: d.name, b: Object.assign({}, d.b) }); toast('Шаблон сохранён', 'good'); hubRender();
};
A.reinf = function (di) { let c = me(), d = c.army.divisions.find(x => x.id === di); if (!d) return; let need = d.max - d.strength, cost = need * 0.03 * costMult(c), mp = need * 150; if (need < 1) return; if (c.economy.budget < cost || c.economy.manpower < mp) return toast('Не хватает денег или людей', 'warn'); c.economy.budget -= cost; c.economy.manpower -= mp; d.strength = d.max; hubRender(); };
A.disband = function (di) { let c = me(); let d = c.army.divisions.find(x => x.id === di); if (!d) return; c.economy.manpower += d.strength * 40; c.army.divisions = c.army.divisions.filter(x => x.id !== di); hubRender(); };
A.hireGen = function (id) { let c = me(), g = c.mil.pool.find(x => x.id === id); if (!g || c.gov.pp < 25) return toast('Нужно 25 политвл.', 'warn'); c.gov.pp -= 25; c.mil.gens.push(g); c.mil.pool = c.mil.pool.filter(x => x.id !== id); hubRender(); };
A.newArmy = function () { let c = me(); c.mil.armies.push({ id: armyId++, name: `${c.mil.armies.length + 1}-я армия`, stance: 1, gen: 0 }); hubRender(); };
A.setStance = function (id, s) { me().mil.armies.find(a => a.id === id).stance = s; hubRender(); };
A.armyGen = function (id, g) { me().mil.armies.find(a => a.id === id).gen = +g; hubRender(); };
A.divArmy = function (di, a) { me().army.divisions.find(d => d.id === di).army = +a; hubRender(); };
A.setLine = function (k, v) { me().mil.lines[k] = +v; };
A.setCiv = function (v) { me().factoryCivRatio = v / 100; hubRender(); };
A.research = function (id) {
  let c = me(), t = TECH.find(x => x[0] === id), slots = 1 + Math.min(2, Math.floor(bcount(c, 'university') / 2));
  if (c.mil.done[id] || c.mil.cur.find(x => x.id === id)) return; if (t[4] && !c.mil.done[t[4]]) return toast('Сначала изучите предшествующую технологию', 'warn');
  if (c.mil.cur.length >= slots) return toast('Нет свободных слотов исследований (стройте университеты)', 'warn'); if (c.economy.budget < t[3]) return toast('Не хватает денег', 'warn');
  c.economy.budget -= t[3]; c.mil.cur.push({ id, left: t[2] }); hubRender();
};
function researchDay() {
  let c = me(); let sp = 1 + techFx(c, 'sci') + minSkill(c, 'sci') * .06 + bcount(c, 'university') * .05 + (c.economy.lvl.sci - 50) / 150 + (c.gov.laws.press === 0 ? .1 : c.gov.laws.press === 2 ? -.1 : 0);
  c.mil.cur.forEach(r => r.left -= sp); c.mil.cur = c.mil.cur.filter(r => { if (r.left <= 0) { c.mil.done[r.id] = 1; let t = TECH.find(x => x[0] === r.id); toast(`🔬 Исследование завершено: ${t[1]}`, 'good'); addNewsEvent(`Завершено исследование: ${t[1]}`, 'economy'); return false; } return true; });
}
A.reinfWar = function (wid, p) { sendDivisions(wid, p); };
function bestAttackCell(war, cid) {
  let A_ = countryMap[cid], B_ = countryMap[war.a === cid ? war.b : war.a]; if (!A_ || !B_) return null; const T = territoryOwner, an = A_.numericId, bn = B_.numericId, { minX, minY, maxX, maxY } = war.bbox; let best = null, bv = 1e9;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) { let gi = y * OFF_W + x; if (T[gi] !== an) continue; let m = 1e9;
    if (T[gi - 1] === bn) m = Math.min(m, warTroops[gi - 1]); if (T[gi + 1] === bn) m = Math.min(m, warTroops[gi + 1]); if (T[gi - OFF_W] === bn) m = Math.min(m, warTroops[gi - OFF_W]); if (T[gi + OFF_W] === bn) m = Math.min(m, warTroops[gi + OFF_W]);
    if (m === 1e9) continue; let v = m - 0.5 * warTroops[gi]; if (v < bv) { bv = v; best = { x, y }; } }
  return best;
}
function sendDivisions(wid, pct, quiet) {
  let c = me(), w = activeWars.find(x => x.id === wid); if (!w) return 0;
  let target = bestAttackCell(w, c.id) || findWeakestFrontCellForSide(w, c.id); if (!target) { if (!quiet) toast('На фронте нет доступных секторов', 'warn'); return 0; }
  let hp = getHubPosition(c.id, target.x, target.y); if (!hp) { if (!quiet) toast('Нет военного узла на вашей территории — войска некуда стягивать. Постройте узел.', 'warn'); return 0; }
  let free = c.army.divisions.filter(d => d.status === 'active'); if (!free.length) { if (!quiet) toast('Нет свободных дивизий', 'warn'); return 0; }
  let n = Math.max(1, Math.ceil(free.length * pct / 100)), side = w.a === c.id ? 'a' : 'b', sent = 0;
  free.sort((a, b) => b.strength - a.strength).slice(0, n).forEach(d => { if (spawnConvoy(c.id, target.x, target.y, d.strength, side, w.id, d.id)) { d.status = 'marching'; d.warId = w.id; sent++; } });
  if (!sent && !quiet) toast('Нет сухопутного пути от узла к фронту по вашей территории — линия оборвана', 'warn');
  if (sent && !quiet) { let cv = convoys[convoys.length - 1]; toast(`🚚 Отправлено дивизий: ${sent}. Дорога до фронта ~${Math.ceil(cv.path.length / cv.speed)} дн.`, 'good'); }
  hubRender(); return sent;
}
A.recall = function (di) { let d = me().army.divisions.find(x => x.id === di); if (!d || d.status !== 'front') return; d.status = 'training'; d.daysLeft = 5; d.returning = 1; toast('Дивизия отозвана с фронта (5 дн. на возвращение)', 'info'); hubRender(); };
A.autoSend = function () { me().autoSend = !me().autoSend; hubRender(); };
function autoSendDivs() {
  let c = me(); if (!c.autoSend || currentTurn % 3) return;
  activeWars.filter(w => w.a === c.id || w.b === c.id).forEach(w => sendDivisions(w.id, 1, true));
}
A.ceasefire = function (wid) {
  let w = activeWars.find(x => x.id === wid); if (!w) return; let me_ = playerCountryId; if (w.a !== me_ && w.b !== me_) return;
  let en = w.a === me_ ? w.b : w.a, ec = countryMap[en], loss = (w.stats[en] || 0);
  if (isHuman(en)) {
    runAs(en, () => mkDoc(`Предложение перемирия от ${countryMap[me_].name}`, `${countryMap[me_].name} предлагает прекратить боевые действия и вернуться к переговорам.`, 'МИД',
      [['Принять перемирие', () => { if (activeWars.includes(w)) { endWarPeace(w); toast(`🕊 Перемирие с ${countryMap[me_].name} заключено`, 'good'); } }], ['Отклонить', () => { }]], 8, 1));
    toast(`Предложение перемирия отправлено игроку ${ec.name}`, 'info'); return;
  }
  let ok = RNG() < (loss < 400 ? 0.6 : 0.25) + (ec.gov.approval < 40 ? 0.2 : 0);
  if (ok) { endWarPeace(w); toast(`🕊 ${ec.name} согласилась на перемирие`, 'good'); } else toast(`${ec.name} отклонила предложение о перемирии`, 'warn'); hubRender();
};
function endWarPeace(w) { activeWars = activeWars.filter(x => x !== w); truces[w.a + w.b] = truces[w.b + w.a] = currentTurn + 40; [[w.a, w.b], [w.b, w.a]].forEach(([x, y]) => { if (diplomaticRelations[x] && diplomaticRelations[x][y]) diplomaticRelations[x][y].status = 'hostile'; }); mapDirty = true; updateWarOverlay(); }
A.cb = function (id) { let c = me(); if (c.gov.pp < 15) return toast('Нужно 15 политвл.', 'warn'); c.gov.pp -= 15; c.gov.cb[id] = { left: Math.max(2, Math.round(6 - minSkill(c, 'for') * .5)), ready: false }; toast('Подготовка повода к войне начата', 'good'); hubRender(); };
A.warDoc = function (id) {
  let c = me(), t = countryMap[id], cb = c.gov.cb[id] && c.gov.cb[id].ready;
  if ((truces[c.id + id] || 0) > currentTurn) return toast('Действует перемирие', 'warn');
  mkDoc(`Декларация о войне против ${t.name}`, cb ? 'Повод к войне подготовлен и обнародован. Международное сообщество отнесётся с пониманием.' : 'ВНИМАНИЕ: повод к войне не подготовлен. Нападение вызовет осуждение: стабильность -10, влияние -10, одобрение -8.', 'Генеральный штаб',
    [['Подписать и объявить войну', () => { if (!cb) { c.gov.stability -= 10; c.influence = Math.max(0, c.influence - 10); c.gov.approval -= 8; } declareWar(id); mapDirty = true; hubRender(); }], ['Отложить', () => { }]], 5, 1);
  A.hub('docs');
};

// ---------- инвестиции и облигации ----------
A.invest = function (kind, amt, target) {
  let c = me(), t = INV[kind]; if (c.economy.budget < amt) return toast('Не хватает денег', 'warn');
  let risk = t[5] + (kind === 'foreign' && target && getDiplomaticStatus(target) === 'hostile' ? .25 : 0);
  mkDoc(`Инвестиционный меморандум: ${t[0]}${target ? ' → ' + countryMap[target].name : ''}`, `Сумма: ${fM(amt)}. Горизонт: ${t[1]}-${t[2]} дн. Ожидаемая доходность: ${Math.round(t[3] * 100)}-${Math.round(t[4] * 100)}%. Риск провала: ${Math.round(risk * 100)}%.`, 'Минфин',
    [['Утвердить инвестицию', () => { if (c.economy.budget < amt) return toast('Средств уже не хватает', 'warn'); c.economy.budget -= amt; c.economy.inv.push({ id: docId++, kind, name: t[0], target, amt, due: currentTurn + rint(t[1], t[2]), ret: rnd(t[3], t[4]), risk, st: 'active' }); if (target) { countryMap[target].economy.gdp += amt * 0.002; } }], ['Отклонить', () => { }]], 8, 1); A.hub('docs');
};
function invDay() {
  let c = me(); if (!c || !isHuman(c.id)) return; c.economy.inv.forEach(i => {
    if (i.st !== 'active' || currentTurn < i.due) return;
    if (RNG() < i.risk) { i.st = 'failed'; let s = i.amt * rnd(.1, .4); c.economy.budget += s; toast(`📉 Инвестиция «${i.name}» провалилась, возвращено ${fM(s)}`, 'bad'); }
    else { i.st = 'paid'; let p = i.amt * (1 + i.ret); c.economy.budget += p; toast(`📈 Инвестиция «${i.name}»: +${fM(p - i.amt)}`, 'good'); }
  });
  c.economy.bonds.forEach(b => { if (currentTurn >= b.due) { b.done = 1; c.economy.budget -= b.amt; c.economy.debt -= b.amt; toast(`Облигации погашены: ${fM(b.amt)}`, 'info'); if (c.economy.budget < 0) { c.economy.debt -= c.economy.budget; c.economy.budget = 0; } } });
  c.economy.bonds = c.economy.bonds.filter(b => !b.done);
}
A.issueBond = function (amt, days) {
  let c = me(), e = c.economy, rate = +(4 + e.rate * .6 + ({ AAA: 0, AA: 1, A: 2, BBB: 4, BB: 7, CCC: 12 }[e.creditRating])).toFixed(1);
  mkDoc('Постановление о выпуске облигаций', `Номинал ${fM(amt)}, срок ${days} дн., купон ${rate}% годовых. Цена размещения 97%.`, 'Минфин', [['Подписать', () => { e.budget += amt * .97; e.debt += amt; e.bonds.push({ amt, rate, due: currentTurn + days }); }], ['Отклонить', () => { }]], 8, 1); A.hub('docs');
};
A.printMoney = function () { let c = me(); c.economy.budget += 5; c._printed = .6; c.gov.approval -= .5; toast('Напечатано 5M. Инфляция растёт!', 'warn'); updatePlayerInfo(); hubRender(); };
A.trade = function (k, n, buy) {
  let c = me(), r = c.economy.res, m = MARKET[k], sp = LAWS.trade.o[c.gov.laws.trade][2] - bcount(c, 'port') * .02; sp = Math.max(0.01, sp);
  if (buy) { let cost = n * m.p * (1 + sp) * costMult(c); if (c.economy.budget < cost) return toast('Не хватает денег', 'warn'); c.economy.budget -= cost; r[k] += n; }
  else { if (r[k] < n) return toast('Нет столько на складе', 'warn'); r[k] -= n; c.economy.budget += n * m.p * (1 - sp); } hubRender(); updatePlayerInfo();
};
A.setLvl = function (k, v) { me().economy.lvl[k] = +v; }; A.setTax = function (k, v) { me().economy.taxes[k] = +v; }; A.setRate = function (v) { me().economy.rate = +v; };
A.law = function (k, i) {
  let c = me(), g = c.gov; if (g.laws[k] === i) return; if (g.pp < 50) return toast('Нужно 50 политвл.', 'warn'); if (g.cd['law' + k]) return toast('Закон недавно менялся', 'warn');
  mkDoc(`Законопроект: ${LAWS[k].n} → «${LAWS[k].o[i][0]}»`, 'Законопроект внесён на подпись.', 'Парламент / Совет министров', [['Подписать закон (50 политвл.)', () => { if (g.pp < 50) return; g.pp -= 50; g.laws[k] = i; g.cd['law' + k] = currentTurn + 30; g.stability -= 2; hubRender(); }], ['Отклонить', () => { }]], 10, 1); A.hub('docs');
};
A.decree = function (id) {
  let c = me(), d = DECREES.find(x => x[0] === id); if (c.gov.cd[id]) return; if (c.gov.pp < d[3]) return toast(`Нужно ${d[3]} политвл.`, 'warn'); if (c.economy.budget < d[4]) return toast('Не хватает денег', 'warn');
  c.gov.pp -= d[3]; c.economy.budget -= d[4]; c.gov.cd[id] = currentTurn + d[5]; d[6](c); toast(`📜 Указ: ${d[1]}`, 'doc'); addNewsEvent(`Указ: ${d[1]}`, 'economy'); updatePlayerInfo(); hubRender();
};
A.hire = function (k, i) { let c = me(), m = c.mil.mpool[k][i]; if (c.gov.pp < 25) return toast('Нужно 25 политвл.', 'warn'); c.gov.pp -= 25; c.gov.min[k] = { name: m.name, skill: m.skill }; hubRender(); };
A.fire = function (k) { delete me().gov.min[k]; minPool(me(), k); hubRender(); };
A.sanction = function (id) { let c = countryMap[id]; c.economy.sanct = (c.economy.sanct || 0) ? 0 : 1; if (diplomaticRelations[id] && diplomaticRelations[id][playerCountryId]) diplomaticRelations[id][playerCountryId].trust = 20; toast(c.economy.sanct ? `Санкции против ${c.name}` : 'Санкции сняты', 'info'); hubRender(); };
A.aid = function (id) { let c = me(); if (c.economy.budget < 5) return toast('Нужно 5M', 'warn'); c.economy.budget -= 5; let r = diplomaticRelations[id][playerCountryId]; if (r) r.trust = Math.min(100, r.trust + 15); countryMap[id].economy.budget += 5; if (getDiplomaticStatus(id) === 'hostile') setDiplomaticStatus(id, 'neutral'); toast(`Помощь ${countryMap[id].name}: доверие растёт`, 'good'); hubRender(); };
A.spy = function (id) { let c = me(), cost = 3; if (c.economy.budget < cost || c.gov.pp < 20) return toast('Нужно 3M и 20 политвл.', 'warn'); c.economy.budget -= cost; c.gov.pp -= 20; let ok = RNG() < .5 + minSkill(c, 'int') * .05, t = countryMap[id]; c._intel = c._intel || {};
  if (ok) { c._intel[id] = currentTurn + 60; toast(`🕵 Агентура в ${t.name} раскрыла данные об армии`, 'good'); } else { toast('Агенты провалены, скандал!', 'bad'); c.gov.approval -= 2; if (diplomaticRelations[id][playerCountryId]) diplomaticRelations[id][playerCountryId].trust -= 15; } hubRender(); };
A.sabotage = function (id) { let c = me(), t = countryMap[id]; if (c.economy.budget < 6 || c.gov.pp < 40) return toast('Нужно 6M и 40 политвл.', 'warn'); c.economy.budget -= 6; c.gov.pp -= 40;
  if (RNG() < .4 + minSkill(c, 'int') * .05) { t.factoryCount = Math.max(0, (t.factoryCount || 0) - 1); t.militaryStock = (t.militaryStock || 0) * .5; toast(`💥 Диверсия на заводах ${t.name} удалась`, 'good'); } else { toast('Диверсанты схвачены. Международный скандал!', 'bad'); if (diplomaticRelations[id][playerCountryId]) { diplomaticRelations[id][playerCountryId].trust -= 25; setDiplomaticStatus(id, 'hostile'); } } hubRender(); };

// ---------- события, боты ----------
const EVENTS = [
  c => mkDoc('Забастовка на заводах', 'Профсоюзы требуют повышения зарплат и сокращения рабочего дня.', 'Профсоюзы', [['Переговоры (расход 3M)', () => { c.economy.budget -= 3; c.gov.approval += 2; }], ['Разогнать (стабильность -6, одобрение -4)', () => { c.gov.stability -= 6; c.gov.approval -= 4; }], ['Игнорировать (выпуск -25% на 10 дн.)', () => addMod(c, 'Забастовка', 10, { strike: .25 })]], 8, 2),
  c => mkDoc('Неурожай', 'Засуха сократила сбор зерна. Цены на продовольствие растут.', 'Минсельхоз', [['Закупить 150 ед. продовольствия', () => { let cost = 150 * MARKET.food.p * 1.6; c.economy.budget -= cost; c.economy.res.food += 150; }], ['Ввести карточки (одобрение -4, +100 ед.)', () => { c.gov.approval -= 4; c.economy.res.food += 100; }]], 8, 1),
  c => mkDoc('Предложение иностранного кредита', 'Иностранный банк предлагает 20M под 6% на 60 дней.', 'Центробанк', [['Принять', () => { c.economy.budget += 20; c.economy.debt += 20; c.economy.bonds.push({ amt: 20, rate: 6, due: currentTurn + 60 }); }], ['Отказаться', () => { }]], 10, 1),
  c => { let n = pick([...c.neighbors || []]); if (!n) return; mkDoc(`Пограничный инцидент с ${countryMap[n].name}`, 'Пограничный патруль обстрелян. Общественность требует ответа.', 'МИД', [['Резкая нота протеста', () => { c.gov.approval += 2; if (diplomaticRelations[c.id][n]) diplomaticRelations[c.id][n].trust -= 10; }], ['Замять (одобрение -2)', () => { c.gov.approval -= 2; }], ['Демарш: усиление границы (3M, оборона +)', () => { c.economy.budget -= 3; addMod(c, 'Усиление границы', 30, { def: .05 }); }]], 8, 1); },
  c => mkDoc('Научный прорыв', 'Инженеры предлагают ускорить исследования за дополнительное финансирование.', 'Академия наук', [['Выделить 4M (текущие исследования -5 дн.)', () => { c.economy.budget -= 4; c.mil.cur.forEach(r => r.left -= 5); }], ['Отказать', () => { }]], 8, 1),
  c => mkDoc('Коррупционный скандал', 'Журналисты раскрыли хищения в министерстве.', 'Пресс-служба', [['Уволить виновных (одобрение +2, PP -10)', () => { c.gov.approval += 2; c.gov.pp -= 10; }], ['Замять (одобрение -6)', () => { c.gov.approval -= 6; }]], 8, 1),
  c => mkDoc('Авария на промышленном объекте', 'Взрыв на складе. Есть пострадавшие.', 'МЧС', [['Выплатить компенсации (4M)', () => { c.economy.budget -= 4; c.gov.approval += 1; }], ['Расследование без выплат (одобрение -4)', () => { c.gov.approval -= 4; }]], 8, 0)
];
function eventsDay() { let c = me(); if (!c || !isHuman(c.id)) return; if (RNG() < 0.06) { let n0 = docs.length; pick(EVENTS)(c); if (docs.length > n0) { let cp = capitalOf(c); if (cp) mark(cp.x, cp.y, '❗', docs[0].title, 'warn'); } } docDeadlines(); Object.keys(c.gov.cb).forEach(k => { let b = c.gov.cb[k]; if (!b.ready && --b.left <= 0) { b.ready = true; toast(`⚖ Повод к войне против ${countryMap[k].name} готов`, 'good'); } }); }
function activeWarsOf(id) { return activeWars.filter(w => w.a === id || w.b === id).length; }
function botAI() {
  if (activeWars.length >= 7) return;
  countries.forEach((c, idx) => {
    if (isHuman(c.id) || (currentTurn + idx) % 5 || !c.neighbors || activeWarsOf(c.id) || RNG() > 0.05) return;
    if (c.army.divisions.filter(d => d.status === 'active').length < 3) return;
    let cands = [...c.neighbors].filter(n => countryMap[n] && (truces[c.id + n] || 0) < currentTurn && !activeWarsOf(n) && ((diplomaticRelations[c.id][n] || {}).status === 'hostile') && !activePact(c.id, n));
    let t = pick(cands); if (!t) return; let tc = countryMap[t]; if (!tc) return;
    if (isHuman(t)) { if (currentTurn - (tc._joinTurn || 0) < 40 || tc._defeated) return; if (RNG() > .5) return; botWarOnPlayer(c, t); return; }
    if (tc.army.divisions.length * 1.2 > c.army.divisions.length) return;
    diplomaticRelations[c.id][t].status = 'at_war'; diplomaticRelations[t][c.id].status = 'at_war'; startWar(c.id, t); mapDirty = true; callAllies(c.id, t);
    addNewsEvent(`${c.name} объявляет войну ${tc.name}!`, 'war'); toast(`⚔ ${c.name} объявила войну ${tc.name}`, 'war');
  });
}
function botWarOnPlayer(b, pid) {
  let p = countryMap[pid]; if (!p || activeWarsOf(b.id) || (truces[b.id + p.id] || 0) > currentTurn) return;
  diplomaticRelations[p.id][b.id].status = 'at_war'; if (diplomaticRelations[b.id][p.id]) diplomaticRelations[b.id][p.id].status = 'at_war'; startWar(b.id, p.id); mapDirty = true;
  if (p.id === LOCAL) { let cp = capitalOf(b); if (cp) mark(cp.x, cp.y, '⚔', `${b.name} объявила вам войну`, 'war'); toast(`⚔ ${b.name} объявила войну вам!`, 'war'); }
  callAllies(b.id, p.id); addNewsEvent(`${b.name} объявляет войну ${p.name}!`, 'war');
  runAs(p.id, () => mkDoc(`Нота о начале войны от ${b.name}`, 'Враг пересёк границу. Генеральный штаб ждёт ваших приказов.', 'Генеральный штаб', [['К исполнению: мобилизация (стабильность -3, люди +10%)', () => { p.economy.manpower = Math.min(p.economy.manpowerCap, p.economy.manpower + p.economy.manpowerCap * .1); p.gov.stability -= 3; }], ['Принять к сведению', () => { }]], 6, 1));
}
window.botWarEnded = function (war) { endBotWar(war); };
function endBotWar(w) { truces[w.a + w.b] = truces[w.b + w.a] = currentTurn + 40; [[w.a, w.b], [w.b, w.a]].forEach(([x, y]) => { if (diplomaticRelations[x] && diplomaticRelations[x][y]) diplomaticRelations[x][y].status = 'hostile'; }); mapDirty = true; }
window.processBotSurrender = function (loserId, winnerId) {
  let L = countryMap[loserId], W = countryMap[winnerId]; mapDirty = true; if (!L || !W) return;
  if (isHuman(loserId)) {
    // человек проиграл стране-бот: принудительный мир с репарациями
    L.economy.reparations = { to: winnerId, percent: .15 }; L.gov.stability -= 10; L.gov.approval -= 10;
    if (cellsOf(L.numericId) < 60) { L._defeated = true; if (loserId === LOCAL && window.showDefeat) showDefeat(`${W.name} разгромила ${L.name}. Ваше государство потеряло почти всю территорию.`); }
    else if (loserId === LOCAL) toast('Вы вынуждены подписать капитуляцию: репарации 15%', 'bad');
  } else if (W.economy.gdp > L.economy.gdp * 2) { L.economy.reparations = { to: winnerId, percent: .15 }; addNewsEvent(`${W.name} наложила репарации на ${L.name}`, 'war'); }
  if (diplomaticRelations[loserId] && diplomaticRelations[loserId][winnerId]) { diplomaticRelations[loserId][winnerId].status = 'neutral'; diplomaticRelations[winnerId][loserId].status = 'neutral'; }
  truces[loserId + winnerId] = truces[winnerId + loserId] = currentTurn + 60;
};
function botCredits() { credits.forEach(cr => { if (cr.status === 'proposed' && !isHuman(cr.lender)) { cr.wait = (cr.wait || 0) + 1; if (cr.wait >= 2) { let rel = diplomaticRelations[cr.lender][cr.borrower], p = .3 + (rel && (rel.status === 'friendly' || rel.status === 'allied') ? .4 : 0) - (rel && rel.status === 'hostile' ? .3 : 0); if (RNG() < p) { acceptCredit(cr.id); if (cr.borrower === LOCAL) toast(`💳 ${countryMap[cr.lender].name} одобрила кредит`, 'good'); } else rejectCredit(cr.id); } } }); }
function botGrowth() { countries.forEach(c => { if (isHuman(c.id) || !c.mil) return; if (currentTurn % 30 === 0 && c.mil.botTech < 8) c.mil.botTech++; if (c.economy.budget > 30 && c.army.divisions.length < 14 && RNG() < 0.02) { c.army.divisions.push({ id: c.army.divisions.length + 1, name: `${c.name} ${c.army.divisions.length + 1}-я дивизия`, strength: 100, max: 100, status: 'active', daysLeft: 0 }); c.economy.budget -= 5; } if (c.economy.budget > 60 && RNG() < .01) { c.factoryCount++; c.economy.budget -= 8; } }); }
function dailyExt() {
  dailyExt2();
  humans.forEach(h => runAs(h, () => { projectsDay(); researchDay(); eventsDay(); seaDaily(); buildingsLostCheck(); autoSendDivs(); let c = me(); if (c.gov.approval < 5) c.gov.approval = 5; }));
  botAI(); botCredits(); if (currentTurn % 3 === 0) botGrowth();
  if (docs.length > 300) docs = docs.filter(d => d.status === 'pending' || currentTurn - d.deadline < 40);
}
