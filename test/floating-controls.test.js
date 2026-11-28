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

test('service navigation uses equal aligned grid cells with two columns on phones',()=>{
 const css=readFileSync(new URL('../public/css/app.css',import.meta.url),'utf8').split('/* Service navigation: equal cells')[1];
 assert.ok(css.includes('grid-template-columns:repeat(4,minmax(0,1fr))'));
 assert.ok(css.includes('grid-template-columns:repeat(2,minmax(0,1fr))'));
 assert.ok(css.includes('.svc-tabs .floating-nav,.svc-tabs .floating-nav.on{width:100%;min-width:0;min-height:52px;'));
});

test('nearby filters and map-layer cards share equal responsive rows',()=>{
 const css=readFileSync(new URL('../public/css/app.css',import.meta.url),'utf8').split('/* Nearby category filters')[1];
 assert.ok(css.includes('.svc-chips:has([data-cat]){display:grid;grid-template-columns:repeat(2,minmax(0,1fr))'));
 assert.ok(css.includes('[data-cat=all]{grid-column:1/-1;}'));
 assert.ok(css.includes('.svc-mgrid{grid-template-columns:repeat(2,minmax(0,1fr))'));
});

test('phone header places every available action in stable equal grid cells',()=>{
 const css=readFileSync(new URL('../public/css/app.css',import.meta.url),'utf8').split('/* Keep every phone header action')[1];
 assert.ok(css.includes('grid-template-columns:repeat(7,minmax(0,1fr))'));
 for(const id of ['btnTheme','btnTelegram','btnContact','listFab','btnLang','btnRefresh','btnInstallApp'])assert.ok(css.includes(`#${id}`));
 assert.ok(css.includes('.tb-btn:not(.lang-btn) .lbl'));
 assert.ok(css.includes('#btnContact:not([hidden]){display:inline-flex!important;}'));
});
test('mobile alerts use full width and keep labeled map and share actions',()=>{
 const css=readFileSync(new URL('../public/css/app.css',import.meta.url),'utf8');
 const app=readFileSync(new URL('../public/js/app.js',import.meta.url),'utf8');
 assert.ok(css.includes('.app .sidebar,.app.detail-open .sidebar{width:100%;max-width:100vw;}'));
 assert.ok(app.includes('class="card-action-label">${esc(T.showOnMap)}'));
 assert.ok(app.includes('class="card-action-label">${esc(T.share)}'));
 assert.ok(css.includes('#viewList .card-actions{grid-column:1/-1;display:grid;'));
});
test('official weather source links wrap without a fixed button height',()=>{
 const css=readFileSync(new URL('../public/css/app.css',import.meta.url),'utf8');
 assert.ok(css.includes('.svc-pane .svc-mgrid > a.btn-sm{display:flex;'));
 assert.ok(css.includes('min-height:58px;height:auto;'));
 assert.ok(css.includes('.svc-mgrid:has(>a.btn-sm){grid-template-columns:minmax(0,1fr);}'));
});
test('selected radial tools preserve original actions and keep sharing inside tools',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const app=readFileSync(new URL('../public/js/app.js',import.meta.url),'utf8');
 const panel=html.split('id="mapCtrlPanel"')[1].split('id="siteShare"')[0];
 for(const id of ['btnFilter','btnLayers','btnSvc','btnNotifications','btnNearbyFan','shareSite','zoomIn','zoomOut','locateMe'])assert.ok(panel.includes(`id="${id}"`));
 assert.ok(app.includes("svc?.open('nearby')"));
 assert.ok(app.includes("document.body.classList.toggle('tools-fan-open', open)"));
 assert.ok(app.includes("e.target.id === 'siteShare'"));
 assert.ok(app.includes('share-fan-close'));
});
