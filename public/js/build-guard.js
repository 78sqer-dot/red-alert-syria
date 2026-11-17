const RELOAD_KEY = 'ras-build-reloaded-to';

// Only Render-style commit prefixes qualify: ignore numeric dev URLs and synthetic fixture labels.
export function deploymentBuild(value) {
  const build = String(value || '');
  return /^[a-f0-9]{10}$/i.test(build) && !/^\d+$/.test(build) ? build : null;
}

export function shouldReloadForBuild(loadedBuild, remoteBuild) {
  const loaded = deploymentBuild(loadedBuild);
  const remote = deploymentBuild(remoteBuild);
  return !!(loaded && remote && loaded !== remote);
}

// If storage is blocked, fail closed rather than risk an unguarded reload loop.
export function reloadOnceForBuild(targetBuild, { storage, reload = () => globalThis.location.reload() } = {}) {
  const target = deploymentBuild(targetBuild);
  try {
    storage ??= globalThis.sessionStorage;
    if (!target || !storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') return false;
    if (storage.getItem(RELOAD_KEY) === target) return false;
    storage.setItem(RELOAD_KEY, target);
    reload();
    return true;
  } catch {
    return false;
  }
}
