#!/usr/bin/env python3
"""Build a compact Syria services dataset from OpenStreetMap via Overpass."""
import datetime
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ENDPOINTS = (
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
)
USER_AGENT = "RedAlertSyria/1.0"
OUTFILE = "/workspace/red-alert-syria/public/data/services.json"
CATEGORIES = ("hospital", "clinic", "pharmacy", "fuel", "bakery")
# Alternatives deliberately grouped into one Overpass query per category, limiting
# response size while preserving category-specific interpretation.
FILTERS = {
    "hospital": ('["amenity"="hospital"]', '["healthcare"="hospital"]'),
    "clinic": ('["amenity"="clinic"]',),
    "pharmacy": ('["amenity"="pharmacy"]', '["healthcare"="pharmacy"]'),
    "fuel": ('["amenity"="fuel"]',),
    "bakery": ('["shop"="bakery"]',),
}
ARABIC = re.compile(r"[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]")
LATIN = re.compile(r"[A-Za-z]")


TILE = None  # (s, w, n, e) set per request
TILES = [(32.3, 35.6, 34.4, 38.6), (32.3, 38.6, 34.4, 42.5), (34.4, 35.6, 37.4, 38.6), (34.4, 38.6, 37.4, 42.5)]
def query_for(category, kinds=("node", "way", "relation")):
    selectors = []
    bb = "({},{},{},{})".format(*TILE)
    for filt in FILTERS[category]:
        selectors.extend("{}{}{};".format(kind, filt, bb) for kind in kinds)
    return ('[out:json][timeout:180];('
            + "".join(selectors) + ");out center tags;")


def fetch_category(category, kinds=("node", "way", "relation")):
    body = urllib.parse.urlencode({"data": query_for(category, kinds)}).encode("utf-8")
    errors = []
    for endpoint in ENDPOINTS:
        req = urllib.request.Request(endpoint, data=body, headers={"User-Agent": USER_AGENT,
                                  "Content-Type": "application/x-www-form-urlencoded"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=300) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if "elements" not in payload:
                raise ValueError("Overpass response has no elements")
            return payload["elements"]
        except Exception as exc:
            errors.append("{}: {}".format(endpoint, exc))
            print("Overpass failure for {} at {}; trying next server: {}".format(category, endpoint, exc), file=sys.stderr)
    if len(kinds) > 1:
        # Large area responses can exceed server limits. Retry in smaller
        # element-type partitions, combining the returned elements locally.
        split = []
        for kind in kinds:
            split.extend(fetch_category(category, (kind,)))
        return split
    raise RuntimeError("All Overpass endpoints failed for {}: {}".format(category, "; ".join(errors)))


_BORDER = None
def in_syria(pos):
    """point-in-polygon against public/data/syria-border.geojson (lat, lon)"""
    global _BORDER
    if _BORDER is None:
        gj = json.load(open(os.path.join(os.path.dirname(OUTFILE), "syria-border.geojson")))
        polys = []
        for f in gj.get("features", [gj]):
            g = f.get("geometry", f)
            if g["type"] == "Polygon":
                polys.append(g["coordinates"])
            elif g["type"] == "MultiPolygon":
                polys.extend(g["coordinates"])
        _BORDER = polys
    lat, lon = pos
    for poly in _BORDER:
        ring = poly[0]
        inside = False
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i][0], ring[i][1]
            xj, yj = ring[j][0], ring[j][1]
            if ((yi > lat) != (yj > lat)) and (lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi):
                inside = not inside
            j = i
        if inside:
            return True
    return False
def coordinates(element):
    if "lat" in element and "lon" in element:
        return float(element["lat"]), float(element["lon"])
    center = element.get("center") or {}
    if "lat" in center and "lon" in center:
        return float(center["lat"]), float(center["lon"])
    return None


def names(tags):
    raw = tags.get("name", "")
    ar = tags.get("name:ar", "")
    en = tags.get("name:en", "")
    if not ar and ARABIC.search(raw):
        ar = raw
    if not en and LATIN.search(raw):
        en = raw
    return ar, en


def distance_m(a, b):
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371000 * 2 * math.asin(min(1.0, math.sqrt(h)))


def main():
    rows = []
    # Category-at-a-time downloads keep queries manageable and allow a failed
    # server to be retried against each alternate endpoint.
    for cat_index, category in enumerate(CATEGORIES):
        cache = "/tmp/svc_cache_{}.json".format(category)
        if os.path.exists(cache):
            elements = json.load(open(cache))
        else:
            global TILE
            elements = []
            for ti, tile in enumerate(TILES):
                tcache = "/tmp/svc_cache_{}_{}.json".format(category, ti)
                if os.path.exists(tcache):
                    part = json.load(open(tcache))
                else:
                    TILE = tile
                    part = fetch_category(category)
                    json.dump(part, open(tcache, "w"))
                elements.extend(part)
                time.sleep(1)
            elements = [e for e in elements if coordinates(e) and in_syria(coordinates(e))]
            json.dump(elements, open(cache, "w"))
        candidates = []
        for element in elements:
            pos = coordinates(element)
            if pos is None:
                continue
            tags = element.get("tags") or {}
            ar, en = names(tags)
            phone = tags.get("phone") or tags.get("contact:phone") or ""
            hours = tags.get("opening_hours") or ""
            candidates.append((cat_index, round(pos[0], 5), round(pos[1], 5), ar, en, phone, hours))
        # Merge exact duplicate result elements and nearby duplicate POIs only
        # when category and displayed names are identical.
        prior = [row for row in rows if row[0] == cat_index]
        for candidate in candidates:
            signature = (candidate[3], candidate[4])
            duplicate = False
            for old in prior:
                if (old[3], old[4]) == signature and distance_m((candidate[1], candidate[2]), (old[1], old[2])) <= 30:
                    # Preserve optional details if the duplicate contains them.
                    if len(old) < 7 and (candidate[5] or candidate[6]):
                        replacement = list(old)
                        replacement.extend([""] * (5 - len(replacement)))
                        replacement.extend([candidate[5], candidate[6]])
                        rows[rows.index(old)] = replacement
                    elif len(old) >= 7:
                        if not old[5] and candidate[5]: old[5] = candidate[5]
                        if not old[6] and candidate[6]: old[6] = candidate[6]
                    duplicate = True
                    break
            if duplicate:
                continue
            row = [candidate[0], candidate[1], candidate[2], candidate[3], candidate[4]]
            if candidate[5] or candidate[6]:
                row.extend([candidate[5], candidate[6]])
            rows.append(row)
            prior.append(row)
        print("{}: {}".format(category, sum(row[0] == cat_index for row in rows)))
        # Small courtesy pause between public API requests.
        if category != CATEGORIES[-1]:
            time.sleep(1)

    os.makedirs(os.path.dirname(OUTFILE), exist_ok=True)
    document = {"v": 1, "generated": datetime.date.today().isoformat(),
                "src": "© OpenStreetMap contributors (ODbL)", "cats": list(CATEGORIES), "items": rows}
    with open(OUTFILE, "w", encoding="utf-8", newline="") as stream:
        json.dump(document, stream, ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(OUTFILE)
    print("file: {} bytes ({:.2f} KB)".format(size, size / 1024))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("ERROR: {}".format(exc), file=sys.stderr)
        sys.exit(1)
