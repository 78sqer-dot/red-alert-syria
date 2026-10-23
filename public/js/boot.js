// Applies the saved theme before first paint (avoids a flash of the wrong theme).
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('ras-settings') || '{}');
    var dark = typeof s.darkMode === 'boolean' ? s.darkMode : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) { /* ignore */ }
})();
// Phone in "Desktop site" mode: Chrome/Safari ignore the viewport tag and lay the page out at ~980px,
// then shrink it onto the small screen (everything becomes tiny). Detect that case and zoom the page
// back to the real phone width so it looks exactly like the normal phone layout.
(function () {
  function apply() {
    var d = document.documentElement;
    var sw = window.screen && screen.width ? screen.width : 0;
    var coarse = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
    var z = sw && coarse && sw < 820 && window.innerWidth > sw * 1.35 ? Math.min(3.2, window.innerWidth / sw) : 1;
    window.__uiz = z;
    d.classList.toggle('rds', z > 1);
    d.style.zoom = z > 1 ? String(z) : '';
    d.style.setProperty('--uiz', String(z));
  }
  apply();
  window.__applyUiz = apply;
})();
