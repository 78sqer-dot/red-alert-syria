import asyncio, sys, os
from playwright.async_api import async_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3997'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/dockqa'
os.makedirs(OUT, exist_ok=True)
SEEN = "try{localStorage.setItem('ras-settings', JSON.stringify({hasSeenWelcome:true,hasSeenTour:true,darkMode:%s}));localStorage.setItem('ras-install', JSON.stringify({dismissedAt:Date.now()}));}catch(e){}"
DESK_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
res = []
def ok(n, c, x=''):
    sys.stdout.flush()
    res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (' ' + str(x) if x else ''), flush=True)

PTS = """() => { const m = window.__rasMap; const r = m.getContainer().getBoundingClientRect();
  return m.queryRenderedFeatures({ layers: ['svc-wx-i'] }).map(f => { const p = m.project(f.geometry.coordinates); return { id: f.properties.id, x: r.left + p.x, y: r.top + p.y }; })
   .filter(q => q.x > 8 && q.x < innerWidth - 8 && q.y > 8 && q.y < innerHeight - 8 && document.elementFromPoint(q.x, q.y)?.tagName === 'CANVAS'); }"""
EMPTY = """() => { const m = window.__rasMap; const r = m.getContainer().getBoundingClientRect();
  for (let y = r.top + 120; y < r.bottom - 40; y += 23) for (let x = r.left + 20; x < r.right - 20; x += 29) {
    if (document.elementFromPoint(x, y)?.tagName !== 'CANVAS') continue;
    if (m.queryRenderedFeatures([[x - r.left - 25, y - r.top - 25], [x - r.left + 25, y - r.top + 25]], { layers: ['svc-wx-i','svc-wx-x'] }).length) continue;
    return [x, y]; } return null; }"""
# card fully inside the viewport, and no visible map button under it
CHECK = """(sel) => { const c = [...document.querySelectorAll(sel)].pop(); if (!c) return { none: true };
  const r = c.getBoundingClientRect(); const W = innerWidth, H = innerHeight;
  const inside = r.left >= -1 && r.top >= -1 && r.right <= W + 1 && r.bottom <= H + 1;
  let over = [];
  for (const b of document.querySelectorAll('.map-ctrls button, .maplibregl-ctrl button')) { const q = b.getBoundingClientRect(); if (!q.width || getComputedStyle(b).visibility === 'hidden') continue;
    if (q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top) over.push(b.className || b.getAttribute('aria-label')); }
  const cut = [...c.querySelectorAll('*')].some(e => { const q = e.getBoundingClientRect(); return q.width && (q.left < -1 || q.right > W + 1); });
  return { inside, over, cut, w: Math.round(r.width), l: Math.round(r.left), t: Math.round(r.top), b: Math.round(r.bottom), H, W, txt: c.innerText.slice(0, 90) }; }"""

