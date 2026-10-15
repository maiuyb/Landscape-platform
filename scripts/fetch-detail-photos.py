"""Fetch native-size copies of two already licensed fixtures for local E3 inspection."""
import json
from pathlib import Path
from urllib.request import Request, urlopen

root = Path(__file__).resolve().parent.parent
folder = root / 'test-results/e3/native'
folder.mkdir(parents=True, exist_ok=True)
for photo in json.loads((root / 'tests/photo-fixtures.json').read_text(encoding='utf-8')):
    if photo['file'] not in ('night.jpg', 'snow.jpg'):
        continue
    url = photo['download'].replace('https://thumb.wikimedia.org/wikipedia/commons/thumb/', 'https://upload.wikimedia.org/wikipedia/commons/').rsplit('/', 1)[0]
    target = folder / photo['file']
    if target.exists() and target.stat().st_size:
        continue
    with urlopen(Request(url, headers={'User-Agent': 'Landscape-platform/0.1 local quality testing'}), timeout=30) as response:
        data = response.read(24 * 1024 * 1024 + 1)
    if len(data) > 24 * 1024 * 1024 or not data.startswith(b'\xff\xd8'):
        raise ValueError(f"{photo['file']}: invalid or oversized JPEG")
    target.write_bytes(data)
    print(f"Downloaded native {photo['file']}; {photo['author']}, {photo['license']}", flush=True)
