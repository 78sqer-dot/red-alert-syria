'use strict';
/* ═══════════════════════════════════════════════════════════════
   الإنذار الأحمر سوريا — Red Alert Syria (design concept / demo)
   خريطة تنبيهات مباشرة على حدود سوريا الإدارية (بيانات محاكاة)
   ═══════════════════════════════════════════════════════════════ */
/* ╔══════════════════════════════════════════════════════════════╗
   ⚙️⚙️⚙️  إعدادات مصدر البيانات — عدّلها هنا ثم ارفع الملف  ⚙️⚙️⚙️
   ───────────────────────────────────────────────────────────────
   mode      : 'demo' = تنبيهات محاكاة تجريبية
               'live' = بيانات حقيقية من بوتك/خادمك (يُوقف المحاكاة)
   feedURL   : رابط تنبيهاتك — مثل:
               https://red-alert-syria.xxx.workers.dev/alerts
   reportURL : رابط بوت التبليغ على تليغرام — مثل:
               https://t.me/YourReportBot
   (يمكن أيضاً التجربة دون تعديل الملف بإضافة ?live=الرابط لعنوان الصفحة)
   ╚══════════════════════════════════════════════════════════════╝ */
const CONFIG = {
  mode: 'demo',
  feedURL: '',
  reportURL: 'https://t.me/SyriaLive2026_bot',
  pollSec: 6,
};

const MAP = __MAPDATA__;

