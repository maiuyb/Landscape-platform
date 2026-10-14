# -*- coding: utf-8 -*-
"""数据库层：连接、建表与增量迁移。

只负责 schema 与连接，不承载业务逻辑（业务查询见 repository.py）。
所有操作幂等，可在任意模块导入时安全调用 init_db()。
"""

import sqlite3

from config import DB_PATH


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


def _table_columns(conn, table):
    rows = conn.execute('PRAGMA table_info(%s)' % table).fetchall()
    return {row['name'] for row in rows}


def _add_column_if_missing(conn, table, column, declaration):
    if column not in _table_columns(conn, table):
        conn.execute('ALTER TABLE %s ADD COLUMN %s %s' % (table, column, declaration))


def init_db():
    conn = get_db()
    try:
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
            author_id INTEGER,
            description TEXT DEFAULT '',
            cover_before TEXT DEFAULT '',
            cover_after TEXT DEFAULT '',
            steps TEXT DEFAULT '[]',
            features TEXT DEFAULT '{}',
            category TEXT DEFAULT '',
            tags TEXT DEFAULT '[]',
            version INTEGER DEFAULT 1,
            likes INTEGER DEFAULT 0,
            deleted_at DATETIME DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )''')
        c.execute('''CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )''')
        c.execute('''CREATE TABLE IF NOT EXISTS favorites (
            user_id INTEGER NOT NULL,
            recipe_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, recipe_id)
        )''')

        # 兼容早期原型数据库
        _add_column_if_missing(conn, 'recipes', 'author_id', 'INTEGER')
        _add_column_if_missing(conn, 'recipes', 'category', "TEXT DEFAULT ''")
        _add_column_if_missing(conn, 'recipes', 'tags', "TEXT DEFAULT '[]'")
        _add_column_if_missing(conn, 'recipes', 'version', 'INTEGER DEFAULT 1')
        _add_column_if_missing(conn, 'recipes', 'deleted_at', 'DATETIME')

        c.execute('CREATE INDEX IF NOT EXISTS idx_favorites_recipe ON favorites(recipe_id)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_recipes_author ON recipes(author_id)')
        conn.commit()
    finally:
        conn.close()
