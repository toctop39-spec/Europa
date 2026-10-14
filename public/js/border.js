// ===== Пересмотр границы: игрок РИСУЕТ новую границу, адресат видит на карте, что получит и что потеряет =====
'use strict';
const BD_MAX_PTS = 30;
// Новая граница — ломаная линия. Земли двух стран в полосе шириной r клеток вокруг линии делятся по сторонам линии:
// сторона, где у предложившей страны больше своих земель, остаётся ей, другая — адресату.
// Возвращает { toA: клетки B, которые перейдут к A, toB: клетки A, которые перейдут к B }.
function borderPlan(aId, bId, bd) {
  const A = countryMap[aId], B = countryMap[bId], res = { toA: [], toB: [] };
  if (!A || !B || !bd || !bd.pts || bd.pts.length < 2) return res;
  const an = A.numericId, bn = B.numericId, T = territoryOwner, P = bd.pts, r = clamp(+bd.r || 25, 4, 60), r2 = r * r;
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9; P.forEach(p => { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); });
  minX = Math.max(0, Math.floor(minX - r)); minY = Math.max(0, Math.floor(minY - r)); maxX = Math.min(OFF_W - 1, Math.ceil(maxX + r)); maxY = Math.min(OFF_H - 1, Math.ceil(maxY + r));
  const cells = []; let score = 0;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const i = y * OFF_W + x, o = T[i]; if (o !== an && o !== bn) continue;
    let bestD = 1e18, side = 0;
    for (let k = 0; k + 1 < P.length; k++) {
      const x1 = P[k][0], y1 = P[k][1], dx = P[k + 1][0] - x1, dy = P[k + 1][1] - y1, L = dx * dx + dy * dy; if (!L) continue;
      let t = ((x - x1) * dx + (y - y1) * dy) / L; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = x1 + t * dx - x, py = y1 + t * dy - y, d = px * px + py * py;
      if (d < bestD) { bestD = d; side = dx * (y - y1) - dy * (x - x1) >= 0 ? 1 : -1; }
    }
    if (bestD > r2) continue;
    cells.push(i, side, o); score += side * (o === an ? 1 : -1);
  }
  const aSide = score >= 0 ? 1 : -1;
  for (let k = 0; k < cells.length; k += 3) {
    const i = cells[k], side = cells[k + 1], o = cells[k + 2];
    if (side === aSide && o === bn) res.toA.push(i); else if (side !== aSide && o === an) res.toB.push(i);
  }
  return res;
}
function cleanBd(bd) {
  if (!bd || !Array.isArray(bd.pts)) return null;
  const pts = bd.pts.slice(0, BD_MAX_PTS).map(p => [clamp(Math.round(+p[0] || 0), 0, OFF_W - 1), clamp(Math.round(+p[1] || 0), 0, OFF_H - 1)]);
  return pts.length >= 2 ? { pts, r: clamp(Math.round(+bd.r || 25), 4, 60) } : null;
}
// «Эквивалент» в процентах отданной территории — для расчёта шанса согласия ИИ
function borderPct(aId, bId, bd) { const pl = borderPlan(aId, bId, bd), B = countryMap[bId]; if (!B) return 0; return Math.max(0, pl.toA.length - pl.toB.length) / Math.max(1, cellsOf(B.numericId)) * 100; }
function applyBorder(aId, bId, bd) {
  const A = countryMap[aId], B = countryMap[bId], pl = borderPlan(aId, bId, bd); if (!A || !B) return 0;
  const ca = Math.max(1, cellsOf(A.numericId)), cb = Math.max(1, cellsOf(B.numericId));
  pl.toA.forEach(i => { territoryOwner[i] = A.numericId; warTroops[i] = 0; }); pl.toB.forEach(i => { territoryOwner[i] = B.numericId; warTroops[i] = 0; });
  if (pl.toA.length) transferEconomyShare(B, A, pl.toA.length / cb);
  if (pl.toB.length) transferEconomyShare(A, B, pl.toB.length / ca);
  mapDirty = true; return pl.toA.length;
}

