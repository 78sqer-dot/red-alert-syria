import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-auto-media-disabled-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '123456:LOCAL_TEST';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';
process.env.PUBLIC_URL = 'https://example.invalid';
process.env.ALERT_IMAGES = 'false';

const { store } = await import('../server/store.js');
await store.init(null);
const { newsState, toBotDraft, _test } = await import('../server/news-monitor.js');

test.after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

test('automatic monitoring neither downloads nor attaches source photos/videos, including legacy drafts', async () => {
  const n = newsState();
  n.drafts = {};
  n.types.political = true;
  n.stats.drafts = 0;
  n.stats.merged = 0;
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    throw new Error('synthetic test must not fetch source media');
  };

  try {
    const ts = Date.parse('2026-11-13T12:00:00Z');
    const text = 'أعلنت الرئاسة السورية اليوم بدء مفاوضات رسمية جديدة مع ممثلي القوى الوطنية بشأن المرحلة المقبلة';
    const headline = 'الرئاسة السورية تعلن بدء مفاوضات جديدة مع ممثلي القوى الوطنية';
    const result = {
      i: 1, event: true, type: 'political', political_category: 'none', new_incident: false,
      same_as: null, places: [], headline,
    };
    const firstItem = {
      i: 1,
      src: { u: 'synthetic-watch-one', name: 'Synthetic source one', local: false },
      url: 'https://t.me/synthetic-watch-one/101', ts, text,
      media: [{ type: 'photo', url: 'https://example.invalid/not-a-photo' }],
    };

    await _test.handleResult(firstItem, result, [], new Map());
    const draft = Object.values(n.drafts).find((candidate) => candidate.type === 'political');
    assert.ok(draft, 'the synthetic news item still creates its normal review draft');
    assert.equal(Object.hasOwn(draft, 'sourceMedia'), false, 'new source media is not fetched or stored');

    const known = [{
      kind: 'draft', status: 'pending', draftId: draft.id, type: 'political', ts,
      headline: draft.headline,
      politicalCategory: draft.politicalCategory,
      geo: { pts: [], dists: [], govs: [], coarse: false, none: true },
    }];
    const secondItem = {
      ...firstItem,
      i: 2,
      src: { u: 'synthetic-watch-two', name: 'Synthetic source two', local: false },
      url: 'https://t.me/synthetic-watch-two/202',
      media: [{ type: 'video', url: 'https://example.invalid/not-a-video' }],
    };
    await _test.handleResult(secondItem, { ...result, i: 2, same_as: 'E1' }, known, new Map());
    assert.equal(draft.srcs.length, 2, 'source merging still works');
    assert.equal(Object.hasOwn(draft, 'sourceMedia'), false, 'merged sources do not fetch or store their media');

    const legacyDraft = {
      ...draft,
      sourceMedia: [
        { type: 'photo', publishedMedia: { type: 'photo', file_id: 'old-auto-photo', bot_role: 'admin', mime_type: 'image/jpeg' } },
        { type: 'video', publishedMedia: { type: 'video', file_id: 'old-auto-video', bot_role: 'admin', mime_type: 'video/mp4' } },
      ],
    };
    const publicDraft = toBotDraft(legacyDraft);
    assert.equal(Object.hasOwn(publicDraft, 'media'), false, 'legacy source photos are not attached to public alerts');
    assert.equal(Object.hasOwn(publicDraft, 'media_items'), false, 'legacy source videos are not attached to public alerts');
    assert.equal(fetchCalls, 0, 'neither new nor merged monitored media triggers a network download');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
