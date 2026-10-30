# -*- coding: utf-8 -*-
"""Private credits and mailbox ownership; all balance changes use SQLite transactions."""
from datetime import datetime, timedelta, timezone
from email.header import Header
from email.mime.text import MIMEText
from email.utils import formataddr
from hashlib import sha256
from html import escape
from pathlib import Path
import hmac
import os
import re
import secrets
import smtplib
import sqlite3
import ssl
import time
from urllib.parse import urlencode, urlsplit

from dotenv import dotenv_values
from flask import Blueprint, jsonify, request, Response, redirect
from .auth import current_user, hash_password
from .db import get_db
from . import repository as repo

credits_bp = Blueprint('credits', __name__)
ENV_PATH = Path(__file__).resolve().parents[3] / '.env'
INITIAL_CREDITS, DAILY_CHECKIN_CREDITS, EMAIL_BIND_BONUS_CREDITS = 10, 3, 5
AI_RECOMMEND_COST, CODE_TTL_HOURS, EMAIL_CODE_TTL_MINUTES = 1, 24, 10
EMAIL_RE = re.compile(r'[A-Za-z0-9._%+\-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,63}')


def _shanghai_now():
    return (datetime.now(timezone.utc) + timedelta(hours=8)).replace(tzinfo=None)


def _shanghai_dt_str(dt=None):
    return (dt or _shanghai_now()).strftime('%Y-%m-%d %H:%M:%S')


def _email(value):
    if not isinstance(value, str):
        return None
    value = value.strip().lower()
    local = value.split('@')[0]
    return value if len(value) <= 120 and EMAIL_RE.fullmatch(value) and not local.startswith('.') and not local.endswith('.') and '..' not in local else None


def _data():
    value = request.get_json(silent=True)
    return value if isinstance(value, dict) else {}


def _smtp_config():
    values = dotenv_values(ENV_PATH) if ENV_PATH.is_file() else {}
    def pick(key, default=''):
        return str(os.environ.get(key, values.get(key, default)) or '').strip()
    try:
        port = int(pick('SMTP_PORT', '465'))
    except ValueError:
        port = 465
    user = pick('SMTP_USER')
    return dict(host=pick('SMTP_HOST', 'smtp.163.com'), port=port, user=user,
                password=pick('SMTP_PASS'), admin_email=pick('SPONSOR_ADMIN_EMAIL', user),
                public_origin=pick('PUBLIC_ORIGIN').rstrip('/'),
                configured=bool(pick('SMTP_HOST', 'smtp.163.com') and user and pick('SMTP_PASS')))


def send_email_163(to_email, subject, html_body):
    """No preview credentials and no raw SMTP errors in public responses."""
    cfg = _smtp_config()
    if not cfg['configured']:
        return {'sent': False, 'mode': 'unavailable'}
    msg = MIMEText(html_body, 'html', 'utf-8')
    msg['From'] = formataddr((str(Header('山川显影 · 风景调色平台', 'utf-8')), cfg['user']))
    msg['To'], msg['Subject'] = to_email, Header(subject, 'utf-8')
    try:
        if cfg['port'] == 465:
            smtp = smtplib.SMTP_SSL(cfg['host'], cfg['port'], timeout=12, context=ssl.create_default_context())
        else:
            smtp = smtplib.SMTP(cfg['host'], cfg['port'], timeout=12)
            smtp.ehlo()
            smtp.starttls(context=ssl.create_default_context())
            smtp.ehlo()
        try:
            smtp.login(cfg['user'], cfg['password'])
            smtp.sendmail(cfg['user'], [to_email], msg.as_string())
            # A failed QUIT after accepted DATA must not cause duplicate delivery.
        finally:
            try:
                smtp.quit()
            except Exception:
                smtp.close()
        return {'sent': True, 'mode': 'smtp'}
    except (OSError, smtplib.SMTPException, ValueError):
        return {'sent': False, 'mode': 'error'}


class Limited(Exception):
    pass


