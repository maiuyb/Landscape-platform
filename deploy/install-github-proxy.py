"""Install a loopback GitHub-only Mihomo using a privately entered subscription.

The official compressed binary is staged separately, never committed to Git.
"""
import datetime
import getpass
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
from urllib.parse import urlsplit

VERSION = 'v1.19.32'
ASSET_SHA256 = '306f81e723e60ce6b828899a6fe83e1d00e9ecefb2dc8d4d849312a5bc00efdc'
DOMAINS = ('github.com', 'githubusercontent.com', 'githubassets.com')
PROXY = 'http://127.0.0.1:17890'
UNIT = 'landscape-github-proxy.service'


def configuration(subscription, port=17890):
    parsed = urlsplit(subscription)
    if parsed.scheme != 'https' or not parsed.hostname or any(c.isspace() for c in subscription):
        raise ValueError('Use a valid HTTPS Clash/Mihomo subscription URL.')
    health = {'enable': True, 'url': 'https://github.com/robots.txt', 'interval': 600, 'timeout': 5000, 'lazy': True}
    return {'mixed-port': port, 'allow-lan': False, 'bind-address': '127.0.0.1',
            'mode': 'rule', 'log-level': 'silent', 'ipv6': False, 'geo-auto-update': False,
            'external-controller-unix': '/var/lib/landscape-github-proxy/controller.sock',
            'tun': {'enable': False}, 'dns': {'enable': False},
            'proxy-providers': {'subscription': {'type': 'http', 'url': subscription,
                'path': './providers/subscription.yaml', 'interval': 21600, 'proxy': 'DIRECT', 'size-limit': 10 * 1024**2, 'health-check': health}},
            'proxy-groups': [{'name': 'GitHub', 'type': 'url-test', 'use': ['subscription'],
                'url': health['url'], 'interval': 600, 'tolerance': 100, 'lazy': True}],
            'rules': ['DOMAIN-SUFFIX,' + domain + ',GitHub' for domain in DOMAINS] + ['MATCH,DIRECT']}


def run(*args, timeout=60):
    result = subprocess.run(args, capture_output=True, timeout=timeout)
    if result.returncode:
        # Command output may contain subscription URLs; provide only a label.
        raise RuntimeError('Step failed: ' + Path(args[0]).name + ' (exit ' + str(result.returncode) + ')')
    return result


def write_private(path, text):
    temporary = path.with_name(path.name + '.new')
    temporary.write_text(text, encoding='utf-8')
    os.chown(temporary, 0, 0)
    temporary.chmod(0o600)
    temporary.replace(path)


