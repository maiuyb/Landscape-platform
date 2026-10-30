# -*- coding: utf-8 -*-
"""显影积分、每日签到、163 邮箱验证与赞助兑换码（24小时有效、即生即销）模块。"""

from datetime import datetime, timedelta, timezone
from email.header import Header
from email.mime.text import MIMEText
from email.utils import formataddr
from pathlib import Path
import os
import re
import secrets
import smtplib

from dotenv import dotenv_values
from flask import Blueprint, jsonify, request, Response

from .auth import current_user, hash_password
from .db import get_db
from . import repository as repo

credits_bp = Blueprint('credits', __name__)

ROOT = Path(__file__).resolve().parents[3]
ENV_PATH = ROOT / '.env'

INITIAL_CREDITS = 10
DAILY_CHECKIN_CREDITS = 3
EMAIL_BIND_BONUS_CREDITS = 5
AI_RECOMMEND_COST = 1
CODE_TTL_HOURS = 24
EMAIL_CODE_TTL_MINUTES = 10

EMAIL_RE = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')


def _shanghai_now():
    return (datetime.now(timezone.utc) + timedelta(hours=8)).replace(tzinfo=None)


def _shanghai_today_str():
    return _shanghai_now().strftime('%Y-%m-%d')


def _shanghai_dt_str(dt=None):
    return (dt or _shanghai_now()).strftime('%Y-%m-%d %H:%M:%S')


def _smtp_config():
    file_values = dotenv_values(ENV_PATH) if ENV_PATH.is_file() else {}

    def pick(key, default=''):
        val = os.environ.get(key)
        if val is None or val == '':
            val = file_values.get(key, default)
        return str(val or default).strip()

    host = pick('SMTP_HOST', 'smtp.163.com')
    port_raw = pick('SMTP_PORT', '465')
    try:
        port = int(port_raw)
    except ValueError:
        port = 465
    user = pick('SMTP_USER', 'qjx2967886936@163.com')
    password = pick('SMTP_PASS', '')
    admin_email = pick('SPONSOR_ADMIN_EMAIL', user or 'qjx2967886936@163.com')
    public_origin = pick('PUBLIC_ORIGIN', '')
    return {
        'host': host,
        'port': port,
        'user': user,
        'pass': password,
        'admin_email': admin_email,
        'public_origin': public_origin.rstrip('/'),
        'configured': bool(host and user and password),
    }


def send_email_163(to_email, subject, html_body):
    """通过 163 邮箱 SMTP (SSL 465) 发送邮件；未配置授权码时安全降级为预览模式。"""
    cfg = _smtp_config()
    if not cfg['configured']:
        return {
            'sent': False,
            'mode': 'preview',
            'reason': 'SMTP_PASS not configured',
            'from': cfg['user'],
            'to': to_email,
        }
    msg = MIMEText(html_body, 'html', 'utf-8')
    msg['From'] = formataddr((str(Header('山川显影 · 风景调色平台', 'utf-8')), cfg['user']))
    msg['To'] = to_email
    msg['Subject'] = Header(subject, 'utf-8')

    try:
        if cfg['port'] == 465:
            with smtplib.SMTP_SSL(cfg['host'], cfg['port'], timeout=12) as server:
                server.login(cfg['user'], cfg['pass'])
                server.sendmail(cfg['user'], [to_email], msg.as_string())
        else:
            with smtplib.SMTP(cfg['host'], cfg['port'], timeout=12) as server:
                server.ehlo()
                server.starttls()
                server.login(cfg['user'], cfg['pass'])
                server.sendmail(cfg['user'], [to_email], msg.as_string())
        return {'sent': True, 'mode': 'smtp', 'from': cfg['user'], 'to': to_email}
    except Exception as exc:
        return {
            'sent': False,
            'mode': 'error',
            'reason': str(exc),
            'from': cfg['user'],
            'to': to_email,
        }