def _limit(conn, action, subject, count, seconds):
    now = int(time.time())
    subject = sha256(str(subject).encode()).hexdigest()
    row = conn.execute('SELECT * FROM credit_rate_limits WHERE action=? AND subject=?', (action, subject)).fetchone()
    if row and now - row['window_start'] < seconds:
        if row['hits'] >= count:
            raise Limited(seconds - (now - row['window_start']))
        conn.execute('UPDATE credit_rate_limits SET hits=hits+1 WHERE action=? AND subject=?', (action, subject))
    else:
        conn.execute('INSERT OR REPLACE INTO credit_rate_limits VALUES (?,?,?,1)', (action, subject, now))
    conn.execute('DELETE FROM credit_rate_limits WHERE window_start < ?', (now - 172800,))


def _limited(error):
    wait = max(1, int(error.args[0]))
    response = jsonify(error=f'操作过于频繁，请在 {wait} 秒后重试。', retry_after_seconds=wait)
    response.headers['Retry-After'] = str(wait)
    return response, 429


def _user_payload(conn, uid):
    return repo.serialize_user(conn, repo.get_user_by_id(conn, uid), self_view=True)


@credits_bp.after_request
def private_response(response):
    response.headers['Cache-Control'] = 'no-store'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


def _recover_ai_credits(conn):
    # Five minutes exceeds the bounded upstream/request lifetime. Refund each stale hold once.
    stale = int(time.time()) - 300
    rows = conn.execute("SELECT user_id,count(*) n FROM ai_credit_reservations WHERE status='reserved' AND created_at<? GROUP BY user_id", (stale,)).fetchall()
    for row in rows:
        conn.execute('UPDATE users SET credits=credits+? WHERE id=?', (row['n'], row['user_id']))
    conn.execute("UPDATE ai_credit_reservations SET status='refunded' WHERE status='reserved' AND created_at<?", (stale,))
    conn.execute('DELETE FROM ai_credit_reservations WHERE created_at<? AND status<>?', (int(time.time())-604800, 'reserved'))


def _reserve_ai_credit(uid):
    conn = get_db()
    try:
        conn.execute('BEGIN IMMEDIATE')
        _recover_ai_credits(conn)
        changed = conn.execute('UPDATE users SET credits=credits-1 WHERE id=? AND credits>=1', (uid,)).rowcount
        if not changed:
            conn.commit()
            return None
        reservation = secrets.token_hex(24)
        conn.execute('INSERT INTO ai_credit_reservations VALUES (?,?,?,?)', (reservation, uid, 'reserved', int(time.time())))
        conn.commit()
        return reservation
    finally:
        conn.close()


def _finish_ai_credit(reservation, charge):
    conn = get_db()
    try:
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT * FROM ai_credit_reservations WHERE id=?', (reservation,)).fetchone()
        if row and row['status'] == 'reserved':
            if not charge:
                conn.execute('UPDATE users SET credits=credits+1 WHERE id=?', (row['user_id'],))
            conn.execute('UPDATE ai_credit_reservations SET status=? WHERE id=?', ('charged' if charge else 'refunded', reservation))
        result = conn.execute('SELECT credits FROM users WHERE id=?', (row['user_id'],)).fetchone() if row else None
        conn.commit()
        return int(result['credits']) if result else 0
    finally:
        conn.close()


@credits_bp.route('/api/credits/status')
def credits_status():
    user = current_user()
    data = {'authenticated': bool(user), 'smtp_configured': _smtp_config()['configured'],
            'rules': dict(initial=10, daily_checkin=3, email_bind_bonus=5, ai_recommend_cost=1, code_ttl_hours=24)}
    if user:
        conn = get_db()
        try:
            conn.execute('BEGIN IMMEDIATE')
            _recover_ai_credits(conn)
            serialized = _user_payload(conn, user['id'])
            conn.commit()
            data.update({key: serialized[key] for key in ('credits', 'checked_in_today', 'email', 'email_verified')})
            data['user'] = serialized
        finally:
            conn.close()
    return jsonify(data)


