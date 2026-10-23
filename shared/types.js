// Shared alert-type definitions (used by the server, the Telegram bot and the web map).
// Colours follow the original Red Alert palette.

export const ALERT_TYPES = {
  breaking: {
    ar: 'خبر عاجل', en: 'Breaking news', button_ar: 'خبر عاجل', button_en: 'Breaking',
    emoji: '🔴', color: '#ff3b4e', ring: '#c81e2f', group: 'other', ttlMin: 120,
    marker: 'static', glyph: 'other', disc: '#000000', zone: true, tag_ar: 'عاجل', tag_en: 'Breaking',
  },
  uav: {
    ar: 'مسيّرة', en: 'UAV / Drone', button_ar: 'مسيّرة', button_en: 'Drone',
    emoji: '🛸', color: '#ff6b7a', ring: '#e11d48', group: 'aerial', ttlMin: 90,
    marker: 'orbit', glyph: 'uav', zone: true, tag_ar: 'مسيرة', tag_en: 'Drone',
  },
  warplane: {
    ar: 'طيران حربي', en: 'Warplane', button_ar: 'حربي', button_en: 'Warplane',
    emoji: '✈️', color: '#3b8eff', ring: '#1d4ed8', group: 'aerial', ttlMin: 60,
    marker: 'squad', glyph: 'plane', zone: 'dashed', tag_ar: 'طيران_حربي', tag_en: 'Warplane',
  },
  missile: {
    ar: 'صواريخ', en: 'Missiles', button_ar: 'صواريخ', button_en: 'Missiles',
    emoji: '🚀', color: '#7f1d1d', ring: '#450a0a', group: 'aerial', ttlMin: 180,
    marker: 'static', glyph: 'missile', disc: '#000000', zone: false, tag_ar: 'صواريخ', tag_en: 'Missiles',
  },
  attack: {
    ar: 'هجوم', en: 'Attack', button_ar: 'هجوم', button_en: 'Attack',
    emoji: '💥', color: '#b91c1c', ring: '#7f1d1d', group: 'strikes', ttlMin: 360,
    marker: 'static', glyph: 'airstrike', disc: '#dc2626', zone: false, tag_ar: 'هجوم', tag_en: 'Attack',
  },
  artillery: {
    ar: 'قصف مدفعي', en: 'Artillery shelling', button_ar: 'قصف مدفعي', button_en: 'Artillery',
    emoji: '🎯', color: '#f97316', ring: '#f97316', group: 'strikes', ttlMin: 360,
    marker: 'static', glyph: 'artillery', disc: '#f97316', zone: false, tag_ar: 'قصف_مدفعي', tag_en: 'Artillery',
  },
  civil: {
    ar: 'مدني', en: 'Civil alert', button_ar: 'مدني', button_en: 'Civil',
    emoji: '🚑', color: '#0891b2', ring: '#155e75', group: 'other', ttlMin: 240,
    marker: 'static', glyph: 'home_destroying', disc: '#000000', zone: false, tag_ar: 'مدني', tag_en: 'Civil',
  },
};

// Zone radius (km) by location scope — same values as the original map.
export const ZONE_KM = { place: 1.5, point: 1.5, village: 1.5, multi: 3, district: 8, governorate: 20 };
export const TYPE_KEYS = Object.keys(ALERT_TYPES);

export const ALERT_GROUPS = {
  aerial: { ar: 'نشاط جوّي', en: 'Aerial activity', types: ['uav', 'warplane', 'missile'] },
  strikes: { ar: 'هجمات وقصف', en: 'Attacks & shelling', types: ['attack', 'artillery'] },
  other: { ar: 'أخرى', en: 'Other', types: ['breaking', 'civil'] },
};

export function typeOf(key) {
  return ALERT_TYPES[key] || ALERT_TYPES.breaking;
}

export function dimColor(hex, alpha = 0.12) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
