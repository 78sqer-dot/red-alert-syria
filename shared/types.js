// Shared alert-type definitions (used by the server, the Telegram bot and the web map).
// Colours follow the original Red Alert palette.

export const ALERT_TYPES = {
  breaking: {
    ar: 'خبر عاجل', en: 'Breaking news', button_ar: 'خبر عاجل', button_en: 'Breaking',
    emoji: '🚨', color: '#ff3b4e', ring: '#c81e2f', group: 'other', ttlMin: 120,
    marker: 'icon', glyph: 'alert_tri', icon: '#111827', disc: '#000000', zone: true, tag_ar: 'عاجل', tag_en: 'Breaking',
  },
  political: {
    ar: 'تطور سياسي', en: 'Political development', button_ar: 'تطور سياسي', button_en: 'Political development',
    emoji: '🏛️', color: '#64748b', ring: '#475569', group: 'political', ttlMin: 360,
    marker: 'icon', glyph: 'political', icon: '#475569', disc: '#334155', size: 25, zone: false, tag_ar: 'تطور_سياسي', tag_en: 'Political_development',
  },
  uav: {
    ar: 'مسيّرة', en: 'UAV / Drone', button_ar: 'مسيّرة', button_en: 'Drone',
    emoji: '🛩️', color: '#ff6b7a', ring: '#e11d48', group: 'aerial', ttlMin: 90,
    marker: 'orbit', glyph: 'uav', zone: true, tag_ar: 'مسيرة', tag_en: 'Drone',
  },
  uav_strike: {
    ar: 'استهداف بمسيّرة', en: 'Drone strike', button_ar: 'استهداف بمسيّرة', button_en: 'Drone strike',
    emoji: '🎯', color: '#ff6b7a', ring: '#e11d48', group: 'aerial', ttlMin: 120,
    marker: 'orbit', glyph: 'uav_strike', zone: true, tag_ar: 'استهداف_بمسيّرة', tag_en: 'Drone_strike',
  },
  airstrike: {
    ar: 'غارة جوية', en: 'Airstrike', button_ar: 'غارة جوية', button_en: 'Airstrike',
    emoji: '💥', color: '#ef233c', ring: '#b42332', group: 'strikes', ttlMin: 180,
    marker: 'static', glyph: 'airstrike', disc: '#dc2626', zone: true, tag_ar: 'غارة_جوية', tag_en: 'Airstrike',
  },
  warplane: {
    ar: 'طيران حربي', en: 'Warplane', button_ar: 'طيران حربي', button_en: 'Warplane',
    emoji: '✈️', color: '#3b8eff', ring: '#1d4ed8', group: 'aerial', ttlMin: 60,
    marker: 'squad', glyph: 'plane', zone: 'dashed', tag_ar: 'طيران_حربي', tag_en: 'Warplane',
  },
  helicopter: {
    ar: 'طيران مروحي', en: 'Helicopter activity', button_ar: 'طيران مروحي (مروحية/مروحيات)', button_en: 'Helicopter(s)',
    emoji: '🚁', color: '#3b8eff', ring: '#1d4ed8', group: 'aerial', ttlMin: 60,
    marker: 'helicopter', glyph: 'helicopter_simple', zone: true, tag_ar: 'طيران_مروحي', tag_en: 'Helicopter',
  },
  air_movement: {
    ar: 'حركة طيران', en: 'Aircraft movement', button_ar: 'حركة طيران', button_en: 'Aircraft movement',
    emoji: '✈️', color: '#3b8eff', ring: '#1d4ed8', group: 'aerial', ttlMin: 60,
    marker: 'movement', glyph: 'plane', icon: '#3b8eff', zone: false, tag_ar: 'حركة_طيران', tag_en: 'Aircraft_movement',
  },
  border: {
    ar: 'تنبيه حدودي', en: 'Border alert', button_ar: 'الحدود', button_en: 'Border',
    emoji: '🚧', color: '#7c3aed', ring: '#5b21b6', group: 'other', ttlMin: 120,
    marker: 'icon', glyph: 'alert_tri', icon: '#7c3aed', zone: false, tag_ar: 'حدود', tag_en: 'Border',
  },
  military_incursion: {
    ar: 'توغل عسكري', en: 'Military incursion',
    button_ar: 'توغل عسكري', button_en: 'Military incursion',
    emoji: '🪖', color: '#71834a', ring: '#4b5c2f', group: 'other', ttlMin: 180,
    marker: 'icon', glyph: 'military_vehicle', icon: '#111827', disc: '#111827', size: 30, zone: 'dashed',
    tag_ar: 'توغل_عسكري', tag_en: 'Military_incursion',
  },
  patrol: {
    ar: 'دورية', en: 'Military patrol', button_ar: 'دورية', button_en: 'Patrol',
    emoji: '', color: '#526a7a', ring: '#354b5a', group: 'other', ttlMin: 180,
    marker: 'icon', glyph: 'patrol', icon: '#111827', disc: '#111827', size: 30, zone: 'dashed',
    tag_ar: 'دورية', tag_en: 'Patrol',
  },
  kidnapping: {
    ar: 'اختطاف', en: 'Kidnapping', button_ar: 'اختطاف', button_en: 'Kidnapping',
    emoji: '⛓️', color: '#7c2d12', ring: '#451a03', group: 'other', ttlMin: 360,
    marker: 'icon', glyph: 'handcuffs', icon: '#7c2d12', disc: '#451a03', size: 32, zone: false,
    tag_ar: 'اختطاف', tag_en: 'Kidnapping',
  },
  signal_sweep: {
    ar: 'رصد/مسح الإشارة', en: 'Signal sweep', button_ar: 'رصد/مسح الإشارة', button_en: 'Signal sweep',
    emoji: '📡', color: '#475569', ring: '#334155', group: 'other', ttlMin: 180,
    marker: 'icon', glyph: 'signal_sweep', icon: '#475569', size: 24, zone: false,
    tag_ar: 'رصد_الإشارة', tag_en: 'Signal_sweep',
  },
  smuggling_weapons: {
    ar: 'تهريب أسلحة', en: 'Weapons smuggling', button_ar: 'تهريب أسلحة', button_en: 'Weapons smuggling',
    emoji: '🔫', color: '#c2410c', ring: '#9a3412', group: 'smuggling', ttlMin: 360,
    marker: 'icon', glyph: 'smuggling_weapons', icon: '#c2410c', disc: '#7c2d12', size: 34, zone: false,
    tag_ar: 'تهريب_أسلحة', tag_en: 'Weapons_smuggling',
  },
  smuggling_drugs: {
    ar: 'تهريب مخدرات', en: 'Drug smuggling', button_ar: 'تهريب مخدرات', button_en: 'Drug smuggling',
    emoji: '💊', color: '#7c3aed', ring: '#5b21b6', group: 'smuggling', ttlMin: 360,
    marker: 'icon', glyph: 'smuggling_drugs', icon: '#7c3aed', disc: '#3b0764', size: 34, zone: false,
    tag_ar: 'تهريب_مخدرات', tag_en: 'Drug_smuggling',
  },
  smuggling_explosives: {
    ar: 'تهريب متفجرات', en: 'Explosives smuggling', button_ar: 'تهريب متفجرات', button_en: 'Explosives smuggling',
    emoji: '🧨', color: '#d97706', ring: '#92400e', group: 'smuggling', ttlMin: 360,
    marker: 'icon', glyph: 'smuggling_explosives', icon: '#d97706', disc: '#78350f', size: 34, zone: false,
    tag_ar: 'تهريب_متفجرات', tag_en: 'Explosives_smuggling',
  },
  missile: {
    ar: 'صواريخ', en: 'Missiles', button_ar: 'صواريخ', button_en: 'Missiles',
    emoji: '🚀', color: '#7f1d1d', ring: '#450a0a', group: 'aerial', ttlMin: 180,
    marker: 'icon', glyph: 'missile_ic', icon: '#c0262d', disc: '#000000', zone: false, tag_ar: 'صواريخ', tag_en: 'Missiles',
  },
  attack: {
    ar: 'هجوم', en: 'Attack', button_ar: 'هجوم', button_en: 'Attack',
    emoji: '⚔️', color: '#b91c1c', ring: '#7f1d1d', group: 'strikes', ttlMin: 360,
    marker: 'static', glyph: 'crossed_swords', disc: '#dc2626', zone: false, tag_ar: 'هجوم', tag_en: 'Attack',
  },
  clashes: {
    ar: 'اشتباكات مسلحة', en: 'Armed clashes', button_ar: 'اشتباكات', button_en: 'Armed clashes',
    emoji: '⚔️', color: '#be123c', ring: '#881337', group: 'strikes', ttlMin: 240,
    marker: 'static', glyph: 'clashes', disc: '#be123c', zone: false, tag_ar: 'اشتباكات', tag_en: 'Armed_clashes',
  },
  assassination: {
    ar: 'اغتيال', en: 'Assassination', button_ar: 'اغتيال', button_en: 'Assassination',
    emoji: '', color: '#b91c1c', ring: '#7f1d1d', group: 'strikes', ttlMin: 360,
    marker: 'icon', glyph: 'pistol', icon: '#111827', size: 32, zone: false, tag_ar: 'اغتيال', tag_en: 'Assassination',
  },
  artillery: {
    ar: 'قصف مدفعي', en: 'Artillery shelling', button_ar: 'قصف مدفعي', button_en: 'Artillery',
    emoji: '💣', color: '#f97316', ring: '#f97316', group: 'strikes', ttlMin: 360,
    marker: 'static', glyph: 'artillery', disc: '#f97316', zone: false, tag_ar: 'قصف_مدفعي', tag_en: 'Artillery',
  },
  explosion: {
    ar: 'انفجار', en: 'Explosion', button_ar: 'انفجار', button_en: 'Explosion',
    emoji: '💥', color: '#f04452', ring: '#b42332', group: 'strikes', ttlMin: 240,
    marker: 'icon', glyph: 'explosion_modern', icon: '#f04452', size: 36, zone: false, tag_ar: 'انفجار', tag_en: 'Explosion',
  },
  detonation: {
    ar: 'تفجير', en: 'Detonation', button_ar: 'تفجير', button_en: 'Detonation',
    emoji: '💥', color: '#f04452', ring: '#b42332', group: 'strikes', ttlMin: 240,
    marker: 'icon', glyph: 'detonation_burst', icon: '#f04452', size: 24, zone: false, tag_ar: 'تفجير', tag_en: 'Detonation',
  },
  civil: {
    ar: 'مدني', en: 'Civil alert', button_ar: 'مدني', button_en: 'Civil',
    emoji: '🛡️', color: '#0891b2', ring: '#155e75', group: 'civil', ttlMin: 240,
    marker: 'icon', glyph: 'civil_shield', icon: '#0891b2', disc: '#000000', zone: false, tag_ar: 'مدني', tag_en: 'Civil',
  },
  accident: {
    ar: 'حادث سير', en: 'Traffic accident', button_ar: 'حادث سير', button_en: 'Traffic accident',
    emoji: '🚗', color: '#f59e0b', ring: '#b45309', group: 'civil', parent: 'civil', ttlMin: 120,
    marker: 'icon', glyph: 'car_crash', icon: '#f59e0b', size: 32, zone: false, tag_ar: 'حادث_سير', tag_en: 'Accident',
  },
  protest: {
    ar: 'مظاهرة', en: 'Demonstration', button_ar: 'مظاهرة', button_en: 'Demonstration',
    emoji: '👥', color: '#7c3aed', ring: '#5b21b6', group: 'civil', parent: 'civil', ttlMin: 240,
    marker: 'icon', glyph: 'protest', icon: '#7c3aed', size: 32, zone: false, tag_ar: 'مظاهرة', tag_en: 'Demonstration',
  },
  protest_action: {
    ar: 'احتجاج', en: 'Protest', button_ar: 'احتجاج', button_en: 'Protest',
    emoji: '📢', color: '#7c3aed', ring: '#5b21b6', group: 'civil', parent: 'civil', ttlMin: 240,
    marker: 'icon', glyph: 'megaphone', icon: '#7c3aed', size: 32, zone: false, tag_ar: 'احتجاج', tag_en: 'Protest',
  },
  fire: {
    ar: 'حريق', en: 'Fire', button_ar: 'حريق', button_en: 'Fire',
    emoji: '🔥', color: '#ea580c', ring: '#9a3412', group: 'civil', parent: 'civil', ttlMin: 240,
    marker: 'icon', glyph: 'fire_modern', icon: '#ea580c', size: 34, zone: false, tag_ar: 'حريق', tag_en: 'Fire',
  },
  civil_plane: {
    ar: 'طائرة مدنية', en: 'Civil aircraft', button_ar: 'طائرة مدنية', button_en: 'Civil aircraft',
    emoji: '🛫', color: '#0284c7', ring: '#075985', group: 'civil', parent: 'civil', ttlMin: 60,
    marker: 'icon', glyph: 'airliner', icon: '#0284c7', zone: false, tag_ar: 'طائرة_مدنية', tag_en: 'Civil_aircraft',
  },
  arrest: {
    ar: 'اعتقال', en: 'Arrest', button_ar: 'اعتقال', button_en: 'Arrest',
    emoji: '🚔', color: '#d97706', ring: '#92400e', group: 'civil', parent: 'civil', ttlMin: 240,
    marker: 'icon', glyph: 'handcuffs', icon: '#d97706', zone: false, tag_ar: 'اعتقال', tag_en: 'Arrest',
  },
  death: {
    ar: 'وفاة', en: 'Death', button_ar: 'وفاة', button_en: 'Death',
    emoji: '🪦', color: '#6b7280', ring: '#374151', group: 'civil', parent: 'civil', ttlMin: 240,
    marker: 'icon', glyph: 'grave', icon: '#6b7280', zone: false, tag_ar: 'وفاة', tag_en: 'Death',
  },
  martyrdom: {
    ar: 'استشهاد', en: 'Martyrdom', button_ar: 'استشهاد', button_en: 'Martyrdom',
    emoji: '🕊️', color: '#b91c1c', ring: '#7f1d1d', group: 'civil', parent: 'civil', ttlMin: 240,
    marker: 'icon', glyph: 'dove', icon: '#b91c1c', zone: false, tag_ar: 'استشهاد', tag_en: 'Martyrdom',
  },
  brawl: {
    ar: 'مشاجرة', en: 'Brawl', button_ar: 'مشاجرة', button_en: 'Brawl',
    emoji: '👊', color: '#7c3aed', ring: '#5b21b6', group: 'civil', parent: 'civil', ttlMin: 240,
    marker: 'icon', glyph: 'fists', icon: '#7c3aed', size: 32, zone: false, tag_ar: 'مشاجرة', tag_en: 'Brawl',
  },
  shooting: {
    ar: 'إطلاق نار', en: 'Gunfire', button_ar: 'إطلاق نار', button_en: 'Gunfire',
    emoji: '', color: '#dc2626', ring: '#991b1b', group: 'civil', parent: 'civil', ttlMin: 240,
    marker: 'icon', glyph: 'gunfire', icon: '#111827', size: 32, zone: false, tag_ar: 'إطلاق_نار', tag_en: 'Gunfire',
  },
  quake: {
    ar: 'زلزال', en: 'Earthquake', button_ar: 'زلزال', button_en: 'Earthquake',
    emoji: '🌍', color: '#a16207', ring: '#713f12', group: 'nature', ttlMin: 180,
    marker: 'icon', glyph: 'quake', icon: '#a16207', disc: '#000000', zone: 'dashed', tag_ar: 'زلزال', tag_en: 'Earthquake',
  },
  weather: {
    ar: 'تحذير جوي', en: 'Weather warning', button_ar: 'تحذير جوي', button_en: 'Weather',
    emoji: '⛈️', color: '#4f46e5', ring: '#3730a3', group: 'nature', ttlMin: 720,
    marker: 'icon', glyph: 'storm', icon: '#4f46e5', disc: '#000000', zone: 'dashed', tag_ar: 'طقس', tag_en: 'Weather',
  },
};