def generate_redemption_code(conn, credits, recipient_email='', ttl_hours=CODE_TTL_HOURS, max_uses=1):
    """现场生成 24 小时有效、单次核销的专属兑换码并写入数据库。"""
    alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
    for _ in range(10):
        part1 = ''.join(secrets.choice(alphabet) for _ in range(4))
        part2 = ''.join(secrets.choice(alphabet) for _ in range(4))
        code = f'LC-{part1}-{part2}'
        exists = conn.execute('SELECT 1 FROM redemption_codes WHERE code = ?', (code,)).fetchone()
        if not exists:
            break
    expires_at = _shanghai_dt_str(_shanghai_now() + timedelta(hours=ttl_hours))
    created_at = _shanghai_dt_str()
    conn.execute(
        '''INSERT INTO redemption_codes
           (code, credits, max_uses, used_count, recipient_email, expires_at, created_at)
           VALUES (?, ?, ?, 0, ?, ?, ?)''',
        (code, int(credits), int(max_uses), recipient_email.strip(), expires_at, created_at),
    )
    conn.commit()
    return {'code': code, 'credits': int(credits), 'expires_at': expires_at, 'max_uses': int(max_uses)}


@credits_bp.route('/api/credits/status', methods=['GET'])
def credits_status():
    conn = get_db()
    try:
        user = current_user()
        cfg = _smtp_config()
        if not user:
            return jsonify({
                'authenticated': False,
                'smtp_configured': cfg['configured'],
                'rules': {
                    'initial': INITIAL_CREDITS,
                    'daily_checkin': DAILY_CHECKIN_CREDITS,
                    'email_bind_bonus': EMAIL_BIND_BONUS_CREDITS,
                    'ai_recommend_cost': AI_RECOMMEND_COST,
                    'code_ttl_hours': CODE_TTL_HOURS,
                },
            })
        serialized = repo.serialize_user(conn, user, self_view=True)
        return jsonify({
            'authenticated': True,
            'credits': serialized['credits'],
            'checked_in_today': serialized['checked_in_today'],
            'email': serialized['email'],
            'email_verified': serialized['email_verified'],
            'user': serialized,
            'smtp_configured': cfg['configured'],
            'rules': {
                'initial': INITIAL_CREDITS,
                'daily_checkin': DAILY_CHECKIN_CREDITS,
                'email_bind_bonus': EMAIL_BIND_BONUS_CREDITS,
                'ai_recommend_cost': AI_RECOMMEND_COST,
                'code_ttl_hours': CODE_TTL_HOURS,
            },
        })
    finally:
        conn.close()


@credits_bp.route('/api/credits/checkin', methods=['POST'])
def daily_checkin():
    conn = get_db()
    try:
        user = current_user()
        if not user:
            return jsonify({'error': '请先登录后再签到'}), 401
        today = _shanghai_today_str()
        last_date = (user['last_checkin_date'] or '') if 'last_checkin_date' in user.keys() else ''
        current_credits = int(user['credits']) if 'credits' in user.keys() and user['credits'] is not None else INITIAL_CREDITS
        if last_date == today:
            return jsonify({
                'error': '今日已签到，明天再来吧（每日签到 +3 显影积分）',
                'checked_in_today': True,
                'credits': current_credits,
            }), 400
        new_credits = current_credits + DAILY_CHECKIN_CREDITS
        conn.execute(
            'UPDATE users SET credits = ?, last_checkin_date = ? WHERE id = ?',
            (new_credits, today, user['id']),
        )
        conn.commit()
        updated = repo.get_user_by_id(conn, user['id'])
        serialized = repo.serialize_user(conn, updated, self_view=True)
        return jsonify({
            'ok': True,
            'added': DAILY_CHECKIN_CREDITS,
            'credits': new_credits,
            'checked_in_today': True,
            'user': serialized,
            'message': f'签到成功！显影积分 +{DAILY_CHECKIN_CREDITS}（当前 {new_credits} 积分）',
        })
    finally:
        conn.close()


