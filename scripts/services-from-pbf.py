#!/usr/bin/env python3
"""Offline-only OSM services staging. Requires pyosmium locally, never on the app server."""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import runpy
import re
import tempfile

ROOT = Path(__file__).resolve().parent.parent
BASE = runpy.run_path(str(ROOT / 'scripts/build-services.py'))
CATS = BASE['CATEGORIES']

def categories(tags):
    return [i for i, c in enumerate(CATS) if (
        (c == 'hospital' and (tags.get('amenity') == c or tags.get('healthcare') == c)) or
        (c == 'clinic' and tags.get('amenity') == c) or
        (c == 'pharmacy' and (tags.get('amenity') == c or tags.get('healthcare') == c)) or
        (c == 'fuel' and tags.get('amenity') == c) or
        (c == 'bakery' and tags.get('shop') == c))]

def source_date(value):
    if not value:
        raise ValueError('Source replication timestamp required; build time cannot replace it')
    stamp = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if stamp.tzinfo is None or stamp > dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5):
        raise ValueError('Source timestamp must be timezone-aware and not in the future')
    return stamp.date().isoformat()

def document(rows, replication, source_url):
    return {'v': 1, 'generated': source_date(replication), 'source_as_of': replication,
            'built_at': dt.datetime.now(dt.timezone.utc).isoformat(),
            'src': '© OpenStreetMap contributors (ODbL)', 'source_url': source_url,
            'license_url': 'https://opendatacommons.org/licenses/odbl/1-0/',
            'cats': list(CATS), 'items': rows}

def canonical_phone(value):
    value = re.sub(r'[\s()\-]', '', str(value))
    if value.startswith('00963'): return '+963' + value[5:]
    if value.startswith('0'): return '+963' + value[1:]
    return value

