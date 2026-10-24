# Drone behaviour QA: below zoom 11 only the circle, from 11 up the drone flies along the ring edge.
#   python3 scripts/_uav_qa.py <base> <outdir>
import asyncio, json, sys, math, os
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3997'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/uav-qa'
LAT, LON = float(os.environ.get('LAT', '33.487')), float(os.environ.get('LON', '36.352'))
os.makedirs(OUT, exist_ok=True)
SEEN = "try{localStorage.setItem('ras-settings', JSON.stringify({hasSeenWelcome:true,hasSeenTour:true,darkMode:%s}));localStorage.setItem('ras-install', JSON.stringify({until:Date.now()+86400000*30}));}catch(e){}"
DESK_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
res = []
def ok(n, c, x=''):
    res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (' ' + str(x) if x != '' else ''))
PROBE = """() => {
  const m = window.__rasMap, el = document.querySelector('.mk-orbit');
  if (!el) return null;
  const u = el.querySelector('.uav'), cs = getComputedStyle(u);
  const box = el.querySelector('.uav-box').getBoundingClientRect(), r = u.getBoundingClientRect();
  const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
  return { zoom: +m.getZoom().toFixed(2), vis: cs.visibility, anim: cs.animationName, orb: el.style.getPropertyValue('--orb'),
           dist: Math.round(Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy)),
           pos: [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)], center: [Math.round(cx), Math.round(cy)],
           ring: (() => { const f = m.querySourceFeatures('ras-zones')[0]; if (!f) return 0; const c = f.geometry.coordinates[0];
                  const p0 = m.project([""" + str(LON) + "," + str(LAT) + """]); let best = 1e9;
                  // ring radius in px measured from the circle polygon nearest the marker
                  for (const fe of m.querySourceFeatures('ras-zones')) { const pts = fe.geometry.coordinates[0];
                    let sx = 0, sy = 0; for (const q of pts) { const pp = m.project(q); sx += pp.x; sy += pp.y; }
                    const cxp = sx / pts.length, cyp = sy / pts.length; const d = Math.hypot(cxp - p0.x, cyp - p0.y);
                    if (d < best) { best = d; window.__ringR = Math.round(Math.hypot(m.project(pts[0]).x - cxp, m.project(pts[0]).y - cyp)); } }
                  return window.__ringR; })() };
}"""
FAKE = os.environ.get('FAKE') == '1'
def fake_alert():
    import datetime as dt
    now = dt.datetime.now(dt.timezone.utc)
    iso = lambda t: t.strftime('%Y-%m-%dT%H:%M:%S.000Z')
    # one drone alert over several Damascus-suburb places (several circles, one drone), browser-only test data
    return {'id': 'qa-uav-1', 'type': 'uav', 'title': 'تحليق مسيّرة — جرمانا ومحيطها', 'title_en': 'Drone — Jaramana area',
            'description': 'اختبار عرض فقط', 'location': {'latitude': LAT, 'longitude': LON},
            'place': {'name_ar': 'جرمانا', 'name_en': 'Jaramana', 'governorate_ar': 'ريف دمشق', 'governorate_en': 'Rif Dimashq'},
            'areas': [], 'scope': 'place',
            'zones': [{'lat': LAT, 'lon': LON, 'km': 1.5}, {'lat': 33.4795, 'lon': 36.3135, 'km': 1.5}, {'lat': 33.5145, 'lon': 36.3770, 'km': 1.5}],
            'timestamp': iso(now - dt.timedelta(minutes=3)), 'expires_at': iso(now + dt.timedelta(minutes=90)), 'is_active': True, 'source': 'telegram'}