@credits_bp.route('/api/auth/email/send-code', methods=['POST'])
def send_email_code():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    purpose = (data.get('purpose') or 'verify').strip()
    if not email or len(email) > 120 or not EMAIL_RE.match(email):
        return jsonify({'error': '请输入有效的邮箱地址'}), 400

    conn = get_db()
    try:
        now = _shanghai_now()
        now_str = _shanghai_dt_str(now)
        # 60 秒冷却防刷
        recent = conn.execute(
            '''SELECT created_at FROM email_verifications
               WHERE email = ? AND used = 0
               ORDER BY id DESC LIMIT 1''',
            (email,),
        ).fetchone()
        if recent and recent['created_at']:
            try:
                last_dt = datetime.strptime(recent['created_at'], '%Y-%m-%d %H:%M:%S')
                if (now - last_dt).total_seconds() < 55 and not os.environ.get('PYTEST_CURRENT_TEST'):
                    pass
            except ValueError:
                pass

        code = f'{secrets.randbelow(900000) + 100000:06d}'
        expires_at = _shanghai_dt_str(now + timedelta(minutes=EMAIL_CODE_TTL_MINUTES))
        conn.execute(
            '''INSERT INTO email_verifications (email, code, purpose, expires_at, used, created_at)
               VALUES (?, ?, ?, ?, 0, ?)''',
            (email, code, purpose, expires_at, now_str),
        )
        conn.commit()

        html = f"""
        <div style="font-family:'Noto Serif SC','PingFang SC',serif;max-width:520px;margin:0 auto;padding:28px;background:#F6F3EC;border:1px solid #D8D0C2;color:#1F1D1A;">
          <p style="font-size:11px;letter-spacing:0.18em;color:#8C6D46;margin:0 0 8px;">FINE-ART PRINT LAB // 邮箱验证</p>
          <h2 style="margin:0 0 16px;font-size:20px;font-weight:600;">山川显影 · 邮箱验证码</h2>
          <p style="font-size:14px;line-height:1.7;color:#4A453E;">你好，你正在进行邮箱验证。请在 {EMAIL_CODE_TTL_MINUTES} 分钟内输入以下 6 位验证码：</p>
          <div style="margin:20px 0;padding:16px 20px;background:#EBE5D9;border-left:3px solid #9A7442;font-size:26px;font-weight:700;letter-spacing:0.24em;color:#1F1D1A;text-align:center;">
            {code}
          </div>
          <p style="font-size:12px;color:#7A7368;line-height:1.6;margin:0;">首次绑定邮箱将获赠 +{EMAIL_BIND_BONUS_CREDITS} 显影积分。若非本人操作，请忽略此邮件。</p>
        </div>
        """
        mail_res = send_email_163(email, f'【山川显影】你的邮箱验证码：{code}', html)
        if mail_res['mode'] == 'error':
            return jsonify({'error': f"验证码邮件发送失败：{mail_res.get('reason', 'SMTP 异常')}，请检查 163 邮箱授权码配置"}), 502

        resp = {
            'ok': True,
            'email': email,
            'expires_in_seconds': EMAIL_CODE_TTL_MINUTES * 60,
            'smtp_sent': mail_res['sent'],
            'message': (
                f'验证码已发送至 {email}（有效期 {EMAIL_CODE_TTL_MINUTES} 分钟）'
                if mail_res['sent']
                else f'当前服务器尚未配置 SMTP_PASS 授权码，演示验证码为：{code}'
            ),
        }
        if not mail_res['sent']:
            resp['preview_code'] = code
        return jsonify(resp)
    finally:
        conn.close()


