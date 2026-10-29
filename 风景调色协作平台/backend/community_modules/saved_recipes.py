"""Private, validated recipe snapshots; independent of public work favorites."""
import json
from flask import Blueprint, jsonify, request, g
from .auth import login_required
from .db import get_db
from .recipe_schema import validate_recipe

saved_recipes_bp = Blueprint('saved_recipes', __name__)
MAX_SAVED = 200


def text(value, limit, label):
    if not isinstance(value, str) or len(value.strip()) > limit:
        raise ValueError('%s最多 %d 个字符' % (label, limit))
    return value.strip()


def serialize(row):
    return {**{key: row[key] for key in ('id', 'source_recipe_id', 'name', 'note', 'author', 'description', 'created_at')},
            'tags': json.loads(row['tags']), 'recipe': json.loads(row['recipe'])}


@saved_recipes_bp.after_request
def private_response(response):
    response.headers['Cache-Control'] = 'no-store'
    return response


@saved_recipes_bp.route('/api/me/saved-recipes', methods=['GET', 'POST'])
@login_required
def saved_recipes():
    uid = g.current_user['id']
    conn = get_db()
    try:
        if request.method == 'GET':
            try:
                page = min(10000, max(1, int(request.args.get('page', 1))))
            except ValueError:
                return jsonify({'error': '分页参数无效'}), 400
            query = request.args.get('search', '').strip()[:100]
            # LIKE wildcards are literal user input, not a way to expand the query.
            pattern = '%' + query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
            where = "user_id = ? AND (name LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\')"
            args = (uid, pattern, pattern)
            total = conn.execute('SELECT COUNT(*) FROM saved_recipes WHERE ' + where, args).fetchone()[0]
            rows = conn.execute('SELECT * FROM saved_recipes WHERE ' + where + ' ORDER BY id DESC LIMIT 12 OFFSET ?', (*args, (page-1)*12)).fetchall()
            return jsonify({'recipes': [serialize(row) for row in rows], 'total': total, 'page': page, 'page_size': 12})

        request.max_content_length = 300 * 1024
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({'error': '配方格式无效'}), 400
        source = data.get('source_recipe_id')
        if source is not None and (type(source) is not int or source <= 0):
            return jsonify({'error': '作品编号无效'}), 400
        if source:
            row = conn.execute('SELECT * FROM recipes WHERE id = ? AND deleted_at IS NULL', (source,)).fetchone()
            if not row:
                return jsonify({'error': '原作品已不可用，无法存取配方'}), 404
            existing = conn.execute('SELECT * FROM saved_recipes WHERE user_id = ? AND source_recipe_id = ?', (uid, source)).fetchone()
            if existing:
                return jsonify({'saved_recipe': serialize(existing), 'already_saved': True})
            try:
                payload = {'version': row['version'], 'rendering': json.loads(row['rendering']) if row['rendering'] else None, 'steps': json.loads(row['steps'])}
            except (ValueError, TypeError):
                return jsonify({'error': '原作品的配方内容无法读取'}), 400
            name, author, description, tags = row['name'], row['author'], row['description'] or '', row['tags'] or '[]'
        else:
            payload = data.get('recipe')
            name, author, description, tags = data.get('name', ''), '', '', '[]'
        try:
            name = text(name, 100, '配方名称')
            note = text(data.get('note', ''), 500, '备注')
            if not name:
                raise ValueError('请填写配方名称')
            encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False)
            if len(encoded.encode('utf-8')) > 256 * 1024:
                raise ValueError('配方内容过大')
            normalized, error = validate_recipe(payload)
            if error:
                raise ValueError(error)
            if not normalized['steps']:
                raise ValueError('这个作品没有可存取的调色配方')
        except (ValueError, TypeError) as error:
            return jsonify({'error': str(error)}), 400
        # Serialize count/insert across concurrent save requests.
        conn.execute('BEGIN IMMEDIATE')
        if source:
            existing = conn.execute('SELECT * FROM saved_recipes WHERE user_id = ? AND source_recipe_id = ?', (uid, source)).fetchone()
            if existing:
                return jsonify({'saved_recipe': serialize(existing), 'already_saved': True})
        if conn.execute('SELECT COUNT(*) FROM saved_recipes WHERE user_id = ?', (uid,)).fetchone()[0] >= MAX_SAVED:
            return jsonify({'error': '最多保存 200 份常用配方，请先移除不再使用的配方'}), 400
        cursor = conn.execute('INSERT INTO saved_recipes (user_id, source_recipe_id, name, note, author, description, tags, recipe) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                              (uid, source, name, note, author, description, tags, json.dumps(normalized, ensure_ascii=False)))
        conn.commit()
        return jsonify({'saved_recipe': serialize(conn.execute('SELECT * FROM saved_recipes WHERE id = ?', (cursor.lastrowid,)).fetchone())}), 201
    finally:
        conn.close()


@saved_recipes_bp.route('/api/me/saved-recipes/<int:saved_id>', methods=['PATCH', 'DELETE'])
@login_required
def change_saved_recipe(saved_id):
    conn = get_db()
    try:
        row = conn.execute('SELECT * FROM saved_recipes WHERE id = ? AND user_id = ?', (saved_id, g.current_user['id'])).fetchone()
        if not row:
            return jsonify({'error': '常用配方不存在'}), 404
        if request.method == 'DELETE':
            conn.execute('DELETE FROM saved_recipes WHERE id = ? AND user_id = ?', (saved_id, g.current_user['id']))
            conn.commit()
            return jsonify({'message': '已从常用配方移除'})
        request.max_content_length = 8 * 1024
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({'error': '备注格式无效'}), 400
        try:
            name = text(data.get('name', row['name']), 100, '配方名称')
            note = text(data.get('note', row['note']), 500, '备注')
            if not name:
                raise ValueError('请填写配方名称')
        except ValueError as error:
            return jsonify({'error': str(error)}), 400
        conn.execute('UPDATE saved_recipes SET name = ?, note = ? WHERE id = ? AND user_id = ?', (name, note, saved_id, g.current_user['id']))
        conn.commit()
        return jsonify({'saved_recipe': serialize(conn.execute('SELECT * FROM saved_recipes WHERE id = ?', (saved_id,)).fetchone())})
    finally:
        conn.close()
