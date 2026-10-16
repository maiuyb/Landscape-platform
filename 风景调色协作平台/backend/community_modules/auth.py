# -*- coding: utf-8 -*-
"""认证层：密码哈希、token 签发/校验、当前用户解析，以及 /me /logout 接口。

本地/课程阶段不引入 JWT 或额外依赖：使用存库的随机 token（secrets.token_urlsafe）。
register/login 由 server.py 提供，登录成功后调用 create_token(user_id)。
"""

import hashlib
import secrets
from functools import wraps

from flask import Blueprint, request, jsonify, g

from .db import get_db, init_db
from . import repository as repo

init_db()

auth_bp = Blueprint('auth', __name__)


def hash_password(password):
    """与原型保持一致；生产环境应替换为带盐的 pbkdf2/bcrypt。"""
    return hashlib.sha256(password.encode('utf-8')).hexdigest()


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
    return jsonify({'user': public_user(g.current_user)})


@auth_bp.route('/api/auth/logout', methods=['POST'])
@login_required
def logout():
    revoke_token(_bearer_token())
    return jsonify({'message': '已退出登录'})
