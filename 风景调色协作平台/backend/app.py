#!/usr/bin/env python3
import os
import json
import sqlite3
import hashlib
import base64
import uuid
from thumbnails import build_thumbnail, upload_name, width_bucket, ThumbnailBusy
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
    from community_modules.auth import auth_bp, create_token, current_user
    from community_modules.community import community_bp
    from community_modules.profile import profile_bp
    from community_modules.saved_recipes import saved_recipes_bp
    from community_modules.credits import credits_bp, _reserve_ai_credit, _finish_ai_credit
    community_db.init_db()
app.register_blueprint(auth_bp)
app.register_blueprint(community_bp)
app.register_blueprint(profile_bp)
app.register_blueprint(saved_recipes_bp)
app.register_blueprint(credits_bp)
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
        conn.execute('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)',
                     (username, password_hash, username))
        conn.commit()
        uid = conn.execute('SELECT id FROM users WHERE username=?', (username,)).fetchone()['id']
        user_payload = repo.serialize_user(
            conn, conn.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone(),
            self_view=True)
    except sqlite3.IntegrityError:
        return json_error('用户名已存在')
    finally:
        conn.close()
    return json_ok({'token': create_token(uid), 'user': user_payload})

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()
    password_hash = hashlib.sha256(password.encode()).hexdigest()
    conn = get_db()
    try:
        user = conn.execute('SELECT * FROM users WHERE username=? AND password_hash=?',
                            (username, password_hash)).fetchone()
        user_payload = repo.serialize_user(conn, user, self_view=True) if user else None
    finally:
        conn.close()
    if user:
        return json_ok({'token': create_token(user['id']), 'user': user_payload})
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
    # Generate lazily under the shared thumbnail memory/concurrency limit.
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
    name = upload_name(filename)
    if not name:
        return json_error('图片不存在', 404)
    width = width_bucket(request.args.get('w', 800))
    try:
        path = build_thumbnail(UPLOAD_DIR, name, width)
    except (ThumbnailBusy, OSError):
        response = app.make_response(json_error('缩略图暂不可用，请稍后重试或查看原图', 503))
        response.headers['Retry-After'] = '1'
        return response
    if not path:
        return json_error('暂时无法生成缩略图，请查看原图', 404)
    response = send_from_directory(
        path.parent, path.name, mimetype='image/webp', max_age=3600, conditional=True
    )
    response.headers['Cache-Control'] = 'public, max-age=3600'

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

        status_info = ai_service.status()
        is_live = status_info.get('mode') == 'live' and not status_info.get('requires_key')
        auth_header = request.headers.get('Authorization', '').strip()
        enforce_auth = (not app.config.get('TESTING')) or bool(app.config.get('ENFORCE_CREDITS_IN_TESTS'))

        user_id = None
        user_credits = None
        if auth_header or (is_live and enforce_auth):
            user = current_user()
            if user:
                user_id = user['id']
                user_credits = int(user['credits']) if 'credits' in user.keys() and user['credits'] is not None else 10

            if is_live:
                if not user_id and enforce_auth:
                    return jsonify({
                        'error': '云端 AI 建议需登录后使用（新用户赠送 10 积分，每日签到 +3 积分）。请先登录账号。',
                        'code': 'auth_required',
                    }), 401

        reservation = _reserve_ai_credit(user_id) if is_live and user_id is not None else None
        if is_live and user_id is not None and not reservation:
            return jsonify(error='显影积分不足，请签到或补充积分。', code='insufficient_credits', credits=0), 402
        try:
            result = ai_service.recommend(data)
        except BaseException:
            if reservation:
                _finish_ai_credit(reservation, False)
            raise
        if reservation:
            result['credits'] = _finish_ai_credit(reservation, not result.get('demo'))
        elif user_id is not None:
            result['credits'] = user_credits
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
