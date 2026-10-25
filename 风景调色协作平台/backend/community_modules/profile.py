# -*- coding: utf-8 -*-
"""用户资料接口：本人资料读写与公开主页。

公开接口返回作者标识、加入时间与展示资料；收藏明细仅本人接口返回。
头像只接受本项目 /uploads/ 下的已上传图片，避免外链和目录穿越。
"""

import warnings
from PIL import Image
from flask import Blueprint, jsonify, request, g
from thumbnails import upload_path

from .auth import login_required
from .config import UPLOAD_DIR
from .db import get_db
from . import repository as repo

profile_bp = Blueprint('profile', __name__)

MAX_DISPLAY_NAME_LEN = 20
MAX_BIO_LEN = 160
MAX_LOCATION_LEN = 40
MAX_AVATAR_BYTES = 5 * 1024 * 1024


def _clean_text(value, max_len, field):
    if value is None:
        return ''
    if not isinstance(value, str):
        raise ValueError('%s格式不正确' % field)
    text = value.strip()
    if len(text) > max_len:
        raise ValueError('%s最多 %d 个字符' % (field, max_len))
    return text


def _normalize_avatar(value):
    if value is None:
        return ''
    if not isinstance(value, str):
        raise ValueError('头像地址格式不正确')
    value = value.strip()
    if not value:
        return ''
    prefix = request.script_root.rstrip('/') if request else ''
    starts = ([prefix + '/uploads/'] if prefix else []) + ['/uploads/']
    for start in starts:
        if not value.startswith(start):
            continue
        name = value[len(start):]
        if not name or '/' in name or '\\' in name:
            continue
        path = upload_path(UPLOAD_DIR, name)
        if path and path.is_file() and path.stat().st_size <= MAX_AVATAR_BYTES:
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter('error', Image.DecompressionBombWarning)
                    with Image.open(path) as image:
                        if image.width * image.height > 40_000_000:
                            raise ValueError('头像图片像素过大')
                        image.verify()
                return value
            except (OSError, Image.DecompressionBombWarning, Image.DecompressionBombError):
                raise ValueError('头像图片无法读取')
    raise ValueError('头像必须使用本地上传的图片（5MB 以内）')


@profile_bp.route('/api/users/me', methods=['GET'])
@login_required
def get_my_profile():
    conn = get_db()
    try:
        payload = repo.serialize_user(conn, g.current_user, self_view=True)
    finally:
        conn.close()
    return jsonify({'user': payload})


@profile_bp.route('/api/users/me', methods=['PUT'])
@login_required
def update_my_profile():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({'error': '资料格式不正确'}), 400
    user = g.current_user
    try:
        display_name = _clean_text(
            data.get('display_name', user['display_name'] or user['username']),
            MAX_DISPLAY_NAME_LEN, '昵称')
        if not display_name:
            raise ValueError('昵称不能为空')
        bio = _clean_text(data.get('bio', user['bio']), MAX_BIO_LEN, '简介')
        location = _clean_text(
            data.get('location', user['location']), MAX_LOCATION_LEN, '所在地')
        avatar = user['avatar'] or ''
        if 'avatar' in data:
            avatar = _normalize_avatar(data.get('avatar'))
    except ValueError as error:
        return jsonify({'error': str(error)}), 400

    conn = get_db()
    try:
        repo.update_user_profile(conn, user['id'], display_name, bio, location, avatar)
        payload = repo.serialize_user(conn, repo.get_user_by_id(conn, user['id']), self_view=True)
    finally:
        conn.close()
    return jsonify({'message': '资料已保存', 'user': payload})


@profile_bp.route('/api/users/<int:user_id>', methods=['GET'])
def get_public_profile(user_id):
    conn = get_db()
    try:
        user = repo.get_user_by_id(conn, user_id)
        if not user:
            return jsonify({'error': '用户不存在'}), 404
        payload = repo.serialize_user(conn, user, self_view=False)
    finally:
        conn.close()
    return jsonify({'user': payload})
