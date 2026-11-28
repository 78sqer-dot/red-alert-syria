import crypto from 'node:crypto';
export const POST1664_ID='f6b6a924-6a82-4efb-b058-9507f162b31c';
export const POST1664_EXPECTED='769926e31fbe376535aea16df27976fe956e94b30e7e3d8cee6ec171ffd19905';
export const post1664Revision=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Pure review candidate. No store import, timer, startup wiring, bot or side effect.
// Does not authorize a mutation. Actual Telegram media/caption/keyboard must be
// independently captured, reviewed and guarded before any future execution.
export function post1664CorrectionCandidate(current,now=Date.now()){
  if(post1664Revision(current)!==POST1664_EXPECTED)return null;
  const {alert:a,draft:d,cache:c}=structuredClone(current);
  if(a.id!==POST1664_ID||a.channel_message_id!==1664||!a.is_active||Date.parse(a.expires_at)<=now||a.channel_media!=='photo'||d.status!=='published'||d.postId!==1664)return null;
  const label={scope:'country',name_ar:'مدينة باب الهوى الصناعية',name_en:'Bab al-Hawa Industrial City',short_ar:'مدينة باب الهوى الصناعية · إدلب',short_en:'Bab al-Hawa Industrial City · Idlib',governorate:'12',governorate_ar:'إدلب',governorate_en:'Idlib'};
  a.location=null;a.place=label;a.scope='country';a.extra=[];a.areas=['مدينة باب الهوى الصناعية','إدلب'];
  a.title='تطور سياسي — توسعة مدينة باب الهوى الصناعية';a.title_en='Political development — Bab al-Hawa Industrial City expansion';
  a.meta.political.category=null;
  a.meta.siteReview={state:'unresolved',reason:'industrial-facility-is-not-same-name-settlement',category:'unresolved',priorPlaceId:11554691};
  d.loc=structuredClone(label);d.extra=[];d.politicalCategory=null;d.politicalNeedsCategory=true;
  c.politicalCategory=null;c.headline=[a.title,a.description].join(' ');c.where='مدينة باب الهوى الصناعية، إدلب';c.geo={pts:[],dists:[],govs:['ادلب'],coarse:true,none:true};
  return {alert:a,draft:d,cache:c};
}
