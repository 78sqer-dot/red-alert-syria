# Growth: watermark, SEO pages, sharing, channel profile

## Telegram channel profile (changed 2026-10-25 via the publishing bot)

Old title: `( Red Alert Syria 🇸🇾)`
Old description: *(empty)*

New title: `Red Alert Syria 🇸🇾 | عاجل سوريا 🔴`
New description:

```
🔴 عاجل سوريا لحظة بلحظة: مسيّرات، طيران حربي، قصف، صواريخ، هجمات، حوادث وحرائق.
أخبار سوريا وتنبيهاتها ع خريطة مباشرة، اعرف شو صاير حواليك هلق 👇
🗺 https://red-alert-syria.onrender.com
📩 بلّغ عن حدث: @Rad_Alert_Syria1_bot
```

Revert: Bot API `setChatTitle` / `setChatDescription` on `@Red_Alert_Syria` with the old values.

## Images
Every channel alert image and the daily/weekly statistics images carry a `t.me/Red_Alert_Syria` badge
(server/alert-image.js, server/stats-image.js), so forwarded images lead back to the channel.

## SEO (server/seo.js)
- `/ar/area/<slug>/`, `/en/area/<slug>/`: one page per governorate and major city ("شو صاير بدرعا هلق؟"),
  listing that area's recent alerts, with a title, meta description, Open Graph image, hreflang and JSON-LD.
- `/ar/areas/`, `/en/areas/`: index of all area pages.
- `/ar/a/<id>`: share link of one alert. Link-preview bots (Telegram, WhatsApp, Facebook, X, Google)
  get a rich card with the alert map image; people are redirected to the alert on the map.
- `/sitemap.xml`, `/robots.txt`; the home page has JSON-LD (WebSite + Organization) and hreflang.

### Google Search Console
1. https://search.google.com/search-console → Add property → "URL prefix" → `https://red-alert-syria.onrender.com/`.
2. Choose "HTML tag", copy only the `content="…"` value, and set it as Render env var `GOOGLE_SITE_VERIFICATION`
   (or choose "HTML file" and set `GOOGLE_VERIFY_FILE=google….html`). Wait for the redeploy, then press Verify.
3. Sitemaps → submit `sitemap.xml`.
Bing Webmaster Tools works the same way (`BING_SITE_VERIFICATION`), or import from Search Console.

## Site sharing
- Map: share button under the map controls (WhatsApp, Telegram, Facebook, copy link), prefilled text + link.
- Each alert: WhatsApp / Telegram / Facebook / copy link, with the alert's own share link (`/ar/a/<id>`).
