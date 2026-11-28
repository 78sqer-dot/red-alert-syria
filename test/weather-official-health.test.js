import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const moduleUrl=new URL('../server/weather-official.js',import.meta.url);
test('official cache reports success/failure/stale separately and withholds warnings on partial or failed fetch',async()=>{
 const realFetch=global.fetch,realNow=Date.now;let now=Date.parse('2026-11-28T12:00:00Z'),phase='ok';Date.now=()=>now;
 const item=(id)=>`<item><title>تحذير أمطار</title><link>https://climweb.med.gov.sy/api/cap/${id}.xml</link><pubDate>2026-11-28T11:00:00Z</pubDate></item>`;
 const cap='<alert><identifier>weather-one</identifier><sent>2026-11-28T11:00:00Z</sent><sender>weather.invalid</sender><scope>Public</scope><status>Actual</status><msgType>Alert</msgType><info><category>Met</category><event>أمطار</event><headline>تحذير أمطار</headline><expires>2026-11-28T13:00:00Z</expires><area><areaDesc>دمشق</areaDesc></area></info></alert>';
 global.fetch=async url=>{if(String(url).endsWith('rss.xml')){if(phase==='fail')return new Response('',{status:403});return new Response(`<rss>${phase==='empty'?'':item('one')+(phase==='partial'?item('two'):'')}</rss>`);}if(String(url).includes('two.xml'))return new Response('',{status:403});return new Response(cap);};
 try{
  const m=await import(moduleUrl.href+'?health-test');assert.equal(m.officialWeatherDebug().health,'unverified');
  const first=await m.officialWeatherWarnings({waitMs:1000});assert.equal(first.length,1);const success=m.officialWeatherDebug().successAt;assert.equal(success,now);assert.equal(m.officialWeatherDebug().health,'ok');
  now+=1200001;assert.equal(m.officialWeatherDebug().health,'stale');assert.equal(m.officialWeatherDebug().stale,true);phase='partial';const partial=await m.officialWeatherWarnings({waitMs:1000});assert.deepEqual(partial,[]);assert.equal(m.officialWeatherDebug().successAt,success);assert.equal(m.officialWeatherDebug().health,'partial');assert.equal(m.officialWeatherDebug().itemErrors,1);
  now+=1200001;phase='fail';assert.equal((await m.officialWeatherWarnings({waitMs:1000})).length,0);assert.equal(m.officialWeatherDebug().successAt,success);
  now+=1200001;assert.equal((await m.officialWeatherWarnings({waitMs:1000})).length,0); // expired cache never implies active warning
  now+=1200001;phase='empty';assert.deepEqual(await m.officialWeatherWarnings({waitMs:1000}),[]);assert.equal(m.officialWeatherDebug().health,'ok-empty');assert.equal(m.officialWeatherDebug().successAt,now);
 }finally{global.fetch=realFetch;Date.now=realNow;}
});
test('continuity is wired only to existing startup and has no publication dependencies',()=>{
 const wx=fs.readFileSync(new URL('../server/wx-daily.js',import.meta.url),'utf8');assert.match(wx,/startOfficialWeatherContinuity\(\)/);
 const c=fs.readFileSync(new URL('../server/weather-continuity.js',import.meta.url),'utf8');assert.doesNotMatch(c,/import.*(?:bot|store|wx-daily|weather\.js)/);
});
