import test from 'node:test'; import assert from 'node:assert/strict'; import vm from 'node:vm'; import fs from 'node:fs';
const app=fs.readFileSync(new URL('../public/js/app.js',import.meta.url),'utf8');
const map=fs.readFileSync(new URL('../public/js/map.js',import.meta.url),'utf8');
function harness(mobile, cached=true) {
 const calls=[],a={id:'real-id',location:{latitude:33,longitude:36}};
 const ctx={state:{alerts:new Map(cached?[[a.id,a]]:[]),selectedId:null,view:'list'},svc:null,amap:{select:(...x)=>calls.push(['map',...x])},isLive:()=>true,isMobile:()=>mobile,showList:()=>calls.push(['list']),showDetail:()=>calls.push(['detail']),toggleSidebar:(...x)=>calls.push(['sidebar',...x]),setSheetOpen:(...x)=>calls.push(['sheet',...x]),history:{replaceState:()=>{}},location:{hash:'#real-id',pathname:'/ar/'},refresh:()=>{},fetch:async()=>({ok:true,json:async()=>({alert:a})}),encodeURIComponent,Map,$:()=>({classList:{contains:()=>true}}),$$:()=>[]};
 vm.runInNewContext(app.slice(app.indexOf('function select(id,'),app.indexOf('function step(dir)'))+';this.open=openDirectAlert;this.choose=select;this.lookups=directAlertLookups;',ctx);
 return {ctx,calls,a};
}
for(const mobile of [true,false]) test(`cached direct link opens a card, never details, on ${mobile?'mobile':'desktop'}`,()=>{
 const {ctx,calls}=harness(mobile);ctx.open('real-id');assert.equal(calls.some(x=>x[0]==='detail'),false);
 assert.equal(calls.find(x=>x[0]==='map')[2].allowUnlocatedPopup,true);
 if(mobile)assert.equal(calls.find(x=>x[0]==='sheet')[1],false);else assert.equal(calls.find(x=>x[0]==='sidebar')[2].persist,false);
});
test('off-snapshot direct lookup opens the requested card only after its exact-ID response',async()=>{
 const {ctx,calls}=harness(true,false);ctx.open('real-id');await Promise.all([...ctx.lookups.values()]);
 assert.equal(calls.some(x=>x[0]==='detail'),false);assert.equal(calls.find(x=>x[0]==='map')[1].id,'real-id');
});
test('normal marker/details selection still uses the existing details path',()=>{
 const {ctx,calls}=harness(true);ctx.choose('real-id',{fromMap:true,fly:false});assert.equal(calls.some(x=>x[0]==='detail'),true);assert.equal(calls.find(x=>x[0]==='map')[2].popup,true);
});
test('unlocated direct entry opens an explicitly unlocated card without adding a coordinate or flying',()=>{
 const method=map.slice(map.indexOf('  select(alert,'),map.indexOf('  // the alert circle under a map point')).trim();
 const choose=vm.runInNewContext('(function '+method+')');const calls=[];
 const subject={ready:true,syncMovementTracks(){},refreshMarkerGroups(){},_syncPulses(){},openPopup:(a,o)=>calls.push([a,o]),closePopup:()=>{throw Error('unexpected close');}};
 const a={id:'country-id',location:null};choose.call(subject,a,{allowUnlocatedPopup:true});assert.equal(a.location,null);assert.equal(calls[0][1].unlocated,true);
});
