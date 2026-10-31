# -*- coding: utf-8 -*-
"""数据库层：连接、建表与增量迁移。

只负责 schema 与连接，不承载业务逻辑（业务查询见 repository.py）。
所有操作幂等，可在任意模块导入时安全调用 init_db()。
"""

import sqlite3
import os
from flask import current_app, has_app_context

from .config import DB_PATH


def get_db():
    conn = sqlite3.connect(current_app.config['COMMUNITY_DB_PATH'] if has_app_context() else os.environ.get('LANDSCAPE_DB', DB_PATH), timeout=15)
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
            display_name TEXT DEFAULT '',
            bio TEXT DEFAULT '',
            location TEXT DEFAULT '',
            show_bio INTEGER DEFAULT 1,
            show_location INTEGER DEFAULT 1,
            show_stats INTEGER DEFAULT 1,
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
            rendering TEXT DEFAULT NULL,
            pairing TEXT DEFAULT NULL,
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
        c.execute('''CREATE TABLE IF NOT EXISTS saved_recipes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            source_recipe_id INTEGER,
            name TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            author TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '[]',
            recipe TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, source_recipe_id)
        )''')
        c.execute('CREATE INDEX IF NOT EXISTS idx_saved_recipes_user ON saved_recipes(user_id, id)')
        _add_column_if_missing(conn, 'recipes', 'author_id', 'INTEGER')
        _add_column_if_missing(conn, 'recipes', 'category', "TEXT DEFAULT ''")
        _add_column_if_missing(conn, 'recipes', 'tags', "TEXT DEFAULT '[]'")
        _add_column_if_missing(conn, 'recipes', 'version', 'INTEGER DEFAULT 1')
        _add_column_if_missing(conn, 'recipes', 'rendering', 'TEXT')
        _add_column_if_missing(conn, 'recipes', 'pairing', 'TEXT')
        _add_column_if_missing(conn, 'recipes', 'deleted_at', 'DATETIME')

        _add_column_if_missing(conn, 'users', 'display_name', "TEXT DEFAULT ''")
        _add_column_if_missing(conn, 'users', 'bio', "TEXT DEFAULT ''")
        _add_column_if_missing(conn, 'users', 'location', "TEXT DEFAULT ''")
        _add_column_if_missing(conn, 'users', 'show_bio', 'INTEGER DEFAULT 1')
        _add_column_if_missing(conn, 'users', 'show_location', 'INTEGER DEFAULT 1')
        _add_column_if_missing(conn, 'users', 'show_stats', 'INTEGER DEFAULT 1')
        _add_column_if_missing(conn, 'users', 'credits', 'INTEGER DEFAULT 10')
        _add_column_if_missing(conn, 'users', 'last_checkin_date', "TEXT DEFAULT ''")
        _add_column_if_missing(conn, 'users', 'email', "TEXT DEFAULT ''")
        _add_column_if_missing(conn, 'users', 'email_verified', 'INTEGER DEFAULT 0')
        c.execute("UPDATE users SET display_name = username "
                  "WHERE display_name IS NULL OR TRIM(display_name) = ''")
        c.execute("UPDATE users SET credits = 10 WHERE credits IS NULL")

        c.execute('''CREATE TABLE IF NOT EXISTS email_verifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            code TEXT NOT NULL,
            purpose TEXT NOT NULL DEFAULT 'verify',
            expires_at DATETIME NOT NULL,
            used INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )''')
        c.execute('CREATE INDEX IF NOT EXISTS idx_email_verifications_email ON email_verifications(email, used)')

        c.execute('''CREATE TABLE IF NOT EXISTS redemption_codes (
            code TEXT PRIMARY KEY,
            credits INTEGER NOT NULL,
            max_uses INTEGER NOT NULL DEFAULT 1,
            used_count INTEGER NOT NULL DEFAULT 0,
            recipient_email TEXT DEFAULT '',
            expires_at DATETIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )''')

        c.execute('''CREATE TABLE IF NOT EXISTS redemption_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            code TEXT NOT NULL,
            credits INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, code)
        )''')

        c.execute('''CREATE TABLE IF NOT EXISTS sponsor_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            email TEXT NOT NULL,
            amount_note TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            issued_code TEXT DEFAULT '',
            approve_token TEXT UNIQUE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )''')

        # Empty emails remain valid for password-only accounts; verified identities are unique.
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_verified_email "
                  "ON users(lower(trim(email))) WHERE email_verified = 1 AND trim(email) <> ''")
        _add_column_if_missing(conn, 'email_verifications', 'user_id', 'INTEGER')
        _add_column_if_missing(conn, 'email_verifications', 'attempts', 'INTEGER NOT NULL DEFAULT 0')
        _add_column_if_missing(conn, 'email_verifications', 'delivered', 'INTEGER NOT NULL DEFAULT 0')
        for name, declaration in (
            ('expires_at', "TEXT NOT NULL DEFAULT ''"),
            ('notify_status', "TEXT NOT NULL DEFAULT 'pending'"),
            ('notify_started_at', "TEXT NOT NULL DEFAULT ''"),
            ('delivery_status', "TEXT NOT NULL DEFAULT 'pending'"),
            ('delivery_started_at', "TEXT NOT NULL DEFAULT ''"),
        ):
            _add_column_if_missing(conn, 'sponsor_requests', name, declaration)
        c.execute('''CREATE TABLE IF NOT EXISTS credit_rate_limits (
            action TEXT NOT NULL, subject TEXT NOT NULL, window_start INTEGER NOT NULL,
            hits INTEGER NOT NULL, PRIMARY KEY(action, subject)
        )''')
        c.execute('''CREATE TABLE IF NOT EXISTS ai_credit_reservations (
            id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
            status TEXT NOT NULL, created_at INTEGER NOT NULL
        )''')

        c.execute('CREATE INDEX IF NOT EXISTS idx_ai_credit_reservations_status ON ai_credit_reservations(status, created_at, user_id)')
        c.execute('''CREATE TABLE IF NOT EXISTS auth_rate_limits (
            action TEXT NOT NULL, subject TEXT NOT NULL, window_start INTEGER NOT NULL,
            hits INTEGER NOT NULL, PRIMARY KEY(action, subject))''')
        c.execute('''CREATE TABLE IF NOT EXISTS auth_failures (
            subject TEXT PRIMARY KEY, started_at INTEGER NOT NULL,
            hits INTEGER NOT NULL, cooldown_until INTEGER NOT NULL)''')
        c.execute('''CREATE TABLE IF NOT EXISTS auth_captchas (
            id TEXT PRIMARY KEY, subject TEXT NOT NULL, purpose TEXT NOT NULL,
            salt TEXT NOT NULL, answer_hash TEXT NOT NULL, expires_at INTEGER NOT NULL)''')
        c.execute('CREATE INDEX IF NOT EXISTS idx_favorites_recipe ON favorites(recipe_id)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_recipes_author ON recipes(author_id)')
        conn.commit()
    finally:
        conn.close()
