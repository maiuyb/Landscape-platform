"""Root-console installer for Landscape IP TLS, renewal and auth edge limits.

Preserves the existing HTTP root site, all application data and SMTP settings.
No private configuration or certificate key is printed. Run explicitly with sudo.
"""
import datetime
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import socket
import ssl
import subprocess
import tempfile
import urllib.error
import urllib.request

IP = '47.101.37.232'
STATE = Path('/opt/landscape/https-status.json')
BACKUP = Path('/var/backups/landscape-auth-https-20261030')
SITE = Path('/etc/nginx/sites-enabled/default').resolve()
HTTP = Path('/etc/nginx/snippets/landscape.conf')
RATES = Path('/etc/nginx/conf.d/landscape-auth-rates.conf')
TLS = Path('/etc/nginx/conf.d/landscape-https.conf')
PROXY = Path('/etc/nginx/snippets/landscape-https-proxy.conf')
ENV = Path('/etc/landscape/landscape.env')
CHALLENGE = Path('/var/lib/landscape-acme')
CERTBOT = '/opt/landscape-certbot/bin/certbot'
HOOK = Path('/usr/local/sbin/landscape-cert-renewed')
FILES = [SITE, HTTP, RATES, TLS, PROXY, ENV]
_stage = 'not_started'
_details = {}


def report(stage, state='running', **details):
    global _stage
    _stage = stage
    # Only explicit diagnostic categories, never exception messages or config contents.
    for key in ('failed_stage', 'error_type', 'ufw_status', 'local_tls_ok'):
        if key in details:
            _details[key] = details[key]
    payload=dict(stage=stage,state=state,time=datetime.datetime.now(datetime.timezone.utc).isoformat(),**_details)
    with tempfile.NamedTemporaryFile(mode='w',dir=STATE.parent,delete=False) as f:
        temporary=Path(f.name)
        json.dump(payload,f);f.write('\n');f.flush();os.fsync(f.fileno())
    temporary.chmod(0o644);os.replace(temporary,STATE)
    print(stage, flush=True)


def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600)


def backup():
    BACKUP.mkdir(mode=0o700, parents=True, exist_ok=True)
    BACKUP.chmod(0o700)
    manifest = BACKUP/'manifest.json'
    if manifest.exists():
        return
    records=[]
    for index, path in enumerate(FILES):
        item=dict(path=str(path),exists=path.exists(),copy=str(index))
        if path.exists():
            stat=path.stat();item.update(uid=stat.st_uid,gid=stat.st_gid,mode=stat.st_mode&0o777)
            shutil.copyfile(path,BACKUP/str(index));(BACKUP/str(index)).chmod(0o600)
        records.append(item)
    manifest.write_text(json.dumps(records));manifest.chmod(0o600)


def restore():
    for item in json.loads((BACKUP/'manifest.json').read_text()):
        target=Path(item['path'])
        if item['exists']:
            shutil.copyfile(BACKUP/item['copy'],target);os.chown(target,item['uid'],item['gid']);target.chmod(item['mode'])
        elif target.exists():
            target.unlink()
    run('nginx','-t');run('systemctl','reload','nginx');run('systemctl','restart','landscape.service')


def health(url):
    with urllib.request.urlopen(url,timeout=20) as response:
        result=json.load(response)
    if result.get('status')!='ok':
        raise RuntimeError('Health check failed')


def local_tls_health():
    """Validate the real IP SAN and trust chain while connecting over loopback."""
    with socket.create_connection(('127.0.0.1',443),timeout=10) as raw:
        with ssl.create_default_context().wrap_socket(raw,server_hostname=IP) as tls:
            tls.sendall(('GET /landscape/api/health HTTP/1.1\r\nHost: '+IP+'\r\nConnection: close\r\n\r\n').encode('ascii'))
            response=http.client.HTTPResponse(tls);response.begin()
            if response.status!=200 or json.load(response).get('status')!='ok':
                raise RuntimeError('Local TLS health check failed')


