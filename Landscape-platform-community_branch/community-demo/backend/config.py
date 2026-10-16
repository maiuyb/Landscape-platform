# -*- coding: utf-8 -*-
"""集中配置：路径与常量。"""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(BASE_DIR)

DB_PATH = os.environ.get('LANDSCAPE_DB', os.path.join(BASE_DIR, 'recipes.db'))
UPLOAD_DIR = os.path.join(BASE_DIR, 'uploads')
FRONTEND_DIR = os.path.join(PROJECT_DIR, 'frontend')

# 分页
DEFAULT_PAGE_SIZE = 12
MAX_PAGE_SIZE = 50
# 首页推荐数量
RECOMMEND_LIMIT = 6
