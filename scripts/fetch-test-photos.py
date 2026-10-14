"""Download only missing, licensed test thumbnails using Python's proxy support."""
import json
from pathlib import Path
from urllib.request import Request, urlopen

root = Path(__file__).resolve().parent.parent
folder = root / 'test-results/e1/photos'
folder.mkdir(parents=True, exist_ok=True)
photos = json.loads((root / 'tests/photo-fixtures.json').read_text(encoding='utf-8'))
for photo in photos:
    target = folder / photo['file']
    if target.exists() and target.stat().st_size:
        continue
    request = Request(photo['download'], headers={'User-Agent': 'Landscape-platform/0.1 local image quality testing'})
    with urlopen(request, timeout=30) as response:
        if not response.headers.get('Content-Type', '').startswith('image/'):
            raise ValueError(f"{photo['file']}: expected an image")
        data = response.read()
    if not data.startswith(b'\xff\xd8'):
        raise ValueError(f"{photo['file']}: expected JPEG bytes")
    target.write_bytes(data)
    print(f"Downloaded {photo['file']}; {photo['author']}, {photo['license']}", flush=True)
