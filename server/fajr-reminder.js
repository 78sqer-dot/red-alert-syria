// Owner-approved standalone daily reminder. Uses Ministry Masjidak's Damascus calendar.
export const FAJR_SOURCE = 'https://tv.masjidak.mow.gov.sy/upload/json_prayers_times/prayer_times_region_json_767.json';
export const FAJR_ZONE = 'Asia/Damascus';
export const FAJR_START = '2026-11-26';
const MONTH_DAYS = [31,29,31,30,31,30,31,31,30,31,30,31];
export function fajrClock(now = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: FAJR_ZONE, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23' }).formatToParts(new Date(now)).map(x=>[x.type,x.value]));
  return { date:`${p.year}-${p.month}-${p.day}`, hour:+p.hour, minute:+p.minute, second:+p.second, index:MONTH_DAYS.slice(0,+p.month-1).reduce((a,b)=>a+b,0)+Number(p.day)-1 };
}
export function validateFajrCalendar(rows) {
  if (!Array.isArray(rows) || rows.length !== 366 || rows.some(x=>!/^0?[3-7]:[0-5]\d$/.test(x?.Fajr||''))) throw Error('Invalid Ministry Fajr calendar');
  return rows.map(x=>({Fajr:x.Fajr}));
}
export function createFajrReminder({ store, getApi, channel, text, initialCalendar, now=Date.now, fetchCalendar=async()=>{const r=await fetch(FAJR_SOURCE,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`Ministry calendar HTTP ${r.status}`);return r.json();}, log=console }) {
  let busy=false, refreshAfter=0, initialized=false;
  function state(){return (store.state.svc ||= {}).fajrReminder ||= {v:1,enabled:true,source:FAJR_SOURCE,timezone:FAJR_ZONE,calendar:validateFajrCalendar(initialCalendar),calendarVerifiedAt:'2026-11-25T03:39:00Z',days:{}};}
  async function save(){store.persist();if(!await store.flushBackup(true))throw Error('Fajr durable backup not confirmed');}
  async function tick(){
    if(busy||store._backupWritesPaused||!getApi())return;
    busy=true;
    try {
      const s=state(),c=fajrClock(now());
      if(!initialized){try{await save();initialized=true;}catch(e){log.error('[fajr] initialization backup failed');return;}}
      if(!s.enabled)return;
      // Refresh once a day, away from send time. Retain the verified Ministry calendar on outage.
      if(now()>=refreshAfter && (c.hour>=7||c.hour<3)){
        refreshAfter=now()+3600000;
        try {const rows=validateFajrCalendar(await fetchCalendar());s.calendar=rows;s.calendarVerifiedAt=new Date(now()).toISOString();s.refreshError=null;refreshAfter=now()+86400000;await save();}catch(e){s.refreshError=String(e.message);log.warn('[fajr] calendar refresh failed',e.message);}
      }
      const [h,m]=(s.calendar[c.index]?.Fajr||'').split(':').map(Number);
      if(c.date<FAJR_START||c.hour!==h||c.minute!==m||s.days[c.date])return;
      // Persist a single claim before the request. Ambiguous sends never auto-resend after restart.
      const claim={status:'claimed',at:new Date(now()).toISOString(),time:`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`,source:FAJR_SOURCE};
      s.days[c.date]=claim;
      for(const key of Object.keys(s.days).sort().slice(0,-32))delete s.days[key];
      try{await save();}catch(e){delete s.days[c.date];store.persist();log.error('[fajr] not sent: claim backup failed');return;}
      try {
        const result=await getApi().sendMessage(channel,text,{link_preview_options:{is_disabled:true}});
        if(!result?.message_id)throw Error('Telegram did not confirm message ID');
        Object.assign(claim,{status:'sent',messageId:result.message_id,sentAt:new Date(now()).toISOString()});
        log.log('[fajr] sent',c.date,result.message_id);
      } catch(e){claim.status='uncertain';claim.error=String(e.description||e.message);log.error('[fajr] delivery needs review',c.date,claim.error);}
      await save();
    } finally{busy=false;}
  }
  function status(){const s=state(),c=fajrClock(now());return {enabled:s.enabled,timezone:FAJR_ZONE,source:FAJR_SOURCE,calendarVerifiedAt:s.calendarVerifiedAt,refreshError:s.refreshError||null,today:c.date,todayTime:s.calendar[c.index]?.Fajr,startDate:FAJR_START,recentDays:s.days};}
  return {tick,status};
}
