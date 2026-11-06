import test from 'node:test';
import assert from 'node:assert/strict';
import { isOfficialGovernmentUrl } from '../server/services.js';

test('accepts official Syrian government and SANA source URLs', () => {
  assert.equal(isOfficialGovernmentUrl('https://petde.gov.sy/news/123'), true);
  assert.equal(isOfficialGovernmentUrl('https://climweb.med.gov.sy/api/cap/rss.xml'), true);
  assert.equal(isOfficialGovernmentUrl('https://sana.sy/economy/123'), true);
  assert.equal(isOfficialGovernmentUrl('https://www.sana.sy/'), true);
  assert.equal(isOfficialGovernmentUrl('https://t.me/sana_gov/189946'), true);
  assert.equal(isOfficialGovernmentUrl('https://t.me/SANA_GOV/189946?single'), true);
});

test('rejects market aggregators, lookalike domains, and non-web URLs', () => {
  assert.equal(isOfficialGovernmentUrl('https://sypnow.com/ar/fuel'), false);
  assert.equal(isOfficialGovernmentUrl('https://gov.sy.attacker.example/'), false);
  assert.equal(isOfficialGovernmentUrl('https://notgov.sy/'), false);
  assert.equal(isOfficialGovernmentUrl('https://t.me/qasiounar1/189946'), false);
  assert.equal(isOfficialGovernmentUrl('https://t.me/sana_gov/'), false);
  assert.equal(isOfficialGovernmentUrl('https://t.me.attacker.example/sana_gov/189946'), false);
  assert.equal(isOfficialGovernmentUrl('javascript:alert(1)'), false);
  assert.equal(isOfficialGovernmentUrl(''), false);
});
