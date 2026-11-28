import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfficialWeatherContinuity} from '../server/weather-continuity.js';
test('one boot/5min lifecycle, bounded in-flight read, transition health only, cleanup', async()=>{
 let callback,interval,reads=0,clears=0,finish;const reports=[];
 const c=createOfficialWeatherContinuity({read:()=>{reads++;return new Promise(r=>finish=r)},health:()=>({health:'ok',successAt:1,failureAt:null,stale:false}),schedule:(fn,ms)=>{callback=fn;interval=ms;return {unref(){}}},clear:()=>clears++,report:x=>reports.push(x)});
 c.start();c.start();assert.equal(reads,1);assert.equal(interval,300000);await callback();assert.equal(reads,1);finish();await new Promise(r=>setImmediate(r));assert.equal(reports.length,1);
 const next=callback();finish();await next;assert.equal(reads,2);assert.equal(reports.length,1);c.stop();await callback();assert.equal(reads,2);assert.equal(clears,1);
});
test('stop suppresses late reports; thrown read is visible once without retries',async()=>{
 let n=0;const reports=[];const c=createOfficialWeatherContinuity({read:async()=>{n++;throw Error('offline')},schedule:()=>1,clear:()=>{},report:x=>reports.push(x)});c.start();await new Promise(r=>setImmediate(r));await c.tick();assert.equal(n,2);assert.deepEqual(reports,[{health:'failed'}]);c.stop();await c.tick();assert.equal(n,2);
});
