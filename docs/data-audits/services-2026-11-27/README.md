# Nearby directory snapshot

Staged from https://download.geofabrik.de/asia/syria/syria-latest.osm.pbf . Header source replication time: 2026-11-27T21:21:21Z. The source date, not the build date, is displayed. Input and exact converter hashes are in conversion.json. The original 83 MB input is not included in this repository; a later latest download may differ.

3900 rows in the same five categories. This is an OSM directory snapshot, not verified operating status, opening hours or contact ownership. Eighteen questionable phone fields are omitted pending verification, including foreign codes, ambiguous local numbers and short numbers. A foreign code alone does not prove a number is false. Raw values and object IDs remain in conversion.json. One conflicting opening-hours pair is omitted. Retained calls use normalized numbers, not inferred replacements. Equivalent domestic/international formatting is treated as agreement.

The comparison records all 38 old rows without exact bilingual-name/category matches within 100 m, not 38 proven deletions. Thirty-five have nearby same-category records, mostly renamed or with an added translation. Idlib University's old clinic is now tagged hospital in the source. Safita bakery retains its hours under corrected English spelling. A pharmacy's matching name is 736 m away in the newer source. No current hospital tag near the old Harasta hospital is not proof the facility closed; no old guessed geometry was reintroduced.

Every regeneration must run these release checks, not only npm test:

```
python -m pip install osmium
python test/services-pbf-integration.py
node --test test/services-pbf-staging.test.js
python scripts/services-from-pbf.py --input SOURCE.osm.pbf --source-url SOURCE_URL --output STAGED.json --audit AUDIT.json
npm test
npm run build
```

The Python test requires local pyosmium and must actually execute, not skip, before a data release. It checks real PBF geometry, a multipolygon, outside-border exclusion, duplicate phone/hours conflicts, an anomalous number and missing source time. There is no new server dependency. Review counts, unmatched prior rows, contact omissions, source timestamp/hash, exact converter hash, and actual mobile UI before replacing data. Never carry forward old contacts based on fuzzy name matches.

Data: © OpenStreetMap contributors, ODbL 1.0. https://www.openstreetmap.org/copyright and https://opendatacommons.org/licenses/odbl/1-0/ . Derived compact data and filtering/format modifications are supplied in this repository. Geofabrik usage: https://www.geofabrik.de/data/download.html . Existing map attribution is unchanged.
