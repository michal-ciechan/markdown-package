"""Run real installed browsers in task-owned headless profiles. Windows only.

Memory is Windows process working-set high water, including native allocations.
It is not performance.memory (which would miss decoder memory).
"""
import argparse
import functools
import http.server
import json
import shutil
import subprocess
import threading
import time
import uuid
import zlib
from pathlib import Path

import psutil
from benchmark import WORK,OUT,save

BROWSERS={
    'chrome':r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'edge':r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'firefox':r'C:\Program Files\Mozilla Firefox\firefox.exe',
}
STATE={}


def memory():
    root=psutil.Process(STATE['pid'])
    rows=[]
    for p in [root]+root.children(recursive=True):
        try:
            m=p.memory_info()
            command=' '.join(p.cmdline())
            content='--type=renderer' in command or '-contentproc' in command
            cpu=p.cpu_times()
            rows.append(dict(pid=p.pid,rss=m.rss,peak=m.peak_wset,content=content,cpu=cpu.user+cpu.system))
        except (psutil.NoSuchProcess,psutil.AccessDenied): pass
    return rows


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(WORK),**kwargs)
    def log_message(self,*args): pass
    def do_GET(self):
        if self.path=='/config':
            data=json.dumps(STATE['config']).encode()
        elif self.path=='/':
            data=b'<!doctype html><meta charset="utf-8"><title>Compression measurement</title><script type="module" src="/browser.js"></script>'
        else: return super().do_GET()
        self.send_response(200); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_POST(self):
        body=self.rfile.read(int(self.headers.get('Content-Length',0)))
        if self.path=='/identify-start':
            STATE['identity_before']=memory()
        elif self.path=='/identify-end':
            STATE['identity_after']=memory()
            prior={p['pid']:p['cpu'] for p in STATE['identity_before'] if p['content']}
            deltas=sorted([(p['cpu']-prior[p['pid']],p['pid']) for p in STATE['identity_after'] if p['pid'] in prior],reverse=True)
            STATE['identity_deltas']=deltas
            STATE['content_pid']=deltas[0][1]
        elif self.path in ['/ready','/first']:
            STATE[self.path[1:]]=memory()
        elif self.path=='/done':
            STATE['result']=json.loads(body)
            STATE['done'].set()
        self.send_response(200); self.end_headers(); self.wfile.write(b'{}')


def run(browser,config,port):
    profile=WORK/'profiles'/str(uuid.uuid4())
    profile.mkdir(parents=True)
    STATE.clear(); STATE.update(config=config,done=threading.Event())
    url=f'http://127.0.0.1:{port}/'
    if browser=='firefox':
        cmd=[BROWSERS[browser],'-headless','-no-remote','-profile',str(profile),url]
    else:
        cmd=[BROWSERS[browser],'--headless=new',f'--user-data-dir={profile}',
             '--no-first-run','--no-default-browser-check','--disable-extensions',url]
    with (profile/'stderr.log').open('wb') as log:
        process=subprocess.Popen(cmd,stdout=log,stderr=log)
        STATE['pid']=process.pid
        try:
            if not STATE['done'].wait(55): raise RuntimeError('Browser timed out: '+str(profile))
            result=dict(browser=browser,config=config,result=STATE['result'])
            if 'content_pid' in STATE:
                result['content_pid']=STATE['content_pid']
                result['identity_deltas']=STATE['identity_deltas']
            if 'first' in STATE:
                result['memory_before']=STATE['ready']; result['memory_first']=STATE['first']
            return result
        finally:
            try: children=psutil.Process(process.pid).children(recursive=True)
            except psutil.NoSuchProcess: children=[]
            for child in children:
                try: child.kill()
                except psutil.NoSuchProcess: pass
            if process.poll() is None: process.terminate()
            process.wait(timeout=10)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--probe',action='store_true')
    parser.add_argument('--browser',default='chrome',choices=BROWSERS)
    parser.add_argument('--repeats',type=int,default=3)
    args=parser.parse_args()
    shutil.copyfile(OUT/'browser.js',WORK/'browser.js')
    d=zlib.compressobj(zdict=b'hello world')
    (WORK/'fdict.bin').write_bytes(d.compress(b'hello world')+d.flush())
    fixtures=json.loads((WORK/'fixtures/index.json').read_text())
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    results=[]
    if args.probe:
        probes={('deflate-raw' if f['codec'].startswith('raw') else f['codec'].split('-')[0]):f['file']
                for f in fixtures if f['corpus']=='npm' and f['mode']=='entry'}
        f=next(f for f in fixtures if f['corpus']=='npm' and f['mode']=='entry')
        for browser in BROWSERS:
            results.append(run(browser,dict(probe=True,probes=probes,size=f['target_bytes'],sha=f['target_sha256']),server.server_port))
            save(OUT/'browser-support-probes.json',results)
            print(json.dumps(results[-1]),flush=True)
        save(OUT/'browser-support-probes.json',results)
    else:
        cases=[]
        for f in fixtures:
            if f['corpus']!='rust':continue
            kind=f['codec'].split('-')[0]
            if kind in ['gzip','deflate','raw','brotli']:
                for stream in ([False,True] if f['mode']=='whole' else [False]):
                    cases.append(dict(fixture=f,engine='native',stream=stream))
            if kind in ['brotli','zstd']:
                cases.append(dict(fixture=f,engine=kind+'-wasm',stream=False))
            if kind=='gzip' and f['mode']=='entry':
                cases.append(dict(fixture=f,engine='fflate',stream=False))
        # Firefox gets gzip + Brotli native cases; Chrome gets all fallbacks.
        if args.browser=='firefox':
            cases=[c for c in cases if c['engine']=='native' and c['fixture']['codec'] in ['gzip-6','brotli-5']]
        for cfg in cases:
            samples=[]
            for _ in range(args.repeats):
                for attempt in range(3):
                    try:
                        samples.append(run(args.browser,cfg,server.server_port));break
                    except RuntimeError as e:
                        print('launch-retry',attempt+1,str(e),flush=True)
                        if attempt==2:raise
            results.extend(samples)
            save(OUT/f'{args.browser}-decode-results.json',results)
            print(args.browser,cfg['engine'],cfg['fixture']['codec'],cfg['fixture']['mode'],cfg['stream'],
                  [s['result'].get('medianMs',s['result']) for s in samples],flush=True)
    server.shutdown()
