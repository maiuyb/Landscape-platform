"""Root-installed launcher; code and data live in separate directories."""
import os
from pathlib import Path

release = Path('/opt/landscape/current').resolve(strict=True)
os.environ['LANDSCAPE_REVISION'] = release.name
os.chdir(release / '风景调色协作平台/backend')
gunicorn = str(release / '.venv/bin/gunicorn')
os.execv(gunicorn, [gunicorn, '--bind', '127.0.0.1:5051', '--workers', '1',
                   '--threads', '4', '--timeout', '75', '--access-logfile', '-',
                   '--error-logfile', '-', 'app:app'])