@credits_bp.route('/api/credits/checkin', methods=['POST'])
def daily_checkin():
    user = current_user()
    if not user:
        return jsonify(error='请先登录后再签到'), 401
    conn = get_db()
    try:
        today = _shanghai_now().strftime('%Y-%m-%d')
        conn.execute('BEGIN IMMEDIATE')
        changed = conn.execute("UPDATE users SET credits=credits+3,last_checkin_date=? WHERE id=? AND COALESCE(last_checkin_date,'')<>?", (today, user['id'], today)).rowcount
        serialized = _user_payload(conn, user['id'])
        conn.commit()
        if not changed:
            return jsonify(error='今日已签到，明天再来吧。', checked_in_today=True, credits=serialized['credits']), 400
        return jsonify(ok=True, added=3, user=serialized, checked_in_today=True, credits=serialized['credits'], message='签到成功！显影积分 +3')
    finally:
        conn.close()


@credits_bp.route('/api/auth/email/send-code', methods=['POST'])
def send_email_code():
    data, user = _data(), current_user()
    email = _email(data.get('email'))
    purpose = 'bind' if user else 'login'
    if not email or data.get('purpose', purpose) != purpose:
        return jsonify(error='邮箱地址或验证用途不正确，请重新打开登录／绑定入口。'), 400
    if not _smtp_config()['configured']:
        return jsonify(error='邮箱服务暂不可用，请使用账号密码登录或稍后重试。'), 503
    code, salt = str(secrets.randbelow(900000)+100000), secrets.token_hex(16)
    digest = salt + ':' + sha256((salt+code).encode()).hexdigest()
    conn = get_db()
    try:
        conn.execute('BEGIN IMMEDIATE')
        _limit(conn, 'email-minute', email, 1, 60)
        _limit(conn, 'email-hour', email, 5, 3600)
        _limit(conn, 'email-ip', request.remote_addr, 20, 600)
        _limit(conn, 'email-ip-day', request.remote_addr, 100, 86400)
        owner = user['id'] if user else None
        conn.execute('UPDATE email_verifications SET used=1 WHERE email=? AND purpose=? AND user_id IS ?', (email, purpose, owner))
        cur = conn.execute('INSERT INTO email_verifications (email,code,purpose,user_id,expires_at,created_at) VALUES (?,?,?,?,?,?)',
                           (email, digest, purpose, owner, _shanghai_dt_str(_shanghai_now()+timedelta(minutes=10)), _shanghai_dt_str()))
        challenge = cur.lastrowid
        conn.execute('DELETE FROM email_verifications WHERE expires_at<?', (_shanghai_dt_str(_shanghai_now()-timedelta(days=1)),))
        conn.commit()
        result = send_email_163(email, '【山川显影】邮箱验证码', '<h2>山川显影 · 邮箱验证</h2><p>你的验证码：<strong>'+code+'</strong></p><p>10 分钟内有效。若非本人操作，请忽略此邮件。</p>')
        conn.execute('UPDATE email_verifications SET delivered=?,used=CASE WHEN ?=0 THEN 1 ELSE used END WHERE id=?', (int(result['sent']), int(result['sent']), challenge))
        conn.commit()
        if not result['sent']:
            return jsonify(error='验证码邮件发送失败，请稍后重试。'), 502
        return jsonify(ok=True, email=email, smtp_sent=True, expires_in_seconds=600, message='验证码已发送，请在 10 分钟内输入。')
    except Limited as error:
        conn.rollback()
        return _limited(error)
    finally:
        conn.close()