/* ---------- helpers ---------- */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const NS = 'http://www.w3.org/2000/svg';
const AR_D = '٠١٢٣٤٥٦٧٨٩';
const an   = n => String(n).replace(/\d/g, d => AR_D[+d]);
const pad2 = n => String(n).padStart(2, '0');
const rand = (a, b) => a + Math.random() * (b - a);
const ri   = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hexA = (hex, a) => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${a})`;
};
const hhmm = ts => { const d = new Date(ts); return an(pad2(d.getHours())) + ':' + an(pad2(d.getMinutes())); };
function rel(ts){
  const s = (Date.now() - ts) / 1000;
  if (s < 20) return 'الآن';
  if (s < 60) return 'قبل ' + an(Math.floor(s)) + ' ث';
  const m = s / 60;
  if (m < 60) return 'قبل ' + an(Math.floor(m)) + ' د';
  const h = m / 60;
  if (h < 24) return 'قبل ' + an(Math.floor(h)) + ' س';
  return 'قبل ' + an(Math.floor(h / 24)) + ' ي';
}
const store = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch(e){} };
const load  = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch(e){ return d; } };
function mk(tag, attrs, parent){
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

/* مراساة المحافظات (احتياط لمدينة غير معروفة في بيانات الخادم) */
const GOV_ANCHOR = {};
for (const g of MAP.governorates) GOV_ANCHOR[g.ar] = { x:g.label[0], y:g.label[1], n:g.ar, g:g.ar };
function resolveCity(name, gov){
  if (name){
    const c = MAP.cities.find(c => c.n === name && (!gov || c.g === gov)) ||
              MAP.cities.find(c => c.n === name) ||
              MAP.cities.find(c => name.includes(c.n) || c.n.includes(name));
    if (c) return c;
  }
  return (gov && GOV_ANCHOR[gov]) || null;
}

/* ---------- alert types ---------- */
const TYPES = {
  warplane:  { ar:'طيران حربي',  w:16, color:'#4da3ff', note:'طيران حربي في الأجواء — خذوا الحيطة والحذر',
    icon:'<svg viewBox="0 0 24 24"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>' },
  drone:     { ar:'مسيّرة',      w:16, color:'#ff8c2e', note:'مسيّرة في الأجواء — ابتعدوا عن المناطق المكشوفة',
    icon:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.6"/><path d="M9.6 9.6 6.2 6.2M14.4 9.6l3.4-3.4M9.6 14.4l-3.4 3.4M14.4 14.4l3.4 3.4"/><circle cx="5" cy="5" r="1.9"/><circle cx="19" cy="5" r="1.9"/><circle cx="5" cy="19" r="1.9"/><circle cx="19" cy="19" r="1.9"/></svg>' },
  strike:    { ar:'غارة جوية',   w:12, color:'#ff3b4e', note:'غارة جوية — لجأوا فوراً إلى الملاجئ',
    icon:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22M5 5l2.4 2.4M16.6 16.6 19 19M19 5l-2.4 2.4M7.4 16.6 5 19"/></svg>' },
  artillery: { ar:'قصف مدفعي',   w:10, color:'#c86bff', note:'قصف مدفعي — ابتعدوا عن النوافذ والواجهات',
    icon:'<svg viewBox="0 0 24 24"><path d="M12 2.5c1.9 0 3 2.3 3 5.5v6H9V8c0-3.2 1.1-5.5 3-5.5z"/><path d="M7.5 17.5h9M9 17.5l-1.3 3.2M15 17.5l1.3 3.2"/></svg>' },
  missile:   { ar:'صواريخ',      w:8,  color:'#ff6b3b', note:'صواريخ — لجأوا فوراً إلى الملاجئ',
    icon:'<svg viewBox="0 0 24 24"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>' },
  heli:      { ar:'مروحية',      w:8,  color:'#2ee6d9', note:'مروحية حربية في الأجواء',
    icon:'<svg viewBox="0 0 24 24"><path d="M3 7h15M10.5 7v3"/><path d="M5 12c0-1.7 2.2-2.5 5-2.5s5 .8 5 2.5-2.2 3.5-5 3.5-5-1.8-5-3.5z"/><path d="M15 11.5l5.5-2.3"/><circle cx="20.5" cy="8.7" r="1.6"/><path d="M6.5 17.5h9M8.5 15.2v2.3M13.5 15.2v2.3"/></svg>' },
  clashes:   { ar:'اشتباكات',    w:7,  color:'#ffa63b', note:'اشتباكات مسلّحة — تجنّبوا الاقتراب من المنطقة',
    icon:'<svg viewBox="0 0 24 24"><path d="M3 3h3l11.5 11.5-3 3L3 6z"/><path d="m13 19 6-6M16 16l4 4M19 21l2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="M5 14 2 17l3.5 3.5M8 21l2-2"/></svg>' },
  evac:      { ar:'إنذار إخلاء', w:5,  color:'#ffd43b', note:'إنذار إخلاء — اتجهوا فوراً إلى المناطق الآمنة',
    icon:'<svg viewBox="0 0 24 24"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>' },
  road:      { ar:'قطع طريق',    w:5,  color:'#9aa4bd', note:'قطع طريق — ابحثوا عن مسارات بديلة',
    icon:'<svg viewBox="0 0 24 24"><rect x="3" y="9" width="18" height="7" rx="1.5"/><path d="M6.5 9l3 7M12.5 9l3 7M5 16v4M19 16v4"/></svg>' },
  quake:     { ar:'زلزال',       w:1,  color:'#2ee66a', note:'زلزال — أوقفوا الغاز والكهرباء وابتعدوا عن الواجهات',
    icon:'<svg viewBox="0 0 24 24"><path d="M2 12h4l3-8 4 16 3-8h6"/></svg>' },
};
const TYPE_KEYS = Object.keys(TYPES);
const DUR = { warplane:8, drone:8, strike:7, artillery:8, missile:7, heli:8, clashes:10, evac:45, road:40, quake:25 };

/* أحياء مدن لعرض أكثر واقعية (وضع تجريبي) */
const AREAS = {
  'دمشق':['المزة','الشعلان','كفرسوسة','البرامكة','باب توما','القابون','ركن الدين','الميدان','المهاجرين','دمر'],
  'حلب':['الفرقان','الصالحين','الشعار','الجميلية','العزيزية','بستان القصر','السريان','حلب الجديدة'],
  'حمص':['الوعر','الخالدية','بابا عمرو','الديوان','الزهراء','كرم اللوز'],
  'حماة':['الحاضر','الأربعين'],
  'اللاذقية':['الرمل','الأمريكان','مشروع الزراعة','السليبوة'],
  'طرطوس':['المرقلي'],
  'دير الزور':['الجورة','القصور','حوض البنيات'],
  'الرقة':['المشلب'],
  'درعا':['البلد','المحطة'],
};

/* ---------- state ---------- */
const state = {
  alerts: [], nextId: 1, todayCount: 0,
  filter: { types: new Set(TYPE_KEYS), govs: new Set() },
  set:    load('ras_set',   { sound:true, vibrate:true, speed:1, follow:[] }),
  layers: load('ras_layers',{ govLabels:true, cityLabels:true, grat:true, nbs:true }),
};
if (!state.set.follow) state.set.follow = [];

/* weighted pickers */
const TYPE_BAG = (() => { const b=[]; for(const k of TYPE_KEYS) for(let i=0;i<TYPES[k].w;i++) b.push(k); return b; })();
const CITY_BAG = (() => { const b=[]; for(const c of MAP.cities) for(let i=0;i<(c.t===3?6:c.t===2?3:c.t===1?2:1);i++) b.push(c); return b; })();

/* ═══════════════ الخريطة ═══════════════ */
const svgEl = $('#map');
const W = MAP.viewBox[2], H = MAP.viewBox[3];
let vb = { x:0, y:0, w:W, h:H };
let k = 1, dragDist = 0, anim = null;

const govsG = mk('g', {}, svgEl);
let nbsG, gratG, govLabelsG, citiesG, markersG;
const govEls = [], cityEls = [], markerById = {};

function buildMap(){
  mk('rect', { x:-2000, y:-2000, width:W+4000, height:H+4000, fill:'url(#seaGrad)' }, svgEl);
  const defs = mk('defs', {}, svgEl);
  const rg = mk('radialGradient', { id:'seaGrad', cx:'41%', cy:'46%', r:'55%' }, defs);
  mk('stop', { offset:'0',   'stop-color':'#0e1322' }, rg);
  mk('stop', { offset:'55%', 'stop-color':'#0a0c13' }, rg);
  mk('stop', { offset:'100%', 'stop-color':'#07080d' }, rg);

  /* graticule */
  gratG = mk('g', { class:'grat' }, svgEl);
  for (const g of MAP.graticule){
    mk('line', { x1:g.x1, y1:g.y1, x2:g.x2, y2:g.y2 }, gratG);
    if (g.lab) mk('text', { x:g.lx, y:g.ly }, gratG).textContent = g.lab;
  }

  /* neighbors */
  nbsG = mk('g', {}, svgEl);
  for (const nb of MAP.neighbors){
    mk('path', { class:'nb', d:nb.d }, nbsG);
    if (nb.label){
      const t = mk('text', { class:'nb-label', x:nb.labelPos[0], y:nb.labelPos[1], 'text-anchor':'middle' }, nbsG);
      t.textContent = nb.label;
    }
  }

  /* syrian governorates */
  for (const g of MAP.governorates){
    const p = mk('path', { class:'gov', d:g.d, 'data-gov':g.ar }, govsG);
    p.addEventListener('click', () => { if (dragDist > 5) return; toggleGovFilter(g.ar); });
    p.addEventListener('dblclick', e => { e.stopPropagation(); zoomToBBox(p.getBBox()); });
    p.addEventListener('mouseenter', () => showTip(g.ar));
    p.addEventListener('mousemove', moveTip);
    p.addEventListener('mouseleave', hideTip);
    const lb = mk('text', { class:'gov-label', x:g.label[0], y:g.label[1], 'text-anchor':'middle' }, svgEl);
    lb.textContent = g.ar;
    govEls.push({ path:p, label:lb, name:g.ar });
  }
  govLabelsG = govEls[0] && null; /* labels stored per-gov above */

  /* cities */
  citiesG = mk('g', { class:'cities' }, svgEl);
  for (const c of MAP.cities){
    const g = mk('g', { class:'city' + (c.t >= 3 ? ' major' : '') }, citiesG);
    const dot = mk('circle', { cx:0, cy:0, r: c.t >= 3 ? 2.4 : 1.7 }, g);
    const lb  = mk('text', { x:0, y:-5.5, 'text-anchor':'middle' }, g);
    lb.textContent = c.n;
    cityEls.push({ g, dot, label:lb, x:c.x, y:c.y, t:c.t, name:c.n });
  }

  markersG = mk('g', {}, svgEl);
}

function setVB(v){
  vb = v; vb.h = vb.w * H / W;
  svgEl.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  k = W / vb.w;
  for (const id in markerById){
    const m = markerById[id];
    m.g.setAttribute('transform', `translate(${m.a.city.x} ${m.a.city.y}) scale(${1/k})`);
  }
  for (const c of cityEls)
    c.g.setAttribute('transform', `translate(${c.x} ${c.y}) scale(${1/k})`);
  applyLayerVis();
  updateScale();
  hideTip();
  if (!popupEl.classList.contains('hidden')) placePopup(curPopup);
}
function applyLayerVis(){
  const L = state.layers;
  gratG.style.display   = L.grat ? '' : 'none';
  nbsG.style.display    = L.nbs  ? '' : 'none';
  const govF = state.filter.govs;
  for (const g of govEls){
    g.label.style.display = (L.govLabels && k < 2.3) ? '' : 'none';
    g.path.classList.toggle('sel',  govF.size === 1 && govF.has(g.name));
    g.path.classList.toggle('dim',  govF.size  > 0 && !govF.has(g.name));
  }
  for (const nb of $$('.nb-label')) nb.style.display = (L.nbs && k < 1.6) ? '' : 'none';
  for (const c of cityEls){
    const vis = L.cityLabels && (c.t >= 3 || (c.t === 2 && k >= 1.2) || (c.t === 1 && k >= 1.7) || (c.t === 0 && k >= 2.6));
    c.label.style.display = vis ? '' : 'none';
    c.dot.style.display   = (c.t >= 1 || k >= 1.5) ? '' : 'none';
  }
}
function animateVB(target, ms, cb){
  cancelAnimationFrame(anim);
  const from = { ...vb }, t0 = performance.now();
  const ease = t => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
  (function step(now){
    const t = clamp((now - t0) / ms, 0, 1), e = ease(t);
    setVB({ x: from.x + (target.x - from.x) * e,
            y: from.y + (target.y - from.y) * e,
            w: from.w + (target.w - from.w) * e, h: 0 });
    if (t < 1) anim = requestAnimationFrame(step);
    else { anim = null; cb && cb(); }
  })(t0);
}
function zoomAt(factor, cx, cy){ /* cx,cy = svg coords anchor */
  const nw = clamp(vb.w * factor, W/8, W*1.25);
  const f = nw / vb.w;
  setVB({ x: cx - (cx - vb.x) * f, y: cy - (cy - vb.y) * f, w: nw, h: 0 });
}
function zoomTo(x, y, w, cb){
  w = clamp(w, W/8, W*1.1);
  animateVB({ x: x - w/2, y: y - (w*H/W)/2, w, h: 0 }, 650, cb);
}
function zoomToBBox(b){
  const w = Math.max(b.width, b.height*W/H) * 1.35;
  zoomTo(b.x + b.width/2, b.y + b.height/2, w);
}
function screenToSvg(px, py){
  const r = svgEl.getBoundingClientRect();
  const s = Math.min(r.width/vb.w, r.height/vb.h);
  const ox = (r.width - vb.w*s)/2, oy = (r.height - vb.h*s)/2;
  return [ vb.x + (px - ox)/s, vb.y + (py - oy)/s ];
}
function svgToScreen(x, y){
  const r = svgEl.getBoundingClientRect();
  const s = Math.min(r.width/vb.w, r.height/vb.h);
  const ox = (r.width - vb.w*s)/2, oy = (r.height - vb.h*s)/2;
  return [ ox + (x - vb.x)*s, oy + (y - vb.y)*s ];
}

/* pointer pan / pinch / wheel */
const pointers = new Map();
let lastPinch = 0, lastMid = null;
svgEl.addEventListener('pointerdown', e => {
  svgEl.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });
  dragDist = 0; cancelAnimationFrame(anim); anim = null;
  svgEl.classList.add('panning');
});
svgEl.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId);
  const r = svgEl.getBoundingClientRect();
  const s = Math.min(r.width/vb.w, r.height/vb.h);
  pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });
  if (pointers.size === 1){
    const dx = (e.clientX - prev.x)/s, dy = (e.clientY - prev.y)/s;
    dragDist += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y);
    setVB({ x: clamp(vb.x - dx, -W*.4, W*1.4 - vb.w), y: clamp(vb.y - dy, -H*.4, H*1.4 - vb.h), w: vb.w, h: 0 });
  } else if (pointers.size === 2){
    const [p1, p2] = [...pointers.values()];
    const d = Math.hypot(p1.x-p2.x, p1.y-p2.y);
    const mid = { x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2 };
    if (lastPinch && lastMid){
      const [ax, ay] = screenToSvg(lastMid.x - r.left, lastMid.y - r.top);
      const nw = clamp(vb.w * (lastPinch / Math.max(d,1)), W/8, W*1.25);
      const f = nw/vb.w;
      setVB({ x: ax - (ax - vb.x)*f, y: ay - (ay - vb.y)*f, w: nw, h: 0 });
      const dxs = (mid.x - lastMid.x)/s, dys = (mid.y - lastMid.y)/s;
      setVB({ x: vb.x - dxs, y: vb.y - dys, w: vb.w, h: 0 });
    }
    lastPinch = d; lastMid = mid; dragDist += 8;
  }
});
function pointerEnd(e){
  pointers.delete(e.pointerId);
  if (pointers.size < 2){ lastPinch = 0; lastMid = null; }
  if (pointers.size === 0) svgEl.classList.remove('panning');
  setTimeout(() => { dragDist = 0; }, 60);
}
svgEl.addEventListener('pointerup', pointerEnd);
svgEl.addEventListener('pointercancel', pointerEnd);
svgEl.addEventListener('wheel', e => {
  e.preventDefault();
  const r = svgEl.getBoundingClientRect();
  const [ax, ay] = screenToSvg(e.clientX - r.left, e.clientY - r.top);
  zoomAt(Math.exp(e.deltaY * 0.0016), ax, ay);
}, { passive:false });
svgEl.addEventListener('dblclick', e => {
  if (e.target.closest('.marker')) return;
  const r = svgEl.getBoundingClientRect();
  const [ax, ay] = screenToSvg(e.clientX - r.left, e.clientY - r.top);
  zoomAt(0.55, ax, ay);
});
$('#zin').onclick  = () => zoomAt(0.72, vb.x + vb.w/2, vb.y + vb.h/2);
$('#zout').onclick = () => zoomAt(1.38, vb.x + vb.w/2, vb.y + vb.h/2);
$('#zreset').onclick = () => animateVB({ x:0, y:0, w:W, h:0 }, 550);

/* tooltip */
const tipEl = $('#tooltip');
function showTip(name){ tipEl.textContent = name; tipEl.style.opacity = 1; }
function moveTip(e){
  const r = $('#mapwrap').getBoundingClientRect();
  tipEl.style.left = (e.clientX - r.left) + 'px';
  tipEl.style.top  = (e.clientY - r.top) + 'px';
}
function hideTip(){ tipEl.style.opacity = 0; }

/* scale bar */
function updateScale(){
  const r = svgEl.getBoundingClientRect(); if (!r.width) return;
  const s = Math.min(r.width/vb.w, r.height/vb.h);
  const kmPerPx = MAP.kmPerUnit / s;
  let best = 400;
  for (const t of [1,2,5,10,20,50,100,200,400]){
    best = t;
    if (t/kmPerPx >= 60 && t/kmPerPx <= 175) break;
  }
  $('#scalebar i').style.width = Math.round(best/kmPerPx) + 'px';
  $('#scalebar span').textContent = an(best) + ' كم';
}

/* ═══════════════ التنبيهات ═══════════════ */
function dur(type){ return (DUR[type] || 8) * 60000; }
function passesFilter(a){
  if (!state.filter.types.has(a.type)) return false;
  if (state.filter.govs.size && !state.filter.govs.has(a.gov)) return false;
  return true;
}
function isFollowed(a){
  return state.set.follow.length === 0 || state.set.follow.includes(a.gov);
}
function spawnAlert(opts = {}, silent = false){
  const city = opts.city || pick(CITY_BAG);
  const type = opts.type || pick(TYPE_BAG);
  const areas = AREAS[city.n];
  const area  = areas && Math.random() < 0.45 ? pick(areas) : null;
  const a = { id: state.nextId++, type, city, area, gov: city.g, ts: Date.now(), until: Date.now() + dur(type), ended:false };
  state.alerts.unshift(a);
  if (state.alerts.length > 90) state.alerts.pop();
  state.todayCount++;
  makeMarker(a);
  prependCard(a);
  updateStats();
  if (!silent && passesFilter(a) && isFollowed(a)){
    playSiren();
    showBanner(a);
    try { if (state.set.vibrate && navigator.vibrate) navigator.vibrate([130,60,130,60,220]); } catch(e){}
    notify(a);
  }
  return a;
}
function makeMarker(a){
  const t = TYPES[a.type];
  const g = mk('g', { class:'marker' + (a.ended ? ' ended' : '') }, markersG);
  mk('circle', { class:'ring r1', r:9, stroke:t.color }, g);
  mk('circle', { class:'ring r2', r:9, stroke:t.color }, g);
  mk('circle', { class:'core', r:4.6, fill:t.color }, g);
  g.setAttribute('transform', `translate(${a.city.x} ${a.city.y}) scale(${1/k})`);
  g.style.display = passesFilter(a) ? '' : 'none';
  g.addEventListener('click', ev => {
    ev.stopPropagation();
    if (dragDist > 5) return;
    openPopup(a);
  });
  markerById[a.id] = { g, a };
}
function endAlert(a){
  a.ended = true;
  const m = markerById[a.id];
  if (m) m.g.classList.add('ended');
  const card = $(`#feed .card[data-id="${a.id}"]`);
  if (card) card.classList.add('done');
  updateStats();
  setTimeout(() => {
    if (markerById[a.id]){
      markerById[a.id].g.classList.add('fadeout');
      setTimeout(() => { markerById[a.id] && markerById[a.id].g.remove(); delete markerById[a.id]; }, 1100);
    }
  }, 2*60000);
}

