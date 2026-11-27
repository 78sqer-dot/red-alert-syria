import test from 'node:test';
import assert from 'node:assert/strict';
import { ALERT_TYPES, TYPE_KEYS } from '../shared/types.js';
import { NEWS_TYPES, ruleClassify, refineType } from '../server/news-ai.js';
import { BOT_ALERT_MENU_GROUPS, BOT_ALERT_MENU_DIRECT_TYPES } from '../server/bot.js';
import { _test as monitor } from '../server/news-monitor.js';
import { TITLES } from '../server/bot-texts.js';
import { TYPE_ICON } from '../public/js/type-icons.js';

const cases = [
  ['مداهمة منازل في بلدة جاسم بريف درعا بالتزامن مع تحليق مسيرة استطلاع.', 'raid'],
  ['اقتحمت قوات الأمن منازل في مدينة حلب واعتقلت ثلاثة أشخاص.', 'raid'],
  ['داهمت قوة أمنية منزلاً في حمص السورية اليوم.', 'raid'],
  ['توغلت قوات الاحتلال إلى قرية حضر في القنيطرة بالتزامن مع تحليق مسيرة.', 'military_incursion'],
  ['نصبت قوات الاحتلال حاجز تفتيش في القنيطرة السورية اليوم.', 'military_incursion'],
  ['هجوم مسلح على حاجز في درعا بالتزامن مع تحليق مسيرة في المنطقة.', 'attack'],
  ['إطلاق النار على سيارة مدنية في مدينة حمص مع تحليق مسيرة.', 'attack'],
  ['اختطاف شاب في مدينة حلب مع تحليق مسيرة في المنطقة.', 'kidnapping'],
  ['استهداف سيارة في مدينة درعا السورية اليوم.', 'targeted_strike'],
  ['استهدافاً بمسيّرة لسيارة في درعا السورية اليوم.', 'uav_strike'],
  ['هجوم بمسيرة مذخرة على موقع في دير الزور السورية اليوم.', 'uav_strike'],
  ['غارة جوية على موقع في حمص مع تحليق مسيرة.', 'airstrike'],
  ['اغتيال شاب برصاص مسلحين في درعا مع تحليق مسيرة.', 'assassination'],
  ['اشتباكات مسلحة في حلب مع تحليق مسيرة في المنطقة.', 'clashes'],
  ['تحليق مسيرة استطلاع فوق درعا السورية اليوم.', 'uav'],
  ['اعتقال شخص في مدينة حلب السورية اليوم.', 'arrest'],
];
test('automatic source events match their dedicated buttons despite secondary drones or wrong AI labels', () => {
 for (const [text, expected] of cases) {
  assert.equal(ruleClassify(text)?.type, expected, text);
  for (const starting of ['breaking','uav','warplane','attack','arrest','explosion']) {
   assert.equal(refineType(starting,text),expected, `${starting}: ${text}`);
  }
 }
});
test('all news categories exist on both manual and monitored edit menus, with title and icon', () => {
 const manual = [...BOT_ALERT_MENU_DIRECT_TYPES,...Object.values(BOT_ALERT_MENU_GROUPS).flat()];
 const editable = [...monitor.editableTypeDirectTypes,...Object.values(monitor.editableTypeGroups).flat()];
 for (const type of NEWS_TYPES) {
  assert.ok(ALERT_TYPES[type],type); assert.ok(TYPE_KEYS.includes(type),type);
  assert.ok(manual.includes(type),`manual ${type}`); assert.ok(editable.includes(type),`monitor ${type}`);
  assert.ok(TITLES[type],`title ${type}`); assert.ok(TYPE_ICON[type],`icon ${type}`);
 }
});
test('source lead is not overridden by unrelated later incidents',()=>{
 const text='مداهمة منازل في مدينة حلب السورية اليوم.\nغارة جوية في تقرير منفصل عن أمس.';
 assert.equal(ruleClassify(text)?.type,'raid');
 assert.equal(refineType('uav',text),'raid');
});
