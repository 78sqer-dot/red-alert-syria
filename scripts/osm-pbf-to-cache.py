"""Turn the Geofabrik Syria .osm.pbf into Overpass-like element caches for scripts/build-services.py."""
import json, sys
import osmium

RULES = {
    "hospital": [("amenity", "hospital"), ("healthcare", "hospital")],
    "clinic": [("amenity", "clinic")],
    "pharmacy": [("amenity", "pharmacy"), ("healthcare", "pharmacy")],
    "fuel": [("amenity", "fuel")],
    "bakery": [("shop", "bakery")],
}
out = {k: [] for k in RULES}


def cats_of(tags):
    res = []
    for cat, rules in RULES.items():
        if any(tags.get(k) == v for k, v in rules):
            res.append(cat)
    return res


class H(osmium.SimpleHandler):
    def node(self, n):
        if not n.tags:
            return
        t = {t.k: t.v for t in n.tags}
        for c in cats_of(t):
            out[c].append({"type": "node", "id": n.id, "lat": n.location.lat, "lon": n.location.lon, "tags": t})

    def way(self, w):
        if not w.tags:
            return
        t = {t.k: t.v for t in w.tags}
        cs = cats_of(t)
        if not cs:
            return
        pts = [(nd.lat, nd.lon) for nd in w.nodes if nd.location.valid()]
        if not pts:
            return
        lat = sum(p[0] for p in pts) / len(pts)
        lon = sum(p[1] for p in pts) / len(pts)
        for c in cs:
            out[c].append({"type": "way", "id": w.id, "center": {"lat": lat, "lon": lon}, "tags": t})


H().apply_file(sys.argv[1], locations=True)
for c, els in out.items():
    json.dump(els, open("/tmp/svc_cache_{}_0.json".format(c), "w"))
    for i in (1, 2, 3):
        json.dump([], open("/tmp/svc_cache_{}_{}.json".format(c, i), "w"))
    print(c, len(els))
