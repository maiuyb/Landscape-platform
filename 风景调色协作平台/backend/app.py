#!/usr/bin/env python3
import os
import json
import sqlite3
import hashlib
import base64
import uuid
import re
from PIL import Image, ImageOps
from ai_service import AIService, AIError, MAX_BODY, validate_request
from datetime import datetime
from flask import Flask, Request, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.middleware.proxy_fix import ProxyFix

class UploadRequest(Request):
    """Close spooled parts even when a size limit interrupts multipart parsing."""
    def _get_file_stream(self, *args, **kwargs):
        stream = super()._get_file_stream(*args, **kwargs)
        self.__dict__.setdefault('_upload_streams', []).append(stream)
        return stream

    def close(self):
        try:
            super().close()
        finally:
            for stream in self.__dict__.pop('_upload_streams', []):
                stream.close()


app = Flask(__name__)
app.request_class = UploadRequest
if os.environ.get('LANDSCAPE_TRUST_PROXY') == '1':
    # Enable only behind our loopback reverse proxy, which replaces these headers.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_prefix=1)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.environ.get('LANDSCAPE_UPLOAD_DIR', os.path.join(BASE_DIR, 'uploads'))
DB_PATH = os.path.join(BASE_DIR, 'recipes.db')
FRONTEND_DIR = os.path.join(os.path.dirname(BASE_DIR), 'frontend')
# Match the browser's 20 * 1024 * 1024 byte limit. Allow multipart overhead
# separately so a file exactly at the limit is still accepted.
MAX_UPLOAD_FILE_BYTES = 20 * 1024 * 1024
MAX_UPLOAD_REQUEST_BYTES = MAX_UPLOAD_FILE_BYTES + 1024 * 1024
os.makedirs(UPLOAD_DIR, exist_ok=True)
THUMB_DIR = os.path.join(UPLOAD_DIR, '.thumbs')
os.makedirs(THUMB_DIR, exist_ok=True)
THUMB_WIDTHS = (200, 400, 800, 1200)
ALLOWED_IMAGE_EXT = ('.jpg', '.jpeg', '.png', '.webp')
# 允许 6600 万像素级的 Unsplash 原图；默认上限约 8900 万，留出余量。
Image.MAX_IMAGE_PIXELS = 200_000_000


def _safe_upload_name(name):
    name = os.path.basename(str(name or ''))
    if name != str(name or '') or not re.fullmatch(r'[A-Za-z0-9._-]+', name):
        return None
    if not name.lower().endswith(ALLOWED_IMAGE_EXT):
        return None
    return name


def build_thumbnail(name, width):
    """生成/复用指定宽度的 WebP 缩略图，返回本地路径；失败返回 None。"""
    name = _safe_upload_name(name)
    if not name:
        return None
    src = os.path.join(UPLOAD_DIR, name)
    if not os.path.isfile(src):
        return None
    width = max(THUMB_WIDTHS[0], min(THUMB_WIDTHS[-1], int(width)))
    dst = os.path.join(THUMB_DIR, f'{name}.{width}.webp')
    if os.path.isfile(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
        return dst
    tmp = None
    try:
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im)
            if im.mode not in ('RGB', 'RGBA'):
                im = im.convert('RGB')
            if im.width > width:
                height = max(1, round(im.height * width / im.width))
                im = im.resize((width, height), Image.LANCZOS)
            tmp = f'{dst}.{uuid.uuid4().hex}.tmp'
            im.save(tmp, format='WEBP', quality=82, method=4)
        os.replace(tmp, dst)
    except Exception:
        if tmp and os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass
        return None
    return dst


# Local frontend and API share one origin; the editor also works without a CDN.
@app.route('/api/health')
def health():
    response = jsonify({'status': 'ok', 'revision': os.environ.get('LANDSCAPE_REVISION', 'development')})
    response.headers['Cache-Control'] = 'no-store'
    return response

@app.route('/')
def frontend_index():
    return send_from_directory(FRONTEND_DIR, 'index.html')

@app.route('/<path:filename>')
def frontend_file(filename):
    return send_from_directory(FRONTEND_DIR, filename)

# Community source is composed here; no demo seed, database or uploads are copied.
app.config['COMMUNITY_DB_PATH'] = os.environ.get('LANDSCAPE_DB', DB_PATH)
with app.app_context():
    from community_modules import db as community_db, repository as repo
    from community_modules.auth import auth_bp, create_token
    from community_modules.community import community_bp
    community_db.init_db()
app.register_blueprint(auth_bp)
app.register_blueprint(community_bp)
get_db = community_db.get_db

@app.route('/community/')
def community_index():
    return send_from_directory(os.path.join(FRONTEND_DIR, 'community'), 'index.html')