def allow_https_firewall():
    """Add only an IPv4 TCP 443 allow rule if host UFW is active."""
    ufw=shutil.which('ufw')
    if not ufw:
        return 'not_installed',False
    env={**os.environ,'LC_ALL':'C'}
    status=subprocess.run([ufw,'status'],capture_output=True,text=True,check=True,env=env,timeout=30).stdout
    if not re.search(r'^Status: active\s*$',status,re.M):
        return 'inactive',False
    if re.search(r'^\s*443(?:/tcp)?\s+ALLOW(?: IN)?\s+Anywhere\s*$',status,re.M):
        return 'already_allowed',False
    # Explicit IPv4 avoids changing any separately configured IPv6 rules.
    result=subprocess.run([ufw,'allow','proto','tcp','from','0.0.0.0/0','to','any','port','443'],
        capture_output=True,text=True,check=True,env=env,timeout=30)
    changed='skipping adding existing rule' not in result.stdout.lower()
    return ('added' if changed else 'already_allowed'),changed


def remove_added_firewall_rule():
    ufw=shutil.which('ufw')
    if not ufw:
        raise RuntimeError('UFW is unavailable for rollback')
    run(ufw,'--force','delete','allow','proto','tcp','from','0.0.0.0/0','to','any','port','443')


def main():
    global SITE, FILES
    if os.geteuid()!=0:
        raise SystemExit('Run with sudo in the server console. Do not send your password to chat.')
    candidates=[p.resolve() for p in Path('/etc/nginx/sites-enabled').glob('*')
                if p.is_file() and 'include /etc/nginx/snippets/landscape.conf;' in p.read_text()]
    if len(candidates)!=1:
        raise SystemExit('Cannot identify a single existing Landscape HTTP site; stop for review.')
    SITE=candidates[0];FILES=[SITE, HTTP, RATES, TLS, PROXY, ENV]
    if not SITE.is_relative_to('/etc/nginx') or not SITE.is_file() or not HTTP.is_file() or not ENV.is_file():
        raise SystemExit('Existing deployment differs; stop for review.')
    if STATE.exists() and json.loads(STATE.read_text()).get('state')=='success':
        health(f'https://{IP}/landscape/api/health');print('HTTPS is already active.');return
    before=SITE.read_text()
    if before.count('server {')!=1 or not before.rstrip().endswith('}') or 'include /etc/nginx/snippets/landscape.conf;' not in before:
        raise SystemExit('Existing HTTP site differs; stop for review.')
    backup()
    firewall_added=False
    try:
        report('prepare_http_challenge')
        CHALLENGE.mkdir(parents=True,exist_ok=True);CHALLENGE.chmod(0o755)
        if 'location ^~ /.well-known/acme-challenge/' not in before:
            insert='\n    location ^~ /.well-known/acme-challenge/ {\n        root /var/lib/landscape-acme;\n        default_type text/plain;\n        try_files $uri =404;\n    }\n'
            SITE.write_text(before.rstrip()[:-1]+insert+'}\n')
        run('nginx','-t');run('systemctl','reload','nginx')
        report('install_certificate_client')
        if not Path(CERTBOT).exists():
            run('python3','-m','venv','/opt/landscape-certbot')
        run('/opt/landscape-certbot/bin/python','-m','pip','install','--upgrade','certbot>=5.4,<6')
        HOOK.write_text('#!/bin/sh\nset -eu\n/usr/sbin/nginx -t\n/bin/systemctl reload nginx\n');HOOK.chmod(0o755)
        args=[CERTBOT,'certonly','--non-interactive','--agree-tos','--register-unsafely-without-email',
              '--preferred-profile','shortlived','--webroot','--webroot-path',str(CHALLENGE),
              '--ip-address',IP,'--cert-name','landscape-ip','--deploy-hook',str(HOOK)]
        certificate=Path('/etc/letsencrypt/live/landscape-ip/fullchain.pem')
        if not certificate.exists():
            report('certificate_staging_validation');run(*args,'--dry-run')
        report('obtain_trusted_certificate');run(*args,'--keep-until-expiring')
        report('configure_https_and_edge_limits')
        RATES.write_text('limit_req_zone $binary_remote_addr zone=landscape_auth_ip:10m rate=2r/s;\n'
                         'limit_req_zone $server_name zone=landscape_auth_site:1m rate=10r/s;\n')
        upstream='''    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Prefix /landscape;
    proxy_read_timeout 90s;
    proxy_connect_timeout 5s;
    add_header Cache-Control "no-store" always;
'''
        PROXY.write_text('location = /landscape { return 308 /landscape/; }\n'
            'location ^~ /landscape/api/auth/ {\n'
            '    limit_req zone=landscape_auth_ip burst=10 nodelay;\n'
            '    limit_req zone=landscape_auth_site burst=20 nodelay;\n'
            '    limit_req_status 429;\n    error_page 429 = @landscape_auth_limited;\n'
            '    client_max_body_size 16k;\n    proxy_pass http://127.0.0.1:5051/api/auth/;\n'+upstream+'}\n'
            'location @landscape_auth_limited {\n    default_type application/json;\n'
            '    add_header Retry-After 5 always;\n    add_header Cache-Control "no-store" always;\n'
            '    return 429 \'{"error":"操作过于频繁，请稍后重试。","code":"rate_limited","retry_after_seconds":5}\';\n}\n'
            'location /landscape/ {\n    proxy_pass http://127.0.0.1:5051/;\n    client_max_body_size 21m;\n'+upstream+'}\n')
        TLS.write_text('server {\n    listen 443 ssl;\n    server_name '+IP+';\n'
            '    ssl_certificate /etc/letsencrypt/live/landscape-ip/fullchain.pem;\n'
            '    ssl_certificate_key /etc/letsencrypt/live/landscape-ip/privkey.pem;\n'
            '    ssl_protocols TLSv1.2 TLSv1.3;\n    include /etc/nginx/snippets/landscape-https-proxy.conf;\n'
            '    location / { return 302 http://'+IP+'$request_uri; }\n}\n')
        run('nginx','-t');run('systemctl','reload','nginx')
        report('verify_local_tls')
        local_tls_health()
        report('configure_host_firewall',local_tls_ok=True)
        ufw_status,firewall_added=allow_https_firewall()
        # Do not redirect users away from a working HTTP site until public TLS works.
        report('verify_public_https',ufw_status=ufw_status)
        health(f'https://{IP}/landscape/api/health')
        report('activate_https_origin')
        stat=ENV.stat();lines=ENV.read_text().splitlines();lines=[line for line in lines if not line.startswith('PUBLIC_ORIGIN=')]
        lines.append('PUBLIC_ORIGIN=https://'+IP)
        temporary=ENV.with_name('.landscape.env.https-tmp')
        fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        try:
            with os.fdopen(fd,'w') as f:f.write('\n'.join(lines)+'\n')
            os.chown(temporary,stat.st_uid,stat.st_gid);temporary.chmod(stat.st_mode&0o777);os.replace(temporary,ENV)
        finally:
            if temporary.exists():temporary.unlink()
        run('systemctl','restart','landscape.service')
        # Give Gunicorn a bounded moment to finish starting.
        import time
        for attempt in range(15):
            try:health(f'https://{IP}/landscape/api/health');break
            except Exception:
                if attempt==14:raise
                time.sleep(1)
        HTTP.write_text('location = /landscape { return 308 https://'+IP+'/landscape/; }\n'
                        'location /landscape/ { return 308 https://'+IP+'$request_uri; }\n')
        run('nginx','-t');run('systemctl','reload','nginx')
        Path('/etc/systemd/system/landscape-cert-renew.service').write_text(
            '[Unit]\nDescription=Renew Landscape IP certificate\nAfter=network-online.target\nWants=network-online.target\n'
            '[Service]\nType=oneshot\nExecStart='+CERTBOT+' renew --quiet --cert-name landscape-ip\n')
        Path('/etc/systemd/system/landscape-cert-renew.timer').write_text(
            '[Unit]\nDescription=Check Landscape IP certificate every six hours\n'
            '[Timer]\nOnCalendar=*-*-* 00,06,12,18:00:00\nRandomizedDelaySec=30m\nPersistent=true\n'
            '[Install]\nWantedBy=timers.target\n')
        run('systemctl','daemon-reload');run('systemctl','enable','--now','landscape-cert-renew.timer')
        health(f'https://{IP}/landscape/api/health')
        report('complete','success')
        print('HTTPS is active. Use https://'+IP+'/landscape/ and sign in again.')
    except Exception as error:
        failed_stage=_stage
        cause=error.reason if isinstance(error,urllib.error.URLError) else error
        error_type=type(cause).__name__
        report('restore_previous_http_configuration','running',failed_stage=failed_stage,error_type=error_type)
        try:
            restore()
            if firewall_added:
                remove_added_firewall_rule()
            report('failed_previous_site_restored','failed')
        except Exception:
            report('failed_restore_needs_administrator','failed')
        print('Failed at '+failed_stage+' ('+error_type+'). No secrets were printed.')
        print('Check TCP 443 cloud security-group access if local TLS passed; diagnostic categories were saved for the assistant.')
        raise SystemExit(1)


if __name__=='__main__':main()