/* استقبال تنبيه من مصدر خارجي (وضع live) */
function ingestAlert(rec, opts = {}){
  const type = TYPES[rec.type] ? rec.type : 'clashes';
  const city = resolveCity(rec.city, rec.gov) || pick(CITY_BAG);
  const ts   = (rec.ts   ? (rec.ts   < 1e12 ? rec.ts   * 1000 : rec.ts)   : Date.now());
  const until= (rec.until? (rec.until< 1e12 ? rec.until* 1000 : rec.until): ts + dur(type));
  const a = { id: rec.id || Math.floor(ts + Math.random() * 999), type,
              city, area: rec.area || null, gov: city.g, ts, until,
              ended: !!rec.ended || until < Date.now() };
  if (state.alerts.some(x => x.id === a.id)) return a;   /* منع التكرار */
  state.alerts.unshift(a);
  if (state.alerts.length > 90) state.alerts.pop();
  makeMarker(a);
  prependCard(a);
  updateStats();
  if (!opts.silent && !a.ended && passesFilter(a) && isFollowed(a)){
    playSiren();
    showBanner(a);
    try { if (state.set.vibrate && navigator.vibrate) navigator.vibrate([130,60,130,60,220]); } catch(e){}
    notify(a);
  }
  return a;
}

/* ---------- feed ---------- */
const feedEl = $('#feed');
function cardNode(a, isNew){
  const t = TYPES[a.type];
  const el = document.createElement('article');
  el.className = 'card' + (a.ended ? ' done' : '') + (isNew ? ' new' : '');
  el.dataset.id = a.id;
  el.style.setProperty('--c', t.color);
  const loc = (a.area ? a.area + ' — ' : '') + a.city.n;
  el.innerHTML = `
    <div class="ic">${t.icon}</div>
    <div class="bd">
      <div class="r1"><span class="tt">${t.ar}</span><span class="tm" data-ts="${a.ts}">${rel(a.ts)}</span></div>
      <div class="loc">${loc}</div>
      <div class="meta">محافظة ${a.gov} · ${hhmm(a.ts)}</div>
    </div>`;
  el.addEventListener('click', () => {
    closePopup();
    zoomTo(a.city.x, a.city.y, 190, () => openPopup(a));
    flashMarker(a);
  });
  return el;
}
function prependCard(a){
  if (!passesFilter(a)) { updateFeedCount(); return; }
  feedEl.prepend(cardNode(a, true));
  const empty = $('#feedEmpty'); empty.classList.add('hidden');
  updateFeedCount();
}
function renderFeedFull(){
  feedEl.innerHTML = '';
  const vis = state.alerts.filter(passesFilter);
  for (const a of vis) feedEl.appendChild(cardNode(a, false));
  $('#feedEmpty').classList.toggle('hidden', vis.length > 0);
  updateFeedCount();
}
function nAlerts(n){
  if (n === 0) return 'لا تنبيهات';
  if (n === 1) return 'تنبيه واحد';
  if (n === 2) return 'تنبيهان';
  if (n <= 10) return an(n) + ' تنبيهات';
  return an(n) + ' تنبيهاً';
}
function updateFeedCount(){
  $('#feedCount').textContent = nAlerts(state.alerts.filter(passesFilter).length);
}
function updateStats(){
  $('#stToday').textContent  = an(CONFIG.mode === 'live'
    ? state.alerts.filter(a => a.ts >= new Date().setHours(0,0,0,0)).length
    : state.todayCount);
  $('#stActive').textContent = an(state.alerts.filter(a => !a.ended && passesFilter(a)).length);
  const act = state.alerts.filter(a => !a.ended).length;
  document.title = (act > 0 ? `(${an(act)}) ` : '') + 'الإنذار الأحمر سوريا — خريطة سوريا المباشرة';
}

