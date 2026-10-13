// Генерирует public/js/grid.js — готовую сетку владения территорией (одинаковую для всех игроков)
// и countries.json — список стран для сервера.
//
// Зачем: растеризация карты на canvas немного отличается в разных браузерах/видеокартах,
// а для синхронной симуляции у всех игроков сетка должна совпадать до последней клетки.
//
// Запуск (нужны devDependencies: jsdom и canvas):   npm run build:grid
'use strict';
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pub = path.join(root, 'public');

let html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
html = html.replace(/<script src="[^"]+"><\/script>\n?/g, '').replace(/<link[^>]+>/g, '');

const vc = new VirtualConsole();
vc.on('jsdomError', e => console.error('jsdom:', e.message));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window;
Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { get() { return 1000; } });
Object.defineProperty(w.HTMLElement.prototype, 'clientHeight', { get() { return 600; } });

function inject(file) {
  const s = w.document.createElement('script');
  s.textContent = fs.readFileSync(path.join(pub, 'js', file), 'utf8');
  w.document.body.appendChild(s);
}

(async () => {
  inject('det.js');
  inject('base.js');
  w.seedRNG(12345);
  await w.initGrid();
  const T = w.eval('territoryOwner');
  const countries = w.eval('countries.map(c => ({ id: c.id, name: c.name, n: c.numericId }))');
  if (countries.length > 255) throw new Error('Больше 255 стран — нужен формат с 2 байтами на значение');

  // RLE: [значение (1 байт), длина серии (varint)]
  const out = [];
  let i = 0;
  while (i < T.length) {
    const v = T[i];
    let j = i + 1;
    while (j < T.length && T[j] === v) j++;
    let n = j - i;
    out.push(v);
    while (n >= 128) { out.push((n & 127) | 128); n >>= 7; }
    out.push(n);
    i = j;
  }
  const b64 = Buffer.from(out).toString('base64');
  fs.writeFileSync(path.join(pub, 'js', 'grid.js'),
    '// Автоматически создано tools/build-grid.js — не редактировать вручную\n' +
    '(function () {\n  const b = atob("' + b64 + '"), N = ' + T.length + ', g = new Uint16Array(N);\n' +
    '  let p = 0, k = 0;\n  while (p < b.length) {\n    const v = b.charCodeAt(p++); let n = 0, sh = 0, c;\n' +
    '    do { c = b.charCodeAt(p++); n |= (c & 127) << sh; sh += 7; } while (c & 128);\n' +
    '    g.fill(v, k, k + n); k += n;\n  }\n  window.PRE_GRID = g;\n})();\n');
  fs.writeFileSync(path.join(root, 'countries.json'), JSON.stringify(countries.map(c => ({ id: c.id, name: c.name })), null, 0));
  console.log('Страны:', countries.length, '| серий RLE:', out.length, '| grid.js:', Math.round(b64.length / 1024), 'КБ (base64)');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
