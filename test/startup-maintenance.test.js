import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const entry = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');

test('startup maintenance that can touch existing alerts or channel posts is opt-in', () => {
  assert.match(entry, /const startupMaintenanceEnabled = process\.env\.RUN_STARTUP_MAINTENANCE === 'true';/);
  assert.match(entry, /if \(startupMaintenanceEnabled && !store\.state\.maint\?\.\[WIPE_ID\]\)/, 'the one-time alert wipe is disabled by default');
  const gated = entry.match(/if \(startupMaintenanceEnabled\) \{([\s\S]*?resyncChannelPosts\(bots\.admin\.api\)[\s\S]*?)\n\s*}\n\s*startNewsMonitor\(\);/);
  assert.ok(gated, 'one-time retypes and channel-post resync are inside the opt-in block');
  assert.match(gated[1], /retypeAlerts\(bots\.admin\.api, RT_IDS, 'explosion'\)/);
  assert.match(gated[1], /resyncChannelPosts\(bots\.admin\.api\)/);
});