// Zone radius (km) by location scope — same values as the original map.
export const ZONE_KM = { place: 1.5, point: 1.5, village: 1.5, multi: 3, district: 8, governorate: 20 };
export const TYPE_KEYS = Object.keys(ALERT_TYPES);

export const POLITICAL_CATEGORIES = Object.freeze({
  agreement: { emoji: '🤝', ar: 'اتفاق', en: 'Agreement' },
  signing: { emoji: '🖊️', ar: 'توقيع', en: 'Signing' },
  treaty: { emoji: '📜', ar: 'اتفاقية', en: 'Treaty / agreement' },
  circular: { emoji: '📄', ar: 'تعميم', en: 'Circular' },
  support: { emoji: '🫱🏻‍🫲🏼', ar: 'دعم', en: 'Support' },
  military_cooperation: { emoji: '🪖', ar: 'تعاون عسكري', en: 'Military cooperation' },
  statement: { emoji: '💬', ar: 'تصريح', en: 'Statement' },
  position: { emoji: '🗣️', ar: 'موقف', en: 'Position' },
  decision: { emoji: '📜', ar: 'قرار', en: 'Decision' },
  appointment: { emoji: '👤', ar: 'تعيين', en: 'Appointment' },
  official_announcement: { emoji: '📢', ar: 'إعلان رسمي', en: 'Official announcement' },
  government_announcement: { emoji: '🏛️', ar: 'إعلان حكومي', en: 'Government announcement' },
  official_entity: { emoji: '🏢', ar: 'جهة رسمية', en: 'Official entity' },
  negotiation: { emoji: '🤝', ar: 'مفاوضات', en: 'Negotiations' },
  meeting: { emoji: '👥', ar: 'لقاء', en: 'Meeting' },
  visit: { emoji: '🚶', ar: 'زيارة', en: 'Visit' },
  election: { emoji: '🗳️', ar: 'انتخابات', en: 'Election' },
});

