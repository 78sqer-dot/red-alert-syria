# Multi-area alert QA: one pulsing glow circle per area, popup lists all areas, drone rule untouched.
#   python3 scripts/_multi_web.py <base> <outdir> [alert.json]   (FAKE=1 injects the alert in the browser only)
import asyncio, json, sys, os
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3997'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/multi-web'
AJ = sys.argv[3] if len(sys.argv) > 3 else '/tmp/multi-alert.json'
FAKE = os.environ.get('FAKE', '1') == '1'
os.makedirs(OUT, exist_ok=True)
SEEN = "try{localStorage.setItem('ras-settings', JSON.stringify({hasSeenWelcome:true,hasSeenTour:true,darkMode:%s}));localStorage.setItem('ras-install', JSON.stringify({until:Date.now()+86400000*30}))}catch(e){}"
DESK_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
res = []
def ok(n, c, x=''):
    res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (' ' + str(x) if x != '' else ''), flush=True)
PULSES = """() => [...document.querySelectorAll('.zp')].map((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e, '::before');
  return { d: Math.round(r.width), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), anim: cs.animationName, vis: getComputedStyle(e).visibility }; })"""
async def run(b, name, dark=False, **kw):
    ctx = await b.new_context(locale='ar', **kw)
    if FAKE:
        snap = json.dumps({'alerts': [json.load(open(AJ))]}, ensure_ascii=False)
        await ctx.add_init_script('''(() => { const SNAP = %s;
          class FakeES { constructor(u) { this.url = u; this.readyState = 1; this.h = {}; setTimeout(() => {
              this.onopen && this.onopen({}); (this.h.open || []).forEach((f) => f({}));
              (this.h.snapshot || []).forEach((f) => f({ data: JSON.stringify(SNAP) })); }, 60); }
            addEventListener(t, f) { (this.h[t] = this.h[t] || []).push(f); } removeEventListener() {} close() { this.readyState = 2; } }
          FakeES.CONNECTING = 0; FakeES.OPEN = 1; FakeES.CLOSED = 2; window.EventSource = FakeES; })();''' % snap)
    await ctx.add_init_script(SEEN % ('true' if dark else 'false'))
    p = await ctx.new_page(); errs = []
    p.on('pageerror', lambda e: errs.append(str(e)))
    await p.goto(BASE + '/ar/', wait_until='domcontentloaded'); await p.wait_for_timeout(5000)
    await p.evaluate('() => window.__rasMap.fitBounds([[35.6,32.3],[42.4,37.4]], { duration: 0, padding: 20 })')
    await p.wait_for_timeout(1800)
    ps = await p.evaluate(PULSES)
    ok(f'{name}: country view: 11 pulsing circles', len(ps) == 11 and all(x['anim'] == 'zpulse' and x['vis'] == 'visible' for x in ps), [(x['d'], x['anim']) for x in ps][:4])
    n = await p.evaluate("() => window.__rasMap.querySourceFeatures('ras-zones').length")
    ok(f'{name}: 11 glow circles drawn on the map', n >= 11, n)
    await p.wait_for_timeout(700)
    await p.screenshot(path=f'{OUT}/{name}-1-country.png')
    # zoom into Damascus: circles grow with the map, pulses re-sized after the zoom
    mid = await p.evaluate('''() => new Promise((res) => { const m = window.__rasMap;
      m.easeTo({ center: [36.36, 33.52], zoom: 10.3, duration: 700 });
      setTimeout(() => { const z = document.querySelector('.zp'); res(m.isZooming() && z && getComputedStyle(z).visibility === 'hidden'); }, 250); })''')
    ok(f'{name}: pulses hidden while the zoom animates', mid)
    await p.wait_for_timeout(2200)
    ps2 = await p.evaluate(PULSES)
    big = [x for x in ps2 if 0 < x['x'] < 2000 and 0 < x['y'] < 2000]
    ok(f'{name}: zoomed in: pulses visible again and bigger', big and all(x['vis'] == 'visible' for x in big) and max(x['d'] for x in big) > max(x['d'] for x in ps), [x['d'] for x in big][:5])
    await p.screenshot(path=f'{OUT}/{name}-2-damascus.png')
    # pinch/zoom still works with the pulses on top (they never catch touches)
    z0 = await p.evaluate('() => window.__rasMap.getZoom()')
    await p.evaluate("() => document.querySelector('#zoomIn').click()"); await p.wait_for_timeout(900)
    z1 = await p.evaluate('() => window.__rasMap.getZoom()')
    ok(f'{name}: + button still zooms', z1 > z0 + 0.5, (round(z0, 2), round(z1, 2)))
    pe = await p.evaluate("() => getComputedStyle(document.querySelector('.zp')).pointerEvents")
    ok(f'{name}: pulses ignore touches', pe == 'none', pe)
    # open the alert: frames all areas, lists them
    await p.evaluate("() => { const el = document.querySelector('.mk'); el && el.click(); }")
    await p.wait_for_timeout(2600)
    txt = await p.evaluate("() => (document.querySelector('.maplibregl-popup') || document.querySelector('.sheet.open, .detail, #detail') || document.body).innerText")
    ok(f'{name}: popup lists the areas', 'غويران' in txt and 'مصياف' in txt, txt[:160].replace('\n', ' | '))
    zf = await p.evaluate('() => window.__rasMap.getZoom()')
    ok(f'{name}: opening frames all areas (zoomed out to fit)', zf < 8.5, round(zf, 2))
    await p.screenshot(path=f'{OUT}/{name}-3-opened.png')
    ok(f'{name}: no JS errors', not errs, errs[:2])
    await ctx.close()
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        DEV = os.environ.get('DEV', 'all')
        if DEV in ('all', 'phone'): await run(b, 'phone', **pw.devices['Pixel 7'])
        d = dict(pw.devices['Pixel 7']); d.update(user_agent=DESK_UA, viewport={'width': 980, 'height': 1860}, device_scale_factor=1.1)
        if DEV in ('all', 'dsite'): await run(b, 'desktop-site', dark=True, **d)
        if DEV in ('all', 'laptop'): await run(b, 'laptop', viewport={'width': 1440, 'height': 900}, user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
        await b.close()
    print(f'=== {sum(res)}/{len(res)} passed')
asyncio.run(main())
