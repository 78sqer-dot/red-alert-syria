const ICON = { rain: 'rain', storm: 'storm', snow: 'snow', wind: 'wind', dust: 'dust', fog: 'fog', heat: 'sun', frost: 'snow' };

function iconFor(hazard) {
  const h = String(hazard || '').toLowerCase();
  if (/snow|ice|frost|ثلج|صقيع|جليد/.test(h)) return ICON.snow;
  if (/rain|storm|thunder|flood|مطر|رعد|سيول|عاصفة/.test(h)) return /wind|رياح/.test(h) ? ICON.wind : ICON.storm;
  if (/wind|رياح/.test(h)) return ICON.wind;
  if (/dust|sand|غبار|أتربة|ترابية/.test(h)) return ICON.dust;
  if (/fog|ضباب/.test(h)) return ICON.fog;
  if (/heat|hot|حرارة|حر/.test(h)) return ICON.heat;
  return ICON.storm;
}

/** One map feature per affected governorate; markers are indicative coverage, not a precise hazard boundary. */
export function weatherWarningFeatures(warnings = [], governorateCenters = {}, lang = 'ar') {
  const byGovernorate = new Map();
  for (const warning of warnings || []) {
    for (const rawCode of Array.isArray(warning.govs) ? warning.govs : []) {
      const code = String(rawCode);
      const center = governorateCenters[code];
      if (!center || !Number.isFinite(center[0]) || !Number.isFinite(center[1])) continue;
      const level = Number.isFinite(Number(warning.level)) ? Number(warning.level) : 1;
      const current = byGovernorate.get(code);
      if (!current || level > current.level) byGovernorate.set(code, { warning, level });
    }
  }
  const features = [];
  for (const [code, { warning, level }] of byGovernorate) {
    const center = governorateCenters[code];
    const name = lang === 'en' ? (center[3] || center[2] || code) : (center[2] || code);
    features.push({
      type: 'Feature',
      properties: {
        id: `warning:${code}`,
        gov: code,
        warning: 1,
        main: 1,
        warn: level,
        icon: `svc-wx-${iconFor(warning.hazard)}`,
        tt: lang === 'en' ? 'Warning' : 'تحذير',
        name,
      },
      geometry: { type: 'Point', coordinates: [center[1], center[0]] },
    });
  }
  return features;
}