def safe_contact(value):
    """Keep plausible Syria numbers only; not a claim of facility ownership/availability."""
    value = str(value or '').strip()
    if not value: return '', None
    parts = re.split(r'[;,]', value)
    for part in parts:
        compact = re.sub(r'[\s()\-]', '', part)
        if not re.fullmatch(r'(?:\+963|00963|0)\d{7,10}', compact):
            return '', 'unverified-nonlocal-or-malformed-phone'
    return ";".join(canonical_phone(part) for part in parts), None

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--source-url', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--audit', required=True)
    args = parser.parse_args()
    import osmium
    reader = osmium.io.Reader(args.input)
    replication = reader.header().get('osmosis_replication_timestamp')
    reader.close()
    source_date(replication)  # refuse undated input before parsing
    rows, identities = [], set()
    contact_audit, row_ids, blocked = [], {}, {}
    counts = {'nodes': 0, 'ways': 0, 'relations': 0, 'outside': 0, 'invalid_geometry': 0, 'duplicate_objects': 0, 'near_duplicates': 0}
    def add(tags, pos, identity, kind):
        cats = categories(tags)
        if not cats: return
        if pos is None: counts['invalid_geometry'] += 1; return
        if not BASE['in_syria'](pos): counts['outside'] += 1; return
        ar, en = BASE['names'](tags)
        for cat in cats:
            key = (cat, identity)
            if key in identities: counts['duplicate_objects'] += 1; continue
            identities.add(key)
            row = [cat, round(pos[0], 5), round(pos[1], 5), ar, en]
            raw_phone = tags.get('phone') or tags.get('contact:phone') or ''
            phone, reason = safe_contact(raw_phone)
            if phone and phone != raw_phone: contact_audit.append({'object': identity, 'category': cat, 'field': 'phone', 'source_value': raw_phone, 'callable_value': phone, 'reason': 'format-normalized', 'action': 'normalized'})
            if reason: contact_audit.append({'object': identity, 'category': cat, 'field': 'phone', 'source_value': raw_phone, 'reason': reason, 'action': 'omitted'})
            hours = tags.get('opening_hours') or ''
            if phone or hours: row += [phone, hours]
            # Never merge unnamed neighbours: no name is not evidence of the same facility.
            old = next((x for x in rows if (ar or en) and x[0] == cat and x[3:5] == row[3:5] and BASE['distance_m'](x[1:3], row[1:3]) <= 30), None)
            if old is not None:
                counts['near_duplicates'] += 1
                key = id(old)
                for field, index, incoming in [('phone', 5, phone), ('opening_hours', 6, hours)]:
                    existing = old[index] if len(old) > index else ''
                    if field in blocked.get(key, set()):
                        if incoming: contact_audit.append({'object': identity, 'field': field, 'source_value': incoming, 'reason': 'existing-merged-conflict', 'action': 'omitted'})
                        if field == 'phone': phone = ''
                        else: hours = ''
                    elif existing and incoming and (canonical_phone(existing) != canonical_phone(incoming) if field == 'phone' else existing != incoming):
                        contact_audit.append({'objects': [row_ids.get(key), identity], 'field': field, 'source_values': [existing, incoming], 'reason': 'nonempty-merged-conflict', 'action': 'both-omitted'})
                        blocked.setdefault(key, set()).add(field)
                        old[index] = ''
                        if field == 'phone': phone = ''
                        else: hours = ''
                if phone or hours:
                    while len(old) < 7: old.append('')
                    if not old[5]: old[5] = phone
                    if not old[6]: old[6] = hours
                continue
            rows.append(row); row_ids[id(row)] = identity; counts[kind] += 1
    def center(points):
        points = list(points)
        if not points: return None
        return ((min(p[0] for p in points) + max(p[0] for p in points))/2,
                (min(p[1] for p in points) + max(p[1] for p in points))/2)
    class Handler(osmium.SimpleHandler):
        def node(self, n):
            if categories(dict(n.tags)):
                add(dict(n.tags), (n.location.lat, n.location.lon) if n.location.valid() else None, ('n', n.id), 'nodes')
        def way(self, w):
            tags = dict(w.tags)
            if categories(tags):
                pos = center((n.lat, n.lon) for n in w.nodes if n.location.valid())
                add(tags, pos, ('w', w.id), 'ways')
        def area(self, a):
            if a.from_way(): return  # ways handled once, including non-closed ways
            tags = dict(a.tags)
            if categories(tags):
                pos = center((n.lat, n.lon) for ring in a.outer_rings() for n in ring if n.location.valid())
                add(tags, pos, ('r', a.orig_id()), 'relations')
    with tempfile.TemporaryDirectory(prefix='ras-pbf-index-') as tmp:
        Handler().apply_file(args.input, locations=True, idx='sparse_file_array,' + str(Path(tmp)/'nodes.idx'), filters=[osmium.filter.KeyFilter('amenity', 'healthcare', 'shop')])
    rows.sort(key=lambda r: (r[0], r[1], r[2], r[3], r[4]))
    out = document(rows, replication, args.source_url)
    Path(args.output).write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    audit = {'source_as_of': replication, 'input_sha256': hashlib.sha256(Path(args.input).read_bytes()).hexdigest(),
             'contact_policy': 'Omit unverified non-Syria/malformed phones; omit both nonempty conflicting merged phone/hours, retain provenance here; retained source values not independently verified.', 'contact_audit': contact_audit,
             'converter_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
             'counts': counts, 'rows': len(rows), 'categories': {c: sum(r[0] == i for r in rows) for i,c in enumerate(CATS)},
             'limitations': ['All seven relevant relations in this source were independently audited as multipolygons and materialized; future non-multipolygon relations need explicit handling.', 'Bounding-box centres approximate Overpass centres, not entrances.', 'Snapshot is OSM data freshness, not live operating status.']}
    Path(args.audit).write_text(json.dumps(audit, indent=2)); print(json.dumps(audit))
if __name__ == '__main__': main()
