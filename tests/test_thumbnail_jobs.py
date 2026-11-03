"""Background image work stays bounded and never runs on the submitting thread."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from PIL import Image

BACKEND = Path(__file__).resolve().parents[1]/'风景调色协作平台/backend'
spec = importlib.util.spec_from_file_location('thumbnail_jobs_test',BACKEND/'thumbnail_jobs.py')
jobs = importlib.util.module_from_spec(spec)
with patch.object(sys,'path',[str(BACKEND),*sys.path]):spec.loader.exec_module(jobs)


class ThumbnailJobsTests(unittest.TestCase):
    def test_slow_duplicate_work_runs_once_off_request_thread_then_prepares_every_size(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);Image.new('RGB',(1000,600),'#315c73').save(root/'photo.png')
            warmer=jobs.ThumbnailWarmer(root);entered=threading.Event();release=threading.Event();calls=[]
            original=jobs.build_thumbnail
            def slow(*args,**kwargs):
                calls.append(threading.get_ident());entered.set();release.wait(3)
                return original(*args,**kwargs)
            with patch.object(jobs,'build_thumbnail',slow):
                try:
                    self.assertTrue(warmer.submit('photo.png'));self.assertTrue(entered.wait(2))
                    self.assertTrue(warmer.submit('photo.png'))
                    self.assertNotEqual(calls[0],threading.get_ident())
                finally:release.set();warmer.jobs.join()
            self.assertEqual(len(calls),1)
            self.assertEqual(len(list((root/'.thumbs').glob('*.webp'))),4)

    def test_queue_saturates_without_blocking_and_bad_asset_does_not_stop_next_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);warmer=jobs.ThumbnailWarmer(root)
            warmer.worker=object()  # Hold the worker while testing the actual bounded queue.
            self.assertFalse(warmer.submit('../outside.png'))
            for i in range(256):self.assertTrue(warmer.submit(f'photo-{i}.png'))
            self.assertFalse(warmer.submit('overflow.png'))
            self.assertEqual(warmer.jobs.qsize(),256)
            warmer=jobs.ThumbnailWarmer(root)
            (root/'broken.png').write_bytes(b'not an image')
            Image.new('RGB',(64,40),'#315c73').save(root/'valid.png')
            warmer.submit('broken.png');warmer.submit('valid.png');warmer.jobs.join()
            self.assertEqual(len(list((root/'.thumbs').glob('valid*.webp'))),4)