@credits_bp.route('/api/auth/email/verify', methods=['POST'])
def verify_email_code():
    data, user = _data(), current_user()
    email, code = _email(data.get('email')), data.get('code')
    purpose, uid = ('bind', user['id']) if user else ('login', None)
    if not email or not isinstance(code, str) or not re.fullmatch(r'[0-9]{6}', code) or data.get('purpose', purpose) != purpose:
        return jsonify(error='请填写正确邮箱和 6 位验证码。'), 400
    conn = get_db()
    try:
        conn.execute('BEGIN IMMEDIATE')
        _limit(conn, 'verify-ip', request.remote_addr, 30, 600)
        row = conn.execute('SELECT * FROM email_verifications WHERE email=? AND purpose=? AND user_id IS ? ORDER BY id DESC LIMIT 1', (email, purpose, uid)).fetchone()
        if not row or row['used'] or not row['delivered'] or row['expires_at'] < _shanghai_dt_str() or row['attempts'] >= 5:
            conn.commit()
            return jsonify(error='验证码错误或已失效，请重新获取。'), 400
        salt, _, digest = row['code'].partition(':')
        if not digest or not hmac.compare_digest(sha256((salt+code).encode()).hexdigest(), digest):
            conn.execute('UPDATE email_verifications SET attempts=attempts+1,used=CASE WHEN attempts>=4 THEN 1 ELSE 0 END WHERE id=?', (row['id'],))
            conn.commit()
            return jsonify(error='验证码错误；连续错误 5 次后需重新获取。'), 400
        existing = conn.execute("SELECT * FROM users WHERE lower(trim(email))=? AND email_verified=1", (email,)).fetchone()
        if user and existing and existing['id'] != uid:
            conn.execute('UPDATE email_verifications SET used=1 WHERE id=?', (row['id'],))
            conn.commit()
            return jsonify(error='此邮箱已绑定其他账号，请使用其他邮箱。'), 409
        conn.execute('UPDATE email_verifications SET used=1 WHERE id=?', (row['id'],))
        token, bonus = None, 0
        if user:
            fresh = repo.get_user_by_id(conn, uid)
            bonus = 0 if fresh['email_verified'] else 5
            conn.execute('UPDATE users SET email=?,email_verified=1,credits=credits+? WHERE id=?', (email, bonus, uid))
        elif existing:
            uid = existing['id']
        else:
            name = re.sub(r'[^A-Za-z0-9_]', '', email.split('@')[0])[:12] or 'user'
            candidate = name
            while repo.get_user_by_username(conn, candidate):
                candidate = name+'_'+secrets.token_hex(3)
            uid = conn.execute('INSERT INTO users(username,password_hash,display_name,email,email_verified,credits) VALUES(?,?,?,?,1,15)', (candidate, hash_password(secrets.token_hex(32)), candidate, email)).lastrowid
            bonus = 5
        if not user:
            token = secrets.token_urlsafe(32)
            conn.execute('INSERT INTO sessions(token,user_id) VALUES(?,?)', (token, uid))
        serialized = _user_payload(conn, uid)
        conn.commit()
        result = dict(ok=True, mode=purpose if user else 'login', user=serialized, credits=serialized['credits'], bonus_credits=bonus, message='邮箱绑定成功。' if user else '邮箱验证成功，已登录。')
        if token:
            result['token'] = token
        return jsonify(result)
    except Limited as error:
        conn.rollback()
        return _limited(error)
    except sqlite3.IntegrityError:
        conn.rollback()
        return jsonify(error='邮箱绑定冲突，请重新获取验证码。'), 409
    finally:
        conn.close()


def generate_redemption_code(conn, credits, recipient_email='', ttl_hours=24, max_uses=1, *, commit=True):
    if type(credits) is not int or not 1 <= credits <= 1000 or not 1 <= ttl_hours <= 24 or max_uses != 1:
        raise ValueError('Invalid redemption terms')
    alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
    for _ in range(10):
        code = 'LC-'+''.join(secrets.choice(alphabet) for _ in range(4))+'-'+''.join(secrets.choice(alphabet) for _ in range(4))
        try:
            expires = _shanghai_dt_str(_shanghai_now()+timedelta(hours=ttl_hours))
            conn.execute('INSERT INTO redemption_codes(code,credits,max_uses,used_count,recipient_email,expires_at,created_at) VALUES(?,?,1,0,?,?,?)', (code, credits, recipient_email, expires, _shanghai_dt_str()))
            if commit:
                conn.commit()
            return dict(code=code, credits=credits, expires_at=expires, max_uses=1)
        except sqlite3.IntegrityError:
            continue
    raise RuntimeError('Unable to allocate redemption code')


