import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-source-migration-'));
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_MODE = 'webhook';

const { DEFAULT_SOURCES, parseUsername } = await import('../server/news-sources.js');
const { store } = await import('../server/store.js');
const { newsState } = await import('../server/news-monitor.js');

test('Enab Baladi and Syrian Civil Defence are monitored default sources', () => {
  const enab = DEFAULT_SOURCES.find((source) => source.u.toLowerCase() === 'enabbaladi');
  const defence = DEFAULT_SOURCES.find((source) => source.u.toLowerCase() === 'syriadefence');

  assert.ok(enab, 'Enab Baladi source is configured');
  assert.equal(enab.name, 'عنب بلدي');
  assert.equal(enab.general, true);
  assert.equal(parseUsername('@enabbaladi'), enab.u);

  assert.ok(defence, 'Syrian Civil Defence source is configured');
  assert.equal(defence.name, 'الدفاع المدني السوري');
  assert.equal(defence.general, true);
  assert.equal(defence.local, true);
  assert.equal(parseUsername('@SyriaDefence'), defence.u);
});

test('one-time migration adds new feeds to saved configurations and preserves an existing paused source', () => {
  store.state.news = {
    on: true,
    sources: [{ u: 'ajasyr', name: 'الجزيرة سوريا', on: false }],
    types: {},
    mig: { local1: 'already-migrated', roadOfficial1: 'already-migrated' },
    last: {},
    seen: {},
    drafts: {},
    alerts: [],
  };

  const migrated = newsState();
  const enab = migrated.sources.find((source) => source.u.toLowerCase() === 'enabbaladi');
  const defence = migrated.sources.find((source) => source.u.toLowerCase() === 'syriadefence');
  assert.ok(enab?.on, 'Enab Baladi is enabled in the existing source list');
  assert.ok(defence?.on, 'Syrian Civil Defence is enabled in the existing source list');
  assert.ok(migrated.mig.northNews1, 'the migration is recorded once');

  enab.on = false;
  delete migrated.mig.northNews1;
  store.state.news = migrated;
  const rerun = newsState();
  assert.equal(rerun.sources.find((source) => source.u.toLowerCase() === 'enabbaladi').on, false, 'the migration never re-enables a source the owner paused');
});
