"""Build Syrian places dataset from GeoNames (CC-BY 4.0) + geoBoundaries."""
import json, math, re, collections, sys
SRC = sys.argv[1] if len(sys.argv) > 1 else '/workspace/data'
rows = [l.rstrip('\n').split('\t') for l in open(f'{SRC}/sy/SY.txt', encoding='utf8')]
ar = {}
for l in open(f'{SRC}/syalt/SY.txt', encoding='utf8'):
    p = l.rstrip('\n').split('\t')
    if p[2] == 'ar' and p[7] != '1':  # skip historic
        # GeoNames sometimes tags a Latin transliteration as 'ar' (e.g. "‘Arān" before "عران"):
        # only Arabic-script names count, otherwise the village was dropped altogether
        if not re.search('[\u0600-\u06FF]', p[3]): continue
        gid = p[1]
        if gid not in ar or p[4] == '1':
            ar[gid] = p[3].strip()

def clean_ar(s):
    s = re.sub(r'\s+', ' ', s).strip()
    return s

GOV_ORDER = ['13','08','09','11','10','02','14','12','06','05','03','07','04','01']
govs = {}
for r in rows:
    if r[7] == 'ADM1':
        code = r[10]
        en = r[1].replace(' Governorate', '').replace('Damascus Countryside', 'Rif Dimashq')
        a = clean_ar(ar.get(r[0], en)).replace('محافظة ', '').replace('ادلب', 'إدلب')
        govs[code] = {'code': code, 'ar': a, 'en': en, 'lat': float(r[4]), 'lon': float(r[5])}
# better centroids for display: use capital city coords
dists = {}
from shapely.geometry import shape, Point
from shapely.prepared import prep
adm2 = json.load(open(f'{SRC}/adm2.geojson'))['features']
polys = [(f['properties']['shapeName'], shape(f['geometry'])) for f in adm2]
preps = [(n, prep(p), p) for n, p in polys]
def poly_of(lat, lon):
    pt = Point(lon, lat)
    for i, (n, pp, p) in enumerate(preps):
        if pp.contains(pt): return i
    best = min(range(len(polys)), key=lambda i: polys[i][1].distance(pt))
    return best if polys[best][1].distance(pt) < 0.08 else None
poly2dist = {}
for r in rows:
    if r[7] == 'ADM2':
        a = clean_ar(ar.get(r[0], r[1])).replace('منطقة ', '').replace('مركز ', '')
        en = r[1].replace(' District', '').replace(' Governorate', '')
        dists[r[11]] = {'code': r[11], 'gov': r[10], 'ar': a, 'en': en}
        i = poly_of(float(r[4]), float(r[5]))
        if i is not None and i not in poly2dist: poly2dist[i] = r[11]
# fallback: polygons without match -> nearest unmatched district seat
used = set(poly2dist.values())
for i, (n, p) in enumerate(polys):
    if i in poly2dist: continue
    cands = [r for r in rows if r[7] == 'ADM2' and r[11] not in used]
    if cands:
        c = p.centroid
        r = min(cands, key=lambda r: (float(r[4]) - c.y) ** 2 + (float(r[5]) - c.x) ** 2)
        poly2dist[i] = r[11]; used.add(r[11])
DFIX = {'170665': ('المالكية', 'Al-Malikiyah'), '172039': ('فيق', 'Fiq'), '173885': ('السقيلبية', 'Al-Suqaylabiyah'), '169388': ('إدلب', 'Idlib'), '173335': ('القنيطرة', 'Quneitra'), '8540234': ('ريف دمشق', 'Rif Dimashq'), '170653': ('دمشق', 'Damascus')}
for k, (a, e) in DFIX.items():
    if k in dists: dists[k]['ar'] = a; dists[k]['en'] = e
print('poly matched', len(poly2dist), 'of', len(polys), file=sys.stderr)

AR_FALLBACK_GOVS = {'09'}  # Aleppo
# GeoNames Arabic names that are misspelled / an old alias for well-known places (Aleppo countryside)
NAME_FIX = {
    '173068': ('عران', 'Aran'),
    '170857': ('دارة عزة', 'Darat Izza'),
    '170137': ('الحاضر', 'Al-Hader'),
    '166458': ('الزهراء', 'Al-Zahraa'),
    '171064': ('بزاعة', "Bza'a"),
    '163465': ('تل شغيب', 'Tal Shgheib'),
    '167615': ('معارة الأرتيق', 'Maarat al-Artiq'),
    '169402': ('أبزمو', 'Abzimo'),
    '165298': ('رتيان', 'Ratyan'),
    '165622': ('غويران', 'Ghuwayran'),
    '173470': ('المزة', 'Al-Mazzeh'),
}
RANK = {'PPLC': 0, 'PPLA': 1, 'PPLA2': 2, 'PPLA3': 3, 'PPLA4': 4, 'PPL': 5, 'PPLX': 6, 'PPLL': 7, 'PPLF': 8, 'PPLS': 8, 'PPLQ': 9, 'PPLW': 9, 'PPLH': 9, 'PPLR': 8}
places = []
for r in rows:
    if r[6] != 'P': continue
    fcode = r[7]
    if fcode in ('PPLQ', 'PPLW', 'PPLH'): continue
    if r[0] in ar: a = clean_ar(ar[r[0]])
    elif r[10] in AR_FALLBACK_GOVS:
        # some villages (e.g. عران near al-Bab) carry their Arabic name only in the main file's
        # alternate-names column, not in the per-language file: use the first purely Arabic one
        alt = [clean_ar(x) for x in r[3].split(',') if re.fullmatch(r'[\u0621-\u063A\u0641-\u064A\u0671-\u06D3 ]{2,}', clean_ar(x))]
        if not alt: continue
        a = alt[0]
    else: continue
    if not re.search('[\u0600-\u06FF]', a): continue
    pop = int(r[14] or 0)
    rank = RANK.get(fcode, 8)
    if fcode == 'PPL' and pop > 0: rank = 4
    lat, lon = float(r[4]), float(r[5])
    pi = poly_of(lat, lon)
    if pi is None: continue  # outside Syria
    dcode = poly2dist.get(pi, '')
    gcode = dists[dcode]['gov'] if dcode in dists else r[10]
    en = (r[2] or r[1]).replace('`', '').strip()
    if r[0] in NAME_FIX: a, en = NAME_FIX[r[0]]
    places.append({'id': int(r[0]), 'ar': a, 'en': en, 'lat': round(float(r[4]), 5), 'lon': round(float(r[5]), 5),
                   'gov': gcode, 'dist': dcode, 'rank': rank, 'pop': pop})

