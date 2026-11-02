import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { store } from '../server/store.js';
import { addRoad, ROAD_STATUS, roadLabel } from '../server/services.js';

const bot = readFileSync(new URL('../server/bot.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../public/js/services.js', import.meta.url), 'utf8');

function freshStore() {
  const oldState = store.state;
  const oldPersist = store.persist;
  store.state = { svc: {} };
  store.persist = () => {};
  return () => { store.state = oldState; store.persist = oldPersist; };
}

test('manual traffic congestion status is available on the bot and roads layer', () => {
  const restore = freshStore();
  try {
    const road = addRoad({ road: 'busy', location: { latitude: 33.5, longitude: 36.3, name_ar: 'دمشق' }, ttlMin: 180 }, { id: 0, name: 'test' });
    assert.equal(road.status, 'busy');
    assert.equal(ROAD_STATUS.busy.ar, 'زحمة سير');
    assert.equal(roadLabel('busy', 'ar'), '🚗 زحمة سير');
    assert.equal(roadLabel('busy', 'en'), '🚗 Traffic congestion');
    assert.match(bot, /roadLabel\('open',[^\n]+rd:open'\)\.text\(roadLabel\('busy',[^\n]+rd:busy'\)/);
    assert.match(bot, /rd:\(closed\|danger\|open\|busy\)/);
    assert.match(ui, /busy: 'زحمة سير'/);
    assert.match(ui, /'busy', ROAD_COLORS\.busy/);
    assert.match(ui, /ROAD_COLORS = \{[^}]*busy: '#eab308'/);
  } finally { restore(); }
});
