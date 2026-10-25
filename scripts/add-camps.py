#!/usr/bin/env python3
"""Add IDP / refugee camps (مخيمات) from an OpenStreetMap extract to data/places.json.

Input: a camps JSON made from the Geofabrik Syria extract (see extract_camps below), or run with
--pbf /path/to/syria-latest.osm.pbf to extract directly (needs `pip install osmium`).
Camps get rank 9 (search-only: they never appear in the district menus, never become a district
centre) and inherit governorate / district / ناحية from the nearest town.
Re-running replaces the previously added camps (ids >= CAMP_ID0).
"""
import json, math, re, sys, argparse

CAMP_ID0 = 900_000_000_000
BAD = re.compile(r'مسجد|بئر|مدير|ملجأ|مدرسة|مشفى|مستوصف|نقطة|فرن|ادارة|إدارة|دوار|موقف|منزل|مزرعة|الطاقة|الكشافة|قوة|اللي|معسكر|مخيمنا|Management|Branch|CANLOG|UNDOF|Solar|Roundabout|^CAMP$', re.I)


def extract_camps(pbf):
    import osmium

    class H(osmium.SimpleHandler):
        def __init__(s):
            super().__init__(); s.out = []

        def take(s, o, lat, lon):
            t = dict(o.tags)
            n = t.get('name:ar') or t.get('name') or ''
            en = t.get('name:en') or ''
            if t.get('tourism') == 'camp_site' or t.get('leisure'):
                return
            tagged = t.get('amenity') == 'refugee_site' or t.get('refugee') == 'yes'
            named = re.match(r'^\s*مخيم|^\s*مخيّم', n) or re.search(r'\b(IDP|refugee)\b.*camp|camp\b', en, re.I)
            if n and (tagged or named):
                s.out.append(dict(ar=n, en=en, lat=round(lat, 5), lon=round(lon, 5)))

        def node(s, n):
            if n.tags:
                s.take(n, n.location.lat, n.location.lon)

        def area(s, a):
            if not a.tags:
                return
            try:
                pts = [(nd.lat, nd.lon) for r in a.outer_rings() for nd in r]
            except Exception:
                return
            if pts:
                s.take(a, sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))

    h = H(); h.apply_file(pbf, locations=True)
    return h.out


def km(a, b):
    R = 6371.0
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def norm(s):
    s = re.sub(r'[\u064B-\u065F\u0670\u0640]', '', s)
    s = s.replace('أ', 'ا').replace('إ', 'ا').replace('آ', 'ا').replace('ة', 'ه').replace('ى', 'ي')
    return re.sub(r'\s+', ' ', s).strip()


def clean_ar(n, en):
    n = n.replace('مخيّم', 'مخيم').strip()
    n = re.sub(r'\s+(للاجئين|للنازحين|للمهجرين)$', '', n)
    if not n.startswith('مخيم') and re.search(r'[\u0600-\u06FF]', n):
        n = 'مخيم ' + n
    if not re.search(r'[\u0600-\u06FF]', n):
        return None  # Latin-only names: skip (no reliable Arabic name to search by)
    return n


try:
    from shapely.geometry import shape, Point
    from shapely.ops import unary_union
    _g = json.load(open('public/data/syria-border.geojson'))
    BORDER = unary_union([shape(f['geometry']) for f in _g.get('features', [_g])]).buffer(0.003)
except Exception as e:  # noqa
    print('border check off:', e); BORDER = None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pbf')
    ap.add_argument('--camps', default='/tmp/camps.json')
    ap.add_argument('--places', default='data/places.json')
    a = ap.parse_args()
    raw_camps = extract_camps(a.pbf) if a.pbf else json.load(open(a.camps))
    db = json.load(open(a.places))
    db['places'] = [p for p in db['places'] if p[0] < CAMP_ID0]
    towns = [p for p in db['places'] if p[7] <= 6]
    have = {norm(p[1]) for p in db['places']}
    out = []
    for c in raw_camps:
        if BAD.search(c['ar'] + ' ' + c['en']):
            continue
        ar = clean_ar(c['ar'], c['en'])
        if not ar or len(ar) < 7:
            continue
        if not (32.2 < c['lat'] < 37.5 and 35.5 < c['lon'] < 42.5):
            continue
        if BORDER is not None and not BORDER.contains(Point(c['lon'], c['lat'])):
            continue  # camps on the Turkish side (Kilis, Öncüpınar …)
        if norm(ar) in have:
            continue
        if any(norm(o['ar']) == norm(ar) and km((o['lat'], o['lon']), (c['lat'], c['lon'])) < 4 for o in out):
            continue  # same camp mapped twice (node + area)
        best = min(towns, key=lambda p: (p[3] - c['lat']) ** 2 + (p[4] - c['lon']) ** 2)
        d = km((best[3], best[4]), (c['lat'], c['lon']))
        if d > 25:
            continue
        out.append(dict(ar=ar, en=(c['en'] or '').strip(), lat=c['lat'], lon=c['lon'], gov=best[5], dist=best[6], sub=best[8] if len(best) > 8 else ''))
    for c in out:  # nearest-town fix-ups
        if 'كبان' in c['ar']:
            t = next((x for x in db['districts'] if x['ar'] == 'تدمر'), None)
            if t: c.update(gov=t['gov'], dist=t['code'], sub='')
    rows = []
    for i, c in enumerate(out):
        base = re.sub(r'^مخيم\s+', '', c['ar'])
        alt = []  # the bare name ("النور", "القلعة") would crowd town searches
        if 'مخيم' in c['ar']:
            alt.append(c['ar'].replace('مخيم', 'مخيمات', 1))
        en = c['en'] if c['en'] and not re.search(r'[\u0600-\u06FF]', c['en']) else c['ar']
        rows.append([CAMP_ID0 + i, c['ar'], en, c['lat'], c['lon'], c['gov'], c['dist'], 9, c['sub'], alt])
    db['places'].extend(rows)
    json.dump(db, open(a.places, 'w'), ensure_ascii=False, separators=(',', ':'))
    print('camps added:', len(rows))
    for r in rows:
        print(' ', r[1], '|', r[2], r[3], r[4], r[5], r[6])


if __name__ == '__main__':
    main()
