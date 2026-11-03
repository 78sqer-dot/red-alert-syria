import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('topbar links directly to the canonical Facebook Page accessibly', () => {
  const match = html.match(/<a\b(?=[^>]*\bid="btnFacebook")[^>]*>([\s\S]*?)<\/a>/);
  assert.ok(match, 'Facebook Page link exists in the topbar');
  const tag = match[0];
  assert.match(tag, /href="https:\/\/www\.facebook\.com\/Red\.Alert\.Syria"/);
  assert.doesNotMatch(tag, /facebook\.com\/sharer|sharer\.php/i, 'must not be a generic share link');
  assert.match(tag, /target="_blank"/);
  assert.match(tag, /rel="noopener noreferrer"/);
  assert.match(tag, /aria-label="Facebook Page"/);
  assert.match(match[1], /class="lbl">Facebook<\/span>/, 'visible link label is present');
});
