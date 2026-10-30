"""Persistent, atomic authentication throttles and one-use image challenges."""
import base64
import hashlib
import hmac
import io
import secrets
import time

from flask import jsonify, request
from PIL import Image, ImageDraw, ImageFont
from .db import get_db


class Throttled(Exception):
    def __init__(self, seconds):
        self.seconds = max(1, int(seconds))


def subject(value):
    return hashlib.sha256(str(value).encode()).hexdigest()


def limits(*rules):
    """Own transaction: rejected business operations cannot roll back counters."""
    now, conn = int(time.time()), get_db()
    try:
        conn.execute('BEGIN IMMEDIATE')
        for action, key, maximum, window in rules:
            row = conn.execute('SELECT * FROM auth_rate_limits WHERE action=? AND subject=?', (action, subject(key))).fetchone()
            if row and now - row['window_start'] < window and row['hits'] >= maximum:
                raise Throttled(window - (now - row['window_start']))
        for action, key, maximum, window in rules:
            conn.execute('''INSERT INTO auth_rate_limits VALUES(?,?,?,1)
                ON CONFLICT(action,subject) DO UPDATE SET
                hits=CASE WHEN ?-window_start>=? THEN 1 ELSE hits+1 END,
                window_start=CASE WHEN ?-window_start>=? THEN ? ELSE window_start END''',
                (action, subject(key), now, now, window, now, window, now))
        conn.execute('DELETE FROM auth_rate_limits WHERE window_start<?', (now-172800,))
        conn.execute('DELETE FROM auth_captchas WHERE expires_at<?', (now-300,))
        conn.execute('DELETE FROM auth_failures WHERE started_at<?', (now-86400,))
        conn.commit()
    finally:
        conn.close()


def ip():
    # ProxyFix is enabled only behind the loopback proxy, which replaces XFF.
    return request.remote_addr or 'unknown'


def install(app):
    @app.errorhandler(Throttled)
    def throttled(error):
        response = jsonify(error=f'操作过于频繁，请在 {error.seconds} 秒后重试。', code='rate_limited', retry_after_seconds=error.seconds)
        response.status_code = 429
        response.headers['Retry-After'] = str(error.seconds)
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.before_request
    def guard_auth():
        path = request.path
        if path.startswith('/api/auth/') and request.method in ('POST', 'GET') and path != '/api/auth/me':
            request.max_content_length = 16384
            limits(('auth-ip', ip(), 300, 600), ('auth-global', 'site', 1800, 600))
            if path == '/api/auth/register':
                limits(('register-hour', ip(), 10, 3600), ('register-day', ip(), 30, 86400))
            elif path == '/api/auth/login':
                limits(('login-minute', ip(), 30, 60), ('login-ten-minutes', ip(), 100, 600))
            elif path == '/api/auth/logout':
                limits(('logout-ip', ip(), 30, 60))
            elif path == '/api/auth/captcha':
                limits(('captcha-ip', ip(), 30, 600), ('captcha-global', 'site', 300, 600))
        if path == '/api/users/me/password' and request.method == 'PUT':
            request.max_content_length = 16384
            limits(('password-change-ip', ip(), 10, 600))


def login_state(username):
    conn, now = get_db(), int(time.time())
    try:
        rows = conn.execute('SELECT * FROM auth_failures WHERE subject IN (?,?)',
            (subject('pair:'+ip()+':'+username), subject('account:'+username))).fetchall()
        recent = [r for r in rows if now-r['started_at'] < 900]
        for r in recent:
            if r['subject'] == subject('pair:'+ip()+':'+username) and r['cooldown_until'] > now:
                raise Throttled(r['cooldown_until']-now)
        return any(r['hits'] >= 5 for r in recent)
    finally:
        conn.close()


def login_failed(username):
    now, conn = int(time.time()), get_db()
    try:
        conn.execute('BEGIN IMMEDIATE')
        for key in ('pair:'+ip()+':'+username, 'account:'+username):
            row = conn.execute('SELECT * FROM auth_failures WHERE subject=?', (subject(key),)).fetchone()
            fresh = not row or now-row['started_at'] >= 900
            hits = 1 if fresh else row['hits']+1
            until = now+60 if key.startswith('pair:') and hits >= 10 else 0
            conn.execute('INSERT OR REPLACE INTO auth_failures VALUES(?,?,?,?)', (subject(key), now if fresh else row['started_at'], hits, until))
        conn.commit()
    finally:
        conn.close()


def login_succeeded(username):
    conn = get_db()
    try:
        conn.execute('DELETE FROM auth_failures WHERE subject=?', (subject('pair:'+ip()+':'+username),))
        conn.commit()
    finally:
        conn.close()


def captcha_response(purpose):
    if purpose not in ('login', 'email'):
        return jsonify(error='验证用途不正确。'), 400
    answer = ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(5))
    identifier, salt = secrets.token_urlsafe(24), secrets.token_hex(16)
    image = Image.new('RGB', (180, 56), '#f7f0e6')
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype('DejaVuSans.ttf', 30)
    except OSError:
        font = ImageFont.load_default(size=30)
    for _ in range(7):
        draw.line([(secrets.randbelow(180), secrets.randbelow(56)), (secrets.randbelow(180), secrets.randbelow(56))], fill='#c9b99e', width=1)
    for n, char in enumerate(answer):
        draw.text((12+n*32, 7+secrets.randbelow(7)), char, font=font, fill='#4e3926', stroke_width=1)
    output = io.BytesIO(); image.save(output, format='PNG')
    conn = get_db()
    try:
        conn.execute('INSERT INTO auth_captchas VALUES(?,?,?,?,?,?)',
            (identifier, subject(ip()), purpose, salt, subject(salt+answer), int(time.time())+180))
        conn.commit()
    finally:
        conn.close()
    response = jsonify(captcha_id=identifier, image='data:image/png;base64,'+base64.b64encode(output.getvalue()).decode(), expires_in_seconds=180)
    response.headers['Cache-Control'] = 'no-store'
    return response


def consume_captcha(data, purpose):
    identifier, answer = data.get('captcha_id'), data.get('captcha_answer')
    if not isinstance(identifier, str) or not isinstance(answer, str) or len(identifier)>80 or len(answer)>20:
        return False
    conn = get_db()
    try:
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT * FROM auth_captchas WHERE id=?', (identifier,)).fetchone()
        if row:
            conn.execute('DELETE FROM auth_captchas WHERE id=?', (identifier,))
        conn.commit()
        return bool(row and row['subject']==subject(ip()) and row['purpose']==purpose and row['expires_at']>=int(time.time())
                    and hmac.compare_digest(subject(row['salt']+answer.strip().upper()), row['answer_hash']))
    finally:
        conn.close()


def captcha_required():
    return jsonify(error='请完成图形验证后重试。', code='captcha_required'), 400
