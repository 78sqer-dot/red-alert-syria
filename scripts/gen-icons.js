// Dev helper: extracts the Tabler icons (MIT) used by the site into public/js/icons.js
import fs from 'node:fs';
const base = new URL('../node_modules/@tabler/icons/icons/', import.meta.url).pathname;
const want = {
  drone: 'outline/drone', plane: 'filled/plane', planeO: 'outline/plane-tilt', rocket: 'outline/rocket', bomb: 'filled/bomb', swords: 'outline/swords',
  bolt: 'filled/bolt', ambulance: 'outline/ambulance', target: 'outline/target', flame: 'filled/flame', telegram: 'outline/brand-telegram',
  whatsapp: 'outline/brand-whatsapp', settings: 'outline/settings', moon: 'outline/moon', sun: 'outline/sun', filter: 'outline/filter', layers: 'outline/stack-2',
  map: 'outline/map', mapPin: 'outline/map-pin', share: 'outline/share', x: 'outline/x', chevUp: 'outline/chevron-up', chevDown: 'outline/chevron-down',
  chevLeft: 'outline/chevron-left', chevRight: 'outline/chevron-right', copy: 'outline/copy', bell: 'outline/bell', volume: 'outline/volume', info: 'outline/info-circle',
  plus: 'outline/plus', minus: 'outline/minus', list: 'outline/list', clock: 'outline/clock', world: 'outline/world', language: 'outline/language',
  play: 'filled/player-play', check: 'outline/check', link: 'outline/link', speaker: 'outline/speakerphone', alert: 'filled/alert-triangle', alertO: 'outline/alert-triangle',
  mountain: 'filled/mountain', users: 'outline/users', hospital: 'outline/building-hospital', radar: 'outline/radar', locate: 'outline/current-location', heart: 'outline/heart',
  news: 'outline/news', urgent: 'outline/urgent', eye: 'outline/eye', vibrate: 'outline/device-mobile-vibration', route: 'outline/route', shield: 'outline/shield-half',
};
const lines = ['// Tabler Icons (MIT) — https://tabler.io/icons', 'export const ICONS = {'];
for (const [k, p] of Object.entries(want)) {
  const f = base + p + '.svg';
  if (!fs.existsSync(f)) { console.warn('missing', p); continue; }
  const svg = fs.readFileSync(f, 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<path stroke="none" d="M0 0h24v24H0z" fill="none" \/>/, '').replace(/\s*\n\s*/g, '').trim();
  lines.push(`  ${k}: { filled: ${p.startsWith('filled')}, body: ${JSON.stringify(inner)} },`);
}
lines.push('};', '', 'export function icon(name, size = 18, extra = \'\') {', '  const i = ICONS[name];', '  if (!i) return \'\';', "  const attrs = i.filled ? 'fill=\"currentColor\" stroke=\"none\"' : 'fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"';", '  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ${attrs} aria-hidden="true" ${extra}>${i.body}</svg>`;', '}', '');
fs.mkdirSync(new URL('../public/js/', import.meta.url).pathname, { recursive: true });
fs.writeFileSync(new URL('../public/js/icons.js', import.meta.url).pathname, lines.join('\n'));
console.log('icons written');