async def run(b, name, lang='ar', dark=False, dock=True, **kw):
    ctx = await b.new_context(locale=lang, color_scheme='dark' if dark else 'light', **kw)
    await ctx.add_init_script(SEEN % ('true' if dark else 'false'))
    p = await ctx.new_page(); errs = []
    p.on('pageerror', lambda e: errs.append(str(e)))
    await p.goto(f'{BASE}/{lang}/#weather', wait_until='domcontentloaded')
    await p.wait_for_function("() => window.__rasMap && window.__rasMap.getLayer('svc-wx-i') && window.__rasMap.queryRenderedFeatures({ layers: ['svc-wx-i'] }).length > 10", timeout=30000)
    await p.wait_for_timeout(2500)
    sel = '.pp-dock' if dock else '.maplibregl-popup .maplibregl-popup-content'
    pts = await p.evaluate(PTS)
    # the edge ones first (Aleppo / Hasakah / Latakia / Deir ez-Zor): left-most, right-most, top-most
    pts.sort(key=lambda q: q['x'])
    pick = [pts[0], pts[-1], min(pts, key=lambda q: q['y']), pts[len(pts) // 2]]
    bad = []
    for i, q in enumerate(pick):
        now = [x for x in await p.evaluate(PTS) if x['id'] == q['id']]
        if not now: continue
        q = now[0]
        await p.mouse.click(q['x'], q['y']); await p.wait_for_timeout(1300)
        r = await p.evaluate(CHECK, sel)
        good = not r.get('none') and r['inside'] and not r['over'] and not r['cut']
        if not good: bad.append((q['id'], r))
        if i < 2: await p.screenshot(path=f'{OUT}/{name}-wx{i}.png')
    ok(f'{name}: weather cards inside screen, not over buttons (4 taps)', not bad, bad[:2])
    # zoom in / out with the card open: it must stay put
    await p.evaluate("() => window.__rasMap.zoomTo(9, { duration: 0 })"); await p.wait_for_timeout(900)
    r1 = await p.evaluate(CHECK, sel)
    await p.evaluate("() => window.__rasMap.zoomTo(5.2, { duration: 0 })"); await p.wait_for_timeout(900)
    r2 = await p.evaluate(CHECK, sel)
    if dock: ok(f'{name}: weather card stays inside while zooming', all((not x.get('none')) and x['inside'] and not x['over'] for x in (r1, r2)), (r1, r2))
    # tap on empty map closes it
    if dock:
        e = await p.evaluate(EMPTY)
        await p.mouse.click(e[0], e[1]); await p.wait_for_timeout(700)
        n = await p.evaluate("() => document.querySelectorAll('.pp-dock').length")
        ok(f'{name}: tap on empty map closes the card', n == 0, n)
    # back to the news; open an alert and zoom
    await p.evaluate("() => document.querySelector('.svc-bar-x')?.click()"); await p.wait_for_timeout(1500)
    mk = await p.query_selector('.maplibregl-marker.mk')
    if mk:
        await p.evaluate("() => { const m = [...document.querySelectorAll('.maplibregl-marker.mk')][0]; m.dispatchEvent(new MouseEvent('click', { bubbles: true })); }")
        await p.wait_for_timeout(2600)
        rs = []
        for z in (12, 7, 14):
            await p.evaluate(f"() => window.__rasMap.zoomTo({z}, {{ duration: 0 }})"); await p.wait_for_timeout(800)
            rs.append(await p.evaluate(CHECK, sel))
        for dx, dy in ((700, 0), (-1400, 0), (700, -600), (0, 1200)):
            await p.evaluate(f"() => window.__rasMap.panBy([{dx}, {dy}], {{ duration: 0 }})"); await p.wait_for_timeout(700)
            rs.append(await p.evaluate(CHECK, sel))
        if not dock: await p.screenshot(path=f'{OUT}/{name}-news-panned.png')
        good = all((not x.get('none')) and x['inside'] and not x['over'] and not x['cut'] for x in rs)
        ok(f'{name}: news card inside screen while zooming', good, [x for x in rs if x.get('none') or not x['inside'] or x['over'] or x['cut']][:1])
        await p.screenshot(path=f'{OUT}/{name}-news.png')
    else:
        ok(f'{name}: news marker present', False)
    ok(f'{name}: no JS errors', not errs, errs[:3])
    await ctx.close()

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        import os
        if os.environ.get('ONLY') == 'laptop':
            await run(b, 'laptop', dock=False, viewport={'width': 1440, 'height': 900})
            await run(b, 'laptop-small-en', lang='en', dock=False, viewport={'width': 1280, 'height': 680})
            await b.close(); print(f'=== {sum(res)}/{len(res)} passed'); return
        await run(b, 'phone', **pw.devices['Pixel 7'])
        await run(b, 'phone-dark-en', lang='en', dark=True, **pw.devices['iPhone 12'])
        d = dict(pw.devices['Pixel 7']); d.update(user_agent=DESK_UA, viewport={'width': 980, 'height': 1860}, screen={'width': 412, 'height': 915}, device_scale_factor=1.1)
        await run(b, 'phonedesk', dark=True, **d)
        await run(b, 'laptop', dock=False, viewport={'width': 1440, 'height': 900})
        await b.close()
    print(f'=== {sum(res)}/{len(res)} passed')
asyncio.run(main())
