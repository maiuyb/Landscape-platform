# -*- coding: utf-8 -*-
"""数据访问层（Repository）。

把 SQL 集中在此，供 auth / community 复用；上层只处理参数校验与响应组装。
所有函数以 conn 为第一参数，由调用方管理事务与连接生命周期。
"""

import json
import math
from datetime import datetime, timedelta

RECOVER_DAYS = 7

SORT_SQL = {
    'favorites': 'favorite_count DESC, r.created_at DESC, r.id DESC',
    'latest': 'r.created_at DESC, r.id DESC',
}


def _json_list(value):
    if isinstance(value, list):
        return value
    if not value:
        return []
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else []
    except (TypeError, ValueError):
        return []


def _json_obj(value):
    if isinstance(value, dict):
        return value
    if not value:
        return None
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else None
    except (TypeError, ValueError):
        return None


# ---------------- 用户 ----------------
def create_user(conn, username, password_hash):
    cur = conn.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)',
                       (username, password_hash))
    conn.commit()
    return cur.lastrowid


def get_user_by_id(conn, user_id):
    return conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()


def get_user_by_username(conn, username):
    return conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()


def get_user_by_credentials(conn, username, password_hash):
    return conn.execute('SELECT * FROM users WHERE username = ? AND password_hash = ?',
                        (username, password_hash)).fetchone()


# ---------------- 会话 token ----------------
def create_session(conn, token, user_id):
    conn.execute('INSERT INTO sessions (token, user_id) VALUES (?, ?)', (token, user_id))
    conn.commit()


def get_user_by_token(conn, token):
    return conn.execute(
        'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?',
        (token,)).fetchone()


def delete_session(conn, token):
    conn.execute('DELETE FROM sessions WHERE token = ?', (token,))
    conn.commit()


# ---------------- 收藏 ----------------
def add_favorite(conn, user_id, recipe_id):
    conn.execute('INSERT OR IGNORE INTO favorites (user_id, recipe_id) VALUES (?, ?)',
                 (user_id, recipe_id))
    conn.commit()


def remove_favorite(conn, user_id, recipe_id):
    conn.execute('DELETE FROM favorites WHERE user_id = ? AND recipe_id = ?',
                 (user_id, recipe_id))
    conn.commit()


def favorite_count(conn, recipe_id):
    return conn.execute('SELECT COUNT(*) AS c FROM favorites WHERE recipe_id = ?',
                        (recipe_id,)).fetchone()['c']


def is_favorited(conn, user_id, recipe_id):
    if not user_id:
        return False
    return conn.execute('SELECT 1 FROM favorites WHERE user_id = ? AND recipe_id = ?',
                        (user_id, recipe_id)).fetchone() is not None


