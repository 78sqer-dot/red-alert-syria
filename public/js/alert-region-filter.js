function normalizeGovernorate(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^a-z0-9\u0600-\u06FF]/gi, '')
    .toLowerCase();
}

export function matchesGovernorate(alert, selectedCode, governorates) {
  if (!selectedCode || selectedCode === 'all') return true;
  const selected = governorates?.[selectedCode];
  if (!selected) return true;

  const selectedNames = new Set([selected[2], selected[3]].map(normalizeGovernorate).filter(Boolean));
  const locations = [alert?.place, ...(Array.isArray(alert?.more) ? alert.more : [])].filter(Boolean);
  const hasMatchingLocation = locations.some((place) => {
    if (String(place.governorate || '') === String(selectedCode)) return true;
    return [place.governorate_ar, place.governorate_en]
      .some((name) => selectedNames.has(normalizeGovernorate(name)));
  });

  // Countrywide alerts are relevant in every regional view even without a precise location.
  return hasMatchingLocation || alert?.scope === 'country';
}
