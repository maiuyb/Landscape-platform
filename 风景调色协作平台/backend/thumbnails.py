"""Bounded thumbnail generation. No application state or user configuration on import."""
from contextlib import contextmanager
import os
from pathlib import Path
import re
import threading
import time
import uuid
import warnings
from PIL import Image, ImageOps

WIDTHS = (200, 400, 800, 1200)
MAX_PIXELS = 40_000_000
MAX_SIDE = 32767
MAX_CACHE_BYTES = 256 * 1024 * 1024
MAX_CACHE_FILES = 1024
LOCK_TIMEOUT = 5
_thread_lock = threading.Lock()


class ThumbnailBusy(Exception):
    pass


def upload_name(name):
    if not isinstance(name, str) or len(name) > 180 or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpg|jpeg|png|webp)', name, re.I):
        return None
    return name


def upload_path(directory, name):
    if not upload_name(name):
        return None
    try:
        root = Path(directory).resolve()
        path = root / name
        if path.resolve().parent != root or not path.is_file():
            return None
        return path
    except (OSError, RuntimeError):
        return None


def width_bucket(width):
    try:
        width = int(width)
    except (ValueError, TypeError, OverflowError):
        width = 800
    return next((w for w in WIDTHS if width <= w), WIDTHS[-1])


@contextmanager
def _generation_lock(folder):
    # A thread gate plus OS file lock also bounds multiple application processes.
    deadline = time.monotonic() + LOCK_TIMEOUT
    if not _thread_lock.acquire(timeout=LOCK_TIMEOUT):
        raise ThumbnailBusy()
    handle = None
    locked = False
    try:
        handle = (folder / '.generation.lock').open('a+b')
        if os.name == 'nt':
            import msvcrt
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write(b'0'); handle.flush()
            def acquire():
                handle.seek(0); msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            def release():
                handle.seek(0); msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            def acquire():
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            def release():
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        while True:
            try:
                acquire(); locked = True; break
            except (BlockingIOError, OSError):
                if time.monotonic() >= deadline:
                    raise ThumbnailBusy()
                time.sleep(.025)
        yield
    finally:
        if locked:
            release()
        if handle:
            handle.close()
        _thread_lock.release()


def _prune(folder, keep):
    files = []
    for path in folder.iterdir():
        try:
            info = path.stat()
            if (path.name.startswith('.tmp-') or path.name.endswith('.tmp')) and time.time() - info.st_mtime > 600:
                path.unlink()
            elif path.suffix == '.webp' and path.is_file():
                files.append((info.st_atime_ns, info.st_size, path))
        except OSError:
            continue
    size, count = sum(f[1] for f in files), len(files)
    for _, length, path in sorted(files):
        if size <= MAX_CACHE_BYTES and count <= MAX_CACHE_FILES:
            break
        if path == keep:
            continue
        try:
            path.unlink(); size -= length; count -= 1
        except OSError:
            continue


def build_thumbnail(directory, name, width):
    source = upload_path(directory, name)
    if not source:
        return None
    width = width_bucket(width)
    folder = Path(directory) / '.thumbs'
    folder.mkdir(exist_ok=True)
    info = source.stat()
    signature = f'{info.st_mtime_ns:x}-{info.st_size:x}'
    target = folder / f'{name}.{signature}.{width}.webp'
    if target.is_file():
        return target
    with _generation_lock(folder):
        if target.is_file():
            return target
        temporary = folder / ('.tmp-' + uuid.uuid4().hex)
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error', Image.DecompressionBombWarning)
                with Image.open(source) as image:
                    if image.width * image.height > MAX_PIXELS or max(image.size) > MAX_SIDE:
                        return None
                    # JPEG can decode directly at a reduced resolution, before full pixel allocation.
                    if image.format == 'JPEG':
                        rotated = image.getexif().get(274) in (5, 6, 7, 8)
                        box = (round(width * image.width / image.height), width) if rotated else (width, round(width * image.height / image.width))
                        image.draft('RGB', tuple(max(1, n) for n in box))
                    ImageOps.exif_transpose(image, in_place=True)
                    if image.mode not in ('RGB', 'RGBA'):
                        image = image.convert('RGB')
                    height = max(1, round(image.height * min(1, width / image.width)))
                    image.thumbnail((width, height), Image.Resampling.LANCZOS, reducing_gap=3)
                    image.save(temporary, format='WEBP', quality=82, method=4)
            after = source.stat()
            if (after.st_mtime_ns, after.st_size) != (info.st_mtime_ns, info.st_size):
                return None
            os.replace(temporary, target)
            _prune(folder, target)
            return target
        except (OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            return None
        finally:
            temporary.unlink(missing_ok=True)
