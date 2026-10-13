// ===== V3 CORE: utils, flags, real-time, units =====
const DAY_MS = 2000;
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + RNG() * (b - a);
const rint = (a, b) => Math.floor(rnd(a, b + 1));
const pick = arr => arr[Math.floor(RNG() * arr.length)];
const fM = v => '$' + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(2) + 'B' : v.toFixed(Math.abs(v) < 10 ? 2 : 1) + 'M');
const A = {};
let gameStarted = false, gameOver = false, dayStart = performance.now(), dayProgress = 0, dayCounter = 0, mapDirty = true;
let units = [], unitId = 1, cmCache = {}, truces = {};

// ---------- ФЛАГИ ----------
const FT = {
 DEU:['h3','#000','#dd0000','#ffce00'], RUS:['h3','#fff','#0039a6','#d52b1e'], FRA:['v3','#0055a4','#fff','#ef4135'],
 ITA:['v3','#009246','#fff','#ce2b37'], POL:['h2','#fff','#dc143c'], UKR:['h2','#0057b7','#ffd700'],
 GBR:['uk'], USA:['canton','#b22234','#3c3b6e','#fff'], ESP:['h3','#aa151b','#f1bf00','#aa151b'],
 PRT:['v2','#046a38','#da291c'], NLD:['h3','#ae1c28','#fff','#21468b'], BEL:['v3','#000','#fae042','#ed2939'],
 AUT:['h3','#ed2939','#fff','#ed2939'], CHE:['cross','#d52b1e','#fff'], SWE:['nordic','#006aa7','#fecc00'],
 NOR:['nordic','#ba0c2f','#fff','#00205b'], DNK:['nordic','#c8102e','#fff'], FIN:['nordic','#fff','#003580'],
 ISL:['nordic','#02529c','#fff','#dc1e35'], IRL:['v3','#169b62','#fff','#ff883e'], GRC:['h3','#0d5eaf','#fff','#0d5eaf'],
 TUR:['h1','#e30a17','#fff','crescent'], ROU:['v3','#002b7f','#fcd116','#ce1126'], BGR:['h3','#fff','#00966e','#d62612'],
 HUN:['h3','#ce2939','#fff','#477050'], CZE:['tri','#fff','#11457e','#d7141a'], SVK:['h3','#fff','#0b4ea2','#ee1c25'],
 HRV:['h3','#f00','#fff','#171796'], SRB:['h3','#c6363c','#0c4076','#fff'], BLR:['h2','#c8313e','#4aa657'],
 LTU:['h3','#fdb913','#006a44','#c1272d'], LVA:['h3','#9e3039','#fff','#9e3039'], EST:['h3','#0072ce','#000','#fff'],
 CHN:['h1','#de2910','#ffde00','star'], JPN:['disc','#fff','#bc002d'], IND:['h3','#ff9933','#fff','#138808'],
 CAN:['v3','#d52b1e','#fff','#d52b1e'], AUS:['uk2','#012169'], MEX:['v3','#006847','#fff','#ce1126'],
 EGY:['h3','#ce1126','#fff','#000'], KAZ:['h1','#00afca','#fec50c','star'], ARG:['h3','#74acdf','#fff','#74acdf'],
 BRA:['disc','#009c3b','#ffdf00'], IRN:['h3','#239f40','#fff','#da0000'], ISR:['h3','#fff','#0038b8','#fff'],
 SAU:['h1','#006c35','#fff','star'], KOR:['disc','#fff','#cd2e3a'], ALB:['h1','#e41e20','#000','star'], MDA:['v3','#0046ae','#ffd200','#cc092f'],
 GEO:['cross','#fff','#f00'], ARM:['h3','#d90012','#0033a0','#f2a800'], AZE:['h3','#00b5e2','#ef3340','#509e2f'], CYP:['h1','#fff','#d57800','disc']
};
const FPAL = ['#c8102e','#003da5','#fff','#fcd116','#006b3f','#000','#ff7f00','#6a1b9a','#00a3a1','#8b4513'];
function hashStr(s){ let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const flagSpecs = {};
function getFlagSpec(id) {
  if (flagSpecs[id]) return flagSpecs[id];
  let t = FT[id], s;
  if (t) s = { p: t[0], c: t.slice(1, 4), e: null };
  else {
    let h = hashStr(id), r = () => (h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0);
    let pats = ['h3','v3','h2','v2','nordic','cross','disc','diag','tri','h3','v3'];
    let cs = []; while (cs.length < 3) { let c = FPAL[r() % FPAL.length]; if (cs[cs.length-1] !== c) cs.push(c); }
    s = { p: pats[r() % pats.length], c: cs, e: r() % 3 === 0 ? 'star' : null, ec: '#fff' };
  }
  if (s.p === 'h1') { s.e = t[3]; s.c = [t[1], t[2]]; s.ec = t[2]; s.p = 'h2x'; }
  flagSpecs[id] = s; return s;
}
function star(g, cx, cy, r, col) {
  g.fillStyle = col; g.beginPath();
  for (let i = 0; i < 10; i++) { let a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.4 : r; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
  g.closePath(); g.fill();
}
function drawFlag(g, s, w, h) {
  let c = s.c; g.save(); g.beginPath(); g.rect(0, 0, w, h); g.clip();
  const F = (col, x, y, ww, hh) => { g.fillStyle = col; g.fillRect(x, y, ww, hh); };
  switch (s.p) {
    case 'h3': for (let i = 0; i < 3; i++) F(c[i], 0, h * i / 3, w, h / 3 + 1); break;
    case 'v3': for (let i = 0; i < 3; i++) F(c[i], w * i / 3, 0, w / 3 + 1, h); break;
    case 'h2': F(c[0], 0, 0, w, h / 2 + 1); F(c[1], 0, h / 2, w, h / 2); break;
    case 'v2': F(c[0], 0, 0, w * 0.4, h); F(c[1], w * 0.4, 0, w * 0.6, h); break;
    case 'h2x': F(c[0], 0, 0, w, h); break;
    case 'nordic': F(c[0], 0, 0, w, h); if (c[2]) { F(c[2], w * .27, 0, w * .2, h); F(c[2], 0, h * .4, w, h * .2); } F(c[1], w * .3, 0, w * .14, h); F(c[1], 0, h * .43, w, h * .14); break;
    case 'cross': F(c[0], 0, 0, w, h); F(c[1], w * .43, h * .15, w * .14, h * .7); F(c[1], w * .25, h * .43, w * .5, h * .14); break;
    case 'disc': F(c[0], 0, 0, w, h); g.fillStyle = c[1]; g.beginPath(); g.arc(w / 2, h / 2, h * .3, 0, 7); g.fill(); break;
    case 'diag': F(c[0], 0, 0, w, h); g.fillStyle = c[1]; g.beginPath(); g.moveTo(w, 0); g.lineTo(w, h); g.lineTo(0, h); g.fill(); g.strokeStyle = c[2]; g.lineWidth = h * .18; g.beginPath(); g.moveTo(0, h); g.lineTo(w, 0); g.stroke(); break;
    case 'tri': F(c[0], 0, 0, w, h / 2 + 1); F(c[2], 0, h / 2, w, h / 2); g.fillStyle = c[1]; g.beginPath(); g.moveTo(0, 0); g.lineTo(w * .45, h / 2); g.lineTo(0, h); g.fill(); break;
    case 'canton': for (let i = 0; i < 7; i++) F(i % 2 ? c[2] : c[0], 0, h * i / 7, w, h / 7 + 1); F(c[1], 0, 0, w * .45, h * 4 / 7); break;
    case 'uk': case 'uk2':
      F(s.p === 'uk' ? '#012169' : c[0], 0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = h * .2; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke();
      g.strokeStyle = '#c8102e'; g.lineWidth = h * .07; g.stroke(); F('#fff', w * .4, 0, w * .2, h); F('#fff', 0, h * .38, w, h * .24); F('#c8102e', w * .45, 0, w * .1, h); F('#c8102e', 0, h * .43, w, h * .14);
      if (s.p === 'uk2') star(g, w * .7, h * .6, h * .18, '#fff'); break;
    default: F(c[0] || '#888', 0, 0, w, h);
  }
  if (s.p === 'h2x') { F(s.c[0], 0, 0, w, h); }
  if (s.e === 'star') star(g, s.p === 'h2x' ? w * .25 : w / 2, h / 2, h * .26, s.ec || '#fff');
  else if (s.e === 'crescent') { g.fillStyle = s.ec || '#fff'; g.beginPath(); g.arc(w * .45, h / 2, h * .27, 0, 7); g.fill(); g.fillStyle = s.c[0]; g.beginPath(); g.arc(w * .52, h / 2, h * .22, 0, 7); g.fill(); star(g, w * .62, h / 2, h * .1, s.ec || '#fff'); }
  else if (s.e === 'disc') { g.fillStyle = s.ec || '#fff'; g.beginPath(); g.arc(w / 2, h / 2, h * .2, 0, 7); g.fill(); }
  else if (s.e === 'sun') { g.fillStyle = s.ec || '#fc0'; g.beginPath(); g.arc(w / 2, h / 2, h * .22, 0, 7); g.fill(); }
  else if (s.e === 'cross') { g.fillStyle = s.ec || '#fff'; g.fillRect(w * .46, h * .25, w * .08, h * .5); g.fillRect(w * .36, h * .42, w * .28, h * .16); }
  g.restore();
}
const flagCache = {};
function getFlagCanvas(id, w = 24, h = 16) {
  let k = id + w;
  if (!flagCache[k]) { let cv = document.createElement('canvas'); cv.width = w; cv.height = h; drawFlag(cv.getContext('2d'), getFlagSpec(id), w, h); flagCache[k] = cv; }
  return flagCache[k];
}
const flagUrls = {};
function flagURL(id) { if (!flagUrls[id]) flagUrls[id] = getFlagCanvas(id, 36, 24).toDataURL(); return flagUrls[id]; }
function flagImg(id, w = 18) { return `<img src="${flagURL(id)}" style="width:${w}px;height:${w * 2 / 3}px;vertical-align:middle;border:1px solid #333;margin-right:3px">`; }
A.setFlag = function (spec) {
  flagSpecs[playerCountryId] = spec;
  Object.keys(flagCache).filter(k => k.startsWith(playerCountryId)).forEach(k => delete flagCache[k]); delete flagUrls[playerCountryId];
  renderCountryList(); updatePlayerInfo(); draw();
};

// ---------- ТОСТЫ ----------
function toast(msg, kind = 'info') {
  let box = $('toasts'); if (!box) return;
  let d = document.createElement('div'); d.className = 'toast ' + kind; d.innerHTML = msg; box.appendChild(d);
  while (box.children.length > 6) box.removeChild(box.firstChild);
  setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 600); }, 5500);
}

