import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-source-migration-'));
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_MODE = 'webhook';

const { DEFAULT_SOURCES, fetchChannel, parseUsername } = await import('../server/news-sources.js');
const { store } = await import('../server/store.js');
const { checkpointSourcePosts, newsState } = await import('../server/news-monitor.js');

test('Enab Baladi and Syrian Civil Defence are monitored default sources', () => {
  const enab = DEFAULT_SOURCES.find((source) => source.u.toLowerCase() === 'enabbaladi');
  const defence = DEFAULT_SOURCES.find((source) => source.u.toLowerCase() === 'syriadefence');

  assert.ok(enab, 'Enab Baladi source is configured');
  assert.equal(enab.name, 'عنب بلدي');
  assert.equal(enab.general, true);
  assert.equal(parseUsername('@enabbaladi'), enab.u);

  assert.ok(defence, 'Syrian Civil Defence source is configured');
  assert.equal(defence.name, 'الدفاع المدني السوري');
  assert.equal(defence.general, true);
  assert.equal(defence.local, true);
  assert.equal(parseUsername('@SyriaDefence'), defence.u);
});

test('official Syrian News Agency is added as a Syria-gated default source', () => {
  const sana = DEFAULT_SOURCES.find((source) => source.u.toLowerCase() === 'sana_gov');
  assert.ok(sana, 'SANA public channel is configured');
  assert.equal(sana.name, 'وكالة الأنباء السورية (سانا)');
  assert.equal(sana.general, true);
  assert.equal(parseUsername('@sana_gov'), sana.u);
});

test('three verified Syrian publishers fit within the existing 25-source cap', () => {
  const hawar = DEFAULT_SOURCES.find((source) => source.u.toLowerCase() === 'hawarnews');
  const zaman = DEFAULT_SOURCES.find((source) => source.u.toLowerCase() === 'zamanalwslnews');
  const qasioun = DEFAULT_SOURCES.find((source) => source.u.toLowerCase() === 'qasiounar1');
  assert.equal(DEFAULT_SOURCES.length, 25);
  assert.deepEqual([hawar?.general, hawar?.local], [true, true]);
  assert.equal(zaman?.general, true);
  assert.equal(qasioun?.general, true);
  assert.equal(parseUsername('@HawarNews'), hawar.u);
  assert.equal(parseUsername('https://t.me/ZAMANALWSLnews'), zaman.u);
  assert.equal(parseUsername('https://t.me/s/QasiounAr1'), qasioun.u);
});

test('one-time migration adds new feeds to saved configurations and preserves an existing paused source', () => {
  store.state.news = {
    on: true,
    sources: [{ u: 'ajasyr', name: 'الجزيرة سوريا', on: false }],
    types: {},
    mig: { local1: 'already-migrated', roadOfficial1: 'already-migrated' },
    last: {},
    seen: {},
    drafts: {},
    alerts: [],
  };

  const migrated = newsState();
  const enab = migrated.sources.find((source) => source.u.toLowerCase() === 'enabbaladi');
  const defence = migrated.sources.find((source) => source.u.toLowerCase() === 'syriadefence');
  assert.ok(enab?.on, 'Enab Baladi is enabled in the existing source list');
  assert.ok(defence?.on, 'Syrian Civil Defence is enabled in the existing source list');
  const sana = migrated.sources.find((source) => source.u.toLowerCase() === 'sana_gov');
  assert.ok(sana?.on, 'SANA is enabled in the existing source list');
  assert.ok(migrated.mig.sanaOfficial1, 'the official source migration is recorded once');
  assert.ok(migrated.mig.northNews1, 'the migration is recorded once');
  const hawar = migrated.sources.find((source) => source.u.toLowerCase() === 'hawarnews');
  const zaman = migrated.sources.find((source) => source.u.toLowerCase() === 'zamanalwslnews');
  const qasioun = migrated.sources.find((source) => source.u.toLowerCase() === 'qasiounar1');
  assert.ok(hawar?.on && hawar.local && hawar.general);
  assert.ok(zaman?.on && zaman.general);
  assert.ok(qasioun?.on && qasioun.general);
  assert.ok(migrated.mig.verifiedFeeds1, 'the verified-feed migration is recorded once');
  assert.ok(migrated.sources.length <= 25, 'the migration respects the cap');

  enab.on = false;
  delete migrated.mig.northNews1;
  store.state.news = migrated;
  const rerun = newsState();
  assert.equal(rerun.sources.find((source) => source.u.toLowerCase() === 'enabbaladi').on, false, 'the migration never re-enables a source the owner paused');
});

test('a new feed starts from its latest existing post and only the next post is fresh', () => {
  const state = { last: {} };
  const source = { u: 'HawarNews' };
  const archive = [{ id: 510, text: 'old fixture' }, { id: 511, text: 'latest fixture' }];
  assert.deepEqual(checkpointSourcePosts(state, source, archive), [], 'the first poll does not replay history');
  assert.equal(state.last.HawarNews, 511);
  const nextPoll = [...archive, { id: 512, text: 'new fixture' }];
  assert.deepEqual(checkpointSourcePosts(state, source, nextPoll), [{ id: 512, text: 'new fixture' }]);
  assert.equal(state.last.HawarNews, 512);
});

test('fetchChannel paginates back to the last seen Telegram post', async () => {
  const html = (ids) => `<meta property="og:title" content="SANA">${ids.map((id) => `<div class="tgme_widget_message_wrap"><div data-post="sana_gov/${id}"></div><time datetime="2026-10-31T10:00:00Z"></time><div class="tgme_widget_message_text js-message_text">خبر من سوريا</div></div>`).join('')}`;
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { status: 200, ok: true, text: async () => url.includes('before=201') ? html([199, 200]) : html([201, 202]) };
  };
  const result = await fetchChannel('sana_gov', { afterId: 199, fetchImpl });
  assert.equal(result.complete, true);
  assert.equal(result.pages, 2);
  assert.deepEqual(result.posts.map((post) => post.id), [199, 200, 201, 202]);
  assert.ok(calls[1].includes('before=201'));
});