@credits_bp.route('/api/credits/redeem', methods=['POST'])
def redeem_code():
    user, data = current_user(), _data()
    if not user:
        return jsonify(error='请先登录后再使用兑换码。'), 401
    code = data.get('code')
    if not isinstance(code, str) or not 1 <= len(code.strip()) <= 40:
        return jsonify(error='请输入有效兑换码。'), 400
    code = code.strip().upper()
    conn = get_db()
    try:
        conn.execute('BEGIN IMMEDIATE')
        _limit(conn, 'redeem-user', user['id'], 30, 600)
        if conn.execute('SELECT 1 FROM redemption_history WHERE user_id=? AND code=?', (user['id'], code)).fetchone():
            conn.commit()
            return jsonify(error='你已核销过此兑换码。'), 400
        if code == 'LANDSCAPE2026':
            added = 10
        else:
            row = conn.execute('SELECT * FROM redemption_codes WHERE code=?', (code,)).fetchone()
            if not row or row['expires_at'] < _shanghai_dt_str() or row['used_count'] >= row['max_uses']:
                conn.commit()
                return jsonify(error='兑换码无效、已核销或已超过 24 小时有效期。'), 400
            changed = conn.execute('UPDATE redemption_codes SET used_count=used_count+1 WHERE code=? AND used_count<max_uses AND expires_at>=?', (code, _shanghai_dt_str())).rowcount
            if not changed:
                conn.rollback()
                return jsonify(error='此兑换码已失效。'), 400
            added = row['credits']
        conn.execute('UPDATE users SET credits=credits+? WHERE id=?', (added, user['id']))
        conn.execute('INSERT INTO redemption_history(user_id,code,credits,created_at) VALUES(?,?,?,?)', (user['id'], code, added, _shanghai_dt_str()))
        serialized = _user_payload(conn, user['id'])
        conn.commit()
        return jsonify(ok=True, added=added, credits=serialized['credits'], user=serialized, message=f'兑换成功！显影积分 +{added}')
    except Limited as error:
        conn.rollback()
        return _limited(error)
    finally:
        conn.close()


def _approval_url(token):
    origin = _smtp_config()['public_origin']
    if not origin:
        if urlsplit(request.host_url).hostname not in ('localhost', '127.0.0.1', '::1'):
            raise ValueError('Public origin is required')
        origin = request.host_url.rstrip('/')
    parsed = urlsplit(origin)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username:
        raise ValueError('Invalid public origin')
    return origin+request.script_root+'/api/credits/sponsor-approve?'+urlencode({'token': token})


