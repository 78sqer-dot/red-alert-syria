// ⚖️ Condemnation formulas (owner-approved wording, 2026-11-17).
// ONE place for the texts: the owner edits the wording here and every surface
// (monitor draft cards, report review cards, the editor preview and the
// published post) picks it up. A draft carries only the variant KEY
// (`draft.condemn`); the line itself is resolved from this table at publish
// time and appended once, at the end of the published body — never in the
// headline/title and never fed back into classification.
export const CONDEMNATIONS = Object.freeze({
  incursion: Object.freeze({
    label_ar: 'توغّل وسيادة',
    label_en: 'Incursion & sovereignty',
    text: 'ندين بأشدّ العبارات التوغّل العسكري في الأراضي السورية، ونعدّه انتهاكاً صارخاً لسيادة سوريا ووحدة أراضيها.',
  }),
  bombardment: Object.freeze({
    label_ar: 'قصف وعدوان',
    label_en: 'Bombardment & aggression',
    text: 'ندين بأشدّ العبارات هذا العدوان على الأراضي السورية، ونحمّل الجهة المعتدية كامل المسؤولية عن تداعياته.',
  }),
  civilians: Object.freeze({
    label_ar: 'استهداف مدنيين',
    label_en: 'Targeting civilians',
    text: 'ندين بأشدّ العبارات استهداف المدنيين الأبرياء، ونطالب المجتمع الدولي بتحمّل مسؤولياته في حمايتهم ووقف هذه الانتهاكات.',
  }),
  general: Object.freeze({
    label_ar: 'صيغة عامة',
    label_en: 'General formula',
    text: 'ندين ونستنكر بأشدّ العبارات هذا الاعتداء، ونؤكّد حقّ سوريا في الدفاع عن سيادتها وأمن مواطنيها.',
  }),
});
export const CONDEMNATION_KEYS = Object.freeze(Object.keys(CONDEMNATIONS));
/** The stored variant key, or null when unset/unknown. */
export const condemnationKey = (key) => (typeof key === 'string' && Object.hasOwn(CONDEMNATIONS, key) ? key : null);
/** The formula line for a stored key ('' when unset/unknown). */
export const condemnationText = (key) => {
  const k = condemnationKey(key);
  return k ? CONDEMNATIONS[k].text : '';
};
