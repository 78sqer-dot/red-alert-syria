import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const services = readFileSync(new URL('../public/js/services.js', import.meta.url), 'utf8');

test('weather services explain unavailable official forecasts and clarify the hidden-news layer', () => {
  assert.match(services, /wxNoAlerts: 'لا توجد حالياً تحذيرات جوية نشطة في موجز المركز\.'/);
  assert.match(services, /wxForecastUnavailable: 'لا تتوفر حالياً درجات حرارة أو توقعات رقمية حديثة في موجز المركز\. النشرة اليومية الرسمية عبر الرابط أعلاه؛ تحقق من تاريخها قبل اعتمادها\.'/);
  assert.match(services, /if \(j\.forecastsAvailable === false\) h \+= `\<p class="svc-note"\>/);
  assert.match(services, /modeHint: 'طبقة الأخبار مخفية مؤقتاً أثناء عرض الخدمات'/);
  assert.match(services, /wxForecastUnavailable: 'No current numerical temperatures or forecasts are available in the Center’s feed\. The official daily bulletin is linked above; check its publication date before relying on it\.'/);
  assert.match(services, /modeHint: 'The news layer is temporarily hidden while services are displayed'/);
});