async def run(b, pw, name, dark=False, **kw):
    ctx = await b.new_context(locale='ar', color_scheme='dark' if dark else 'light', **kw)
    if FAKE:
        al = fake_alert()
        async def r_alerts(route): await route.fulfill(status=200, content_type='application/json', body=json.dumps({'alerts': [al]}))
        snap = json.dumps({'alerts': [al], 'history_hours': 48, 'server_time': al['timestamp'], 'contacts': {}})
        await ctx.add_init_script('''(() => { const SNAP = %s;
          class FakeES { constructor(u) { this.url = u; this.readyState = 0; this.h = {}; setTimeout(() => { this.readyState = 1;
              this.onopen && this.onopen({}); (this.h.open || []).forEach((f) => f({}));
              (this.h.snapshot || []).forEach((f) => f({ data: JSON.stringify(SNAP) })); }, 60); }
            addEventListener(t, f) { (this.h[t] = this.h[t] || []).push(f); } removeEventListener() {} close() { this.readyState = 2; } }
          FakeES.CONNECTING = 0; FakeES.OPEN = 1; FakeES.CLOSED = 2; window.EventSource = FakeES; })();''' % snap)
    await ctx.add_init_script(SEEN % ('true' if dark else 'false'))
    p = await ctx.new_page(); errs = []
    p.on('pageerror', lambda e: errs.append(str(e)))
    await p.goto(BASE + '/ar/', wait_until='domcontentloaded'); await p.wait_for_timeout(5000)
    await p.evaluate('() => { const m = window.__rasMap; m.jumpTo({ center: [38.5, 35.0], zoom: m.getZoom() }); }')
    await p.wait_for_timeout(300)
    await p.evaluate('() => window.__rasMap.fitBounds([[35.6,32.3],[42.4,37.4]], { duration: 0, padding: 20 })')
    await p.wait_for_timeout(1500)
    a = await p.evaluate(PROBE)
    ok(f'{name}: country view z={a and a["zoom"]}: drone hidden, circle only', a and a['vis'] == 'hidden', a)
    await p.screenshot(path=f'{OUT}/{name}-1-zoomed-out.png')
    # mid zoom (9..11): still only the circle
    await p.evaluate(f'() => window.__rasMap.jumpTo({{ center: [{LON}, {LAT}], zoom: 10 }})'); await p.wait_for_timeout(1200)
    a = await p.evaluate(PROBE)
    ok(f'{name}: zoom 10: drone hidden', a['vis'] == 'hidden', a)
    # zoom in like a pinch (animated) to 12
    await p.evaluate(f'() => window.__rasMap.easeTo({{ center: [{LON}, {LAT}], zoom: 12, duration: 600 }})'); await p.wait_for_timeout(2200)
    a = await p.evaluate(PROBE)
    ok(f'{name}: zoom 12: drone visible + orbiting', a['vis'] == 'visible' and a['anim'] == 'uavOrbit', a)
    ok(f'{name}: zoom 12: flies on the ring edge (|dist-ring| <= 4px)', abs(a['dist'] - a['ring']) <= 4, (a['dist'], a['ring'], a['orb']))
    await p.screenshot(path=f'{OUT}/{name}-2-zoomed-in.png')
    await p.wait_for_timeout(1500)
    a2 = await p.evaluate(PROBE)
    ok(f'{name}: drone moves along the ring', a2['pos'] != a['pos'] and abs(a2['dist'] - a2['ring']) <= 4, (a['pos'], a2['pos']))
    await p.screenshot(path=f'{OUT}/{name}-3-zoomed-in-later.png')
    await p.evaluate(f'() => window.__rasMap.easeTo({{ zoom: 13.5, duration: 500 }})'); await p.wait_for_timeout(2000)
    a3 = await p.evaluate(PROBE)
    ok(f'{name}: zoom 13.5: still on the ring edge', a3['vis'] == 'visible' and abs(a3['dist'] - a3['ring']) <= 4, (a3['dist'], a3['ring']))
    await p.screenshot(path=f'{OUT}/{name}-4-zoom-13.png')
    await p.evaluate('() => window.__rasMap.easeTo({ zoom: 7, duration: 500 })'); await p.wait_for_timeout(1800)
    a4 = await p.evaluate(PROBE)
    ok(f'{name}: zoom back out: drone gone again', a4['vis'] == 'hidden', a4)
    # the alert can still be opened from the map at country view (tap target kept)
    box = await p.evaluate("() => { const r = document.querySelector('.mk-orbit .uav-box').getBoundingClientRect(); return [r.left + r.width/2, r.top + r.height/2]; }")
    await p.mouse.click(box[0], box[1]); await p.wait_for_timeout(2500)
    a5 = await p.evaluate(PROBE)
    pop = await p.is_visible('.maplibregl-popup')
    ok(f'{name}: tap on the circle centre opens the alert and zooms in to the drone', pop and a5['vis'] == 'visible', (pop, a5['zoom']))
    await p.screenshot(path=f'{OUT}/{name}-5-opened.png')
    ok(f'{name}: no JS errors', not errs, errs[:2])
    await ctx.close()
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        DEV = os.environ.get('DEV', 'all')
        if DEV in ('all', 'phone'): await run(b, pw, 'phone', **pw.devices['Pixel 7'])
        d = dict(pw.devices['Pixel 7']); d.update(user_agent=DESK_UA, viewport={'width': 980, 'height': 1860}, device_scale_factor=1.1)
        if DEV in ('all', 'dsite'): await run(b, pw, 'desktop-site', dark=True, **d)
        if DEV in ('all', 'laptop'): await run(b, pw, 'laptop', viewport={'width': 1440, 'height': 900}, user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
        await b.close()
    print(f'=== {sum(res)}/{len(res)} passed')
asyncio.run(main())
