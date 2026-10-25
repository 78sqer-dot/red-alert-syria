// Services on the website: 💱 prices · ⚡ electricity · 🛣 road status layer · 🏥 nearby services
// (hospitals, pharmacies, fuel stations, bakeries from OpenStreetMap) · 📍 better "my location".
// Everything here is additive: the alert map keeps working even if this module fails.
import { settings } from './settings.js';

const S = {
  ar: {
    services: 'الخدمات', prices: 'الأسعار', power: 'الكهرباء', roads: 'الطرق', borders: 'المعابر', nearby: 'قريب مني',
    sheetTitle: 'خدمات يومية', sheetSub: 'أسعار اليوم، الكهرباء، حالة الطرق والمعابر، وأقرب مشفى وصيدلية وكازية وفرن.',
    market: 'سعر السوق الموازي (عام)', official: 'نشرة مصرف سورية المركزي', buy: 'شراء', sell: 'مبيع',
    usd: 'دولار', eur: 'يورو', try: 'ليرة تركية', sar: 'ريال سعودي', aed: 'درهم إماراتي',
    gold: 'الذهب (للغرام)', k24: 'عيار 24', k21: 'عيار 21', k18: 'عيار 18', ounce: 'الأونصة عالمياً',
    fuel: 'المحروقات', tariffs: 'تعرفة الكهرباء', newLira: 'بالليرة الجديدة', oldLira: 'بالقديمة',
    updated: 'آخر تحديث', noPrices: 'الأسعار مو متوفرة هلق، جرّب بعد شوي.',
    priceNote: 'الأسعار استرشادية وقد تختلف بين المحلات والمدن. الليرة الجديدة = 100 ليرة قديمة.',
    powerEmpty: 'ما في تحديثات كهرباء منشورة حالياً.', allSyria: 'عموم سوريا', allGovs: 'كل المحافظات',
    roadsEmpty: 'ما في حالات طرق مسجّلة حالياً.', roadsSub: 'حالات الطرق يلي نشرها فريق الرصد أو وصلتنا ببلاغات وتأكدنا منها، وبتنشال لحالها لما تخلص مدتها.',
    showRoads: 'عرض الطرق على الخريطة', showBorders: 'عرض المعابر على الخريطة', bordersSub: 'حالة المعابر الحدودية الرئيسية مع دول الجوار، يحدّثها فريق الرصد. الحالة اللي صار لها أكتر من 3 أيام بلا تحديث بتظهر «غير معروف».', bst: { open: 'مفتوح', busy: 'مفتوح مع ازدحام', partial: 'مفتوح جزئياً', closed: 'مغلق', unknown: 'غير معروف' }, updated: 'آخر تحديث', withC: 'مع', crossing: 'معبر', until: 'لحد', reportRoad: 'بلّغ عن طريق',
    road: { closed: 'طريق مسكّر', danger: 'طريق خطر', open: 'طريق سالك' },
    cats: { health: 'مشافي ومراكز صحية', pharmacy: 'صيدليات', fuel: 'كازيات', bakery: 'أفران' },
    cat1: { hospital: 'مشفى', clinic: 'مركز صحي', pharmacy: 'صيدلية', fuel: 'كازية', bakery: 'فرن' },
    searchPh: 'ابحث باسم المشفى أو الصيدلية أو المنطقة…', nearest: 'الأقرب لموقعك', results: 'النتائج',
    noResults: 'ما لقينا نتائج.', locFirst: 'حدّد موقعك لنرتّب لك الأقرب', loading: 'عم نحمّل البيانات…',
    dataErr: 'تعذّر تحميل البيانات، جرّب بعد شوي.', directions: 'الاتجاهات', call: 'اتصال', hours: 'الدوام',
    osmNote: 'البيانات من OpenStreetMap وقد لا تكون كاملة أو محدّثة. تأكد بالاتصال قبل ما تروح.',
    svcLayers: 'طبقات الخدمات', away: (d) => `يبعد ${d}`, km: 'كم', m: 'م',
    locTitle: 'تحديد موقعك', locWhy: 'منستخدم موقعك بس على جهازك لنوريك وين إنت على الخريطة، وكم تبعد عنك التنبيهات والخدمات. ما منرسله ولا منخزّنه عندنا.',
    locGo: 'حدّد موقعي', locCancel: 'مو هلق', locWait: 'عم نحدّد موقعك…',
    locDenied: 'إذن الموقع مرفوض', locDeniedTxt: 'فعّل إذن الموقع لهذا الموقع من إعدادات المتصفح (رمز القفل جنب العنوان ← الموقع ← سماح)، وتأكد إن خدمة الموقع (GPS) شغّالة بالجهاز، وبعدين جرّب مرة تانية.',
    locFail: 'ما قدرنا نحدّد موقعك', locFailTxt: 'تأكد إن خدمة الموقع (GPS) شغّالة، وجرّب بمكان مكشوف أو قريب من شباك. إذا كنت فاتح الموقع من داخل تيليغرام أو فيسبوك، افتحه بمتصفح الجهاز (كروم أو سفاري).',
    locInsecure: 'تحديد الموقع بيحتاج اتصال آمن. افتح الموقع على https://red-alert-syria.onrender.com',
    locOutside: 'موقعك برّا سوريا — الخريطة بتعرض سوريا بس.', accuracy: (m) => `الدقة تقريباً ± ${m}`,
    youHere: 'إنت هون', ok: 'تمام', retry: 'جرّب مرة تانية', close: 'إغلاق', ago: 'من',
  },
  en: {
    services: 'Services', prices: 'Prices', power: 'Electricity', roads: 'Roads', borders: 'Borders', nearby: 'Near me',
    sheetTitle: 'Daily services', sheetSub: 'Today\'s prices, electricity, road status, and the nearest hospital, pharmacy, fuel station and bakery.',
    market: 'Parallel market (Syria, general)', official: 'Central Bank of Syria bulletin', buy: 'Buy', sell: 'Sell',
    usd: 'US dollar', eur: 'Euro', try: 'Turkish lira', sar: 'Saudi riyal', aed: 'UAE dirham',
    gold: 'Gold (per gram)', k24: '24K', k21: '21K', k18: '18K', ounce: 'World ounce',
    fuel: 'Fuel', tariffs: 'Electricity tariffs', newLira: 'new lira', oldLira: 'old',
    updated: 'Updated', noPrices: 'Prices are not available right now, try again shortly.',
    priceNote: 'Indicative prices; they can differ between shops and cities. 1 new lira = 100 old lira.',
    powerEmpty: 'No electricity updates published right now.', allSyria: 'All Syria', allGovs: 'All governorates',
    roadsEmpty: 'No road statuses right now.', roadsSub: 'Road statuses published by our desk or confirmed from reports; they disappear when their time ends.',
    showRoads: 'Show roads on the map', showBorders: 'Show crossings on the map', bordersSub: 'Status of the main border crossings with neighbouring countries, updated by our desk. A status not updated for 3 days shows as “unknown”.', bst: { open: 'Open', busy: 'Open – heavy traffic', partial: 'Partially open', closed: 'Closed', unknown: 'Unknown' }, updated: 'Updated', withC: 'with', crossing: 'Crossing', until: 'until', reportRoad: 'Report a road',
    road: { closed: 'Road closed', danger: 'Dangerous road', open: 'Road open' },
    cats: { health: 'Hospitals & clinics', pharmacy: 'Pharmacies', fuel: 'Fuel stations', bakery: 'Bakeries' },
    cat1: { hospital: 'Hospital', clinic: 'Clinic', pharmacy: 'Pharmacy', fuel: 'Fuel station', bakery: 'Bakery' },
    searchPh: 'Search a hospital, pharmacy or area…', nearest: 'Nearest to you', results: 'Results',
    noResults: 'No results.', locFirst: 'Set your location to sort by distance', loading: 'Loading data…',
    dataErr: 'Could not load the data, try again shortly.', directions: 'Directions', call: 'Call', hours: 'Hours',
    osmNote: 'Data from OpenStreetMap; it may be incomplete or outdated. Call before you go.',
    svcLayers: 'Service layers', away: (d) => `${d} away`, km: 'km', m: 'm',
    locTitle: 'Your location', locWhy: 'Your location is used only on your device to show where you are and how far alerts and services are. It is never sent to us or stored.',
    locGo: 'Find me', locCancel: 'Not now', locWait: 'Finding your location…',
    locDenied: 'Location permission denied', locDeniedTxt: 'Allow location for this site in your browser settings (the lock icon next to the address → Location → Allow), make sure the device location (GPS) is on, then try again.',
    locFail: 'Could not find your location', locFailTxt: 'Make sure device location (GPS) is on and try near a window or outdoors. If you opened the site inside Telegram or Facebook, open it in your phone\'s browser (Chrome or Safari).',
    locInsecure: 'Location needs a secure connection. Open https://red-alert-syria.onrender.com',
    locOutside: 'You are outside Syria — the map covers Syria only.', accuracy: (m) => `Accuracy about ± ${m}`,
    youHere: 'You are here', ok: 'OK', retry: 'Try again', close: 'Close', ago: '',
  },
};
const CAT_COLORS = { hospital: '#e11d48', clinic: '#db2777', pharmacy: '#059669', fuel: '#d97706', bakery: '#a16207' };
const GROUPS = { health: ['hospital', 'clinic'], pharmacy: ['pharmacy'], fuel: ['fuel'], bakery: ['bakery'] };
const ROAD_COLORS = { closed: '#ef4444', danger: '#f59e0b', open: '#22c55e' };
const SVC_LAYERS = ['svc-poi-pt', 'svc-poi-cl', 'svc-road-pt', 'svc-road-ln', 'svc-bd-c'];
const BD_COLORS = { open: '#16a34a', busy: '#eab308', partial: '#f97316', closed: '#dc2626', unknown: '#94a3b8' };
const ME_KEY = 'ras-me';

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0640]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/\s+/g, ' ').trim();
function km(a, b) {
  const R = 6371; const r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r; const dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function createServices({ LANG, esc, icon, toast, openModal, closeModal, getMap, botUrl }) {
  const L = S[LANG] || S.ar;
  const st = { prices: null, roads: [], power: [], borders: [], poi: null, poiLoading: null, tab: 'prices', q: '', cat: 'all', gov: 'all', me: null, popup: null };
  try { const m = JSON.parse(localStorage.getItem(ME_KEY) || 'null'); if (m && Date.now() - m.t < 6 * 3600_000) st.me = m; } catch { /* ignore */ }
  window.__rasMe = st.me;
  const map = () => getMap()?.map || null;
  const num = (v, d = 0) => (v == null || !Number.isFinite(+v) ? '—' : (+v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
  const lira = (v) => num(v, v < 10 ? 2 : v < 1000 ? 2 : 0);
  const fmtT = new Intl.DateTimeFormat(LANG === 'ar' ? 'ar-SY' : 'en-GB', { timeZone: 'Asia/Damascus', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
  const fmtH = new Intl.DateTimeFormat(LANG === 'ar' ? 'ar-SY' : 'en-GB', { timeZone: 'Asia/Damascus', weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const when = (t) => (t ? fmtT.format(new Date(t)) : '');
  const dist = (d) => (d < 1 ? `${Math.round(d * 100) * 10} ${L.m}` : `${num(d, d < 10 ? 1 : 0)} ${L.km}`);
  const s0 = () => settings.get();

  // ------------------------------------------------------------ data
  async function load() {
    try {
      const r = await fetch('/api/services', { cache: 'no-store' });
      const j = await r.json();
      st.prices = j.prices; st.roads = j.roads || []; st.power = j.power || []; st.borders = j.borders || [];
      paintRoads(); paintBorders(); if (isOpen()) render();
    } catch { /* offline: keep what we have */ }
  }
  function loadPoi() {
    if (st.poi) return Promise.resolve(st.poi);
    if (!st.poiLoading) {
      st.poiLoading = fetch('/data/services.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((j) => {
        const cats = j.cats || [];
        st.poi = (j.items || []).map((x, i) => ({ i, cat: cats[x[0]], lat: x[1], lon: x[2], ar: x[3] || '', en: x[4] || '', phone: x[5] || '', hours: x[6] || '' }))
          .filter((p) => p.cat && Number.isFinite(p.lat) && Number.isFinite(p.lon));
        for (const p of st.poi) p.k = norm(`${p.ar} ${p.en}`);
        st.poiSrc = j.src; st.poiDate = j.generated;
        return st.poi;
      }).catch((e) => { st.poiLoading = null; throw e; });
    }
    return st.poiLoading;
  }
  const GENERIC = /^(pharmacy|hospital|clinic|bakery|fuel|gas station|petrol station|medical center|health center)$/i;
  const poiName = (p) => (LANG === 'en' ? p.en || p.ar : p.ar || (GENERIC.test(p.en.trim()) ? '' : p.en)) || L.cat1[p.cat];

  // ------------------------------------------------------------ map layers
  function drawIcon(kind, color) {
    const s = 44; const c = document.createElement('canvas'); c.width = s; c.height = s;
    const g = c.getContext('2d'); const m = s / 2;
    g.beginPath(); g.arc(m, m, m - 3, 0, Math.PI * 2); g.fillStyle = color; g.fill();
    g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
    g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
    if (kind === 'hospital' || kind === 'clinic') { g.fillRect(m - 3.5, m - 11, 7, 22); g.fillRect(m - 11, m - 3.5, 22, 7); }
    else if (kind === 'pharmacy') {
      g.save(); g.translate(m, m); g.rotate(-Math.PI / 4);
      g.beginPath(); g.roundRect ? g.roundRect(-12, -5.5, 24, 11, 5.5) : g.rect(-12, -5.5, 24, 11); g.lineWidth = 2.6; g.stroke();
      g.beginPath(); g.roundRect ? g.roundRect(-12, -5.5, 12, 11, [5.5, 0, 0, 5.5]) : g.rect(-12, -5.5, 12, 11); g.fill(); g.restore();
    } else if (kind === 'fuel') {
      g.fillRect(m - 10, m - 10, 12, 20); g.fillStyle = color; g.fillRect(m - 7.5, m - 7, 7, 5); g.fillStyle = '#fff';
      g.lineWidth = 2.4; g.beginPath(); g.moveTo(m + 2, m - 4); g.lineTo(m + 7, m - 4); g.lineTo(m + 9, m - 1); g.lineTo(m + 9, m + 7); g.lineTo(m + 6, m + 7); g.lineTo(m + 6, m + 2); g.stroke();
      g.fillRect(m - 12, m + 9, 16, 2.6);
    } else if (kind === 'bakery') {
      g.beginPath(); g.ellipse(m, m + 1, 12, 7.5, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = color; g.lineWidth = 2.2;
      for (const dx of [-6, 0, 6]) { g.beginPath(); g.moveTo(m + dx - 2, m - 4); g.lineTo(m + dx + 2, m + 5); g.stroke(); }
    } else if (kind === 'closed') { g.fillRect(m - 11, m - 3.5, 22, 7); }
    else if (kind === 'danger') { g.fillRect(m - 2.6, m - 12, 5.2, 15); g.beginPath(); g.arc(m, m + 8, 3, 0, Math.PI * 2); g.fill(); }
    else if (kind === 'open') { g.lineWidth = 4.5; g.beginPath(); g.moveTo(m - 9, m + 1); g.lineTo(m - 3, m + 7); g.lineTo(m + 10, m - 7); g.stroke(); }
    return g.getImageData(0, 0, s, s);
  }
  function ensureImages(m) {
    for (const [k, col] of Object.entries(CAT_COLORS)) if (!m.hasImage('svc-' + k)) m.addImage('svc-' + k, drawIcon(k, col), { pixelRatio: 2 });
    for (const [k, col] of Object.entries(ROAD_COLORS)) if (!m.hasImage('svc-road-' + k)) m.addImage('svc-road-' + k, drawIcon(k, col), { pixelRatio: 2 });
  }
  function font(m) {
    for (const l of m.getStyle().layers) if (l.type === 'symbol' && l['source-layer'] === 'place' && l.layout?.['text-font']) return l.layout['text-font'];
    return ['Noto Sans Regular'];
  }
  function roadsGeo() {
    const feats = [];
    for (const r of st.roads) {
      const coords = r.pts.map((p) => [p.lon, p.lat]);
      if (coords.length > 1) feats.push({ type: 'Feature', properties: { id: r.id, status: r.status }, geometry: { type: 'LineString', coordinates: coords } });
      r.pts.forEach((p, i) => feats.push({ type: 'Feature', properties: { id: r.id, status: r.status, icon: 'svc-road-' + r.status, i }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }));
    }
    return { type: 'FeatureCollection', features: feats };
  }
  const bdName = (b) => (LANG === 'en' ? b.name_en : b.name_ar);
  function bordersGeo() {
    return { type: 'FeatureCollection', features: st.borders.map((b) => ({ type: 'Feature', properties: { id: b.id, status: b.status, name: bdName(b), known: b.status !== 'unknown' ? 1 : 0 }, geometry: { type: 'Point', coordinates: [b.lon, b.lat] } })) };
  }
  function paintBorders() { const src = map()?.getSource?.('svc-bd'); if (src) src.setData(bordersGeo()); }
  const enabledCats = () => { const on = s0().svcLayers || []; return Object.entries(GROUPS).filter(([g]) => on.includes(g)).flatMap(([, c]) => c); };
  function poiGeo() {
    const cats = new Set(enabledCats());
    const feats = !st.poi || !cats.size ? [] : st.poi.filter((p) => cats.has(p.cat)).map((p) => ({ type: 'Feature', properties: { i: p.i, icon: 'svc-' + p.cat, name: poiName(p) }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }));
    return { type: 'FeatureCollection', features: feats };
  }
  function addLayers() {
    const m = map(); if (!m || !m.isStyleLoaded?.() && !m.getStyle()) return;
    try {
      ensureImages(m);
      if (!m.getSource('svc-poi')) m.addSource('svc-poi', { type: 'geojson', data: poiGeo(), cluster: true, clusterMaxZoom: 12, clusterRadius: 42 });
      if (!m.getSource('svc-roads')) m.addSource('svc-roads', { type: 'geojson', data: roadsGeo() });
      const f = font(m);
      if (!m.getLayer('svc-poi-cl')) {
        m.addLayer({ id: 'svc-poi-cl', type: 'circle', source: 'svc-poi', filter: ['has', 'point_count'], paint: { 'circle-color': '#334155', 'circle-opacity': 0.88, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-radius': ['step', ['get', 'point_count'], 13, 20, 16, 100, 20] } });
        m.addLayer({ id: 'svc-poi-cn', type: 'symbol', source: 'svc-poi', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': f, 'text-size': 12, 'text-allow-overlap': true }, paint: { 'text-color': '#fff' } });
        m.addLayer({ id: 'svc-poi-pt', type: 'symbol', source: 'svc-poi', filter: ['!', ['has', 'point_count']], layout: { 'icon-image': ['get', 'icon'], 'icon-size': 1, 'icon-allow-overlap': true, 'text-field': ['step', ['zoom'], '', 14, ['get', 'name']], 'text-font': f, 'text-size': 11.5, 'text-offset': [0, 1.5], 'text-anchor': 'top', 'text-optional': true, 'text-max-width': 9 }, paint: { 'text-color': '#1f2937', 'text-halo-color': '#fff', 'text-halo-width': 1.4 } });
      }
      if (!m.getLayer('svc-road-ln')) {
        m.addLayer({ id: 'svc-road-ln', type: 'line', source: 'svc-roads', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'status'], 'closed', ROAD_COLORS.closed, 'open', ROAD_COLORS.open, ROAD_COLORS.danger], 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 3, 12, 6], 'line-dasharray': [1.6, 1.2], 'line-opacity': 0.9 } });
        m.addLayer({ id: 'svc-road-pt', type: 'symbol', source: 'svc-roads', filter: ['==', ['geometry-type'], 'Point'], layout: { 'icon-image': ['get', 'icon'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 1, 12, 1.25], 'icon-allow-overlap': true } });
      }
      if (!m.getSource('svc-bd')) {
        m.addSource('svc-bd', { type: 'geojson', data: bordersGeo() });
        m.addLayer({ id: 'svc-bd-c', type: 'circle', source: 'svc-bd', paint: { 'circle-color': ['match', ['get', 'status'], 'open', BD_COLORS.open, 'busy', BD_COLORS.busy, 'partial', BD_COLORS.partial, 'closed', BD_COLORS.closed, BD_COLORS.unknown], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, ['case', ['==', ['get', 'known'], 1], 5.5, 3.5], 10, ['case', ['==', ['get', 'known'], 1], 9, 6]], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
        m.addLayer({ id: 'svc-bd-t', type: 'symbol', source: 'svc-bd', minzoom: 7, layout: { 'text-field': ['get', 'name'], 'text-font': f, 'text-size': 11, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } });
      }
      if (!m.getSource('svc-me')) {
        m.addSource('svc-me', { type: 'geojson', data: meGeo() });
        m.addLayer({ id: 'svc-me-acc', type: 'fill', source: 'svc-me', paint: { 'fill-color': '#3b8eff', 'fill-opacity': 0.12 } });
        m.addLayer({ id: 'svc-me-ln', type: 'line', source: 'svc-me', paint: { 'line-color': '#3b8eff', 'line-width': 1.5, 'line-opacity': 0.6 } });
      }
      applyVisibility();
    } catch (e) { console.warn('[svc] layers', e); }
  }
  function applyVisibility() {
    const m = map(); if (!m) return;
    const roads = s0().showRoads !== false ? 'visible' : 'none';
    for (const id of ['svc-road-ln', 'svc-road-pt']) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', roads);
    const bd = s0().showBorders !== false ? 'visible' : 'none';
    for (const id of ['svc-bd-c', 'svc-bd-t']) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', bd);
    const poi = enabledCats().length ? 'visible' : 'none';
    for (const id of ['svc-poi-cl', 'svc-poi-cn', 'svc-poi-pt']) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', poi);
  }
  function paintRoads() { const src = map()?.getSource?.('svc-roads'); if (src) src.setData(roadsGeo()); }
  function paintPoi() { const src = map()?.getSource?.('svc-poi'); if (src) src.setData(poiGeo()); applyVisibility(); }
  function meGeo() {
    const me = st.me; if (!me) return { type: 'FeatureCollection', features: [] };
    const r = Math.min(Math.max(me.acc || 50, 15), 5000) / 1000; const ring = [];
    for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2; ring.push([me.lon + (r / (111.32 * Math.cos(me.lat * Math.PI / 180))) * Math.cos(a), me.lat + (r / 110.574) * Math.sin(a)]); }
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] };
  }

  // ------------------------------------------------------------ popups
  function popup(ll, html) {
    const M = window.maplibregl; const m = map(); if (!M || !m) return;
    getMap()?.closePopup?.();
    if (st.popup) st.popup.remove();
    st.popup = new M.Popup({ closeButton: true, closeOnClick: true, maxWidth: '290px', offset: 16, focusAfterOpen: false }).setLngLat(ll).setHTML(`<div class="pp svc-pp" dir="${LANG === 'ar' ? 'rtl' : 'ltr'}">${html}</div>`).addTo(m);
  }
  const dirUrl = (lat, lon) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  function poiHtml(p) {
    const d = st.me ? km([st.me.lon, st.me.lat], [p.lon, p.lat]) : null;
    return `<div class="pp-top"><span class="badge" style="--c:${CAT_COLORS[p.cat]}">${esc(L.cat1[p.cat])}</span>${d != null ? `<span class="time">${esc(L.away(dist(d)))}</span>` : ''}</div>
      <p class="pp-title">${esc(poiName(p))}</p>
      ${p.hours ? `<p class="pp-desc">🕒 ${esc(L.hours)}: <span dir="ltr">${esc(p.hours)}</span></p>` : ''}
      <div class="pp-foot">${p.phone ? `<a class="pp-more" href="tel:${esc(p.phone.split(/[;,]/)[0].replace(/[^\d+]/g, ''))}">${icon('phone', 14)}${esc(L.call)}</a>` : ''}<a class="pp-share" href="${dirUrl(p.lat, p.lon)}" target="_blank" rel="noopener noreferrer">${icon('route', 14)}${esc(L.directions)}</a></div>`;
  }
  const roadWhere = (r) => r.pts.map((p) => (LANG === 'en' ? p.name_en || p.name_ar : p.name_ar)).join(' ← ');
  function roadHtml(r) {
    return `<div class="pp-top"><span class="badge live" style="--c:${ROAD_COLORS[r.status]}">${esc(L.road[r.status] || '')}</span><span class="time">${esc(when(r.ts))}</span></div>
      <p class="pp-title">📍 ${esc(roadWhere(r))}</p>
      ${r.note ? `<p class="pp-desc">${esc(r.note)}</p>` : ''}
      <p class="pp-areas">⏳ ${esc(L.until)} ${esc(fmtH.format(new Date(r.expires)))}</p>`;
  }
  function borderHtml(b) {
    return `<div class="pp-top"><span class="badge live" style="--c:${BD_COLORS[b.status]}">${esc(L.bst[b.status])}</span>${b.ts && b.status !== 'unknown' ? `<span class="time">${esc(when(b.ts))}</span>` : ''}</div>
      <p class="pp-title">🛂 ${esc(L.crossing)} ${esc(bdName(b))}</p>
      <p class="pp-areas">${esc(L.withC)} ${esc(LANG === 'en' ? b.country_en : b.country_ar)}${LANG === 'ar' && b.other_ar ? ` (${esc(b.other_ar)})` : ''}</p>
      ${b.note ? `<p class="pp-desc">${esc(b.note)}</p>` : ''}`;
  }
  function focusBorder(b) {
    const m = map(); if (!m) return;
    m.flyTo({ center: [b.lon, b.lat], zoom: 10, essential: true });
    setTimeout(() => popup([b.lon, b.lat], borderHtml(b)), 950);
  }
  function bindMap() {
    const m = map(); if (!m || m.__svcBound) return; m.__svcBound = true;
    m.on('style.load', addLayers);
    if (m.isStyleLoaded()) addLayers(); else m.once('load', addLayers);
    window.__svcHit = (e) => {
      const ids = SVC_LAYERS.filter((id) => m.getLayer(id));
      return ids.length && m.queryRenderedFeatures(e.point, { layers: ids }).length > 0;
    };
    m.on('click', 'svc-poi-pt', (e) => { const f = e.features?.[0]; const p = f && st.poi?.[f.properties.i]; if (p) popup([p.lon, p.lat], poiHtml(p)); });
    m.on('click', 'svc-poi-cl', (e) => {
      const f = e.features?.[0]; if (!f) return;
      m.getSource('svc-poi').getClusterExpansionZoom(f.properties.cluster_id).then((z) => m.easeTo({ center: f.geometry.coordinates, zoom: z + 0.3 })).catch(() => m.easeTo({ center: f.geometry.coordinates, zoom: m.getZoom() + 2 }));
    });
    const roadClick = (e) => { const f = e.features?.[0]; const r = f && st.roads.find((x) => x.id === f.properties.id); if (r) popup(e.lngLat, roadHtml(r)); };
    m.on('click', 'svc-bd-c', (e) => { const f = e.features?.[0]; const b = f && st.borders.find((x) => x.id === f.properties.id); if (b) popup([b.lon, b.lat], borderHtml(b)); });
    m.on('click', 'svc-road-pt', roadClick); m.on('click', 'svc-road-ln', roadClick);
    for (const id of SVC_LAYERS) {
      m.on('mouseenter', id, () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', id, () => { m.getCanvas().style.cursor = ''; });
    }
  }

  // ------------------------------------------------------------ sheet
  let sheet; let back;
  function ensureSheet() {
    if (sheet) return;
    back = document.createElement('div'); back.className = 'sheet-backdrop'; back.hidden = true;
    sheet = document.createElement('section'); sheet.className = 'about-sheet svc-sheet'; sheet.id = 'svcSheet'; sheet.setAttribute('aria-hidden', 'true');
    sheet.innerHTML = '<div class="about-inner" id="svcBody"></div>';
    document.body.append(back, sheet);
    back.addEventListener('click', close);
    sheet.addEventListener('click', onClick);
    sheet.addEventListener('input', (e) => {
      if (e.target.id === 'svcQ') { st.q = e.target.value; renderResults(); }
    });
    sheet.addEventListener('change', (e) => {
      const t = e.target;
      if (t.id === 'svcGov') { st.gov = t.value; render(); }
      if (t.dataset.sl) toggleLayer(t.dataset.sl, t.checked);
    });
  }
  const isOpen = () => sheet?.classList.contains('open');
  function open(tab) {
    ensureSheet();
    if (tab) st.tab = tab;
    render();
    back.hidden = false; sheet.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => sheet.classList.add('open'));
    if (st.tab === 'nearby') loadPoi().then(() => isOpen() && st.tab === 'nearby' && renderResults()).catch(() => renderResults(true));
  }
  function close() {
    if (!sheet) return;
    sheet.classList.remove('open'); sheet.setAttribute('aria-hidden', 'true'); back.hidden = true;
    if (/^#(prices|power|roads|borders|services)$/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  }
  const tabBtn = (k, ic, label) => `<button class="svc-tab${st.tab === k ? ' on' : ''}" data-tab="${k}">${icon(ic, 16)}<span>${esc(label)}</span></button>`;
  function render() {
    const b = sheet.querySelector('#svcBody');
    b.innerHTML = `<div class="sheet-grab"></div>
      <div class="svc-head"><div><h2>${esc(L.sheetTitle)}</h2><p>${esc(L.sheetSub)}</p></div><button class="sb-x lg" data-a="close" aria-label="${esc(L.close)}">${icon('x', 18)}</button></div>
      <div class="svc-tabs">${tabBtn('prices', 'coin', L.prices)}${tabBtn('power', 'bolt', L.power)}${tabBtn('roads', 'route', L.roads)}${tabBtn('borders', 'door', L.borders)}${tabBtn('nearby', 'mapPin', L.nearby)}</div>
      <div class="svc-pane">${st.tab === 'prices' ? pricesHtml() : st.tab === 'power' ? powerHtml() : st.tab === 'roads' ? roadsHtml() : st.tab === 'borders' ? bordersHtml() : nearbyHtml()}</div>`;
    if (st.tab === 'nearby') renderResults();
  }
  const row = (label, a, b2, ch) => `<div class="px-row"><span class="px-k">${esc(label)}</span><span class="px-v">${a}</span>${b2 != null ? `<span class="px-v">${b2}</span>` : ''}${ch != null ? `<span class="px-ch ${ch > 0 ? 'up' : ch < 0 ? 'dn' : ''}">${ch ? (ch > 0 ? '▲' : '▼') : '•'}</span>` : ''}</div>`;
  const old = (v) => (v == null ? '' : `<small>${num(v * 100)} ${esc(L.oldLira)}</small>`);
  const unitOf = (x) => (x.unit && !String(x.name).includes(x.unit) ? ` <small>/ ${esc(x.unit)}</small>` : '');
  function pricesHtml() {
    const p = st.prices;
    if (!p || !p.ok) return `<div class="svc-empty">${esc(L.noPrices)}</div>`;
    const m = p.market;
    const cur = ['usd', 'eur', 'try', 'sar', 'aed'].filter((k) => m[k]);
    const g = p.gold || {};
    const fuel = Object.values(p.fuel?.items || {});
    let h = `<div class="px-card"><div class="px-h"><b>${esc(L.market)}</b><span>${esc(L.updated)}: ${esc(when(m.at))}</span></div>
      <div class="px-row px-th"><span class="px-k"></span><span class="px-v">${esc(L.buy)}</span><span class="px-v">${esc(L.sell)}</span><span class="px-ch"></span></div>
      ${cur.map((k) => row(L[k], `${lira(m[k].buy)}${old(m[k].buy)}`, `${lira(m[k].sell)}${old(m[k].sell)}`, m[k].change)).join('')}</div>`;
    if (p.official?.usd) {
      const o = p.official;
      h += `<div class="px-card"><div class="px-h"><b>${esc(L.official)}</b><span>${esc(o.date || '')}</span></div>
        ${row(L.usd, `${lira(o.usd.buy)}${old(o.usd.buy)}`, `${lira(o.usd.sell)}${old(o.usd.sell)}`)}
        ${o.eur?.buy ? row(L.eur, `${lira(o.eur.buy)}${old(o.eur.buy)}`, o.eur.sell ? `${lira(o.eur.sell)}${old(o.eur.sell)}` : '—') : ''}</div>`;
    }
    if (g.k21 || g.k18) {
      h += `<div class="px-card"><div class="px-h"><b>${esc(L.gold)}</b><span>${esc(when(g.at))}</span></div>
        ${['k24', 'k21', 'k18'].filter((k) => g[k]).map((k) => row(L[k], `${lira(g[k].buy)}${old(g[k].buy)}`, `${lira(g[k].sell)}${old(g[k].sell)}`, g[k].change)).join('')}
        ${g.ounce ? `<div class="px-row"><span class="px-k">${esc(L.ounce)}</span><span class="px-v" dir="ltr">$${num(g.ounce, 0)}</span></div>` : ''}</div>`;
    }
    if (fuel.length) {
      h += `<div class="px-card"><div class="px-h"><b>${esc(L.fuel)}</b><span>${esc(when(p.fuel.at || fuel[0]?.at))}</span></div>
        ${fuel.map((f) => `<div class="px-row"><span class="px-k">${esc(f.name)}${unitOf(f)}</span><span class="px-v">${lira(f.price)}${old(f.price)}</span>${f.usd ? `<span class="px-v" dir="ltr">$${num(f.usd, 2)}</span>` : ''}</div>`).join('')}</div>`;
    }
    h += `<p class="svc-note">${esc(L.priceNote)}</p>`;
    return h;
  }
  function powerHtml() {
    const items = st.power.filter((p) => st.gov === 'all' || (p.gov || 'all') === st.gov || !p.gov);
    const govs = [...new Map(st.power.filter((p) => p.gov).map((p) => [p.gov, LANG === 'en' ? p.gov_en : p.gov_ar])).entries()];
    const tariffs = st.prices?.power?.items || [];
    let h = govs.length ? `<div class="sel-wrap svc-sel"><select class="sel" id="svcGov"><option value="all">${esc(L.allGovs)}</option>${govs.map(([c, n]) => `<option value="${esc(c)}" ${st.gov === c ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>` : '';
    h += items.length ? items.map((p) => `<article class="svc-item"><div class="svc-it-top"><span class="badge" style="--c:#eab308">${icon('bolt', 13)}${esc(LANG === 'en' ? p.gov_en : p.gov_ar)}</span><span class="time">${esc(when(p.ts))}</span></div><p>${esc(p.text)}</p></article>`).join('')
      : `<div class="svc-empty">${esc(L.powerEmpty)}</div>`;
    if (tariffs.length) h += `<div class="px-card"><div class="px-h"><b>${esc(L.tariffs)}</b><span>${esc(L.newLira)}</span></div>${tariffs.map((t) => `<div class="px-row"><span class="px-k">${esc(t.name)}${unitOf(t)}</span><span class="px-v">${lira(t.price)}${old(t.price)}</span></div>`).join('')}</div>`;
    return h;
  }
  function roadsHtml() {
    const on = s0().showRoads !== false;
    let h = `<p class="svc-note" style="margin-top:0">${esc(L.roadsSub)}</p>
      <label class="tgl"><span class="txt">${esc(L.showRoads)}</span><input class="switch" type="checkbox" data-sl="roads" ${on ? 'checked' : ''}/></label>`;
    h += st.roads.length ? st.roads.map((r) => `<article class="svc-item" data-road="${esc(r.id)}" tabindex="0"><div class="svc-it-top"><span class="badge live" style="--c:${ROAD_COLORS[r.status]}">${esc(L.road[r.status] || '')}</span><span class="time">${esc(when(r.ts))}</span></div><b>📍 ${esc(roadWhere(r))}</b>${r.note ? `<p>${esc(r.note)}</p>` : ''}<small class="svc-dim">⏳ ${esc(L.until)} ${esc(fmtH.format(new Date(r.expires)))}</small></article>`).join('')
      : `<div class="svc-empty">${esc(L.roadsEmpty)}</div>`;
    const bot = botUrl();
    if (bot) h += `<a class="btn-sm svc-report" href="${esc(bot)}?start=report" target="_blank" rel="noopener noreferrer">${icon('alertO', 15)}${esc(L.reportRoad)}</a>`;
    return h;
  }
  function bordersHtml() {
    const on = s0().showBorders !== false;
    let h = `<p class="svc-note" style="margin-top:0">${esc(L.bordersSub)}</p>
      <label class="tgl"><span class="txt">${esc(L.showBorders)}</span><input class="switch" type="checkbox" data-sl="borders" ${on ? 'checked' : ''}/></label>`;
    const groups = [...new Map(st.borders.map((b) => [b.country, LANG === 'en' ? b.country_en : b.country_ar])).entries()];
    for (const [c, cname] of groups) {
      h += `<div class="dd-sec">${esc(cname)}</div><div class="bd-list">`;
      h += st.borders.filter((b) => b.country === c).map((b) => `<button class="bd-row" data-bd="${esc(b.id)}"><i class="svc-dot" style="--c:${BD_COLORS[b.status]}"></i><span class="bd-main"><b>${esc(bdName(b))}</b>${b.note ? `<small>${esc(b.note)}</small>` : ''}</span><span class="bd-st" style="--c:${BD_COLORS[b.status]}">${esc(L.bst[b.status])}${b.ts && b.status !== 'unknown' ? `<small>${esc(when(b.ts))}</small>` : ''}</span></button>`).join('');
      h += '</div>';
    }
    if (!st.borders.length) h += `<div class="svc-empty">${esc(L.loading)}</div>`;
    return h;
  }
  function nearbyHtml() {
    const on = s0().svcLayers || [];
    const chip = (k, label) => `<button class="svc-chip${st.cat === k ? ' on' : ''}" data-cat="${k}">${esc(label)}</button>`;
    return `<input class="svc-q" id="svcQ" type="search" placeholder="${esc(L.searchPh)}" value="${esc(st.q)}" autocomplete="off"/>
      <div class="svc-chips">${chip('all', LANG === 'en' ? 'All' : 'الكل')}${Object.keys(GROUPS).map((g) => chip(g, L.cats[g])).join('')}</div>
      ${st.me ? `<button class="svc-forget" data-a="forget">${esc(LANG === 'en' ? 'Forget my location on this device' : 'احذف موقعي من هذا الجهاز')}</button>` : `<button class="btn-sm svc-loc" data-a="locate">${icon('locate', 15)}${esc(L.locFirst)}</button>`}
      <div id="svcRes" class="svc-res"></div>
      <div class="dd-sec">${esc(L.svcLayers)}</div>
      ${Object.keys(GROUPS).map((g) => `<label class="tgl"><span class="txt"><span class="svc-lbl"><i class="svc-dot" style="--c:${CAT_COLORS[GROUPS[g][0]]}"></i>${esc(L.cats[g])}</span></span><input class="switch" type="checkbox" data-sl="${g}" ${on.includes(g) ? 'checked' : ''}/></label>`).join('')}
      <p class="svc-note">${esc(L.osmNote)} <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a></p>`;
  }
  function renderResults(failed) {
    const box = sheet?.querySelector('#svcRes'); if (!box) return;
    if (!st.poi) { box.innerHTML = `<div class="svc-empty">${esc(failed ? L.dataErr : L.loading)}</div>`; return; }
    const cats = st.cat === 'all' ? null : new Set(GROUPS[st.cat]);
    const q = norm(st.q);
    let list = st.poi.filter((p) => (!cats || cats.has(p.cat)) && (!q || p.k.includes(q)));
    if (st.me) { for (const p of list) p.d = km([st.me.lon, st.me.lat], [p.lon, p.lat]); list.sort((a, b) => a.d - b.d); }
    else list = q ? list : [];
    list = list.slice(0, 25);
    if (!list.length) { box.innerHTML = st.me || q ? `<div class="svc-empty">${esc(L.noResults)}</div>` : ''; return; }
    box.innerHTML = `<div class="dd-sec">${esc(st.me && !q ? L.nearest : L.results)}</div>` + list.map((p) => `<button class="svc-poi" data-poi="${p.i}"><i class="svc-dot" style="--c:${CAT_COLORS[p.cat]}"></i><span class="svc-pn"><b>${esc(poiName(p))}</b><small>${esc(L.cat1[p.cat])}${p.phone ? ' · ☎' : ''}</small></span>${st.me ? `<span class="svc-d">${esc(dist(p.d))}</span>` : ''}</button>`).join('');
  }
  function toggleLayer(k, on) {
    if (k === 'roads') { settings.set({ showRoads: on }); applyVisibility(); return; }
    if (k === 'borders') { settings.set({ showBorders: on }); applyVisibility(); return; }
    const cur = new Set(s0().svcLayers || []);
    if (on) cur.add(k); else cur.delete(k);
    settings.set({ svcLayers: [...cur] });
    if (on) loadPoi().then(paintPoi).catch(() => toast(L.dataErr)); else paintPoi();
  }
  function onClick(e) {
    const t = e.target;
    if (t.closest('[data-a="close"]')) return close();
    const tab = t.closest('[data-tab]');
    if (tab) { st.tab = tab.dataset.tab; render(); if (st.tab === 'nearby') loadPoi().then(() => renderResults()).catch(() => renderResults(true)); return; }
    const cat = t.closest('[data-cat]');
    if (cat) { st.cat = cat.dataset.cat; sheet.querySelectorAll('.svc-chip').forEach((c) => c.classList.toggle('on', c.dataset.cat === st.cat)); return renderResults(); }
    if (t.closest('[data-a="forget"]')) { forgetMe(); getMap()?.hideMe?.(); render(); toast(LANG === 'en' ? 'Location removed from this device' : 'انحذف موقعك من هذا الجهاز'); return; }
    if (t.closest('[data-a="locate"]')) { close(); return locate({ then: () => open('nearby') }); }
    const pe = t.closest('[data-poi]');
    if (pe) {
      const p = st.poi[+pe.dataset.poi]; if (!p) return;
      const g = Object.keys(GROUPS).find((k) => GROUPS[k].includes(p.cat));
      if (!(s0().svcLayers || []).includes(g)) toggleLayer(g, true);
      close();
      map()?.flyTo({ center: [p.lon, p.lat], zoom: 15, essential: true });
      setTimeout(() => popup([p.lon, p.lat], poiHtml(p)), 900);
      return;
    }
    const bdr = t.closest('[data-bd]');
    if (bdr) {
      const b = st.borders.find((x) => x.id === bdr.dataset.bd); if (!b) return;
      if (s0().showBorders === false) toggleLayer('borders', true);
      close(); focusBorder(b); return;
    }
    const rd = t.closest('[data-road]');
    if (rd) {
      const r = st.roads.find((x) => x.id === rd.dataset.road); if (!r) return;
      if (s0().showRoads === false) toggleLayer('roads', true);
      close(); focusRoad(r);
    }
  }
  function focusRoad(r) {
    const m = map(); if (!m) return;
    const M = window.maplibregl;
    if (r.pts.length > 1) { const b = new M.LngLatBounds(); r.pts.forEach((p) => b.extend([p.lon, p.lat])); m.fitBounds(b, { padding: 80, maxZoom: 12, duration: 900 }); }
    else m.flyTo({ center: [r.pts[0].lon, r.pts[0].lat], zoom: 11, essential: true });
    setTimeout(() => popup([r.pts[0].lon, r.pts[0].lat], roadHtml(r)), 950);
  }

  // ------------------------------------------------------------ locate
  async function permState() { try { return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { return 'prompt'; } }
  function locModal(title, text, retry) {
    openModal(`<div class="page-modal"><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="btn-row">${retry ? `<button class="btn-red" data-m="svc-retry">${esc(L.retry)}</button>` : ''}<button class="btn-ghost" data-m="close">${esc(retry ? L.close : L.ok)}</button></div></div>`);
    const md = document.getElementById('modal');
    md.querySelector('[data-m="svc-retry"]')?.addEventListener('click', () => { closeModal(); locate({ skipIntro: true }); }, { once: true });
  }
  async function locate({ skipIntro = false, then } = {}) {
    if (!window.isSecureContext) return locModal(L.locFail, L.locInsecure);
    if (!navigator.geolocation) return locModal(L.locFail, L.locFailTxt);
    const ps = await permState();
    if (ps === 'denied') return locModal(L.locDenied, L.locDeniedTxt, true);
    if (ps !== 'granted' && !skipIntro && !localStorage.getItem('ras-loc-ok')) {
      openModal(`<div class="page-modal"><h2>📍 ${esc(L.locTitle)}</h2><p>${esc(L.locWhy)}</p><div class="btn-row"><button class="btn-red" data-m="svc-go">${esc(L.locGo)}</button><button class="btn-ghost" data-m="close">${esc(L.locCancel)}</button></div></div>`);
      document.getElementById('modal').querySelector('[data-m="svc-go"]')?.addEventListener('click', () => { try { localStorage.setItem('ras-loc-ok', '1'); } catch { /* ignore */ } closeModal(); locate({ skipIntro: true, then }); }, { once: true });
      return;
    }
    const btn = document.getElementById('locateMe');
    btn?.classList.add('busy');
    const waitT = setTimeout(() => toast(L.locWait), 900);
    const done = () => { clearTimeout(waitT); btn?.classList.remove('busy'); };
    const ok = (p) => {
      done();
      const me = { lon: p.coords.longitude, lat: p.coords.latitude, acc: Math.round(p.coords.accuracy || 0), t: Date.now() };
      st.me = me; window.__rasMe = me;
      try { localStorage.setItem(ME_KEY, JSON.stringify(me)); } catch { /* ignore */ }
      window.dispatchEvent(new Event('ras-me'));
      const inSyria = me.lat > 32.2 && me.lat < 37.4 && me.lon > 35.6 && me.lon < 42.5;
      const am = getMap();
      if (am) {
        am.showMe(me.lon, me.lat);
        const z = me.acc > 3000 ? 10 : me.acc > 500 ? 12 : 14;
        am.map?.flyTo({ center: [me.lon, me.lat], zoom: inSyria ? z : 6, essential: true });
        am.map?.getSource?.('svc-me')?.setData(meGeo());
      }
      toast(inSyria ? `${L.youHere} · ${L.accuracy(dist(me.acc / 1000))}` : L.locOutside);
      document.dispatchEvent(new CustomEvent('ras:me', { detail: me }));
      if (then) then();
    };
    const fail = (err, triedLow) => {
      if (err && err.code === 1) { done(); return locModal(L.locDenied, L.locDeniedTxt, true); }
      // timeout / unavailable with high accuracy: one more try with the network position
      if (!triedLow) return navigator.geolocation.getCurrentPosition(ok, (e2) => fail(e2, true), { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
      done(); locModal(L.locFail, L.locFailTxt, true);
    };
    navigator.geolocation.getCurrentPosition(ok, (e) => fail(e, false), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }
  /** "12 km away" for an alert card (empty if no saved location) */
  function distanceTo(lat, lon) {
    if (!st.me || !Number.isFinite(lat)) return '';
    return L.away(dist(km([st.me.lon, st.me.lat], [lon, lat])));
  }
  /** raw km from the saved location (null when the visitor has not shared it) */
  function kmTo(lat, lon) { return st.me && Number.isFinite(lat) ? km([st.me.lon, st.me.lat], [lon, lat]) : null; }
  const fmtAway = (d) => L.away(dist(d));
  const forgetMe = () => { st.me = null; window.__rasMe = null; try { localStorage.removeItem(ME_KEY); } catch { /* ignore */ } am()?.map?.getSource?.('svc-me')?.setData(meGeo()); window.dispatchEvent(new Event('ras-me')); };
  const am = () => getMap();

  // ------------------------------------------------------------ hash links & public API
  function fromHash() {
    const h = location.hash.slice(1);
    if (h === 'prices' || h === 'power' || h === 'borders') open(h);
    else if (h === 'services' || h === 'nearby') open('nearby');
    else if (h === 'roads') {
      if (s0().showRoads === false) toggleLayer('roads', true);
      if (st.roads.length) { if (st.roads.length === 1) focusRoad(st.roads[0]); else open('roads'); } else open('roads');
    }
  }
  window.addEventListener('hashchange', fromHash);
  return {
    L,
    init() {
      bindMap();
      load().then(() => { if ((s0().svcLayers || []).length) loadPoi().then(paintPoi).catch(() => {}); fromHash(); });
      setInterval(load, 10 * 60_000);
    },
    open, close, isOpen, locate, distanceTo, kmTo, fmtAway, forgetMe, hasMe: () => !!st.me,
    setRoads(r) { st.roads = Array.isArray(r) ? r : []; paintRoads(); if (isOpen() && st.tab === 'roads') render(); },
    setBorders(b) { st.borders = Array.isArray(b) ? b : []; paintBorders(); if (isOpen() && st.tab === 'borders') render(); },
    setPower(p) { st.power = Array.isArray(p) ? p : []; if (isOpen() && st.tab === 'power') render(); },
    layersHtml(tg) {
      const s = s0(); const on = s.svcLayers || [];
      return `<div class="dd-sec">${esc(L.svcLayers)}</div>
        <label class="tgl"><span class="txt"><span class="svc-lbl"><i class="svc-dot" style="--c:#ef4444"></i>${esc(L.roads)}</span></span><input class="switch" type="checkbox" data-sl="roads" ${s.showRoads !== false ? 'checked' : ''}/></label>
        <label class="tgl"><span class="txt"><span class="svc-lbl"><i class="svc-dot" style="--c:#16a34a"></i>${esc(L.borders)}</span></span><input class="switch" type="checkbox" data-sl="borders" ${s.showBorders !== false ? 'checked' : ''}/></label>
        ${Object.keys(GROUPS).map((g) => `<label class="tgl"><span class="txt"><span class="svc-lbl"><i class="svc-dot" style="--c:${CAT_COLORS[GROUPS[g][0]]}"></i>${esc(L.cats[g])}</span></span><input class="switch" type="checkbox" data-sl="${g}" ${on.includes(g) ? 'checked' : ''}/></label>`).join('')}`;
    },
    toggleLayer,
  };
}