@credits_bp.route('/api/credits/sponsor-notify', methods=['POST'])
def sponsor_notify():
    data, user = _data(), current_user()
    email = _email(data.get('email') or (user['email'] if user else ''))
    note = data.get('amount_note', '')
    if not email or not isinstance(note, str) or len(note) > 160:
        return jsonify(error='请填写有效接收邮箱，备注不超过 160 字。'), 400
    if not _smtp_config()['configured'] or not _email(_smtp_config()['admin_email']):
        return jsonify(error='赞助通知服务暂不可用，请稍后再试。'), 503
    token = secrets.token_urlsafe(32)
    try:
        link = _approval_url(token)
    except ValueError:
        return jsonify(error='赞助通知地址暂不可用，请联系维护者。'), 503
    uid = user['id'] if user else None
    conn = get_db()
    try:
        conn.execute('BEGIN IMMEDIATE')
        _limit(conn, 'sponsor-ip', request.remote_addr, 10, 3600)
        _limit(conn, 'sponsor-email-minute', email, 1, 60)
        _limit(conn, 'sponsor-email', email, 3, 3600)
        row = conn.execute("SELECT * FROM sponsor_requests WHERE user_id IS ? AND email=? AND amount_note=? AND status='pending' AND expires_at>? ORDER BY id DESC LIMIT 1", (uid, email, note, _shanghai_dt_str())).fetchone()
        expires = _shanghai_dt_str(_shanghai_now()+timedelta(hours=48))
        digest = sha256(token.encode()).hexdigest()
        if row and row['notify_status'] == 'sent':
            conn.commit()
            return jsonify(ok=True, request_id=row['id'], smtp_sent=True, message='此申请已通知站长，请等待收款核验，无需重复提交。')
        if row and row['notify_status'] == 'sending' and row['notify_started_at'] > _shanghai_dt_str(_shanghai_now()-timedelta(seconds=120)):
            conn.commit()
            return jsonify(error='通知正在发送，请稍后再试。', request_id=row['id']), 409
        if row:
            rid = row['id']
            conn.execute("UPDATE sponsor_requests SET approve_token=?,expires_at=?,notify_status='sending',notify_started_at=? WHERE id=?", (digest, expires, _shanghai_dt_str(), rid))
        else:
            rid = conn.execute("INSERT INTO sponsor_requests(user_id,email,amount_note,status,issued_code,approve_token,created_at,expires_at,notify_status,notify_started_at) VALUES(?,?,?,'pending','',?,?,?,'sending',?)", (uid, email, note, digest, _shanghai_dt_str(), expires, _shanghai_dt_str())).lastrowid
        conn.commit()
        html = f'<h2>山川显影 · 赞助登记 #{rid}</h2><p>请先核对支付宝实际收款，再进入确认页选择发码档位。</p><p>接收邮箱：{escape(email)}</p><p>备注：{escape(note)}</p><p><a href="{escape(link, quote=True)}">查看申请并确认发码</a></p><p>此审批链接 48 小时有效；兑换码在确认发码后 24 小时有效。</p>'
        sent = send_email_163(_smtp_config()['admin_email'], '【山川显影】赞助登记待核验', html)['sent']
        conn.execute('UPDATE sponsor_requests SET notify_status=? WHERE id=?', ('sent' if sent else 'failed', rid))
        conn.commit()
        if not sent:
            return jsonify(error='申请已记录，但通知邮件发送失败。请稍后重新提交通知；不会重复发放兑换码。', request_id=rid, smtp_sent=False), 502
        return jsonify(ok=True, request_id=rid, smtp_sent=True, message='已通知站长，请等待实际收款核验；确认后兑换码会发送至你的邮箱。')
    except Limited as error:
        conn.rollback()
        return _limited(error)
    finally:
        conn.close()


