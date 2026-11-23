import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../public/css/app.css',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/js/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
test('compact controls preserve centered pulses and extended touch region',()=>{
 assert.match(css,/#aboutPill,#resetView\{width:36px!important;height:36px!important/);
 assert.match(css,/inset:-4px!important/);
 assert.match(css,/left:50%!important;top:50%!important/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});
test('both controls retain native buttons, localized names and original actions',()=>{
 assert.match(html,/id="aboutPill" type="button" aria-label=/);
 assert.match(app,/aboutPill'\).setAttribute\('aria-label', T.aboutMap\)/);
 assert.match(app,/aboutPill'\).addEventListener\('click', openAbout\)/);
 assert.match(app,/resetView'\).addEventListener\('click', \(\) => \{ setMapControlsOpen\(false\); amap && amap.fitSyria\(\);/);
});
