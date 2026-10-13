// ===== Детерминизм: у всех игроков симуляция должна считаться одинаково =====
// Свой генератор случайных чисел (mulberry32), одинаковый для всех клиентов при одном seed.
(function () {
  let s = 1;
  window.seedRNG = function (seed) { s = (seed >>> 0) || 1; };
  window.RNG = function () {
    s = (s + 0x6D2B79F5) >>> 0; let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  window.rngState = function () { return s; };
  let idc = 1000; window.nextId = function (p) { return (p || '') + (++idc); }; window.idState = function () { return idc; };
  const _tld = Date.prototype.toLocaleDateString;
  Date.prototype.toLocaleDateString = function (l, o) {
    if (!o && (!l || l === 'ru-RU')) { const d = this.getUTCDate(), m = this.getUTCMonth() + 1; return (d < 10 ? '0' : '') + d + '.' + (m < 10 ? '0' : '') + m + '.' + this.getUTCFullYear(); }
    return _tld.call(this, l, Object.assign({ timeZone: 'UTC' }, o || {}));
  };
  // Все даты считаем в UTC, чтобы часовой пояс игрока не влиял на симуляцию.
  ['FullYear', 'Month', 'Date', 'Hours', 'Day'].forEach(function (k) {
    Date.prototype['get' + k] = Date.prototype['getUTC' + k];
    if (k !== 'Day') Date.prototype['set' + k] = Date.prototype['setUTC' + k];
  });
  // Math.hypot и Math.pow по спецификации могут отличаться в последнем бите между браузерами.
  Math.hypot = function () { let a = 0; for (let i = 0; i < arguments.length; i++) a += arguments[i] * arguments[i]; return Math.sqrt(a); };
  const nativePow = Math.pow;
  Math.pow = function (x, y) {
    if (Number.isInteger(y) && y >= 0 && y < 10000) { let r = 1, b = x, n = y; while (n > 0) { if (n & 1) r *= b; b *= b; n >>= 1; } return r; }
    return nativePow(x, y);
  };
})();
