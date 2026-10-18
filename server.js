// EUROPA STRATEGY ONLINE — сервер
// Сервер не считает игру сам: он раздаёт всем клиентам одинаковые «тики» (раз в 2 секунды = 1 игровой день)
// вместе с командами игроков, а клиенты считают мир детерминированно. Сервер хранит журнал команд,
// чтобы новый игрок мог «догнать» мир, ведёт чат и сверяет контрольные суммы состояния игроков.
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const compression = require('compression');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 3000;
const TICK_MS = +process.env.TICK_MS || 10000;
const DIFFICULTY = +process.env.DIFFICULTY || 1;       // 0.6 лёгкая, 1 нормальная, 1.35 жёсткая
const DATA_DIR = process.env.DATA_DIR || '';             // папка постоянного диска Render (необязательно)
const MAX_PLAYERS = +process.env.MAX_PLAYERS || 40;
const SAVE_FILE = DATA_DIR ? path.join(DATA_DIR, 'world.json') : '';
const COUNTRIES = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'countries.json'), 'utf8')).map(c => c.id));

// ---------- состояние мира ----------
let world = { seed: (Math.random() * 4294967295) >>> 0, difficulty: DIFFICULTY, tick: 0, log: [], players: {}, chat: [] };
// players: token -> { name, country }
if (SAVE_FILE && fs.existsSync(SAVE_FILE)) {
  try { const w = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8')); if (w && w.seed) { world = w; console.log(`Мир загружен: день ${world.tick}, игроков ${Object.keys(world.players).length}`); } } catch (e) { console.error('Не удалось прочитать world.json', e.message); }
}
let pending = [];                      // команды, ждущие ближайшего тика
const clients = new Set();             // активные соединения { ws, token, name, country }
const hashes = new Map();              // tick -> { h, n }
let dirty = false;

const app = express();
app.use(compression());
app.get('/healthz', (req, res) => res.json({ ok: true, tick: world.tick, online: onlinePlayers().length }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m', etag: true }));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

const send = (c, m) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(m)); };
const broadcast = m => { const s = JSON.stringify(m); clients.forEach(c => { if (c.ws.readyState === 1) c.ws.send(s); }); };
const onlinePlayers = () => [...clients].filter(c => c.country);
function presence() {
  const online = new Set(onlinePlayers().map(c => c.token));
  const players = Object.entries(world.players).filter(([, p]) => p.country).map(([tok, p]) => ({ country: p.country, name: p.name, online: online.has(tok) }));
  return { t: 'presence', players, paused: onlinePlayers().length === 0 };
}
const takenBy = country => Object.entries(world.players).find(([, p]) => p.country === country);
const cleanName = s => String(s || '').replace(/[<>&"]/g, '').trim().slice(0, 24);

// ---------- тики ----------
setInterval(() => {
  if (!onlinePlayers().length) return;          // нет игроков онлайн — мир стоит на паузе
  world.tick++;
  const cmds = pending; pending = [];
  if (cmds.length) world.log.push([world.tick, cmds]);
  dirty = true;
  broadcast({ t: 'tick', n: world.tick, cmds });
  for (const k of hashes.keys()) if (k < world.tick - 120) hashes.delete(k);
}, TICK_MS);

// ---------- соединения ----------
const rate = new WeakMap();
wss.on('connection', ws => {
  const c = { ws, token: '', name: '', country: '' };
  let hello = false;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    const now = Date.now(), r = rate.get(ws) || { t: now, n: 0 }; if (now - r.t > 1000) { r.t = now; r.n = 0; } if (++r.n > 40) return; rate.set(ws, r);

    if (m.t === 'hello') {
      if (hello) return; hello = true;
      c.token = String(m.token || '').slice(0, 80) || Math.random().toString(36).slice(2);
      const p = world.players[c.token]; if (p) { c.name = p.name; c.country = p.country; } else c.name = cleanName(m.name);
      // один человек = одно соединение: старую вкладку отключаем
      clients.forEach(o => { if (o !== c && o.token === c.token) { try { o.ws.close(); } catch (e) { } clients.delete(o); } });
      clients.add(c);
      const mine = x => x.scope === 'all' || x.from === c.country || x.to === c.country;
      send(c, { t: 'init', seed: world.seed, difficulty: world.difficulty, tick: world.tick, log: world.log, you: { country: c.country, name: c.name }, presence: presence(), chat: world.chat.filter(mine).slice(-150) });
      broadcast(presence());
      return;
    }
    if (!hello) return;

    if (m.t === 'join') {
      const country = String(m.country || ''), name = cleanName(m.name);
      if (!COUNTRIES.has(country)) return send(c, { t: 'error', msg: 'Нет такой страны' });
      if (!name) return send(c, { t: 'error', msg: 'Введите имя' });
      const owner = takenBy(country);
      if (owner && owner[0] !== c.token) return send(c, { t: 'error', msg: 'Страна уже занята другим игроком' });
      if (c.country === country) return;
      if (!owner && Object.keys(world.players).filter(k => world.players[k].country).length >= MAX_PLAYERS) return send(c, { t: 'error', msg: 'Сервер заполнен' });
      if (c.country) { pending.push({ f: c.country, name: '$leave', args: [] }); }
      c.country = country; c.name = name; world.players[c.token] = { name, country }; dirty = true;
      pending.push({ f: country, name: '$join', args: [name] });
      send(c, { t: 'joined', country, name }); broadcast(presence());
      return;
    }
    if (m.t === 'leave') {
      if (!c.country) return;
      pending.push({ f: c.country, name: '$leave', args: [] });
      delete world.players[c.token]; c.country = ''; dirty = true;
      send(c, { t: 'left' }); broadcast(presence());
      return;
    }
    if (m.t === 'cmd') {
      if (!c.country || typeof m.name !== 'string' || m.name[0] === '$' || m.name.length > 30 || !Array.isArray(m.args) || m.args.length > 12) return;
      if (JSON.stringify(m.args).length > 2500) return;
      pending.push({ f: c.country, name: m.name, args: m.args });
      return;
    }
    if (m.t === 'chat') {
      const text = String(m.text || '').trim().slice(0, 300); if (!text) return;
      const scope = m.scope === 'dm' ? 'dm' : 'all', to = scope === 'dm' ? String(m.to || '') : '';
      if (scope === 'dm' && !takenBy(to)) return send(c, { t: 'error', msg: 'Этот игрок не найден' });
      const msg = { id: Date.now() + Math.random(), from: c.country, name: c.name || 'Наблюдатель', scope, to, text, ts: Date.now() };
      world.chat.push(msg); if (world.chat.length > 600) world.chat.splice(0, world.chat.length - 600); dirty = true;
      const s = JSON.stringify({ t: 'chat', msg });
      clients.forEach(o => { if (o.ws.readyState === 1 && (scope === 'all' || o === c || o.country === to)) o.ws.send(s); });
      return;
    }
    if (m.t === 'hash') {
      const n = +m.n, h = +m.h; if (!Number.isFinite(n) || !Number.isFinite(h)) return;
      const e = hashes.get(n);
      if (!e) hashes.set(n, { h, n: 1 });
      else if (e.h !== h) { console.warn(`РАССИНХРОНИЗАЦИЯ на дне ${n}: ${e.h} != ${h}`); send(c, { t: 'desync', n }); }
      else e.n++;
    }
  });
  ws.on('close', () => { clients.delete(c); broadcast(presence()); });
  ws.on('error', () => { });
  ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
});
// держим соединения живыми (прокси Render рвёт молчащие)
setInterval(() => { wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; try { ws.ping(); } catch (e) { } }); }, +process.env.PING_MS || 25000);

// ---------- сохранение ----------
function save() {
  if (!SAVE_FILE || !dirty) return; dirty = false;
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); const tmp = SAVE_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(world)); fs.renameSync(tmp, SAVE_FILE); } catch (e) { console.error('save', e.message); }
}
setInterval(save, 30000);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { save(); process.exit(0); });

if (require.main === module || process.env.START_SERVER) {
  server.listen(PORT, () => console.log(`Europa Strategy Online: http://localhost:${PORT}  (день ${world.tick}, сложность ${world.difficulty})`));
}
module.exports = { server, world: () => world };
