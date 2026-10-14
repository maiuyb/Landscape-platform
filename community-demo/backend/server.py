# -*- coding: utf-8 -*-
"""社区演示服务入口：装配蓝图、上传接口、静态页面。

只包含社区所需能力（注册/登录/上传/社区接口 + 托管前端），
不含任何调色、AI、图库匹配逻辑。

运行：
    pip install -r requirements.txt
    python server.py
打开 http://127.0.0.1:5000
测试账号：demo / demo1234
"""

import os
import uuid

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

from config import UPLOAD_DIR, FRONTEND_DIR
from db import get_db, init_db
from auth import auth_bp, create_token, hash_password
from community import community_bp
from seed import seed_demo
import repository as repo

ALLOWED_EXT = {'jpg', 'jpeg', 'png', 'webp'}
os.makedirs(UPLOAD_DIR, exist_ok=True)


def create_app():
    app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path='/static')
    CORS(app)
    init_db()
    app.register_blueprint(auth_bp)
    app.register_blueprint(community_bp)

    @app.route('/')
    def index():
        return send_from_directory(FRONTEND_DIR, 'index.html')

    @app.route('/uploads/<path:filename>')
    def uploaded_file(filename):
        return send_from_directory(UPLOAD_DIR, filename)

    @app.route('/api/upload', methods=['POST'])
    def upload():
        file = request.files.get('file')
        if not file or not file.filename:
            return jsonify({'error': '未找到文件'}), 400
        ext = file.filename.rsplit('.', 1)[-1].lower()
        if ext not in ALLOWED_EXT:
            return jsonify({'error': '仅支持 JPG/PNG/WebP 格式'}), 400
        name = uuid.uuid4().hex + '.' + ext
        file.save(os.path.join(UPLOAD_DIR, name))
        return jsonify({'url': '/uploads/' + name})

    @app.route('/api/auth/register', methods=['POST'])
    def register():
        data = request.get_json(silent=True) or {}
        username = (data.get('username') or '').strip()
        password = (data.get('password') or '').strip()
        if not username or not password:
            return jsonify({'error': '用户名和密码不能为空'}), 400
        if len(username) < 2 or len(password) < 4:
            return jsonify({'error': '用户名至少2位，密码至少4位'}), 400
        conn = get_db()
        try:
            if repo.get_user_by_username(conn, username):
                return jsonify({'error': '用户名已存在'}), 400
            uid = repo.create_user(conn, username, hash_password(password))
        finally:
            conn.close()
        return jsonify({'token': create_token(uid),
                        'user': {'id': uid, 'username': username}})

    @app.route('/api/auth/login', methods=['POST'])
    def login():
        data = request.get_json(silent=True) or {}
        username = (data.get('username') or '').strip()
        password = (data.get('password') or '').strip()
        conn = get_db()
        try:
            user = repo.get_user_by_credentials(conn, username, hash_password(password))
        finally:
            conn.close()
        if not user:
            return jsonify({'error': '用户名或密码错误'}), 400
        return jsonify({'token': create_token(user['id']),
                        'user': {'id': user['id'], 'username': user['username']}})

    return app


app = create_app()


if __name__ == '__main__':
    created = seed_demo()
    print('=' * 56)
    print('社区演示已启动: http://127.0.0.1:5000')
    print('新增样例:', created, '条' if created else '（已存在，跳过写入）')
    print('测试账号: demo / demo1234')
    print('=' * 56)
    app.run(host='127.0.0.1', port=5000, debug=True)
