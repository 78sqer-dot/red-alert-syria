import http.server,threading,json,time,pathlib,urllib.parse,subprocess,os
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[1]
fixture_js="""import fs from 'node:fs';import {publicAlert}from './server/store.js';const f=JSON.parse(fs.readFileSync('test/fixtures/context-1660.json'));const before=publicAlert(f.alert);const after=publicAlert({...f.alert,title:'تنبيه مدني — أم الكيف',title_en:'Civil alert — Um Elkeif',extra:[],areas:['أم الكيف','الحسكة']});console.log(JSON.stringify({before,after}));"""
fixtures=json.loads(subprocess.check_output(['node','--input-type=module','-e',fixture_js],cwd=root));before=fixtures['before'];after=fixtures['after'];change=threading.Event();writes=[]
out=pathlib.Path(os.environ.get('POPUP_EVIDENCE_DIR','/tmp/popup-sse-evidence'));out.mkdir(parents=True,exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(root),**kw)
 def log_message(self,*a):pass
 def do_POST(self):writes.append(self.path);self.send_error(403)
 def do_GET(self):
  path=urllib.parse.urlparse(self.path).path
  if path=='/api/stream':
   self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
   def event(t,v):self.wfile.write(('event: '+t+'\ndata: '+json.dumps(v)+'\n\n').encode());self.wfile.flush()
   event('snapshot',{'alerts':[before],'build':'local-popup-regression','history_hours':24});change.wait(50);event('update',after);time.sleep(5);return
  if path=='/api/meta':data=b'{}'
  elif path=='/api/alerts/'+before['id']:data=json.dumps({'alert':before}).encode()
  elif path in ['/ar/','/']:
   s=(root/'public/index.html').read_text()
   for k,v in {'LANG':'ar','DIR':'rtl','TITLE':'Local popup regression','URL':'','DESC':'Offline regression','BUILD':'local-popup-regression'}.items():s=s.replace('{{'+k+'}}',v)
   data=s.encode()
  else:
   self.path=('/shared'+path[7:] if path.startswith('/shared/') else '/public'+path);return super().do_GET()
  self.send_response(200);self.send_header('Content-Type','text/html' if path in ['/ar/','/'] else 'application/json');self.end_headers();self.wfile.write(data)
server=http.server.ThreadingHTTPServer(('127.0.0.1',18766),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']);page=b.new_page(viewport={'width':1440,'height':1000},device_scale_factor=1)
 page.route('**/*',lambda r:r.continue_() if r.request.url.startswith('http://127.0.0.1:18766') else r.abort())
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('http://127.0.0.1:18766/ar/#'+before['id']);page.wait_for_selector('.maplibregl-popup .pp-title',timeout=30000)
 page.get_by_text('المتابعة بدون تنبيهات',exact=True).click();page.locator('[data-tr=skip]').wait_for(state='visible',timeout=10000);page.locator('[data-tr=skip]').click();page.locator('#tour').wait_for(state='hidden');page.wait_for_timeout(500)
 old=page.locator('.maplibregl-popup .pp-title').inner_text();assert old==before['title'],old
 page.evaluate('window.__popupBefore=document.querySelector(".maplibregl-popup");window.__originBefore=performance.timeOrigin;window.__canvasBefore=document.querySelector(".maplibregl-canvas")');page.screenshot(path=str(out/'popup-sse-clean2-before.png'))
 change.set();page.wait_for_function('(title)=>document.querySelector(".maplibregl-popup .pp-title")?.textContent===title',arg=after['title'],timeout=15000)
 result=page.evaluate('({samePopup:window.__popupBefore===document.querySelector(".maplibregl-popup"),sameOrigin:window.__originBefore===performance.timeOrigin,sameCanvas:window.__canvasBefore===document.querySelector(".maplibregl-canvas"),title:document.querySelector(".maplibregl-popup .pp-title").textContent,areas:document.querySelector(".maplibregl-popup .pp-areas").textContent})');result.update(errors=errors,writes=writes)
 assert result['samePopup'] and result['sameOrigin'] and result['sameCanvas'];assert 'تل تمر' not in result['areas'];assert not errors;assert not writes
 page.wait_for_timeout(800);page.screenshot(path=str(out/'popup-sse-clean2-after.png'));open(out/'popup-sse-browser-result.json','w').write(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False));b.close()
server.shutdown()