export const ALERT_GROUPS = {
  aerial: { ar: 'نشاط جوّي', en: 'Aerial activity', types: ['uav', 'uav_strike', 'warplane', 'helicopter', 'air_movement', 'missile'] },
  strikes: { ar: 'هجمات وقصف', en: 'Attacks & shelling', types: ['attack', 'clashes', 'assassination', 'artillery', 'airstrike', 'explosion', 'detonation'] },
  civil: { ar: 'مدني', en: 'Civil', types: ['civil', 'accident', 'protest', 'protest_action', 'fire', 'civil_plane', 'arrest', 'death', 'martyrdom', 'brawl', 'shooting'] },
  nature: { ar: 'زلازل وطقس', en: 'Quakes & weather', types: ['quake', 'weather'] },
  political: { ar: 'تطورات سياسية', en: 'Political developments', types: ['political'] },
  smuggling: { ar: 'تهريب', en: 'Smuggling', types: ['smuggling_weapons', 'smuggling_drugs', 'smuggling_explosives'] },
  other: { ar: 'أخرى', en: 'Other', types: ['breaking', 'border', 'military_incursion', 'patrol', 'kidnapping', 'signal_sweep'] },
};

// Shared channel/map visual language. Event-specific ALERT_TYPES colors remain
// available for legacy UI and severity; these colors are only for category coding.
const EVENT_PALETTES = Object.freeze({
  breaking: Object.freeze({ dot: '🔴', color: '#ef233c' }),
  weather: Object.freeze({ dot: '🟣', color: '#6d28d9' }),
  political: Object.freeze({ dot: '🟡', color: '#a16207' }),
  aerial: Object.freeze({ dot: '🔵', color: '#2476c9' }),
  strikes: Object.freeze({ dot: '🟠', color: '#c2410c' }),
  civil: Object.freeze({ dot: '🟢', color: '#15803d' }),
  quake: Object.freeze({ dot: '🟤', color: '#92400e' }),
  security: Object.freeze({ dot: '⚫', color: '#374151' }),
});
const EVENT_CATEGORY_OVERRIDES = Object.freeze({ breaking: 'breaking', weather: 'weather', political: 'political', quake: 'quake', border: 'security', military_incursion: 'security', patrol: 'security', kidnapping: 'security', signal_sweep: 'security', smuggling_weapons: 'security', smuggling_drugs: 'security', smuggling_explosives: 'security' });
const ALERT_GROUP_BY_TYPE = new Map(Object.entries(ALERT_GROUPS).flatMap(([group, value]) => value.types.map((type) => [type, group])));
export const EVENT_VISUALS = Object.freeze(Object.fromEntries(TYPE_KEYS.map((type) => {
  const category = EVENT_CATEGORY_OVERRIDES[type] || ALERT_GROUP_BY_TYPE.get(type) || 'security';
  return [type, Object.freeze({ category, ...EVENT_PALETTES[category] })];
})));
export const eventVisual = (type) => EVENT_VISUALS[type] || EVENT_VISUALS.breaking;

