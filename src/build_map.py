#!/usr/bin/env python3
"""Convert Syria admin-1 + neighbors admin-0 GeoJSON into compact SVG paths."""
import json, math
from shapely.geometry import shape, box
from shapely.ops import transform as shp_transform

# ---------- projection ----------
def merc(lon, lat):
    x = math.radians(lon)
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return x, y

# target: Syria fits nicely; bbox with context margin
# Syria approx: lon 35.5..42.5, lat 31.9..37.4 ; context margin
BBOX = (34.2, 31.2, 43.8, 38.6)   # (minLon, minLat, maxLon, maxLat)
VB_W = 1000.0

xs, ys = [], []
for lon in (BBOX[0], BBOX[2]):
    for lat in (BBOX[1], BBOX[3]):
        x, y = merc(lon, lat)
        xs.append(x); ys.append(y)
min_x, max_x, min_y, max_y = min(xs), max(xs), min(ys), max(ys)
PAD = 6.0  # svg units padding
scale = (VB_W - 2 * PAD) / (max_x - min_x)
VB_H = (max_y - min_y) * scale + 2 * PAD

def project(lon, lat):
    x, y = merc(lon, lat)
    return (round((x - min_x) * scale + PAD, 1),
            round((max_y - y) * scale + PAD, 1))

def geom_to_path(geom, tol_deg=0.004):
    """shapely geometry -> svg path 'd' string in projected coords, simplified first."""
    g = geom.simplify(tol_deg, preserve_topology=True)
    g = shp_transform(lambda lon, lat: project(lon, lat), g)
    def ring(coords):
        # drop repeated closing point, svg 'Z' closes
        pts = list(coords)
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts = pts[:-1]
        return pts
    parts = []
    if g.geom_type == "Polygon":
        g = [g]
    elif g.geom_type == "MultiPolygon":
        g = list(g.geoms)
    else:
        return ""
    for poly in g:
        rings = [ring(poly.exterior.coords)] + [ring(r.coords) for r in poly.interiors]
        for r in rings:
            if len(r) < 3:
                continue
            parts.append("M" + "L".join(f"{x} {y}" for x, y in r) + "Z")
    return "".join(parts)

out = {"viewBox": [0, 0, VB_W, round(VB_H, 1)], "governorates": [], "neighbors": []}

# ---------- Syria governorates ----------
AR = {
    "Damascus": "دمشق", "Aleppo": "حلب", "Rural Damascus": "ريف دمشق",
    "Homs": "حمص", "Hama": "حماة", "Lattakia": "اللاذقية", "Idleb": "إدلب",
    "Al-Hasakeh": "الحسكة", "Deir-ez-Zor": "دير الزور", "Tartous": "طرطوس",
    "Ar-Raqqa": "الرقة", "Dar'a": "درعا", "As-Sweida": "السويداء",
    "Quneitra": "القنيطرة",
}
# hand-placed label anchors (lon, lat) so labels never fall outside odd shapes
LABELS = {
    "Damascus": (36.30, 33.42), "Rural Damascus": (36.95, 33.62), "Aleppo": (37.42, 36.53),
    "Idleb": (36.68, 35.90), "Homs": (37.60, 34.55), "Hama": (37.15, 35.20),
    "Lattakia": (35.98, 35.58), "Tartous": (36.05, 34.98), "Deir-ez-Zor": (40.35, 35.30),
    "Al-Hasakeh": (40.95, 36.35), "Ar-Raqqa": (39.05, 36.05), "Dar'a": (36.22, 32.72),
    "As-Sweida": (36.92, 32.78), "Quneitra": (35.87, 33.16),
}

with open("syria_adm1.geojson") as f:
    gj = json.load(f)
for feat in gj["features"]:
    name = feat["properties"]["shapeName"]
    geom = shape(feat["geometry"])
    d = geom_to_path(geom, 0.003)
    lx, ly = project(*LABELS[name])
    out["governorates"].append({"en": name, "ar": AR[name], "d": d, "label": [lx, ly]})
    print(f"{name:16s} {len(d):6d} chars")

