# -*- coding: utf-8 -*-
"""社区功能 Blueprint（接口层）。

职责：解析请求参数、做入参校验、调用 repository 取数、组装响应。
不直接写 SQL——数据访问集中在 repository.py，便于复用与测试。

路由：
    GET    /api/recipes                     列表（搜索/分类/标签/排序/分页）
    GET    /api/recipes/recommend           首页推荐（按收藏数取前 N）
    GET    /api/recipes/categories          分类及数量
    GET    /api/recipes/<id>                详情
    POST   /api/recipes                     发布（需登录）
    DELETE /api/recipes/<id>                删除自己的配方（软删除，需登录）
    POST   /api/recipes/<id>/restore        找回（7 天内，需登录）
    POST   /api/recipes/<id>/favorite       收藏（需登录，幂等）
    DELETE /api/recipes/<id>/favorite       取消收藏（需登录，幂等）
    GET    /api/me/recipes                  我发布的配方（分页）
    GET    /api/me/uploads                  上传记录（含已删除，7 天找回）
    GET    /api/me/favorites                我收藏的配方（分页）
"""

from flask import Blueprint, request, jsonify, g

from config import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, RECOMMEND_LIMIT
from db import get_db, init_db
from auth import current_user, login_required
import repository as repo

init_db()

community_bp = Blueprint('community', __name__)

# 与需求规格说明书 §7 配方 step 类型一致
ALLOWED_STEP_TYPES = {
    'crop', 'rotate', 'flip', 'brightness', 'contrast', 'saturation',
    'temperature', 'exposure', 'shadows', 'highlights', 'filter',
}
RANGE_STEP_TYPES = {
    'brightness', 'contrast', 'saturation', 'temperature',
    'exposure', 'shadows', 'highlights',
}

MAX_STEPS = 50
MAX_TAGS = 10
MAX_TAG_LEN = 20
MAX_NAME_LEN = 50
MAX_DESC_LEN = 200
MAX_CATEGORY_LEN = 30
MAX_URL_LEN = 500


# ---------------- 入参解析 / 校验 ----------------
def _int_arg(name, default):
    try:
        return int(request.args.get(name, default))
    except (TypeError, ValueError):
        return default


def _paginate_params():
    page = max(1, _int_arg('page', 1))
    page_size = min(MAX_PAGE_SIZE, max(1, _int_arg('page_size', DEFAULT_PAGE_SIZE)))
    return page, page_size


def _normalize_tags(tags):
    if isinstance(tags, str):
        parts = tags.replace('，', ',').split(',')
    elif isinstance(tags, list):
        parts = tags
    else:
        return []
    result = []
    for part in parts:
        tag = str(part).strip()
        if tag and tag not in result and len(tag) <= MAX_TAG_LEN:
            result.append(tag)
        if len(result) >= MAX_TAGS:
            break
    return result


def _validate_steps(steps):
    if not isinstance(steps, list):
        return 'steps 必须是数组'
    if len(steps) > MAX_STEPS:
        return '步骤数量超出上限'
    for step in steps:
        if not isinstance(step, dict):
            return '步骤格式错误'
        stype = step.get('type')
        if stype not in ALLOWED_STEP_TYPES:
            return '不支持的步骤类型：%s' % stype
        params = step.get('params', {})
        if not isinstance(params, dict):
            return '步骤 %s 的参数格式错误' % stype
        if stype in RANGE_STEP_TYPES and 'value' in params:
            value = params['value']
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                return '步骤 %s 的参数值必须是数字' % stype
            if not -100 <= value <= 100:
                return '步骤 %s 的参数值超出范围 (-100~100)' % stype
        if stype == 'filter' and not str(params.get('name', '')).strip():
            return '步骤 filter 缺少滤镜名称'
    return None


def _paged_payload(conn, page, page_size, uid, **filters):
    rows, total = repo.query_recipes(conn, page=page, page_size=page_size, **filters)
    items = [repo.serialize_recipe(conn, r, uid) for r in rows]
    return {
        'recipes': items,
        'total': total,
        'page': page,
        'page_size': page_size,
        'has_more': page * page_size < total,
    }


