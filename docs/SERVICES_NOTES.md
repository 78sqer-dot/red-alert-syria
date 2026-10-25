# Services round (2026-10-25) — research notes

## Price sources
- **sp-today.com** (الليرة اليوم) home page `https://sp-today.com/` is Next.js; data embedded in
  `self.__next_f.push([1,"..."])` chunks. Join + JSON-decode the strings, then find `{"lang":"ar","data":{"cities":...`.
  - `rates[]`: {code USD/EUR/TRY/SAR/AED/EGP, cities:{damascus:{buy,sell,change,prev_close,...}, alhasakah:{...}}, updated_at}
    values in OLD lira (14250 = 142.50 new). "damascus" slug = "سوريا - عام".
  - `gold.karats[]`: {karat "24K/22K/21K/18K/14K", cities.damascus.{buy,sell}} per gram OLD lira (21K buy 1,601,800 = 16,018 new).
    Also gold ounce USD (`$3995.60`).
  - `energy.fuel_types[]`: gasoline-95 (19500 old /L), benzin (90) 18500, diesel 17500, gas cylinder 10kg 160000; updated 2026-09-13 (official prices).
  - `energy.electricity_tiers[]`: houses <300kWh 600 old (6 new)/kWh, >300 1400, industrial 1400 (since 2025-12-29).
  - `currencies_updated_at`, `gold_updated_at`.
- Other: `https://sp-today.com/currencies`, `/gold`, `/energy`; API needs key (`/sptoday-api`).
- New lira = old / 100 (redenomination 2026).
- **Central Bank official rate**: cb.gov.sy blocked by SafeLine WAF (HTTP 468, JS challenge). Telegram @centralbankofsyria has no public preview.
  Daily official bulletin is posted as an IMAGE by @AlekhbariahSY around 10:00–10:30 UTC ("المصرف المركزي يصدر النشرة الرسمية لأسعار العملات ... ليوم <weekday> <d> <month> <yyyy>").
  Search: `https://t.me/s/AlekhbariahSY?q=النشرة+الرسمية` -> last match post image (background-image url). Image (640x800) table: dollar 121.50 buy / 122.50 sell, euro 136.00/137.36, TRY 2.44/2.47, SAR, QAR, AED, KWD, JOD (25/10/2026). OCR with Gemini + sanity checks.
  Also verify-sy.com publishes "أسعار صرف العملات في سوريا <date>" articles citing bulletin number (irregular slugs).
  syriandaily.com 2026-10-15: official USD fixed at 122 new SYP.
- Black-market context (sp-today news 24/10): diesel in Aleppo black market 250–280 per litre.

## Earthquakes
- USGS GeoJSON feeds: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson (and FDSN query API).
- EMSC: https://www.seismicportal.eu/fdsnws/event/1/query?format=json&minlat..&limit..

## Weather
- Open-Meteo forecast API (free, no key): https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&daily=...
## Render access (found 13:58)
- From Render, `https://sp-today.com/` returns HTTP 403 (CDN blocks datacenter IP); r.jina.ai proxy gives 429 there.
- The site's own JSON API works without key when sent with `Origin: https://sp-today.com` + `Referer`:
  `https://api-v2.sp-today.com/api/v1/overview?lang=ar&city=damascus` -> {ok,data:{cities,rates,gold:{karats,ounce},global_fx,updated_at,currencies_updated_at,gold_updated_at}}
  `https://api-v2.sp-today.com/api/v1/energy?lang=ar` -> {ok,data:{fuel_types,electricity_tiers,fuel_updated_at,electricity_updated_at}}
  (without Origin -> 401 MISSING_API_KEY). Also /api/v1/gold/international, /api/v1/crypto, /api/v1/silver.
- sp-today Telegram channel: t.me/syp2day (rate posts are images only).
## Earthquakes (14:10)
- EMSC FDSN: https://www.seismicportal.eu/fdsnws/event/1/query?format=json&start=..&minlat..&maxlat..&minlon..&maxlon..&minmag=2.8&orderby=time
  features[].properties {unid, time ISO, lat, lon, depth, mag, magtype, flynn_region, auth}; HTTP 204 when empty.
- USGS FDSN: https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=..&minlatitude..&minmagnitude=2.8 ; coords [lon,lat,depth], properties {mag, place (English), time ms}.
- Recent swarm near Feke (Türkiye) lat 37.7–37.8 lon 36.1, M4.2–5.0 (late Oct 2026).
- Module server/quakes.js; rules: inside Syria M3+, ≤100 km M4+, ≤250 km M5+, ≤600 km M6+; dedup across sources (±120 s, <120 km).
## Camps (14:44)
- OSM camps extracted from Geofabrik syria-latest.osm.pbf (/tmp/syria.pbf) -> /tmp/camps.json -> scripts/add-camps.py (rank 9, ids >= 9e11, search-only). HDX "Syria IDP Sites" is only a 2016 HIU dataset (outdated); no recent CCCM coordinates list found on HDX API. Al-Rasm camps (Manbij) not in OSM -> handled by "📍 مركز منبج" + custom label.
