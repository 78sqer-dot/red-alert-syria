# Reference notes from https://redalert.com.lb/ar/ (analysed 2026-10-23)

Stack: Next.js, MapLibre GL (vendor/maplibre), style https://tiles.openfreemap.org/styles/liberty, terrain https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png
APIs: /api/alerts -> {alerts:[{id,type,title,description,location:{latitude,longitude},timestamp,expires_at,source,is_active,areas[],scope}]}, /api/villages
Fonts: Noto Kufi Arabic (--font-arabic), JetBrains Mono (--font-mono). theme-color #ff3b4e
localStorage 'redalert-settings': notifications{enabled,types[],sound,vibration,ringtone:'alert1',volume:0.8}, darkMode, language, showInactivAlerts, hasSeenWelcome, hasSeenTour, mapLayer:'standard', map3d, showPeaks, showYellowLine

CSS vars light: --bg-primary:#f5f5fa;--bg-secondary:#ededf4;--bg-card:#fff;--bg-card-hover:#f0f0f5;--bg-elevated:#fff;--bg-subtle:#e8e8f0;--bg-glass:#fffffff0;--text-primary:#1a1a2e;--text-secondary:#55556a;--text-muted:#88889a;--border:#d0d0da;--border-subtle:#e0e0ea;--orange:#ff8c2e;--red:#ff3b4e;--blue:#3b8eff;--green:#2ee66a;--online:#2ee66a;--offline:#ff3b4e;--connecting:#ffa63b;--map-circle:#3b8eff14;--map-circle-border:#3b8eff59;--text-on-accent:#f0f0f5
dark: --bg-primary:#0d0d10;--bg-secondary:#131318;--bg-card:#181820;--bg-card-hover:#1f1f29;--bg-elevated:#1a1a23;--bg-subtle:#20202a;--bg-glass:#181820;--text-primary:#f0f0f5;--text-secondary:#8888a0;--text-muted:#55556a;--border:#2c2c38;--border-subtle:#1f1f28;--orange:#c87400;--red:#d4392f;--blue:#4a78d4;--green:#4d9c50;--online:#4d9c50;--connecting:#c89017;--map-circle:#4a78d41a;--map-circle-border:#4a78d48c

Type colors: uav/drone/helicopter #ff6b7a, plane #3b8eff, earthquake #ff3b4e, airstrike #b91c1c, uav_strike #be123c, artillery #f97316, explosion #ea580c, missile #7f1d1d, gunfire #65a30d, home_destroying #0891b2, signal_sweep #14b8a6, ground_advance #db2777, road_closure #eab308, evacuation #a855f7, default #22c55e. Badge bg = rgba(color,0.12), border rgba(color,0.19)

