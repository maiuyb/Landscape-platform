# -*- coding: utf-8 -*-
"""Verified registration, password migration and opaque-token authentication."""

import hashlib
import hmac
import secrets
import re
import sqlite3
from functools import wraps
from werkzeug.security import generate_password_hash, check_password_hash

from flask import Blueprint, request, jsonify, g

from .db import get_db, init_db
from . import repository as repo

init_db()

auth_bp = Blueprint('auth', __name__)


def hash_password(password):
    return generate_password_hash(password, method='pbkdf2:sha256:600000')


def verify_password(stored, password):
    if re.fullmatch(r'[a-f0-9]{64}', stored or ''):
        return hmac.compare_digest(stored, hashlib.sha256(password.encode()).hexdigest())
    try:
        return check_password_hash(stored, password)
    except (ValueError, TypeError):
        return False


def credentials():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return {}, '', ''
    username, password = data.get('username'), data.get('password')
    return data, username.strip() if isinstance(username,str) else '', password.strip() if isinstance(password,str) else ''


@auth_bp.route('/api/auth/captcha', methods=['GET'])
def captcha():
    from .security import captcha_response
    return captcha_response(request.args.get('purpose', 'login'))


@auth_bp.route('/api/auth/register', methods=['POST'])
def register():
    from .credits import _email, consume_email_code, _limit, Limited, _limited
    from .security import ip
    data, username, password = credentials()
    email = _email(data.get('email'))
    if not 2 <= len(username) <= 64 or not 8 <= len(password) <= 128 or not email:
        return jsonify(error='请填写 2–64 位用户名、8–128 位密码和有效邮箱。'), 400
    conn = get_db()
    try:
        conn.execute('BEGIN IMMEDIATE')
        error = consume_email_code(conn, email, data.get('code'), 'register', None)
        if error:
            return error
        _limit(conn, 'account-created-hour', ip(), 10, 3600)
        _limit(conn, 'account-created-day', ip(), 30, 86400)
        cur = conn.execute('INSERT INTO users(username,password_hash,display_name,email,email_verified,credits) VALUES(?,?,?,?,1,15)',
            (username, hash_password(password), username, email))
        uid = cur.lastrowid
        conn.commit()
        user = repo.serialize_user(conn, repo.get_user_by_id(conn, uid), self_view=True)
    except Limited as error:
        conn.rollback()
        return _limited(error)
    except sqlite3.IntegrityError:
        conn.rollback()
        return jsonify(error='用户名或邮箱不可用，请登录已有账号或更换后重试。'), 409
    finally:
        conn.close()
    return jsonify(token=create_token(uid), user=user)


@auth_bp.route('/api/auth/login', methods=['POST'])
def login():
    from .security import login_state, login_failed, login_succeeded, consume_captcha, captcha_required
    data, username, password = credentials()
    if not username or len(username)>64 or not password or len(password)>128:
        return jsonify(error='请填写有效的用户名和密码。'), 400
    if login_state(username) and not consume_captcha(data, 'login'):
        return captcha_required()
    conn = get_db()
    try:
        user = repo.get_user_by_username(conn, username)
        valid = user and verify_password(user['password_hash'], password)
        if not valid:
            # Equalize the expensive password check for unknown and legacy users.
            if not user or re.fullmatch(r'[a-f0-9]{64}', user['password_hash'] or ''):
                hashlib.pbkdf2_hmac('sha256', password.encode(), b'landscape-login-timing', 600000)
        else:
            if re.fullmatch(r'[a-f0-9]{64}', user['password_hash'] or ''):
                updated = conn.execute('UPDATE users SET password_hash=? WHERE id=? AND password_hash=?',
                    (hash_password(password), user['id'], user['password_hash'])).rowcount
                conn.commit()
                if not updated:
                    return jsonify(error='登录状态已改变，请重试。'), 409
            payload = repo.serialize_user(conn, user, self_view=True)
    finally:
        conn.close()
    if not valid:
        login_failed(username)
        return jsonify(error='用户名或密码错误。', code='captcha_required' if login_state(username) else 'invalid_credentials'), 400
    login_succeeded(username)
    return jsonify(token=create_token(user['id']), user=payload)


def create_token(user_id):
    token = secrets.token_urlsafe(32)
    conn = get_db()
    try:
        repo.create_session(conn, token, user_id)
    finally:
        conn.close()
    return token


def revoke_token(token):
    if not token:
        return
    conn = get_db()
    try:
        repo.delete_session(conn, token)
    finally:
        conn.close()


def _bearer_token():
    header = request.headers.get('Authorization', '')
    if header.startswith('Bearer '):
        return header[7:].strip()
    return ''


def user_from_token(token):
    if not token:
        return None
    conn = get_db()
    try:
        return repo.get_user_by_token(conn, token)
    finally:
        conn.close()


def current_user():
    return user_from_token(_bearer_token())


def public_user(user):
    if not user:
        return None
    return {'id': user['id'], 'username': user['username'], 'avatar': user['avatar'] or ''}


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return jsonify({'error': '未登录或登录已失效'}), 401
        g.current_user = user
        return fn(*args, **kwargs)
    return wrapper


@auth_bp.route('/api/auth/me', methods=['GET'])
@login_required
def me():
    conn = get_db()
    try:
        payload = repo.serialize_user(conn, g.current_user, self_view=True)
    finally:
        conn.close()
    return jsonify({'user': payload})


@auth_bp.route('/api/auth/logout', methods=['POST'])
@login_required
def logout():
    revoke_token(_bearer_token())
    return jsonify({'message': '已退出登录'})
