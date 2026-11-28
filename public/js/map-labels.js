// Display-only localization. Administrative feature names keep their stored data.
export function mapLabelExpression(lang) {
  const name = lang === 'ar'
    ? ['coalesce', ['get', 'name:ar'], ['get', 'name'], ['get', 'name:latin']]
    : ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
  if (lang !== 'ar') return name;
  return ['case', ['all', ['==', ['get', 'class'], 'state'], ['in', name, ['literal', ['حلب', 'حمص', 'درعا', 'دمشق', 'ريف دمشق', 'إدلب', 'اللاذقية', 'طرطوس', 'حماة', 'الرقة', 'دير الزور', 'الحسكة', 'السويداء', 'القنيطرة'].map((gov) => 'محافظة ' + gov)]]], ['slice', name, 7], name];
}
