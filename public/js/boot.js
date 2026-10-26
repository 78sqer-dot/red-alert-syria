// Applies the saved theme before first paint (avoids a flash of the wrong theme).
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('ras-settings') || '{}');
    var dark = typeof s.darkMode === 'boolean' ? s.darkMode : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) { /* ignore */ }
})();
// Phone in "Desktop site" mode: the browser lays the page out at ~980px even though the
// physical screen is narrow. Keep responsive layout decisions tied to the real screen width.
(function () {
  var d = document.documentElement;
  var sw = window.screen && screen.width ? screen.width : 0;
  var sh = window.screen && screen.height ? screen.height : 0;
  var coarse = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
  function update() {
    sw = window.screen && screen.width ? screen.width : sw;
    sh = window.screen && screen.height ? screen.height : sh;
    var shortSide = Math.min(sw || 9999, sh || 9999);
    var dsm = !!(coarse && shortSide < 820 && window.innerWidth > shortSide * 1.35);
    d.classList.toggle('dsm', dsm);
    window.__uiz = 1;
    window.__dsm = dsm;
    window.__viewW = function () { return dsm && sw ? Math.min(window.innerWidth, sw) : window.innerWidth; };
  }
  update();
  window.__applyUiz = update;
})();
// The browser's "install app" event can fire before the main module loads: keep it for install.js.
window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  window.__bip = e;
  try { window.dispatchEvent(new Event('ras-bip')); } catch (x) { /* ignore */ }
});
