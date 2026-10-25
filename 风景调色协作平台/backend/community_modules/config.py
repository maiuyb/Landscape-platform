# -*- coding: utf-8 -*-
"""集中配置：路径与常量。"""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BASE_DIR)

DB_PATH = os.environ.get('LANDSCAPE_DB', os.path.join(PROJECT_DIR, 'recipes.db'))
# 与主服务 app.py 使用同一上传目录（默认 backend/uploads），便于内容比对
UPLOAD_DIR = os.environ.get('LANDSCAPE_UPLOAD_DIR', os.path.join(PROJECT_DIR, 'uploads'))
FRONTEND_DIR = os.path.join(PROJECT_DIR, 'frontend')

# 分页
DEFAULT_PAGE_SIZE = 12
MAX_PAGE_SIZE = 50
# 首页推荐数量
RECOMMEND_LIMIT = 6
