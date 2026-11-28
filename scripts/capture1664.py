# Run on the account-connected command host. Uses only read-only browser calls.
# Copy resulting file through workspace put, then external.mjs answer FILE.
import json,subprocess,sys,time
lease=sys.argv[1];tab=sys.argv[2];path=sys.argv[3]
script=__import__('pathlib').Path(__file__).with_name('capture1664-fresh.js').read_text()
# Live UI read plus direct authenticated network retrieval; no cached message fallback.
subprocess.run(['tools','cloud_browser','read-page','--lease-id',lease,'--tab-id',tab],check=True,stdout=subprocess.PIPE,text=True)
r=subprocess.run(['tools','cloud_browser','execute-js','--lease-id',lease,'--tab-id',tab,'--script',script],check=True,stdout=subprocess.PIPE,text=True)
v=json.loads(r.stdout);assert v.get('message',{}).get('id')==1664
with open(path,'w') as f:json.dump(v,f)
print(json.dumps({'path':path,'checkedAt':v['checkedAt']}))
