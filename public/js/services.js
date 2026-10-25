// Services on the website: 💱 prices · ⚡ electricity · 🛣 road status layer · 🏥 nearby services
// (hospitals, pharmacies, fuel stations, bakeries from OpenStreetMap) · 📍 better "my location".
// Everything here is additive: the alert map keeps working even if this module fails.
import { settings } from './settings.js';
import { WX_ICONS, WX_LABEL } from '/shared/wx-icons.js';

const S = {
  ar: {
    services: 'الخدمات', prices: 'الأسعار', power: 'الكهرباء', roads: 'الطرق', borders: 'المعابر', nearby: 'قريب مني', weather: 'الطقس',
    sheetTitle: 'خدمات يومية', sheetSub: 'أسعار اليوم، الطقس، الكهرباء، حالة الطرق والمعابر، وأقرب مشفى وصيدلية وكازية وفرن.',
    showWx: 'اعرض الطقس على الخريطة', wxSub: 'الطقس الحالي وتوقعات اليوم وبكرا لكل محافظة وبعض المناطق الجبلية. البيانات من Open-Meteo وبتتحدث كل نص ساعة.', wxNow: 'الطقس الآن', today: 'اليوم', tomorrow: 'بكرا', wind: 'رياح', hum: 'رطوبة', kmh: 'كم/س', mm: 'ملم', rainP: 'احتمال المطر', gusts: 'هبّات', mountains: 'مناطق جبلية', wxErr: 'تعذّر تحميل الطقس، جرّب بعد شوي.', wxWarn: 'تحذيرات فعّالة', snowCm: 'ثلج', cm: 'سم',
    market: 'سعر السوق الموازي (عام)', official: 'نشرة مصرف سورية المركزي', buy: 'شراء', sell: 'مبيع',
    usd: 'دولار', eur: 'يورو', try: 'ليرة تركية', sar: 'ريال سعودي', aed: 'درهم إماراتي',
    gold: 'الذهب (للغرام)', k24: 'عيار 24', k21: 'عيار 21', k18: 'عيار 18', ounce: 'الأونصة عالمياً',
    fuel: 'المحروقات', fuelSince: 'سارية منذ', fuelChecked: 'آخر تحقق', fuelSrc: 'المصدر', fuelStale: 'لم نتمكن من التحقق من أسعار المحروقات منذ أكثر من 3 أيام، قد تكون تغيّرت.', fuelTiers: 'أصناف المازوت حسب وزارة الطاقة', tariffs: 'تعرفة الكهرباء', newLira: 'بالليرة الجديدة', oldLira: 'بالقديمة',
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
    svcLayers: 'الخدمات على الخريطة', modes: { pharmacy: 'الصيدليات', health: 'المشافي والمراكز الصحية', fuel: 'الكازيات', bakery: 'الأفران', power: 'الكهرباء', roads: 'الطرق', borders: 'المعابر', weather: 'الطقس' },
    backNews: 'رجوع للأخبار', zoomHint: (n) => `قرّب الخريطة لتشوف ${n}`, h24: 'مفتوحة 24 ساعة', showOnMap: 'اعرض على الخريطة', modeHint: 'الأخبار مخفية مؤقتاً', pwLvl: { cut: 'تقنين أشد / انقطاع', ok: 'تحسّن', mid: 'تحديث', none: 'لا يوجد تحديث' }, pwNat: 'تحديث عام لكل سوريا', mapPower: 'اعرض حالة الكهرباء على الخريطة',
    away: (d) => `يبعد ${d}`, km: 'كم', m: 'م',
    locTitle: 'تحديد موقعك', locWhy: 'منستخدم موقعك بس على جهازك لنوريك وين إنت على الخريطة، وكم تبعد عنك التنبيهات والخدمات. ما منرسله ولا منخزّنه عندنا.',
    locGo: 'حدّد موقعي', locCancel: 'مو هلق', locWait: 'عم نحدّد موقعك…',
    locDenied: 'إذن الموقع مرفوض', locDeniedTxt: 'فعّل إذن الموقع لهذا الموقع من إعدادات المتصفح (رمز القفل جنب العنوان ← الموقع ← سماح)، وتأكد إن خدمة الموقع (GPS) شغّالة بالجهاز، وبعدين جرّب مرة تانية.',
    locFail: 'ما قدرنا نحدّد موقعك', locFailTxt: 'تأكد إن خدمة الموقع (GPS) شغّالة، وجرّب بمكان مكشوف أو قريب من شباك. إذا كنت فاتح الموقع من داخل تيليغرام أو فيسبوك، افتحه بمتصفح الجهاز (كروم أو سفاري).',
    locInsecure: 'تحديد الموقع بيحتاج اتصال آمن. افتح الموقع على https://red-alert-syria.onrender.com',
    locOutside: 'موقعك برّا سوريا — الخريطة بتعرض سوريا بس.', accuracy: (m) => `الدقة تقريباً ± ${m}`,
    youHere: 'إنت هون', ok: 'تمام', retry: 'جرّب مرة تانية', close: 'إغلاق', ago: 'من',
  },
  en: {
    services: 'Services', prices: 'Prices', power: 'Electricity', roads: 'Roads', borders: 'Borders', nearby: 'Near me', weather: 'Weather',
    sheetTitle: 'Daily services', sheetSub: 'Today\'s prices, weather, electricity, road status, and the nearest hospital, pharmacy, fuel station and bakery.',
    showWx: 'Show the weather on the map', wxSub: 'Current weather and the forecast for today and tomorrow in every governorate and a few mountain areas. Data from Open-Meteo, refreshed every 30 minutes.', wxNow: 'Weather now', today: 'Today', tomorrow: 'Tomorrow', wind: 'Wind', hum: 'Humidity', kmh: 'km/h', mm: 'mm', rainP: 'Chance of rain', gusts: 'Gusts', mountains: 'Mountain areas', wxErr: 'Could not load the weather, try again shortly.', wxWarn: 'Active warnings', snowCm: 'Snow', cm: 'cm',
    market: 'Parallel market (Syria, general)', official: 'Central Bank of Syria bulletin', buy: 'Buy', sell: 'Sell',
    usd: 'US dollar', eur: 'Euro', try: 'Turkish lira', sar: 'Saudi riyal', aed: 'UAE dirham',
    gold: 'Gold (per gram)', k24: '24K', k21: '21K', k18: '18K', ounce: 'World ounce',
    fuel: 'Fuel', fuelSince: 'In force since', fuelChecked: 'Last checked', fuelSrc: 'Source', fuelStale: 'We could not confirm the fuel prices for more than 3 days; they may have changed.', fuelTiers: 'Diesel grades per the Ministry of Energy', tariffs: 'Electricity tariffs', newLira: 'new lira', oldLira: 'old',
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
    svcLayers: 'Services on the map', modes: { pharmacy: 'Pharmacies', health: 'Hospitals & clinics', fuel: 'Fuel stations', bakery: 'Bakeries', power: 'Electricity', roads: 'Roads', borders: 'Border crossings', weather: 'Weather' },
    backNews: 'Back to the news', zoomHint: (n) => `Zoom in to see ${n.toLowerCase()}`, h24: 'Open 24 hours', showOnMap: 'Show on the map', modeHint: 'News hidden for now', pwLvl: { cut: 'More rationing / outage', ok: 'Improving', mid: 'Update', none: 'No update' }, pwNat: 'Nation-wide update', mapPower: 'Show electricity on the map',
    away: (d) => `${d} away`, km: 'km', m: 'm',
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
const SVC_LAYERS = ['svc-poi-pt', 'svc-poi-cl', 'svc-road-pt', 'svc-road-ln', 'svc-bd-c', 'svc-pw-c', 'svc-pw-i', 'svc-wx-i', 'svc-wx-x'];
// one service category at a time on the map ("map mode"); the news is hidden meanwhile
const MODES = { pharmacy: { color: CAT_COLORS.pharmacy, icon: 'pharmacy' }, health: { color: CAT_COLORS.hospital, icon: 'hospital' }, fuel: { color: CAT_COLORS.fuel, icon: 'fuel' }, bakery: { color: CAT_COLORS.bakery, icon: 'bakery' }, power: { color: '#ca8a04', icon: 'bolt' }, roads: { color: '#ef4444', icon: 'route' }, borders: { color: '#16a34a', icon: 'door' }, weather: { color: '#0284c7', icon: 'sun' } };
const WARN_C = (lv) => (lv === 2 ? '#dc2626' : '#f59e0b');
const PW_COLORS = { cut: '#dc2626', mid: '#f59e0b', ok: '#16a34a', none: '#94a3b8' };
// governorate centres for the electricity circles (Rif Dimashq drawn east of the city so the two don't overlap)
const GOV_C = { '01': [36.52, 40.75, 'الحسكة', 'Al-Hasakah'], '02': [35.53, 35.79, 'اللاذقية', 'Latakia'], '03': [33.12, 35.82, 'القنيطرة', 'Quneitra'], '04': [35.95, 39.01, 'الرقة', 'Raqqa'], '05': [32.71, 36.57, 'السويداء', 'As-Suwayda'], '06': [32.62, 36.10, 'درعا', 'Daraa'], '07': [35.33, 40.14, 'دير الزور', 'Deir ez-Zor'], '08': [33.62, 36.62, 'ريف دمشق', 'Rif Dimashq'], '09': [36.20, 37.16, 'حلب', 'Aleppo'], '10': [35.13, 36.75, 'حماة', 'Hama'], '11': [34.73, 36.71, 'حمص', 'Homs'], '12': [35.93, 36.63, 'إدلب', 'Idlib'], '13': [33.51, 36.29, 'دمشق', 'Damascus'], '14': [34.89, 35.89, 'طرطوس', 'Tartus'] };
const pwLevel = (t) => (/(زياد|ارتفاع|تمديد).{0,20}(التقنين|تقنين|القطع|قطع)|انقطاع|عطل|خروج.{0,12}عن الخدمة|توقف|تخفيض.{0,15}(ساعات )?(الوصل|التغذية)|outage|cut/i.test(t) ? 'cut'
  : /تحسن|تحسّن|زيادة.{0,12}(ساعات )?(الوصل|التغذية)|تخفيض.{0,15}التقنين|تخفيف.{0,15}التقنين|عودة.{0,10}(التيار|الكهرباء)|إعادة.{0,10}(التيار|التغذية)|improv/i.test(t) ? 'ok' : 'mid');
const is24 = (h) => /24\/7|00:00-24:00|24 ?(ساعة|h)/i.test(h || '');
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
  const st = { mode: null, prices: null, roads: [], power: [], borders: [], poi: null, poiLoading: null, tab: 'prices', q: '', cat: 'all', gov: 'all', me: null, popup: null, wx: null, wxAt: 0, wxLoading: null, wxErr: false };
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
  // weather: fetched only when the weather mode / tab is used, kept 10 min on the device (server caches 30 min)
  function loadWx(force) {
    if (st.wx && !force && Date.now() - st.wxAt < 10 * 60_000) return Promise.resolve(st.wx);
    if (!st.wxLoading) {
      st.wxLoading = fetch('/api/weather').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((j) => {
        if (!j.ok || !Array.isArray(j.points)) throw new Error('bad');
        for (const p of j.points) if (p.main && GOV_C[p.gov]) { p.lat = GOV_C[p.gov][0]; p.lon = GOV_C[p.gov][1]; }
        st.wx = j; st.wxAt = Date.now(); st.wxErr = false; paintWx();
        if (isOpen() && st.tab === 'weather') render();
        return j;
      }).catch((e) => { st.wxErr = true; if (isOpen() && st.tab === 'weather') render(); throw e; }).finally(() => { st.wxLoading = null; });
    }
    return st.wxLoading;
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
  // small line-style icons (white disc, coloured ring and strokes) in the spirit of the drone / warplane markers
  function drawIcon(kind, color) {
    const s = 52; const c = document.createElement('canvas'); c.width = s; c.height = s;
    const g = c.getContext('2d'); const m = s / 2;
    g.shadowColor = 'rgba(15,23,42,.28)'; g.shadowBlur = 4; g.shadowOffsetY = 1;
    g.beginPath(); g.arc(m, m, m - 5, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    g.shadowColor = 'transparent';
    g.lineWidth = 2.6; g.strokeStyle = color; g.stroke();
    g.fillStyle = color; g.strokeStyle = color; g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 2.6;
    const rr = (x, y, w, h, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); };
    if (kind === 'hospital' || kind === 'clinic') {
      g.beginPath(); g.moveTo(m - 3.5, m - 10); g.lineTo(m + 3.5, m - 10); g.lineTo(m + 3.5, m - 3.5); g.lineTo(m + 10, m - 3.5); g.lineTo(m + 10, m + 3.5); g.lineTo(m + 3.5, m + 3.5); g.lineTo(m + 3.5, m + 10); g.lineTo(m - 3.5, m + 10); g.lineTo(m - 3.5, m + 3.5); g.lineTo(m - 10, m + 3.5); g.lineTo(m - 10, m - 3.5); g.lineTo(m - 3.5, m - 3.5); g.closePath(); g.stroke();
    } else if (kind === 'pharmacy') {
      g.save(); g.translate(m, m); g.rotate(-Math.PI / 4);
      rr(-11, -5, 22, 10, 5); g.stroke(); rr(-11, -5, 11, 10, [5, 0, 0, 5]); g.fill(); g.restore();
    } else if (kind === 'fuel') {
      rr(m - 9, m - 10, 11, 19, 2); g.stroke(); g.beginPath(); g.moveTo(m - 6.5, m - 5); g.lineTo(m - 0.5, m - 5); g.stroke();
      g.beginPath(); g.moveTo(m + 2, m - 6); g.lineTo(m + 6, m - 2); g.lineTo(m + 6, m + 6); g.quadraticCurveTo(m + 6, m + 8, m + 8, m + 6); g.lineTo(m + 8, m - 4); g.stroke();
      g.beginPath(); g.moveTo(m - 11, m + 10); g.lineTo(m + 4, m + 10); g.stroke();
    } else if (kind === 'bakery') {
      g.beginPath(); g.ellipse(m, m + 1, 11, 7, 0, 0, Math.PI * 2); g.stroke();
      for (const dx of [-5, 0, 5]) { g.beginPath(); g.moveTo(m + dx - 1.8, m - 3); g.lineTo(m + dx + 1.8, m + 4); g.stroke(); }
    } else if (kind === 'bolt') {
      g.beginPath(); g.moveTo(m + 2, m - 12); g.lineTo(m - 7, m + 2); g.lineTo(m - 0.5, m + 2); g.lineTo(m - 2, m + 12); g.lineTo(m + 7, m - 2); g.lineTo(m + 0.5, m - 2); g.closePath(); g.fill();
    } else if (kind === 'closed') { g.lineWidth = 3.4; g.beginPath(); g.moveTo(m - 9, m); g.lineTo(m + 9, m); g.stroke(); }
    else if (kind === 'danger') { g.lineWidth = 3.2; g.beginPath(); g.moveTo(m, m - 10); g.lineTo(m, m + 3); g.stroke(); g.beginPath(); g.arc(m, m + 8.5, 2, 0, Math.PI * 2); g.fill(); }
    else if (kind === 'open') { g.lineWidth = 3.4; g.beginPath(); g.moveTo(m - 8, m + 1); g.lineTo(m - 2.5, m + 6.5); g.lineTo(m + 9, m - 6); g.stroke(); }
    return g.getImageData(0, 0, s, s);
  }
  // weather markers: same white disc + thin coloured ring, the condition drawn as a line icon (Path2D)
  function drawWx(kind) {
    const ic = WX_ICONS[kind] || WX_ICONS.cloud;
    const s = 52; const c = document.createElement('canvas'); c.width = s; c.height = s;
    const g = c.getContext('2d'); const m = s / 2;
    g.shadowColor = 'rgba(15,23,42,.28)'; g.shadowBlur = 4; g.shadowOffsetY = 1;
    g.beginPath(); g.arc(m, m, m - 5, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    g.shadowColor = 'transparent'; g.lineWidth = 2.2; g.strokeStyle = ic.color; g.stroke();
    const sc = 26 / 24; g.save(); g.translate(m - 13, m - 13); g.scale(sc, sc);
    g.lineWidth = 2.1; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = ic.color;
    for (const d of ic.paths) { try { g.stroke(new Path2D(d)); } catch { /* old browser */ } }
    g.restore();
    return c;
  }
  const wxUrl = {};
  const wxImg = (k, sz = 26) => { if (!wxUrl[k]) wxUrl[k] = drawWx(k).toDataURL('image/png'); return `<img class="wx-ic" src="${wxUrl[k]}" width="${sz}" height="${sz}" alt="">`; };
  function ensureImages(m) {
    for (const k of Object.keys(WX_ICONS)) if (!m.hasImage('svc-wx-' + k)) { const c = drawWx(k); m.addImage('svc-wx-' + k, c.getContext('2d').getImageData(0, 0, c.width, c.height), { pixelRatio: 2 }); }
    for (const [k, col] of Object.entries(CAT_COLORS)) if (!m.hasImage('svc-' + k)) m.addImage('svc-' + k, drawIcon(k, col), { pixelRatio: 2 });
    for (const [k, col] of Object.entries(ROAD_COLORS)) if (!m.hasImage('svc-road-' + k)) m.addImage('svc-road-' + k, drawIcon(k, col), { pixelRatio: 2 });
    for (const [k, col] of Object.entries(PW_COLORS)) if (!m.hasImage('svc-pw-' + k)) m.addImage('svc-pw-' + k, drawIcon('bolt', col), { pixelRatio: 2 });
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
  const enabledCats = () => (GROUPS[st.mode] || []);
  function poiGeo() {
    const cats = new Set(enabledCats());
    const feats = !st.poi || !cats.size ? [] : st.poi.filter((p) => cats.has(p.cat)).map((p) => ({ type: 'Feature', properties: { i: p.i, icon: 'svc-' + p.cat, name: poiName(p), h24: is24(p.hours) ? 1 : 0 }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }));
    return { type: 'FeatureCollection', features: feats };
  }
  // electricity: one soft circle per governorate, coloured by its latest update (or the latest nation-wide one)
  function powerByGov() {
    const nat = st.power.find((p) => !p.gov);
    return Object.entries(GOV_C).map(([code, c]) => {
      const own = st.power.filter((p) => p.gov === code);
      const top = own[0] || nat || null;
      return { code, lat: c[0], lon: c[1], name: LANG === 'en' ? c[3] : c[2], items: own, nat: !own.length && !!nat, level: top ? pwLevel(top.text) : 'none' };
    });
  }
  function powerGeo() {
    return { type: 'FeatureCollection', features: powerByGov().map((g) => ({ type: 'Feature', properties: { code: g.code, level: g.level, name: g.name, own: g.items.length ? 1 : 0 }, geometry: { type: 'Point', coordinates: [g.lon, g.lat] } })) };
  }
  const wxName = (p) => (LANG === 'en' ? p.en || p.ar : p.ar);
  const wxWarns = (p) => (st.wx?.warnings || []).filter((w) => w.govs.includes(p.gov));
  function wxGeo() {
    const pts = st.wx?.points || [];
    return { type: 'FeatureCollection', features: pts.filter((p) => p.now && Number.isFinite(p.now.t)).map((p) => {
      const ws = wxWarns(p);
      return { type: 'Feature', properties: { id: p.id, main: p.main, icon: 'svc-wx-' + p.now.k, tt: `${p.now.t}°`, name: wxName(p), warn: ws.length ? Math.max(...ws.map((w) => w.level)) : 0 }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } };
    }) };
  }
  function paintWx() { const src = map()?.getSource?.('svc-wx'); if (src) src.setData(wxGeo()); }
  function paintPower() { const src = map()?.getSource?.('svc-pw'); if (src) src.setData(powerGeo()); }
  function addLayers() {
    const m = map(); if (!m || !m.isStyleLoaded?.() && !m.getStyle()) return;
    try {
      ensureImages(m);
      if (!m.getSource('svc-poi')) m.addSource('svc-poi', { type: 'geojson', data: poiGeo(), cluster: true, clusterMaxZoom: 12, clusterRadius: 38 });
      if (!m.getSource('svc-roads')) m.addSource('svc-roads', { type: 'geojson', data: roadsGeo() });
      const f = font(m);
      if (!m.getLayer('svc-poi-cl')) {
        const col = (MODES[st.mode] || MODES.pharmacy).color;
        const pt = ['!', ['has', 'point_count']];
        // soft transparent circle under each place, and a glowing pulse for the ones open 24 hours
        m.addLayer({ id: 'svc-poi-halo', type: 'circle', source: 'svc-poi', filter: pt, minzoom: 11, paint: { 'circle-color': col, 'circle-opacity': 0.12, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 9, 16, 30], 'circle-stroke-color': col, 'circle-stroke-opacity': 0.25, 'circle-stroke-width': 1 } });
        m.addLayer({ id: 'svc-poi-glow', type: 'circle', source: 'svc-poi', filter: ['all', pt, ['==', ['get', 'h24'], 1]], paint: { 'circle-color': col, 'circle-opacity': 0.3, 'circle-blur': 0.6, 'circle-radius': 16 } });
        // light, small clusters (white with a thin coloured ring) instead of heavy dark bubbles
        m.addLayer({ id: 'svc-poi-cl', type: 'circle', source: 'svc-poi', filter: ['has', 'point_count'], paint: { 'circle-color': '#ffffff', 'circle-opacity': 0.94, 'circle-stroke-color': col, 'circle-stroke-width': 1.6, 'circle-stroke-opacity': 0.85, 'circle-radius': ['step', ['get', 'point_count'], 10, 10, 12, 50, 14, 200, 16] } });
        m.addLayer({ id: 'svc-poi-cn', type: 'symbol', source: 'svc-poi', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': f, 'text-size': 10.5, 'text-allow-overlap': true }, paint: { 'text-color': col } });
        m.addLayer({ id: 'svc-poi-pt', type: 'symbol', source: 'svc-poi', filter: pt, layout: { 'icon-image': ['get', 'icon'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 14, 1], 'icon-allow-overlap': true, 'text-field': ['step', ['zoom'], '', 14, ['get', 'name']], 'text-font': f, 'text-size': 11.5, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-optional': true, 'text-max-width': 9 }, paint: { 'text-color': '#1f2937', 'text-halo-color': '#fff', 'text-halo-width': 1.4 } });
      }
      if (!m.getSource('svc-pw')) {
        m.addSource('svc-pw', { type: 'geojson', data: powerGeo() });
        const lc = ['match', ['get', 'level'], 'cut', PW_COLORS.cut, 'ok', PW_COLORS.ok, 'mid', PW_COLORS.mid, PW_COLORS.none];
        m.addLayer({ id: 'svc-pw-c', type: 'circle', source: 'svc-pw', paint: { 'circle-color': lc, 'circle-opacity': ['case', ['==', ['get', 'own'], 1], 0.2, 0.1], 'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 5, 18, 8, 70, 10, 200], 'circle-stroke-color': lc, 'circle-stroke-width': 1.4, 'circle-stroke-opacity': 0.55 } });
        m.addLayer({ id: 'svc-pw-i', type: 'symbol', source: 'svc-pw', layout: { 'icon-image': ['concat', 'svc-pw-', ['get', 'level']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 9, 1], 'icon-allow-overlap': true, 'text-field': ['get', 'name'], 'text-font': f, 'text-size': 11, 'text-offset': [0, 1.5], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': '#1f2937', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
      }
      if (!m.getSource('svc-wx')) {
        m.addSource('svc-wx', { type: 'geojson', data: wxGeo() });
        const lbl = ['step', ['zoom'], ['get', 'tt'], 7, ['concat', ['get', 'tt'], '  ', ['get', 'name']]];
        const sym = (id, filter, minzoom) => ({ id, type: 'symbol', source: 'svc-wx', filter, minzoom, layout: { 'icon-image': ['get', 'icon'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.78, 9, 1], 'icon-allow-overlap': true, 'text-field': lbl, 'text-font': f, 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11.5, 9, 13], 'text-offset': [0, 1.45], 'text-anchor': 'top', 'text-optional': true, 'text-allow-overlap': false }, paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } });
        // a soft ring under governorates that have an active weather warning
        m.addLayer({ id: 'svc-wx-w', type: 'circle', source: 'svc-wx', filter: ['>', ['get', 'warn'], 0], paint: { 'circle-color': ['case', ['==', ['get', 'warn'], 2], '#dc2626', '#f59e0b'], 'circle-opacity': 0.16, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 17, 9, 26], 'circle-stroke-color': ['case', ['==', ['get', 'warn'], 2], '#dc2626', '#f59e0b'], 'circle-stroke-width': 1.6, 'circle-stroke-opacity': 0.7 } });
        m.addLayer(sym('svc-wx-i', ['==', ['get', 'main'], 1], 0));
        m.addLayer(sym('svc-wx-x', ['==', ['get', 'main'], 0], 7));
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
    const v = (ids, on) => { for (const id of ids) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };
    v(['svc-road-ln', 'svc-road-pt'], st.mode === 'roads');
    v(['svc-bd-c', 'svc-bd-t'], st.mode === 'borders');
    v(['svc-pw-c', 'svc-pw-i'], st.mode === 'power');
    v(['svc-wx-w', 'svc-wx-i', 'svc-wx-x'], st.mode === 'weather');
    const poi = !!GROUPS[st.mode];
    v(['svc-poi-halo', 'svc-poi-cl', 'svc-poi-cn', 'svc-poi-pt'], poi);
    v(['svc-poi-glow'], poi && (st.mode === 'pharmacy' || st.mode === 'health'));
    if (poi) {
      const col = MODES[st.mode].color;
      for (const [id, prop] of [['svc-poi-halo', 'circle-color'], ['svc-poi-halo', 'circle-stroke-color'], ['svc-poi-glow', 'circle-color'], ['svc-poi-cl', 'circle-stroke-color'], ['svc-poi-cn', 'text-color']]) if (m.getLayer(id)) m.setPaintProperty(id, prop, col);
    }
    glow(poi && (st.mode === 'pharmacy' || st.mode === 'health'));
  }
  // gentle pulse for 24-hour pharmacies / hospitals (only while that mode is on)
  let glowT = 0;
  function glow(on) {
    if (!on) { if (glowT) cancelAnimationFrame(glowT); glowT = 0; return; }
    if (glowT) return;
    let last = 0;
    const tick = (t) => {
      glowT = requestAnimationFrame(tick);
      if (t - last < 60 || document.hidden) return; last = t;
      const m = map(); if (!m || !m.getLayer('svc-poi-glow')) return;
      const k = (Math.sin(t / 450) + 1) / 2;
      const z = m.getZoom(); const base = z < 10 ? 10 : z < 13 ? 14 : 20;
      m.setPaintProperty('svc-poi-glow', 'circle-radius', base + k * base * 0.8);
      m.setPaintProperty('svc-poi-glow', 'circle-opacity', 0.38 - k * 0.26);
    };
    glowT = requestAnimationFrame(tick);
  }
  // ------------------------------------------------------------ map mode
  let bar;
  function modeBar() {
    const el = getMap()?.el || document.querySelector('.map')?.parentElement;
    if (!bar) {
      bar = document.createElement('div'); bar.className = 'svc-bar'; bar.hidden = true;
      bar.addEventListener('click', (e) => {
        if (e.target.closest('[data-a="exit"]')) { e.stopPropagation(); exitMode(); }
        else if (e.target.closest('[data-a="list"]')) { e.stopPropagation(); open(st.mode === 'power' ? 'power' : st.mode === 'roads' ? 'roads' : st.mode === 'borders' ? 'borders' : st.mode === 'weather' ? 'weather' : 'nearby'); }
      });
    }
    if (el && bar.parentElement !== el) el.append(bar);
    return bar;
  }
  function renderBar() {
    const b = modeBar();
    if (!st.mode) { b.hidden = true; return; }
    const md = MODES[st.mode]; const name = L.modes[st.mode];
    const z = map()?.getZoom?.() || 0;
    const hint = GROUPS[st.mode] && z < 9.5 ? L.zoomHint(name) : L.modeHint;
    b.style.setProperty('--c', md.color);
    b.innerHTML = `<button class="svc-bar-main" data-a="list"><i class="svc-bar-ic">${icon(md.icon === 'hospital' || md.icon === 'pharmacy' || md.icon === 'fuel' || md.icon === 'bakery' ? 'mapPin' : md.icon, 15)}</i><span><b>${esc(name)}</b><small>${esc(hint)}</small></span></button><button class="svc-bar-x" data-a="exit">${icon('x', 14)}<span>${esc(L.backNews)}</span></button>`;
    b.hidden = false;
  }
  function enterMode(k, { fly = true } = {}) {
    if (!MODES[k]) return;
    st.mode = k;
    close();
    const am0 = getMap(); am0?.setNewsHidden?.(true);
    if (st.popup) { st.popup.remove(); st.popup = null; }
    document.body.classList.add('svc-on');
    if (GROUPS[k]) loadPoi().then(() => { if (st.mode === k) paintPoi(); }).catch(() => toast(L.dataErr));
    clearInterval(st.wxT);
    if (k === 'weather') { loadWx().catch(() => toast(L.wxErr)); st.wxT = setInterval(() => { if (st.mode === 'weather' && !document.hidden) loadWx().catch(() => {}); }, 15 * 60_000); }
    paintPower(); applyVisibility(); renderBar();
    const m = map();
    if (fly && m) {
      if (GROUPS[k] && st.me) m.flyTo({ center: [st.me.lon, st.me.lat], zoom: Math.max(m.getZoom(), 12.5), essential: true });
      else if (k === 'power' || k === 'borders' || k === 'weather') am0?.fitSyria?.();
    }
  }
  function exitMode() {
    if (!st.mode) return;
    st.mode = null; clearInterval(st.wxT);
    if (st.popup) { st.popup.remove(); st.popup = null; }
    getMap()?.setNewsHidden?.(false);
    document.body.classList.remove('svc-on');
    applyVisibility(); renderBar();
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('[data-a="svc-exit"]')) { e.stopPropagation(); document.getElementById('ddBack')?.click(); const lp = document.getElementById('layersPanel'); if (lp) lp.hidden = true; return exitMode(); }
    const b = e.target.closest?.('[data-svcmode]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    document.getElementById('ddBack')?.click();
    for (const id of ['layersPanel', 'filterPanel']) { const p = document.getElementById(id); if (p) p.hidden = true; }
    const k = b.dataset.svcmode;
    if (st.mode === k && b.closest('.dd-panel')) return exitMode();
    enterMode(k);
  }, true);
  function paintRoads() { const src = map()?.getSource?.('svc-roads'); if (src) src.setData(roadsGeo()); }
  function paintPoi() { const src = map()?.getSource?.('svc-poi'); if (src) src.setData(poiGeo()); applyVisibility(); }
  const modeBtnWide = (k, label) => `<button class="btn-sm svc-mwide${st.mode === k ? ' on' : ''}" data-svcmode="${k}" style="--c:${MODES[k].color}">${icon('mapPin', 15)}${esc(label)}</button>`;
  const modeBtn = (k) => `<button class="svc-mbtn${st.mode === k ? ' on' : ''}" data-svcmode="${k}" style="--c:${MODES[k].color}"><i class="svc-dot"></i>${esc(L.modes[k])}</button>`;
  function meGeo() {
    const me = st.me; if (!me) return { type: 'FeatureCollection', features: [] };
    const r = Math.min(Math.max(me.acc || 50, 15), 5000) / 1000; const ring = [];
    for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2; ring.push([me.lon + (r / (111.32 * Math.cos(me.lat * Math.PI / 180))) * Math.cos(a), me.lat + (r / 110.574) * Math.sin(a)]); }
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] };
  }

  // ------------------------------------------------------------ popups
  function popup(ll, html) {
    const M = window.maplibregl; const m = map(); if (!M || !m) return;
    const gm = getMap();
    gm?.closePopup?.();
    if (st.popup) st.popup.remove();
    st.popAt = Date.now();
    const inner = `<div class="pp svc-pp" dir="${LANG === 'ar' ? 'rtl' : 'ltr'}">${html}</div>`;
    // phones (and a phone in desktop mode): a card docked at the bottom, like the news alerts,
    // so it never leaves the screen or covers the zoom buttons
    if (gm?.dockMode?.() && gm.openDockHtml) {
      const pp = gm.openDockHtml(inner, ll, { cls: 'svc-dock', onClose: () => { if (st.popup === pp) st.popup = null; } });
      st.popup = pp;
      if (!st.dockClick) {
        st.dockClick = true;
        // tap on the empty map closes the card (a tap on another icon opens its own card instead)
        m.on('click', (e) => { if (window.__svcHit && window.__svcHit(e)) return; const was = st.popup; setTimeout(() => { if (was && st.popup === was && was._dock) { was.remove(); st.popup = null; } }, 0); });
      }
      return;
    }
    st.popup = new M.Popup({ closeButton: true, closeOnClick: true, maxWidth: '290px', offset: 16, focusAfterOpen: false }).setLngLat(ll).setHTML(inner).addTo(m);
    if (gm?.bindClamp) { gm.bindClamp(); requestAnimationFrame(() => gm.clampPopups()); }
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
  function powerPopHtml(g) {
    const top = g.items[0] || (g.nat ? st.power.find((p) => !p.gov) : null);
    const lv = g.level;
    let h = `<div class="pp-top"><span class="badge live" style="--c:${PW_COLORS[lv]}">${esc(L.pwLvl[lv])}</span>${top ? `<span class="time">${esc(when(top.ts))}</span>` : ''}</div><p class="pp-title">⚡ ${esc(g.name)}</p>`;
    if (top) h += `<p class="pp-desc">${esc(top.text.length > 260 ? top.text.slice(0, 257) + '…' : top.text)}</p>${g.nat ? `<p class="pp-areas">${esc(L.pwNat)}</p>` : ''}`;
    else h += `<p class="pp-areas">${esc(L.powerEmpty)}</p>`;
    return h;
  }
  const fmtHM = new Intl.DateTimeFormat(LANG === 'ar' ? 'ar-SY' : 'en-GB', { timeZone: 'Asia/Damascus', hour: 'numeric', minute: '2-digit' });
  const T = (v) => (v == null ? '—' : `${v}°`);
  const wxDayRow = (d, label) => {
    const bits = [];
    if (d.rain >= 0.5 || d.pop >= 20) bits.push(`🌧 ${d.rain >= 0.5 ? `${num(d.rain, 1)} ${L.mm} · ` : ''}${d.pop ?? 0}%`);
    if (d.snow >= 0.5) bits.push(`❄️ ${num(d.snow, 1)} ${L.cm}`);
    if (d.gust != null) bits.push(`💨 ${d.gust} ${L.kmh}`);
    return `<div class="wx-d"><span class="wx-dn">${esc(label)}</span>${wxImg(d.k, 22)}<span class="wx-dl">${esc(WX_LABEL[LANG]?.[d.k] || '')}</span><span class="wx-t" dir="ltr">${T(d.max)} <small>/ ${T(d.min)}</small></span></div><div class="wx-dx">${bits.map(esc).join(' · ')}</div>`;
  };
  function wxPopHtml(p) {
    const n = p.now; const ws = wxWarns(p);
    const lbl = WX_LABEL[LANG] || WX_LABEL.ar;
    let h = `<div class="pp-top"><span class="badge" style="--c:${MODES.weather.color}">${esc(L.wxNow)}</span>${st.wx?.at ? `<span class="time">${esc(L.updated)} ${esc(fmtHM.format(new Date(st.wx.at)))}</span>` : ''}</div>
      <p class="pp-title">${esc(wxName(p))}</p>
      <div class="wx-now">${wxImg(n.k, 40)}<b dir="ltr">${T(n.t)}</b><span><em>${esc(lbl[n.k] || '')}</em><small><span class="nw">${esc(L.wind)} <bdi>${n.wind ?? '—'}</bdi> ${esc(L.kmh)}</span>${n.hum != null ? ` · <span class="nw">${esc(L.hum)} <bdi>${n.hum}%</bdi></span>` : ''}</small></span></div>
      <div class="wx-days">${(p.days || []).slice(0, 2).map((d, i) => wxDayRow(d, i ? L.tomorrow : L.today)).join('')}</div>`;
    for (const w of ws) h += `<div class="wx-warn" style="--c:${WARN_C(w.level)}">${esc(w.emoji)} <b>${esc(LANG === 'en' ? w.en : w.ar)}</b></div>`;
    return h;
  }
  function focusWx(p) {
    const m = map(); if (!m) return;
    m.flyTo({ center: [p.lon, p.lat], zoom: Math.max(m.getZoom(), p.main ? 7.6 : 9), essential: true });
    setTimeout(() => popup([p.lon, p.lat], wxPopHtml(p)), 900);
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
    const pwClick = (e) => { const f = e.features?.[0]; const g = f && powerByGov().find((x) => x.code === f.properties.code); if (g) popup([g.lon, g.lat], powerPopHtml(g)); };
    m.on('click', 'svc-pw-i', pwClick); m.on('click', 'svc-pw-c', pwClick);
    const wxClick = (e) => { const f = e.features?.[0]; const p = f && st.wx?.points.find((x) => x.id === f.properties.id); if (p) popup([p.lon, p.lat], wxPopHtml(p)); };
    m.on('click', 'svc-wx-i', wxClick); m.on('click', 'svc-wx-x', wxClick);
    let zt = 0; m.on('zoomend', () => { if (st.mode && GROUPS[st.mode]) { clearTimeout(zt); zt = setTimeout(renderBar, 120); } });
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
    if (/^#(prices|power|roads|borders|services|weather)$/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  }
  const tabBtn = (k, ic, label) => `<button class="svc-tab${st.tab === k ? ' on' : ''}" data-tab="${k}">${icon(ic, 16)}<span>${esc(label)}</span></button>`;
  function render() {
    const b = sheet.querySelector('#svcBody');
    b.innerHTML = `<div class="sheet-grab"></div>
      <div class="svc-head"><div><h2>${esc(L.sheetTitle)}</h2><p>${esc(L.sheetSub)}</p></div><button class="sb-x lg" data-a="close" aria-label="${esc(L.close)}">${icon('x', 18)}</button></div>
      <div class="svc-tabs">${tabBtn('prices', 'coin', L.prices)}${tabBtn('weather', 'sun', L.weather)}${tabBtn('power', 'bolt', L.power)}${tabBtn('roads', 'route', L.roads)}${tabBtn('borders', 'door', L.borders)}${tabBtn('nearby', 'mapPin', L.nearby)}</div>
      <div class="svc-pane">${st.tab === 'prices' ? pricesHtml() : st.tab === 'weather' ? weatherHtml() : st.tab === 'power' ? powerHtml() : st.tab === 'roads' ? roadsHtml() : st.tab === 'borders' ? bordersHtml() : nearbyHtml()}</div>`;
    if (st.tab === 'nearby') renderResults();
    if (st.tab === 'weather' && (!st.wx || Date.now() - st.wxAt > 10 * 60_000) && !st.wxLoading) loadWx().catch(() => {});
  }
  const row = (label, a, b2, ch) => `<div class="px-row"><span class="px-k">${esc(label)}</span><span class="px-v">${a}</span>${b2 != null ? `<span class="px-v">${b2}</span>` : ''}${ch != null ? `<span class="px-ch ${ch > 0 ? 'up' : ch < 0 ? 'dn' : ''}">${ch ? (ch > 0 ? '▲' : '▼') : '•'}</span>` : ''}</div>`;
  const old = (v) => (v == null ? '' : `<small>${num(v * 100)} ${esc(L.oldLira)}</small>`);
  // the price sources give Arabic names / units: English labels for the English site
  const FUEL_EN = { benzin: 'Gasoline 90', 'gasoline-95': 'Gasoline 95', diesel: 'Diesel', gas: 'Cooking gas', kerosene: 'Kerosene', 'diesel-150': 'Diesel, 2nd grade', 'diesel-115': 'Subsidised diesel (heating, farming)' };
  const NOTE_EN = { 'حسب التوزيع': 'as distributed' };
  const fmtD = new Intl.DateTimeFormat(LANG === 'en' ? 'en-GB' : 'ar-SY-u-nu-latn', { day: 'numeric', month: 'long', timeZone: 'Asia/Damascus' });
  const dayOf = (iso) => { const t = Date.parse(`${String(iso).slice(0, 10)}T12:00:00+03:00`); return Number.isFinite(t) ? fmtD.format(t) : ''; };
  const UNIT_EN = [[/^لتر$/, 'litre'], [/^أسطوانة\s*\((\d+)\s*كيلو\)$/, 'cylinder ($1 kg)'], [/^أسطوانة$/, 'cylinder'], [/^كيلو$/, 'kg'], [/^طن$/, 'ton'], [/^ك\.و\.س$/, 'kWh']];
  const TARIFF_EN = { 'houses-under-300kwh': 'Homes (under 300 kWh)', 'houses-above-300kwh': 'Homes (over 300 kWh)', industrial: 'Industrial', commercial: 'Commercial', agricultural: 'Agricultural' };
  const tariffName = (t) => (LANG === 'en' ? TARIFF_EN[t.slug] || t.name_en || t.name : t.name);
  const fuelName = (k, f) => (LANG === 'en' ? FUEL_EN[k] || f.name_en || f.name : f.name);
  const unitTxt = (u) => { if (LANG !== 'en') return u; for (const [re, en] of UNIT_EN) if (re.test(u)) return u.replace(re, en); return u; };
  const unitOf = (x, name = x.name) => (x.unit && !String(x.name).includes(x.unit) ? ` <small>/ ${esc(unitTxt(x.unit))}</small>` : '');
  function pricesHtml() {
    const p = st.prices;
    if (!p || !p.ok) return `<div class="svc-empty">${esc(L.noPrices)}</div>`;
    const m = p.market;
    const cur = ['usd', 'eur', 'try', 'sar', 'aed'].filter((k) => m[k]);
    const g = p.gold || {};
    const fuel = Object.entries(p.fuel?.items || {}).map(([k, f]) => ({ ...f, key: k }));
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
      const F = p.fuel;
      const frow = (f) => `<div class="px-row"><span class="px-k">${esc(fuelName(f.key, f))}${unitOf(f)}${f.note ? ` <small>· ${esc(LANG === 'en' ? NOTE_EN[f.note] || f.note : f.note)}</small>` : ''}</span><span class="px-v">${lira(f.price)}${old(f.price)}</span>${f.usd ? `<span class="px-v" dir="ltr">$${num(f.usd, 2)}</span>` : ''}</div>`;
      const main = fuel.filter((f) => !f.tier); const tiers = fuel.filter((f) => f.tier);
      const since = F.since || F.at || fuel[0]?.at;
      h += `<div class="px-card px-fuel"><div class="px-h"><b>${esc(L.fuel)}</b><span>${since ? `${esc(L.fuelSince)} ${esc(dayOf(since))}` : ''}</span></div>
        ${F.stale ? `<p class="px-warn">⚠️ ${esc(L.fuelStale)}</p>` : ''}
        ${main.map(frow).join('')}
        ${tiers.length ? `<div class="px-sub">${esc(L.fuelTiers)}</div>${tiers.map(frow).join('')}` : ''}
        ${F.checked ? `<div class="px-foot">${esc(L.fuelChecked)}: ${esc(when(F.checked))}${F.srcs?.length ? ` · ${esc(L.fuelSrc)}: <span dir="ltr">${esc(F.srcs.join(' + '))}</span>` : ''}</div>` : ''}</div>`;
    }
    h += `<p class="svc-note">${esc(L.priceNote)}</p>`;
    return h;
  }
  function weatherHtml() {
    let h = `<p class="svc-note" style="margin-top:0">${esc(L.wxSub)}</p>${modeBtnWide('weather', L.showWx)}`;
    const j = st.wx;
    if (!j) return h + `<div class="svc-empty">${esc(st.wxErr ? L.wxErr : L.loading)}</div>`;
    if (j.warnings?.length) {
      h += `<div class="dd-sec">${esc(L.wxWarn)}</div>`;
      h += j.warnings.map((w) => `<div class="wx-warn" style="--c:${WARN_C(w.level)}">${esc(w.emoji)} <b>${esc(LANG === 'en' ? w.en : w.ar)}</b><small>${esc(w.govs.map((c) => GOV_C[c]?.[LANG === 'en' ? 3 : 2]).filter(Boolean).join(LANG === 'en' ? ', ' : '، '))}</small></div>`).join('');
    }
    const row = (p) => {
      const d = p.days?.[0] || {}; const ws = wxWarns(p);
      return `<button class="bd-row wx-row" data-wx="${esc(p.id)}">${wxImg(p.now.k, 30)}<span class="bd-main"><b>${esc(wxName(p))}${ws.length ? ` <i class="svc-dot" style="--c:${WARN_C(Math.max(...ws.map((w) => w.level)))}"></i>` : ''}</b><small>${esc((WX_LABEL[LANG] || WX_LABEL.ar)[p.now.k] || '')}</small></span><span class="wx-rt"><b dir="ltr">${T(p.now.t)}</b><small dir="ltr">${T(d.max)} / ${T(d.min)}</small></span></button>`;
    };
    const order = ['02', '14', '09', '12', '11', '10', '13', '08', '06', '05', '03', '04', '07', '01']; // coast → north → centre → south → east
    const mains = j.points.filter((p) => p.main && p.now).sort((a, b) => order.indexOf(a.gov) - order.indexOf(b.gov));
    h += `<div class="dd-sec">${esc(L.allGovs)}</div><div class="bd-list">${mains.map(row).join('')}</div>`;
    const ex = j.points.filter((p) => !p.main && p.now);
    if (ex.length) h += `<div class="dd-sec">${esc(L.mountains)}</div><div class="bd-list">${ex.map(row).join('')}</div>`;
    h += `<p class="svc-note">${esc(L.updated)}: ${esc(when(j.at))} · <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a></p>`;
    return h;
  }
  function powerHtml() {
    const items = st.power.filter((p) => st.gov === 'all' || (p.gov || 'all') === st.gov || !p.gov);
    const govs = [...new Map(st.power.filter((p) => p.gov).map((p) => [p.gov, LANG === 'en' ? p.gov_en : p.gov_ar])).entries()];
    const tariffs = st.prices?.power?.items || [];
    let h = modeBtnWide('power', L.mapPower);
    h += govs.length ? `<div class="sel-wrap svc-sel"><select class="sel" id="svcGov"><option value="all">${esc(L.allGovs)}</option>${govs.map(([c, n]) => `<option value="${esc(c)}" ${st.gov === c ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>` : '';
    h += items.length ? items.map((p) => `<article class="svc-item"><div class="svc-it-top"><span class="badge" style="--c:#eab308">${icon('bolt', 13)}${esc(LANG === 'en' ? p.gov_en : p.gov_ar)}</span><span class="time">${esc(when(p.ts))}</span></div><p>${esc(p.text)}</p></article>`).join('')
      : `<div class="svc-empty">${esc(L.powerEmpty)}</div>`;
    if (tariffs.length) h += `<div class="px-card"><div class="px-h"><b>${esc(L.tariffs)}</b><span>${esc(L.newLira)}</span></div>${tariffs.map((t) => `<div class="px-row"><span class="px-k">${esc(tariffName(t))}${unitOf(t)}</span><span class="px-v">${lira(t.price)}${old(t.price)}</span></div>`).join('')}</div>`;
    return h;
  }
  function roadsHtml() {
    let h = `<p class="svc-note" style="margin-top:0">${esc(L.roadsSub)}</p>${modeBtnWide('roads', L.showRoads)}`;
    h += st.roads.length ? st.roads.map((r) => `<article class="svc-item" data-road="${esc(r.id)}" tabindex="0"><div class="svc-it-top"><span class="badge live" style="--c:${ROAD_COLORS[r.status]}">${esc(L.road[r.status] || '')}</span><span class="time">${esc(when(r.ts))}</span></div><b>📍 ${esc(roadWhere(r))}</b>${r.note ? `<p>${esc(r.note)}</p>` : ''}<small class="svc-dim">⏳ ${esc(L.until)} ${esc(fmtH.format(new Date(r.expires)))}</small></article>`).join('')
      : `<div class="svc-empty">${esc(L.roadsEmpty)}</div>`;
    const bot = botUrl();
    if (bot) h += `<a class="btn-sm svc-report" href="${esc(bot)}?start=report" target="_blank" rel="noopener noreferrer">${icon('alertO', 15)}${esc(L.reportRoad)}</a>`;
    return h;
  }
  function bordersHtml() {
    let h = `<p class="svc-note" style="margin-top:0">${esc(L.bordersSub)}</p>${modeBtnWide('borders', L.showBorders)}`;
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
    const chip = (k, label) => `<button class="svc-chip${st.cat === k ? ' on' : ''}" data-cat="${k}">${esc(label)}</button>`;
    return `<input class="svc-q" id="svcQ" type="search" placeholder="${esc(L.searchPh)}" value="${esc(st.q)}" autocomplete="off"/>
      <div class="svc-chips">${chip('all', LANG === 'en' ? 'All' : 'الكل')}${Object.keys(GROUPS).map((g) => chip(g, L.cats[g])).join('')}</div>
      ${st.me ? `<button class="svc-forget" data-a="forget">${esc(LANG === 'en' ? 'Forget my location on this device' : 'احذف موقعي من هذا الجهاز')}</button>` : `<button class="btn-sm svc-loc" data-a="locate">${icon('locate', 15)}${esc(L.locFirst)}</button>`}
      <div id="svcRes" class="svc-res"></div>
      <div class="dd-sec">${esc(L.svcLayers)}</div>
      <div class="svc-mgrid">${Object.keys(GROUPS).map(modeBtn).join('')}</div>
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
  // kept for old callers: a layer "on" now means its map mode
  function toggleLayer(k, on) { if (on) enterMode(k); else if (st.mode === k) exitMode(); }
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
      if (st.mode !== g) enterMode(g, { fly: false }); else close();
      map()?.flyTo({ center: [p.lon, p.lat], zoom: 15, essential: true });
      setTimeout(() => popup([p.lon, p.lat], poiHtml(p)), 900);
      return;
    }
    const wr = t.closest('[data-wx]');
    if (wr) {
      const p = st.wx?.points.find((x) => x.id === wr.dataset.wx); if (!p) return;
      if (st.mode !== 'weather') enterMode('weather', { fly: false }); else close();
      focusWx(p); return;
    }
    const bdr = t.closest('[data-bd]');
    if (bdr) {
      const b = st.borders.find((x) => x.id === bdr.dataset.bd); if (!b) return;
      if (st.mode !== 'borders') enterMode('borders', { fly: false }); else close();
      focusBorder(b); return;
    }
    const rd = t.closest('[data-road]');
    if (rd) {
      const r = st.roads.find((x) => x.id === rd.dataset.road); if (!r) return;
      if (st.mode !== 'roads') enterMode('roads', { fly: false }); else close();
      focusRoad(r);
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
    else if (h === 'weather') enterMode('weather');
    else if (h === 'services' || h === 'nearby') open('nearby');
    else if (h === 'roads') {
      if (st.roads.length === 1) { enterMode('roads', { fly: false }); focusRoad(st.roads[0]); } else open('roads');
    } else if (['pharmacy', 'pharmacies', 'health', 'fuel', 'bakery'].includes(h)) enterMode(h === 'pharmacies' ? 'pharmacy' : h);
  }
  window.addEventListener('hashchange', fromHash);
  return {
    L,
    init() {
      bindMap();
      load().then(() => { paintPower(); fromHash(); });
      setInterval(load, 10 * 60_000);
    },
    open, close, isOpen, locate, distanceTo, kmTo, fmtAway, forgetMe, hasMe: () => !!st.me,
    setRoads(r) { st.roads = Array.isArray(r) ? r : []; paintRoads(); if (isOpen() && st.tab === 'roads') render(); },
    setBorders(b) { st.borders = Array.isArray(b) ? b : []; paintBorders(); if (isOpen() && st.tab === 'borders') render(); },
    setPower(p) { st.power = Array.isArray(p) ? p : []; paintPower(); if (isOpen() && st.tab === 'power') render(); },
    layersHtml() {
      return `<div class="dd-sec">${esc(L.svcLayers)}</div>
        <div class="svc-mgrid">${Object.keys(MODES).map(modeBtn).join('')}</div>
        ${st.mode ? `<button class="svc-mexit" data-a="svc-exit">${icon('x', 13)}${esc(L.backNews)}</button>` : ''}`;
    },
    exitMode, enterMode, mode: () => st.mode,
    toggleLayer,
  };
}
