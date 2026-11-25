import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Content pages phase 1 (owner order 2026-11-25): about+FAQ, glossary and
// press pages in both languages, built from the project's own facts and
// its real alert-type dictionary; the areas hub carries a card per
// governorate with a direct map link. No paid/data-product pages.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-content-pages-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = 'test-token-not-real-123456';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';

const { _test } = await import('../server/seo.js');
const { ALERT_TYPES } = await import('../shared/types.js');
const { store } = await import('../server/store.js');
await store.init(null);

test.after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

test('about page (ar) states the project facts: free, no registration, confirmed vs preliminary, sources cited', () => {
  const html = _test.aboutPage('ar');
  assert.ok(html.includes('عن الإنذار الأحمر سوريا'));
  assert.ok(html.includes('مجانية بالكامل'));
  assert.ok(html.includes('بلا تسجيل'));
  assert.ok(html.includes('«مؤكد»'));
  assert.ok(html.includes('«أولي»'));
  assert.ok(html.includes('بوت البلاغات'));
  assert.ok(html.includes('FAQPage'), 'FAQ structured data is emitted');
  assert.ok(html.includes('whatsapp.com/channel/'), 'WhatsApp channel is linked');
});

test('about page (en) mirrors the same facts', () => {
  const html = _test.aboutPage('en');
  assert.ok(html.includes('About Red Alert Syria'));
  assert.ok(html.includes('completely free'));
  assert.ok(html.includes('“confirmed”'));
  assert.ok(html.includes('“preliminary”'));
  assert.ok(html.includes('hreflang="ar"'), 'the Arabic alternate is declared');
});

test('glossary explains EVERY alert type of the real dictionary, in both languages', () => {
  const ar = _test.glossaryPage('ar');
  const en = _test.glossaryPage('en');
  for (const [key, t] of Object.entries(ALERT_TYPES)) {
    assert.ok(ar.includes(t.ar), `ar glossary names ${key} (${t.ar})`);
    assert.ok(en.includes(t.en), `en glossary names ${key} (${t.en})`);
  }
  assert.ok(ar.includes('هزّة أرضية'), 'the earthquake explanation is present in plain language');
  assert.ok(en.includes('A recorded or felt earthquake'), 'the earthquake explanation is present in English');
});

test('press page carries the fact sheet and the downloadable assets', () => {
  for (const lang of ['ar', 'en']) {
    const html = _test.pressPage(lang);
    assert.ok(html.includes('/img/icon.svg'), `${lang}: logo download`);
    assert.ok(html.includes('/img/logo-wordmark.svg'), `${lang}: wordmark download`);
    assert.ok(html.includes('/img/icon-512.png'), `${lang}: app icon download`);
    assert.ok(html.includes(`/og/site-${lang}.png`), `${lang}: share image download`);
    assert.ok(html.includes('Rad_Alert_Syria1_bot'), `${lang}: press contact runs through the reporting bot`);
    assert.ok(html.includes(String(Object.keys(ALERT_TYPES).length)), `${lang}: the real alert-type count is stated`);
  }
});

test('sitemap lists the new content pages in both languages', () => {
  const xml = _test.sitemapXml();
  for (const p of ['/ar/about/', '/en/about/', '/ar/glossary/', '/en/glossary/', '/ar/press/', '/en/press/']) {
    assert.ok(xml.includes(p), `sitemap includes ${p}`);
  }
});

test('areas hub carries a card per governorate with a direct map link', () => {
  for (const lang of ['ar', 'en']) {
    const html = _test.hubPage(lang);
    const govs = _test.AREAS.filter((a) => a.kind === 'gov');
    assert.equal(govs.length, 14, 'Syria has 14 governorates in the gazetteer');
    for (const g of govs) {
      assert.ok(html.includes(`/${lang}/?at=${g.lat.toFixed(4)},${g.lon.toFixed(4)},${g.zoom}`), `${lang}: hub card opens the map on ${g.slug}`);
      assert.ok(html.includes(`/${lang}/area/${g.slug}/`), `${lang}: hub card links the ${g.slug} page`);
    }
  }
});

test('every SEO page footer links the new content pages', () => {
  const html = _test.hubPage('ar');
  assert.ok(html.includes('/ar/about/'));
  assert.ok(html.includes('/ar/glossary/'));
  assert.ok(html.includes('/ar/press/'));
});
