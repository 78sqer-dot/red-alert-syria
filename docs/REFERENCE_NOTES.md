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
