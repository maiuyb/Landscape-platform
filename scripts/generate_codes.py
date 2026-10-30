#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""命令行批量或单枚生成 24 小时有效、单次核销的显影积分兑换码。

用法示例:
    python3 scripts/generate_codes.py --credits 30 --count 5
"""

import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / '风景调色协作平台' / 'backend'
sys.path.insert(0, str(BACKEND_DIR))

from community_modules.db import get_db, init_db  # noqa: E402
from community_modules.credits import generate_redemption_code  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description='生成 24 小时有效显影积分兑换码')
    parser.add_argument('--credits', type=int, default=30, help='每枚兑换码包含的积分数量（默认 30）')
    parser.add_argument('--count', type=int, default=1, help='生成数量（默认 1）')
    parser.add_argument('--hours', type=int, default=24, help='有效小时数（默认 24 小时）')
    parser.add_argument('--email', type=str, default='', help='可选关联邮箱')
    args = parser.parse_args()

    init_db()
    conn = get_db()
    try:
        print(f'=== 已生成 {args.count} 枚兑换码（面额 +{args.credits} 积分，有效期 {args.hours} 小时） ===')
        for _ in range(max(1, args.count)):
            item = generate_redemption_code(
                conn,
                credits=args.credits,
                recipient_email=args.email,
                ttl_hours=args.hours,
                max_uses=1,
            )
            print(f"兑换码: {item['code']}  |  +{item['credits']} 积分  |  过期时间: {item['expires_at']}")
    finally:
        conn.close()


if __name__ == '__main__':
    main()
