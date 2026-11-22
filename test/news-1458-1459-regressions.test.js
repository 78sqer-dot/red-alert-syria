import test from 'node:test';
import assert from 'node:assert/strict';
import { localityQualifierOnly } from '../server/places.js';
import { cleanPublicNewsAttribution } from '../server/clean-text.js';

test('Jableh qualifying Snawbar is not a separate explosion site', () => {
  assert.equal(localityQualifierOnly('جبلة', 'الصنوبر', 'سماع دوي انفجار في منطقة صنوبر جبلة'), true);
  assert.equal(localityQualifierOnly('جبلة', 'الصنوبر', 'انفجار في الصنوبر وجبلة'), false);
  assert.equal(localityQualifierOnly('جبلة', 'الصنوبر', 'انفجار في صنوبر جبلة وانفجار ثان في جبلة'), false);
});
test('SANA reported attribution chain is retained inside source copy', () => {
  const text = 'أعلنت الإدارة إتلاف مواد مخدرة. ونقلت وكالة سانا عن الإدارة أن الكميات شملت أدوات تهريب.';
  assert.equal(cleanPublicNewsAttribution(text), text);
});
