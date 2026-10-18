"""One administrator action to replace only the updater and its systemd unit.

No package installation, Nginx/app/env/SSH changes, or additional sudo grants.
"""
from pathlib import Path
import datetime
import os
import shutil
import subprocess


FILES = {'landscape-update.py': Path('/usr/local/libexec/landscape-update.py'),
         'landscape-update.service': Path('/etc/systemd/system/landscape-update.service')}


def run(*args):
    subprocess.run(args, check=True, timeout=60)


def install_file(source, target):
    temporary = target.with_name(target.name + '.upgrade')
    shutil.copyfile(source, temporary)
    os.chown(temporary, 0, 0)
    temporary.chmod(0o644)
    temporary.replace(target)


def upgrade(source, backup_root):
    for name, target in FILES.items():
        if not (source / name).is_file() or not target.is_file():
            raise SystemExit('Missing source or existing installation: ' + name)
    # Syntax and unit validation before stopping the updater. App stays running.
    compile((source / 'landscape-update.py').read_bytes(), 'landscape-update.py', 'exec')
    run('systemd-analyze', 'verify', str(source / 'landscape-update.service'))
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = backup_root / ('updater-' + stamp)
    backup.mkdir(parents=True, mode=0o700)
    for name, target in FILES.items():
        shutil.copy2(target, backup / name)
    timer_was_active = subprocess.run(['systemctl', 'is-active', '--quiet', 'landscape-update.timer']).returncode == 0
    run('systemctl', 'stop', 'landscape-update.timer')
    try:
        run('systemctl', 'stop', 'landscape-update.service')
        for name, target in FILES.items():
            install_file(source / name, target)
        run('systemctl', 'daemon-reload')
        run('systemctl', 'start', '--no-block', 'landscape-update.service')
        run('systemctl', 'enable', '--now', 'landscape-update.timer')
    except Exception:
        run('systemctl', 'stop', 'landscape-update.service')
        for name, target in FILES.items():
            install_file(backup / name, target)
        run('systemctl', 'daemon-reload')
        if timer_was_active:
            run('systemctl', 'start', 'landscape-update.timer')
        raise
    print('Updater installed. Website was kept running; no proxy was configured.')
    print('Progress: cat /opt/landscape/update-status.json')
    print('Detailed stages: sudo journalctl -u landscape-update.service -n 40 --no-pager')


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run with sudo in the server terminal; do not send passwords.')
    upgrade(Path(__file__).resolve().parent, Path('/var/backups/landscape'))


if __name__ == '__main__':
    main()