Layout: header h-14 (56px) bg var(--bg-secondary) border-b; buttons h-9 rounded-md bg-elevated border; order (RTL): logo wordmark, الإعدادات, dark toggle (moon icon blue), EN, spacer, "تابعنا على تيليغرام" (telegram icon #229ED9), donor ticker (wide box), ادعمنا (heart), بلّغ (orange bg, black text, warning icon), status pill (dot green "مباشر").
Sidebar 305px (left side in RTL): "17 تنبيه" bold 20px + subtitle "التنبيهات النشطة على الخريطة" + X button; cards white rounded, badge (type) top right, time mono "5د · ٢٣ تشرين الأول · ٠٧:٠٩ م", title bold 16px, description, #hashtags, icons map+share.
Detail view: "تفاصيل التنبيه" + prev/next arrows + X; card + status pill "نشط" red outline; rows النوع / التوقيت; الإحداثيات خط العرض/خط الطول mono; black full-width button "مشاركة التنبيه".
Map controls: top (right) "تصفية" (filter icon) and "الطبقات" (layers) white buttons; filter dropdown "أظهر فقط" + "مسح", groups with checkboxes red: نشاط جوّي, غارات وقصف, أخرى. Layers dropdown: قياسي/قمر صناعي/الطقس(قريباً) radios, toggle تضاريس ثلاثية الأبعاد, الطبقات الإضافية: القمم الجبلية, الخط الأصفر (toggles red).
Zoom +/- bottom right, scale bottom left, bottom-center pill "ⓘ عن الخريطة المباشرة | الإنذار الأحمر لبنان ^".
Popup: badge + time, title bold 14, desc 12 gray clamp 3, #tags, green WhatsApp button "مشاركة" (#25d366).
Markers: UAV = 30px gray drone svg (fill #6b7280, drop-shadow) orbiting 20px radius 6s linear (only at zoom-detail), with pink pulse circle; static = 34px circle bg color, 3px border darker, white 18px icon.
Tour 6 steps: welcome, connection status, filter, layers, alert list, settings. popover white card with red left bar, counter "1 / 6", buttons السابق/التالي/تم (red).
Settings drawer: right side large, editorial: eyebrow red small with line ("تخصيص التجربة"), huge title "الإعدادات", sections cards (المظهر واللغة, الإشعارات كيف تصلك التنبيهات, الصوت النغمة ومستوى الصوت, الجولة التعريفية, من نحن), toggles red.
Welcome: subtitle "تنبيهات لحظية للبنان", tagline "مجاني. بدون تطبيق. للجميع.", features (خريطة مباشرة / بدون تطبيق), start "تفعيل التنبيهات والمتابعة", disclaimer.
Logo: red #ED1C24 rect, white arcs icon + vertical bar + RED (bold) / ALERT (thin).

Bot: @Red_Alert_Syria_bot (id 8921728574) is admin of channel @Red_Alert_Syria (id -1004387100492) with post/edit/delete rights. Owner id 8270709633.
GitHub connector account: 78sqer-dot. Render workspace tea-dbcholnf3r2c73belk8g (2 existing free services: abu-zahraa-bot, shadow-command-center, region frankfurt).
Data: GeoNames SY (CC BY 4.0), geoBoundaries SYR ADM0/1/2 (gbOpen), raw in /workspace/data.

## Original marker system (extracted 2026-10-23 from redalert.com.lb chunks 3j2z45j30un6c.js / 3pi7y5o7ru-6i.js / 0cjnt7l_c7om_.js)
- Glyph SVGs saved to public/js/marker-svgs.js (uav, plane, airstrike bomb, artillery crosshair, home_destroying, missile, explosion, other...).
- Static marker: div.static-alert-icon 34x34 round, background typeDiscBackground (airstrike #dc2626, artillery #f97316, else #000000), border 3px solid typeColor (airstrike #b91c1c), svg 18x18 fill white (or typeColor when disc is black). No halos/pulses.
- Orbiting types (uav, drone, helicopter, signal_sweep): 64x64 box, 30px inner orbiting 20px radius 6s linear only when map has class zoom-detail; svg 18px fill #6b7280 (dark #9ca3af) with drop-shadow 0 0 1px rgba(0,0,0,.85).
- Plane: squad of 3 small plane svgs (16/14/14px, rotate -45deg, fill typeColor #3b8eff) moving translateY(110px -> -110px) 7s linear with fade.
- Zone (AlertCircle): for non point-impact types only; point-impact = airstrike, uav_strike, artillery, explosion, missile, gunfire, home_destroying. Radius km by scope: village 1.5, multi_village 3, district 8, governorate 20 (region uses radius_km). Fill typeColor opacity .14 (no fill for plane); line opacity .7 width 2 (plane 1.5 dashed [3,4]).
- typeColor: uav #ff6b7a, plane #3b8eff, airstrike #b91c1c, artillery #f97316, explosion #ea580c, missile #7f1d1d, home_destroying #0891b2, earthquake #ff3b4e, default #22c55e.

## Phone "Desktop site" mode (notes)
- Chrome Android "Request desktop site" ignores the viewport meta tag and lays out at min-width 980px (stackoverflow.com/questions/55089698). Tablets on Chrome desktop mode use window width (developer.chrome.com/blog/desktop-mode).
- MapLibre 5.24 DOM.mousePos divides by getBoundingClientRect().width/offsetWidth, so CSS zoom on <html> keeps pointer math correct.

## User feedback round (22:30) — from screenshots 182287/182288/182163
- Original (redalert.com.lb, 182163): several translucent red circles (thin line ~1.5px, fill ~0.2, NO heavy glow), one per affected locality, overlapping; tiny drone icons (~18px) that stay small when zooming in.
- Ours: one huge solid circle over Damascus (governorate scope) -> replace with multiple ~2.5 km circles over top-ranked localities in the area; subtle glow.
- Civil showed old disc+house glyph on phone (stale cached /shared/types.js, maxAge 1h) -> no-cache + versioned import.
- Revert artillery to previous static orange disc marker (no tank).
- Add civil sub-types: حادث سير، مظاهرة، حريق، طائرة مدنية (each own icon, in both bots + channel posts).
- places.json place row: [id, ar, en, lat, lon, govCode, districtCode, rank(0=capital..8)].

## Channel post format requested by user (22:35) — replaces earlier format
```
تنبيه مدني - <emoji by type>
كويرس شرقي📍كويرس شرقي ، الباب، حلب
تاريخ :  ٢٣ تشرين الأول
الساعة :  ١٠:٣١ م

🗺 الخريطة المباشرة · Red Alert Syria   (link to map)
```
Plus civil sub-buttons in BOTH bots: civil button opens submenu (مدني عام، حادث سير، مظاهرة، حريق، طائرة مدنية).

## User feedback round (22:55) — screenshots 182404/182405/182406
- Phone (360css wide, dark): civil disc (house glyph), breaking "!" disc (~30css px with glow ring) and orange artillery discs are FAR too big. Warplanes = 3 blue planes; drones = several crosses.
- Drone over Damascus: several drones + small red hexagon-like blobs (low-poly circles at country zoom). User wants EXACTLY like redalert.com.lb: study live original for drone count + how affected-area circles appear on zoom.
- All markers must be small like original at every zoom.
- Report bot: "✅ تمت الموافقة على بلاغك ونُشر. شكراً لمساهمتك!" messages pile up, not auto-deleted -> auto-delete them (and handled report messages in publishing bot).

## Drone marker (verified from redalert.com.lb JS bundle, chunk 3j2z45j30un6c.js)
- Orbiting component: 64x64 box, inner 30px div, svg 18x18 viewBox 0 0 512 512, fill #6b7280 (dark #9ca3af), drop-shadow(0 0 1px rgba(0,0,0,.85)) drop-shadow(0 0 .5px ...).
- Orbit animation (rotate(0)->rotate(-360deg) translateX(20px), 6s linear) ONLY when map container has class zoom-detail (zoom >= 11). Tiers: zoom-tier-mid 9..11, zoom-tier-far < 9.
- Glyph `uav` = same as public/js/marker-svgs.js (fuselage ellipse, nose dome, wings path, V-tail).

## QA session 2026-10-24 (perf + relay clear)
- Perf root cause: setInterval glow (setPaintProperty 10x/s) forced constant full map redraw -> phones lag. Removed; zones rebuild on zoomend; popup fit once (not after user zoom); popup moved into canvas container so pinch on it zooms map; pixelRatio cap 2; marker animations paused while moving.
- Relay chat messages tracked in store.convo ('admin:<chat>' / 'report:<chat>') and deleted on menu (home callback, /start, /menu).
- Local test server: scripts/_devsrv.mjs (port 3997 web, 3996 inject: /?type=&lat=&lon=&scope=&name=, /clear). Not committed.
- QA scripts: /tmp/perf.py, /tmp/perf_live.py, /tmp/qa.py. Render workspace tea-dbcholnf3r2c73belk8g, service srv-dbdp7459fdbs7386b3d0.

## Channel alert image (2026-10-24)
- Reference: /home/ubuntu/upload/182515.jpg (redalert.com.lb channel card 1024x988: navy header #0f172a + 6px orange bar, title right, severity dot+text "حيطة وحذر", logo+domain left, light map w/ red circle, grey note footer "ملاحظة: عدد الدوائر يدلّ على عدد المناطق لا على عدد المسيّرات").
- server/alert-image.js renders it (resvg). CARTO raster now returns "API KEY REQUIRED" -> use tile.openstreetmap.org (fallback openstreetmap.fr/hot), muted with feColorMatrix saturate .42 + white .18 overlay. Attribution "© OpenStreetMap contributors" required.
- Noto Kufi Arabic lacks : · - ( ) etc.; resvg doesn't fall back per glyph and mixed-font tspans in RTL vanish -> glyphs were merged from Noto Sans into the Kufi TTFs (fontTools).
- CPU: ~260 ms locally at 820px output (Render free = 0.1 CPU -> ~2.5 s). Deadline 12 s then text fallback. ALERT_IMAGES=false disables. Logo: public/img/logo-wordmark.svg or ALERT_IMAGE_LOGO.
- Stored alert: location {latitude,longitude}; names in alert.place; alert.scope; channel_media 'photo'|'text' -> refreshChannelPost uses editMessageCaption for photos.
- Owner Telegram id 8270709633 (test images go there only, never @Red_Alert_Syria).
- /api/imgtest?key=sha256(BOT_TOKEN+':imgtest')&type=uav|all&q=place -> renders on Render, sends to owner chat only. Render service srv-dbdp7459fdbs7386b3d0, workspace tea-dbcholnf3r2c73belk8g.

## Project transfer + editors (2026-10-24)
Facts (sources):
- Render FAQ https://render.com/docs/faq : "No, it is not currently possible to transfer existing services between workspaces." -> invite member to workspace, or recreate service in buyer's workspace. Filesystem is ephemeral (lost on redeploy/restart).
- BotFather transfer: /mybots -> bot -> Transfer Ownership -> Choose recipient -> confirm; requires 2-step verification enabled >= 7 days (https://help.bothelp.io/en/smena-vladelcza-telegram-bota/).
- Telegram channel ownership: Channel -> Edit -> Administrators -> new admin (all rights) -> "Transfer Channel Ownership"; needs 2FA enabled > 7 days and session > 24h (reddit/timothyreed snippets).
- GitHub: repo Settings -> General -> Danger Zone -> Transfer ownership.
Design:
- Overrides in store.state.settings.project {ownerId, botToken, reportBotToken, channel, channelUrl, reportBotUsername}; applied to mutable config at startup + hot-swap bots at runtime (no restart).
- Durable via Render env vars when owner links a Render API key in the bot (server PUTs /v1/services/$RENDER_SERVICE_ID/env-vars/KEY; key stored only as env RENDER_API_KEY). Env keys: OWNER_IDS, BOT_TOKEN, REPORT_BOT_TOKEN, CHANNEL_ID, CHANNEL_URL, REPORT_BOT_USERNAME.
- Backup pinned in owner's private chat with publishing bot -> after owner change mirror to env owner chat (tokens stripped) until env updated.
- Editors: button screen with list + per-editor remove, add by ID / forward / @username (known users) / request_users contact picker.

## Session 2026-10-24 morning: clean chat + contact links + PWA install popup
DONE (not yet deployed):
- server/ui-clean.js: installTracker(api, role) + cleanChat(role) middleware (wired first in createBot).
  Tracks every bot msg per private chat in store.state.ui (persist backupSoon:false; flushBackup(true) on shutdown).
  New screen (msg with inline kb / media / edit-in-place) => delete all older tracked msgs; plain notices don't count;
  user msgs tracked (u:1) unless ctx.ras.keepInput (relay). _keep:'c' report cards (setKeep false in closeReport),
  'r' relay copies, 'b' pinned backup. >48h: delete refused -> edit to '▫️' & drop keyboard.
  Sim: scripts/_clean.mjs (621 pass) — needs installTracker re-installed after mock. _xf.mjs 65 pass, bot-sim ok.
- Contacts: store.settings.contacts {wa, phone(+E164), phoneMode both|wa|tel, tg}; store.publicContacts
  {wa, phone, waChat, tel, tg}; SSE snapshot.contacts + 'contacts' event. server/contact-tools.js
  registerContactTools(bot,h) (callbacks ct, ct:set:*, ct:rm:*, ct:mode:*, /contacts).
TODO: register contact tools in createBot after registerOwnerTools + main menu owner button '📞 روابط التواصل' 'ct';
  site UI: header buttons (#btnWa green whatsapp, #btnContact -> modal with waChat/tel/tg), drawer + about sheet links,
  hidden until set, mobile in drawer/about only; icons brand-whatsapp/phone/headset (Tabler);
  then PWA install popup like redalert.com.lb (study original), manifest/maskable icons, beforeinstallprompt, iOS hint,
  snooze days, sequence after welcome; sw no stale. Then sim, deploy, live QA screenshots (phone/dsite/laptop).
- 07:14 DONE locally: contact-tools registered + menu btn 'ct'; site contacts UI (#btnWa,#btnContact, modal, drawer about-us, about sheet; live SSE);
  PWA: public/js/install.js (+boot.js early bip capture), manifest-{lang}.webmanifest route, maskable-192/512 regenerated (80% scale),
  sw v15 (img/data network-first). redalert.com.lb findings: site.webmanifest (Red Alert Lebanon, start_url /, theme #ff3b4e,
  icon-512 'any maskable'); code has settings 'installApp' section (beforeinstallprompt captured+preventDefault, iOS Share→Add steps,
  androidNoPromptIntro); first visit shows 6-step tour; no own timed popup found → entry popup = browser's native install prompt.
  QA: scripts/_pwa_qa.py (needs devsrv :3997/:3996, /contacts ctl) 36 checks; shots /tmp/pwa-qa. TODO: screenshots shot-narrow/wide for manifest,
  bot sim for contact-tools, deploy, live QA.

## 2026-10-24 08:5x incident: approved report not published
- Pushed fcbe46e 08:52 (token secret red_alert_syria_github.token via http extraheader; remote URL clean). Deploy dep-dbe4f23m8hqs73d5kujg live.
- Render log: new instance restored backup 05:52:43.72Z; relay key a:8270709633:89 written 05:52:43.465Z by OLD instance (card sent during overlap). Approve hit new instance -> reports Map (memory only) empty -> vanish(notFound). Reporter = owner himself (8270709633). Content unrecoverable (memory only).
- Fix (uncommitted at 09:00): store.state.reports/reportsDone/gone; reportPut/Get/Take/Restore/Prune; mergeFromBackup() at +20/60/180 s after boot and on approve miss; answerCallbackQuery errors non-fatal; unknown card -> popup + keep card. Sim: scripts/_rp.mjs.
- Still TODO after: live checks (contacts test values then remove, phone/dsite/laptop screenshots), _clean.mjs had 1 failure after answerCallbackQuery transformer ("prompt still visible after a wrong input") -> investigate.
- 09:08 DONE: 7816112 live; sims _rp 17/0, _clean 627/0 (clean data), _xf 65/0, _ct 45/0; live contacts set->verified (laptop, dsite, phone About sheet)->removed (contacts {}); webhooks ok. Shots /home/ubuntu/ras-live-qa/
- 10:06 DONE f9fa791 live: drone hidden <z11 (orig CSS .zoom-tier-far/mid .uav-svg{visibility:hidden}), orbit radius = ring px (--orb), 9s. Live QA scripts/_uav_qa.py FAKE=1 (browser-only fake alert) 27/27. Shots /home/ubuntu/ras-drone-qa/
- 11:19 DONE 994dea1 live: places +416 (GeoNames ar list w/ Latin first was dropping villages; عران 173068 now in الباب), NAME_FIX for 9 Aleppo names, en backticks stripped. QA scripts/_places_qa.mjs; live /api/imgtest q=عران ok (owner chat only). Not added: منغ (GeoNames merges it into معرين, coords unreliable).

## 2026-10-24 13:5x task: multi-area + pulsing circles + 1h auto-removal
User asks (publishing bot @Red_Alert_Syria_bot ONLY, report bot unchanged):
1. Publish ONCE for real to channel+map: protest (مظاهرة) infographic /home/ubuntu/upload/182725.jpg
   Title: «أبرز نقاط التظاهر الرافضة لانتهاكات الاحتلال الإسرائيلي في الجنوب السوري، خلال مظاهرات الجمعة 23 تشرين الأول»
   Places (ids in data/places.json): درعا #170905 (ساحة 18 آذار) · مصياف #167046 · سلمية #164947 (حماة) · المزة #173470 (stored «مزة» → NAME_FIX 'المزة') ·
   خان أرنبة #168355 · غويران #165622 (stored «قويران» → NAME_FIX 'غويران','Ghuwayran') · الرقة #172955 · حمص #169577 (ساحة الساعة الجديدة) · دوما #170592 · سعسع #164773 · سقبا #164828
2. Future: pick several areas per alert; each area its own glowing PULSING circle sized to place; keep zoom behaviour (drone hidden <z11, orbits main circle >=z11). Clean chat.
3. Every alert disappears from map 1h after publish (default auto-cleanup = 1h, keep other choices), stats still count removed alerts, survives restarts. Applies to the protest post too.
Return: channel post link + screenshots (post image, map with circles). Push w/ token secret red_alert_syria_github.token.
Done so far: places.js placeKm(rank)+alertZones(); locationFrom adds rank; store.addAlert extra[], publicAlert zones=alertZones (all types), more[]; alert-image zones all types + glow halo + smaller icon when multi.
TODO: bot (d.extra, addloc/rmloc buttons, summary, channelPost multi 📍 lines, buildAlertInput extra/title/areas, alertImage placeLabel), map.js zones all types + DOM pulse (hide during zoom), select fitBounds, app.js placeName multi, 1h auto-delete, NAME_FIX rebuild, tests, live publish via webhook (scripts/_live_ct.mjs pattern).