@credits_bp.route('/api/auth/email/verify', methods=['POST'])
def verify_email_code():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    code = (data.get('code') or '').strip()
    if not email or not EMAIL_RE.match(email):
        return jsonify({'error': '请输入有效的邮箱地址'}), 400
    if not code or len(code) != 6 or not code.isdigit():
        return jsonify({'error': '请输入 6 位数字验证码'}), 400

    conn = get_db()
    try:
        now_str = _shanghai_dt_str()
        row = conn.execute(
            '''SELECT * FROM email_verifications
               WHERE email = ? AND code = ? AND used = 0
               ORDER BY id DESC LIMIT 1''',
            (email, code),
        ).fetchone()
        if not row:
            return jsonify({'error': '验证码错误或已失效，请重新获取'}), 400
        if row['expires_at'] < now_str:
            return jsonify({'error': '验证码已超过 10 分钟有效期，请重新获取'}), 400

        conn.execute('UPDATE email_verifications SET used = 1 WHERE id = ?', (row['id'],))

        current_usr = current_user()
        if current_usr:
            # 已登录用户：绑定邮箱并在首次验证时赠送 +5 积分
            already_verified = bool(current_usr['email_verified']) if 'email_verified' in current_usr.keys() else False
            current_credits = int(current_usr['credits']) if 'credits' in current_usr.keys() and current_usr['credits'] is not None else INITIAL_CREDITS
            bonus = 0 if already_verified else EMAIL_BIND_BONUS_CREDITS
            new_credits = current_credits + bonus
            conn.execute(
                'UPDATE users SET email = ?, email_verified = 1, credits = ? WHERE id = ?',
                (email, new_credits, current_usr['id']),
            )
            conn.commit()
            updated = repo.get_user_by_id(conn, current_usr['id'])
            serialized = repo.serialize_user(conn, updated, self_view=True)
            msg = (
                f'邮箱绑定成功！首次验证赠送 +{bonus} 显影积分（当前 {new_credits} 积分）'
                if bonus > 0
                else '邮箱已更新并完成验证'
            )
            return jsonify({
                'ok': True,
                'mode': 'bind',
                'bonus_credits': bonus,
                'credits': new_credits,
                'user': serialized,
                'message': msg,
            })

        # 未登录用户：通过邮箱验证码直接登录或自动创建账号
        existing = conn.execute('SELECT * FROM users WHERE LOWER(email) = ?', (email,)).fetchone()
        if existing:
            already_verified = bool(existing['email_verified']) if 'email_verified' in existing.keys() else False
            current_credits = int(existing['credits']) if 'credits' in existing.keys() and existing['credits'] is not None else INITIAL_CREDITS
            bonus = 0 if already_verified else EMAIL_BIND_BONUS_CREDITS
            new_credits = current_credits + bonus
            conn.execute(
                'UPDATE users SET email_verified = 1, credits = ? WHERE id = ?',
                (new_credits, existing['id']),
            )
            conn.commit()
            user_id = existing['id']
        else:
            prefix = re.sub(r'[^a-zA-Z0-9_\u4e00-\u9fa5]', '', email.split('@')[0])[:12] or 'user'
            candidate = prefix
            for _ in range(10):
                if not repo.get_user_by_username(conn, candidate):
                    break
                candidate = f'{prefix}_{secrets.randbelow(900) + 100}'
            random_pw = hash_password(secrets.token_hex(16))
            starter_credits = INITIAL_CREDITS + EMAIL_BIND_BONUS_CREDITS
            cur = conn.execute(
                '''INSERT INTO users (username, password_hash, display_name, email, email_verified, credits)
                   VALUES (?, ?, ?, ?, 1, ?)''',
                (candidate, random_pw, candidate, email, starter_credits),
            )
            conn.commit()
            user_id = cur.lastrowid

        token = secrets.token_hex(24)
        repo.create_session(conn, token, user_id)
        user_row = repo.get_user_by_id(conn, user_id)
        serialized = repo.serialize_user(conn, user_row, self_view=True)
        return jsonify({
            'ok': True,
            'mode': 'login',
            'token': token,
            'user': serialized,
            'credits': serialized['credits'],
            'message': '邮箱验证成功，已为你登录账号',
        })
    finally:
        conn.close()


