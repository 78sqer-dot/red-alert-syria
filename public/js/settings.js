// Persistent user settings (stored on the device only)
import { TYPE_KEYS } from '/shared/types.js?v=41';

const KEY = 'ras-settings';
const DEFAULTS = {
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
  followArea: null,
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
function sanitizeFollowArea(area) {
  if (!area || typeof area !== 'object') return null;
  const text = (value) => typeof value === 'string' ? value.slice(0, 100) : '';
  const lat = Number(area.lat ?? area.latitude), lon = Number(area.lon ?? area.longitude);
  const hasPoint = Number.isFinite(lat) && lat > 32 && lat < 38 && Number.isFinite(lon) && lon > 35 && lon < 43;
  if (area.type === 'governorate' && /^[0-9]{2}$/.test(String(area.code || ''))) {
    return { type: 'governorate', code: String(area.code), name_ar: text(area.name_ar), name_en: text(area.name_en), ...(hasPoint ? { lat, lon } : {}) };
  }
  const placeId = Number(area.placeId ?? area.id);
  if (area.type === 'place' && Number.isSafeInteger(placeId) && placeId > 0 && hasPoint) {
    const radiusKm = Number(area.radiusKm);
    return {
      type: 'place', placeId, code: /^[0-9]{2}$/.test(String(area.code || '')) ? String(area.code) : '',
      name_ar: text(area.name_ar), name_en: text(area.name_en), district_ar: text(area.district_ar), district_en: text(area.district_en),
      lat, lon, radiusKm: Number.isFinite(radiusKm) ? Math.min(50, Math.max(0.2, radiusKm)) : 2.2,
    };
  }
  return null;
}
state.followArea = sanitizeFollowArea(state.followArea);
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
    if (Object.prototype.hasOwnProperty.call(patch, 'followArea')) state.followArea = sanitizeFollowArea(state.followArea);
    if (patch.filter) state.filter = [...patch.filter];
    if (patch.notifications?.types) state.notifications.types = [...patch.notifications.types];
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
    listeners.forEach((fn) => fn(state, patch));
  },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
