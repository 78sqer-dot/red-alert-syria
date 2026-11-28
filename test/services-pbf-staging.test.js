import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);
test('offline staging preserves category semantics and source date distinct from build time',()=>{
 const py=`import runpy\nx=runpy.run_path(${JSON.stringify(path.join(root,'scripts/services-from-pbf.py'))})\nassert x['categories']({'healthcare':'hospital'}) == [0]\nassert x['categories']({'healthcare':'clinic'}) == []\nassert x['categories']({'amenity':'pharmacy','healthcare':'pharmacy'}) == [2]\nassert x['categories']({'shop':'bakery'}) == [4]\nd=x['document']([], '2026-10-25T23:30:00Z','https://example.test/source')\nassert d['generated']=='2026-10-25'\nassert d['source_as_of']=='2026-10-25T23:30:00Z'\nassert d['built_at'] != d['source_as_of']\nfor v in [None,'','invalid','2099-01-01T00:00:00Z','2026-10-25T00:00:00']:\n try: x['source_date'](v)\n except (ValueError,TypeError): pass\n else: raise AssertionError(v)\n`;
 const r=spawnSync('python3',['-c',py],{cwd:'/tmp',encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
test('legacy Overpass builder cannot stamp undated caches as fresh',()=>{
 const s=readFileSync(path.join(root,'scripts/build-services.py'),'utf8');
 assert.doesNotMatch(s,/datetime\.date\.today\(\)/);
 assert.doesNotMatch(s,/cache = "\/tmp\//);
 assert.match(s,/TemporaryDirectory\(prefix="ras-services-run-"\)/);
 assert.match(s,/No source timestamp: refusing/);
 const py=`import runpy\nx=runpy.run_path(${JSON.stringify(path.join(root,'scripts/build-services.py'))})\ntry: x['main']()\nexcept RuntimeError as e: assert 'cache directory required' in str(e)\nelse: raise AssertionError('unguarded legacy cache')\n`;
 const r=spawnSync('python3',['-c',py],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});

test('contact policy suppresses unverified odd numbers but recognizes equivalent Syrian formatting',()=>{
 const py=`import runpy\nx=runpy.run_path(${JSON.stringify(path.join(root,'scripts/services-from-pbf.py'))})\nassert x['safe_contact']('+352 681 503 260')[0] == ''\nassert x['safe_contact']('6130457')[0] == ''\nassert x['safe_contact']('+96341472690')[0] == '+96341472690'\nassert x['canonical_phone']('041472690') == x['canonical_phone']('+96341472690')\n`;
 const r=spawnSync('python3',['-c',py],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