/* ticker: relative times + alert expiry */
setInterval(() => {
  for (const el of $$('[data-ts]')) el.textContent = rel(+el.dataset.ts);
}, 15000);
setInterval(() => {
  const now = Date.now();
  for (const a of state.alerts) if (!a.ended && a.until < now) endAlert(a);
  updateStats();
}, 5000);
setInterval(() => {
  const d = new Date();
  $('#clock').textContent = an(pad2(d.getHours())) + ':' + an(pad2(d.getMinutes())) + ':' + an(pad2(d.getSeconds()));
}, 1000);

/* ---------- banner ---------- */
const bannerEl = $('#banner');
let bannerT = null;
function showBanner(a){
  const t = TYPES[a.type];
  const loc = (a.area ? a.area + ' — ' : '') + a.city.n;
  bannerEl.innerHTML = `
    <div class="b-ic">${t.icon}</div>
    <div><div class="b-tt">${t.ar}</div><div class="b-loc">${loc} · محافظة ${a.gov}</div></div>
    <span class="b-now">الآن</span>`;
  bannerEl.classList.remove('hidden', 'out');
  bannerEl.onclick = () => { hideBanner(); zoomTo(a.city.x, a.city.y, 190, () => { openPopup(a); flashMarker(a); }); };
  clearTimeout(bannerT);
  bannerT = setTimeout(hideBanner, 7000);
}
function hideBanner(){ bannerEl.classList.add('out'); setTimeout(() => bannerEl.classList.add('hidden'), 380); }

