import test from 'node:test';
import assert from 'node:assert/strict';
import { alertPreviewText } from '../shared/alert-preview.js';
import { configureCoordination, captureCoordinationReply, mergeCoordination } from '../server/editor-coordination.js';

const now = Date.parse('2026-11-22T10:33:00Z');
const setup = () => {
  const state = { editors: [2], news: {} };
  configureCoordination(state, { until: new Date(now + 86400000).toISOString(), chats: [{ chatId: 1, messageIds: [10] }, { chatId: 2, messageIds: [20] }] }, [1, 2], now);
  return state;
};
test('quick view shows the full retained story instead of a repeated heading', () => {
  const story = 'بيان الوزارة: نص الخبر الكامل.\nتحديث إضافي مع الأرقام كما وردت.';
  assert.equal(alertPreviewText({ title: 'انفجار — الطريف', description: 'انفجار — الطريف', body: story }), story);
  assert.equal(alertPreviewText({ title: 'عنوان', description: 'عنوان' }), '');
  assert.equal(alertPreviewText({ title: 'عنوان', description: 'تفاصيل موجزة' }), 'تفاصيل موجزة');
  assert.equal(alertPreviewText({ body_en: 'Complete source text', body: 'النص الكامل' }, 'en'), 'Complete source text');
});
test('private coordination configuration rejects unknown chats and unbounded retention', () => {
  assert.throws(() => configureCoordination({ news: {} }, { until: new Date(now + 86400000).toISOString(), chats: [{ chatId: 9, messageIds: [10] }] }, [1, 2], now));
  assert.throws(() => configureCoordination({ news: {} }, { until: new Date(now + 8 * 86400000).toISOString(), chats: [{ chatId: 1, messageIds: [10] }] }, [1], now));
});
test('only expected private coordination replies are captured and exact messages deduplicate', () => {
  const state = setup();
  const message = { chatId: 2, fromId: 2, messageId: 30, replyTo: 20, text: 'متاحون مساءً' };
  assert.equal(captureCoordinationReply(state, message, now).threadMatch, true);
  assert.equal(captureCoordinationReply(state, message, now).duplicate, true);
  assert.equal(state.news.coordination.replies.length, 1);
  assert.equal(captureCoordinationReply(state, { ...message, chatId: 3, fromId: 3 }, now), null);
  assert.equal(captureCoordinationReply(state, { ...message, fromId: 8 }, now), null);
  assert.equal(captureCoordinationReply(state, { ...message, messageId: 31, text: '/start' }, now), null);
  assert.equal(captureCoordinationReply(state, { ...message, messageId: 31 }, now + 2 * 86400000), null);
});
test('unrelated owner settings and in-progress publication inputs are not coordination text', () => {
  const state = setup();
  assert.equal(captureCoordinationReply(state, { chatId: 1, fromId: 1, messageId: 31, text: 'owner setting' }, now), null);
  assert.equal(captureCoordinationReply(state, { chatId: 2, fromId: 2, messageId: 32, text: 'draft text', inDraft: true }, now), null);
  assert.equal(captureCoordinationReply(state, { chatId: 2, fromId: 2, messageId: 33, text: 'freeform coordination' }, now).threadMatch, false);
});

test('rolling-deploy merge retains bounded replies without reviving removed routes', () => {
  const a = setup().news.coordination;
  a.replies = [{chatId: 2, messageId: 31, at: new Date(now).toISOString(), text: 'first'}];
  const b = structuredClone(a);
  b.configuredAt = new Date(now + 1000).toISOString();
  b.chats = [{chatId: 2, messageIds: [20]}];
  b.replies.push({chatId: 2, messageId: 32, at: new Date(now + 1000).toISOString(), text: 'second'}, {chatId: 1, messageId: 33, at: new Date(now).toISOString(), text: 'excluded'});
  const merged = mergeCoordination(a, b);
  assert.equal(merged.replies.length, 2);
  assert.equal(merged.chats.length, 1);
  assert.equal(mergeCoordination(undefined, b).configuredAt, b.configuredAt);
});
test('coordination redacts bot-shaped credentials and bounds retained replies', () => {
  const state = setup();
  for (let i = 0; i < 105; i++) captureCoordinationReply(state, {chatId: 2, fromId: 2, messageId: 100 + i, replyTo: 20, text: '123456789:abcdefghijklmnopqrstuvwxyz0123456789'}, now + i);
  assert.equal(state.news.coordination.replies.length, 100);
  assert.equal(state.news.coordination.replies[0].text, '[redacted bot credential]');
});
