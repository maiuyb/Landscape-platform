"""Upgrade public-image caching only; back up, validate, reload and verify or restore."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.request
from urllib.parse import urlsplit


NGINX = Path('/etc/nginx')
BACKUPS = Path('/var/backups/landscape')
INCLUDE = 'include /etc/nginx/snippets/landscape-image-proxy.conf;'


def patch_proxy(text):
    # Touch the general application location only. Auth limits and headers stay intact.
    pattern = r'(location /landscape/\s*\{)([^{}]*)(\})'
    if len(re.findall(pattern, text)) != 1:
        raise ValueError('Expected one existing Landscape application location')
    body = re.search(pattern, text)[2]
    if re.fullmatch(r'\s*return 308 https://[^;\s]+;\s*', body):
        return text  # The HTTP site must keep redirecting every project request to HTTPS.
    if 'proxy_pass http://127.0.0.1:5051/;' not in body:
        raise ValueError('Unexpected application upstream')
    def replace(match):
        body = re.sub(r'^\s*add_header Cache-Control "no-store" always;\s*$', '', match[2], flags=re.M)
        return match[1] + body + match[3]
    result = re.sub(pattern, replace, text)
    if INCLUDE not in result:
        result = INCLUDE + '\n' + result
    return result


def plan(source, nginx):
    replacements = {}
    for target, name in [('conf.d/landscape-images.conf', 'landscape-image-cache.conf'),
                         ('snippets/landscape-image-proxy.conf', 'landscape-image-proxy.conf')]:
        replacements[nginx/target] = (source/name).read_bytes()
    http = nginx/'snippets/landscape.conf'
    replacements[http] = patch_proxy(http.read_text()).encode()
    https = nginx/'snippets/landscape-https-proxy.conf'
    if https.exists():
        replacements[https] = patch_proxy(https.read_text()).encode()
    return replacements


def run(*args):
    subprocess.run(args, check=True, timeout=30)


def install(path, content):
    temporary = path.with_name(path.name + '.image-cache-tmp')
    try:
        temporary.write_bytes(content)
        temporary.chmod(0o644)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def upgrade(replacements, backup_root, verify):
    before = {path: path.read_bytes() if path.exists() else None for path in replacements}
    backup = backup_root/('image-cache-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir(parents=True, mode=0o700)
    manifest = {}
    for index, (path, content) in enumerate(before.items()):
        name = f'{index}-{path.name}'
        manifest[str(path)] = name if content is not None else None
        if content is not None:
            (backup/name).write_bytes(content)
    (backup/'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    try:
        for path, content in replacements.items():
            install(path, content)
        run('nginx', '-t')
        run('systemctl', 'reload', 'nginx')
        verify()
    except BaseException:
        for path, content in before.items():
            if content is None:
                path.unlink(missing_ok=True)
            else:
                install(path, content)
        run('nginx', '-t')
        run('systemctl', 'reload', 'nginx')
        raise
    return backup


def verify_live(origin):
    base = origin.rstrip('/') + '/landscape'
    with urllib.request.urlopen(base+'/api/health', timeout=20) as response:
        if json.load(response)['status'] != 'ok':
            raise RuntimeError('Application health failed')
        if 'no-store' not in response.headers.get('Cache-Control', ''):
            raise RuntimeError('API caching changed')
    with urllib.request.urlopen(base+'/api/recipes?page_size=1', timeout=20) as response:
        recipes = json.load(response)['recipes']
    if not recipes:
        raise ValueError('Need one existing community image for verification')
    name = (recipes[0]['cover_after'] or recipes[0]['cover_before']).rsplit('/', 1)[-1]
    url = base+'/api/thumb/'+name+'?w=800'
    # systemctl reload returns after signalling the master. Old workers may still
    # accept the next connection before the replacement workers become ready.
    deadline = time.monotonic() + 10
    cache, policy = None, ''
    while time.monotonic() < deadline:
        with urllib.request.urlopen(urllib.request.Request(url, method='HEAD'),
                                    timeout=max(.1, deadline-time.monotonic())) as response:
            headers = response.headers
            policy = ','.join(headers.get_all('Cache-Control', []))
            cache = headers.get('X-Landscape-Image-Cache')
            if 'no-store' not in policy and 'public' in policy and cache == 'HIT':
                return
        time.sleep(.25)
    raise RuntimeError(f'New image cache did not become ready within 10s (cache={cache}, policy={policy})')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--origin', default='https://47.101.37.232')
    args = parser.parse_args()
    origin = urlsplit(args.origin)
    if origin.scheme not in ('https', 'http') or not origin.netloc or origin.path not in ('', '/') or origin.query or origin.fragment:
        parser.error('Origin must contain only scheme and host')
    replacements = plan(Path(__file__).resolve().parent, NGINX)
    if not args.apply:
        print('Dry-run: ' + ', '.join(map(str, replacements)))
        return
    if os.geteuid() != 0:
        raise SystemExit('Administrator execution is required to update Nginx.')
    backup = upgrade(replacements, BACKUPS, lambda: verify_live(args.origin))
    print(json.dumps({'applied': True, 'image_cache': 'HIT', 'backup': str(backup)}))


if __name__ == '__main__':
    main()