// ---------- ГЕОМЕТРИЯ: центры, соседи, столицы ----------
function fixStrayPixels() {
  const T = territoryOwner, N = OFF_W * OFF_H, seen = new Uint8Array(N), st = new Int32Array(N), comps = [], best = {}; let fixed = 0; window._compOf = new Int32Array(N).fill(-1); window._mainIdx = {};
  for (let i = 0; i < N; i++) {
    if (!T[i] || seen[i]) continue; let o = T[i], sp = 0, n = 0, sx = 0, sy = 0; st[sp++] = i; seen[i] = 1; let cells = [];
    let ci = comps.length; while (sp) { let k = st[--sp]; _compOf[k] = ci; n++; if (cells.length < 40) cells.push(k); let x = k % OFF_W; sx += x; sy += (k / OFF_W) | 0;
      if (x > 0 && !seen[k - 1] && T[k - 1] === o) { seen[k - 1] = 1; st[sp++] = k - 1; } if (x < OFF_W - 1 && !seen[k + 1] && T[k + 1] === o) { seen[k + 1] = 1; st[sp++] = k + 1; }
      if (k >= OFF_W && !seen[k - OFF_W] && T[k - OFF_W] === o) { seen[k - OFF_W] = 1; st[sp++] = k - OFF_W; } if (k < N - OFF_W && !seen[k + OFF_W] && T[k + OFF_W] === o) { seen[k + OFF_W] = 1; st[sp++] = k + OFF_W; } }
    comps.push({ o, n, cells, cx: sx / n, cy: sy / n }); if (!best[o] || n > best[o].n) { best[o] = { n, cx: sx / n, cy: sy / n }; _mainIdx[o] = ci; }
  }
  comps.forEach(cp => { let m = best[cp.o]; if (cp.n >= m.n) return; let far = Math.hypot(cp.cx - m.cx, cp.cy - m.cy) > 120; if (!(cp.n <= 2 || (far && cp.n <= 5))) return;
    cp.cells.forEach(k => { let cnt = {}, x = k % OFF_W, y = (k / OFF_W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { let xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= OFF_W || yy >= OFF_H) continue; let v = T[yy * OFF_W + xx]; if (v !== cp.o) cnt[v] = (cnt[v] || 0) + 1; }
      let bv = 0, bc = -1; for (let v in cnt) if (cnt[v] > bc) { bc = cnt[v]; bv = +v; } T[k] = bv; territoryOwnerPrevious[k] = bv; fixed++; }); });
  window._mainComp = best; return fixed;
}
function computeAdjacency() {
  countries.forEach(c => { c.neighbors = new Set(); });
  let byNum = {}; countries.forEach(c => byNum[c.numericId] = c); const T = territoryOwner, cnt = new Map();
  for (let y = 0; y < OFF_H - 1; y++) for (let x = 0; x < OFF_W - 1; x++) {
    let i = y * OFF_W + x, a = T[i]; if (!a) continue;
    let b = T[i + 1]; if (b && b !== a) { let k = a < b ? a * 8192 + b : b * 8192 + a; cnt.set(k, (cnt.get(k) || 0) + 1); }
    b = T[i + OFF_W]; if (b && b !== a) { let k = a < b ? a * 8192 + b : b * 8192 + a; cnt.set(k, (cnt.get(k) || 0) + 1); }
  }
  cnt.forEach((n, k) => { if (n < 3) return; let a = byNum[Math.floor(k / 8192)], b = byNum[k % 8192]; if (a && b) { a.neighbors.add(b.id); b.neighbors.add(a.id); } });
}
function computeLabels() {
  countries.forEach(c => {
    c._lc = null;
    if (c.polygons && c.polygons.length && c.polygons[0].length > 10) {
      let ring = c.polygons[0], sx = 0, sy = 0, mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
      ring.forEach(p => { sx += p.x; sy += p.y; mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x); mny = Math.min(mny, p.y); mxy = Math.max(mxy, p.y); });
      c._lc = { x: sx / ring.length, y: sy / ring.length, size: Math.max(mxx - mnx, mxy - mny) };
    }
  });
}
function capitalOf(c) {
  if (!c) return null;
  if (c._cap && territoryOwner[c._cap.y * OFF_W + c._cap.x] === c.numericId) return c._cap;
  let m = window._mainComp && _mainComp[c.numericId], lc = m ? { x: m.cx, y: m.cy } : c._lc; c._cap = null; const T = territoryOwner, num = c.numericId;
  if (lc) {
    let cx = Math.round(lc.x), cy = Math.round(lc.y), mi = window._mainIdx ? _mainIdx[num] : undefined;
    for (let pass = 0; pass < 2 && !c._cap; pass++) {
      let bestS = -1, bestD = 1e9, found = null;
      for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) {
        let x = cx + dx, y = cy + dy; if (x < 3 || y < 3 || x >= OFF_W - 3 || y >= OFF_H - 3) continue; let k = y * OFF_W + x; if (T[k] !== num) continue; if (pass === 0 && mi !== undefined && _compOf[k] !== mi) continue;
        let sc = 0; for (let r = 1; r <= 6; r++) { let ok = true; for (let q = -r; q <= r && ok; q++) { if (T[(y - r) * OFF_W + x + q] !== num || T[(y + r) * OFF_W + x + q] !== num || T[(y + q) * OFF_W + x - r] !== num || T[(y + q) * OFF_W + x + r] !== num) ok = false; } if (ok) sc = r; else break; }
        let d = dx * dx + dy * dy; if (sc > bestS || (sc === bestS && d < bestD)) { bestS = sc; bestD = d; found = { x, y }; } }
      if (found) c._cap = found;
    }
    for (let r = 15; r < 90 && !c._cap; r++) for (let dy = -r; dy <= r && !c._cap; dy++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; let x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= OFF_W || y >= OFF_H) continue; if (T[y * OFF_W + x] === num) { c._cap = { x, y }; break; } }
  }
  if (!c._cap && c.polygons) for (let p of c.polygons) for (let pt of p) { let x = Math.round(pt.x), y = Math.round(pt.y); if (x >= 0 && y >= 0 && x < OFF_W && y < OFF_H && T[y * OFF_W + x] === num) { c._cap = { x, y }; return c._cap; } }
  return c._cap;
}
// ---------- ПЕРЕОПРЕДЕЛЕНИЯ ОРИГИНАЛА ----------
window.generateDynamicBorders = function () {
  const T = territoryOwner; smoothCtx.fillStyle = 'rgba(15,23,42,0.6)'; smoothCtx.beginPath();
  for (let y = 0; y < OFF_H; y++) for (let x = 0; x < OFF_W; x++) {
    let i = y * OFF_W + x, o = T[i]; if (o === 0) continue;
    if (x === 0 || y === 0 || x === OFF_W - 1 || y === OFF_H - 1 || T[i + 1] !== o || T[i - 1] !== o || T[i + OFF_W] !== o || T[i - OFF_W] !== o) smoothCtx.rect(x * 2, y * 2, 1, 1);
  }
  smoothCtx.fill();
};
function hubValid(b, cid) { let c = countryMap[cid]; return c && b.type === 'military' && b.ownerId === cid && b.status === 'active' && territoryOwner[Math.round(b.y) * OFF_W + Math.round(b.x)] === c.numericId; }
function validHubs(cid) { return buildings.filter(b => hubValid(b, cid)); }
window.getHubPosition = function (cid, tx, ty) {
  if (isHuman(cid)) {
    let hs = validHubs(cid); if (!hs.length) return null;
    if (tx !== undefined) hs.sort((a, b) => Math.hypot(a.x - tx, a.y - ty) - Math.hypot(b.x - tx, b.y - ty));
    return { x: Math.round(hs[0].x), y: Math.round(hs[0].y) };
  }
  let c = countryMap[cid]; if (!c) return null; if (c._home === undefined) c._home = capitalOf(c);
  if (c._home && territoryOwner[c._home.y * OFF_W + c._home.x] !== c.numericId) {
    if (!c._lostAt) { c._lostAt = currentTurn; if (activeWars.some(w => (w.a === cid && w.b === LOCAL) || (w.b === cid && w.a === LOCAL))) { mark(c._home.x, c._home.y, '🏚', `Столица ${c.name} захвачена`, 'good', 12); toast(`🏚 Столица ${c.name} захвачена: подкрепления врага прекращены`, 'good'); } }
    if (currentTurn - c._lostAt < 15) return null; c._home = null; c._lostAt = 0; c._cap = null; c._home = capitalOf(c);
  }
  return c._home;
};
window.hasNearbyBuilding = function (type, ownerId, x, y, radius) {
  let c = countryMap[ownerId]; if (!c) return false;
  return buildings.some(b => b.type === type && b.ownerId === ownerId && b.status === 'active' && Math.hypot(b.x - x, b.y - y) < radius && territoryOwner[Math.round(b.y) * OFF_W + Math.round(b.x)] === c.numericId);
};
const _bS = new Int32Array(OFF_W * OFF_H), _bP = new Int32Array(OFF_W * OFF_H), _bQ = new Int32Array(OFF_W * OFF_H); let _bId = 0;
function ownPath(x0, y0, x1, y1, num) {
  const T = territoryOwner, N = OFF_W * OFF_H, s = y0 * OFF_W + x0, t = y1 * OFF_W + x1; if (T[s] !== num || T[t] !== num) return null;
  _bId++; let h = 0, tl = 0, ok = false; _bQ[tl++] = s; _bS[s] = _bId; _bP[s] = -1;
  while (h < tl) { let k = _bQ[h++]; if (k === t) { ok = true; break; } let x = k % OFF_W, nb;
    if (x > 0) { nb = k - 1; if (_bS[nb] !== _bId && T[nb] === num) { _bS[nb] = _bId; _bP[nb] = k; _bQ[tl++] = nb; } }
    if (x < OFF_W - 1) { nb = k + 1; if (_bS[nb] !== _bId && T[nb] === num) { _bS[nb] = _bId; _bP[nb] = k; _bQ[tl++] = nb; } }
    if (k >= OFF_W) { nb = k - OFF_W; if (_bS[nb] !== _bId && T[nb] === num) { _bS[nb] = _bId; _bP[nb] = k; _bQ[tl++] = nb; } }
    if (k < N - OFF_W) { nb = k + OFF_W; if (_bS[nb] !== _bId && T[nb] === num) { _bS[nb] = _bId; _bP[nb] = k; _bQ[tl++] = nb; } } }
  if (!ok) return null; let p = []; for (let k = t; k !== -1; k = _bP[k]) p.push([k % OFF_W, (k / OFF_W) | 0]); return p.reverse();
}
function convoySpeed(cid) { let c = countryMap[cid]; let sp = 12; if (c && c.mil && isHuman(cid)) sp += bcount(c, 'railway') * 0.7 + techFx(c, 'ind') * 20; return sp; }
window.spawnConvoy = function (cid, tx, ty, power, side, warId, divId) {
  let hp = getHubPosition(cid, tx, ty); if (!hp) return false;
  let path = ownPath(hp.x, hp.y, Math.round(tx), Math.round(ty), countryMap[cid].numericId); if (!path || path.length < 2) return false;
  convoys.push({ id: convoyIdCounter++, ownerId: cid, warId, path, pathIndex: 0, prev: 0, power, divId: divId || 0, color: side === 'a' ? '#38bdf8' : '#f87171', speed: convoySpeed(cid) });
  return true;
};
function spreadTroops(num, tx, ty, power) {
  const T = territoryOwner; let gi = ty * OFF_W + tx;
  if (power < 20) { warTroops[gi] += power; return; }
  let cells = [];
  for (let y = Math.max(1, ty - 10); y <= Math.min(OFF_H - 2, ty + 10); y++) for (let x = Math.max(1, tx - 10); x <= Math.min(OFF_W - 2, tx + 10); x++) {
    let k = y * OFF_W + x; if (T[k] !== num) continue; let a = T[k - 1], b = T[k + 1], c = T[k - OFF_W], d = T[k + OFF_W];
    if ((a && a !== num) || (b && b !== num) || (c && c !== num) || (d && d !== num)) cells.push([Math.hypot(x - tx, y - ty), k]);
  }
  if (!cells.length) { warTroops[gi] += power; return; }
  cells.sort((p, q) => p[0] - q[0]); let n = Math.min(cells.length, clamp(Math.floor(power / 12), 3, 12));
  for (let i = 0; i < n; i++) warTroops[cells[i][1]] += power / n;
}
function atWarWith(a, b) { return activeWars.some(w => (w.a === a && w.b === b) || (w.a === b && w.b === a)); }
window.processConvoys = function () {
  for (let i = convoys.length - 1; i >= 0; i--) {
    let cv = convoys[i], o = countryMap[cv.ownerId]; cv.prev = cv.pathIndex; cv.pathIndex += cv.speed;
    let ci = Math.min(Math.floor(cv.pathIndex), cv.path.length - 1), [px, py] = cv.path[ci], own = territoryOwner[py * OFF_W + px];
    let div = cv.divId && o && o.army ? o.army.divisions.find(d => d.id === cv.divId) : null;
    // колонна на вражеской земле уничтожается
    if (o && own && own !== o.numericId) { let oc = countries.find(c => c.numericId === own); if (oc && atWarWith(oc.id, cv.ownerId)) {
      convoys.splice(i, 1); if (div) { div.status = 'active'; div.strength = Math.max(20, div.strength * 0.5); }
      if (cv.ownerId === LOCAL && visible()) { let key = 'cv' + Math.floor(px / 40) + ',' + Math.floor(py / 40); if (div || currentTurn - (lastMarkAt[key] || -99) >= 10) { lastMarkAt[key] = currentTurn; mark(px, py, '💥', div ? `Колонна «${div.name}» попала в засаду: потеряно 50% силы, отступила` : 'Колонна снабжения перехвачена', 'bad', 10); toast('💥 Ваша колонна уничтожена противником', 'bad'); } } continue; } }
    if (cv.pathIndex >= cv.path.length - 1) {
      let [tx, ty] = cv.path[cv.path.length - 1], gi = ty * OFF_W + tx;
      if (o && territoryOwner[gi] !== o.numericId) { let w = activeWars.find(x => x.id === cv.warId) || activeWars.find(x => x.a === cv.ownerId || x.b === cv.ownerId); let f = w && findWeakestFrontCellForSide(w, cv.ownerId); if (f) { tx = f.x; ty = f.y; gi = ty * OFF_W + tx; } else gi = -1; }
      if (gi >= 0 && o) { spreadTroops(o.numericId, tx, ty, cv.power * (hasNearbyBuilding('supply', cv.ownerId, tx, ty, 30) ? 1.4 : 1)); if (div) { div.status = 'front'; if (cv.ownerId === LOCAL) mark(tx, ty, '🛡', `«${div.name}» прибыла на фронт`, 'good', 6); } }
      else if (div) { div.status = 'active'; }
      convoys.splice(i, 1);
    }
  }
};
window.updateWarOverlay = function () {
  if (!warOverlayCtx) return;
  warOverlayCtx.clearRect(0, 0, OFF_W, OFF_H);
  activeWars.forEach(war => {
    if (!countryMap[war.a] || !countryMap[war.b]) return;
    let aN = countryMap[war.a].numericId, bN = countryMap[war.b].numericId, { minX, minY, maxX, maxY } = war.bbox, w = maxX - minX + 1, h = maxY - minY + 1;
    let img = warOverlayCtx.createImageData(w, h), d = img.data;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      let gi = y * OFF_W + x, id = territoryOwner[gi]; if (id !== aN && id !== bN) continue;
      let o = id === aN ? bN : aN;
      if (territoryOwner[gi + 1] === o || territoryOwner[gi - 1] === o || territoryOwner[gi + OFF_W] === o || territoryOwner[gi - OFF_W] === o) {
        let p = ((y - minY) * w + (x - minX)) * 4; d[p] = 220; d[p + 1] = 40; d[p + 2] = 30; d[p + 3] = 120;
      }
    }
    warOverlayCtx.putImageData(img, minX, minY);
  });
  if (activeWars.length && currentTurn % 2 === 0) mapDirty = true;
};
window.advanceTurn = function () { toast('Время нельзя пропустить: 1 день = 2 секунды', 'warn'); };
window.skipDays = window.advanceTurn;

