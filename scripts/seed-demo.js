// Dev helper: inserts sample alerts into the local store (never run in production).
import { store } from '../server/store.js';
import { locationFrom, searchPlaces } from '../server/places.js';
import { TITLES } from '../server/bot-texts.js';
await store.init(null);
const pick = (q) => { const r = searchPlaces(q, 5).find((x) => typeof x.id === 'number'); return r ? locationFrom({ placeId: r.id }) : locationFrom({}); };
const mk = (type, q, details, ttlMin) => {
  const loc = typeof q === 'string' ? pick(q) : q;
  const named = loc.scope !== 'country';
  store.addAlert({ type, title: named ? `${TITLES[type].ar} — ${loc.name_ar}` : TITLES[type].ar, title_en: named ? `${TITLES[type].en} — ${loc.name_en}` : TITLES[type].en, description: details, location: loc, areas: named ? [loc.name_ar, loc.district_ar, loc.governorate_ar].filter((x, i, a) => x && a.indexOf(x) === i) : [], ttlMin, source: 'telegram', author: { id: 1, name: 'demo' } });
};
mk('uav', 'درعا', 'رصد مسيّرة تحلّق على علو منخفض فوق المدينة.');
mk('warplane', 'إدلب', 'تحليق مكثف للطيران الحربي في الأجواء.');
mk('artillery', 'حلب', 'قصف مدفعي على الأطراف الشمالية.');
mk('missile', 'القنيطرة', 'سماع دوي انفجارات ناتجة عن سقوط صواريخ.');
mk('attack', 'تدمر', 'هجوم على نقطة عسكرية في محيط المدينة.');
mk('civil', 'حمص', 'فرق الدفاع المدني تعمل على إخماد حريق في حي سكني.');
mk('breaking', locationFrom({}), 'عاجل: انقطاع واسع للتيار الكهربائي في عدة محافظات.');
mk('uav', 'اللاذقية', '');
mk('uav', locationFrom({ govCode: '13' }), 'مسيّرات فوق دمشق.');
mk('accident', 'طرطوس', 'حادث سير على الطريق الدولي.');
mk('protest', 'السويداء', 'مظاهرة في الساحة العامة.');
mk('fire', 'حماة', 'حريق في أرض زراعية.');
mk('civil_plane', 'دير الزور', 'طائرة مدنية تحلّق على ارتفاع منخفض.');
store._writeLocal();
console.log('seeded', store.activeAlerts().length);
process.exit(0);
