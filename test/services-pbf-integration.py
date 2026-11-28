#!/usr/bin/env python3
"""Executed local integration fixtures; optional pyosmium dev dependency, never app runtime."""
import unittest, tempfile, pathlib, subprocess, sys, json, importlib.util
ROOT=pathlib.Path(__file__).resolve().parents[1]
@unittest.skipUnless(importlib.util.find_spec('osmium'), 'local pyosmium needed for PBF integration')
class Integration(unittest.TestCase):
 def test_geometry_contacts_conflicts_and_border(self):
  import osmium
  with tempfile.TemporaryDirectory() as temp:
   t=pathlib.Path(temp);h=osmium.io.Header();h.set('osmosis_replication_timestamp','2026-11-27T21:21:21Z')
   w=osmium.SimpleWriter(str(t/'fixture.osm.pbf'),header=h)
   def node(i,lat,lon,tags={}):w.add_node(osmium.osm.mutable.Node(id=i,location=(lon,lat),tags=tags))
   node(1,33.5,36.3,{'amenity':'pharmacy','name':'duplicate','phone':'+963 11 1234567','opening_hours':'08:00-16:00'})
   node(2,33.50001,36.30001,{'amenity':'pharmacy','name':'duplicate','phone':'+963 11 7654321','opening_hours':'09:00-17:00'})
   node(3,33.51,36.31,{'amenity':'hospital','phone':'+352 681 503 260'})
   node(4,48,2,{'amenity':'hospital','name':'outside'})
   for i,lat,lon in [(10,33.52,36.32),(11,33.52,36.321),(12,33.521,36.321),(13,33.521,36.32)]:node(i,lat,lon)
   w.add_way(osmium.osm.mutable.Way(id=20,nodes=[10,11,12,13,10],tags={'building':'yes'}))
   w.add_relation(osmium.osm.mutable.Relation(id=30,members=[('w',20,'outer')],tags={'type':'multipolygon','amenity':'hospital','name':'multipolygon'}));w.close()
   cmd=[sys.executable,str(ROOT/'scripts/services-from-pbf.py'),'--input',str(t/'fixture.osm.pbf'),'--source-url','https://example.test/fixture','--output',str(t/'out.json'),'--audit',str(t/'audit.json')]
   r=subprocess.run(cmd,capture_output=True,text=True);self.assertEqual(r.returncode,0,r.stderr)
   out=json.loads((t/'out.json').read_text());audit=json.loads((t/'audit.json').read_text())
   self.assertEqual(len(out['items']),3);self.assertEqual(audit['counts']['outside'],1);self.assertEqual(audit['counts']['relations'],1)
   mp=next(x for x in out['items'] if 'multipolygon' in x[3:5]);self.assertAlmostEqual(mp[1],33.5205);self.assertAlmostEqual(mp[2],36.3205)
   dup=next(x for x in out['items'] if 'duplicate' in x[3:5]);self.assertEqual(dup[5:7],['',''])
   self.assertEqual(sum(a['reason']=='nonempty-merged-conflict' for a in audit['contact_audit']),2)
   self.assertTrue(any(a.get('source_value')=='+352 681 503 260' and a['action']=='omitted' for a in audit['contact_audit']))
   self.assertEqual(out['generated'],'2026-11-27');self.assertNotEqual(out['built_at'],out['source_as_of'])
   # A file without replication timestamp must fail before emitting a candidate.
   ww=osmium.SimpleWriter(str(t/'undated.osm.pbf'));ww.close();cmd[cmd.index('--input')+1]=str(t/'undated.osm.pbf');r=subprocess.run(cmd,capture_output=True,text=True);self.assertNotEqual(r.returncode,0);self.assertIn('timestamp required',r.stderr)
if __name__=='__main__':unittest.main()
