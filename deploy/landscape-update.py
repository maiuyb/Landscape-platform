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
import queue
import re
import signal
import shutil
import sqlite3
import subprocess
import threading
import tarfile
import time
import urllib.request

ROOT = Path('/opt/landscape')
DATA = Path('/var/lib/landscape')
REPOSITORY = 'https://github.com/maiuyb/Landscape-platform.git'
HEARTBEAT = 10
CONNECT_TIMEOUT = 45
FETCH_TIMEOUT = 600
LOW_SPEED_SECONDS = 45
_status = {}
_started = time.monotonic()


class UpdateError(RuntimeError):
    def __init__(self, category, code=None):
        super().__init__(category)
        self.category, self.code = category, code


def report(stage, message, **fields):
    """Only operational counters/known messages; never raw output or configuration."""
    global _status
    context = {key: _status[key] for key in ('attempt', 'target_revision', 'active_revision', 'proxy_configured') if key in _status}
    _status = {'stage': stage, 'message': message, **context,
               'time': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'elapsed_seconds': round(time.monotonic() - _started, 1), **fields}
    text = json.dumps(_status, ensure_ascii=True)
    print(text, flush=True)
    temporary = ROOT / 'update-status.tmp'
    temporary.write_text(text + '\n', encoding='utf-8')
    temporary.chmod(0o644)  # Sanitized local status, outside the served web tree.
    temporary.replace(ROOT / 'update-status.json')


def category(output):
    output = output.lower()
    if 'could not resolve' in output:
        return 'dns_failed'
    if 'too slow' in output:
        return 'transfer_stalled'
    if 'timed out' in output or 'timeout' in output:
        return 'connection_timeout'
    if 'certificate' in output or 'ssl' in output or 'tls' in output:
        return 'tls_failed'
    if '407' in output or 'proxy' in output:
        return 'proxy_failed'
    if 'failed to connect' in output or 'connection reset' in output:
        return 'connection_failed'
    return 'command_failed'


def git_progress(line):
    match = re.search(r'(Enumerating objects|Counting objects|Compressing objects|Receiving objects|Resolving deltas):\s*(?:(\d+)%\s*)?\((\d+)/(\d+)\)(?:,\s*([\d.]+)\s*(bytes|[KMG]iB))?', line)
    if not match:
        return None
    phase, percent, done, total, size, unit = match.groups()
    result = {'phase': phase, 'completed': int(done), 'total': int(total)}
    if percent is not None:
        result['percent'] = int(percent)
    if size is not None:
        result['received_bytes'] = int(float(size) * {'bytes': 1, 'KiB': 1024, 'MiB': 1024**2, 'GiB': 1024**3}[unit])
    return result


def terminate(process):
    # A timed-out git must not leave git-remote-https/index-pack running.
    if os.name == 'posix':
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    else:
        process.kill()
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        if os.name == 'posix':
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        else:
            process.kill()
        process.wait(timeout=3)


def run(args, *, stage='local_command', timeout=600, **kwargs):
    if 'stdout' in kwargs:  # Binary git archive; never decode it as progress.
        return subprocess.run(args, check=True, timeout=timeout, **kwargs)
    report(stage, 'started', state='running', limit_seconds=timeout)
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               bufsize=0, start_new_session=os.name == 'posix', **kwargs)
    chunks = queue.Queue(maxsize=256)
    stop_reader = threading.Event()
    def publish(chunk):
        while not stop_reader.is_set():
            try:
                chunks.put(chunk, timeout=.2)
                return
            except queue.Full:
                pass
    def read():
        try:
            while True:
                chunk = process.stdout.read(4096)
                if not chunk:
                    break
                publish(chunk)
        finally:
            publish(None)
    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    started = last_report = last_progress = time.monotonic()
    tail, pending, progress, output_bytes = '', '', {}, 0
    try:
        while True:
            now = time.monotonic()
            if now - started >= timeout:
                raise UpdateError('time_limit')
            try:
                chunk = chunks.get(timeout=min(.2, timeout - (now - started)))
            except queue.Empty:
                chunk = b''
            now = time.monotonic()
            if chunk is None:
                break
            if chunk:
                output_bytes += len(chunk)
                decoded = chunk.decode('utf-8', errors='replace')
                tail = (tail + decoded)[-65536:]
                pending += decoded
                lines = re.split(r'[\r\n]', pending)
                pending = lines.pop()[-8192:]
                for line in lines:
                    parsed = git_progress(line)
                    if parsed:
                        if parsed != progress:
                            last_progress = now
                        progress = parsed
            if now - last_report >= HEARTBEAT:
                # Git/libcurl judges byte-level stalling. Quiet stdout alone is
                # not a reason to abort a large object or a slow dependency.
                report(stage, 'last_reported_progress' if progress else 'waiting_for_command',
                       state='running', stage_seconds=round(now - started, 1),
                       progress_age_seconds=round(now - last_progress, 1) if progress else None,
                       output_bytes=output_bytes, **progress)
                last_report = now
        code = process.wait(timeout=max(.01, timeout - (time.monotonic() - started)))
        if code:
            raise UpdateError(category(tail), code)
        report(stage, 'completed', state='running', stage_seconds=round(time.monotonic() - started, 1), **progress)
        return subprocess.CompletedProcess(args, code, stdout=tail)
    except subprocess.TimeoutExpired:
        raise UpdateError('time_limit') from None
    finally:
        stop_reader.set()
        # Also clean descendants when the group leader exits before its pipes.
        if process.poll() is None or reader.is_alive():
            terminate(process)
        reader.join(timeout=3)
        process.stdout.close()