# ---------------- 配方 ----------------
def insert_recipe(conn, data):
    """保存作品元数据与完整编辑配方（version、rendering、steps）。"""
    rendering = data.get('rendering')
    cur = conn.execute(
        '''INSERT INTO recipes
           (name, author, author_id, description, cover_before, cover_after,
            steps, features, category, tags, version, rendering, pairing)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
        (data['name'], data['author'], data['author_id'], data['description'],
         data['cover_before'], data['cover_after'],
         json.dumps(data['steps'], ensure_ascii=False),
         json.dumps(data['features'], ensure_ascii=False),
         data['category'], json.dumps(data['tags'], ensure_ascii=False),
         int(data.get('version', 1) or 1),
         json.dumps(rendering, ensure_ascii=False) if rendering is not None else None,
         data.get('pairing')))
    conn.commit()
    return cur.lastrowid


def get_recipe(conn, recipe_id):
    return conn.execute('SELECT * FROM recipes WHERE id = ?', (recipe_id,)).fetchone()


def delete_recipe(conn, recipe_id):
    """软删除：标记 deleted_at，7 天内可恢复。"""
    conn.execute("UPDATE recipes SET deleted_at = datetime('now') WHERE id = ?", (recipe_id,))
    conn.commit()


def restore_recipe(conn, recipe_id):
    conn.execute('UPDATE recipes SET deleted_at = NULL WHERE id = ?', (recipe_id,))
    conn.commit()


def recovery_info(deleted_at):
    """由 deleted_at 计算回收状态。SQLite 存储为 UTC。"""
    if not deleted_at:
        return {'deleted': False, 'deleted_at': None, 'recoverable': False, 'days_left': 0}
    try:
        dt = datetime.strptime(deleted_at, '%Y-%m-%d %H:%M:%S')
    except (TypeError, ValueError):
        try:
            dt = datetime.fromisoformat(deleted_at)
        except (TypeError, ValueError):
            dt = datetime.utcnow()
    left = (dt + timedelta(days=RECOVER_DAYS) - datetime.utcnow()).total_seconds()
    recoverable = left > 0
    return {'deleted': True, 'deleted_at': deleted_at, 'recoverable': recoverable,
            'days_left': max(0, math.ceil(left / 86400)) if recoverable else 0}


def query_recipes(conn, *, search='', category='', tag='', author_id=None,
                  favorited_by=None, sort='favorites', page=1, page_size=12,
                  include_deleted=False):
    where, params = [], []
    if not include_deleted:
        where.append('r.deleted_at IS NULL')
    if search:
        like = '%' + search + '%'
        where.append('(r.name LIKE ? OR r.description LIKE ? OR r.tags LIKE ? OR r.author LIKE ?)')
        params += [like, like, like, like]
    if category:
        where.append('r.category = ?')
        params.append(category)
    if tag:
        where.append('r.tags LIKE ?')
        params.append('%"' + tag + '"%')
    if author_id is not None:
        where.append('r.author_id = ?')
        params.append(author_id)
    if favorited_by is not None:
        where.append('r.id IN (SELECT recipe_id FROM favorites WHERE user_id = ?)')
        params.append(favorited_by)

    where_sql = (' WHERE ' + ' AND '.join(where)) if where else ''
    base = ('FROM recipes r '
            'LEFT JOIN (SELECT recipe_id, COUNT(*) AS favorite_count '
            'FROM favorites GROUP BY recipe_id) f ON f.recipe_id = r.id' + where_sql)

    total = conn.execute('SELECT COUNT(*) AS c ' + base, params).fetchone()['c']
    order = SORT_SQL.get(sort, SORT_SQL['favorites'])
    rows = conn.execute(
        'SELECT r.*, COALESCE(f.favorite_count, 0) AS favorite_count ' + base +
        ' ORDER BY ' + order + ' LIMIT ? OFFSET ?',
        params + [page_size, (page - 1) * page_size]).fetchall()
    return rows, total


def list_categories(conn):
    return conn.execute(
        "SELECT category, COUNT(*) AS count FROM recipes "
        "WHERE category != '' AND deleted_at IS NULL "
        "GROUP BY category ORDER BY count DESC, category ASC").fetchall()


def count_recipes(conn):
    return conn.execute('SELECT COUNT(*) AS c FROM recipes').fetchone()['c']


# ---------------- 序列化 ----------------
def serialize_recipe(conn, row, user_id=None, with_steps=True):
    keys = row.keys()
    data = {
        'id': row['id'],
        'name': row['name'],
        'author': row['author'],
        'author_id': row['author_id'],
        'description': row['description'] or '',
        'category': row['category'] or '',
        'tags': _json_list(row['tags']),
        'cover_before': row['cover_before'] or '',
        'cover_after': row['cover_after'] or '',
        'version': row['version'] or 1,
        'rendering': _json_obj(row['rendering']) if 'rendering' in keys else None,
        'pairing': row['pairing'] if 'pairing' in keys else None,
        'favorite_count': row['favorite_count'] if 'favorite_count' in keys
                          else favorite_count(conn, row['id']),
        'is_favorited': is_favorited(conn, user_id, row['id']),
        'created_at': row['created_at'],
    }
    if with_steps:
        data['steps'] = _json_list(row['steps'])
    data.update(recovery_info(row['deleted_at'] if 'deleted_at' in keys else None))
    return data
