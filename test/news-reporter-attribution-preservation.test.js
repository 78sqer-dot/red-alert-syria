import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanPublicNewsAttribution,cleanAttributedNewsText,setSourceNames} from '../server/clean-text.js';
const outlet='تجمع أحرار حوران';
const fact='قوة عسكرية مؤلفة من ثلاث سيارات توغلت في ريف درعا الغربي.';
test('a private outlet may be hidden without deleting its reporter and speech attribution',()=>{
 const raw=`أفاد مراسل ${outlet} بأن ${fact}`;
 const actual=cleanPublicNewsAttribution(raw,[outlet]);
 assert.equal(actual,`أفاد مراسل بأن ${fact}`);
 assert.equal(cleanAttributedNewsText(actual,[outlet]),actual);
});
test('media attribution roles keep their original reporting verb and plurality',()=>{
 for(const [lead,expected] of [
  [`قال مراسل ${outlet} إن`,`قال مراسل إن`],
  [`ذكرت مصادر ${outlet} أن`,`ذكرت مصادر أن`],
  ['أفادت مراسلة قناة الجزيرة بأن','أفادت مراسلة بأن'],
  ['مصدر شبكة شام الإخبارية:','مصدر:'],
 ])assert.equal(cleanPublicNewsAttribution(`${lead} ${fact}`,[outlet,'شبكة شام الإخبارية']),`${expected} ${fact}`);
});
test('role-only credits do not gain an invented speech verb',()=>{
 assert.equal(cleanPublicNewsAttribution(`مراسل ${outlet}: ${fact}`,[outlet]),`مراسل: ${fact}`);
});
test('configured global feed names are hidden with reporter attribution intact',()=>{
 setSourceNames([outlet]);
 try{assert.equal(cleanPublicNewsAttribution(`أفاد مراسل ${outlet} بأن ${fact}`),`أفاد مراسل بأن ${fact}`);}finally{setSourceNames([]);}
});
test('institutional sources and reported uncertainty remain intact; credits and links stay stripped',()=>{
 const raw='أفادت مصادر الدفاع المدني بأن الطريق قد يكون مغلقاً.';
 assert.equal(cleanPublicNewsAttribution(raw,['مصادر الدفاع المدني']),raw);
 assert.equal(cleanPublicNewsAttribution(`${fact}\n${outlet}\nhttps://example.invalid/1`,[outlet]),fact);
});
