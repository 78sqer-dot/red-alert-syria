import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);
test('POI builder paths follow checkout and staged output cannot relocate border input',()=>{
 const code=`import runpy, pathlib\nx=runpy.run_path(${JSON.stringify(path.join(root,'scripts/build-services.py'))})\nassert pathlib.Path(x['OUTFILE']) == pathlib.Path(${JSON.stringify(root)}) / 'public/data/services.json'\nassert x['DATA_DIR'] / 'syria-border.geojson' == pathlib.Path(${JSON.stringify(root)}) / 'public/data/syria-border.geojson'\nassert x['in_syria']((33.5,36.3))\n`;
 const r=spawnSync('python3',['-c',code],{cwd:'/tmp',encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 const h=spawnSync('python3',[path.join(root,'scripts/build-services.py'),'--help'],{cwd:'/tmp',encoding:'utf8'});assert.equal(h.status,0,h.stderr);assert.match(h.stdout,/--output/);
});
