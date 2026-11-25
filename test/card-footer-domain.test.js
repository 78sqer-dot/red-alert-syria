import test from 'node:test';
import assert from 'node:assert/strict';

// Gap-closure item 2 (owner order 2026-11-25): published card images must
// print the site's real domain (…-q6k8.onrender.com), never the bare
// placeholder 'red-alert-syria.onrender.com' that stood in the footers.
const { pricesSvg } = await import('../server/prices.js');
const { DEFAULT_PUBLIC_URL } = await import('../server/config.js');

const DOMAIN = DEFAULT_PUBLIC_URL.replace(/^https?:\/\//, '');

test('price card footer prints the real site domain', () => {
  const st = {
    fx: { date: '2026-11-25', items: { USD: { buy: 12000, sell: 12100 } } },
    fuel: { official: true, since: '2026-09-13', checked: Date.now(), srcs: ['SANA'], items: {} },
  };
  const svg = pricesSvg(st, Date.now());
  assert.ok(svg.includes(DOMAIN), `footer carries ${DOMAIN}`);
  assert.ok(!svg.includes('>red-alert-syria.onrender.com<'), 'the bare placeholder domain is gone from the card');
  assert.equal(DOMAIN, 'red-alert-syria-q6k8.onrender.com');
});
