import asyncio, sys, os
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3997'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/wxshots'
os.makedirs(OUT, exist_ok=True)
SEEN = "try{localStorage.setItem('ras-settings', JSON.stringify({hasSeenWelcome:true,hasSeenTour:true,darkMode:%s}));localStorage.setItem('ras-install', JSON.stringify({dismissedAt:Date.now()}));}catch(e){}"
DESK_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
res = []
def ok(n, c, x=''):
    res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (' ' + str(x) if x else ''))

CLICK = """(id) => { const m = window.__rasMap; const f = m.queryRenderedFeatures({ layers: ['svc-wx-i','svc-wx-x'] }).find(x => x.properties.id === id);
  if (!f) return null; const p = m.project(f.geometry.coordinates); const r = m.getContainer().getBoundingClientRect(); return [r.left + p.x, r.top + p.y]; }"""

async def run(b, name, lang='ar', dark=False, **kw):
    ctx = await b.new_context(locale=lang, color_scheme='dark' if dark else 'light', **kw)
    await ctx.add_init_script(SEEN % ('true' if dark else 'false'))
    p = await ctx.new_page(); errs = []
    p.on('pageerror', lambda e: errs.append(str(e)))
    await p.goto(f'{BASE}/{lang}/#weather', wait_until='domcontentloaded'); await p.wait_for_function("() => window.__rasMap && window.__rasMap.getLayer('svc-wx-i') && window.__rasMap.queryRenderedFeatures({ layers: ['svc-wx-i'] }).length > 10", timeout=25000); await p.wait_for_timeout(2500)
    n = await p.evaluate("() => window.__rasMap.queryRenderedFeatures({ layers: ['svc-wx-i'] }).length")
    news = await p.evaluate("() => document.body.classList.contains('svc-on')")
    ok(f'{name}: weather icons on map', n >= 12, n); ok(f'{name}: services mode on (news hidden)', news)
    await p.screenshot(path=f'{OUT}/{name}-1-map.png')
    xy = await p.evaluate(CLICK, '02')
    if xy:
        await p.mouse.click(xy[0], xy[1]); await p.wait_for_timeout(1200)
        t = await p.evaluate("() => (document.querySelector('.wx-now') && document.querySelector('.wx-now').closest('.maplibregl-popup, .svc-dock, .dock-card, body').innerText) || ''")
        ok(f'{name}: popup with forecast', ('اليوم' in t or 'Today' in t), t[:120].replace('\n', ' | '))
        await p.screenshot(path=f'{OUT}/{name}-2-popup.png')
    else: ok(f'{name}: Latakia marker found', False)
    # zoom to see mountain points
    await p.evaluate("() => { document.querySelector('.maplibregl-popup-close-button')?.click(); window.__rasMap.jumpTo({ center: [36.2, 33.6], zoom: 7.6 }); }"); await p.wait_for_timeout(1800)
    nx = await p.evaluate("() => window.__rasMap.queryRenderedFeatures({ layers: ['svc-wx-x'] }).length")
    ok(f'{name}: mountain points at zoom 7.6', nx >= 1, nx)
    await p.screenshot(path=f'{OUT}/{name}-3-zoom.png')
    # panel list
    await p.evaluate("() => { location.hash = 'weather-x'; }")
    await p.goto(f'{BASE}/{lang}/#prices', wait_until='domcontentloaded'); await p.wait_for_timeout(5000)
    await p.click('.svc-tab[data-tab="weather"]'); await p.wait_for_timeout(2500)
    rows = await p.eval_on_selector_all('.wx-row', 'e => e.length')
    ok(f'{name}: panel list rows', rows >= 14, rows)
    await p.screenshot(path=f'{OUT}/{name}-4-panel.png')
    # leaving mode restores news
    await p.click('.wx-row'); await p.wait_for_timeout(2500)
    await p.screenshot(path=f'{OUT}/{name}-5-fromlist.png')
    ex = await p.query_selector('.svc-bar-x')
    if ex:
        await ex.click(); await p.wait_for_timeout(1200)
        news = await p.evaluate("() => document.body.classList.contains('svc-on')")
        vis = await p.evaluate("() => window.__rasMap.getLayoutProperty('svc-wx-i','visibility')")
        ok(f'{name}: exit restores news', not news and vis == 'none', vis)
    ok(f'{name}: no JS errors', not errs, errs[:3])
    await ctx.close()

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        await run(b, 'phone', **pw.devices['Pixel 7'])
        d = dict(pw.devices['Pixel 7']); d.update(user_agent=DESK_UA, viewport={'width': 980, 'height': 1860}, device_scale_factor=1.1)
        await run(b, 'phonedesk', dark=True, **d)
        await run(b, 'laptop-en', lang='en', viewport={'width': 1440, 'height': 900})
        await b.close()
    print(f'=== {sum(res)}/{len(res)} passed')
asyncio.run(main())
