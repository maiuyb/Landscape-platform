"""Bounded, one-worker image preparation, independent of request and Flask contexts."""
from pathlib import Path
import queue
import sqlite3
import threading
import time
from urllib.parse import urlsplit

from thumbnails import build_thumbnail, upload_name, ThumbnailBusy


class ThumbnailWarmer:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.jobs = queue.Queue(maxsize=256)
        self.pending = set()
        self.lock = threading.Lock()
        self.worker = None

    def submit(self, name):
        if not upload_name(name):
            return False
        with self.lock:
            if name in self.pending:
                return True
            try:
                self.jobs.put_nowait(name)
            except queue.Full:
                return False
            self.pending.add(name)
            if self.worker is None:
                self.worker = threading.Thread(target=self._run, name='thumbnail-warmer', daemon=True)
                self.worker.start()
        return True

    def _run(self):
        while True:
            name = self.jobs.get()
            try:
                # Foreground work shares the same cross-process memory limit.
                for attempt in range(2):
                    try:
                        build_thumbnail(self.directory, name, 1200, prepare_all=True)
                        break
                    except ThumbnailBusy:
                        if attempt == 0:
                            time.sleep(.25)
            except (OSError, ValueError):
                pass  # Invalid uploads remain unavailable; never block other jobs.
            finally:
                with self.lock:
                    self.pending.discard(name)
                self.jobs.task_done()
                time.sleep(.01)  # Let waiting foreground requests acquire the generation lock.

    def start_existing(self, database):
        def feed():
            conn = sqlite3.connect(database, timeout=15)
            try:
                rows = conn.execute('''SELECT cover_after,cover_before FROM recipes r
                    WHERE deleted_at IS NULL ORDER BY
                    (SELECT COUNT(*) FROM favorites f WHERE f.recipe_id=r.id) DESC, r.id DESC''').fetchall()
            finally:
                conn.close()
            for after, before in rows:
                name = Path(urlsplit(after or before or '').path).name
                while upload_name(name) and not self.submit(name):
                    time.sleep(.1)
        threading.Thread(target=feed, name='thumbnail-library-feed', daemon=True).start()
