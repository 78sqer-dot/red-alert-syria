import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=(f)=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
test('phone filter and layer ID styles override lower stacking and keep background blur outside panel',()=>{
 const css=read('public/css/app.css');
 assert.match(css,/#filterPanel\.dd-sheet, #layersPanel\.dd-sheet \{ z-index: 63;/);
 assert.match(css,/\.dd-back \{ z-index: 62;/);
 assert.match(read('public/js/app.js'),/PHONE\.matches && tools/);
});
test('Army categories have the requested order, three columns, All on own row and no displayed source links',()=>{
 const source=read('public/js/services.js');const start=source.indexOf('function armyHtml()'),end=source.indexOf('function renderResults',start);const army=source.slice(start,end);
 assert.match(army,/\['army','police','recruitment'/);
 assert.doesNotMatch(army,/item\.source_name|item\.source_url/);
 assert.match(read('public/css/app.css'),/\.army-chips \{ display: grid; grid-template-columns: repeat\(3,/);
 assert.match(read('public/css/app.css'),/\.army-chip:first-child \{ grid-column: 1 \/ -1;/);
});
test('rotor is separate from body and detail-only movement does not depend on open popup',()=>{
 const svg=read('public/js/target-svgs.js').split('\n')[2];assert.match(svg,/class="heli-map-rotor"/);
 assert.match(read('public/css/app.css'),/\.heli-map-symbol \.heli-map-rotor.*animation: heliRotor/);
 const map=read('public/js/map.js');assert.match(map,/this\.map\.getZoom\(\) >= 10\.5/);
 assert.match(map,/this\.popup && \(!hit \|\| hit\.id === this\.selectedId\)/);
});
test('existing install flow gets a visible labeled trigger, never an automatic popup or obscured card',()=>{
 assert.match(read('public/index.html'),/id="btnInstallApp"/);
 const app=read('public/js/app.js');assert.match(app,/button\.setAttribute\('aria-label', T\.instTitle\)/);
 assert.doesNotMatch(app,/else scheduleInstallCard\(8000\)/);
 assert.match(read('public/css/app.css'),/\.inst-card \{ z-index: 86;/);
 assert.match(read('public/js/install.js'),/desktop-menu/);
});
