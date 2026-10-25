# Services round — build plan (keep updated)

## Done so far
- server/prices.js written + tested locally (sp-today parse OK; official via @AlekhbariahSY search image + Gemini OCR OK: 25 Oct USD 121.50/122.50, EUR 136/137.36, TRY 2.44/2.47). Image 1080x~1365 rendered fine (/tmp/prices.png). Exports: pricesState, refreshPrices, publicPrices, postBulletin, startPrices(getApi), registerPriceTools(bot, OH) [callbacks 'px', 'px:on/off', 'px:t:HH:MM', 'px:test', 'px:now', 'px:now:y'], pricesDebug.
- store.js: new state bucket `svc` (store.state.svc) for prices/roads/power.
- Subagent job_5ok2EH3V building public/data/services.json via scripts/build-services.py (format {"v":1,"cats":["hospital","clinic","pharmacy","fuel","bakery"],"items":[[cat,lat,lon,name_ar,name_en,phone?,hours?]]}).
- Test locally with the GEMINI_API_KEY env var (Render env already has it for the news monitor).

## Next (integration)
1. server/services.js: roads (svc.roads, addRoad/endRoad/sweep, publicRoads, store.emit('roads')) + power (svc.power, publicPower, store.emit('power'), news hook electricity keywords -> cards 'pw:s|c|e|x:<id>', manual add in owner menu '⚡' callback 'pwr').
2. bot.js: typeLabel('road') special; draftSummary road status; 'rd' menu (rd:closed|danger|open) newDraft(ctx,'road') d.road, ttl 360, road durations [60,120,360,720,1440,2880]; publishDraft branch -> publishRoad; 'publish' callback branch; list/end active roads 'rdx:<id>'. Main keyboard: '🛣 حالة طريق' for all; owner row '💱 نشرة الأسعار' (px) + '⚡ الكهرباء' (pwr). registerPriceTools/registerPowerTools in admin role (line ~685).
3. index.js: import startPrices(()=>bots.admin?.api) after startDailySummary (line ~328); /api/prices, /api/services; SSE broadcast 'roads','power'; snapshot add roads.
4. Site: map.js add roads GL layer + services GL layers (clustered), showMe(lon,lat,acc) w/ accuracy circle (current showMe at end of map.js line ~634 flies zoom 11). app.js locate flow + distance + services panel (#prices, #power tabs) + layer toggles. i18n strings. css.
5. Review, tests (npm test?), deploy (git push via red_alert_syria_github token), live QA, owner preview of bulletin via bot (px:test equivalent: add token-protected /api/pricestest like /api/imgtest key sha256(BOT_TOKEN+':prices')).

## Site details decided
- Locate: explainer modal first; getCurrentPosition(low acc, maxAge 120s, timeout 20s) then refine high acc; errors -> guidance modal per platform + retry; localStorage 'ras-me' only.
- Distance chip "على بعد X كم منك" on cards/popup; .near within 25 km; optional "only near alerts" notification toggle.
- On-duty pharmacy: no reliable source -> not built.

## Progress 13:30
- DONE server: prices.js (footer w/o source names), services.js (roads+power, onNewsPost hook, registerPowerTools 'pwr*' & 'pw:*'), bot.js (road flow 'rd','rd:<st>','rdl','rdx:<id>', publish/publish:ch, owner buttons px/pwr, register tools), news-monitor.js hook (onPowerPost before prefilter), index.js (/api/services, /api/pricesdebug & /api/pricestest key sha256(BOT_TOKEN+':prices'), SSE 'roads'/'power', snapshot.roads, startPrices/startServices). All node --check OK. NOT yet run end-to-end / npm test.
## Frontend plan (to do)
- New file public/js/services.js: GL layers for roads (points+dashed lines by status color) + POIs (canvas-drawn disc icons, clustered, lazy-load /data/services.json only when a POI layer is on or search opened); re-add on map 'style.load'; own popups; window.__svcHitTest(point) used in map.js click handler to skip alert selection.
- Sheet #svcSheet (like aboutSheet) with tabs: الأسعار | الكهرباء | الطرق | قريب مني(search). Button #btnSvc in .map-tools. Deep links #prices #power #roads #services.
- Layers panel: section for roads + 4 POI toggles (settings keys showRoads default true, svcCats []).
- Locate: replace #locateMe handler (app.js ~line 922) -> explainer modal, errors guidance, accuracy circle, save 'ras-me'; distance chip in cardHtml/popupHtml via window.__rasMe.
- SSE: es.addEventListener('roads'), snapshot.roads in app.js connect() (~line 1079).
- i18n strings in js/i18n.js (DICT ar/en).
## Progress 13:42
- DONE frontend: public/js/services.js (sheet tabs, GL layers, locate w/ explainer+errors, distance chip), app.js/map.js/settings.js/icons.js/index.html (?v=7) /sw.js v16 / css. QA screenshots OK ar+en (local dev server scripts/_svcdev.mjs on :3998).
- services.json build: scripts/build-services.py now bbox tiles + Syria polygon filter, loop /tmp/svcloop.sh (log /tmp/svcloop.log, caches /tmp/svc_cache_<cat>_<tile>.json).
- TODO: npm test, bot flow sim, commit+push, live QA, bulletin preview to owner.

## Round 2 (14:17) — tasks: quakes, weather, borders, alert distance, full review, secret audit
- DONE secret audit: no Gemini/bot/GitHub tokens in worktree or git history (only branch main on GitHub).
- DONE (local, not pushed yet) server/quakes.js: EMSC+USGS poll 2 min, felt rules, dedup, auto channel+map, type 'quake', owner menu 'qk', /api/quakesdebug.
- DONE (local) server/weather.js: Open-Meteo forecast+dust, 7:30/17:30 slots, drafts to owner (wx:c/m/x), severe auto-post, undo (wx:d), owner menu 'wx', /api/weatherdebug.
- types.js: quake + weather types, group 'nature'; marker-svgs quake/storm glyphs; alert-image head/short/level/note per type; places.alertZones honours place.zone_km.
- NEXT: frontend check (dev server scripts/_qkdev.mjs), push stage 1; then distance (distChip exists in app.js ~289, extend nearby highlight 25 km), borders, review.
- 14:27 PUSHED fe03363 stage 1 (quakes, weather, alert distance/nearby 25 km, forget-my-location in Near me tab, icons quake/storm).
- 14:30 server/borders.js written (16 crossings LB/JO/TR/IQ, statuses open/busy/partial/closed/unknown, stale 72h, bot menu 'bd' for staff, news hook -> owner card bs:*, /api/services borders, SSE 'borders'). NEXT: frontend borders tab + map layer, then push stage 2, then review pass.
- Weather source: Open-Meteo forecast https://api.open-meteo.com/v1/forecast (daily) + air-quality dust https://air-quality-api.open-meteo.com/v1/air-quality (hourly dust). Quakes: EMSC FDSN + USGS FDSN.