def check_github():
    try:
        result = subprocess.run(['curl', '--unix-socket', '/var/lib/landscape-github-proxy/controller.sock',
            '--silent', '--fail', '--max-time', '3', 'http://localhost/providers/proxies/subscription'],
            capture_output=True, timeout=4)
        providers = json.loads(result.stdout).get('proxies', []) if result.returncode == 0 else []
        if not providers:
            return False  # An empty provider may otherwise fall back to DIRECT.
        result = subprocess.run(['curl', '--unix-socket', '/var/lib/landscape-github-proxy/controller.sock',
            '--silent', '--fail', '--max-time', '3', 'http://localhost/proxies/GitHub'], capture_output=True, timeout=4)
        selected = json.loads(result.stdout).get('now') if result.returncode == 0 else None
        if selected in (None, 'DIRECT', 'COMPATIBLE', 'REJECT') or selected not in {p.get('name') for p in providers}:
            return False
    except (ValueError, subprocess.TimeoutExpired):
        return False
    return subprocess.run(['curl', '--proxy', PROXY, '--noproxy', '', '--fail', '--silent',
        '--connect-timeout', '5', '--max-time', '12', '--output', '/dev/null',
        'https://github.com/maiuyb/Landscape-platform.git/info/refs?service=git-upload-pack'],
        capture_output=True, timeout=15).returncode == 0


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run with sudo in the server terminal. Never send the subscription to chat.')
    os.umask(0o077)
    source = Path(__file__).resolve().parent
    archive = source / 'mihomo-linux-amd64.gz'
    if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest() != ASSET_SHA256:
        raise SystemExit('Missing official Mihomo archive or checksum mismatch; nothing changed.')
    for name in (UNIT, 'landscape-update.py'):
        if not (source / name).is_file():
            raise SystemExit('Missing staged source: ' + name)
    unit_path = Path('/etc/systemd/system') / UNIT
    if unit_path.exists():
        raise SystemExit('A proxy installation already exists; stop for review before replacing it.')
    with socket.socket() as check:
        check.bind(('127.0.0.1', 17890))
    subscription = getpass.getpass('Clash/Mihomo HTTPS subscription (hidden): ').strip()
    try:
        config = configuration(subscription)
    except ValueError as error:
        raise SystemExit(str(error)) from None
    binary = Path('/usr/local/bin/landscape-mihomo')
    config_path = Path('/etc/landscape/github-proxy.json')
    updater = Path('/usr/local/libexec/landscape-update.py')
    environment = Path('/etc/landscape/update.env')
    if not updater.exists():
        raise SystemExit('Install the updater first.')
    before_env = environment.read_text() if environment.exists() else ''
    if any(line.split('=', 1)[0].lower() in ('http_proxy', 'https_proxy', 'all_proxy') for line in before_env.splitlines() if '=' in line and not line.startswith('#')):
        raise SystemExit('Existing broad proxy settings need review; no changes made.')
    compile((source / 'landscape-update.py').read_bytes(), 'landscape-update.py', 'exec')
    with tempfile.TemporaryDirectory(prefix='landscape-proxy-check-') as tmp:
        temporary = Path(tmp)
        with gzip.open(archive, 'rb') as compressed:
            contents = compressed.read(100 * 1024**2 + 1)
        if not contents.startswith(b'\x7fELF') or len(contents) > 100 * 1024**2:
            raise SystemExit('Invalid binary archive; no changes made.')
        candidate = temporary / 'mihomo'
        candidate.write_bytes(contents)
        candidate.chmod(0o755)
        private_config = temporary / 'config.json'
        private_config.write_text(json.dumps(config), encoding='utf-8')
        run(str(candidate), '-t', '-d', str(temporary), '-f', str(private_config), timeout=45)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        backup = Path('/var/backups/landscape') / ('github-proxy-' + stamp)
        backup.mkdir(parents=True, mode=0o700)
        targets = [binary, config_path, unit_path, updater, environment]
        previous = {}
        for index, target in enumerate(targets):
            saved = backup / str(index)
            previous[target] = saved if target.exists() else None
            if target.exists():
                shutil.copy2(target, saved)
        run('systemctl', 'stop', 'landscape-update.timer')
        try:
            run('systemctl', 'stop', 'landscape-update.service')
            shutil.copyfile(candidate, binary)
            os.chown(binary, 0, 0)
            binary.chmod(0o755)
            write_private(config_path, json.dumps(config))
            shutil.copyfile(source / UNIT, unit_path)
            unit_path.chmod(0o644)
            run('systemd-analyze', 'verify', str(unit_path))
            run('systemctl', 'daemon-reload')
            run('systemctl', 'start', UNIT)
            for attempt in range(6):
                print('Checking GitHub proxy (' + str(attempt + 1) + '/6)...', flush=True)
                if check_github():
                    break
                time.sleep(3)
            else:
                raise RuntimeError('No working GitHub proxy connection. Check subscription format and node availability.')
            shutil.copyfile(source / 'landscape-update.py', updater)
            os.chown(updater, 0, 0)
            updater.chmod(0o644)
            lines = [line for line in before_env.splitlines() if not line.startswith('LANDSCAPE_GITHUB_PROXY=')]
            write_private(environment, '\n'.join(lines) + '\nLANDSCAPE_GITHUB_PROXY=' + PROXY + '\n')
            run('systemctl', 'enable', UNIT)
            run('systemctl', 'start', '--no-block', 'landscape-update.service')
            run('systemctl', 'start', 'landscape-update.timer')
        except Exception:
            subprocess.run(['systemctl', 'disable', '--now', UNIT], capture_output=True, timeout=60)
            for target, saved in previous.items():
                if saved is None:
                    target.unlink(missing_ok=True)
                else:
                    shutil.copy2(saved, target)
            run('systemctl', 'daemon-reload')
            run('systemctl', 'start', 'landscape-update.timer')
            raise
    print('READY: GitHub updater uses the loopback proxy. Website, AI, pip and npm keep their direct connections.')
    print('Subscription is private on this server; no public proxy or dashboard was opened.')


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        raise SystemExit(str(error) + ' Setup did not complete; previous configuration restored.') from None
    except subprocess.TimeoutExpired:
        raise SystemExit('A proxy setup step timed out; previous configuration restored.') from None
