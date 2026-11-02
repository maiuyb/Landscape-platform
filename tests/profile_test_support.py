"""Shared synthetic profile fixtures; contains no tests."""
import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request as WSGIRequest


class ProfileTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.storage = tempfile.TemporaryDirectory()
        cls.root = Path(cls.storage.name)
        sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'风景调色协作平台/backend'))
        with patch('dotenv.dotenv_values', return_value={}), patch.dict(os.environ, {
            'LANDSCAPE_DB': str(cls.root/'initial.db'),
            'LANDSCAPE_UPLOAD_DIR': str(cls.root/'uploads'), 'AI_MODE': 'demo',
            'DASHSCOPE_API_KEY': '', 'SMTP_PASS': ''}):
            spec = importlib.util.spec_from_file_location('profile_test_app', Path(__file__).resolve().parents[1]/'风景调色协作平台/backend/app.py')
            cls.backend = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.backend)
        cls.backend.app.config['TESTING'] = True

    @classmethod
    def tearDownClass(cls):
        cls.storage.cleanup()

    def setUp(self):
        from community_modules import profile
        upload_patch = patch.object(profile, 'UPLOAD_DIR', self.backend.UPLOAD_DIR)
        upload_patch.start()
        self.addCleanup(upload_patch.stop)
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

    def upload(self,body,name='synthetic.png'):
        with closing(EnvironBuilder(path='/api/upload',method='POST',data={'file':(io.BytesIO(body),name)},content_type='multipart/form-data')) as builder:
            environ = builder.get_environ()
            try:
                response = self.client.open(WSGIRequest(environ))
                self.assertEqual(response.status_code,200)
                return response.json['url']
            finally:
                environ['wsgi.input'].close()
