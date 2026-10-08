#!/usr/bin/env python3
import os
import json
import sqlite3
import hashlib
import base64
import uuid
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, 'uploads')
DB_PATH = os.path.join(BASE_DIR, 'recipes.db')
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ---------- 数据库初始化 ----------
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        avatar TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        author TEXT NOT NULL,
        description TEXT DEFAULT '',
        cover_before TEXT DEFAULT '',
        cover_after TEXT DEFAULT '',
        steps TEXT DEFAULT '[]',
        features TEXT DEFAULT '{}',
        likes INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.commit()
    conn.close()

init_db()

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# ---------- AI 配置 ----------
# 通义千问 API 配置 (请替换为实际 API Key)
DASHSCOPE_API_KEY = os.environ.get('DASHSCOPE_API_KEY', '')
AI_MODEL = 'qwen-vl-plus'

# ---------- 辅助函数 ----------
def json_ok(data, status=200):
    return jsonify(data), status

def json_error(msg, status=400):
    return jsonify({'error': msg}), status

# ---------- 认证 ----------
@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.json
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()
    if not username or not password:
        return json_error('用户名和密码不能为空')
    if len(username) < 2 or len(password) < 4:
        return json_error('用户名至少2位，密码至少4位')
    conn = get_db()
    try:
        password_hash = hashlib.sha256(password.encode()).hexdigest()
        conn.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)',
                     (username, password_hash))
        conn.commit()
        return json_ok({'user': {'username': username}})
    except sqlite3.IntegrityError:
        return json_error('用户名已存在')
    finally:
        conn.close()

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()
    password_hash = hashlib.sha256(password.encode()).hexdigest()
    conn = get_db()
    user = conn.execute('SELECT * FROM users WHERE username=? AND password_hash=?',
                        (username, password_hash)).fetchone()
    conn.close()
    if user:
        return json_ok({'user': {'username': user['username']}})
    return json_error('用户名或密码错误')

# ---------- 图片上传 ----------
@app.route('/api/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return json_error('未找到文件')
    file = request.files['file']
    if file.filename == '':
        return json_error('文件名为空')
    ext = file.filename.rsplit('.', 1)[-1].lower()
    if ext not in ('jpg', 'jpeg', 'png', 'webp'):
        return json_error('仅支持 JPG/PNG/WebP 格式')
    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    file.save(filepath)
    return json_ok({'url': f'/uploads/{filename}'})

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)

# ---------- AI 推荐 ----------
def call_tongyi_qianwen(image_base64, diagnosis):
    if not DASHSCOPE_API_KEY:
        # 模拟返回配方
        return {
            'recipes': [
                {
                    'name': '通透自然',
                    'steps': [
                        {'type': 'brightness', 'params': {'value': 10}},
                        {'type': 'contrast', 'params': {'value': 8}},
                        {'type': 'saturation', 'params': {'value': 5}},
                        {'type': 'shadows', 'params': {'value': 15}},
                        {'type': 'filter', 'params': {'name': 'clarity'}}
                    ]
                },
                {
                    'name': '暖秋色调',
                    'steps': [
                        {'type': 'temperature', 'params': {'value': 12}},
                        {'type': 'saturation', 'params': {'value': 8}},
                        {'type': 'shadows', 'params': {'value': 10}},
                        {'type': 'filter', 'params': {'name': 'warm-autumn'}}
                    ]
                },
                {
                    'name': '胶片复古',
                    'steps': [
                        {'type': 'contrast', 'params': {'value': 15}},
                        {'type': 'saturation', 'params': {'value': -10}},
                        {'type': 'temperature', 'params': {'value': 5}},
                        {'type': 'shadows', 'params': {'value': 20}},
                        {'type': 'filter', 'params': {'name': 'film'}}
                    ]
                }
            ]
        }

    import requests
    prompt = f"""你是一个风景照片调色专家。请分析这张风景照片，给出3-5套调色配方。

前端诊断结果: {json.dumps(diagnosis, ensure_ascii=False)}

请按以下 JSON 格式返回（纯 JSON，不要有其他文字）:
{{
  "recipes": [
    {{
      "name": "方案名称",
      "steps": [
        {{"type": "brightness", "params": {{"value": 数值(-100~100)}}}},
        {{"type": "contrast", "params": {{"value": 数值}}}},
        {{"type": "saturation", "params": {{"value": 数值}}}},
        {{"type": "temperature", "params": {{"value": 数值}}}},
        {{"type": "exposure", "params": {{"value": 数值}}}},
        {{"type": "shadows", "params": {{"value": 数值}}}},
        {{"type": "highlights", "params": {{"value": 数值}}}},
        {{"type": "filter", "params": {{"name": "clarity/warm-autumn/film/cool-tone/bw/vivid"}}}}
      ]
    }}
  ]
}}

诊断结果中的问题需要在配方的 steps 中对应解决。"""

    headers = {
        'Authorization': f'Bearer {DASHSCOPE_API_KEY}',
        'Content-Type': 'application/json'
    }
    body = {
        'model': AI_MODEL,
        'input': {
            'messages': [
                {
                    'role': 'user',
                    'content': [
                        {'text': prompt},
                        {'image': f'data:image/jpeg;base64,{image_base64}'}
                    ]
                }
            ]
        }
    }
    try:
        resp = requests.post('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
                            headers=headers, json=body, timeout=60)
        data = resp.json()
        text = data.get('output', {}).get('text', '')
        if text:
            # 提取 JSON
            import re
            match = re.search(r'\{.*\}', text, re.DOTALL)
            if match:
                return json.loads(match.group())
    except Exception as e:
        print(f"AI 调用失败: {e}")
    return {'recipes': []}

