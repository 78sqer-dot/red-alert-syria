import test from 'node:test';
import assert from 'node:assert/strict';
import { ALERT_TYPES, TYPE_KEYS, alertEmoji, alertButtonLabel } from '../shared/types.js';
import { SVG } from '../public/js/marker-svgs.js';
import { EXTRA_SVG } from '../public/js/target-svgs.js';
import { TYPE_ICON } from '../public/js/type-icons.js';
import { ICONS } from '../public/js/icons.js';

// Unified per-type symbol system (owner: «رتب رموز حسب كل خبر في أزرار البوت
// والقناة وعلى الخريطة»): one symbol identity per alert type, shared by the bot
// buttons, the Telegram channel post and the map marker. No two types share an
// emoji, a color, a ring, a map glyph or a web UI icon.
const GLYPHS = { ...SVG, ...EXTRA_SVG };
// Owner editorial exceptions, pinned in targeting-types / bot-emoji-labels /
// news-publish-acceptance: a generic gunfire or assassination report must not
// imply a weapon, so those two types carry no emoji anywhere; and the gun emoji
// never appears on a bot button (smuggling_weapons keeps 🔫 in running text).
const NO_EMOJI_TYPES = ['shooting', 'assassination'];
const BUTTON_TEXT_ONLY = [...NO_EMOJI_TYPES, 'smuggling_weapons'];

const duplicates = (pick) => {
  const seen = new Map();
  for (const key of TYPE_KEYS) {
    const value = pick(ALERT_TYPES[key], key);
    if (!value) continue;
    assert.ok(!seen.has(value), `${key} shares ${value} with ${seen.get(value)}`);
    seen.set(value, key);
  }
};

test('every alert type owns a unique emoji, color, ring, map glyph and UI icon', () => {
  duplicates((t) => t.emoji);
  duplicates((t) => t.color);
  duplicates((t) => t.ring);
  duplicates((t) => t.glyph);
  duplicates((t, key) => TYPE_ICON[key]);
});

test('every type glyph and UI icon exists in its catalogue', () => {
  for (const key of TYPE_KEYS) {
    assert.ok(GLYPHS[ALERT_TYPES[key].glyph], `${key} glyph ${ALERT_TYPES[key].glyph} is drawn`);
    assert.ok(ICONS[TYPE_ICON[key]], `${key} UI icon ${TYPE_ICON[key]} exists`);
  }
  assert.ok(EXTRA_SVG.border_barrier, 'border owns the barricade glyph; breaking keeps the warning triangle');
  assert.ok(EXTRA_SVG.chains, 'kidnapping owns the chain-links glyph; arrest keeps the handcuffs');
  assert.ok(EXTRA_SVG.plane_movement, 'air_movement owns the plane-behind-a-route glyph; warplane keeps the plain silhouette');
});

test('the channel symbol and the bot button lead with the same type symbol', () => {
  for (const key of TYPE_KEYS) {
    if (NO_EMOJI_TYPES.includes(key)) {
      assert.equal(alertEmoji({ type: key }), '', `${key} stays symbol-free in text by the editorial rule`);
    } else {
      assert.equal(alertEmoji({ type: key }), ALERT_TYPES[key].emoji, `${key} channel symbol is the type emoji`);
    }
    const button = alertButtonLabel(key, 'ar');
    if (BUTTON_TEXT_ONLY.includes(key)) {
      assert.equal(button, ALERT_TYPES[key].button_ar, `${key} button stays text-only by the editorial rule`);
    } else {
      assert.ok(button.startsWith(`${ALERT_TYPES[key].emoji} `), `${key} button leads with the unified symbol`);
    }
  }
});

test('previously colliding symbols are split, one owner each', () => {
  assert.equal(ALERT_TYPES.targeted_strike.emoji, '🎯');
  assert.equal(ALERT_TYPES.uav_strike.emoji, '🛩️💥');
  assert.equal(ALERT_TYPES.explosion.emoji, '💥');
  assert.equal(ALERT_TYPES.airstrike.emoji, '☄️');
  assert.equal(ALERT_TYPES.detonation.emoji, '🧨');
  assert.equal(ALERT_TYPES.smuggling_explosives.emoji, '📦');
  assert.equal(ALERT_TYPES.warplane.emoji, '✈️');
  assert.equal(ALERT_TYPES.air_movement.emoji, '🧭');
  assert.equal(ALERT_TYPES.clashes.emoji, '⚔️');
  assert.equal(ALERT_TYPES.attack.emoji, '🗡️');
  assert.equal(ALERT_TYPES.patrol.emoji, '🚓', 'patrol no longer renders symbol-free');
  assert.equal(ALERT_TYPES.breaking.glyph, 'alert_tri');
  assert.equal(ALERT_TYPES.border.glyph, 'border_barrier');
  assert.equal(ALERT_TYPES.kidnapping.glyph, 'chains');
  assert.equal(ALERT_TYPES.arrest.glyph, 'handcuffs');
  assert.equal(ALERT_TYPES.warplane.glyph, 'plane');
  assert.equal(ALERT_TYPES.air_movement.glyph, 'plane_movement');
});
