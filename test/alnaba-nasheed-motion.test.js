import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = fs.readFileSync(path.join(ROOT, 'public/js/alnaba.js'), 'utf8');
const styles = fs.readFileSync(path.join(ROOT, 'public/css/alnaba.css'), 'utf8');

test('nasheed waveform is tied to audio/video playback and respects reduced motion', () => {
  assert.match(script, /section === 'nasheed'[\s\S]*?data-nasheed-player/, 'only nasheed audio/video receives the waveform player');
  assert.match(script, /addEventListener\('playing'[\s\S]*?classList\.add\('is-playing'\)/, 'the waveform starts only after playback begins');
  for (const event of ['pause', 'ended', 'waiting', 'stalled', 'emptied', 'error']) {
    assert.match(script, new RegExp(`'${event}'`), `${event} stops the playback state`);
  }
  assert.match(styles, /\.an-nasheed-player\.is-playing \.an-nasheed-wave__bar\s*\{\s*animation:/, 'animation is gated on active playback');
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*no-preference\)/, 'movement is enabled only when reduced motion is not requested');
});