def _page(body, status=200):
    response = Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>山川显影 · 赞助核验</title><style>body{font:16px/1.8 system-ui;background:#faf9f6;color:#171817;max-width:620px;margin:40px auto;padding:24px}button{padding:10px 20px;background:#1d4d3c;color:white;border:0;border-radius:6px}input,select{padding:8px}code{overflow-wrap:anywhere}</style><h1>赞助核验</h1>'+body+'</html>', status=status, mimetype='text/html')
    response.headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


@credits_bp.route('/api/credits/sponsor-approve', methods=['GET', 'POST'])
def sponsor_approve():
    token = request.args.get('token', '') if request.method == 'GET' else request.form.get('token', '')
    if not isinstance(token, str) or not 20 <= len(token) <= 128:
        return _page('<p>审批链接无效。</p>', 400)
    nonce = request.form.get('confirmation', '')
    cookie = request.cookies.get('landscape_sponsor_confirmation', '')
    if request.method == 'POST' and (not re.fullmatch(r'[A-Za-z0-9_-]{40,128}', nonce) or not re.fullmatch(r'[A-Za-z0-9_-]{40,128}', cookie) or not hmac.compare_digest(nonce, cookie)):
        return _page('<p>请先打开邮件中的确认页，再确认发码。</p>', 403)
    conn = get_db()
    try:
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT * FROM sponsor_requests WHERE approve_token=?', (sha256(token.encode()).hexdigest(),)).fetchone()
        if not row or not row['expires_at'] or row['expires_at'] < _shanghai_dt_str():
            conn.rollback()
            return _page('<p>审批链接不存在或已过期，请让用户重新提交通知。</p>', 410)
        info = f'<p>接收邮箱：{escape(row["email"])}</p><p>赞助备注：{escape(row["amount_note"])}</p>'
        if request.method == 'GET':
            conn.rollback()
            confirmation = secrets.token_urlsafe(32)
            if row['issued_code'] and row['delivery_status'] == 'sent':
                return _page(info+'<p>兑换码已生成并寄送成功。</p><p>已发放并寄送兑换码，无需重复操作。</p>')
            if row['delivery_status'] == 'sending':
                info += '<p>邮件正在发送；若持续未完成，可在两分钟后刷新并重试。</p>'
            action = '重试寄送原兑换码' if row['issued_code'] else '已核对收款，确认发码'
            form = f'<form method="post"><input type="hidden" name="token" value="{escape(token, quote=True)}"><input type="hidden" name="confirmation" value="{confirmation}">'
            if not row['issued_code']:
                form += '<label>发码档位 <select name="credits"><option value="20">¥5 · 20 积分</option><option value="50">¥10 · 50 积分</option><option value="100">¥20 · 100 积分</option></select></label><p>请先在支付宝核对实际收款，提交赞助登记不代表已经支付。</p>'
            response = _page(info+form+f'<button type="submit">{action}</button></form>')
            response.set_cookie('landscape_sponsor_confirmation', confirmation, httponly=True, secure=request.is_secure, samesite='Strict', path=request.path if not request.script_root else request.script_root+request.path, max_age=600)
            return response
        if not _smtp_config()['configured']:
            conn.rollback()
            return _page(info+'<p>邮件服务暂不可用，未发码，请稍后重试。</p>', 503)
        if row['delivery_status'] == 'sent':
            conn.rollback()
            return _page(info+'<p>此申请已发码并寄送，无需重复操作。</p>')
        if row['delivery_status'] == 'sending' and row['delivery_started_at'] > _shanghai_dt_str(_shanghai_now()-timedelta(seconds=120)):
            conn.rollback()
            return _page(info+'<p>正在发送，请稍后刷新。</p>', 409)
        if row['issued_code']:
            issued = dict(conn.execute('SELECT * FROM redemption_codes WHERE code=?', (row['issued_code'],)).fetchone())
            if issued['expires_at'] < _shanghai_dt_str():
                conn.rollback()
                return _page(info+'<p>原兑换码已过期，请联系维护者处理；不会重复发码。</p>', 410)
        else:
            value = request.form.get('credits', '')
            if value not in ('20', '50', '100'):
                conn.rollback()
                return _page('<p>请选择有效发码档位。</p>', 400)
            issued = generate_redemption_code(conn, int(value), row['email'], commit=False)
        conn.execute("UPDATE sponsor_requests SET status='approved',issued_code=?,delivery_status='sending',delivery_started_at=? WHERE id=?", (issued['code'], _shanghai_dt_str(), row['id']))
        conn.commit()
        html = f'<h2>感谢支持山川显影</h2><p>你的 +{issued["credits"]} 显影积分兑换码：</p><p><strong>{escape(issued["code"])}</strong></p><p>有效期至 {escape(issued["expires_at"])}（北京时间），限一次使用。打开平台头像菜单的“兑换码”即可核销。</p>'
        sent = send_email_163(row['email'], '【山川显影】你的赞助兑换码', html)['sent']
        conn.execute('UPDATE sponsor_requests SET delivery_status=? WHERE id=?', ('sent' if sent else 'failed', row['id']))
        conn.commit()
        if sent:
            return redirect(_approval_url(token), code=303)
        return _page(info+'<p>兑换码已保留，但邮件发送失败。请重新打开邮件中的确认页后重试寄送，不会另发新码。</p>', 502)
    finally:
        conn.close()
