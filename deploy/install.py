"""One-time Ubuntu installation, run explicitly with sudo from the SSH console.

Installs only Landscape files and one include inside an existing Nginx server.
It does not change SSH, security groups, the existing site root, or other apps.
"""
import argparse
import datetime
import getpass
import os
from pathlib import Path
import pwd
import shutil
import socket
import subprocess
from urllib.parse import urlsplit


def run(*args):
    subprocess.run(args, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--origin', required=True)
    parser.add_argument('--nginx-site', required=True)
    parser.add_argument('--configure-ai', action='store_true', help='Prompt for the API key privately on the server console')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Run this installer with sudo in the server console.')
    origin = urlsplit(args.origin)
    if origin.scheme not in ('http', 'https') or not origin.netloc or origin.path not in ('', '/') or origin.query or origin.fragment:
        raise SystemExit('Origin must contain only the scheme and host.')
    site = Path(args.nginx_site).resolve(strict=True)
    if not site.is_relative_to(Path('/etc/nginx')):
        raise SystemExit('Nginx site must be inside /etc/nginx.')
    before = site.read_text()
    include = '    include /etc/nginx/snippets/landscape.conf;'
    if include not in before:
        if before.count('server {') != 1 or not before.rstrip().endswith('}') or 'location /landscape' in before:
            raise SystemExit('Site layout differs; stop for review before changing Nginx.')
    source = Path(__file__).resolve().parent
    for name in ('landscape.service', 'landscape-update.service', 'landscape-update.timer',
                 'landscape-start.py', 'landscape-update.py', 'landscape-nginx.conf'):
        if not (source / name).is_file():
            raise SystemExit('Missing installation file: ' + name)
    app_exists = Path('/etc/systemd/system/landscape.service').exists()
    if not app_exists:
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 5051))
    print('Installing required runtime packages...', flush=True)
    run('apt-get', 'update')
    run('apt-get', 'install', '-y', 'python3-venv', 'nodejs', 'npm', 'git', 'sudo')
    try:
        account = pwd.getpwnam('landscape')
        if account.pw_dir != '/var/lib/landscape' or account.pw_shell not in ('/usr/sbin/nologin', '/bin/false'):
            raise SystemExit('Existing landscape account differs; stop for review.')
    except KeyError:
        run('useradd', '--system', '--user-group', '--home-dir', '/var/lib/landscape',
            '--shell', '/usr/sbin/nologin', 'landscape')
        account = pwd.getpwnam('landscape')
    for directory in ('/opt/landscape', '/opt/landscape/releases', '/var/lib/landscape', '/var/lib/landscape/backups'):
        path = Path(directory)
        path.mkdir(parents=True, exist_ok=True)
        os.chown(path, account.pw_uid, account.pw_gid)
        path.chmod(0o750 if directory.startswith('/var') else 0o755)
    Path('/etc/landscape').mkdir(exist_ok=True, mode=0o750)
    os.chown('/etc/landscape', 0, account.pw_gid)
    environment = Path('/etc/landscape/landscape.env')
    if not environment.exists():
        environment.write_text('LANDSCAPE_DB=/var/lib/landscape/recipes.db\n'
                               'LANDSCAPE_UPLOAD_DIR=/var/lib/landscape/uploads\n'
                               'LANDSCAPE_TRUST_PROXY=1\n'
                               'PUBLIC_ORIGIN=' + args.origin.rstrip('/') + '\n'
                               'AI_MODE=live\nDASHSCOPE_API_KEY=\nAI_MODEL=qwen3.8-flash\n')
        os.chown(environment, 0, account.pw_gid)
        environment.chmod(0o640)
    if args.configure_ai:
        key = getpass.getpass('AI API key (hidden; Enter to configure later): ').strip()
        if key:
            if '\n' in key or '\r' in key or any(char.isspace() for char in key):
                raise SystemExit('Invalid key format; configuration was not changed.')
            # Quote for systemd EnvironmentFile. Never print the entered value.
            escaped = key.replace('\\', '\\\\').replace('"', '\\"')
            lines = [line for line in environment.read_text().splitlines() if not line.startswith('DASHSCOPE_API_KEY=')]
            environment.write_text('\n'.join(lines) + '\nDASHSCOPE_API_KEY="' + escaped + '"\n')
    Path('/usr/local/libexec').mkdir(exist_ok=True)
    for name in ('landscape-start.py', 'landscape-update.py'):
        target = Path('/usr/local/libexec') / name
        shutil.copyfile(source / name, target)
        os.chown(target, 0, 0)
        target.chmod(0o644)
    for name in ('landscape.service', 'landscape-update.service', 'landscape-update.timer'):
        target = Path('/etc/systemd/system') / name
        shutil.copyfile(source / name, target)
        target.chmod(0o644)
    rule = Path('/etc/sudoers.d/landscape-restart')
    rule.write_text('landscape ALL=(root) NOPASSWD: /usr/bin/systemctl restart landscape.service\n')
    rule.chmod(0o440)
    run('visudo', '-cf', str(rule))
    backup = Path('/var/backups/landscape')
    backup.mkdir(exist_ok=True, mode=0o700)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    shutil.copyfile(site, backup / ('nginx-site-' + stamp + '.conf'))
    snippet = Path('/etc/nginx/snippets/landscape.conf')
    snippet_before = snippet.read_bytes() if snippet.exists() else None
    shutil.copyfile(source / 'landscape-nginx.conf', snippet)
    snippet.chmod(0o644)
    if include not in before:
        site.write_text(before.rstrip()[:-1] + include + '\n}\n')
    try:
        run('nginx', '-t')
    except Exception:
        site.write_text(before)
        if snippet_before is None:
            snippet.unlink()
        else:
            snippet.write_bytes(snippet_before)
        raise
    run('systemctl', 'daemon-reload')
    run('systemctl', 'enable', 'landscape.service', 'landscape-update.timer')
    run('systemctl', 'reload', 'nginx')
    print('Preparing the first GitHub main release; the existing site remains available.', flush=True)
    run('systemctl', 'start', 'landscape-update.service')
    run('systemctl', 'start', 'landscape-update.timer')
    print('READY ' + args.origin.rstrip('/') + '/landscape/', flush=True)
    print('AI requires a server-side key in /etc/landscape/landscape.env; no local secrets were copied.')


if __name__ == '__main__':
    main()
