import asyncio, json, sys
from playwright.async_api import async_playwright
BASE = 'https://red-alert-syria.onrender.com'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/live-qa'
import os; os.makedirs(OUT, exist_ok=True)
SEEN = "try{localStorage.setItem('ras-settings', JSON.stringify({hasSeenWelcome:true,hasSeenTour:true,darkMode:%s}));localStorage.setItem('ras-install', JSON.stringify({dismissedAt:Date.now()}));}catch(e){}"
DESK_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
res = []
def ok(n, c, x=''):
    res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (' ' + str(x) if x else ''))
async def shot(b, pw, name, dark=False, **kw):
    ctx = await b.new_context(locale='ar', color_scheme='dark' if dark else 'light', **kw)
    await ctx.add_init_script(SEEN % ('true' if dark else 'false'))
    p = await ctx.new_page(); errs = []
    p.on('pageerror', lambda e: errs.append(str(e)))
    await p.goto(BASE + '/ar/', wait_until='domcontentloaded'); await p.wait_for_timeout(6000)
    vis = {s: await p.is_visible(s) for s in ['#btnWa', '#btnContact']}
    wa = await p.get_attribute('#btnWa', 'href') if vis['#btnWa'] else None
    await p.screenshot(path=f'{OUT}/{name}.png')
    ok(f'{name}: header WhatsApp + contact buttons visible', all(vis.values()), vis)
    ok(f'{name}: WhatsApp link', wa == 'https://whatsapp.com/channel/0029VaRasQaTest0001', wa)
    ok(f'{name}: no JS errors', not errs, errs[:2])
    if vis['#btnContact']:
        await p.click('#btnContact'); await p.wait_for_timeout(900)
        links = await p.eval_on_selector_all('a[href^="https://wa.me"],a[href^="tel:"],a[href^="https://t.me/RAS_QA"]', 'els=>els.filter(e=>e.offsetParent).map(e=>e.getAttribute("href"))')
        ok(f'{name}: contact menu shows chat/call/telegram', len(set(links)) >= 3, links)
        await p.screenshot(path=f'{OUT}/{name}-contact.png')
    await ctx.close()
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        await shot(b, pw, '1-phone', **pw.devices['Pixel 7'])
        d = dict(pw.devices['Pixel 7']); d.update(user_agent=DESK_UA, viewport={'width': 980, 'height': 1860}, device_scale_factor=1.1)
        await shot(b, pw, '2-phone-desktop-site', dark=True, **d)
        await shot(b, pw, '3-laptop', viewport={'width': 1440, 'height': 900}, user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
        await b.close()
    print(f'=== {sum(res)}/{len(res)} passed')
asyncio.run(main())
