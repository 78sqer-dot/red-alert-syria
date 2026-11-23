import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../public/css/app.css',import.meta.url),'utf8');
test('static map pins have transparent discs, retaining border and glyph color',()=>{
 const pin=css.match(/^\.pin \{([^}]+)\}/m)[1];
 assert.match(pin,/background: transparent;/);
 assert.match(pin,/border: 2px solid var\(--ring/);
 assert.match(css,/\.pin svg \{[^}]+fill: var\(--ring/);
 assert.match(css,/\.maplibregl-map.zoom-far \.pin \{ width: 20px; height: 20px;/);
 assert.match(css,/\.maplibregl-map.zoom-detail \.pin \{ width: 38px; height: 38px;/);
});