export const BORDER_REGIONS = {
  iraq: { ar: 'الحدود السورية–العراقية', en: 'Syrian–Iraqi border' },
  jordan: { ar: 'الحدود السورية–الأردنية', en: 'Syrian–Jordanian border' },
  lebanon: { ar: 'الحدود السورية–اللبنانية', en: 'Syrian–Lebanese border' },
  turkey: { ar: 'الحدود السورية–التركية', en: 'Syrian–Turkish border' },
  palestine: { ar: 'الحدود السورية–الفلسطينية', en: 'Syrian–Palestinian border' },
};

// Border alerts use exact map locations rather than governorate centers.
export const BORDER_MARKERS = {
  iraq: { lat: 34.3958, lon: 40.9773, ar: 'قرب معبر البوكمال', en: 'Near Al-Bukamal crossing' },
  jordan: { lat: 32.5424, lon: 36.2029, ar: 'قرب معبر نصيب', en: 'Near Nasib crossing' },
  lebanon: { lat: 33.6579, lon: 35.9777, ar: 'قرب معبر جديدة يابوس', en: 'Near Jdeidet Yabous crossing' },
  turkey: { lat: 36.2305, lon: 36.6927, ar: 'قرب معبر باب الهوى', en: 'Near Bab al-Hawa crossing' },
  palestine: { lat: 33.113, lon: 35.817, ar: 'على خط الحدود قرب القنيطرة', en: 'On the border line near Quneitra' },
};

