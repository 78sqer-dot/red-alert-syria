const dateParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Damascus', year: 'numeric', month: '2-digit', day: '2-digit',
});

function asciiDigits(value) {
  return String(value).replace(/[٠-٩۰-۹]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'.indexOf(digit) % 10));
}

export function normalizeApplicationDeadline(value) {
  if (value == null || String(value).trim() === '') return null;
  const date = asciiDigits(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return undefined;
  return date;
}

export function damascusDate(now = Date.now()) {
  const parts = Object.fromEntries(dateParts.formatToParts(new Date(now)).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// A date remains valid through the end of that calendar day in Syria (Asia/Damascus).
export function isApplicationDeadlineExpired(value, now = Date.now()) {
  const deadline = normalizeApplicationDeadline(value);
  return !!deadline && deadline < damascusDate(now);
}
