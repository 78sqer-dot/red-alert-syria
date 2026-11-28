// Visual selection only. Existing event handlers retain every action.
export function initFloatingControls(row) {
  if (!row) return;
  const buttons = [...row.querySelectorAll('button')];
  const select = (chosen) => buttons.forEach((button) => button.classList.toggle('floating-selected', button === chosen));
  for (const button of buttons) button.addEventListener('click', () => select(button));
  select(buttons[0]);
}

export function initFloatingNavigation(root = document) {
  const selector = '.topbar .tb-btn:not(.lang-btn), .map-tool-grid .map-btn, .map-control-actions .ctrl-btn, #mapControlsToggle, .svc-tab';
  const enhance = () => {
    for (const button of root.querySelectorAll(selector)) {
      if (button.classList.contains('floating-nav')) continue;
      const label = button.textContent.trim() || button.getAttribute('aria-label') || button.title;
      if (!label) continue;
      button.classList.add('floating-nav');
      if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', label);
      const text = document.createElement('span'); text.className = 'floating-nav-label';
      for (const child of [...button.childNodes]) {
        if (child.nodeType === 3 || (child.nodeType === 1 && !child.matches('svg, [data-icon], .badge-count'))) text.append(child);
      }
      if (!text.textContent.trim()) text.textContent = label;
      button.append(text);
    }
  };
  enhance();
  root.addEventListener('click', (event) => {
    const button = event.target.closest?.('.floating-nav');
    if (!button || button.classList.contains('svc-tab')) return;
    const group = button.closest('.topbar, .map-tool-grid, .map-control-actions') || button.parentElement;
    for (const other of group.querySelectorAll('.floating-nav')) other.classList.toggle('floating-selected', other === button);
  });
  const observer = new MutationObserver(enhance);
  observer.observe(root === document ? document.body : root, {childList:true,subtree:true});
  return observer;
}
