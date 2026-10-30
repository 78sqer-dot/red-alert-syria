// Persistent user settings (stored on the device only)
import { TYPE_KEYS } from '/shared/types.js?v=16';

const KEY = 'ras-settings';
DEFAULTS = {
  notifications: { enabled: false, types: [...TYPE_KEYS], sound: true, vibration: true, ringtone: 'alert1', volume: 0.8 },
  darkMode: null,
  language: null,
  showInactive: false,
  hasSeenWelcome: false,
  hasSeenTour: false,
  mapLayer: 'standard',
  map3d: false,
  showPeaks: false,
  showGov: true,
  focusSyria: true,
  filter: [...TYPE_KEYS],
  governorate: 'all',
  sidebarHidden: false,
  showRoads: true,
  showBorders: true,
  svcLayers: [],
};

function merge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k] && typeof base[k] === 'object') out[k] = merge(base[k], over[k]);
    else if (over[k] !== undefined) out[k] = over[k];
  }
  return out;
}

let state = DEFAULTS;
try {
  state = merge(DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}'));
} catch { /* ignore */ }
state.filter = state.filter.filter((t) => TYPE_KEYS.includes(t));
state.notifications.types = state.notifications.types.filter((t) => TYPE_KEYS.includes(t));
// types added after the user saved settings start visible (and notifying) by default
{
  const known = Array.isArray(state.knownTypes) ? state.knownTypes : ['breaking', 'uav', 'warplane', 'missile', 'attack', 'artillery', 'civil'];
  for (const t of TYPE_KEYS) if (!known.includes(t)) {
    if (!state.filter.includes(t)) state.filter.push(t);
    if (!state.notifications.types.includes(t)) state.notifications.types.push(t);
  }
  state.knownTypes = [...TYPE_KEYS];
}

// services are a temporary "map mode" now: old saved always-on service layers are dropped once
if ((state.svcVer || 0) < 2) { state.svcLayers = []; state.svcVer = 2; try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } }
const listeners = new Set();
export const settings = {
  get: () => state,
  set(patch) {
    state = merge(state, patch);
    if (patch.filter) state.filter = [...patch.filter];
    if (patch.notifications?.types) state.notifications.types = [...patch.notifications.types];
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
    listeners.forEach((fn) => fn(state, patch));
  },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