# ---------- neighbors (clipped, dimmed context) ----------
NB_LABELS = {"TUR": ("تركيا", (39.5, 37.8)), "IRQ": ("العراق", (42.9, 34.3)),
             "JOR": ("الأردن", (37.6, 31.8)), "LBN": ("لبنان", (35.85, 33.85)),
             "SAU": ("السعودية", (41.5, 31.7)), "CYP": ("قبرص", (33.2, 35.0)),
             "EGY": ("مصر", (34.5, 31.6)), "ISR": (None, None)}
clip = box(BBOX[0] - 0.4, BBOX[1] - 0.4, BBOX[2] + 0.4, BBOX[3] + 0.4)
for code, meta in NB_LABELS.items():
    label, anchor = meta if meta and meta[0] else (None, None)
    try:
        with open(f"nb_{code}.geojson") as f:
            gj = json.load(f)
        geom = shape(gj["features"][0]["geometry"]).intersection(clip)
        if geom.is_empty:
            print(code, "empty after clip"); continue
        d = geom_to_path(geom, 0.006)
        entry = {"code": code, "d": d}
        if label:
            entry["label"] = label
            entry["labelPos"] = list(project(anchor[0], anchor[1]))
        out["neighbors"].append(entry)
        print(f"{code}: {len(d)} chars")
    except Exception as e:
        print(code, "FAIL", e)

