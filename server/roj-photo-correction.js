// Exact owner-requested correction of post 1553, never a general migration.
export const ROJ_CORRECTION_KEY = 'owner-roj-photo-label-2026-11-24';
export function rojCorrectionCandidate(a) {
  if (!a || a.id !== '3320c747-0028-45be-b13e-a3c81da25fbf' || a.channel_message_id !== 1553
    || a.type !== 'attack' || a.channel_media !== 'photo' || a.place?.place_id !== 900000000053
    || a.description !== 'إصابة ثلاثة أشخاص بينهم امرأتان وطفل برصاص عناصر الحماية في مخيم روج بريف المالكية.'
    || !a.meta?.newsSources?.some(s => s.url === 'https://t.me/AbomosaabSharkea/183201')
    || a.extra?.length !== 1 || a.extra[0]?.place_id !== 173530) return null;
  return {...a, title: 'هجوم — مخيم الروج - الحسكة', title_en: 'Attack — Roj Camp - Al-Hasakah',
    place: {...a.place, name_ar: 'مخيم الروج', short_ar: 'مخيم الروج - الحسكة', short_en: 'Roj Camp - Al-Hasakah'}, extra: [], zones: null};
}

export const MINE_CORRECTION_KEY='owner-mine-discovery-1552-2026-11-24';
export function mineCorrectionCandidate(a) {
 if(!a||a.id!=='d991de89-fc86-409e-9f91-99e365c958aa'||a.channel_message_id!==1552||a.type!=='explosion'||a.place?.place_id!==164316||a.channel_media!=='photo'
 ||a.description!=='عثور أهالي قرية الشيوخ شرق حلب على لغم أرضي من مخلفات تنظيم قسد أثناء تسوية طريق مدرسة الناصرية.'
 ||!a.meta?.newsSources?.some(s=>s.url==='https://t.me/zainaldinmaham1/143593'))return null;
 return {...a,type:'civil',title:'تنبيه مدني — الشيوخ شرق حلب - حلب',title_en:'Civil alert — Al-Shuyukh east of Aleppo',location:null,scope:'country',extra:[],zones:null,
 place:{scope:'place',name_ar:'الشيوخ شرق حلب',name_en:'Al-Shuyukh east of Aleppo',governorate_ar:'حلب',governorate_en:'Aleppo',governorate:'09',short_ar:'الشيوخ شرق حلب - حلب',short_en:'Al-Shuyukh east of Aleppo - Aleppo'}};
}
