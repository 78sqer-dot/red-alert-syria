import test from 'node:test';
import assert from 'node:assert/strict';
import { locationFrom } from '../server/places.js';
import { scanTextPlaces } from '../server/news-ai.js';
import { newsIncidentLocations } from '../server/news-incident-location.js';
import { ensureBuiltAlertLocation } from '../server/publish-location-guard.js';

// Post 1648, alert f7856e9e-b3dc-4a10-a1ad-30f92e2f5c6a.
// Local prevention regression. Historical post 1648 is a separate correction task.
const title = 'هجوم — كوروزامات';
const spaced = 'مراسل الخابور: استهدف مجهولون مدرعة تركية في قرية كوروزامات بريف الرقة الشمالي، دون وقوع إصابات.';
const glued = 'استهداف مدرعة تركية بقرية كوروزامات بريف الرقة الشمالي دون وقوع إصابات.';

test('nationality on an armored vehicle is not Turkiyah village', () => {
  for (const source of [spaced, glued]) {
    assert.ok(!scanTextPlaces(source, '04').includes(6900));
  }
});

test('an unresolved named village must not rebound to the nationality adjective', () => {
  for (const sourceText of [spaced, glued]) {
    const incident = newsIncidentLocations(sourceText, locationFrom({ placeId: 6900 }));
    assert.equal(incident.location.name_ar, 'كوروزامات');
    assert.ok(!Number.isFinite(incident.location.latitude));
    const input = { type: 'attack', title, description: sourceText, location: incident.location, meta: { sourceText } };
    const result = ensureBuiltAlertLocation(input, { sourceText });
    assert.equal(result.action, 'held');
    assert.ok(input.location?.place_id !== 6900);
  }
});

test('a real explicitly named Turkiyah village remains resolvable', () => {
  const sourceText = 'انفجار في قرية تركية بريف الرقة.';
  assert.ok(scanTextPlaces(sourceText, '04').includes(6900));
  const input = { type: 'explosion', title: 'انفجار في قرية تركية', description: sourceText, location: locationFrom({ placeId: 6900 }), meta: { sourceText } };
  assert.equal(ensureBuiltAlertLocation(input, { sourceText }).action, 'present');
});


test('the final funnel cannot replace an unresolved village label with a different incidental place', () => {
  const sourceText = 'استهداف مدرعة تركية في قرية كوروزامات بريف الرقة، ومصدر من قرية تركية يتابع الخبر.';
  const input = { type: 'attack', title, description: sourceText,
    location: { scope: 'governorate', name_ar: 'كوروزامات', governorate: '04', governorate_ar: 'الرقة' },
    meta: { sourceText } };
  assert.equal(ensureBuiltAlertLocation(input, { sourceText }).action, 'held');
  assert.equal(input.location.name_ar, 'كوروزامات');
  assert.ok(!Number.isFinite(input.location.latitude));
});

test('nationality filtering handles definite and prefixed vehicle nouns without banning explicit place frames', () => {
  for (const noun of ['مدرعة', 'المدرعة', 'لمدرعة', 'بالمدرعة', 'دورية', 'سيارة']) {
    assert.ok(!scanTextPlaces('استهداف ' + noun + ' تركية بريف الرقة', '04').includes(6900), noun);
  }
  for (const phrase of ['في قرية تركية', 'بقرية تركية', 'في بلدة تركية', 'طائرة مسيرة في قرية تركية', 'آلية عسكرية قرب قرية تركية']) {
    assert.ok(scanTextPlaces('انفجار ' + phrase + ' بريف الرقة', '04').includes(6900), phrase);
  }
});

test('modified vehicle nationality is not a location', () => {
  for (const phrase of ['طائرة مسيرة تركية','طائرة مسيّرة تركية','آلية عسكرية تركية','مدرعة عسكرية تركية','جرافة تركية','عربة تركية','شاحنة تركية','جرار تركي','طائرات مسيرة عسكرية تركية']) {
    assert.ok(!scanTextPlaces('استهداف '+phrase+' بريف الرقة', '04').includes(6900), phrase);
  }
});

test('multiple unresolved named villages cannot leave an incidental nationality pin present', () => {
  for (const frame of ['في قريتي كوروزامات وخربوزات','في قريتين كوروزامات وخربوزات','في قرية كوروزامات وقرية خربوزات']) {
    const sourceText='استهداف طائرة مسيرة تركية '+frame+' بريف الرقة.';
    const incident=newsIncidentLocations(sourceText,locationFrom({placeId:6900}));
    assert.ok(!Number.isFinite(incident.location.latitude),frame);
    assert.ok(incident.location.name_ar.includes('كوروزامات'),frame);
    const input={type:'attack',title:'هجوم',description:sourceText,location:incident.location,meta:{sourceText}};
    assert.equal(ensureBuiltAlertLocation(input,{sourceText}).action,'held',frame);
  }
});

test('the unresolved-label guard preserves its explicit urban parent-city fallback', () => {
  const sourceText='سماع أصوات اشتباكات في حي المشيرفة في مدينة الحسكة.';
  const input={type:'clashes',title:'اشتباكات في حي المشيرفة',description:sourceText,
    location:{scope:'governorate',name_ar:'حي المشيرفة',governorate:'01',governorate_ar:'الحسكة',governorate_en:'Al Hasakah'},
    meta:{sourceText}};
  const result=ensureBuiltAlertLocation(input,{sourceText});
  assert.equal(result.action,'bound');
  assert.equal(input.location.scope,'place');
  assert.equal(input.location.name_ar,'الحسكة');
  assert.equal(input.location.place_id,173811);
  assert.equal(input.place,input.location);
});
