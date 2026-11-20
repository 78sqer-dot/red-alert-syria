import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractFlightDirection } from '../server/news-ai.js';

test('flight direction is extracted from air-report phrasing and honestly absent otherwise', () => {
  assert.equal(extractFlightDirection('رصد طيران حربي إسرائيلي محلق باتجاه الجولان المحتل'), 'الجولان المحتل');
  assert.equal(extractFlightDirection('مسيّرة تركية متجهة نحو العمق السوري، حسب مراصد'), 'العمق السوري');
  assert.equal(extractFlightDirection('طيران مروحي متجهاً نحو ريف دمشق الغربي الآن'), 'ريف دمشق الغربي');
  assert.equal(extractFlightDirection('تحليق مسيّرة فوق الزبداني'), null, 'no direction stated, none shown');
  assert.equal(extractFlightDirection('القبض على المخطط بعد نحو 12 عاماً'), null, 'نحو as "about" is not a heading');
  assert.equal(extractFlightDirection('السير باتجاه واحد عند المعبر'), null, 'borders one-way phrasing is not a heading');
});

test('the heading flows through monitor draft, channel post, and the public API', () => {
  const mon = readFileSync(new URL('../server/news-monitor.js', import.meta.url), 'utf8');
  assert.match(mon, /includes\(r\.type\) && extractFlightDirection\(it\.text\) \? \{ flightHeading/, 'monitor stores the parsed heading on air drafts');
  assert.match(mon, /\.\.\.\(d\.flightHeading \? \{ flightHeading: d\.flightHeading \} : \{\}\)/, 'bot draft carries the heading');
  assert.match(mon, /🧭 <b>\$\{tr\(lang, 'الاتجاه', 'Heading'\)\}/, 'reviewer card shows the heading');
  const bot = readFileSync(new URL('../server/bot.js', import.meta.url), 'utf8');
  assert.match(bot, /alert\.meta\?\.flightHeading\) title \+= ` — باتجاه /, 'channel post title carries the heading');
  assert.match(bot, /d\.flightHeading \? ` — باتجاه \$\{d\.flightHeading\}`/, 'published alert title carries the heading');
  const store = readFileSync(new URL('../server/store.js', import.meta.url), 'utf8');
  assert.match(store, /flight_heading: \['uav', 'uav_strike', 'warplane', 'helicopter'\]/, 'public API exposes flight_heading for the relay');
});