# ---------------- 浏览 / 搜索 / 筛选 ----------------
@community_bp.route('/api/recipes', methods=['GET'])
def list_recipes():
    page, page_size = _paginate_params()
    sort = request.args.get('sort', 'favorites')
    sort = sort if sort in repo.SORT_SQL else 'favorites'
    filters = {
        'search': request.args.get('search', '').strip()[:100],
        'category': request.args.get('category', '').strip()[:MAX_CATEGORY_LEN],
        'tag': request.args.get('tag', '').strip()[:MAX_TAG_LEN],
        'sort': sort,
    }
    conn = get_db()
    try:
        user = current_user()
        payload = _paged_payload(conn, page, page_size, user['id'] if user else None, **filters)
    finally:
        conn.close()
    payload['sort'] = sort
    return jsonify(payload)


@community_bp.route('/api/recipes/recommend', methods=['GET'])
def recommend_recipes():
    conn = get_db()
    try:
        user = current_user()
        rows, _ = repo.query_recipes(conn, sort='favorites', page=1, page_size=RECOMMEND_LIMIT)
        items = [repo.serialize_recipe(conn, r, user['id'] if user else None, with_steps=False)
                 for r in rows]
    finally:
        conn.close()
    return jsonify({'recipes': items})


@community_bp.route('/api/recipes/categories', methods=['GET'])
def list_categories():
    conn = get_db()
    try:
        rows = repo.list_categories(conn)
    finally:
        conn.close()
    return jsonify({'categories': [{'name': r['category'], 'count': r['count']} for r in rows]})


@community_bp.route('/api/recipes/<int:recipe_id>', methods=['GET'])
def recipe_detail(recipe_id):
    conn = get_db()
    try:
        row = repo.get_recipe(conn, recipe_id)
        if not row or row['deleted_at']:
            return jsonify({'error': '配方不存在'}), 404
        user = current_user()
        data = repo.serialize_recipe(conn, row, user['id'] if user else None)
    finally:
        conn.close()
    return jsonify({'recipe': data})


# ---------------- 发布 / 删除 ----------------
@community_bp.route('/api/recipes', methods=['POST'])
@login_required
def create_recipe():
    payload = request.get_json(silent=True) or {}
    recipe = payload.get('recipe', payload)
    if not isinstance(recipe, dict):
        return jsonify({'error': '请求格式错误'}), 400

    name = str(recipe.get('name', '')).strip()
    if not name:
        return jsonify({'error': '配方名称不能为空'}), 400
    if len(name) > MAX_NAME_LEN:
        return jsonify({'error': '配方名称过长'}), 400

    steps = recipe.get('steps', [])
    err = _validate_steps(steps)
    if err:
        return jsonify({'error': err}), 400

    features = recipe.get('features', {})
    if not isinstance(features, dict):
        features = {}

    user = g.current_user
    data = {
        'name': name,
        'author': user['username'],
        'author_id': user['id'],
        'description': str(recipe.get('description', '')).strip()[:MAX_DESC_LEN],
        'category': str(recipe.get('category', '')).strip()[:MAX_CATEGORY_LEN],
        'tags': _normalize_tags(recipe.get('tags')),
        'cover_before': str(recipe.get('cover_before', ''))[:MAX_URL_LEN],
        'cover_after': str(recipe.get('cover_after', ''))[:MAX_URL_LEN],
        'steps': steps,
        'features': features,
    }
    conn = get_db()
    try:
        recipe_id = repo.insert_recipe(conn, data)
        row = repo.get_recipe(conn, recipe_id)
        out = repo.serialize_recipe(conn, row, user['id'])
    finally:
        conn.close()
    return jsonify({'id': recipe_id, 'message': '发布成功', 'recipe': out}), 201


