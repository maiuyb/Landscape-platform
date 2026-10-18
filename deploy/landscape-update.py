"""Unprivileged updater: fetch main, stage, backup SQLite, activate, health check.

Build failures leave the active release running. Activation failures roll code
back, never the database. This file is installed root-owned outside the checkout.
"""
import contextlib
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import tarfile
import time
import urllib.request

ROOT = Path('/opt/landscape')
DATA = Path('/var/lib/landscape')
REPOSITORY = 'https://github.com/maiuyb/Landscape-platform.git'


def run(args, **kwargs):
    return subprocess.run(args, check=True, timeout=600, **kwargs)


def revision():
    current = ROOT / 'current'
    return current.resolve().name if current.is_symlink() else None


def switch(target):
    temporary = ROOT / 'next'
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target, target_is_directory=True)
    temporary.replace(ROOT / 'current')


def restart():
    run(['/usr/bin/sudo', '-n', '/usr/bin/systemctl', 'restart', 'landscape.service'])


def healthy(expected, attempts=40):
    for _ in range(attempts):
        try:
            with urllib.request.urlopen('http://127.0.0.1:5051/api/health', timeout=2) as response:
                data = json.load(response)
            if data == {'status': 'ok', 'revision': expected}:
                return True
        except (OSError, ValueError):
            pass
        time.sleep(1)
    return False


def backup_database():
    database = DATA / 'recipes.db'
    if not database.exists():
        return
    backups = DATA / 'backups'
    backups.mkdir(exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    with contextlib.closing(sqlite3.connect(database)) as source:
        with contextlib.closing(sqlite3.connect(backups / (stamp + '.db'))) as target:
            source.backup(target)
    # Keep a bounded set; backup files are private, never placed in the web tree.
    for old in sorted(backups.glob('*.db'))[:-10]:
        old.unlink()


def build(sha):
    release = ROOT / 'releases' / sha
    ready = release / '.ready'
    if ready.exists():
        return release
    if release.exists():
        shutil.rmtree(release)
    release.mkdir(parents=True)
    archive = ROOT / 'release.tar'
    with archive.open('wb') as output:
        run(['git', '--git-dir', str(ROOT / 'repository.git'), 'archive', sha], stdout=output)
    # Python 3.12's data filter rejects archive paths outside this release.
    with tarfile.open(archive) as source:
        source.extractall(release, filter='data')
    archive.unlink()
    run(['python3', '-m', 'venv', str(release / '.venv')])
    run([str(release / '.venv/bin/python'), '-m', 'pip', 'install', '--disable-pip-version-check',
         '-r', str(release / 'deploy/requirements.txt')])
    run(['npm', 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=release)
    run(['node', 'scripts/prepare-frontend.cjs'], cwd=release)
    ready.touch()
    return release


def activate(sha, release):
    previous = revision()
    backup_database()
    switch(release)
    try:
        restart()
        if not healthy(sha):
            raise RuntimeError('New release failed readiness check: ' + sha)
    except Exception:
        if previous:
            switch(ROOT / 'releases' / previous)
            restart()
            if not healthy(previous):
                raise RuntimeError('Rollback readiness check failed; inspect landscape.service')
        else:
            (ROOT / 'current').unlink(missing_ok=True)
        raise
    print('ACTIVE ' + sha, flush=True)
    # Preserve the new release and the previous known version for manual rollback.
    releases = ROOT / 'releases'
    ordered = sorted(releases.iterdir(), key=lambda item: item.stat().st_mtime, reverse=True)
    keep = {sha, previous, *(item.name for item in ordered[:3])}
    for old in ordered:
        if old.is_dir() and re.fullmatch('[0-9a-f]{40}', old.name) and old.name not in keep:
            shutil.rmtree(old)


def update():
    repository = ROOT / 'repository.git'
    if not repository.exists():
        run(['git', 'init', '--bare', str(repository)])
        run(['git', '--git-dir', str(repository), 'remote', 'add', 'origin', REPOSITORY])
    env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GIT_CONFIG_NOSYSTEM': '1'}
    run(['git', '--git-dir', str(repository), 'fetch', '--depth=1', 'origin', 'main'], env=env)
    sha = subprocess.check_output(['git', '--git-dir', str(repository), 'rev-parse', 'FETCH_HEAD'], text=True).strip()
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise RuntimeError('Invalid fetched revision')
    if revision() == sha:
        print('UNCHANGED ' + sha, flush=True)
        return
    activate(sha, build(sha))


if __name__ == '__main__':
    with (ROOT / 'update.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        update()
