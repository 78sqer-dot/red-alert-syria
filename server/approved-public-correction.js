import crypto from 'node:crypto';
const COPY_KEYS=['title','title_en','description','description_en','body'];
function boundFields(alert){return {...(['approximate_point','geographic_reference'].includes(alert.location_display) ? {location_display:alert.location_display,...(alert.meta?.geographicReferenceAudit?.featureKind?{geographic_reference_kind:alert.meta.geographicReferenceAudit.featureKind}:{})} : {}),id:alert.id,post:alert.channel_message_id,type:alert.type,place:alert.place,location:alert.location,extra:alert.extra||[],channelTitle:alert.meta?.channelTitle,caution_visual:alert.caution_visual,civilEmoji:alert.meta?.civilEmoji,...Object.fromEntries(COPY_KEYS.map(key=>[key,alert[key]??'']))};}
export function approvedCorrectionFingerprint(alert){return crypto.createHash('sha256').update(JSON.stringify(boundFields(alert))).digest('hex');}
export function approvedPublicCorrection(alert){
 const marker=alert?.meta?.approvedPublicCorrection;
 if(alert?.location_display==='geographic_reference' && !(alert.scope==='place' && alert.place?.scope==='place' && Number.isFinite(alert.location?.latitude) && Number.isFinite(alert.location?.longitude) && alert.location.latitude===alert.place.latitude && alert.location.longitude===alert.place.longitude && Array.isArray(alert.areas) && alert.areas.length===1 && alert.areas[0]===alert.place.name_ar && Array.isArray(alert.zones) && alert.zones.length===0 && Array.isArray(alert.extra) && alert.extra.length===0))return null;
 if(alert?.source!=='news'||marker?.version!==1||marker.fingerprint!==approvedCorrectionFingerprint(alert))return null;
 return Object.fromEntries(COPY_KEYS.map(key=>[key,alert[key]??'']));
}
export function publishedRepairRevision(alert){
 return crypto.createHash('sha256').update(JSON.stringify({fields:boundFields(alert),meta:alert.meta,active:alert.is_active,expires:alert.expires_at})).digest('hex');
}
