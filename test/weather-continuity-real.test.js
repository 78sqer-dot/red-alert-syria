import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfficialWeatherContinuity} from '../server/weather-continuity.js';
test('real cache path: 5min tick gates network at TTL, partial keeps new valid items, failure backoff and slow timeout cannot overlap',async()=>{
 const realFetch=global.fetch,realNow=Date.now;let now=Date.parse('2026-11-28T12:00:00Z'),feeds=0,docs=0,phase='empty',release;
 Date.now=()=>now;
 const item=id=>`<item><title>تحذير أمطار</title><link>https://climweb.med.gov.sy/api/cap/${id}.xml</link><pubDate>${new Date(now).toISOString()}</pubDate></item>`;
 const cap=id=>`<alert><identifier>${id}</identifier><sent>${new Date(now).toISOString()}</sent><status>Actual</status><info><category>Met</category><event>أمطار</event><headline>أمطار</headline></info></alert>`;
 global.fetch=async url=>{if(String(url).endsWith('rss.xml')){feeds++;if(phase==='fail')return {ok:false,status:403};if(phase==='slow')await new Promise(r=>release=r);now+=1000;return {ok:true,text:async()=>`<rss>${phase==='partial'?item('new')+item('bad'):phase==='first'?item('first')+item('bad'):''}</rss>`};}docs++;if(String(url).includes('bad.xml'))return {ok:false,status:403};return {ok:true,text:async()=>cap(String(url).includes('first')?'first':'new')};};
 try{
  const m=await import('../server/weather-official.js?real-continuity');let callback;const c=createOfficialWeatherContinuity({read:m.officialWeatherWarnings,health:m.officialWeatherDebug,schedule:fn=>{callback=fn;return 1},clear:()=>{},report:()=>{}});
  c.start();await new Promise(r=>setImmediate(r));assert.equal(feeds,1);const boot=now-1000;
  for(let i=1;i<=4;i++){now=boot+i*300000;await callback();assert.equal(feeds,1);}
  now=boot+1500000;await callback();assert.equal(feeds,2);assert.equal(m.officialWeatherDebug().health,'ok-empty');
  now+=1200001;phase='first';assert.equal((await m.officialWeatherWarnings({waitMs:1000})).length,1);assert.equal(m.officialWeatherDebug().health,'partial');const f=feeds;
  now+=299999;await m.officialWeatherWarnings({waitMs:1000});assert.equal(feeds,f);
  now+=2;phase='partial';const union=await m.officialWeatherWarnings({waitMs:1000});assert.deepEqual(union.map(x=>x.id).sort(),['cap:first','cap:new']);assert.equal(m.officialWeatherDebug().lifecycle,'fetch-health-only');assert.equal(m.officialWeatherDebug().sameUrlDocumentRevalidation,false);
  now+=49*3600000;phase='fail';assert.equal((await m.officialWeatherWarnings({waitMs:1000})).length,0);assert.equal(m.officialWeatherDebug().health,'feed-failed');now+=300001;phase='slow';const read=m.officialWeatherWarnings({waitMs:1});await new Promise(r=>setTimeout(r,5));await read;const before=feeds;await m.officialWeatherWarnings({waitMs:1});assert.equal(feeds,before);assert.equal(m.officialWeatherDebug().fetching,true);
  const inFlight=callback();await new Promise(r=>setImmediate(r));await callback();assert.equal(feeds,before);release();await inFlight;assert.equal((await m.officialWeatherWarnings()).length,0);c.stop();assert.ok(docs>=4);
 }finally{global.fetch=realFetch;Date.now=realNow;}
});
