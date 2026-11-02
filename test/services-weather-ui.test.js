import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ICONS, icon } from '../public/js/icons.js';

const services = readFileSync(new URL('../public/js/services.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const weatherServer = readFileSync(new URL('../server/wx-daily.js', import.meta.url), 'utf8');

test('weather map loads modeled data only when selected and keeps official warnings separately sourced', () => {
  assert.match(services, /wxNoAlerts: 'لا توجد حالياً تحذيرات جوية نشطة في موجز المركز\.'/);
  assert.match(services, /wxModelData: 'بيانات نموذجية وليست رصداً مباشراً'/);
  assert.match(services, /if \(k === 'weather'\) \{ loadWx\(\)\.catch\(\(\) => toast\(L\.wxErr\)\);/);
  assert.match(services, /if \(st\.tab === 'weather' &&[\s\S]{0,180}loadWx\(\)/);
  assert.match(services, /https:\/\/open-meteo\.com\/en\/licence/);
  assert.match(services, /Open‑Meteo/);
  assert.match(weatherServer, /forecastSource:\s*\{[\s\S]{0,160}name: 'Open-Meteo'/);
  assert.match(weatherServer, /warnings: warnings\.filter\(\(w\) => w\.official\)/);
  assert.match(weatherServer, /forecastsAvailable: points\.filter\([\s\S]{0,160}\)\.length >= 10/);
  const initStart = services.lastIndexOf('init() {');
  const initEnd = services.indexOf('setRoads(r)', initStart);
  assert.ok(initStart >= 0 && initEnd > initStart);
  assert.doesNotMatch(services.slice(initStart, initEnd), /loadWx\(/, 'startup background refresh must not fetch weather');
  const readyStart = weatherServer.indexOf('async function readyData()');
  const readyEnd = weatherServer.indexOf('export async function renderWxBulletin', readyStart);
  const bulletinData = weatherServer.slice(readyStart, readyEnd);
  assert.match(bulletinData, /return \{ ok: true, pts: \[\] \}/);
  assert.doesNotMatch(bulletinData, /getWeather\(\)/, 'modeled weather is not included in channel bulletins');
  assert.match(services, /if \(j\.forecastsAvailable === false\) h \+= `\<p class="svc-note"\>/);
  assert.match(services, /modeHint: 'طبقة الأخبار مخفية مؤقتاً أثناء عرض الخدمات'/);
  assert.match(services, /wxForecastUnavailable: 'تعذّر جلب بيانات الطقس النموذجية حالياً/);
  assert.match(services, /wxForecastUnavailable: 'Modeled weather data are temporarily unavailable/);
  assert.match(services, /modeHint: 'The news layer is temporarily hidden while services are displayed'/);
});

test('services toolbar and place icons exist and are registered for map display', () => {
  assert.match(html, /<button class="map-btn" id="btnSvc"[^>]*><span data-icon="apps"><\/span>/);
  assert.ok(ICONS.apps, 'the services entry button uses a defined apps icon');
  assert.match(icon('apps', 18), /<svg[^>]*viewBox="0 0 24 24"/);
  assert.match(app, /\$\$\('\[data-icon\]'\)\.forEach\(\(el\) => \{\s*if \(!el\.firstChild\) el\.innerHTML = icon\(el\.dataset\.icon, 18\)/);
  for (const category of ['hospital', 'clinic', 'pharmacy', 'fuel', 'bakery']) {
    assert.match(services, new RegExp(`'${category}':?`));
  }
  assert.match(services, /for \(const \[k, col\] of Object\.entries\(CAT_COLORS\)\) if \(!m\.hasImage\('svc-' \+ k\)\) m\.addImage\('svc-' \+ k, drawIcon\(k, col\)/);
  assert.match(services, /'icon-image': \['get', 'icon'\]/);
});
