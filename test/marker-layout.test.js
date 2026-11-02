import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterAlertsByScreen, groupAlerts, nextAlertId } from '../public/js/marker-layout.js';

const attack = { id: 'attack', type: 'attack', location: { latitude: 36.69648, longitude: 38.95382 } };
const protest = { id: 'protest', type: 'protest', location: { latitude: 36.69648, longitude: 38.95382 } };

function screenMap() {
  return { project: ([longitude, latitude]) => ({ x: longitude * 1000, y: latitude * 1000 }) };
}

test('Tall Abyad alerts share one representative at their exact unchanged coordinate', () => {
  const input = structuredClone([attack, protest]);
  const before = JSON.stringify(input);
  const groups = groupAlerts(input);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].alerts.length, 2);
  assert.equal(groups[0].representative.id, 'attack');
  assert.deepEqual(groups[0].representative.location, attack.location);
  assert.equal(JSON.stringify(input), before, 'layout must not mutate alert data');
});

test('the selected same-place alert becomes the visible representative', () => {
  const [group] = groupAlerts([attack, protest], 'protest');
  assert.equal(group.representative.id, 'protest');
  assert.equal(nextAlertId(group, 'protest'), 'attack');
  assert.equal(nextAlertId(group, 'attack'), 'protest');
  assert.equal(nextAlertId(group), 'attack');
});

test('single alerts stay on their own coordinate and invalid locations are ignored', () => {
  const groups = groupAlerts([attack, { id: 'invalid', location: { latitude: null, longitude: null } }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].alerts.length, 1);
  assert.equal(nextAlertId(groups[0], 'attack'), 'attack');
  assert.deepEqual(groups[0].representative.location, attack.location);
});

test('screen clustering groups nearby reports from any location without changing their coordinates', () => {
  const first = { id: 'governorate-a-1', location: { latitude: 35, longitude: 37 } };
  const nearby = { id: 'governorate-a-2', location: { latitude: 35.01, longitude: 37.02 } };
  const far = { id: 'governorate-b', location: { latitude: 35.2, longitude: 37.2 } };
  const input = [first, nearby, far];
  const before = JSON.stringify(input);
  const groups = clusterAlertsByScreen(input, screenMap());
  assert.deepEqual(groups.map((group) => group.alerts.map((alert) => alert.id)), [['governorate-a-1', 'governorate-a-2'], ['governorate-b']]);
  assert.equal(groups[0].key, JSON.stringify(['governorate-a-1', 'governorate-a-2']));
  assert.deepEqual(groups[0].representative.location, first.location);
  assert.equal(JSON.stringify(input), before);
});

test('selected nearby alert remains the visible representative and separate screen clusters stay separate', () => {
  const first = { id: 'one', location: { latitude: 35, longitude: 37 } };
  const second = { id: 'two', location: { latitude: 35.01, longitude: 37.02 } };
  const [group] = clusterAlertsByScreen([first, second], screenMap(), 'two');
  assert.equal(group.alerts.length, 2);
  assert.equal(group.representative.id, 'two');
  assert.equal(clusterAlertsByScreen([first, second], screenMap(), null, 5).length, 2);
});