export const FLIGHT_DIRECTIONS = {
  toward_syria: { ar: 'باتجاه سوريا', en: 'Toward Syria' },
  entering_syria: { ar: 'دخول الأجواء السورية', en: 'Entering Syrian airspace' },
  leaving_syria: { ar: 'انسحاب إلى الداخل الإسرائيلي', en: 'Withdrawal into Israel' },
};

export const FLIGHT_AIRCRAFT = {
  warplane: { ar: 'طيران حربي', en: 'Warplane' },
  uav: { ar: 'مسيّرة', en: 'Drone' },
};

export const CIVIL_EMOJIS = {
  protection: { emoji: '🛡️', ar: 'حماية مدنية', en: 'Civil protection' },
  people: { emoji: '🧑‍🤝‍🧑', ar: 'مدنيون', en: 'Civilians' },
  housing: { emoji: '🏘️', ar: 'منطقة سكنية', en: 'Residential area' },
  emergency: { emoji: '🆘', ar: 'استغاثة', en: 'Emergency' },
  warning: { emoji: '⚠️', ar: 'تنبيه عام', en: 'General warning' },
  medical: { emoji: '🚑', ar: 'إسعاف', en: 'Medical aid' },
};

export function typeOf(key) {
  return ALERT_TYPES[key] || ALERT_TYPES.breaking;
}

