import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(ROOT, 'server/alnaba-page.html'), 'utf8');
const routes = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
const api = fs.readFileSync(path.join(ROOT, 'server/alnaba.js'), 'utf8');
const frontend = fs.readFileSync(path.join(ROOT, 'public/js/alnaba.js'), 'utf8');
const bot = fs.readFileSync(path.join(ROOT, 'server/bot.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public/css/alnaba.css'), 'utf8');

test('Al-Nabaa removes Quran from public pages and links while preserving other sections and private bot controls', () => {
  const nav = page.match(/<nav class="an-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(nav, 'the public Al-Nabaa navigation exists');
  assert.doesNotMatch(nav, /data-nav="quran"|href="\/alnaba\/quran\//, 'Quran is no longer a top-navigation item');

  for (const [section, href] of [
    ['home', '/alnaba/'],
    ['photos', '/alnaba/photos/'],
    ['weekly', '/alnaba/weekly/'],
    ['nasheed', '/alnaba/nasheed/'],
    ['archive', '/alnaba/archive/'],
  ]) {
    assert.match(nav, new RegExp(`href="${href.replaceAll('/', '\\/')}" data-nav="${section}"`), `${section} remains in the navigation`);
  }

  assert.doesNotMatch(page, /href="\/alnaba\/quran\/"|data-view="quran"|القرآن الكريم|محتوى قرآني/, 'the homepage and page template no longer expose Quran content');
  assert.doesNotMatch(routes, /\/alnaba\/quran\/?['\"]/, 'the public Quran page route is not registered');
  assert.match(api, /section === 'quran'.*status\(404\)/, 'public Quran listing requests are unavailable');
  assert.match(api, /item\.section === 'quran'.*status\(404\)/, 'public Quran media requests are unavailable');
  assert.doesNotMatch(frontend, /quranList|quranLoading|section=quran/, 'the public frontend no longer loads Quran content');
  assert.doesNotMatch(css, /an-quran-card/, 'the removed Quran card has no public styling');
  assert.match(page, /\/css\/alnaba\.css\?v=5/, 'public assets use a new cache version');
  assert.match(bot, /\.text\(en \? '📖 Quran' : '📖 القرآن الكريم', 'nb:quran'\)/, 'the owner bot upload control for Quran remains unchanged');
  assert.match(bot, /nb:manage:\(photos\|weekly\|quran\|nasheed\|archive\)/, 'private Quran content management remains available');
  assert.match(bot, /\.text\(en \? '🎵 Nasheeds' : '🎵 أناشيد', 'nb:nasheed'\)/, 'the owner bot upload control for nasheeds remains unchanged');
});
