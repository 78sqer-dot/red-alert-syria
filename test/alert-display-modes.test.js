import test from 'node:test';
import assert from 'node:assert/strict';
import { availableAlertDisplayModes, initialAlertDisplayMode, alertDisplayPanelState } from '../shared/alert-display-modes.js';

const scenarios = [
  { name: 'text only', news: 'خبر تجريبي', media: [], modes: ['news'], active: 'news' },
  { name: 'image only', news: '', media: [{ type: 'photo', id: 'isolated-photo' }], modes: ['photo'], active: 'photo' },
  { name: 'video only', news: '', media: [{ type: 'video', id: 'isolated-video' }], modes: ['video'], active: 'video' },
  { name: 'photo and video with news', news: 'خبر تجريبي', media: [{ type: 'photo', id: 'isolated-photo' }, { type: 'video', id: 'isolated-video' }], modes: ['news', 'photo', 'video'], active: 'news' },
];

for (const scenario of scenarios) {
  test(`alert popup modes: ${scenario.name}`, () => {
    const fixtureBefore = JSON.stringify(scenario.media);
    const modes = availableAlertDisplayModes(scenario.news, scenario.media);
    assert.deepEqual(modes, scenario.modes);
    assert.equal(initialAlertDisplayMode(modes), scenario.active);
    const panels = alertDisplayPanelState(scenario.active);
    assert.equal(panels.news, scenario.active === 'news');
    assert.equal(panels.media, scenario.active === 'photo' || scenario.active === 'video');
    assert.equal(panels.mediaType, scenario.active === 'photo' || scenario.active === 'video' ? scenario.active : null);
    assert.equal(JSON.stringify(scenario.media), fixtureBefore, 'isolated fixture data is unchanged');
  });
}

test('popup tab order is always news, photo, then video when available', () => {
  assert.deepEqual(availableAlertDisplayModes('خبر', [{ type: 'video' }, { type: 'photo' }, { type: 'audio' }]), ['news', 'photo', 'video']);
});
