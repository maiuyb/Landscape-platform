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
            response = self.client.post('/api/auth/register',json={'username':name,'password':'synthetic-only'})
            self.assertEqual(response.status_code,200)
            self.users.append(response.json)
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
        c = sqlite3.connect(legacy);self.assertEqual(c.execute('SELECT password_hash FROM users').fetchone()[0],password);c.close()


if __name__ == '__main__':
    unittest.main()
