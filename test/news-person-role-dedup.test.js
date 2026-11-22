import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ras-person-role-'));process.env.DATA_DIR=dir;process.env.TELEGRAM_BACKUP='false';process.env.BOT_TOKEN='123:TEST';
const{store}=await import('../server/store.js');await store.init(null);const m=await import('../server/news-monitor.js');
test.after(async()=>{await new Promise(r=>setTimeout(r,350));fs.rmSync(dir,{recursive:true,force:true});});
test('explicit victim role extracts the full name, retaining Ali as a name not a preposition',()=>{
 assert.deepEqual(m._test.personNameRuns('العثور على جثمان الشاب محمد علي قداد المنحدر من كفريا'),[['محمد','علي','قداد']]);
 assert.deepEqual(m._test.personNameRuns('المواطن محمد علي قداد المقيم في دمشق'),[['محمد','علي','قداد']]);
});
test('generic narcotics language is not a person identity',()=>{
 assert.deepEqual(m._test.personNameRuns('مواد مخدرة والمؤثرات العقلية في بيان إدارة مكافحة المخدرات'),[]);
});