def fetch_repository(repository, env):
    proxy = any(env.get(key) for key in ('HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy'))
    base = ['git', '-c', 'http.lowSpeedLimit=1', '-c', 'http.lowSpeedTime=' + str(LOW_SPEED_SECONDS),
            '--git-dir', str(repository)]
    for attempt in (1, 2):
        phase = 'connect'
        try:
            report('connect', 'reading_remote_version', state='running', attempt=attempt, proxy_configured=proxy)
            remote = run(base + ['ls-remote', 'origin', 'refs/heads/main'], env=env,
                         stage='connect', timeout=CONNECT_TIMEOUT).stdout
            match = re.fullmatch(r'([0-9a-f]{40})\s+refs/heads/main\s*', remote)
            if not match:
                raise UpdateError('invalid_remote_revision')
            sha = match[1]
            if revision() == sha:
                return sha
            phase = 'fetch'
            report('fetch', 'receiving_git_objects', state='running', attempt=attempt, target_revision=sha)
            run(base + ['fetch', '--progress', '--depth=1', 'origin', 'main'],
                env=env, stage='fetch', timeout=FETCH_TIMEOUT)
            sha = subprocess.check_output(['git', '--git-dir', str(repository), 'rev-parse', 'FETCH_HEAD'], text=True).strip()
            if not re.fullmatch('[0-9a-f]{40}', sha):
                raise UpdateError('invalid_fetched_revision')
            return sha
        except UpdateError as error:
            if phase == 'connect' and error.category == 'time_limit':
                error = UpdateError('connection_timeout', error.code)
            report(phase,
                   'attempt_failed', state='retrying' if attempt < 2 else 'failed',
                   attempt=attempt, category=error.category, exit_code=error.code)
            if attempt == 2:
                raise error
            report('retry', 'retrying_after_backoff', state='retrying', seconds=5)
            time.sleep(5)


def revision():
    current = ROOT / 'current'
    return current.resolve().name if current.is_symlink() else None


def switch(target):
    temporary = ROOT / 'next'
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target, target_is_directory=True)
    temporary.replace(ROOT / 'current')


def restart():
    run(['/usr/bin/sudo', '-n', '/usr/bin/systemctl', 'restart', 'landscape.service'], stage='restart', timeout=60)


def healthy(expected, attempts=40):
    report('health', 'checking_application', state='running', target_revision=expected)
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
    report('backup', 'backing_up_database', state='running')
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
        report('prepare', 'using_prepared_release', state='running', target_revision=sha)
        return release
    if release.exists():
        shutil.rmtree(release)
    release.mkdir(parents=True)
    report('prepare', 'extracting_release', state='running', target_revision=sha)
    archive = ROOT / 'release.tar'
    with archive.open('wb') as output:
        run(['git', '--git-dir', str(ROOT / 'repository.git'), 'archive', sha], stdout=output)
    # Python 3.12's data filter rejects archive paths outside this release.
    with tarfile.open(archive) as source:
        source.extractall(release, filter='data')
    archive.unlink()
    run(['python3', '-m', 'venv', str(release / '.venv')], stage='python_environment', timeout=60)
    run([str(release / '.venv/bin/python'), '-m', 'pip', 'install', '--disable-pip-version-check',
         '-r', str(release / 'deploy/requirements.txt')], stage='python_dependencies')
    run(['npm', 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=release, stage='node_dependencies')
    run(['node', 'scripts/prepare-frontend.cjs'], cwd=release, stage='frontend', timeout=60)
    ready.touch()
    return release


def activate(sha, release):
    previous = revision()
    backup_database()
    report('activate', 'switching_release', state='running', target_revision=sha, active_revision=previous)
    switch(release)
    try:
        restart()
        if not healthy(sha):
            raise RuntimeError('New release failed readiness check: ' + sha)
    except Exception:
        if previous:
            report('rollback', 'restoring_previous_code', state='running', target_revision=previous)
            switch(ROOT / 'releases' / previous)
            restart()
            if not healthy(previous):
                raise RuntimeError('Rollback readiness check failed; inspect landscape.service')
        else:
            (ROOT / 'current').unlink(missing_ok=True)
        raise
    report('complete', 'release_active', state='success', active_revision=sha, target_revision=sha)
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
    sha = fetch_repository(repository, env)
    if revision() == sha:
        report('complete', 'unchanged', state='success', active_revision=sha, target_revision=sha)
        return
    activate(sha, build(sha))


if __name__ == '__main__':
    with (ROOT / 'update.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        report('start', 'checking_main', state='running', active_revision=revision())
        try:
            update()
        except Exception as error:
            report(_status.get('stage', 'start'), 'update_failed_check_active_revision',
                   state='failed', category=error.category if isinstance(error, UpdateError) else 'local_failure',
                   exit_code=error.code if isinstance(error, UpdateError) else None)
            raise SystemExit(1)
