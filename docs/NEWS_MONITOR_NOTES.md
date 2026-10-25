# News monitor — research notes (2026-10-25)

Public Telegram channels verified via https://t.me/s/<username> (HTML preview, no login, 20 latest posts):
- الجزيرة سوريا — @ajasyr (15K, active; "#عاجل |" prefix; signature "الجزيرة سـوريا 👇 https://t.me/ajasyr")
- العربية سوريا — @alarabiya_sy (data-post shows AlArabiya_SY; 6K; signature "🔔 #العربية_سوريا على تلغرام")
- التلفزيون العربي - سوريا — @AlarabyTvSy (60K; hashtags #درعا #القنيطرة in place names)
- تلفزيون سوريا — @TelevisionSyria (180K; "#عاجل | مراسل تلفزيون سوريا:"; signature "🔔 اشترك بقناة التيليجرام")
- الإخبارية السورية (official) — @AlekhbariahSY (78K; "#الإخبارية_السورية")
- شبكة أخبار سوريا الحرة — @ALMHARAR (333K; "#عاجل"; posts world news too)
- Halab Today TV حلب اليوم — @HalabTodayTV (92K; posts Yemen/Saudi news too)
- سانا — @sana_gov (133K; posts world news; "#سانا")
- General (need Syria filter): العربية عاجل @alarabiyaBr, الجزيرة @ajanews (1.3M), الجزيرة مباشر @ajmubasher, الحدث عاجل @Alhadath_Brk, التلفزيون العربي @AlarabyTelevision
- Not found / dead: @AJA_Syria (old 2023), @Damascus_now (2025), @SyrianArabNewsAgency, @AlArabyTV.
Sample (25 Oct 2026 morning): same incident reported with different place names — attack on checkpoint
"بصرى الشام" / "قرب بلدة معربة" / "حاجز مفرق خربا" (all ريف درعا الشرقي); bus accident "أوتوستراد دمشق درعا قرب جسر خبب"
/ "مشفى الصنمين" -> dedupe must be by type family + district/≈20-25 km + time window, plus AI same_as.
Non-Syria items in Syrian channels: Houthi missiles at Riyadh, Trump/Iran, Tel Aviv protests, Hebron.

Gemini (key works): gemini-2.5-flash / -lite are "no longer available to new users" (404).
Working: gemini-flash-lite-latest (tested OK). Also listed: gemini-3.5-flash-lite, gemini-flash-latest, gemini-3.8-flash.
Render MCP has update_environment_variables (merge) but no list-env tool.

## Incident 2026-10-25: المعكر (Quneitra) post not drafted
- Posts: https://t.me/ajasyr/122320 (09:24 UTC) and https://t.me/TelevisionSyria/96939 — both fetched live, dropped by keyword prefilter ("skipped: no-keywords"): no terms for Israeli ground activity (الاحتلال، حفر، سواتر…).
- Location (syria.tv 2026-10-25): "منطقة المعكر، جنوب غربي مزرعة الحانوت بريف القنيطرة الجنوبي، بالقرب من قاعدة تل أبو الغيثار" — 6 m earth berm. https://www.syria.tv/ (article "الاحتلال الإسرائيلي يستأنف أعمال الحفر قرب مزرعة الحانوت في القنيطرة")
- OSM Nominatim: صيدا (Saida al-Hanout / صيدا الجولان), ناحية مركز فيق, Quneitra: 32.8756, 35.8774. DB: id 10312031 صيدا (dist 172039).
- Other recent Quneitra names in news: العجرف، الأصبح، الحميدية، مفرق الكسارات (northern Quneitra), العشة, تل الأحمر الشرقي, مشروع "سوفا 53".
- Added to data/places.json by hand (ids 31000001-3): المعكر (32.8665,35.8665, ~1.5 km SW of صيدا الحانوت, approximate from the report), تل أبو الغيثار (approx.), تل الأحمر (Quneitra, OSM peak 33.21404,35.88031). Aliases: صيدا 10312031 += صيدا الحانوت/صيدا الجولان/مزرعة الحانوت/الحانوت; القنيطرة 173334 += القنيطرة المهدمة. Re-apply if build-places.py is ever re-run.

## Local / activist sources (added 2026-10-25, user request) — verified via t.me/s/<u>
- suhebb0 — صهيب اليعربي (Jazira/Hasakah activist, 131K; mixes poems/personal posts)
- zainaldinmaham1 — زينو ياسر محاميد (Daraa, 460K; every post ends with a "لمتابعة … اضغط على الرابط 👇" promo block)
- HoranFreeMedia — تجمع أحرار حوران (Daraa, 18.5K, active) https://t.me/s/HoranFreeMedia
- daraa24_org — درعا 24 (Daraa, 30.9K, active) https://t.me/s/daraa24_org
- D24net — دير الزور 24 (Deir ez-Zor/east, 10.4K, active, "#د24:" prefix) https://t.me/s/D24net
- AbomosaabSharkea — مراسل الشرقية (الرسمي) (Deir ez-Zor, 46K, active)
- alkhabour — الخابور (east: Hasakah/Raqqa/Deir ez-Zor, 28.2K, active; YouTube/Telegram promo lines)
- Rejected: lattakiatartous (49K but currently ads), Shabakat_akhbar_Alsuwyda_Bdaqiqa (inactive 11 months);
  Suwayda24 has no public Telegram preview under guessed usernames.
- syriancoast24 — الساحل السوري 24 (Latakia/Tartus/Jableh, 61.8K, active; partisan anti-government framing → local)
- SweidaGov1 — محافظة السويداء (official governorate channel, 9.2K, low volume; only Suwayda source with a public preview)
- All 9 marked `local: true, general: true`; migration flag store.state.news.mig.local1 adds them once to the live list.
- Draft card: "(محلي)" after each local source; "⚠️ مصدر محلي/ناشط واحد — غير مؤكد" when only local sources;
  "✅ مؤكد من N مصادر" when 2+ sources merged. No-AI rule fallback never used for local sources.
- cleanPostText: drops promo blocks (لمتابعة/تابعونا/اشترك/للتواصل… and everything after), emoji-only lines,
  link/social lines; decodes anti-filter spellings (مقت.ل، م.ش.ن.و.ق،اً، حـ.ـ،،زب); keywords also matched without spaces (انفج ار).
