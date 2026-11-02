import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const services = readFileSync(new URL('../public/js/services.js', import.meta.url), 'utf8');

test('weather services explain unavailable official forecasts and clarify the hidden-news layer', () => {
  assert.match(services, /wxNoAlerts: 'لا توجد حالياً تحذيرات جوية نشطة في موجز المركز\.'/);
  assert.match(services, /wxForecastUnavailable: 'ولا تتوفر حالياً درجات حرارة أو توقعات في بيانات المركز\.'/);
  assert.match(services, /if \(j\.forecastsAvailable === false\) h \+= `\<p class="svc-note"\>/);
  assert.match(services, /modeHint: 'طبقة الأخبار مخفية مؤقتاً أثناء عرض الخدمات'/);
  assert.match(services, /wxForecastUnavailable: 'The Center’s current data does not provide temperatures or forecasts\.'/);
  assert.match(services, /modeHint: 'The news layer is temporarily hidden while services are displayed'/);
});
