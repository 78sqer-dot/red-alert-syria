import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanSupportLabel,
  parseWalletPhone,
  publicSupportSettings,
  sanitizeSupportSettings,
} from '../server/support-config.js';

test('support is hidden by default and for incomplete or invalid settings', () => {
  assert.equal(publicSupportSettings(), null);
  assert.equal(publicSupportSettings({ enabled: true, walletName: 'Wallet' }), null);
  assert.equal(publicSupportSettings({ enabled: true, walletPhone: 'not-a-number' }), null);
  assert.equal(sanitizeSupportSettings({ enabled: true, walletName: 'Wallet', walletPhone: 'not-a-number' }).enabled, false);
});

test('wallet number parser rejects malformed values', () => {
  assert.equal(parseWalletPhone('not-a-number').ok, false);
  assert.equal(parseWalletPhone('').ok, false);
  assert.equal(parseWalletPhone('local-format').ok, false);
});

test('support labels are trimmed, bounded, and stripped of control characters', () => {
  assert.equal(cleanSupportLabel('  Wallet\nLabel  '), 'Wallet Label');
  assert.equal(cleanSupportLabel('\u202eWallet\u202c'), 'Wallet');
  assert.equal(cleanSupportLabel('A'.repeat(70), 10), 'A'.repeat(10));
});

test('disabled settings never appear publicly and only chosen display labels are retained', () => {
  const raw = {
    enabled: false,
    walletName: 'Wallet',
    walletPhone: '',
    displayNames: [{ id: 'one', name: 'Chosen display name' }],
  };
  assert.equal(publicSupportSettings(raw), null);
  const normalized = sanitizeSupportSettings(raw);
  assert.equal(normalized.enabled, false);
  assert.deepEqual(normalized.displayNames.map((x) => x.name), ['Chosen display name']);
});