/* ---------- popup ---------- */
const popupEl = $('#popup');
let curPopup = null;
function openPopup(a){
  curPopup = a;
  const t = TYPES[a.type];
  const loc = (a.area ? a.area + ' — ' : '') + a.city.n;
  popupEl.innerHTML = `
    <button class="pp-x" id="ppX">✕</button>
    <div class="pp-head">
      <div class="pp-ic" style="--c:${t.color}">${t.icon}</div>
      <div><div class="pp-tt">${t.ar}</div>
      <div class="pp-st" style="color:${a.ended ? 'var(--muted)' : t.color}">${a.ended ? 'انتهى' : '● نشط الآن'}</div></div>
    </div>
    <div class="pp-loc">${loc} — محافظة ${a.gov}</div>
    <div class="pp-meta">وقت البلاغ ${hhmm(a.ts)} · ${rel(a.ts)} · تنبيه رقم ${an(a.id)}</div>
    <div class="pp-note">${t.note}.</div>`;
  popupEl.style.setProperty('--c', t.color);
  popupEl.classList.remove('hidden');
  placePopup(a);
  $('#ppX').onclick = e => { e.stopPropagation(); closePopup(); };
}
function placePopup(a){
  if (!a) return;
  const wrap = $('#mapwrap').getBoundingClientRect();
  const [px, py] = svgToScreen(a.city.x, a.city.y);
  let x = px + 16, y = py - 40;
  const pw = popupEl.offsetWidth || 264, ph = popupEl.offsetHeight || 180;
  if (x + pw > wrap.width - 10)  x = px - pw - 16;
  if (y + ph > wrap.height - 10) y = wrap.height - ph - 10;
  if (y < 10) y = 10;
  if (x < 10) x = 10;
  popupEl.style.left = x + 'px';
  popupEl.style.top  = y + 'px';
}
function closePopup(){ popupEl.classList.add('hidden'); curPopup = null; }
function flashMarker(a){
  const m = markerById[a.id]; if (!m) return;
  m.g.style.transition = 'none';
  const core = m.g.querySelector('.core');
  core.setAttribute('r', 9);
  setTimeout(() => { core.setAttribute('r', 4.6); m.g.style.transition = ''; }, 260);
}

/* ---------- simulation engine (demo) ---------- */
let simT = null;
function scheduleNext(){
  clearTimeout(simT);
  simT = setTimeout(() => { fireAlert(); scheduleNext(); }, rand(7000, 17000) / (state.set.speed || 1));
}
function fireAlert(){
  if (Math.random() < 0.22){
    const gov = pick(MAP.governorates).ar;
    const cities = MAP.cities.filter(c => c.g === gov);
    if (cities.length){
      const n = ri(2, 3);
      for (let i = 0; i < n; i++) setTimeout(() => spawnAlert({ city: pick(cities) }), i * ri(900, 2100));
      return;
    }
  }
  spawnAlert();
}
function seedHistory(){
  const n = ri(11, 15);
  const now = Date.now();
  for (let i = 0; i < n; i++){
    const minsAgo = rand(2, 105);
    const city = pick(CITY_BAG), type = pick(TYPE_BAG);
    const areas = AREAS[city.n];
    const ts = now - minsAgo * 60000;
    const a = { id: state.nextId++, type, city, area: areas && Math.random() < .4 ? pick(areas) : null,
                gov: city.g, ts, until: ts + dur(type), ended: ts + dur(type) < now };
    state.alerts.push(a);
    makeMarker(a);
    state.todayCount++;
  }
  state.alerts.sort((x, y) => y.ts - x.ts);
  state.todayCount += ri(12, 22);
}

