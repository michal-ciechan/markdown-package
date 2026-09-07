"""Reuse CARD-0002's actual browser runner, timing and renderer-memory protocol."""
import argparse
import http.server
import json
from pathlib import Path
import sys
import threading
import subprocess

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'compression'))
import browser_benchmark as prior
from benchmark import save

WORK=HERE.parents[2]/'.antiphon/history-work'
prior.WORK=WORK

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--browser',choices=prior.BROWSERS,default='firefox')
    parser.add_argument('--repeats',type=int,default=3)
    parser.add_argument('--corpus',choices=['npm','rust'])
    parser.add_argument('--mode',choices=['directory','bundle'])
    args=parser.parse_args()
    fixtures=json.loads((WORK/'fixtures.json').read_text())
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),prior.Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    rows=[]
    failures=[]
    try:
        for fixture in fixtures:
            if args.corpus and fixture['corpus']!=args.corpus:continue
            for mode in ['directory','bundle']:
                if args.mode and mode!=args.mode:continue
                for target in range(len(fixture['targets'])):
                    for repeat in range(args.repeats):
                        cfg=dict(fixture=fixture,mode=mode,target=target)
                        for attempt in range(3):
                            try:
                                row=prior.run(args.browser,cfg,server.server_port)
                                break
                            except (RuntimeError,subprocess.TimeoutExpired) as error:
                                failures.append(dict(corpus=fixture['corpus'],mode=mode,target=target,
                                                     repeat=repeat,attempt=attempt,error=str(error)))
                                save(HERE/(args.browser+'-launch-failures.json'),failures)
                                print('launch-retry',str(error),flush=True)
                                # Limit cleanup to this harness's unique profile root.
                                for p in prior.psutil.process_iter():
                                    try:
                                        if p.name().lower() in ('chrome.exe','msedge.exe','firefox.exe') and any(str(WORK/'profiles') in a for a in p.cmdline()):
                                            for child in p.children(recursive=True):
                                                try:child.kill()
                                                except prior.psutil.NoSuchProcess:pass
                                            p.kill()
                                    except (prior.psutil.NoSuchProcess,prior.psutil.AccessDenied):pass
                                if attempt==2:raise
                        # The full fixture is already saved once in size-results.json.
                        row['config']=dict(corpus=fixture['corpus'],fixture_head=fixture['head'],mode=mode,target=target)
                        rows.append(row)
                        save(HERE/(args.browser+'-results.json'),rows)
                        assert 'error' not in row['result'],row['result']
                        print(fixture['corpus'],mode,target,repeat,
                              {k:v for k,v in row['result'].items() if k.endswith('Ms')},flush=True)
    finally:
        server.shutdown()