// ---------- режим рисования границы ----------
let bdDraft = null;      // { id (с кем), pts: [], r }
let bdView = null;       // просмотр предложения: { a, b, bd, docId, plan, canvas, bx, by }
function bdPanel(html) { let p = document.getElementById('bdPanel'); if (!p) { p = document.createElement('div'); p.id = 'bdPanel'; p.style.cssText = 'position:fixed;top:92px;left:50%;transform:translateX(-50%);z-index:9500;background:#e5e7eb;border:3px outset #fff;padding:8px 10px;font:11px Verdana;max-width:560px;box-shadow:0 4px 16px #0008'; document.body.appendChild(p); } p.style.display = html ? 'block' : 'none'; p.innerHTML = html || ''; }
A.bdStart = function () {
  if (!deal) return; const c = me(); if (!c || !countryMap[deal.id]) return;
  bdDraft = { id: deal.id, pts: deal.bd ? deal.bd.pts.map(p => p.slice()) : [], r: deal.bd ? deal.bd.r : 25 };
  $('dealModal').style.display = 'none'; currentTool = 'border'; A.hubClose && A.hubClose();
  const o = countryMap[deal.id], cap = (typeof capitalOf === 'function' && capitalOf(c)); const mid = bdDraft.pts[0] || nearBorderPoint(c, o); if (mid) { A.goto(mid[0], mid[1]); }
  bdRenderPanel(); draw();
};
function nearBorderPoint(a, b) { // клетка на стыке двух стран — чтобы камера сразу показала нужное место
  const T = territoryOwner; let sx = 0, sy = 0, n = 0; for (let y = 1; y < OFF_H - 1; y += 2) for (let x = 1; x < OFF_W - 1; x += 2) { const i = y * OFF_W + x; if (T[i] === a.numericId && (T[i + 1] === b.numericId || T[i - 1] === b.numericId || T[i + OFF_W] === b.numericId || T[i - OFF_W] === b.numericId)) { sx += x; sy += y; n++; } }
  return n ? [Math.round(sx / n), Math.round(sy / n)] : null;
}
function bdStats(plan) { return { gain: plan.toA.length, loss: plan.toB.length }; }
function bdRenderPanel() {
  if (!bdDraft) return bdPanel('');
  const c = me(), o = countryMap[bdDraft.id]; const bd = bdDraft.pts.length >= 2 ? { pts: bdDraft.pts, r: bdDraft.r } : null; const st = bd ? bdStats(borderPlan(c.id, o.id, bd)) : { gain: 0, loss: 0 };
  bdPanel(`<b>✏ Новая граница с ${o.name}</b><br>Кликайте по карте, чтобы ставить точки ломаной линии (точек: ${bdDraft.pts.length}). Земли по обе стороны линии в полосе вокруг неё делятся: <span style="color:#15803d"><b>зелёное</b></span> получаете вы, <span style="color:#b91c1c"><b>красное</b></span> отдаёте.<br>
  Вы получите: <b>${st.gain}</b> секторов · отдадите: <b>${st.loss}</b><br>Ширина полосы: <input type="range" min="5" max="60" value="${bdDraft.r}" oninput="bdDraft.r=+this.value;bdRenderPanel();draw()" style="vertical-align:middle"> ${bdDraft.r}<br>
  <button class="btn small green" style="width:auto" onclick="A.bdDone()">ГОТОВО</button> <button class="btn small" style="width:auto" onclick="A.bdUndo()">Убрать точку</button> <button class="btn small" style="width:auto" onclick="A.bdClear()">Стереть</button> <button class="btn small red" style="width:auto" onclick="A.bdCancel()">Отмена</button>`);
}
function borderClick(wPos) { if (!bdDraft) return; if (bdDraft.pts.length >= BD_MAX_PTS) return toast('Слишком много точек', 'warn'); bdDraft.pts.push([Math.round(wPos.x), Math.round(wPos.y)]); bdRenderPanel(); draw(); }
A.bdUndo = () => { if (bdDraft) { bdDraft.pts.pop(); bdRenderPanel(); draw(); } };
A.bdClear = () => { if (bdDraft) { bdDraft.pts = []; bdRenderPanel(); draw(); } };
A.bdCancel = () => { bdDraft = null; currentTool = 'inspect'; bdPanel(''); $('dealModal').style.display = 'flex'; renderDeal(); draw(); };
A.bdDone = () => {
  if (!bdDraft) return; if (bdDraft.pts.length < 2) return toast('Нужно минимум 2 точки', 'warn');
  deal.bd = cleanBd({ pts: bdDraft.pts, r: bdDraft.r }); bdDraft = null; currentTool = 'inspect'; bdPanel('');
  $('dealModal').style.display = 'flex'; renderDeal(); draw();
};
window.borderRowHTML = function () {
  const c = me(), o = countryMap[deal.id]; let s = `<div class="row"><span><b>Пересмотр границы</b>: нарисуйте новую границу на карте</span><span><button class="btn small" onclick="A.bdStart()">✏ ${deal.bd ? 'Изменить' : 'Нарисовать'}</button>${deal.bd ? '<button class="btn small" onclick="deal.bd=null;renderDeal()">Стереть</button>' : ''}</span></div>`;
  if (deal.bd) { const st = bdStats(borderPlan(c.id, o.id, deal.bd)); s += `<div style="font-size:11px;margin:2px 0 6px">Вы получите <b style="color:#15803d">${st.gain}</b> секторов, отдадите <b style="color:#b91c1c">${st.loss}</b>. ${isHuman(o.id) ? 'Игрок увидит границу на карте и сам решит, принять ли её.' : ''}</div>`; }
  return s;
};

