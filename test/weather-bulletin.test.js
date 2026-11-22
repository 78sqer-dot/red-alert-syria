import test from 'node:test';
import { store } from '../server/store.js';
import assert from 'node:assert/strict';
import { CAP_FEED_URL } from '../server/weather-official.js';
import { wxBulletinCaption, wxbState } from '../server/wx-daily.js';

test('daily weather bulletin caption includes the official CAP feed without throwing', () => {
  const caption = wxBulletinCaption([], [], Date.UTC(2026, 9, 31), { url: 'https://climweb.med.gov.sy/daily' });
  assert.match(caption, /climweb\.med\.gov\.sy\/daily/);
  assert.ok(caption.includes(CAP_FEED_URL));
});


test('a due morning remains due after repeated reads of migrated v3 state', () => {
  const previous = store.state.svc;
  try {
    store.state.svc = { wxb: { cfg: { on: true, time: '08:00', last: '2026-11-21', v: 3 } } };
    const dueMorning = Date.UTC(2026, 10, 22, 5, 1);
    for (let i = 0; i < 3; i++) {
      const cfg = wxbState(dueMorning).cfg;
      assert.equal(cfg.v, 3);
      assert.equal(cfg.on, true);
      assert.equal(cfg.last, '2026-11-21', 'reading state must not mark an unattempted morning as done');
    }
    store.state.svc.wxb.cfg.on = false;
    assert.equal(wxbState(dueMorning).cfg.on, false, 'an owner-disabled v3 bulletin stays disabled');
  } finally { store.state.svc = previous; }
});

test('v2 approval migration runs once and preserves later v3 state', () => {
  const previous = store.state.svc;
  try {
    store.state.svc = { wxb: { cfg: { on: false, time: '08:00', last: '2026-11-21', v: 2 } } };
    assert.equal(wxbState(Date.UTC(2026, 10, 21, 4)).cfg.on, true);
    store.state.svc.wxb.cfg.last = '2026-11-21'; // simulate that day's successful attempt
    assert.equal(wxbState(Date.UTC(2026, 10, 22, 5, 1)).cfg.last, '2026-11-21');
  } finally { store.state.svc = previous; }
});
