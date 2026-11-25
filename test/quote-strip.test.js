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
