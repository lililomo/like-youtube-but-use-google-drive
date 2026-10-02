// Terapkan tema sebelum render untuk mencegah kedip (file eksternal agar lolos CSP script-src 'self').
(function () {
  var pref = 'system';
  try {
    var raw = localStorage.getItem('dv.theme');
    if (raw) pref = JSON.parse(raw);
  } catch (e) {}
  var dark = pref === 'dark' || (pref !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
