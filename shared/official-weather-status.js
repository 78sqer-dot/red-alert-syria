// Availability is not a forecast or an all-clear. Coverage is always bounded.
export function officialWarningAvailability(debug={}) {
  let reason='available';
  if(debug.persistenceReady===false)reason='restoring';
  else if(debug.publicationBlocked)reason=debug.fetching?'saving-or-checking':'unavailable';
  else if(debug.lifecycleErrors)reason='identity-uncertain';
  else if(debug.floorOmissions)reason='history-incomplete';
  else if(!['ok','ok-empty'].includes(debug.health)||debug.stale||debug.fetching)reason=debug.fetching?'checking':'unavailable';
  return {state:reason==='available'?'bounded':'unavailable',reason,coverage:'bounded-latest-8',successAt:debug.successAt||null};
}
export function officialWarningStatusText(status,lang='ar') {
  if(status?.state==='bounded')return lang==='en'?'Only the fetched subset of official warnings is shown. This is not an all-clear or complete source coverage.':'نعرض فقط الجزء الذي جُلب من التحذيرات الرسمية. هذا ليس إعلان أمان ولا تأكيداً لاكتمال تغطية المصدر.';
  const reasons={restoring:['جارٍ استعادة سجل التحذيرات','Warning history is being restored'],'saving-or-checking':['جارٍ التحقق من التحذيرات أو حفظ سجلها','Warning verification or history saving is in progress'],'identity-uncertain':['تعذّر التحقق من هوية التحذير أو تحديثه وإلغائه','Warning identity, update or cancellation could not be verified'],'history-incomplete':['سجل التحذيرات غير مكتمل؛ حُجبت مواد قديمة احترازياً','Warning history is incomplete; older items were withheld'],'checking':['جارٍ تحديث التحذيرات','Warnings are being refreshed'],unavailable:['التحذيرات الرسمية غير متاحة أو غير مكتملة حالياً','Official warnings are unavailable or incomplete']};
  const pair=reasons[status?.reason]||reasons.unavailable;
  return lang==='en'?pair[1]+'. Missing warnings do not mean safe conditions or no warnings. Check the official source.':pair[0]+'. غياب التحذيرات لا يعني أمان الطقس أو عدم وجود تحذيرات. راجع المصدر الرسمي.';
}
export function officialWarningEmptyText(status,lang='ar'){
 return status?.state==='bounded'?(lang==='en'?'No active warning is displayed from the fetched subset.':'لا يظهر تحذير نشط ضمن الجزء الذي جُلب.'):officialWarningStatusText(status,lang);
}
