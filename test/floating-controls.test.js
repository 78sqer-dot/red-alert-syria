import test from 'node:test';
import assert from 'node:assert/strict';
import { initFloatingControls } from '../public/js/floating-controls.js';
import { readFileSync } from 'node:fs';
test('floating visual selection preserves both real controls and changes on activation',()=>{
 const buttons=[0,1].map(()=>({selected:false,classList:{toggle(_cls,on){this.owner.selected=on;}},addEventListener(_event,fn){this.click=fn;}}));
 buttons.forEach(b=>b.classList.owner=b);
 initFloatingControls({querySelectorAll:()=>buttons});
 assert.deepEqual(buttons.map(b=>b.selected),[true,false]);buttons[1].click();
 assert.deepEqual(buttons.map(b=>b.selected),[false,true]);buttons[0].click();
 assert.deepEqual(buttons.map(b=>b.selected),[true,false]);initFloatingControls(null);
});
test('real bottom row keeps reset and About, with translated expanding labels',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const row=html.split('<div class="map-bottom-controls">')[1].split('</div>')[0];
 assert.equal((row.match(/<button/g)||[]).length,2);
 for(const id of ['resetView','aboutPill'])assert.ok(row.includes(`id="${id}"`));
 assert.equal((row.match(/floating-control-label/g)||[]).length,2);
});
test('floating navigation keeps active tools readable and hidden responsive buttons hidden',()=>{
 const css=readFileSync(new URL('../public/css/app.css',import.meta.url),'utf8');
 assert.ok(css.includes('.floating-nav[hidden]{display:none!important;}'));
 assert.ok(css.includes('.map-ctrls #mapControlsToggle.floating-nav[aria-expanded=true] .map-tools-close-icon{color:#fff!important;}'));
 assert.ok(css.includes('.topbar #btnSettings.floating-nav,.topbar .theme-btn.floating-nav,.topbar .tg-btn.floating-nav{display:none;}'));
 const module=readFileSync(new URL('../public/js/floating-controls.js',import.meta.url),'utf8');
 assert.ok(module.includes(".svc-tab"));assert.ok(module.includes(".map-tool-grid .map-btn"));
 assert.ok(module.includes("button.setAttribute('aria-label', label)"));
});

test('selected floating controls follow map red tokens, not the mock purple-blue palette',()=>{
 const css=readFileSync(new URL('../public/css/app.css',import.meta.url),'utf8').split('/* Approved concept 3:')[1];
 assert.ok(css.includes('linear-gradient(135deg,var(--red),var(--red-strong))'));
 assert.doesNotMatch(css,/#7c5cff|#4f8cff|#9b86ff|#a78bfa/);
});
test('bottom map controls stay round with hidden visual labels after owner follow-up',()=>{
 const css=readFileSync(new URL('../public/css/app.css',import.meta.url),'utf8').split('/* Bottom-map controls remain circles,')[1];
 assert.ok(css.includes('width:52px!important;min-width:52px!important;height:52px!important;padding:0!important;gap:0;border-radius:50%!important;'));
 assert.ok(css.includes('.floating-control-label{display:none!important;}'));
});

test('tool and service names remain opaque and visible before selection',()=>{
 const css=readFileSync(new URL('../public/css/app.css',import.meta.url),'utf8').split('/* Tool names stay readable')[1];
 assert.ok(css.includes('.map-ctrls .floating-nav > .floating-nav-label,.svc-tabs .floating-nav > .floating-nav-label{max-width:190px;opacity:1;'));
 assert.ok(css.includes('background:rgba(20,31,54,.88)'));
});
