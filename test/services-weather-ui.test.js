import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ICONS, icon } from '../public/js/icons.js';

const services = readFileSync(new URL('../public/js/services.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('weather services explain unavailable official forecasts and clarify the hidden-news layer', () => {
  assert.match(services, /wxNoAlerts: 'لا توجد حالياً تحذيرات جوية نشطة في موجز المركز\.'/);
  assert.match(services, /wxForecastUnavailable: 'لا تتوفر حالياً درجات حرارة أو توقعات رقمية حديثة في موجز المركز\. النشرة اليومية الرسمية عبر الرابط أعلاه؛ تحقق من تاريخها قبل اعتمادها\.'/);
  assert.match(services, /if \(j\.forecastsAvailable === false\) h \+= `\<p class="svc-note"\>/);
  assert.match(services, /modeHint: 'طبقة الأخبار مخفية مؤقتاً أثناء عرض الخدمات'/);
  assert.match(services, /wxForecastUnavailable: 'No current numerical temperatures or forecasts are available in the Center’s feed\. The official daily bulletin is linked above; check its publication date before relying on it\.'/);
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