export function alertButtonLabel(key, lang = 'ar') {
  const type = typeOf(key);
  const label = lang === 'en' ? type.button_en : type.button_ar;
  const emoji = key === 'smuggling_weapons' ? '' : type.emoji;
  return [emoji, label].filter(Boolean).join(' ');
}

// Return a weapon silhouette only when the report explicitly identifies a firearm.
function describedFirearmGlyph(alert) {
  const text = [alert.title, alert.title_en, alert.description, alert.description_en, alert.details, alert.text]
    .filter(Boolean).join(' ').toLowerCase().normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
  const rifle = /(?:كلاشنكوف|كلاشينكوف|كلاش|بندقيه|رشاش|\b(?:assault\s+)?rifles?\b|\bkalashnikov\b|\bak(?:[- ]?(?:47|74|m))?\b)/i.test(text);
  const pistol = /(?:مسدس|طبنجه|\bpistols?\b|\bhandguns?\b|\brevolvers?\b)/i.test(text);
  return rifle && !pistol ? 'rifle' : pistol ? 'pistol' : null;
}

export function assassinationWeaponGlyph(alert) {
  return alert?.type === 'assassination' ? describedFirearmGlyph(alert) || 'pistol' : null;
}

// Gunfire is an event, not a weapon claim: use sound waves by default and show a
// firearm only when the report explicitly identifies one.
export function shootingWeaponGlyph(alert) {
  return alert?.type === 'shooting' ? describedFirearmGlyph(alert) || 'gunfire' : null;
}

