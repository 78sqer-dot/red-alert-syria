import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source = readFileSync(new URL('../public/js/services.js', import.meta.url), 'utf8');
const start = source.indexOf('  function recordedUpdateStamp(');
const end = source.indexOf('  function borderHtml(', start);
const {recordedUpdateStamp, directorySnapshotNote} = runInNewContext(source.slice(start, end) + '\n({recordedUpdateStamp, directorySnapshotNote})');
test('power shows recorded full date, not a current supply or source-date claim', () => {
  for (const lang of ['ar', 'en']) {
    const label = recordedUpdateStamp('2026-11-24T10:19:00Z', lang);
    assert.match(label, lang === 'ar' ? /المسجّل/ : /Recorded update/);
    assert.match(label, lang === 'ar' ? /٢٠٢٦/ : /2026/);
    assert.match(label, lang === 'ar' ? /٠١:١٩ م/ : /13:19/);
    assert.doesNotThrow(() => recordedUpdateStamp('invalid', lang));
  }
  assert.match(recordedUpdateStamp(null, 'en'), /unavailable/);
  assert.match(source, /not confirmation of current supply/);
  assert.match(source, /white-space:normal;min-width:0;flex:1;text-align:end;overflow-wrap:anywhere/);
});
test('directory date and age remain distinct from live availability', () => {
  const now = Date.parse('2026-11-28T08:00:00Z');
  assert.match(directorySnapshotNote('2026-10-25', 'en', now), /2026-10-25 \(about 34 days old\)/);
  assert.match(directorySnapshotNote('2026-10-25', 'ar', now), /34 يوماً/);
  for (const value of [null, '', 'bad', '2026-02-31', '2026-10-25<script>']) {
    const note = directorySnapshotNote(value, 'en', now);
    assert.match(note, /date unavailable/); assert.doesNotMatch(note, /NaN|days old|script/);
  }
  assert.doesNotMatch(directorySnapshotNote('2026-12-01', 'en', now), /days old/);
  assert.match(directorySnapshotNote('2026-10-25', 'en', now), /Not live operating status.*Call before visiting/);
  assert.match(source, /This does not mean all roads are clear/);
  assert.match(source, /هذا لا يعني أن كل الطرق سالكة/);
});