/* ---------- sound ---------- */
let actx = null;
function initAudio(){ try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch(e){} }
document.addEventListener('pointerdown', initAudio, { once:true });
function playSiren(){
  if (!state.set.sound) return;
  initAudio(); if (!actx) return;
  try {
    const t = actx.currentTime;
    const o = actx.createOscillator(), f = actx.createBiquadFilter(), g = actx.createGain();
    o.type = 'sawtooth';
    f.type = 'lowpass'; f.frequency.value = 1250; f.Q.value = 4;
    o.connect(f); f.connect(g); g.connect(actx.destination);
    o.frequency.setValueAtTime(600, t);
    o.frequency.linearRampToValueAtTime(890, t + .45);
    o.frequency.linearRampToValueAtTime(600, t + .9);
    o.frequency.linearRampToValueAtTime(890, t + 1.35);
    o.frequency.linearRampToValueAtTime(600, t + 1.8);
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(.16, t + .06);
    g.gain.setValueAtTime(.16, t + 1.7);
    g.gain.exponentialRampToValueAtTime(.0001, t + 2.0);
    o.start(t); o.stop(t + 2.05);
  } catch(e){}
}
function notify(a){
  try {
    if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
    const t = TYPES[a.type];
    new Notification('الإنذار الأحمر سوريا', { body: `${t.ar} — ${a.city.n}، محافظة ${a.gov}`, tag: 'ras-' + a.id, silent: true });
  } catch(e){}
}

/* ═══════════════ التصفية ═══════════════ */
function toggleGovFilter(gov){
  const g = state.filter.govs;
  if (g.has(gov)) g.delete(gov); else if (g.size === 1 && g.has(gov)) g.clear(); else { g.clear(); g.add(gov); }
  if (g.size === 1 && !g.has(gov)) {} /* no-op */
  applyFilters();
}
function applyFilters(){
  renderFeedFull();
  for (const id in markerById) markerById[id].g.style.display = passesFilter(markerById[id].a) ? '' : 'none';
  applyLayerVis();
  const chip = $('#govChip');
  if (state.filter.govs.size){
    chip.textContent = state.filter.govs.values().next().value + ' ✕';
    chip.classList.remove('hidden');
  } else chip.classList.add('hidden');
  const hiddenTypes = TYPE_KEYS.length - state.filter.types.size;
  const fb = $('#filterBadge');
  if (hiddenTypes > 0 || state.filter.govs.size){
    fb.textContent = an(TYPE_KEYS.length - hiddenTypes) + '/' + an(TYPE_KEYS.length);
    fb.classList.remove('hidden');
  } else fb.classList.add('hidden');
  updateStats();
}
$('#govChip').onclick = () => { state.filter.govs.clear(); applyFilters(); syncFilterChips(); };

function syncFilterChips(){
  for (const el of $$('#typeChips .tchip')) el.classList.toggle('on', state.filter.types.has(el.dataset.k));
  for (const el of $$('#govChips .tchip'))   el.classList.toggle('on', state.filter.govs.has(el.dataset.k));
}
function buildFilterModal(){
  const tc = $('#typeChips'); tc.innerHTML = '';
  for (const key of TYPE_KEYS){
    const t = TYPES[key];
    const el = document.createElement('button');
    el.className = 'tchip on'; el.dataset.k = key;
    el.style.setProperty('--c', t.color);
    el.innerHTML = t.icon + `<span>${t.ar}</span>`;
    el.onclick = () => {
      const s = state.filter.types;
      s.has(key) ? s.delete(key) : s.add(key);
      if (s.size === 0) s.add(key);
      el.classList.toggle('on', s.has(key));
      applyFilters();
    };
    tc.appendChild(el);
  }
  const gc = $('#govChips'); gc.innerHTML = '';
  for (const g of MAP.governorates){
    const el = document.createElement('button');
    el.className = 'tchip'; el.dataset.k = g.ar;
    el.style.setProperty('--c', '#ff3b4e');
    el.textContent = g.ar;
    el.onclick = () => {
      const s = state.filter.govs;
      s.has(g.ar) ? s.delete(g.ar) : s.add(g.ar);
      el.classList.toggle('on', s.has(g.ar));
      applyFilters();
    };
    gc.appendChild(el);
  }
  $('#filterReset').onclick = () => { state.filter.types = new Set(TYPE_KEYS); state.filter.govs.clear(); syncFilterChips(); applyFilters(); };
}

/* ═══════════════ الطبقات ═══════════════ */
const LAYERS_DEF = [
  { k:'govLabels', t:'أسماء المحافظات',   d:'إظهار اسم كل محافظة داخل حدودها' },
  { k:'cityLabels',t:'أسماء المدن',       d:'المدن الرئيسية تظهر دائماً، والبلدات عند التكبير' },
  { k:'grat',      t:'شبكة الإحداثيات',   d:'خطوط الطول والعرض خلف الخريطة' },
  { k:'nbs',       t:'الدول المجاورة',    d:'سياق جغرافي خافت حول سوريا' },
];
function buildLayersModal(){
  const box = $('#layerRows'); box.innerHTML = '';
  for (const L of LAYERS_DEF){
    const row = document.createElement('div'); row.className = 'srow';
    row.innerHTML = `<div class="s-l"><div class="s-t">${L.t}</div><div class="s-d">${L.d}</div></div>`;
    const sw = document.createElement('button');
    sw.className = 'switch' + (state.layers[L.k] ? ' on' : '');
    sw.onclick = () => { state.layers[L.k] = !state.layers[L.k]; sw.classList.toggle('on'); store('ras_layers', state.layers); applyLayerVis(); };
    row.appendChild(sw); box.appendChild(row);
  }
  const leg = $('#legend'); leg.innerHTML = '';
  for (const key of TYPE_KEYS){
    const t = TYPES[key];
    const li = document.createElement('div'); li.className = 'li';
    li.innerHTML = `<i style="background:${t.color};color:${t.color}"></i>${t.ar}`;
    leg.appendChild(li);
  }
}