def km(a, b):
    R = 6371; dl = math.radians(b['lat'] - a['lat']); dn = math.radians(b['lon'] - a['lon'])
    x = math.sin(dl/2)**2 + math.cos(math.radians(a['lat']))*math.cos(math.radians(b['lat']))*math.sin(dn/2)**2
    return 2*R*math.asin(math.sqrt(x))

FIX = {170654: 'دمشق', 173576: 'اللاذقية', 170063: 'حلب', 169389: 'إدلب'}
for p in places:
    if p['id'] in FIX: p['ar'] = FIX[p['id']]
places.sort(key=lambda p: (p['rank'], -p['pop']))
seen = collections.defaultdict(list); out = []
for p in places:
    k = (p['ar'], p['gov'])
    if any(km(p, q) < 4 for q in seen[k]): continue
    seen[k].append(p); out.append(p)

# district fallback: if place has no district, nearest district seat
for p in out:
    if p['dist'] not in dists: p['dist'] = ''
    if p['gov'] not in govs: p['gov'] = ''
out = [p for p in out if p['gov']]
print('govs', len(govs), 'dists', len(dists), 'places', len(out), file=sys.stderr)
json.dump({'source': 'GeoNames (CC BY 4.0) — geonames.org', 'governorates': [govs[c] for c in GOV_ORDER if c in govs],
           'districts': sorted(dists.values(), key=lambda d: (d['gov'], d['ar'])),
           'places': [[p['id'], p['ar'], p['en'], p['lat'], p['lon'], p['gov'], p['dist'], p['rank']] for p in out]},
          open('data/places.json', 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))

# peaks layer
peaks = []
for r in rows:
    if r[7] in ('MT', 'PK') and r[0] in ar:
        ele = int(r[15] or r[16] or 0) if (r[15] or r[16]).lstrip('-').isdigit() else 0
        if ele >= 900:
            peaks.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [round(float(r[5]), 5), round(float(r[4]), 5)]},
                          'properties': {'ar': clean_ar(ar[r[0]]), 'en': r[1], 'ele': ele}})
peaks.sort(key=lambda f: -f['properties']['ele'])
json.dump({'type': 'FeatureCollection', 'features': peaks[:120]}, open('public/data/syria-peaks.geojson', 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))
print('peaks', len(peaks), file=sys.stderr)

# boundaries with Arabic names
ISO2CODE = {'SYR-DI': '13', 'SYR-RD': '08', 'SYR-HL': '09', 'SYR-HI': '11', 'SYR-HM': '10', 'SYR-LA': '02', 'SYR-TA': '14', 'SYR-ID': '12',
            'SYR-DR': '06', 'SYR-SU': '05', 'SYR-QU': '03', 'SYR-DY': '07', 'SYR-RA': '04', 'SYR-HA': '01'}
def rnd(c):
    if isinstance(c[0], (int, float)): return [round(c[0], 4), round(c[1], 4)]
    return [rnd(x) for x in c]
g = json.load(open(f'{SRC}/adm1.geojson'))
for f in g['features']:
    iso = f['properties']['shapeISO']; code = ISO2CODE.get(iso)
    gv = govs.get(code, {})
    f['properties'] = {'code': code, 'ar': gv.get('ar', f['properties']['shapeName']), 'en': gv.get('en', f['properties']['shapeName'])}
    f['geometry']['coordinates'] = rnd(f['geometry']['coordinates'])
json.dump(g, open('public/data/syria-governorates.geojson', 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))
g0 = json.load(open(f'{SRC}/adm0.geojson'))
for f in g0['features']:
    f['properties'] = {'name': 'Syria'}; f['geometry']['coordinates'] = rnd(f['geometry']['coordinates'])
json.dump(g0, open('public/data/syria-border.geojson', 'w', encoding='utf8'), separators=(',', ':'))
missing = [f['properties'] for f in g['features'] if not f['properties']['code']]
print('missing iso', missing, file=sys.stderr)
