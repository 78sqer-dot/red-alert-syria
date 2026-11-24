import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { inferArmyCategory, salaryNewsKind, initialArmyState, publicArmy } from '../server/army.js';
const read = p => readFileSync(new URL('../'+p, import.meta.url),'utf8');
test('personnel ranks never become salaries; military court reports have their own category and original source', () => {
 const text='تقرير اختباري: أصدرت المحكمة العسكرية حكماً بالسجن على عنصر من مرتبات وزارة الداخلية.';
 assert.equal(salaryNewsKind(text),false);
 assert.equal(inferArmyCategory(text,'sana_gov'),'judicial');
 assert.equal(inferArmyCategory('صرف رواتب عناصر الشرطة لشهر تشرين الثاني','syrianmoi'),'police');
 assert.equal(inferArmyCategory('صرف مرتبات الجيش الشهرية','Sy_Defense'),'army');
 assert.equal(inferArmyCategory('عنصر من مرتبات وزارة الداخلية شارك في اجتماع','syrianmoi'),null);
 assert.equal(inferArmyCategory('صرف رواتب اللواء العسكري','Sy_Defense'),'units');
 assert.equal(inferArmyCategory('حكم بالسجن في محكمة مدنية بحضور الشرطة','sana_gov'),null);
 const j=initialArmyState(); j.published.test={id:'test',status:'approved',title:'تقرير اختباري',text,category:'police',categoryOverride:true,sourceName:'مصدر اختبار',sourceUrl:'https://t.me/test_source/1',sourceKey:'telegram:test_source:1'};
 const result=publicArmy(j).items[0];assert.equal(result.category,'judicial');assert.equal(result.source_url,j.published.test.sourceUrl);assert.equal(result.source_name,'مصدر اختبار');assert.equal(j.published.test.category,'police','projection must not erase approval history');
});
test('removed features have no bot, web, API, or data restore paths; shared handoff remains fail closed',()=>{
 for(const p of ['server/bot.js','server/index.js','server/store.js','public/index.html','public/js/app.js','public/js/i18n.js','public/css/app.css']) assert.doesNotMatch(read(p),/alnaba|btnNabaa|liveScene|live-scene/i,p);
 for(const p of ['server/alnaba.js','server/live-scene.js','public/js/alnaba.js','public/js/live-scene.js']) assert.equal(existsSync(new URL('../'+p,import.meta.url)),false);
 const s=read('server/index.js');assert.match(s,/if \(!merge.backupLoaded\) throw/);assert.match(s,/await store.flushBackup\(true\)/);assert.match(s,/if \(!backupSaved \|\| store._backupPending\) throw/);assert.match(s,/store._backupWritesPaused = true/);
 const bot=read('server/bot.js');assert.match(bot,/const helpText/);assert.match(bot,/Editors get publishing commands only/);assert.match(bot,/kb.text\(label, `t:\$\{type\}`\);\s+kb.row\(\)/);
});
test('approved compact circles keep centered green pulse, labels and reduced motion',()=>{
 const css=read('public/css/app.css');assert.match(css,/width:36px!important;height:36px!important/);assert.match(css,/left:50%!important;top:50%!important/);assert.match(css,/prefers-reduced-motion:reduce/);assert.match(read('public/index.html'),/id="aboutPill"[^>]*aria-label/);
});

test('removed map button cannot leave an unconditional listener that aborts initialization',()=>{
 const app=read('public/js/app.js'), html=read('public/index.html');
 const start=app.indexOf("  $('#btnSvc').addEventListener");
 const end=app.indexOf("  $('#locateMe').addEventListener",start);
 for(const match of app.slice(start,end).matchAll(/\$\('#([^']+)'\)\.addEventListener/g)) assert.ok(html.includes('id="'+match[1]+'"'),'listener target must exist: '+match[1]);
});