// ---------- РИСОВАНИЕ ----------
const easeT = () => { let t = dayProgress; return t * t * (3 - 2 * t); };
function drawUnits() {
  const t = easeT(), now = performance.now(), w = Math.max(0.9, 4.2 / scale), h = w * 0.68;
  ctx.lineWidth = 0.12; ctx.strokeStyle = 'rgba(0,0,0,.65)';
  for (const u of units) {
    let a = u.dead ? 1 - t : (u.born === dayCounter ? t : 1);
    let x = u.px + (u.x - u.px) * t + Math.sin(now / 700 + u.id) * 0.12, y = u.py + (u.y - u.py) * t + Math.cos(now / 800 + u.id) * 0.12;
    ctx.globalAlpha = a; ctx.drawImage(getFlagCanvas(u.owner), x - w / 2, y - h / 2, w, h);
    if (scale >= 4) ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  }
  for (const cv of convoys) {
    let i = cv.prev + (cv.pathIndex - cv.prev) * t; i = clamp(i, 0, cv.path.length - 1);
    let p0 = cv.path[Math.floor(i)], p1 = cv.path[Math.min(cv.path.length - 1, Math.floor(i) + 1)], f = i - Math.floor(i);
    let x = p0[0] + (p1[0] - p0[0]) * f, y = p0[1] + (p1[1] - p0[1]) * f, k = 1.5;
    ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 0.15;
    ctx.drawImage(getFlagCanvas(cv.ownerId), x - w * k / 2, y - h * k / 2, w * k, h * k); ctx.strokeRect(x - w * k / 2, y - h * k / 2, w * k, h * k);
  }
  ctx.globalAlpha = 1;
}
window.draw = function () {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height); ctx.save(); ctx.translate(panX, panY); ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(smoothCanvas, 0, 0, OFF_W, OFF_H);
  if (warOverlayCanvas && activeWars.length) ctx.drawImage(warOverlayCanvas, 0, 0, OFF_W, OFF_H);
  const BI = { supply: '📦', defense: '🛡️', military: '🏰', port: '⚓' }; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  buildings.forEach(b => { let cfg = BUILDING_TYPES[b.type]; if (!cfg) return; let r = 7 / scale; ctx.fillStyle = cfg.color; ctx.strokeStyle = '#000'; ctx.lineWidth = 1 / scale; ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, 7); ctx.fill(); ctx.stroke();
    ctx.font = `${r * 1.35}px sans-serif`; ctx.fillStyle = '#fff'; ctx.fillText(BI[b.type] || '■', b.x, b.y + r * 0.08);
    if (b.type === 'military') { let fw = r * 1.7; ctx.drawImage(getFlagCanvas(b.ownerId), b.x - fw / 2, b.y - r - fw * 0.75, fw, fw * 0.667); ctx.strokeRect(b.x - fw / 2, b.y - r - fw * 0.75, fw, fw * 0.667); } });
  if (typeof projects !== 'undefined') projects.forEach(p => {
    if (!p.site) return; 
    { let r = 7 / scale; ctx.font = `${r * 1.35}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.globalAlpha = 0.6 + 0.4 * Math.sin(performance.now() / 250); ctx.fillStyle = '#fff'; ctx.fillText('🚧', p.site.x, p.site.y); ctx.globalAlpha = 1; }
  });
  let fs = 11 / scale; ctx.font = `bold ${fs}px Verdana, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineWidth = 2 / scale; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000';
  countries.forEach(c => {
    let lc = c._lc; if (!lc) return; let me = c.id === LOCAL;
    if (!me && lc.size * scale < 26) return;
    if (me) { let fw = 24 / scale; ctx.drawImage(getFlagCanvas(c.id, 36, 24), lc.x - fw / 2, lc.y - fw * 1.1, fw, fw * 0.667); ctx.strokeStyle = '#000'; ctx.lineWidth = 1 / scale; ctx.strokeRect(lc.x - fw / 2, lc.y - fw * 1.1, fw, fw * 0.667); ctx.lineWidth = 2 / scale; }
    else if (scale >= 5) { let fw = 12 / scale; ctx.drawImage(getFlagCanvas(c.id), lc.x - fw / 2, lc.y - fw * 1.2, fw, fw * 0.667); }
    ctx.strokeText(c.id, lc.x, lc.y); ctx.fillText(c.id, lc.x, lc.y);
  });
  drawUnits(); drawSea(); drawMarks(); ctx.restore();
};

// ---------- ЮНИТЫ-ФЛАЖКИ НА ФРОНТЕ ----------
function refreshUnits() {
  units = units.filter(u => !u.dead || u.dead >= dayCounter);
  let alive = new Set(activeWars.map(w => w.id));
  units.forEach(u => { if (!u.dead && !alive.has(u.war)) u.dead = dayCounter; });
  activeWars.forEach(war => {
    let ca = countryMap[war.a], cb = countryMap[war.b]; if (!ca || !cb) return;
    let aN = ca.numericId, bN = cb.numericId, FA = [], FB = [], sA = 0, sB = 0, { minX, minY, maxX, maxY } = war.bbox, T = territoryOwner;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      let gi = y * OFF_W + x, id = T[gi]; if (id !== aN && id !== bN) continue; let o = id === aN ? bN : aN;
      if (T[gi - 1] === o || T[gi + 1] === o || T[gi - OFF_W] === o || T[gi + OFF_W] === o) { if (id === aN) { FA.push(gi); sA += warTroops[gi]; } else { FB.push(gi); sB += warTroops[gi]; } }
    }
    assignUnits(war.id, war.a, FA, sA); assignUnits(war.id, war.b, FB, sB);
  });
}
function assignUnits(wid, cid, F, sum) {
  let free = units.filter(u => u.war === wid && u.owner === cid && !u.dead);
  let n = F.length ? Math.min(F.length, clamp(Math.round(sum / 120), 4, 80)) : 0;
  for (let i = 0; i < n; i++) {
    let gi = F[Math.floor(i * F.length / n)], tx = gi % OFF_W + 0.5, ty = Math.floor(gi / OFF_W) + 0.5;
    let bi = -1, bd = 1e9; free.forEach((u, j) => { let d = Math.hypot(u.x - tx, u.y - ty); if (d < bd) { bd = d; bi = j; } });
    if (bi >= 0 && bd < 90) { let u = free.splice(bi, 1)[0]; u.px = u.x; u.py = u.y; u.x = tx; u.y = ty; }
    else units.push({ id: unitId++, owner: cid, war: wid, px: tx, py: ty, x: tx, y: ty, born: dayCounter, dead: 0 });
  }
  free.forEach(u => { u.px = u.x; u.py = u.y; u.dead = dayCounter; });
}

// ---------- РЕАЛЬНОЕ ВРЕМЯ ----------
let lastFrame = 0;
function frame(now) {
  dayProgress = clamp((performance.now() - dayStart) / DAY_MS, 0, 1);
  if (now - lastFrame > 28 && !document.hidden) { lastFrame = now; draw(); let b = $('dayBar'); if (b) b.style.width = (dayProgress * 100) + '%'; }
  requestAnimationFrame(frame);
}
function gameTick() {
  if (gameOver) return;
  try { simulateOneDay(); } catch (e) { console.error('tick', e); }
  dayCounter++; dayStart = performance.now(); dayProgress = 0;
  try { refreshDateDisplays(); updatePlayerInfo(); if (mapDirty) { mapDirty = false; renderOffscreenMap(); } refreshUnits(); if (window.hubRefresh) hubRefresh(); } catch (e) { console.error('ui', e); }
}
window.simulateOneDay = function () {
  currentTurn++; simDate.setDate(simDate.getDate() + 1); cmCache = {};
  updateCountryEconomics(); processCredits(); randomAIActions(); processTreatyProposals(); dailyExt();
};
window.updatePlayerInfo = function () {
  let c = countryMap[playerCountryId]; if (!c || !c.economy) return; let e = c.economy, g = c.gov || {};
  const S = (id, v) => { let el = $(id); if (el) el.innerText = v; };
  S('playerCountryBadge', c.name); S('budgetDisplay', fM(e.budget)); S('incomeDisplay', '+' + fM(e.income)); S('expensesDisplay', '-' + fM(e.expenses));
  S('debtDisplay', fM(e.debt)); S('creditRatingDisplay', e.creditRating); S('taxRateDisplay', (e.taxRate || 0).toFixed(0) + '%'); S('populationDisplay', e.population.toFixed(1) + 'M');
  S('gdpDisplay', '$' + e.gdp.toFixed(1) + 'B'); S('manpowerDisplay', Math.round(e.manpower).toLocaleString('ru-RU'));
  S('influenceDisplay', c.influence); if ($('influenceBar')) $('influenceBar').style.width = c.influence + '%';
  S('approvalDisplay', (g.approval || 0).toFixed(0) + '%'); S('stabilityDisplay', (g.stability || 0).toFixed(0) + '%'); S('ppDisplay', (g.pp || 0).toFixed(0)); S('inflDisplay', (e.inflation || 0).toFixed(1) + '%');
  let f = $('sideFlag'); if (f) f.src = flagURL(c.id);
  let d = $('docBadge'); if (d) { let n = (window.docs || []).filter(x => x.owner === playerCountryId && x.status === 'pending').length; d.innerText = n; d.style.display = n ? 'inline-block' : 'none'; }
};
window.refreshDateDisplays = function () {
  let m = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  let s = `${String(simDate.getDate()).padStart(2, '0')} ${m[simDate.getMonth()]} ${simDate.getFullYear()}`;
  ['dateDisplay'].forEach(i => { if ($(i)) $(i).innerText = s; }); ['turnDisplay', 'headerTurn', 'tickerTurn'].forEach(i => { if ($(i)) $(i).innerText = currentTurn; });
};
window.renderCountryList = function () {
  let box = $('countryListContainer'); if (!box) return; box.innerHTML = '';
  let q = ($('countrySearch').value || '').toLowerCase();
  countries.filter(c => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)).sort((a, b) => (b.id === playerCountryId) - (a.id === playerCountryId) || a.name.localeCompare(b.name)).slice(0, 80).forEach(c => {
    let b = document.createElement('button'); b.className = 'btn ' + (c.id === playerCountryId ? 'green' : '');
    b.innerHTML = flagImg(c.id, 16) + c.name + (c.id === playerCountryId ? ' (ВЫ)' : ''); b.onclick = () => pickCountry(c.id); box.appendChild(b);
  });
};
function pickCountry(id) {
  if (gameStarted) { toast('Страну нельзя сменить во время игры', 'warn'); return; }
  playerCountryId = id; mapDirty = false; renderOffscreenMap(); updatePlayerInfo(); renderCountryList(); draw(); startPanel();
}
function startPanel() {
  let p = $('startPanel'); if (!p) return; if (gameStarted) { p.style.display = 'none'; return; }
  let c = countryMap[playerCountryId];
  p.innerHTML = `<div style="font-weight:bold;margin-bottom:4px">ВАША СТРАНА</div><div style="font-size:13px;margin:4px 0">${flagImg(c.id, 54)}<b>${c.name}</b></div>
  <div style="font-size:9px;margin-bottom:4px">Выберите страну в списке слева. После старта время идёт само: 1 день = 2 сек, остановить и перемотать нельзя.</div>
  <div style="font-size:10px;margin:4px 0">Сложность: <select onchange="A.setDiff(this.value)">${DIFFS.map(d => `<option value="${d[1]}" ${d[1] === difficulty ? 'selected' : ''}>${d[0]}</option>`).join('')}</select></div><button class="btn small" style="display:inline-block" onclick="A.flagEditor()">ФЛАГ СТРАНЫ</button> <button class="btn green small" style="display:inline-block" onclick="A.start()">▶ НАЧАТЬ ИГРУ</button>`;
}
A.start = function () {
  if (gameStarted) return; gameStarted = true; initPlayer(); startPanel(); dayStart = performance.now(); setInterval(gameTick, DAY_MS);
  toast('Игра началась! Время идёт: 1 день = 2 секунды', 'good'); updatePlayerInfo(); mapDirty = true; setTimeout(() => { A.hub('hq'); }, 300);
};
const _initGrid = initGrid;
window.initGrid = async function () {
  await _initGrid(); if (!countries.length) return;
  try { let fx = fixStrayPixels(); console.log('stray pixels fixed', fx); if (fx) renderOffscreenMap(); computeLabels(); countries.forEach(c => { let m = _mainComp[c.numericId]; if (m && c._lc) { c._lc.x = m.cx; c._lc.y = m.cy; } }); computeAdjacency(); countries.forEach(initExt); initAlliances(); simDate = new Date(Date.UTC(2009, 0, 1)); currentTurn = 1; refreshDateDisplays(); } catch (e) { console.error(e); }
  mapDirty = true;
};