# ---------- cities (name, governorate-ar, lat, lon, major) ----------
CITIES = [
    ("دمشق", "دمشق", 33.5138, 36.2765, 3), ("دوما", "ريف دمشق", 33.5725, 36.4031, 1),
    ("حرستا", "ريف دمشق", 33.5620, 36.3686, 0), ("الزبداني", "ريف دمشق", 34.0936, 36.4339, 1),
    ("قطنا", "ريف دمشق", 33.5069, 36.5436, 0), ("النبك", "ريف دمشق", 34.0403, 36.7489, 0),
    ("يبرود", "ريف دمشق", 33.9646, 36.8881, 0), ("الكسوة", "ريف دمشق", 33.3604, 36.2216, 0),
    ("صيدنايا", "ريف دمشق", 33.6845, 36.3769, 0), ("معضمية الشام", "ريف دمشق", 33.4633, 36.2028, 0),
    ("حلب", "حلب", 36.2021, 37.1343, 3), ("الباب", "حلب", 36.3707, 37.5154, 1),
    ("عفرين", "حلب", 36.5112, 36.8681, 1), ("أعزاز", "حلب", 36.5839, 37.0446, 1),
    ("منبج", "حلب", 36.5222, 37.9549, 1), ("جرابلس", "حلب", 36.8160, 38.0103, 1),
    ("السفيرة", "حلب", 35.9539, 37.4372, 0), ("عين العرب", "حلب", 36.8858, 38.3639, 1),
    ("صوران", "حلب", 36.4367, 37.3289, 0), ("دير حافر", "حلب", 36.0303, 37.6853, 0),
    ("إدلب", "إدلب", 35.9330, 36.6330, 2), ("معرة النعمان", "إدلب", 35.6441, 36.6749, 1),
    ("خان شيخون", "إدلب", 35.4394, 36.7241, 0), ("جسر الشغور", "إدلب", 35.8097, 36.1339, 1),
    ("أريحا", "إدلب", 35.9342, 36.6750, 0), ("حمص", "حمص", 34.7324, 36.7137, 3),
    ("تدمر", "حمص", 34.5514, 38.2686, 2), ("الرستن", "حمص", 34.9311, 36.7231, 0),
    ("القصير", "حمص", 34.5660, 36.5742, 0), ("حماة", "حماة", 35.1318, 36.7580, 3),
    ("سلمية", "حماة", 34.9480, 37.0530, 1), ("مصياف", "حماة", 35.0667, 36.3333, 1),
    ("محردة", "حماة", 35.2461, 36.5850, 0), ("السقيلبية", "حماة", 35.1472, 36.4653, 0),
    ("اللاذقية", "اللاذقية", 35.5286, 35.7892, 3), ("جبلة", "اللاذقية", 35.3772, 35.8921, 1),
    ("الحفة", "اللاذقية", 35.6886, 36.0419, 0), ("القرداحة", "اللاذقية", 35.5450, 36.0472, 0),
    ("كسب", "اللاذقية", 35.8836, 35.9486, 0), ("طرطوس", "طرطوس", 34.8890, 35.8886, 3),
    ("بانياس", "طرطوس", 34.9492, 35.9494, 1), ("صافيتا", "طرطوس", 34.9878, 35.9767, 0),
    ("دريكيش", "طرطوس", 34.9206, 36.1025, 0), ("الشيخ بدر", "طرطوس", 34.9333, 35.9917, 0),
    ("دير الزور", "دير الزور", 35.3344, 40.1408, 3), ("الميادين", "دير الزور", 35.0175, 40.4408, 1),
    ("البوكمال", "دير الزور", 34.4517, 40.9267, 1), ("القورية", "دير الزور", 35.4783, 40.7264, 0),
    ("الرقة", "الرقة", 35.9497, 38.9769, 3), ("الطبقة", "الرقة", 35.9972, 38.5436, 1),
    ("تل أبيض", "الرقة", 36.6864, 38.8503, 0), ("الحسكة", "الحسكة", 36.5069, 40.7476, 3),
    ("القامشلي", "الحسكة", 37.0425, 41.2239, 2), ("رأس العين", "الحسكة", 36.8478, 40.0614, 1),
    ("المالكية", "الحسكة", 37.1736, 42.1389, 1), ("الشدادي", "الحسكة", 35.8286, 40.7250, 0),
    ("درعا", "درعا", 32.6172, 36.1033, 3), ("إزرع", "درعا", 32.8461, 36.6114, 1),
    ("الصنمين", "درعا", 33.0347, 36.5836, 0), ("طفس", "درعا", 32.7194, 36.4114, 0),
    ("نوى", "درعا", 32.8847, 36.4014, 0), ("الشيخ مسكين", "درعا", 32.8508, 36.2339, 0),
    ("السويداء", "السويداء", 32.7081, 36.8731, 3), ("شهبا", "السويداء", 32.8297, 36.9150, 0),
    ("صلخد", "السويداء", 32.7672, 36.9878, 0), ("القنيطرة", "القنيطرة", 33.1258, 35.8203, 2),
    ("بقعاتا", "القنيطرة", 33.2342, 35.7772, 0), ("خان أرنبة", "القنيطرة", 33.0969, 35.8853, 0),
]
cities = []
for name, gov, lat, lon, tier in CITIES:
    x, y = project(lon, lat)
    cities.append({"n": name, "g": gov, "x": x, "y": y, "t": tier})
out["cities"] = cities

# ---------- graticule lines ----------
grat = []
for lon in range(36, 43):
    p1, p2 = project(lon, BBOX[1] + 0.2), project(lon, BBOX[3] - 0.2)
    grat.append({"x1": p1[0], "y1": p1[1], "x2": p2[0], "y2": p2[1], "lab": f"{lon}°E",
                 "lx": p1[0], "ly": p1[1] - 4})
for lat in range(32, 38):
    p1, p2 = project(BBOX[0] + 0.2, lat), project(BBOX[2] - 0.2, lat)
    grat.append({"x1": p1[0], "y1": p1[1], "x2": p2[0], "y2": p2[1], "lab": f"{lat}°N",
                 "lx": p2[0] + 4, "ly": p2[1]})
out["graticule"] = grat

with open("mapdata.json", "w") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print("\nTOTAL mapdata.json:", sum(len(ch) for ch in open('mapdata.json').read()) , "chars")
print("viewBox:", out["viewBox"])