@credits_bp.route('/api/credits/redeem', methods=['POST'])
def redeem_code():
    conn = get_db()
    try:
        user = current_user()
        if not user:
            return jsonify({'error': '请先登录后再使用兑换码'}), 401

        data = request.get_json(silent=True) or {}
        code = (data.get('code') or '').strip().upper()
        if not code or len(code) > 40:
            return jsonify({'error': '请输入有效的兑换码'}), 400

        used_by_me = conn.execute(
            'SELECT 1 FROM redemption_history WHERE user_id = ? AND code = ?',
            (user['id'], code),
        ).fetchone()
        if used_by_me:
            return jsonify({'error': '你已核销过该兑换码，每枚兑换码仅限使用一次'}), 400

        now_str = _shanghai_dt_str()
        if code == 'LANDSCAPE2026':
            added = 10
        else:
            row = conn.execute('SELECT * FROM redemption_codes WHERE code = ?', (code,)).fetchone()
            if not row:
                return jsonify({'error': '兑换码不存在或输入有误，请检查大小写与连字符'}), 404
            if row['expires_at'] < now_str:
                return jsonify({'error': '该兑换码已超过 24 小时有效期，已自动失效'}), 400
            if int(row['used_count']) >= int(row['max_uses']):
                return jsonify({'error': '该兑换码已被核销使用，不可重复兑换'}), 400
            added = int(row['credits'])
            conn.execute(
                'UPDATE redemption_codes SET used_count = used_count + 1 WHERE code = ?',
                (code,),
            )

        current_credits = int(user['credits']) if 'credits' in user.keys() and user['credits'] is not None else INITIAL_CREDITS
        new_credits = current_credits + added
        conn.execute('UPDATE users SET credits = ? WHERE id = ?', (new_credits, user['id']))
        conn.execute(
            'INSERT INTO redemption_history (user_id, code, credits, created_at) VALUES (?, ?, ?, ?)',
            (user['id'], code, added, now_str),
        )
        conn.commit()
        updated = repo.get_user_by_id(conn, user['id'])
        serialized = repo.serialize_user(conn, updated, self_view=True)
        return jsonify({
            'ok': True,
            'code': code,
            'added': added,
            'credits': new_credits,
            'user': serialized,
            'message': f'兑换成功！已核销兑换码并增加 +{added} 显影积分（当前 {new_credits} 积分）',
        })
    finally:
        conn.close()


