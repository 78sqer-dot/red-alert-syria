import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Gap-closure item 7: the Umami tracker ships env-gated. Without a configured
// public route the site emits no tag at all; with one, every page (SPA shell
// and SEO shell) carries the project's own website id.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-umami-'));
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = 'test-only-not-a-real-token';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';
const { _test } = await import('../server/seo.js');

test('no tag while UMAMI_SCRIPT_URL is unset or unsafe', () => {
  delete process.env.UMAMI_SCRIPT_URL;
  assert.equal(_test.umamiScriptTag(), '');
  process.env.UMAMI_SCRIPT_URL = 'http://insecure.example/script.js';
  assert.equal(_test.umamiScriptTag(), '', 'http is refused');
  process.env.UMAMI_SCRIPT_URL = 'https://exa mple.com/script.js';
  assert.equal(_test.umamiScriptTag(), '', 'malformed URLs are refused');
});

test('tag carries the configured script URL and the project website id', () => {
  process.env.UMAMI_SCRIPT_URL = 'https://stats.example.com/script.js';
  delete process.env.UMAMI_WEBSITE_ID;
  const tag = _test.umamiScriptTag();
  assert.ok(tag.includes('src="https://stats.example.com/script.js"'));
  assert.ok(tag.includes('data-website-id="1ed966cb-bc49-4bee-8543-3ccffcd62330"'), 'defaults to the project’s own Umami website');
  assert.ok(_test.aboutPage('ar').includes('stats.example.com/script.js'), 'SEO pages carry the tag in the head');
  delete process.env.UMAMI_SCRIPT_URL;
});
