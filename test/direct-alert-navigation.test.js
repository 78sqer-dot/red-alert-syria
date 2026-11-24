import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
const seo = await readFile(new URL('../server/seo.js', import.meta.url), 'utf8');

test('alert cards open details and share buttons keep a direct alert URL', () => {
  assert.match(app, /const shareUrl = \(a\) => `\$\{location\.origin\}\/\$\{LANG\}\/a\/\$\{encodeURIComponent\(a\.id\)\}`/);
  assert.match(app, /if \(act === 'share'\) return share\(a\);[\s\S]*?select\(a\.id\);/);
  assert.match(app, /function openShareCard\(a\)[\s\S]{0,900}shareCardMapImage/);
  assert.match(app, /function lastUpdateInfo\(a\)[\s\S]{0,650}T\.lastUpdated/);
  assert.match(app, /data-pp="share"/);
  assert.match(seo, /const target = `\/\$\{lang\}\/\#\$\{encodeURIComponent\(id\)\}`/);
  assert.match(seo, /alertLastUpdate\(a\)/);
  assert.match(seo, /Last updated/);
});

test('direct alert hashes fetch IDs outside the current snapshot and clear on back', () => {
  assert.match(app, /function openDirectAlert\(id\)/);
  assert.match(app, /fetch\('\/api\/alerts\/' \+ encodeURIComponent\(id\), \{ cache: 'no-store' \}\)/);
  assert.match(app, /if \(id !== state\.selectedId\) openDirectAlert\(id\)/);
  assert.match(app, /if \(!id\) \{\s*if \(state\.selectedId\) select\(null\);/);
  assert.match(app, /if \(first\) \{\s*const id = location\.hash\.slice\(1\);\s*if \(id\) openDirectAlert\(id\);/);
});