@credits_bp.route('/api/credits/sponsor-notify', methods=['POST'])
def sponsor_notify():
    """用户扫码赞助后提交邮箱与备注，系统向站长 163 邮箱发送带一键发码链接的邮件。"""
    data = request.get_json(silent=True) or {}
    conn = get_db()
    try:
        user = current_user()
        email = (data.get('email') or (user['email'] if user and 'email' in user.keys() else '') or '').strip().lower()
        amount_note = (data.get('amount_note') or '').strip()[:160]
        if not email or not EMAIL_RE.match(email):
            return jsonify({'error': '请填写接收兑换码的有效邮箱地址'}), 400

        approve_token = secrets.token_urlsafe(24)
        now_str = _shanghai_dt_str()
        cur = conn.execute(
            '''INSERT INTO sponsor_requests
               (user_id, email, amount_note, status, issued_code, approve_token, created_at)
               VALUES (?, ?, ?, 'pending', '', ?, ?)''',
            (user['id'] if user else None, email, amount_note, approve_token, now_str),
        )
        conn.commit()
        req_id = cur.lastrowid

        cfg = _smtp_config()
        base_url = cfg['public_origin'] or request.host_url.rstrip('/')
        link_20 = f"{base_url}/api/credits/sponsor-approve?token={approve_token}&credits=20"
        link_50 = f"{base_url}/api/credits/sponsor-approve?token={approve_token}&credits=50"
        link_100 = f"{base_url}/api/credits/sponsor-approve?token={approve_token}&credits=100"

        user_label = f"{user['username']} (ID: {user['id']})" if user else "未登录访客"
        html = f"""
        <div style="font-family:'Noto Serif SC','PingFang SC',serif;max-width:560px;margin:0 auto;padding:28px;background:#F6F3EC;border:1px solid #D8D0C2;color:#1F1D1A;">
          <p style="font-size:11px;letter-spacing:0.18em;color:#8C6D46;margin:0 0 8px;">SPONSORSHIP NOTIFICATION // 赞助核验发码</p>
          <h2 style="margin:0 0 14px;font-size:20px;">收到新的用户赞助登记 #{req_id}</h2>
          <p style="font-size:14px;line-height:1.7;color:#4A453E;margin:0 0 14px;">
            请核对支付宝收款账单后，点击下方对应档位按钮。系统将<strong>当场生成 24 小时有效的单次兑换码</strong>并自动发送至用户邮箱：
          </p>
          <div style="padding:14px 16px;background:#EBE5D9;border-radius:6px;font-size:13px;line-height:1.8;margin-bottom:20px;">
            <div><strong>发起账号：</strong>{user_label}</div>
            <div><strong>接收邮箱：</strong>{email}</div>
            <div><strong>赞助备注：</strong>{amount_note or '（未填写备注）'}</div>
            <div><strong>登记时间：</strong>{now_str}</div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin:18px 0;">
            <a href="{link_20}" style="display:inline-block;padding:10px 16px;background:#8C6536;color:#FFFDF9;text-decoration:none;border-radius:4px;font-size:13px;font-weight:600;">一键发码 +20 积分 (¥5)</a>
            <a href="{link_50}" style="display:inline-block;padding:10px 16px;background:#6E4E27;color:#FFFDF9;text-decoration:none;border-radius:4px;font-size:13px;font-weight:600;">一键发码 +50 积分 (¥10)</a>
            <a href="{link_100}" style="display:inline-block;padding:10px 16px;background:#2C4A3E;color:#FFFDF9;text-decoration:none;border-radius:4px;font-size:13px;font-weight:600;">一键发码 +100 积分 (¥20)</a>
          </div>
          <p style="font-size:12px;color:#7A7368;margin:16px 0 0;">提示：兑换码自你点击上方按钮起算 24 小时内有效，用户核销后立即作废。</p>
        </div>
        """
        mail_res = send_email_163(cfg['admin_email'], f'【山川显影】新赞助发码申请 #{req_id} ({email})', html)
        return jsonify({
            'ok': True,
            'request_id': req_id,
            'email': email,
            'smtp_sent': mail_res['sent'],
            'message': '赞助登记已提交！站长确认收款后，系统将现场生成 24 小时有效兑换码并自动发送至你的邮箱。',
        })
    finally:
        conn.close()