/* ═══════════════ الإعدادات ═══════════════ */
function buildSettings(){
  const box = $('#setRows'); box.innerHTML = '';
  const mkRow = (title, desc, ctrl) => {
    const row = document.createElement('div'); row.className = 'srow';
    row.innerHTML = `<div class="s-l"><div class="s-t">${title}</div>${desc ? `<div class="s-d">${desc}</div>` : ''}</div>`;
    row.appendChild(ctrl); box.appendChild(row); return row;
  };
  const swSound = document.createElement('button');
  swSound.className = 'switch' + (state.set.sound ? ' on' : '');
  swSound.onclick = () => { state.set.sound = !state.set.sound; swSound.classList.toggle('on'); store('ras_set', state.set); };
  mkRow('صوت صفارة الإنذار', 'صفارة عند ورود تنبيه يخصّ محافظاتك', swSound);

  const swVib = document.createElement('button');
  swVib.className = 'switch' + (state.set.vibrate ? ' on' : '');
  swVib.onclick = () => { state.set.vibrate = !state.set.vibrate; swVib.classList.toggle('on'); store('ras_set', state.set); };
  mkRow('الاهتزاز', 'على الهواتف الداعمة للاهتزاز', swVib);

  const seg = document.createElement('div'); seg.className = 'seg';
  for (const [label, val] of [['بطيء', .5], ['عادي', 1], ['سريع', 2]]){
    const b = document.createElement('button');
    b.textContent = label;
    b.className = (state.set.speed === val) ? 'on' : '';
    b.onclick = () => { state.set.speed = val; store('ras_set', state.set); for (const x of seg.children) x.classList.remove('on'); b.classList.add('on'); };
    seg.appendChild(b);
  }
  mkRow('سرعة المحاكاة', 'وتيرة ورود التنبيهات التجريبية', seg);

  const test = document.createElement('button');
  test.className = 'mini-btn'; test.textContent = 'اختبار الصفارة';
  test.onclick = () => { state.set.sound = true; swSound.classList.add('on'); store('ras_set', state.set); playSiren(); };
  mkRow('اختبار الصوت', 'تشغيل صفارة إنذار نموذجية', test);

  /* followed governorates */
  const fc = $('#followChips'); fc.innerHTML = '';
  for (const g of MAP.governorates){
    const el = document.createElement('button');
    el.className = 'tchip' + (state.set.follow.includes(g.ar) ? ' on' : '');
    el.style.setProperty('--c', '#ff3b4e');
    el.textContent = g.ar;
    el.onclick = () => {
      const f = state.set.follow;
      const i = f.indexOf(g.ar);
      i >= 0 ? f.splice(i, 1) : f.push(g.ar);
      el.classList.toggle('on'); store('ras_set', state.set);
    };
    fc.appendChild(el);
  }
  $('#btnNotif').onclick = async () => {
    try {
      if (!('Notification' in window)) return toast('الإشعارات غير مدعومة في هذا المتصفح', 'err');
      const p = await Notification.requestPermission();
      toast(p === 'granted' ? 'تم تفعيل إشعارات المتصفح ✅' : 'لم يُسمح بالإشعارات', p === 'granted' ? 'ok' : 'err');
    } catch(e){ toast('الإشعارات غير متاحة داخل هذه المعاينة', 'err'); }
  };
  $('#btnTourAgain').onclick = () => { closeTopModal(); startTour(); };
}

/* ═══════════════ بلّغ ═══════════════ */
function buildReport(){
  const sT = $('#rpType'), sG = $('#rpGov');
  for (const key of TYPE_KEYS){ const o = document.createElement('option'); o.value = key; o.textContent = TYPES[key].ar; sT.appendChild(o); }
  for (const g of MAP.governorates){ const o = document.createElement('option'); o.value = g.ar; o.textContent = g.ar; sG.appendChild(o); }
  $('#rpSend').onclick = () => {
    if (!$('#rpLoc').value.trim()) return toast('يرجى تحديد الموقع', 'err');
    toast('تم استلام بلاغك — شكراً لمساهمتك (وضع تجريبي) ✅', 'ok');
    closeTopModal();
    $('#rpLoc').value = ''; $('#rpTxt').value = '';
  };
}

/* ═══════════════ النوافذ العامة ═══════════════ */
const modalStack = [];
function openModal(id){ const m = $(id); m.classList.remove('hidden'); modalStack.push(id); }
function closeTopModal(){ const id = modalStack.pop(); if (id) $(id).classList.add('hidden'); }
$$('.modal').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) closeTopModal(); });
  m.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeTopModal));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape'){
    if (modalStack.length) closeTopModal();
    else closePopup();
  }
});
$('#btnFilter').onclick   = () => openModal('#mFilter');
$('#btnLayers').onclick   = () => openModal('#mLayers');
$('#btnSettings').onclick = () => openModal('#mSettings');
$('#btnReport').onclick   = () => openModal('#mReport');
$('#btnDonate').onclick   = () => openModal('#mDonate');
$('#btnAbout').onclick    = () => openModal('#mAbout');
$('#demoBadge').onclick   = () => openModal('#mAbout');

function toast(msg, kind){
  const t = document.createElement('div');
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = '.4s'; }, 3200);
  setTimeout(() => t.remove(), 3700);
}

