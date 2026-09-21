#!/usr/bin/env python3
"""Assemble the final self-contained index.html from src parts + mapdata."""
import json, pathlib

SRC = pathlib.Path(__file__).parent
OUT = SRC.parent / "index.html"

css    = (SRC / "style.css").read_text(encoding="utf-8")
body   = (SRC / "body.html").read_text(encoding="utf-8")
js     = (SRC / "app.js").read_text(encoding="utf-8")
mapraw = (SRC.parent / "mapdata.json").read_text(encoding="utf-8")
# compact + safe embed
mapdata = json.dumps(json.loads(mapraw), ensure_ascii=False, separators=(",", ":"))
assert "__MAPDATA__" in js, "placeholder missing in app.js"
js = js.replace("__MAPDATA__", mapdata)
assert "__MAPDATA__" not in js

html = f"""<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0b10">
<meta name="description" content="خريطة سوريا المباشرة — نموذج تصميم لمنصة إنذار مبكر تُظهر تنبيهات الغارات والمسيّرات والقصف لحظةً بلحظة على خريطة تفاعلية تغطّي المحافظات السورية الأربع عشرة كافة.">
<meta property="og:title" content="الإنذار الأحمر سوريا — خريطة سوريا المباشرة">
<meta property="og:description" content="تنبيهات الغارات والمسيّرات والقصف لحظةً بلحظة على خريطة تفاعلية (نموذج تصميم ببيانات محاكاة).">
<title>الإنذار الأحمر سوريا — خريطة سوريا المباشرة: تنبيهات الغارات والمسيّرات والصواريخ لحظةً بلحظة</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath d='M32 3l23 8.2v15.5C55 43.5 45.2 55.7 32 61 18.8 55.7 9 43.5 9 26.7V11.2z' fill='%23ff3b4e'/%3E%3Cpath d='M32 16.5l14.5 25.2H17.5z' fill='%23fff'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
{css}
</style>
</head>
<body>
<noscript><div style="padding:40px;text-align:center;font-family:Tahoma">هذه الخريطة التفاعلية تتطلّب تفعيل JavaScript.</div></noscript>
{body}
<script>
{js}
</script>
</body>
</html>
"""
OUT.write_text(html, encoding="utf-8")
print("wrote", OUT, f"{OUT.stat().st_size/1024:.1f} KB")
