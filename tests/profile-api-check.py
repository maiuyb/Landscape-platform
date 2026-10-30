"""Run separately: synthetic storage, no real configuration or account data."""
import hashlib
import io
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch
from PIL import Image
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request as WSGIRequest


class Profiles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.storage = tempfile.TemporaryDirectory()
        cls.root = Path(cls.storage.name)
        os.environ.update(LANDSCAPE_DB=str(cls.root/'initial.db'),
                          LANDSCAPE_UPLOAD_DIR=str(cls.root/'uploads'), AI_MODE='demo')
        sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'风景调色协作平台/backend'))
        import ai_service
        with patch.object(ai_service,'dotenv_values',return_value={}):
            import app
        cls.backend = app
        app.app.config['TESTING'] = True

    @classmethod
    def tearDownClass(cls):
        cls.storage.cleanup()

    def setUp(self):
        self.database = self.root/(self._testMethodName+'.db')
        self.backend.app.config['COMMUNITY_DB_PATH'] = str(self.database)
        with self.backend.app.app_context():
            self.backend.community_db.init_db()
        self.client = self.backend.app.test_client()
        self.users = []
        for name in ('synthetic-owner','synthetic-other'):
            from auth_test_support import seed_user
            self.users.append(seed_user(self.backend.app, name))
        self.headers = {'Authorization':'Bearer '+self.users[0]['token']}

    def test_registration_login_and_self_profile(self):
        user = self.users[0]['user']
        self.assertEqual(user['display_name'],'synthetic-owner')
        for endpoint in ('/api/auth/me','/api/users/me'):
            response = self.client.get(endpoint,headers=self.headers)
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.json['user']['id'],user['id'])
            self.assertNotIn('password_hash',response.json['user'])
        self.assertEqual(self.client.post('/api/auth/login',json={'username':'synthetic-owner','password':'synthetic-only'}).status_code,200)

    def test_avatar_only_update_preserves_legacy_long_display_name(self):
        with self.backend.app.app_context():
            conn = self.backend.get_db()
            conn.execute('UPDATE users SET display_name = ? WHERE id = ?', ('legacy-display-name-longer-than-twenty', self.users[0]['user']['id']))
            conn.commit(); conn.close()
        response = self.client.put('/api/users/me', headers=self.headers, json={'avatar': ''})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['user']['display_name'], 'legacy-display-name-longer-than-twenty')
        self.assertEqual(self.client.put('/api/users/me', headers=self.headers, json={'display_name': 'x'*21}).status_code, 400)

    def test_update_is_owned_and_authentication_required(self):
        self.assertEqual(self.client.put('/api/users/me',json={}).status_code,401)
        response = self.client.put('/api/users/me',headers=self.headers,json={
            'display_name':'合成作者','bio':'测试简介','location':'测试城市','id':self.users[1]['user']['id']})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json['user']['display_name'],'合成作者')
        self.assertEqual(self.client.get('/api/users/'+str(self.users[1]['user']['id'])).json['user']['display_name'],'synthetic-other')

    def test_invalid_json_and_field_boundaries(self):
        for body in ([],[1],None,1,'invalid',{'display_name':''},{'display_name':'x'*21},
                     {'bio':'x'*161},{'location':'x'*41},{'bio':{}},{'avatar':[]}):
            self.assertEqual(self.client.put('/api/users/me',headers=self.headers,json=body).status_code,400,repr(body))

    def upload(self,body,name='synthetic.png'):
        with closing(EnvironBuilder(path='/api/upload',method='POST',data={'file':(io.BytesIO(body),name)},content_type='multipart/form-data')) as builder:
            environ = builder.get_environ()
            try:
                response = self.client.open(WSGIRequest(environ))
                self.assertEqual(response.status_code,200)
                return response.json['url']
            finally:
                environ['wsgi.input'].close()

    def test_avatar_root_and_prefix_with_real_image_verification(self):
        stream = io.BytesIO();Image.new('RGB',(64,48),'#416b54').save(stream,format='PNG')
        url = self.upload(stream.getvalue())
        for value in (url,'/landscape'+url):
            response = self.client.put('/api/users/me',headers=self.headers,json={'avatar':value},environ_overrides={'SCRIPT_NAME':'/landscape'})
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.json['user']['avatar'],value)

    def test_avatar_rejects_foreign_paths_bad_bytes_and_size(self):
        corrupt = self.upload(b'not an image')
        huge = self.upload(b'x'*(5*1024*1024+1))
        for value in ('https://outside.invalid/a.png','/foreign/uploads/a.png','/uploads/../a.png',
                      '/uploads/a.png?query=1',corrupt,huge):
            self.assertEqual(self.client.put('/api/users/me',headers=self.headers,json={'avatar':value}).status_code,400)

    def test_public_view_filters_private_fields_and_author_works(self):
        uid = self.users[0]['user']['id']
        c = sqlite3.connect(self.database)
        c.execute("INSERT INTO recipes(name,author,author_id,deleted_at) VALUES('visible','synthetic-owner',?,NULL)",(uid,))
        c.execute("INSERT INTO recipes(name,author,author_id,deleted_at) VALUES('deleted','synthetic-owner',?,'2026-10-24')",(uid,))
        c.commit();c.close()
        public = self.client.get('/api/users/'+str(uid)).json['user']
        self.assertEqual(public['works_count'],1)
        self.assertNotIn('favorites_given',public)
        self.assertNotIn('password_hash',public)
        listing = self.client.get('/api/recipes?author_id='+str(uid)).json
        self.assertEqual(listing['total'],1)
        self.assertEqual(self.client.get('/api/users/999999').status_code,404)

    def test_owned_deleted_records_filter_pagination_and_recovery(self):
        uid, other_id = [user['user']['id'] for user in self.users]
        with closing(sqlite3.connect(self.database)) as conn:
            for index in range(2):
                conn.execute("INSERT INTO recipes(name,author,author_id) VALUES(?,?,?)", ('published-'+str(index), 'synthetic-owner', uid))
            for index in range(22):
                conn.execute("INSERT INTO recipes(name,author,author_id,deleted_at) VALUES(?,?,?,datetime('now','-1 hour'))", ('deleted-'+str(index), 'synthetic-owner', uid))
            expired = conn.execute("INSERT INTO recipes(name,author,author_id,deleted_at) VALUES('expired','synthetic-owner',?,datetime('now','-8 days'))", (uid,)).lastrowid
            conn.execute("INSERT INTO recipes(name,author,author_id,deleted_at) VALUES('foreign','synthetic-other',?,datetime('now'))", (other_id,))
            conn.commit()
        self.assertEqual(self.client.get('/api/me/uploads?status=deleted').status_code, 401)
        self.assertEqual(self.client.get('/api/me/uploads?status=invalid', headers=self.headers).status_code, 400)
        self.assertEqual(self.client.get('/api/me/uploads', headers=self.headers).json['total'], 25)
        first = self.client.get('/api/me/uploads?status=deleted&page_size=10', headers=self.headers).json
        self.assertEqual(first['total'], 23)
        self.assertEqual(len(first['recipes']), 10)
        self.assertTrue(first['has_more'])
        self.assertTrue(all(row['deleted'] and row['author_id'] == uid for row in first['recipes']))
        last = self.client.get('/api/me/uploads?status=deleted&page_size=10&page=3', headers=self.headers).json
        self.assertEqual(len(last['recipes']), 3)
        self.assertFalse(last['has_more'])
        old = next(row for row in last['recipes'] if row['id'] == expired)
        self.assertFalse(old['recoverable'])
        self.assertEqual(self.client.post('/api/recipes/'+str(expired)+'/restore', headers=self.headers).status_code, 400)
        recent = first['recipes'][0]['id']
        foreign_headers = {'Authorization': 'Bearer '+self.users[1]['token']}
        self.assertEqual(self.client.post('/api/recipes/'+str(recent)+'/restore', headers=foreign_headers).status_code, 403)
        self.assertEqual(self.client.post('/api/recipes/'+str(recent)+'/restore', headers=self.headers).status_code, 200)
        self.assertEqual(self.client.get('/api/me/uploads?status=deleted', headers=self.headers).json['total'], 22)
        self.assertEqual(self.client.get('/api/me/recipes', headers=self.headers).json['total'], 3)
        self.assertEqual(self.client.get('/api/recipes?author_id='+str(uid)).json['total'], 3)

    def test_legacy_migration_preserves_password_and_session(self):
        legacy = self.root/'legacy.db'
        c = sqlite3.connect(legacy)
        c.executescript("CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,avatar TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP);")
        password = hashlib.sha256(b'synthetic-only').hexdigest()
        c.execute('INSERT INTO users(id,username,password_hash) VALUES(1,?,?)',('legacy-user',password));c.commit();c.close()
        self.backend.app.config['COMMUNITY_DB_PATH'] = str(legacy)
        with self.backend.app.app_context():
            self.backend.community_db.init_db()
            self.backend.community_db.init_db()
        result = self.client.post('/api/auth/login',json={'username':'legacy-user','password':'synthetic-only'})
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.json['user']['display_name'],'legacy-user')
        with self.backend.app.app_context():self.backend.community_db.init_db()
        self.assertEqual(self.client.get('/api/auth/me',headers={'Authorization':'Bearer '+result.json['token']}).status_code,200)
        c = sqlite3.connect(legacy);self.assertTrue(c.execute('SELECT password_hash FROM users').fetchone()[0].startswith('pbkdf2:sha256:600000$'));c.close()


if __name__ == '__main__':
    unittest.main()
