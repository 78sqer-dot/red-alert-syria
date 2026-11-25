import test from 'node:test';
import assert from 'node:assert/strict';
import { QUOTE_BLOCK_POST_IDS, quoteBlockTargets } from '../server/bot.js';

test('quote-strip one-shot targets exactly tonight’s five quote-era posts with source material', () => {
  assert.deepEqual([...QUOTE_BLOCK_POST_IDS], [1591, 1592, 1593, 1594, 1595]);
  const alerts = [
    { channel_message_id: 1591, meta: { sourceText: 'أصوات اشتباكات' } },
    { channel_message_id: 1595, meta: { sourceText: 'نص مصدر' } },
    { channel_message_id: 1590, meta: { sourceText: 'قبل عصر الاقتباس' } },
    { channel_message_id: 1593, meta: {} },
    { channel_message_id: 1601, meta: { sourceText: 'بعد الإلغاء' } },
  ];
  assert.deepEqual(quoteBlockTargets(alerts).map((a) => a.channel_message_id), [1591, 1595]);
});

test('second pass flips the edit kind when the recorded channel_media mismatches the message', async () => {
  const { editAlertPostFlipping } = await import('../server/bot.js');
  const calls = [];
  const api = {
    async editMessageCaption() { calls.push('caption'); throw new Error('Bad Request: there is no caption in the message to edit'); },
    async editMessageText() { calls.push('text'); return true; },
  };
  const a = {
    id: 'qs-flip', channel_message_id: 1591, channel_media: 'photo', is_active: true,
    type: 'explosion', source: 'news', channel_format: 2,
    title: 'انفجار لغم أرضي — الدردارة', title_en: '', description: 'انفجار لغم أرضي في الدردارة بريف تل تمر',
    timestamp: new Date().toISOString(), location: null,
    place: { scope: 'place', name_ar: 'الدردارة' }, meta: { sourceText: 'مصادر محلية: انفجار لغم أرضي' },
  };
  const r = await editAlertPostFlipping(api, a);
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'text');
  assert.deepEqual(calls, ['caption', 'text']);
});