export function dimColor(hex, alpha = 0.12) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Weather warnings: the emoji follows the hazard (⛈ stays only as the generic type label)
export const HAZARD_EMOJI = { rain: '🌧', snow: '❄️', wind: '💨', storm: '⛈', heat: '🌡', frost: '🥶', dust: '🌫' };
export const alertEmoji = (a) => (a?.type === 'weather' && HAZARD_EMOJI[a.hazard || a.meta?.hazard])
  || (a?.type === 'civil' && CIVIL_EMOJIS[a.civil_emoji || a.meta?.civilEmoji]?.emoji)
  || typeOf(a?.type).emoji;

// ---- drones on the map: 1 per circle normally; an intensive flight ("تحليق مكثف", "عدة مسيّرات") shows 2,
// a swarm ("سرب") 3. meta.intense (the "تحليق مكثف" switch in the bot) overrides what the text says.
const _dn = (s) => String(s || '').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[إأآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();
export function droneAuto(text) {
  const t = _dn(text);
  if (/سرب|اسراب|swarm/.test(t)) return 3;
  if (/مكثف|كثيف|عده مسيرات|عدد من المسيرات|عده طائرات مسيره|طائرات مسيره|مسيرات|طيران مسير مكثف|intens|several drones|multiple drones/.test(t)) return 2;
  return 1;
}
export function droneLevel(a) {
  if (!a || a.type !== 'uav') return 0;
  const auto = droneAuto(`${a.title || ''} ${a.description || ''}`);
  if (a.meta && a.meta.intense === true) return Math.max(2, auto);
  if (a.meta && a.meta.intense === false) return 1;
  return auto;
}
