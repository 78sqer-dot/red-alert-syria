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
