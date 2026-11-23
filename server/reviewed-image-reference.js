import {validatedManifestLocality} from './reviewed-locality.js';
import {getPlace} from './places.js';
import {reviewedAlertCopy} from './reviewed-news-copy.js';
// Release-qualified historical references, never incident coordinates. New records fail closed.
const QUALIFIED_REFERENCES=[
  {
    "alertId": "c8be4274-122d-49ad-8158-f0f89b0c86b4",
    "postId": 1510,
    "copyHash": "767a57bcb23335084bf5fb3aebeb71dd81fb499d65b27a361ec95af19674b9a9",
    "sourceBinding": "7d048b123f03c836d0292ad8ae88345e6e2892e673825cfe20bc8845b6f8a829",
    "placeId": 163755,
    "evidence": [
      "https://en.wikipedia.org/wiki/Abu_Rasin"
    ],
    "note_ar": "مرجع لأبو راسين وريفها، لا موقع الانفجار. دون نطاق خطر",
    "note_en": "Town reference only, not explosion location. No danger radius."
  },
  {
    "alertId": "9599a51b-c289-458e-8118-5ff009c4c0ba",
    "postId": 1511,
    "copyHash": "a0b09b8e77e45d1872124672bdf6b858f129fa0938ecb88ffe4574bbd90cae31",
    "sourceBinding": "10ebddf28536e9896bda9a19485422b92233a109f5e51660d0b85338be929ea6",
    "placeId": 174633,
    "evidence": [
      "https://mapcarta.com/12694944"
    ],
    "note_ar": "مرجع للقرية فقط، لا موقع إطلاق النار. دون نطاق خطر",
    "note_en": "Village reference only, not firing location. No danger radius."
  },
  {
    "alertId": "adb9eb87-7086-4b45-ba0d-d43c82c4cf75",
    "postId": 1512,
    "copyHash": "9a42e6ad6a9c728b8266795f16688b90b02debd13997b7beba335b446ba23093",
    "sourceBinding": "b006fbf09b1cd3fffa9eb1727271fb0bb005222858e6901bc72213fdc24fa8ab",
    "placeId": 169389,
    "evidence": [
      "https://www.geonames.org/169389/idlib.html"
    ],
    "note_ar": "مرجع للمدينة فقط، لا موقع المشاجرة. دون نطاق خطر",
    "note_en": "City reference only, not altercation location. No danger radius."
  },
  {
    "alertId": "29c21571-02a0-495c-a35d-beacabfea70a",
    "postId": 1513,
    "copyHash": "1d56f372fa1c739b75f2f8aa1ec9a747ab4f8081f9e90f636552fc379625d450",
    "sourceBinding": "76605a05bd098750810f11246b92048a94822889f161d6306077deb9af78621b",
    "placeId": 173377,
    "evidence": [
      "https://www.geonames.org/173377/al-qamishli.html"
    ],
    "note_ar": "مرجع للمدينة، لا موقع السوق. الوقفة مرتقبة في 24 تشرين الثاني",
    "note_en": "City reference, not market location. Planned for November 24."
  }
];
export function alertLocalityReference(a,reviewed){
 const verified=reviewedAlertCopy(a);if(!verified||verified.version!==2||!reviewed||verified!==reviewed)return null;
 const dynamic=validatedManifestLocality(verified);if(dynamic)return dynamic;
 const q=QUALIFIED_REFERENCES.find(q=>q.alertId===a.id&&q.postId===a.channel_message_id&&q.copyHash===a.meta.reviewedNewsCopy.copyHash&&q.sourceBinding===verified.sourceBinding);if(!q)return null;
 const p=getPlace(q.placeId);if(!p||p.region||p.rank>5)return null;
 return {kind:'locality_reference',placeId:p.id,name_ar:p.ar,name_en:p.en,latitude:p.lat,longitude:p.lon,zoom:12,label_ar:'مرجع جغرافي: '+p.ar,label_en:'Geographic reference: '+p.en,note_ar:q.note_ar,note_en:q.note_en};
}
