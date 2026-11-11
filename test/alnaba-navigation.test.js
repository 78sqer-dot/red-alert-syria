import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(ROOT, 'server/alnaba-page.html'), 'utf8');
const routes = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
const bot = fs.readFileSync(path.join(ROOT, 'server/bot.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public/css/alnaba.css'), 'utf8');

test('Al-Nabaa navigation omits only the Quran link while preserving its page and other sections', () => {
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

  assert.match(page, /class="an-section-card an-quran-card" href="\/alnaba\/quran\/"/, 'the separate home-page Quran card is unchanged');
  assert.match(page, /data-view="quran"[\s\S]*?<h1>القرآن الكريم<\/h1>/, 'the Quran page content remains available');
  assert.match(routes, /'\/alnaba\/quran\/'/, 'the public Quran route remains registered');
  assert.match(page, /\/css\/alnaba\.css\?v=4/, 'the changed public assets bypass the previous cache version');
  assert.match(bot, /\.text\(en \? '📖 Quran' : '📖 القرآن الكريم', 'nb:quran'\)/, 'the owner bot upload control for Quran remains unchanged');
  assert.match(bot, /\.text\(en \? '🎵 Nasheeds' : '🎵 أناشيد', 'nb:nasheed'\)/, 'the owner bot upload control for nasheeds remains unchanged');
});
