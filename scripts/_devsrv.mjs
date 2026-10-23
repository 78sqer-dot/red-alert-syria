process.env.DATA_DIR = '/tmp/rasperf'; process.env.PORT = '3997'; process.env.TELEGRAM_BACKUP = '0';
delete process.env.BOT_TOKEN; delete process.env.REPORT_BOT_TOKEN;
await import('../server/index.js');
const { store } = await import('../server/store.js');
const http = await import('node:http');
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const type = u.searchParams.get('type') || 'uav';
  if (u.pathname === '/clear') { store.deleteMany(() => true); return res.end('cleared'); }
  const q = (k, d) => u.searchParams.get(k) || d;
  const nm = q('name', 'دمشق'), ne = q('name_en', 'Damascus');
  const a = store.addAlert({ type, title: `${q('t', 'اختبار')} — ${nm}`, title_en: `Test — ${ne}`, description: q('d', ''), location: { latitude: +q('lat', 33.513), longitude: +q('lon', 36.292), scope: q('scope', 'governorate'), name_ar: nm, name_en: ne, governorate_ar: q('gov_ar', nm), governorate_en: q('gov_en', ne), gov: q('gov', '13') } });
  res.end(a.id);
}).listen(3996);
