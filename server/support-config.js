const WALLET_PHONE_RE = /^(?:\+[1-9]\d{7,14}|\d{6,18})$/;
const SPACE_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;
const BIDI_CONTROL_RE = /[\u202a-\u202e\u2066-\u2069]/g;

export function cleanSupportLabel(value, max = 60) {
  return String(value ?? '')
    .replace(SPACE_CONTROL_RE, ' ')
    .replace(BIDI_CONTROL_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function parseWalletPhone(input) {
  let value = String(input ?? '').trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/^(?:tel:)/i, '')
    .replace(/[\s\-.()\u200e\u200f\u202a-\u202e]/g, '');
  if (value.startsWith('00')) value = '+' + value.slice(2);
  return WALLET_PHONE_RE.test(value) ? { ok: true, value } : { ok: false };
}

export function sanitizeSupportSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const walletName = cleanSupportLabel(source.walletName, 60);
  const parsedPhone = parseWalletPhone(source.walletPhone);
  const displayNames = [];
  const seen = new Set();
  for (const item of (Array.isArray(source.displayNames) ? source.displayNames : []).slice(-30)) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id ?? '');
    const name = cleanSupportLabel(item.name, 48);
    const key = name.toLocaleLowerCase();
    if (!/^[A-Za-z0-9_-]{1,36}$/.test(id) || !name || seen.has(key)) continue;
    seen.add(key);
    displayNames.push({ id, name });
  }
  return {
    enabled: source.enabled === true && Boolean(walletName && parsedPhone.ok),
    walletName,
    walletPhone: parsedPhone.ok ? parsedPhone.value : '',
    displayNames,
  };
}

export function publicSupportSettings(raw) {
  const support = sanitizeSupportSettings(raw);
  if (!support.enabled || !support.walletName || !support.walletPhone) return null;
  return {
    enabled: true,
    walletName: support.walletName,
    walletPhone: support.walletPhone,
    displayNames: support.displayNames.map(({ name }) => name),
  };
}
