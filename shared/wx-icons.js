// Weather conditions shared by the website (map markers / list) and the server (daily bulletin image).
// Line icons on a 24×24 grid, mostly from Lucide (ISC licence); drawn as strokes only.
const C = 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z';
const CB = 'M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242';
export const WX_ICONS = {
  sun: { color: '#f59e0b', paths: ['M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8', 'M12 2v2', 'M12 20v2', 'm4.93 4.93 1.41 1.41', 'm17.66 17.66 1.41 1.41', 'M2 12h2', 'M20 12h2', 'm6.34 17.66-1.41 1.41', 'm19.07 4.93-1.41 1.41'] },
  moon: { color: '#6366f1', paths: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'] },
  psun: { color: '#f59e0b', paths: ['M12 2v2', 'm4.93 4.93 1.41 1.41', 'M20 12h2', 'm19.07 4.93-1.41 1.41', 'M15.947 12.65a4 4 0 0 0-5.925-4.128', 'M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z'] },
  pmoon: { color: '#6366f1', paths: ['M13 16a3 3 0 1 1 0 6H7a5 5 0 1 1 4.9-6Z', 'M10.1 9A6 6 0 0 1 16 4a4 4 0 0 0 6 6 6 6 0 0 1-3 5.197'] },
  cloud: { color: '#64748b', paths: [C] },
  fog: { color: '#94a3b8', paths: [CB, 'M16 17H7', 'M17 21H9'] },
  rain: { color: '#2563eb', paths: [CB, 'M16 14v6', 'M8 14v6', 'M12 16v6'] },
  snow: { color: '#0ea5e9', paths: [CB, 'M8 15h.01', 'M8 19h.01', 'M12 17h.01', 'M12 21h.01', 'M16 15h.01', 'M16 19h.01'] },
  storm: { color: '#7c3aed', paths: ['M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973', 'm13 12-3 5h4l-3 5'] },
  wind: { color: '#0d9488', paths: ['M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2', 'M9.6 4.6A2 2 0 1 1 11 8H2', 'M12.6 19.4A2 2 0 1 0 14 16H2'] },
  dust: { color: '#b45309', paths: ['M3 8h10', 'M6 12h12', 'M3 16h9', 'M17 8h.01', 'M21 12h.01', 'M16 16h.01', 'M20 17h.01'] },
};
export const WX_LABEL = {
  ar: { sun: 'مشمس', moon: 'صافٍ', psun: 'غائم جزئياً', pmoon: 'غائم جزئياً', cloud: 'غائم', fog: 'ضباب', rain: 'ماطر', snow: 'ثلوج', storm: 'عواصف رعدية', wind: 'رياح نشطة', dust: 'غبار' },
  en: { sun: 'Sunny', moon: 'Clear', psun: 'Partly cloudy', pmoon: 'Partly cloudy', cloud: 'Cloudy', fog: 'Fog', rain: 'Rain', snow: 'Snow', storm: 'Thunderstorms', wind: 'Windy', dust: 'Dust' },
};
export const WX_EMOJI = { sun: '☀️', moon: '🌙', psun: '⛅', pmoon: '☁️', cloud: '☁️', fog: '🌫', rain: '🌧', snow: '❄️', storm: '⛈', wind: '💨', dust: '🌫' };
const SNOW = new Set([71, 73, 75, 77, 85, 86]);
/** WMO weather code (+ wind / dust) -> one of WX_ICONS' keys */
export function wxKind({ code, wind = 0, gust = 0, dust = 0, day = 1, daily = false }) {
  const c = Number(code);
  if (c >= 95) return 'storm';
  if (SNOW.has(c)) return 'snow';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
  if (dust >= (daily ? 400 : 300)) return 'dust';
  if (gust >= (daily ? 60 : 55) || wind >= 35) return 'wind';
  if (c === 45 || c === 48) return 'fog';
  if (c <= 1) return day ? 'sun' : 'moon';
  if (c === 2) return day ? 'psun' : 'pmoon';
  return 'cloud';
}
/** SVG markup of an icon (for server-side images): stroke icon scaled to `size`, top-left at x,y */
export function wxIconSvg(kind, x, y, size, color) {
  const ic = WX_ICONS[kind] || WX_ICONS.cloud;
  return `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${color || ic.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ic.paths.map((d) => `<path d="${d}"/>`).join('')}</g>`;
}
