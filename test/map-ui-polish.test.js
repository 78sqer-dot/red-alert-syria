import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeLabelPrefix, ALERT_TYPES } from '../shared/types.js';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const app = read('public/js/app.js');
const css = read('public/css/app.css');

// ---------------------------------------------------------- ticker prefix
test('ticker title strips the redundant Arabic breaking prefix the chip already shows', () => {
  assert.equal(stripTypeLabelPrefix('خبر عاجل — هجين: قصف مدفعي على أطراف المدينة', 'breaking'), 'هجين: قصف مدفعي على أطراف المدينة');
  assert.equal(stripTypeLabelPrefix('خبر عاجل - اشتباكات في ريف حلب', 'breaking'), 'اشتباكات في ريف حلب');
  assert.equal(stripTypeLabelPrefix('عاجل | انفجار في دير الزور', 'breaking'), 'انفجار في دير الزور');
});

test('ticker title strips the English breaking prefix (longest label wins)', () => {
  assert.equal(stripTypeLabelPrefix('Breaking news — Strike on Hajin', 'breaking'), 'Strike on Hajin');
  assert.equal(stripTypeLabelPrefix('Breaking: Strike on Hajin', 'breaking'), 'Strike on Hajin');
});

test('ticker title strips any type label that duplicates its own chip', () => {
  assert.equal(stripTypeLabelPrefix('غارة جوية — استهداف موقع في إدلب', 'airstrike'), 'استهداف موقع في إدلب');
  assert.equal(stripTypeLabelPrefix(ALERT_TYPES.quake.ar + ' — هزة أرضية في اللاذقية', 'quake'), 'هزة أرضية في اللاذقية');
});

test('ticker title is never stripped without a separator or a remainder', () => {
  // label word as part of the sentence (no separator) stays untouched
  assert.equal(stripTypeLabelPrefix('خبر عاجل يهز المدينة منذ الصباح', 'breaking'), 'خبر عاجل يهز المدينة منذ الصباح');
  // a headline that is only the label stays as-is
  assert.equal(stripTypeLabelPrefix('خبر عاجل', 'breaking'), 'خبر عاجل');
  assert.equal(stripTypeLabelPrefix('خبر عاجل —', 'breaking'), 'خبر عاجل —');
  // another type's label is not this alert's chip, so it is not stripped
  assert.equal(stripTypeLabelPrefix('خبر عاجل — غارة على مطار عسكري', 'airstrike'), 'خبر عاجل — غارة على مطار عسكري');
  // unknown type / empty input are safe
  assert.equal(stripTypeLabelPrefix('خبر عاجل — نص', 'nope'), 'خبر عاجل — نص');
  assert.equal(stripTypeLabelPrefix('', 'breaking'), '');
  assert.equal(stripTypeLabelPrefix(null, 'breaking'), '');
});

test('alert ticker and breaking banner render the stripped display title', () => {
  assert.match(app, /stripTypeLabelPrefix\(titleOf\(a\), a\.type\)/);
  assert.match(app, /stripTypeLabelPrefix\(descOf\(a\) \|\| titleOf\(a\), a\.type\)/);
});

test('ticker chip and time cannot shrink or wrap, so strip edges never clip mid-text', () => {
  assert.match(css, /\.tick \.badge \{ flex: none; \}/);
  assert.match(css, /\.tick \.t-time \{ flex: none; white-space: nowrap; \}/);
  // the title remains the flexible, ellipsised element
  assert.match(css, /\.tick \.t-title \{[^}]*text-overflow: ellipsis;[^}]*flex: 1; min-width: 0; \}/);
});
