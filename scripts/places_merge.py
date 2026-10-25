"""Second stage of build-places.py: complete the GeoNames list with the official OCHA list of
Syrian communities (COD-AB, ~7,600 towns/villages + 414 city neighbourhoods, Arabic + English
names, admin codes) and OpenStreetMap populated places (HOT export), and attach every place to its
sub-district (ناحية) so the bots can show governorate -> district -> sub-district -> town.

Existing GeoNames ids are kept (alerts store them); new places get ids above 20,000,000:
  20,000,000 + OCHA community number (C1234 -> 20001234), 21,000,000 + neighbourhood number,
  30,000,000,000 + OSM node/way id (way: +40,000,000,000).
"""
import json, math, re, collections, difflib, sys
from shapely.geometry import shape, Point
from shapely.prepared import prep

AR = re.compile('[\u0600-\u06FF]')


def norm(s):
    s = re.sub('[\u064B-\u065F\u0670\u0640]', '', s or '')
    s = re.sub('[إأآٱ]', 'ا', s).replace('ى', 'ي').replace('ة', 'ه').replace('ؤ', 'و').replace('ئ', 'ي')
    s = re.sub(r'[^\w\s]|_|\d', ' ', s)
    return ' '.join(w[2:] if w.startswith('ال') and len(w) > 3 else w for w in s.split())


INVIS = re.compile('[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]')


def clean(s):
    s = re.sub(r'\s+', ' ', INVIS.sub('', s or '').replace('_', ' - ')).strip(' -')
    return s


def unglue(s):
    """OCHA sometimes drops the space before an article: الحمراالشرقية -> الحمرا الشرقية, بصرالحرير stays for the alias pass"""
    return ' '.join(re.sub(r'^(\S{2,}?[اى])(ال\S{3,})$', r'\1 \2', w) if len(w) >= 8 else w for w in s.split(' '))


QUAL = {}
for k, ws in {'E': 'شرقي شرقيه شرق', 'W': 'غربي غربيه غرب', 'N': 'شمالي شماليه شمال', 'S': 'جنوبي جنوبيه جنوب قبلي قبليه',
              'B': 'كبير كبيره كبري', 's': 'صغير صغيره صغري', 'U': 'فوقاني فوقانيه عليا عليه فوقا', 'D': 'تحتاني تحتانيه سفلي تحتا',
              'n': 'جديد جديده', 'o': 'قديم قديمه عتيق', '1': 'اول اولي واحد', '2': 'ثاني ثانيه', '3': 'ثالث ثالثه', '4': 'رابع رابعه',
              'm': 'وسطاني وسطانيه وسطي اوسط'}.items():
    for w in ws.split(): QUAL[w] = k


def quals(a): return {QUAL[w] for w in a.split() if w in QUAL}


def similar(a, b):
    """'strong' = same place name (spelling variant), 'prefix' = one is the other plus extra words, else None"""
    if not a or not b: return None
    if quals(a) != quals(b): return None  # شرقي / غربي, كبير / صغير ... are different villages
    a1, b1 = a.replace(' ', ''), b.replace(' ', '')
    if a1 == b1 or a1.replace('ال', '') == b1.replace('ال', ''): return 'strong'  # مغرالمير = مغر المير
    wa, wb = a.split(), b.split()
    if abs(len(wa) - len(wb)) <= 1 and difflib.SequenceMatcher(None, a1, b1).ratio() >= (0.8 if min(len(a1), len(b1)) >= 7 else 0.86):
        if len(wa) == len(wb) or min(len(a1), len(b1)) >= 6: return 'strong'
    if len(wa) != len(wb):
        sh, lo = (wa, wb) if len(wa) < len(wb) else (wb, wa)
        if lo[:len(sh)] == sh and (len(sh) > 1 or len(sh[0]) >= 4): return 'prefix'
    return None


def km(lat1, lon1, lat2, lon2):
    R = 6371; dl = math.radians(lat2 - lat1); dn = math.radians(lon2 - lon1)
    x = math.sin(dl / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dn / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))