@community_bp.route('/api/recipes/<int:recipe_id>', methods=['DELETE'])
@login_required
def delete_recipe(recipe_id):
    user = g.current_user
    conn = get_db()
    try:
        row = repo.get_recipe(conn, recipe_id)
        if not row or row['deleted_at']:
            return jsonify({'error': '配方不存在'}), 404
        if row['author_id'] != user['id']:
            return jsonify({'error': '无权删除他人配方'}), 403
        repo.delete_recipe(conn, recipe_id)
        info = repo.recovery_info(repo.get_recipe(conn, recipe_id)['deleted_at'])
    finally:
        conn.close()
    return jsonify({'message': '已删除，7 天内可找回', 'id': recipe_id, **info})


@community_bp.route('/api/recipes/<int:recipe_id>/restore', methods=['POST'])
@login_required
def restore_recipe(recipe_id):
    user = g.current_user
    conn = get_db()
    try:
        row = repo.get_recipe(conn, recipe_id)
        if not row:
            return jsonify({'error': '配方不存在'}), 404
        if row['author_id'] != user['id']:
            return jsonify({'error': '无权操作他人配方'}), 403
        info = repo.recovery_info(row['deleted_at'])
        if not info['deleted']:
            return jsonify({'error': '该配方未被删除'}), 400
        if not info['recoverable']:
            return jsonify({'error': '已超过 7 天找回期限'}), 400
        repo.restore_recipe(conn, recipe_id)
    finally:
        conn.close()
    return jsonify({'message': '已找回', 'id': recipe_id})


# ---------------- 收藏 / 取消收藏 ----------------
def _set_favorite(recipe_id, on, user):
    conn = get_db()
    try:
        if not repo.get_recipe(conn, recipe_id):
            return jsonify({'error': '配方不存在'}), 404
        if on:
            repo.add_favorite(conn, user['id'], recipe_id)
        else:
            repo.remove_favorite(conn, user['id'], recipe_id)
        count = repo.favorite_count(conn, recipe_id)
    finally:
        conn.close()
    return jsonify({'recipe_id': recipe_id, 'favorited': on, 'favorite_count': count})


@community_bp.route('/api/recipes/<int:recipe_id>/favorite', methods=['POST'])
@login_required
def favorite_recipe(recipe_id):
    return _set_favorite(recipe_id, True, g.current_user)


@community_bp.route('/api/recipes/<int:recipe_id>/favorite', methods=['DELETE'])
@login_required
def unfavorite_recipe(recipe_id):
    return _set_favorite(recipe_id, False, g.current_user)


# ---------------- 我的配方 / 我的收藏 ----------------
@community_bp.route('/api/me/recipes', methods=['GET'])
@login_required
def my_recipes():
    page, page_size = _paginate_params()
    conn = get_db()
    try:
        payload = _paged_payload(conn, page, page_size, g.current_user['id'],
                                 author_id=g.current_user['id'], sort='latest')
    finally:
        conn.close()
    return jsonify(payload)


@community_bp.route('/api/me/favorites', methods=['GET'])
@login_required
def my_favorites():
    page, page_size = _paginate_params()
    conn = get_db()
    try:
        payload = _paged_payload(conn, page, page_size, g.current_user['id'],
                                 favorited_by=g.current_user['id'], sort='favorites')
    finally:
        conn.close()
    return jsonify(payload)


@community_bp.route('/api/me/uploads', methods=['GET'])
@login_required
def my_uploads():
    """上传记录：包含已删除的内容及其上传/删除状态，用于 7 天找回。"""
    page, page_size = _paginate_params()
    conn = get_db()
    try:
        rows, total = repo.query_recipes(
            conn, author_id=g.current_user['id'], sort='latest',
            page=page, page_size=page_size, include_deleted=True)
        items = [repo.serialize_recipe(conn, r, g.current_user['id']) for r in rows]
    finally:
        conn.close()
    return jsonify({
        'recipes': items,
        'total': total,
        'page': page,
        'page_size': page_size,
        'has_more': page * page_size < total,
        'recover_days': repo.RECOVER_DAYS,
    })