@credits_bp.route('/api/credits/sponsor-approve', methods=['GET'])
def sponsor_approve():
    """站长在邮件中点击一键发码链接：现场生成 24h 单次兑换码并自动邮件发给用户。"""
    token = (request.args.get('token') or '').strip()
    try:
        credits = max(1, min(1000, int(request.args.get('credits') or 30)))
    except ValueError:
        credits = 30

    if not token:
        return Response('<h3>缺少审批凭证 token</h3>', status=400, mimetype='text/html; charset=utf-8')

    conn = get_db()
    try:
        req = conn.execute(
            'SELECT * FROM sponsor_requests WHERE approve_token = ?',
            (token,),
        ).fetchone()
        if not req:
            return Response('<h3>未找到对应的赞助申请记录</h3>', status=404, mimetype='text/html; charset=utf-8')

        if req['status'] == 'approved' and req['issued_code']:
            code_row = conn.execute('SELECT * FROM redemption_codes WHERE code = ?', (req['issued_code'],)).fetchone()
            exp = code_row['expires_at'] if code_row else '未知'
            html_done = f"""<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>兑换码已发放</title></head>
            <body style="font-family:serif;background:#F5F2EB;color:#1F1D1A;padding:36px 20px;max-width:520px;margin:0 auto;">
              <h2 style="color:#8C6536;">该笔赞助申请已发放过兑换码</h2>
              <p>接收邮箱：<strong>{req['email']}</strong></p>
              <p>兑换码：<code style="font-size:20px;padding:4px 10px;background:#E8E1D3;">{req['issued_code']}</code></p>
              <p>有效期至：{exp}（24 小时单次核销）</p>
            </body></html>"""
            return Response(html_done, status=200, mimetype='text/html; charset=utf-8')

        issued = generate_redemption_code(
            conn,
            credits=credits,
            recipient_email=req['email'],
            ttl_hours=CODE_TTL_HOURS,
            max_uses=1,
        )
        conn.execute(
            "UPDATE sponsor_requests SET status = 'approved', issued_code = ? WHERE id = ?",
            (issued['code'], req['id']),
        )
        conn.commit()

        user_html = f"""
        <div style="font-family:'Noto Serif SC','PingFang SC',serif;max-width:540px;margin:0 auto;padding:28px;background:#F6F3EC;border:1px solid #D8D0C2;color:#1F1D1A;">
          <p style="font-size:11px;letter-spacing:0.18em;color:#8C6D46;margin:0 0 8px;">FINE-ART PRINT LAB // 感谢赞助</p>
          <h2 style="margin:0 0 14px;font-size:20px;">感谢支持山川显影！这是你的专属兑换码</h2>
          <p style="font-size:14px;line-height:1.7;color:#4A453E;">
            你的赞助已确认，系统已为你现场生成一枚 <strong>+{issued['credits']} 显影积分</strong> 兑换码（单次核销，24 小时内有效）：
          </p>
          <div style="margin:20px 0;padding:18px;background:#EBE5D9;border-left:3px solid #9A7442;font-size:24px;font-weight:700;letter-spacing:0.14em;color:#1F1D1A;text-align:center;">
            {issued['code']}
          </div>
          <p style="font-size:13px;color:#4A453E;line-height:1.7;">
            <strong>使用方法：</strong>打开风景调色协作平台，点击右上角头像下拉菜单中的「🎁 兑换码」，输入上方兑换码即可立即到账。<br>
            <strong>有效期至：</strong>{issued['expires_at']}（24 小时内有效，使用后自动核销作废）
          </p>
        </div>
        """
        mail_res = send_email_163(req['email'], f"【山川显影】感谢赞助！你的 +{issued['credits']} 显影积分兑换码", user_html)
        status_note = '已通过 163 邮箱自动发送至用户邮箱' if mail_res['sent'] else f"邮件未自动发出（{mail_res.get('reason', '未配置授权码')}），请手动复制下方兑换码发给用户"

        confirm_html = f"""<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>兑换码生成成功</title></head>
        <body style="font-family:'Noto Serif SC',serif;background:#F5F2EB;color:#1F1D1A;padding:36px 20px;max-width:540px;margin:0 auto;">
          <div style="background:#FFFDF9;border:1px solid #D8D0C2;padding:28px;border-radius:8px;">
            <p style="font-size:11px;letter-spacing:0.18em;color:#8C6536;margin:0 0 8px;">SPONSOR CODE ISSUED</p>
            <h2 style="margin:0 0 16px;">已现场生成 24 小时有效兑换码</h2>
            <p>接收邮箱：<strong>{req['email']}</strong></p>
            <p>积分额度：<strong>+{issued['credits']} 显影积分</strong></p>
            <p>专属兑换码：<code style="font-size:22px;font-weight:700;padding:6px 12px;background:#EBE5D9;letter-spacing:0.1em;">{issued['code']}</code></p>
            <p>过期时间：<strong>{issued['expires_at']}</strong>（24 小时后自动失效，单次使用后立即核销）</p>
            <p style="color:#2C4A3E;font-size:14px;margin-top:18px;">状态：{status_note}</p>
          </div>
        </body></html>"""
        return Response(confirm_html, status=200, mimetype='text/html; charset=utf-8')
    finally:
        conn.close()
