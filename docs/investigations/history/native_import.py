"""Native bundle-import timing, run after browser suites to avoid contention."""
import importlib.util
import json
from pathlib import Path
import statistics
import time
import uuid

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('history_benchmark',HERE/'benchmark.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)

if __name__=='__main__':
    rows=[]
    for name in ('npm','rust'):
        bundle=h.WORK/name/'32/history.bundle'
        samples=[]
        for _ in range(3):
            dest=h.WORK/'native-import'/str(uuid.uuid4())
            dest.parent.mkdir(parents=True,exist_ok=True)
            start=time.perf_counter()
            h.git(h.WORK,'clone','--bare',str(bundle),str(dest))
            samples.append((time.perf_counter()-start)*1000)
            # Verification excluded from import time.
            h.git(dest,'fsck','--full','--strict')
            assert h.git(dest,'rev-list','--count','main').strip()==b'33'
        rows.append(dict(corpus=name,operation='git clone --bare extracted-bundle new-directory',
                         samples_ms=samples,median_ms=statistics.median(samples),checked_imports=3))
    h.save('native-import-results.json',rows)
    print(json.dumps(rows,indent=2))