@app.route('/api/ai/recommend', methods=['POST'])
def ai_recommend():
    data = request.json
    diagnosis = data.get('diagnosis', [])
    image_base64 = data.get('image_base64', '')
    result = call_tongyi_qianwen(image_base64, diagnosis)
    return json_ok(result)

# ---------- 图库匹配 ----------
@app.route('/api/gallery/match', methods=['POST'])
def gallery_match():
    data = request.json
    features = data.get('features', {})
    conn = get_db()
    rows = conn.execute('SELECT * FROM recipes ORDER BY likes DESC LIMIT 50').fetchall()
    conn.close()

    if not features:
        return json_ok({'results': [dict(r) for r in rows[:5]]})

    # 余弦相似度匹配
    scored = []
    target = [features.get('avgV', 0), features.get('avgS', 0), features.get('avgH', 0)]
    for row in rows:
        try:
            row_features = json.loads(row['features'] or '{}')
            vec = [row_features.get('avgV', 0), row_features.get('avgS', 0), row_features.get('avgH', 0)]
            dot = sum(a * b for a, b in zip(target, vec))
            n1 = sum(a * a for a in target) ** 0.5
            n2 = sum(b * b for b in vec) ** 0.5
            sim = dot / (n1 * n2) if n1 * n2 > 0 else 0
            scored.append((sim, dict(row)))
        except:
            continue

    scored.sort(key=lambda x: -x[0])
    results = [r for _, r in scored[:10]]
    return json_ok({'results': results})

# ---------- 配方 CRUD ----------
@app.route('/api/recipes', methods=['GET'])
def list_recipes():
    search = request.args.get('search', '').strip()
    conn = get_db()
    if search:
        rows = conn.execute(
            'SELECT * FROM recipes WHERE name LIKE ? OR description LIKE ? ORDER BY likes DESC, created_at DESC',
            (f'%{search}%', f'%{search}%')
        ).fetchall()
    else:
        rows = conn.execute('SELECT * FROM recipes ORDER BY likes DESC, created_at DESC').fetchall()
    conn.close()
    return json_ok({'recipes': [dict(r) for r in rows]})

@app.route('/api/recipes', methods=['POST'])
def create_recipe():
    data = request.json
    recipe = data.get('recipe', {})
    username = data.get('username', '匿名')
    name = recipe.get('name', '未命名')
    conn = get_db()
    cur = conn.execute(
        'INSERT INTO recipes (name, author, description, cover_before, cover_after, steps, features) VALUES (?, ?, ?, ?, ?, ?, ?)',
        (name[:50], username[:20], recipe.get('description', '')[:200],
         recipe.get('cover_before', ''), recipe.get('cover_after', ''),
         json.dumps(recipe.get('steps', []), ensure_ascii=False),
         json.dumps(recipe.get('features', {}), ensure_ascii=False))
    )
    conn.commit()
    recipe_id = cur.lastrowid
    conn.close()
    return json_ok({'id': recipe_id, 'message': '发布成功'})

@app.route('/api/recipes/<int:recipe_id>/like', methods=['POST'])
def like_recipe(recipe_id):
    conn = get_db()
    conn.execute('UPDATE recipes SET likes = likes + 1 WHERE id = ?', (recipe_id,))
    conn.commit()
    row = conn.execute('SELECT likes FROM recipes WHERE id = ?', (recipe_id,)).fetchone()
    conn.close()
    if row:
        return json_ok({'likes': row['likes']})
    return json_error('配方不存在')

if __name__ == '__main__':
    print(f"启动风景调色协作平台后端...")
    print(f"上传目录: {UPLOAD_DIR}")
    print(f"数据库: {DB_PATH}")
    print(f"访问地址: http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=True)