// Applies the saved theme before first paint (avoids a flash of the wrong theme).
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('ras-settings') || '{}');
    var dark = typeof s.darkMode === 'boolean' ? s.darkMode : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) { /* ignore */ }
})();
