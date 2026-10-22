"""One-shot synthetic resource check. Never imports the app or accesses its storage."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('--module', required=True)
parser.add_argument('--worker', nargs=3, metavar=('DIRECTORY', 'NAME', 'WIDTH'))
args = parser.parse_args()

if args.worker:
    spec = importlib.util.spec_from_file_location('probe_thumbnails', args.module)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    start = time.monotonic()
    result = module.build_thumbnail(args.worker[0], args.worker[1], int(args.worker[2]))
    peak = None
    if Path('/proc/self/status').is_file():
        # Linux ru_maxrss can retain the launcher's pre-exec high-water mark.
        status = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
        peak = round(int(status['VmHWM'].split()[0]) / 1024, 1)
    elif os.name != 'nt':
        import resource
        peak = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1)
    dimensions = None
    if result:
        with Image.open(result) as image:
            dimensions = list(image.size)
    print(json.dumps({'name': args.worker[1], 'width': int(args.worker[2]), 'generated': result is not None,
                      'seconds': round(time.monotonic()-start, 3), 'peak_rss_mib': peak, 'dimensions': dimensions}), flush=True)
else:
    with tempfile.TemporaryDirectory(prefix='hmi-synthetic-thumbnails-') as folder:
        root = Path(folder)
        for name, size in [('large.jpg', (8000, 5000)), ('large.png', (8000, 5000)), ('oversized.png', (8001, 5000))]:
            with Image.new('RGB', size, '#37627d') as image:
                image.save(root/name)
        def run(name, width):
            child = subprocess.run([sys.executable, __file__, '--module', args.module, '--worker', folder, name, str(width)],
                                   capture_output=True, text=True, timeout=30)
            if child.returncode:
                raise RuntimeError('Synthetic worker failed: '+child.stderr[-300:])
            return json.loads(child.stdout)
        results = [run(name, 800) for name in ('large.jpg', 'large.png', 'oversized.png')]
        assert results[0]['generated'] and results[1]['generated'] and not results[2]['generated']
        with ThreadPoolExecutor(max_workers=4) as pool:
            concurrent = list(pool.map(lambda _: run('large.png', 400), range(4)))
        assert all(item['generated'] for item in concurrent)
        assert len(list((root/'.thumbs').glob('large.png.*.400.webp'))) == 1
        memory = None
        if Path('/proc/meminfo').is_file():
            memory = round(int(Path('/proc/meminfo').read_text().splitlines()[0].split()[1]) / 1024)
        print(json.dumps({'cpu_count': os.cpu_count(), 'machine_memory_mib': memory,
                          'synthetic_only': True, 'samples': results, 'four_process_same_image': concurrent,
                          'cache_files': len(list((root/'.thumbs').glob('*.webp')))}, indent=2), flush=True)
