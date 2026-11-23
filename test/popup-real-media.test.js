import {datedReport,reportPublicationLabel,reportEventLabel,reportBadgeLabel} from '../shared/report-presentation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {alertPreviewText} from '../shared/alert-preview.js';
import {availableAlertDisplayModes,initialAlertDisplayMode} from '../shared/alert-display-modes.js';
import {DICT} from '../public/js/i18n.js';
const source=fs.readFileSync(new URL('../public/js/app.js',import.meta.url),'utf8');
const start=source.indexOf('function alertMediaFrameHtml('),end=source.indexOf('// ------------------------------------------------------------------ selection',start);
assert.ok(start>=0&&end>start);
const component=source.slice(start,end);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderMediaPopupFixture(alert,{mode=null}={}){
 const ctx={datedReport,reportPublicationLabel,reportEventLabel,reportBadgeLabel,LANG:'ar',esc,T:DICT.ar,icon:()=>'',isLive:a=>a.is_active!==false,titleOf:a=>a.title||'',alertPreviewText,availableAlertDisplayModes,initialAlertDisplayMode:mode?()=>mode:initialAlertDisplayMode,
  distChip:()=>'',badge:()=>'<span class="badge">اختبار عرض معزول</span>',ago:()=>'',fmtDay:{format:()=> '٢٢ تشرين الثاني ٢٠٢٦'},fmtTime:{format:()=> '١٤:٠٠'}};
 const api=vm.runInNewContext(component+'\n({popupHtml,alertMediaFrameHtml})',ctx);
 return api.popupHtml(alert);
}
const fixture={id:'isolated-fixture-not-published',type:'breaking',title:'اختبار معزول للمرفقات، ليس خبراً',description:'محتوى اختباري لواجهة المرفقات فقط، لا يصف حادثة.',timestamp:'2026-11-22T12:00:00Z',is_active:true};
test('attachmentless popup is full text with no generated image, media tab or empty media panel',()=>{
 const body=Array(12).fill('نص اختباري كامل مع إسناد وعدم يقين وأرقام ١٢٣.').join(' ')+' نهاية الخبر المحفوظة.';
 const html=renderMediaPopupFixture({...fixture,body,description:body});assert.ok(html.includes(body));assert.doesNotMatch(html,/\/illustration|data-pp-mode="photo"|data-pp-media-panel|pp-media-actions/);assert.match(html,/data-pp-news-panel/);
});
test('genuine photo and video keep their separate available tabs and private media route',()=>{
 const a={...fixture,media_items:[{type:'photo',version:'abcdef123456',mime_type:'image/jpeg'},{type:'video',version:'fedcba654321',mime_type:'video/mp4'}]};
 const normal=renderMediaPopupFixture(a);assert.match(normal,/data-pp-mode="news"/);assert.match(normal,/data-pp-mode="photo"/);assert.match(normal,/data-pp-mode="video"/);
 const photo=renderMediaPopupFixture(a,{mode:'photo'});assert.match(photo,/pp-media-image/);assert.match(photo,/type=photo&amp;v=abcdef123456/);assert.doesNotMatch(photo,/\/illustration/);assert.match(photo,/لا يثبت مكانه أو توقيته/);
 const video=renderMediaPopupFixture(a,{mode:'video'});assert.match(video,/<video[^>]+controls playsinline preload="none"/);assert.match(video,/type=video&amp;v=fedcba654321/);
});
test('legacy real single attachment remains usable while retired generated stubs are excluded',()=>{
 assert.match(renderMediaPopupFixture({...fixture,media:{type:'photo'}}),/data-pp-mode="photo"/);
 assert.doesNotMatch(renderMediaPopupFixture({...fixture,media_items:[{type:'photo',illustration:true},{type:'video',generated:true}]}),/data-pp-media-panel|data-pp-mode="photo"|data-pp-mode="video"/);
});
