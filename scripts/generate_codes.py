#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""命令行批量或单枚生成 24 小时有效、单次核销的显影积分兑换码。

用法示例:
    python3 scripts/generate_codes.py --credits 30 --count 5
"""

import argparse
from pathlib import Path
import sys
import os
from flask import Flask

ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / '风景调色协作平台' / 'backend'
sys.path.insert(0, str(BACKEND_DIR))



def main():
    parser = argparse.ArgumentParser(description='生成 24 小时有效显影积分兑换码')
    parser.add_argument('--credits', type=int, default=30, help='每枚兑换码包含的积分数量（默认 30）')
    parser.add_argument('--count', type=int, default=1, help='生成数量（默认 1）')
    parser.add_argument('--hours', type=int, default=24, help='有效小时数（默认 24 小时）')
    parser.add_argument('--database', default=os.environ.get('LANDSCAPE_DB'), help='持久数据库绝对路径，或使用 LANDSCAPE_DB')
    parser.add_argument('--email', type=str, default='', help='可选关联邮箱')
    args = parser.parse_args()

    if not args.database or not Path(args.database).is_absolute() or not Path(args.database).is_file():
        parser.error('请通过 --database 或 LANDSCAPE_DB 指定现有持久数据库的绝对路径。')
    if not 1 <= args.credits <= 1000 or not 1 <= args.count <= 100 or not 1 <= args.hours <= 24:
        parser.error('积分须为 1–1000，数量须为 1–100，有效期须为 1–24 小时。')
    app = Flask(__name__)
    app.config['COMMUNITY_DB_PATH'] = str(Path(args.database).resolve())
    with app.app_context():
        # Import inside the context: auth's schema initialization must target this database too.
        from community_modules.db import get_db, init_db
        from community_modules.credits import generate_redemption_code
        init_db()
        conn = get_db()
        try:
            for _ in range(args.count):
                item = generate_redemption_code(conn, args.credits, args.email, args.hours)
                print(f"兑换码: {item['code']} | +{item['credits']} 积分 | 过期时间: {item['expires_at']}")
        finally:
            conn.close()



if __name__ == '__main__':
    main()
