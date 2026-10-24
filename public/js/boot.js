// Applies the saved theme before first paint (avoids a flash of the wrong theme).
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('ras-settings') || '{}');
    var dark = typeof s.darkMode === 'boolean' ? s.darkMode : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) { /* ignore */ }
})();
// Phone in "Desktop site" mode: the browser lays the page out at ~980px like a computer. We keep the
// real desktop layout (side list + big map) as the user asked, and only mark the page so that
// pinch-zooming the page stays allowed there (the tiny desktop text must remain readable).
(function () {
  var d = document.documentElement;
  var sw = window.screen && screen.width ? screen.width : 0;
  var coarse = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
  var dsm = !!(sw && coarse && sw < 820 && window.innerWidth > sw * 1.35);
  d.classList.toggle('dsm', dsm);
  window.__uiz = 1;
  window.__dsm = dsm;
  window.__applyUiz = function () {};
  window.__viewW = function () { return window.innerWidth; };
})();
// The browser's "install app" event can fire before the main module loads: keep it for install.js.
window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  window.__bip = e;
  try { window.dispatchEvent(new Event('ras-bip')); } catch (x) { /* ignore */ }
});
