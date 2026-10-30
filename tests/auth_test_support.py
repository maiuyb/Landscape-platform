"""Synthetic account fixtures only; never imported by the application."""
from flask import jsonify, request


def seed_user(app, username, password='synthetic-only'):
    from community_modules.auth import hash_password, create_token
    from community_modules.db import get_db
    from community_modules import repository as repo
    with app.app_context():
        conn = get_db()
        try:
            cur = conn.execute('INSERT INTO users(username,password_hash,display_name) VALUES(?,?,?)',
                (username, hash_password(password), username))
            conn.commit()
            user = repo.serialize_user(conn, repo.get_user_by_id(conn, cur.lastrowid), self_view=True)
        finally:
            conn.close()
        return dict(user=user, token=create_token(user['id']))


def install_fixture(app):
    """Installed by disposable loopback test servers, never by production."""
    from community_modules import security
    security.secrets.choice = lambda values: 'A'
    @app.post('/__test/register')
    def fixture_register():
        data = request.get_json()
        return jsonify(seed_user(app, data['username'], data.get('password','synthetic-only')))
