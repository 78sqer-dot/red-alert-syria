import test from 'node:test';
import assert from 'node:assert/strict';
import { groupAlerts, nextAlertId } from '../public/js/marker-layout.js';

const attack = { id: 'attack', type: 'attack', location: { latitude: 36.69648, longitude: 38.95382 } };
const protest = { id: 'protest', type: 'protest', location: { latitude: 36.69648, longitude: 38.95382 } };

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

test('nearby but different published coordinates are not fanned out or merged', () => {
  const nearby = { id: 'nearby', location: { latitude: 36.6967, longitude: 38.9539 } };
  assert.equal(groupAlerts([attack, nearby]).length, 2);
});
