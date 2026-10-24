import asyncio, json, sys, urllib.request
from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3997'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/pwa-qa'
CTL = 'http://localhost:3996'
import os; os.makedirs(OUT, exist_ok=True)
SEEN = json.dumps({'hasSeenWelcome': True, 'hasSeenTour': True})
FAKE_BIP = """
window.__fireBip = () => {
  const e = new Event('beforeinstallprompt', { cancelable: true });
  e.prompt = () => { window.__prompted = (window.__prompted || 0) + 1; return Promise.resolve(); };
  e.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
  window.dispatchEvent(e);
};
"""
res = []
def ok(name, cond, extra=''):
    res.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (' ' + str(extra) if extra else ''))

async def page_for(b, pw, dev=None, viewport=None, seen=True, dark=False, lang='ar', ua=None, bip=True, standalone=False, dsm=False):
    kw = dict(pw.devices[dev]) if dev else {}
    if viewport: kw['viewport'] = viewport
    if ua: kw['user_agent'] = ua
    elif not dev: kw['user_agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    kw['locale'] = 'ar'
    kw['color_scheme'] = 'dark' if dark else 'light'
    ctx = await b.new_context(**kw)
    init = FAKE_BIP
    s = json.loads(SEEN) if seen else {}
    s['darkMode'] = dark
    init += f"try{{localStorage.setItem('ras-settings', JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('ras-settings')||'{{}}'), {json.dumps(s)})));}}catch(e){{}}"
    if standalone: init += "Object.defineProperty(navigator,'standalone',{get:()=>true});"
    await ctx.add_init_script(init)
    p = await ctx.new_page()
    errs = []
    p.on('pageerror', lambda e: errs.append(str(e)))
    p.on('console', lambda m: m.type == 'error' and errs.append(m.text))
    await p.goto(f'{BASE}/{lang}/', wait_until='domcontentloaded')
    await p.wait_for_timeout(1500)
    if bip: await p.evaluate('window.__fireBip()')
    return ctx, p, errs

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        # 1) laptop, returning visitor, light: header contact buttons + install card after ~8 s
        ctx, p, errs = await page_for(b, pw, viewport={'width': 1440, 'height': 900})
        ok('laptop: WA header button visible', await p.is_visible('#btnWa'))
        ok('laptop: contact header button visible', await p.is_visible('#btnContact'))
        ok('laptop: WA href', (await p.get_attribute('#btnWa', 'href')) == 'https://whatsapp.com/channel/0029VaTestChannel123')
        await p.wait_for_timeout(4000)
        ok('laptop: no install card before 8 s', not await p.is_visible('#instCard'))
        await p.wait_for_timeout(5000)
        ok('laptop: install card shown', await p.is_visible('#instCard'))
        await p.screenshot(path=f'{OUT}/01-laptop-install-card.png')
        await p.click('#instCard [data-i="go"]'); await p.wait_for_timeout(600)
        ok('laptop: install button calls browser prompt', await p.evaluate('window.__prompted') == 1)
        ok('laptop: card closed after install', not await p.is_visible('#instCard'))
        await p.click('#btnContact'); await p.wait_for_timeout(500)
        rows = await p.locator('.ct-modal .ct-row').count()
        ok('laptop: contact window has 4 rows (wa channel, wa chat, call, tg)', rows == 4, rows)
        await p.screenshot(path=f'{OUT}/02-laptop-contact-window.png')
        await p.click('.ct-modal [data-m="close"]'); await p.wait_for_timeout(300)
        # live update: remove whatsapp channel + switch phone mode
        urllib.request.urlopen(f'{CTL}/contacts?wa=&phoneMode=wa').read(); await p.wait_for_timeout(1200)
        ok('live: WA button hidden after removal (no reload)', not await p.is_visible('#btnWa'))
        await p.click('#btnContact'); await p.wait_for_timeout(400)
        ok('live: phone mode wa-only → 2 rows', await p.locator('.ct-modal .ct-row').count() == 2)
        await p.click('.ct-modal [data-m="close"]')
        urllib.request.urlopen(f'{CTL}/contacts?wa=https://whatsapp.com/channel/0029VaTestChannel123&phoneMode=both').read(); await p.wait_for_timeout(1200)
        ok('live: WA button back', await p.is_visible('#btnWa'))
        ok('laptop: no JS errors', not errs, errs[:3])
        await ctx.close()
        # 2) laptop dark: drawer with install section + contacts
        ctx, p, errs = await page_for(b, pw, viewport={'width': 1440, 'height': 900}, dark=True)
        await p.click('#btnSettings'); await p.wait_for_timeout(700)
        ok('drawer: install section', await p.is_visible('#sInstall'))
        await p.locator('#sInstall').scroll_into_view_if_needed()
        await p.screenshot(path=f'{OUT}/03-laptop-dark-settings-install.png')
        await p.locator('.about-us').scroll_into_view_if_needed(); await p.wait_for_timeout(300)
        ok('drawer: contacts in about section', await p.locator('.about-us .ct-row').count() == 4)
        await p.screenshot(path=f'{OUT}/04-laptop-dark-settings-contacts.png')
        await p.wait_for_timeout(8000)
        ok('drawer open → install card waits', not await p.is_visible('#instCard'))
        await ctx.close()
        # 3) Android phone, FIRST visit: welcome → tour → install card (never on top of them)
        ctx, p, errs = await page_for(b, pw, dev='Pixel 7', seen=False)
        ok('android first visit: welcome shown', await p.is_visible('#modalBackdrop'))
        await p.wait_for_timeout(9000)
        ok('android: no install card over welcome', not await p.is_visible('#instCard'))
        await p.click('#modal [data-m="skip"]'); await p.wait_for_timeout(1200)
        ok('android: tour started', await p.is_visible('#tour'))
        for _ in range(10):
            if not await p.is_visible('#tour'): break
            btn = p.locator('#tourCard [data-tr="next"], #tourCard [data-tr="done"]').first
            await btn.click(); await p.wait_for_timeout(500)
        ok('android: tour finished', not await p.is_visible('#tour'))
        await p.wait_for_timeout(3000)
        ok('android: card not immediately after tour', not await p.is_visible('#instCard'))
        await p.wait_for_timeout(4500)
        ok('android: install card after tour', await p.is_visible('#instCard'))
        await p.screenshot(path=f'{OUT}/05-android-install-card.png')
        ok('android: header contact buttons hidden on phone', not await p.is_visible('#btnWa'))
        await p.click('#instCard [data-i="later"]'); await p.wait_for_timeout(500)
        st = await p.evaluate("JSON.parse(localStorage.getItem('ras-install'))")
        ok('android: Later snoozes ~7 days', st and 6.9 < (st['until'] - st['lastShown']) / 86400000 < 7.1, st)
        await p.reload(); await p.wait_for_timeout(1500); await p.evaluate('window.__fireBip()'); await p.wait_for_timeout(10000)
        ok('android: snoozed after reload', not await p.is_visible('#instCard'))
        # about sheet with contacts
        await p.click('#aboutPill'); await p.wait_for_timeout(700)
        await p.locator('#aboutBody .ct-list').scroll_into_view_if_needed(); await p.wait_for_timeout(300)
        ok('android: contacts in About sheet', await p.locator('#aboutBody .ct-row').count() == 4)
        await p.screenshot(path=f'{OUT}/06-android-about-contacts.png')
        ok('android: no JS errors', not errs, errs[:3])
        await ctx.close()
        # 4) Android without install event (e.g. Firefox/Brave menu) → menu hint
        ctx, p, errs = await page_for(b, pw, dev='Pixel 7', bip=False, dark=True)
        await p.wait_for_timeout(23000)
        vis = await p.is_visible('#instCard')
        ok('android no-prompt: menu hint card', vis and await p.locator('#instCard .inst-hint').count() == 1)
        await p.screenshot(path=f'{OUT}/07-android-dark-menu-hint.png')
        await ctx.close()
        # 5) iPhone returning visitor → Share → Add to Home Screen steps
        ctx, p, errs = await page_for(b, pw, dev='iPhone 14', bip=False)
        await p.wait_for_timeout(9000)
        ok('iphone: iOS steps card', await p.is_visible('#instCard') and await p.locator('#instCard .inst-step').count() == 2)
        await p.screenshot(path=f'{OUT}/08-iphone-install-steps.png')
        await p.click('#instCard [data-i="close"]'); await p.wait_for_timeout(400)
        st = await p.evaluate("JSON.parse(localStorage.getItem('ras-install'))")
        ok('iphone: ✕ snoozes ~3 days', st and 2.9 < (st['until'] - st['lastShown']) / 86400000 < 3.1)
        await ctx.close()
        # 6) iPhone already installed (home-screen app) → never shown
        ctx, p, errs = await page_for(b, pw, dev='iPhone 14', bip=False, standalone=True)
        await p.wait_for_timeout(10000)
        ok('iphone installed app: no card', not await p.is_visible('#instCard'))
        await p.click('#btnSettingsM'); await p.wait_for_timeout(600)
        ok('iphone installed app: no install section in settings', not await p.is_visible('#sInstall'))
        await ctx.close()
        # 7) English laptop
        ctx, p, errs = await page_for(b, pw, viewport={'width': 1280, 'height': 800}, lang='en')
        await p.wait_for_timeout(9000)
        ok('english: card shown', await p.is_visible('#instCard'))
        t = await p.inner_text('#instCard h4')
        ok('english: title', t.strip() == 'Install the app', t)
        await p.screenshot(path=f'{OUT}/09-laptop-english.png')
        await ctx.close()
        # 8) phone in "Desktop site" mode (Android UA, 980 px layout)
        ua = pw.devices['Pixel 7']['user_agent'].replace('Mobile ', '').replace('Linux; Android 14; Pixel 7', 'X11; Linux x86_64')
        ctx = await b.new_context(viewport={'width': 980, 'height': 1900}, screen={'width': 412, 'height': 915}, device_scale_factor=1.1, is_mobile=False, has_touch=True, user_agent=ua, locale='ar')
        await ctx.add_init_script(FAKE_BIP + f"localStorage.setItem('ras-settings', {json.dumps(SEEN)});")
        p = await ctx.new_page(); await p.goto(f'{BASE}/ar/'); await p.wait_for_timeout(1500); await p.evaluate('window.__fireBip()')
        await p.wait_for_timeout(9000)
        ok('desktop-site: card shown', await p.is_visible('#instCard'))
        box = await p.locator('#instCard').bounding_box()
        ok('desktop-site: card inside viewport', box and box['x'] >= 0 and box['x'] + box['width'] <= 980 and box['y'] + box['height'] <= 1900, box)
        ok('desktop-site: header contact buttons', await p.is_visible('#btnWa') and await p.is_visible('#btnContact'))
        await p.screenshot(path=f'{OUT}/10-desktop-site-mode.png')
        await ctx.close()
        await b.close()
    bad = [n for n, c in res if not c]
    print(f'\n{len(res) - len(bad)}/{len(res)} passed', 'FAILED: ' + '; '.join(bad) if bad else '')

asyncio.run(main())
