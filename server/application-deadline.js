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

const deadlineText = (value) => asciiDigits(value).toLowerCase()
  .replace(/[\u064B-\u065F\u0670\u0640]/gu, '').replace(/[أإآٱ]/gu, 'ا').replace(/[–—]/gu, '-');
const deadlineLabel = /(?:اخر\s+(?:موعد|مهلة|مد[ةه])|(?:تاريخ|موعد)\s+(?:انتهاء|اغلاق)\s+(?:باب\s+)?التقديم|الموعد\s+النهائي|ينتهي\s+التقديم|نهاية\s+الاعلان|(?:موعد|فترة)\s+تقديم\s+الطلبات|deadline\b|applications?\s+close(?:s)?\b)/iu;
const monthAliases = new Map();
for (let month = 1; month <= 12; month++) {
  for (const locale of ['ar-SY', 'ar-EG', 'en-GB']) {
    for (const style of ['long', 'short']) {
      monthAliases.set(deadlineText(new Intl.DateTimeFormat(locale, { month: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, month - 1, 15)))), month);
    }
  }
}
const namedMonths = [...monthAliases.keys()].sort((a, b) => b.length - a.length)
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|');
const namedDeadline = new RegExp(`(?<!\\d)(\\d{1,2})\\s*[-.]?\\s*(${namedMonths})\\s*[-.]?\\s*((?:19|20)\\d{2})(?!\\d)`, 'giu');
const numericDeadline = /(?<!\d)(?:(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})|(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4}))(?!\d)/gu;

// Read dates only from a labelled application-deadline line (or its next line).
// Do not turn posting dates, birthdays, early-closure caveats, invalid dates or
// ambiguous day/month numbers into a deadline. Conflicting labels stay unknown.
export function labelledApplicationDeadline(value) {
  const lines = deadlineText(value || '').split(/\r?\n/);
  const dates = new Set();
  let ambiguous = false;
  const remember = (year, month, day) => {
    const date = normalizeApplicationDeadline(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    if (date) dates.add(date);
  };
  for (let index = 0; index < lines.length; index++) {
    const label = deadlineLabel.exec(lines[index]);
    if (!label) continue;
    const suffix = lines[index].slice(label.index + label[0].length);
    const text = (suffix + (/\d/.test(suffix) ? '' : ` ${lines[index + 1] || ''}`)).split(/(?:ولغاية|لغاية|حتى)\s*/u).at(-1);
    for (const match of text.matchAll(numericDeadline)) {
      if (match[1]) remember(match[1], match[2], match[3]);
      else if (Number(match[4]) > 12) remember(match[6], match[5], match[4]);
      else ambiguous = true;
    }
    for (const match of text.matchAll(namedDeadline)) remember(match[3], monthAliases.get(match[2].replace(/\s+/g, ' ')), match[1]);
  }
  return !ambiguous && dates.size === 1 ? [...dates][0] : null;
}