// ---------- просмотр предложения адресатом ----------
A.docPreview = function (docId) {
  const d = docs.find(x => x.id === docId); if (!d || !d.bd) return;
  const plan = borderPlan(d.bd.a, d.bd.b, d.bd.bd); bdView = { docId, a: d.bd.a, b: d.bd.b, bd: d.bd.bd, plan, cv: null };
  A.hubClose(); const pts = d.bd.bd.pts, mx = Math.round(pts.reduce((s, p) => s + p[0], 0) / pts.length), my = Math.round(pts.reduce((s, p) => s + p[1], 0) / pts.length); A.goto(mx, my);
  bdViewPanel(); draw();
};
function bdViewPanel() {
  if (!bdView) return bdPanel(''); const d = docs.find(x => x.id === bdView.docId), A_ = countryMap[bdView.a], me_ = me(); const iAmB = me_ && me_.id === bdView.b;
  const gain = iAmB ? bdView.plan.toB.length : bdView.plan.toA.length, loss = iAmB ? bdView.plan.toA.length : bdView.plan.toB.length;
  const pending = d && d.status === 'pending';
  bdPanel(`<b>🗺 Предложение новой границы от ${A_.name}</b><br>Вы получите: <b style="color:#15803d">${gain}</b> секторов (зелёные) · потеряете: <b style="color:#b91c1c">${loss}</b> (красные). Жёлтая линия — предлагаемая граница.<br>
  ${pending ? `<button class="btn small green" style="width:auto" onclick="A.bdViewClose();A.docDo(${d.id},0)">ПРИНЯТЬ</button> <button class="btn small red" style="width:auto" onclick="A.bdViewClose();A.docDo(${d.id},1)">ОТКЛОНИТЬ</button> ` : '<i>Документ уже закрыт.</i> '}<button class="btn small" style="width:auto" onclick="A.bdViewClose();A.hub(\'docs\')">Закрыть просмотр</button>`);
}
A.bdViewClose = () => { bdView = null; bdPanel(''); draw(); };

// ---------- рисование поверх карты ----------
function bdOverlay(plan, viewerIsA, pts) {
  // слой клеток: «моё приобретение» зелёным, «потеря» красным
  const g = ctx; g.save(); g.translate(panX, panY); g.scale(scale, scale);
  const paint = (arr, col) => { g.fillStyle = col; arr.forEach(i => g.fillRect(i % OFF_W, (i / OFF_W) | 0, 1.02, 1.02)); };
  paint(plan.toA, viewerIsA ? 'rgba(22,163,74,.62)' : 'rgba(220,38,38,.62)'); paint(plan.toB, viewerIsA ? 'rgba(220,38,38,.62)' : 'rgba(22,163,74,.62)');
  g.strokeStyle = '#facc15'; g.lineWidth = Math.max(1.5, 3 / scale); g.setLineDash([6 / scale, 3 / scale]); g.beginPath(); pts.forEach((p, k) => k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1 / scale; pts.forEach(p => { g.beginPath(); g.arc(p[0], p[1], 3 / scale, 0, 7); g.fill(); g.stroke(); });
  g.restore();
}
(function () {
  const f = window.draw;
  window.draw = function () {
    f.apply(this, arguments); if (suppressUI || !ctx) return;
    if (bdDraft && bdDraft.pts.length) { const c = me(); const bd = bdDraft.pts.length >= 2 ? { pts: bdDraft.pts, r: bdDraft.r } : null; bdOverlay(bd ? borderPlan(c.id, bdDraft.id, bd) : { toA: [], toB: [] }, true, bdDraft.pts); }
    else if (deal && deal.bd && $('dealModal') && $('dealModal').style.display === 'flex') { /* в окне сделки карту не рисуем */ }
    if (bdView) bdOverlay(bdView.plan, bdView.a === (me() && me().id), bdView.bd.pts);
  };
})();
document.addEventListener('keydown', e => { if (e.key === 'Escape' && bdDraft) A.bdCancel(); else if (e.key === 'Enter' && bdDraft && bdDraft.pts.length >= 2) A.bdDone(); });
