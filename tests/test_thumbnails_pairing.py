"""Synthetic files only: bounded transcoding and trusted-prefix content pairing."""
import ast
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from flask import Flask, request, has_request_context
from PIL import Image

BACKEND = Path(__file__).resolve().parents[1] / '风景调色协作平台/backend'
spec = importlib.util.spec_from_file_location('bounded_thumbnails', BACKEND / 'thumbnails.py')
thumb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(thumb)


class ThumbnailTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.source = self.root / 'synthetic.png'
        Image.new('RGB', (1000, 600), '#315c73').save(self.source)

    def tearDown(self):
        self.tmp.cleanup()

    def test_width_requests_share_four_cache_buckets(self):
        paths = {thumb.build_thumbnail(self.root, self.source.name, w)
                 for w in (-20, 1, 200, 201, 399, 400, 401, 799, 800, 801, 1200, 999999, 'bad')}
        self.assertEqual(len(paths), 4)
        self.assertTrue(all(p.is_file() for p in paths))
        for p in paths:
            with Image.open(p) as image:
                self.assertLessEqual(image.width, int(p.stem.rsplit('.', 1)[1]))
                self.assertEqual(image.format, 'WEBP')

    def test_cache_hit_and_source_change(self):
        old = thumb.build_thumbnail(self.root, self.source.name, 400)
        with patch.object(thumb.Image, 'open', side_effect=AssertionError('cache must not decode')):
            self.assertEqual(thumb.build_thumbnail(self.root, self.source.name, 400), old)
        Image.new('RGB', (800, 500), '#efca80').save(self.source)
        new = thumb.build_thumbnail(self.root, self.source.name, 400)
        self.assertNotEqual(new, old)
        self.assertNotEqual(new.read_bytes(), old.read_bytes())

    def test_parallel_identical_requests_decode_once(self):
        original, lock, count = Image.Image.save, threading.Lock(), []
        def save(image, *args, **kwargs):
            with lock:
                count.append(1)
            time.sleep(.03)
            return original(image, *args, **kwargs)
        with patch.object(Image.Image, 'save', save), ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: thumb.build_thumbnail(self.root, self.source.name, 400), range(8)))
        self.assertEqual(len(count), 1)
        self.assertEqual(len(set(results)), 1)

    def test_cross_process_generation_lock(self):
        folder = self.root / '.thumbs'; folder.mkdir()
        script = '''import importlib.util,sys,time
from pathlib import Path
s=importlib.util.spec_from_file_location('thumb',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
with m._generation_lock(Path(sys.argv[2])):
 with open(sys.argv[3],'a') as f:f.write('enter\\n')
 time.sleep(.15)
 with open(sys.argv[3],'a') as f:f.write('leave\\n')
'''
        log = self.root / 'events'
        children = [subprocess.Popen([sys.executable, '-c', script, str(BACKEND / 'thumbnails.py'), str(folder), str(log)], stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(2)]
        for child in children:
            _, errors = child.communicate(timeout=15)
            self.assertEqual(child.returncode, 0, errors.decode())
        self.assertEqual(log.read_text().splitlines(), ['enter', 'leave', 'enter', 'leave'])

    def test_invalid_oversized_and_failed_writes_leave_no_partial_cache(self):
        for name in ('../outside.png', '.private.png', 'a/b.png', 'a\\b.png', 'a.png?x', 'a.txt', '%2e%2e.png', 'a'*200+'.png'):
            self.assertIsNone(thumb.build_thumbnail(self.root, name, 400))
        (self.root / 'broken.png').write_bytes(b'not an image')
        self.assertIsNone(thumb.build_thumbnail(self.root, 'broken.png', 400))
        with patch.object(thumb, 'MAX_PIXELS', 100), patch.object(Image.Image, 'load', side_effect=AssertionError('reject before decode')):
            self.assertIsNone(thumb.build_thumbnail(self.root, self.source.name, 400))
        with patch.object(thumb, 'MAX_SIDE', 100), patch.object(Image.Image, 'load', side_effect=AssertionError('reject before decode')):
            self.assertIsNone(thumb.build_thumbnail(self.root, self.source.name, 400))
        with patch.object(Image.Image, 'save', side_effect=OSError('synthetic write failure')):
            self.assertIsNone(thumb.build_thumbnail(self.root, self.source.name, 400))
        self.assertFalse(list((self.root / '.thumbs').glob('.tmp-*')))
        self.assertTrue(thumb.build_thumbnail(self.root, self.source.name, 400).is_file())

    def test_busy_has_bounded_wait_and_can_recover(self):
        thumb._thread_lock.acquire()
        try:
            with patch.object(thumb, 'LOCK_TIMEOUT', .01):
                with self.assertRaises(thumb.ThumbnailBusy):
                    thumb.build_thumbnail(self.root, self.source.name, 800)
        finally:
            thumb._thread_lock.release()
        self.assertTrue(thumb.build_thumbnail(self.root, self.source.name, 800).is_file())

    def test_cache_is_bounded_and_exif_is_oriented(self):
        folder = self.root / '.thumbs'; folder.mkdir()
        for i in range(4):
            (folder / f'old-{i}.webp').write_bytes(b'x' * 5000)
        with patch.object(thumb, 'MAX_CACHE_BYTES', 16000), patch.object(thumb, 'MAX_CACHE_FILES', 2):
            result = thumb.build_thumbnail(self.root, self.source.name, 400)
        files = list(folder.glob('*.webp'))
        self.assertLessEqual(len(files), 2)
        self.assertLessEqual(sum(p.stat().st_size for p in files), 16000)
        self.assertTrue(result.is_file())
        image = Image.new('RGB', (1200, 600), '#356831')
        exif = image.getexif(); exif[274] = 6
        image.save(self.root / 'oriented.jpg', exif=exif)
        with Image.open(thumb.build_thumbnail(self.root, 'oriented.jpg', 200)) as output:
            self.assertEqual(output.size, (200, 400))


class PairingPrefixTests(unittest.TestCase):
    def test_content_pairing_accepts_only_root_or_current_trusted_prefix(self):
        module = ast.parse((BACKEND / 'community_modules/community.py').read_text(encoding='utf-8'))
        functions = [n for n in module.body if isinstance(n, ast.FunctionDef) and n.name in ('_upload_path', '_same_upload_content')]
        app = Flask(__name__)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'a.png').write_bytes(b'synthetic identical bytes')
            (root / 'b.png').write_bytes(b'synthetic identical bytes')
            (root / 'c.png').write_bytes(b'synthetic different bytes')
            scope = dict(os=os, hashlib=hashlib, request=request, has_request_context=has_request_context,
                         UPLOAD_DIR=directory, upload_path=thumb.upload_path)
            exec(compile(ast.Module(body=functions, type_ignores=[]), '<pairing-prefix>', 'exec'), scope)
            for prefix in ('', '/landscape', '/another-app'):
                with app.test_request_context('/', environ_overrides={'SCRIPT_NAME': prefix}):
                    same = scope['_same_upload_content']
                    self.assertTrue(same(prefix+'/uploads/a.png', prefix+'/uploads/b.png'))
                    self.assertTrue(same('/uploads/a.png', prefix+'/uploads/b.png'))
                    self.assertFalse(same(prefix+'/uploads/a.png', prefix+'/uploads/c.png'))
                    for path in ('/foreign/uploads/a.png', prefix+'/uploads/../a.png', prefix+'/uploads/%2e%2e/a.png', prefix+'/uploads/a.png?query=1', 'https://outside/uploads/a.png'):
                        self.assertIsNone(scope['_upload_path'](path))


if __name__ == '__main__':
    unittest.main()