@app.route('/community/assets/<path:filename>')
def community_asset(filename):
    return send_from_directory(os.path.join(FRONTEND_DIR, 'community'), filename)

# ---------- AI 配置 ----------
ai_service = AIService()

# ---------- 辅助函数 ----------
def json_ok(data, status=200):
    return jsonify(data), status

def json_error(msg, status=400):
    return jsonify({'error': msg}), status

@app.errorhandler(RequestEntityTooLarge)
def upload_too_large(error):
    return json_error('上传文件或请求过大，单张图片最大 20MB，请重新选择图片。', 413)

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
        uid = conn.execute('SELECT id FROM users WHERE username=?', (username,)).fetchone()['id']
        return json_ok({'token': create_token(uid), 'user': {'id': uid, 'username': username}})
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
        return json_ok({'token': create_token(user['id']), 'user': {'id': user['id'], 'username': user['username']}})
    return json_error('用户名或密码错误')

# ---------- 图片上传 ----------
@app.route('/api/upload', methods=['POST'])
def upload():
    # Enforce the request limit before Flask parses or spools the multipart body.
    request.max_content_length = MAX_UPLOAD_REQUEST_BYTES
    if 'file' not in request.files:
        return json_error('未找到文件')
    file = request.files['file']
    if file.filename == '':
        return json_error('文件名为空')
    ext = file.filename.rsplit('.', 1)[-1].lower()
    if ext not in ('jpg', 'jpeg', 'png', 'webp'):
        return json_error('仅支持 JPG/PNG/WebP 格式')
    file.stream.seek(0, os.SEEK_END)
    file_size = file.stream.tell()
    file.stream.seek(0)
    if file_size > MAX_UPLOAD_FILE_BYTES:
        raise RequestEntityTooLarge()
    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    file.save(filepath)
    # 预生成常用宽度，首屏不用等按需转码。
    for width in (400, 800):
        build_thumbnail(filename, width)
    return json_ok({
        'url': f'{request.script_root}/uploads/{filename}',
        'thumb': f'{request.script_root}/api/thumb/{filename}?w=800'
    })

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)

@app.route('/api/thumb/<path:filename>')
def upload_thumb(filename):
    # 仅允许 uploads 目录下的单个文件名，禁止目录穿越。
    if '/' in str(filename) or '\\' in str(filename):
        return json_error('图片不存在', 404)
    name = _safe_upload_name(filename)
    if not name:
        return json_error('图片不存在', 404)
    try:
        width = int(request.args.get('w', 800))
    except (TypeError, ValueError):
        width = 800
    width = max(THUMB_WIDTHS[0], min(THUMB_WIDTHS[-1], width))
    path = build_thumbnail(name, width)
    if not path:
        return json_error('图片不存在', 404)
    response = send_from_directory(
        THUMB_DIR, os.path.basename(path),
        mimetype='image/webp', max_age=31536000, conditional=True
    )
    response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return response

# ---------- AI 推荐 ----------
@app.route('/api/ai/status', methods=['GET'])
def ai_status():
    response = jsonify(ai_service.status())
    response.headers['Cache-Control'] = 'no-store'
    return response

@app.route('/api/ai/recommend', methods=['POST'])
def ai_recommend():
    request.max_content_length = MAX_BODY
    origin = request.headers.get('Origin')
    expected_origin = ai_service.public_origin or request.host_url.rstrip('/')
    if origin and origin.rstrip('/') != expected_origin:
        return json_error('请从本项目页面获取 AI 建议。', 403)
    try:
        if not request.is_json:
            raise AIError('请使用 JSON 请求。')
        data = validate_request(request.get_json(silent=True))
        result = ai_service.recommend(data)
        response = jsonify(result)
        response.headers['Cache-Control'] = 'no-store'
        return response
    except AIError as error:
        return jsonify({'error': str(error), 'code': error.code}), error.status
    except RequestEntityTooLarge:
        return json_error('AI 请求过大，请重新载入照片后重试。', 413)

# ---------- 图库匹配 ----------
@app.route('/api/gallery/match', methods=['POST'])
def gallery_match():
    data = request.json
    features = data.get('features', {})
    conn = get_db()
    rows = conn.execute('SELECT * FROM recipes WHERE deleted_at IS NULL ORDER BY likes DESC LIMIT 50').fetchall()
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

if __name__ == '__main__':
    port = int(os.environ.get('PORT', '5000'))
    print(f"启动风景调色协作平台后端...")
    print(f"上传目录: {UPLOAD_DIR}")
    print(f"数据库: {DB_PATH}")
    print(f"访问地址: http://localhost:{port}")
    app.run(host='0.0.0.0', port=port, debug=False)