class Grid:
    def __init__(self, cell=0.05): self.c = cell; self.g = collections.defaultdict(list)
    def key(self, lat, lon): return (int(lat // self.c), int(lon // self.c))
    def add(self, p): self.g[self.key(p['lat'], p['lon'])].append(p)
    def near(self, lat, lon, r_km):
        k = self.key(lat, lon); n = int(r_km / (self.c * 85)) + 1
        for i in range(-n, n + 1):
            for j in range(-n, n + 1):
                for p in self.g.get((k[0] + i, k[1] + j), ()):
                    d = km(lat, lon, p['lat'], p['lon'])
                    if d <= r_km: yield d, p


def en_title(s):
    s = re.sub(r'\s+', ' ', INVIS.sub('', s or '').replace('_', ' - ')).strip(' -')
    return s


def merge(out, dists, govs, SRC, log=sys.stderr):
    """out: GeoNames places (dicts id, ar, en, lat, lon, gov, dist, rank, pop). Returns (places, subdistricts)."""
    a2 = json.load(open(f'{SRC}/cod/syr_admin2.geojson'))['features']
    a3 = json.load(open(f'{SRC}/cod/syr_admin3.geojson'))['features']
    a2p = [(f['properties'], prep(shape(f['geometry'])), shape(f['geometry'])) for f in a2]
    a3p = [(f['properties'], prep(shape(f['geometry'])), shape(f['geometry'])) for f in a3]

    def find(polys, lat, lon, tol=0.03):
        pt = Point(lon, lat)
        for pr, pp, p in polys:
            if pp.contains(pt): return pr
        best = min(polys, key=lambda t: t[2].distance(pt))
        return best[0] if best[2].distance(pt) < tol else None

    # OCHA district -> our district code (majority of GeoNames places inside it)
    votes = collections.defaultdict(collections.Counter)
    for p in out:
        pr = find(a2p, p['lat'], p['lon'], 0)
        if pr and p['dist']: votes[pr['adm2_pcode']][p['dist']] += 1
    a2map, used = {}, set()
    for pr, _, _ in a2p:  # same name first (القدموس vs بانياس share GeoNames' Banias district)
        c = pr['adm2_pcode']; n = norm(pr['adm2_name1'].replace('مركز ', ''))
        for code, n_ in votes[c].items():
            if code not in used and similar(norm(dists[code]['ar']), n): a2map[c] = code; used.add(code); break
    for c, v in sorted(votes.items(), key=lambda kv: -kv[1].most_common(1)[0][1]):
        if c in a2map: continue
        top = v.most_common(1)[0][0]
        if top in used: continue
        a2map[c] = top; used.add(top)
    gov_of_a1 = {}
    for c, d in a2map.items(): gov_of_a1[c[:4]] = dists[d]['gov']
    for pr, _, _ in a2p:  # OCHA districts without a GeoNames twin (e.g. القدموس in Tartus)
        c = pr['adm2_pcode']
        if c in a2map: continue
        code = '99' + c[2:]
        dists[code] = {'code': code, 'gov': gov_of_a1[c[:4]], 'ar': pr['adm2_name1'].replace('منطقة ', ''), 'en': pr['adm2_name']}
        a2map[c] = code
        print('new district', code, pr['adm2_name1'], file=log)

    subs = {}
    for pr, _, _ in a3p:
        code = pr['adm3_pcode'][2:]
        subs[code] = {'code': code, 'dist': a2map[pr['adm2_pcode']], 'gov': dists[a2map[pr['adm2_pcode']]]['gov'],
                      'ar': clean(pr['adm3_name1']), 'en': en_title(pr['adm3_name'])}

    def admin(p):
        """dist + sub from the OCHA polygons (falls back to the GeoNames district)"""
        pr = find(a3p, p['lat'], p['lon'])
        if not pr: return False
        p['sub'] = pr['adm3_pcode'][2:]
        p['dist'] = a2map[pr['adm2_pcode']]
        p['gov'] = dists[p['dist']]['gov']
        return True

    places = []
    grid = Grid()
    moved = 0
    for p in out:
        old = p['dist']
        p['alias'] = p.pop('alt', [])
        if not admin(p): continue  # outside Syria per OCHA border
        if old and old != p['dist']: moved += 1
        p['n'] = norm(p['ar'])
        places.append(p); grid.add(p)
    print('geonames kept', len(places), 'of', len(out), 'district changed', moved, file=log)

    stats = collections.Counter()
    renamed = []

    def best_match(lat, lon, names, r, kinds=('strong',)):
        best = None
        for d, q in grid.near(lat, lon, r):
            for i, qn in enumerate([q['n']] + [norm(x) for x in q['alias']]):
                k = next((k for n in names for k in [similar(n, qn)] if k in kinds), None)
                if k and i == 0 and qn != norm(names[0]) and d > r * 0.6 and qn.replace(' ', '') != names[0].replace(' ', ''):
                    continue  # far away + only similar: only an identical name counts beyond 60% of the radius
                if k and (best is None or (k == 'strong' and best[2] != 'strong') or (k == best[2] and (d, i > 0) < (best[0], not best[3]))):
                    best = (d, q, k, i == 0)  # last: matched on the displayed name (not an alias)
        return best

    def near_any(lat, lon, r):
        c = [(d, q) for d, q in grid.near(lat, lon, r) if q['rank'] >= 4]
        return min(c, key=lambda t: t[0]) if c else None

    def add_alias(q, a):
        if a and a != q['ar'] and a not in q['alias'] and AR.search(a): q['alias'].append(a)

    def absorb(q, it, d, rename):
        # GeoNames itself lists the OCHA name as another name of this place (قبر الست = السيدة زينب)
        known = it['src'] == 'ocha' and norm(it['ar']) in {norm(a) for a in q['alias']}
        add_alias(q, it['ar'])
        for a in it['alts']: add_alias(q, a)
        full = norm(it['ar']).startswith(q['n'] + ' ') and known  # بصرى -> بصرى الشام
        if (rename or known) and (q['rank'] >= 4 or (q['rank'] >= 2 and known)) and not q.get('ocha') and q['ar'] != it['ar'] and better(q, it['ar']):
            renamed.append((q['id'], q['ar'], it['ar'], round(d, 2)))
            if q['ar'] not in q['alias']: q['alias'].insert(0, q['ar'])
            if it['ar'] in q['alias']: q['alias'].remove(it['ar'])
            new = it['ar']
            # OCHA glues words now and then (بصرالحرير): take the spaced spelling when one is known
            kk = lambda x: norm(x.replace(' ', '')).replace('ال', '')
            sp = next((a for a in q['alias'] + it['alts'] if ' ' in a and kk(a) == kk(new)), None)
            if sp and new.count(' ') < sp.count(' '): new = sp
            # an official new name (كبلية -> ربيعة): keep the old one visible too, the button is what people look for
            lo = lambda x: re.sub(r'[اهي]$', 'ه', x.replace(' ', ''))
            close = lo(norm(new)) == lo(q['n']) or difflib.SequenceMatcher(None, lo(norm(new)), lo(q['n'])).ratio() >= 0.7
            if not close and not norm(new).startswith(q['n'] + ' ') and len(new) + len(q['ar']) + 3 <= 28:
                new = f"{new} ({q['ar']})"
            q['ar'] = new; q['n'] = norm(it['ar'])
            if it['en'] and q['rank'] >= 3: q['en'] = it['en']
        if it['src'] == 'osm' and it['rank'] <= 4 and q['rank'] > it['rank'] and q['rank'] >= 4: q['rank'] = it['rank']  # OSM town/city
        if it['src'] == 'ocha': q['ocha'] = True
        if not q['en'] and it['en']: q['en'] = it['en']

    def better(q, new):
        """is the OCHA spelling an improvement over the GeoNames one?"""
        old = q['ar']
        if re.search(r' - |/', new): return False  # "الطيبة - كترين": keep the single name, both stay searchable
        if norm(new.replace(' ', '')).replace('ال', '') == norm(old.replace(' ', '')).replace('ال', '') and new.count(' ') < old.count(' '): return False  # بصرى الحرير, not بصرالحرير
        if norm(new) == norm(old):  # same letters: only take the one with the article / hamza
            al = lambda s: sum(w.startswith('ال') for w in s.split())
            hz = lambda s: len(re.findall('[أإآؤئ]', s))
            return al(new) > al(old) or (al(new) == al(old) and hz(new) > hz(old))
        if len(norm(new).split()) > len(norm(old).split()):  # "بصرى" -> "بصرى الشام" only when GeoNames knows that name too
            return norm(new) in {norm(a) for a in q['alias']}
        return True  # a real spelling difference: the official OCHA list wins

    def add_new(it):
        p = dict(id=it['id'], ar=it['ar'], en=it['en'] or it['ar'], lat=round(it['lat'], 5), lon=round(it['lon'], 5),
                 rank=it['rank'], pop=0, alias=[a for a in dict.fromkeys(it['alts']) if a != it['ar']], ocha=it['src'] == 'ocha')
        if not admin(p): stats[it['src'] + ' outside'] += 1; return
        p['n'] = norm(p['ar'])
        places.append(p); grid.add(p)
        stats[it['src'] + ' added'] += 1

    # admin names used by OCHA as disambiguators: "تل شعير اعزاز", "الجباب - الشيخ بدر", "قويقة / القرداحة"
    ADM = {norm(x['ar'].replace('مركز ', '')) for x in list(dists.values()) + list(govs.values()) + list(subs.values())}
    ADM |= {norm(f['properties']['adm3_name1'].replace('مركز ', '')) for f in a3}
    ADM |= {x[:-1] + {'ا': 'ه', 'ه': 'ا'}[x[-1]] for x in list(ADM) if x and x[-1] in 'اه'}

    GENERIC = {norm(x) for x in 'تل قصر خربة عين بئر بير جب رسم كفر دير أم ام أبو ابو شيخ الشيخ قرية مزرعة المزرعة حي جسر بيت تلة قلعة سد نبع وادي'.split()}

    def core(ar):
        parts = [clean(x) for x in re.split(r'\s*[_/]\s*|\s+-\s+|-', ar) if clean(x)]
        keep = [x for x in parts if norm(x) not in ADM] or parts[:1]
        if len(keep) == 1:
            w = keep[0].split()
            while len(w) > 1:
                for n in (1, 2, 3):
                    rest = w[:-n]
                    ok = len(rest) >= 2 or (len(rest) == 1 and len(norm(rest[0])) >= 4 and norm(rest[0]) not in GENERIC)
                    if len(w) > n and ok and norm(' '.join(w[-n:])) in ADM: w = rest; break
                else: break
            keep = [' '.join(w)]
        return ' - '.join(keep)

    # ---- 1. OCHA communities + neighbourhoods
    cod = json.load(open(f'{SRC}/cod/syr_populatedplaces.geojson'))['features']
    nb = json.load(open(f'{SRC}/cod/syr_neighborhoods.geojson'))['features']
    ocha = []
    for f in cod:
        pr = f['properties']
        if pr['popplaceclasstitle'] == 'Neighborhood': continue
        full = unglue(clean(pr['adm4_ar'] or pr['featurename_ar']))
        if not AR.search(full): continue
        ar = core(full)
        alts = [clean(x) for x in [pr['featurealtname1_ar'], pr['featurealtname2_ar'], full] if x]
        alts += [clean(x) for x in re.split(r'\s*[_/]\s*|\s+-\s+', full) if clean(x) and norm(clean(x)) not in ADM]
        ocha.append(dict(id=20000000 + int(re.sub(r'\D', '', pr['pcode'])), ar=ar, en=en_title(pr['adm4_en']),
                         lat=float(pr['point_y']), lon=float(pr['point_x']), rank=5, alts=[a for a in dict.fromkeys(alts) if a != ar], src='ocha'))
    # pass 1: spelling variants of a GeoNames place -> one button with the official OCHA spelling
    pending = []
    for it in ocha:
        names = [n for n in [norm(it['ar'])] + [norm(a) for a in it['alts']] if n]
        m = best_match(it['lat'], it['lon'], names, 5.0, ('strong', 'prefix'))
        if m and m[2] == 'strong': stats['ocha matched'] += 1; absorb(m[1], it, m[0], m[3] or norm(it['ar']).startswith(m[1]['n'] + ' '))
        else: pending.append((it, m))
    # pass 2: "بصرى" (GeoNames) vs "بصرى الشام" (OCHA): take the full name when it is the only candidate
    groups = collections.defaultdict(list)
    for it, m in pending:
        if m and not m[1].get('ocha'): groups[m[1]['id']].append((it, m))
    for it, m in pending:
        if m and not m[1].get('ocha') and len(groups[m[1]['id']]) == 1 and len(norm(it['ar']).split()) > len(m[1]['n'].split()):
            stats['ocha full name'] += 1; absorb(m[1], it, m[0], m[3])
        else: add_new(it)
    for f in nb:
        pr = f['properties']
        ar = clean(pr['neighborhoodname_ar'])
        if not AR.search(ar): continue
        c = shape(f['geometry']).representative_point()
        it = dict(id=21000000 + int(re.sub(r'\D', '', pr['neighborhoodpcode'])), ar=ar, en=en_title(pr['neighborhoodname_en']),
                  lat=c.y, lon=c.x, rank=7, alts=[clean(x) for x in [pr['neighborhoodaltname1_ar'], pr['neighborhoodaltname2_ar']] if x], src='ocha-nb')
        m = best_match(it['lat'], it['lon'], [norm(ar)] + [norm(a) for a in it['alts']], 2.0)
        if m: stats['ocha-nb matched'] += 1; absorb(m[1], it, m[0], False)
        else: add_new(it)

    # ---- 2. OpenStreetMap populated places (towns, villages, hamlets, suburbs) with an Arabic name
    osm = json.load(open(f'{SRC}/osm/populated_places.geojson'))['features']
    ORANK = {'city': 2, 'town': 4, 'village': 5, 'suburb': 7, 'neighbourhood': 7, 'hamlet': 6}
    for f in osm:
        pr = f['properties']
        if pr.get('place') not in ORANK: continue
        ar = clean(pr.get('name_ar') or (pr.get('name') if AR.search(pr.get('name') or '') else ''))
        if not ar or not AR.search(ar) or re.search('[A-Za-z]', ar): continue
        g = shape(f['geometry']); c = g if g.geom_type == 'Point' else g.representative_point()
        typ, num = pr['id'].split('/')
        it = dict(id=(30 if typ == 'node' else 40) * 1000000000 + int(num), ar=ar, en=en_title(pr.get('name_en') or pr.get('name_latin') or ''),
                  lat=c.y, lon=c.x, rank=ORANK[pr['place']], alts=[], src='osm')
        m = best_match(c.y, c.x, [norm(ar)], 5.0)
        if m: stats['osm matched'] += 1; absorb(m[1], it, m[0], False); continue
        # a differently written name on (almost) the same spot is the same village
        nq = near_any(c.y, c.x, 0.5 if it['rank'] <= 6 else 0.25)
        if nq: stats['osm near'] += 1; absorb(nq[1], it, nq[0], False); continue
        add_new(it)
    OVR = {20001062: ('الحانوتة (تل حواصيد)', 'Al-Hanuta (Tal Hawasid)')}
    for p in places:
        if p['id'] in OVR:
            a, e = OVR[p['id']]
            if p['ar'] not in p['alias']: p['alias'].append(p['ar'])
            p['ar'], p['en'] = a, e
    print(dict(stats), file=log)
    print('renamed', len(renamed), file=log)
    kk = lambda x: norm(x.replace(' ', '')).replace('ال', '')
    for p in places:
        p['ar'] = clean(p['ar']); p['en'] = en_title(p['en'])
        # glued words in a source (بصرالحرير, الحمراالشرقية): a spaced spelling of the same letters wins
        sp = next((a for a in p['alias'] if a.count(' ') > p['ar'].count(' ') and kk(a) == kk(p['ar'])), None)
        if sp: p['alias'].append(p['ar']); p['ar'] = sp
        elif re.search(r'(?<=\S[^\sل])ال(?=\S{3})', p['ar']) and p.get('ocha'):
            fixed = re.sub(r'^(\S{2,}?[اى])(ال\S{3,})$', r'\1 \2', p['ar'])  # الحمراالشرقية -> الحمرا الشرقية
            if fixed != p['ar']: p['alias'].append(p['ar']); p['ar'] = fixed
        p['alias'] = list(dict.fromkeys(clean(a) for a in p['alias'] if clean(a) != p['ar'] and AR.search(a)))[:6]
    json.dump(renamed, open('/tmp/renamed.json', 'w'), ensure_ascii=False, indent=0)
    for p in places: p.pop('n', None); p.pop('ocha', None)
    return places, subs, dists