/* ═══════════════ جولة التعريف ═══════════════ */
const I = {
  logo:'<svg viewBox="0 0 24 24"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/><path d="M12 8l4.5 8h-9z"/><path d="M12 11.2v2.6M12 14.9v.01"/></svg>',
  map:'<svg viewBox="0 0 24 24"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>',
  feed:'<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M12 8v4l3 2"/><path d="M21 3v5h-5"/></svg>',
  filter:'<svg viewBox="0 0 24 24"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>',
  bell:'<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  warn:'<svg viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
};
const TOUR = [
  { i:'logo',   t:'مرحباً بك في الإنذار الأحمر سوريا', d:'جولةٌ سريعة على خريطة التنبيهات المباشرة، تستغرق نحو ثلاثين ثانية، ويمكنك تخطّيها في أيّ وقت.' },
  { i:'map',    t:'الخريطة المباشرة', d:'تظهر تنبيهات الغارات والمسيّرات والقصف لحظة ورودها كنبضاتٍ ملوّنة على خريطة سوريا — كل لون يعني نوعاً مختلفاً من الأحداث. اسحب للتنقّل، وقرّب بعجلة الفأرة أو بإصبعين.' },
  { i:'feed',   t:'شريط التنبيهات', d:'أحدث التنبيهات تظهر في الشريط الجانبي لحظةً بلحظة. اضغط أي تنبيه للانتقال مباشرةً إلى موقعه على الخريطة.' },
  { i:'filter', t:'التصفية', d:'اختر أنواع التنبيهات التي تهمّك من زر «تصفية»، أو اضغط على أي محافظة في الخريطة لعزل تنبيهاتها. اضغط مرّتين للتكبير على محافظة.' },
  { i:'bell',   t:'الصفارة والإشعارات', d:'فعّل صفارة الإنذار من الإعدادات، وحدّد المحافظات التي تتابعها — لتصلك تنبيهاتها أولاً مع اهتزاز وإشعارات المتصفح.' },
  { i:'warn',   t:'وضع تجريبي', d:'هذا نموذج تصميم والبيانات محاكاة بالكامل لأغراض العرض. لا تعتمد عليه في حالات الطوارئ الفعلية. جاهز؟' },
];
let tourStep = 0;
function renderTour(){
  const s = TOUR[tourStep];
  $('#tourIll').innerHTML = I[s.i];
  $('#tourT').textContent = s.t;
  $('#tourD').textContent = s.d;
  $('#tourNext').textContent = tourStep === TOUR.length - 1 ? 'لنبدأ 🚀' : 'التالي';
  const dots = $('#tourDots'); dots.innerHTML = '';
  TOUR.forEach((_, i) => { const d = document.createElement('i'); if (i === tourStep) d.className = 'on'; dots.appendChild(d); });
}
function startTour(){ tourStep = 0; renderTour(); openModal('#mTour'); }
$('#tourNext').onclick = () => {
  if (tourStep < TOUR.length - 1){ tourStep++; renderTour(); }
  else { closeTopModal(); store('ras_tour_done', 1); toast('جاهز — راقب الخريطة، التنبيه الأول في طريقه', 'ok'); }
};
$('#tourSkip').onclick = () => { closeTopModal(); store('ras_tour_done', 1); };

/* ═══════════════ الشعار ═══════════════ */
$('#logoBox').innerHTML = `
<svg viewBox="0 0 64 64">
  <defs>
    <linearGradient id="lgR" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff5f70"/><stop offset="1" stop-color="#c81e31"/>
    </linearGradient>
  </defs>
  <path d="M32 3l23 8.2v15.5C55 43.5 45.2 55.7 32 61 18.8 55.7 9 43.5 9 26.7V11.2z" fill="url(#lgR)"/>
  <path d="M32 8.2l18 6.4v12.1c0 14.4-7.9 24.9-18 29.6-10.1-4.7-18-15.2-18-29.6V14.6z" fill="#12141f"/>
  <path d="M32 16.5l14.5 25.2H17.5z" fill="url(#lgR)"/>
  <rect x="30.6" y="25.5" width="2.8" height="9.5" rx="1.4" fill="#fff"/>
  <circle cx="32" cy="38.8" r="1.8" fill="#fff"/>
</svg>`;

/* ═══════════════ وضع البيانات الحقيقية (live) ═══════════════ */
let liveMaxId = 0, liveFails = 0, liveLastToast = 0;
async function fetchFeed(){
  const r = await fetch(CONFIG.feedURL, { cache:'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return Array.isArray(j) ? j : (j.alerts || []);
}
async function livePoll(){
  try{
    const arr = await fetchFeed();
    liveFails = 0;
    for (const rec of arr){
      const id = rec.id || rec.ts || 0;
      if (id > liveMaxId){
        liveMaxId = id;
        ingestAlert(rec, {});
      } else if (rec.ended){
        const a = state.alerts.find(x => x.id === id);
        if (a && !a.ended) endAlert(a);
      }
    }
  }catch(e){
    liveFails++;
    if (liveFails >= 3 && Date.now() - liveLastToast > 60000){
      liveLastToast = Date.now();
      toast('تعذّر الاتصال بمصدر البيانات — تجارب الاتصال مستمرة…', 'err');
    }
  }
}
function enterLiveUI(){
  const b = $('#demoBadge');
  b.classList.add('live');
  b.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg> مباشر — متصل بمصدر البيانات';
  b.title = 'الموقع يعرض تنبيهات حقيقية من المصدر المتصل';
  b.onclick = () => openModal('#mAbout');
  const note = document.querySelector('.demo-note');
  if (note) note.classList.add('hidden');
  $('#btnReport').onclick = () => {
    if (CONFIG.reportURL) window.open(CONFIG.reportURL, '_blank', 'noopener');
    else openModal('#mReport');
  };
}
async function startLive(){
  enterLiveUI();
  try{
    const arr = await fetchFeed();
    for (const rec of arr) ingestAlert(rec, { silent:true });
    renderFeedFull();
    liveMaxId = state.alerts.reduce((m, a) => Math.max(m, a.id || 0), 0);
  }catch(e){
    liveLastToast = Date.now();
    toast('تعذّر جلب البيانات الأولية — ستُعاد المحاولة…', 'err');
  }
  applyFilters();
  updateStats();
  setInterval(livePoll, Math.max(3, CONFIG.pollSec) * 1000);
}
function startDemo(){
  seedHistory();
  renderFeedFull();
  applyFilters();
  updateStats();
  scheduleNext();
  setTimeout(() => { if (load('ras_tour_done', 0)) spawnAlert({}); }, 3500);
}

/* ═══════════════ init ═══════════════ */
window.addEventListener('resize', updateScale);
buildMap();
setVB({ x:0, y:0, w:W, h:0 });
buildFilterModal();
buildLayersModal();
buildSettings();
buildReport();

/* تجاوز عبر الرابط: ?live=رابط-التنبيهات&report=رابط-البوت */
(function(){
  try{
    const p = new URLSearchParams(location.search);
    if (p.get('live')){ CONFIG.mode = 'live'; CONFIG.feedURL = p.get('live'); }
    if (p.get('report')) CONFIG.reportURL = p.get('report');
  }catch(e){}
})();

if (CONFIG.mode === 'live' && CONFIG.feedURL) startLive();
else startDemo();

setTimeout(() => { if (!load('ras_tour_done', 0)) startTour(); }, 700);
