"""Upload boundary regressions, with all application storage isolated in a temp dir."""
import importlib.util
import io
import sys
from contextlib import closing
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request as WSGIRequest


class UploadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.storage = tempfile.TemporaryDirectory()
        cls.root = Path(cls.storage.name)
        module_path = Path(__file__).resolve().parents[1] / '风景调色协作平台/backend/app.py'
        spec = importlib.util.spec_from_file_location('upload_test_app', module_path)
        cls.backend = importlib.util.module_from_spec(spec)
        # The prototype initializes its database and uploads on import. Redirect
        # the base directory before executing it; never touch project/user data.
        with patch.object(sys, 'path', [str(module_path.parent), *sys.path]), patch('os.path.abspath', return_value=str(cls.root / 'app.py')):
            spec.loader.exec_module(cls.backend)
        cls.backend.app.config['TESTING'] = True
        cls.client = cls.backend.app.test_client()

    @classmethod
    def tearDownClass(cls):
        cls.storage.cleanup()

    def upload(self, size, filename='photo.png', **kwargs):
        overrides = kwargs.pop('environ_overrides', {})
        with closing(EnvironBuilder(path='/api/upload', method='POST', data={
            'file': (io.BytesIO(b'x' * size), filename)
        }, content_type='multipart/form-data', **kwargs)) as builder:
            environ = builder.get_environ()
            environ.update(overrides)
            try:
                # Pass a Request directly so the test client does not rebuild
                # the environ and infer a new Content-Length from its stream.
                return self.client.open(WSGIRequest(environ))
            finally:
                environ['wsgi.input'].close()

    def assert_rejected_without_save(self, size, **kwargs):
        before = set((self.root / 'uploads').iterdir())
        with patch.object(self.backend.uuid, 'uuid4') as new_name:
            response = self.upload(size, **kwargs)
            new_name.assert_not_called()
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.content_type, 'application/json')
        self.assertIn('20MB', response.get_json()['error'])
        self.assertEqual(set((self.root / 'uploads').iterdir()), before)

    def test_normal_file_is_saved_completely_and_can_be_downloaded(self):
        response = self.upload(1024)
        self.assertEqual(response.status_code, 200)
        saved = self.client.get(response.get_json()['url'])
        try:
            self.assertEqual(saved.status_code, 200)
            self.assertEqual(saved.data, b'x' * 1024)
        finally:
            saved.close()

    def test_exactly_twenty_mib_is_accepted_with_multipart_overhead(self):
        limit = self.backend.MAX_UPLOAD_FILE_BYTES
        response = self.upload(limit)
        self.assertEqual(response.status_code, 200)
        filename = response.get_json()['url'].rsplit('/', 1)[1]
        self.assertEqual((self.root / 'uploads' / filename).stat().st_size, limit)

    def test_one_byte_over_file_limit_is_rejected(self):
        self.assert_rejected_without_save(self.backend.MAX_UPLOAD_FILE_BYTES + 1)

    def test_request_over_limit_is_rejected_before_body_parsing(self):
        # No body is needed: the declared total length alone must be rejected.
        before = set((self.root / 'uploads').iterdir())
        with patch.object(self.backend.uuid, 'uuid4') as new_name:
            response = self.client.post('/api/upload', content_type='multipart/form-data; boundary=test',
                environ_overrides={'CONTENT_LENGTH': str(self.backend.MAX_UPLOAD_REQUEST_BYTES + 1)})
            new_name.assert_not_called()
        self.assertEqual(response.status_code, 413)
        self.assertIn('20MB', response.get_json()['error'])
        self.assertEqual(set((self.root / 'uploads').iterdir()), before)

    def test_terminated_stream_without_content_length_still_checks_file_size(self):
        self.assert_rejected_without_save(self.backend.MAX_UPLOAD_FILE_BYTES + 1,
            environ_overrides={'CONTENT_LENGTH': '', 'wsgi.input_terminated': True})

    def test_large_terminated_stream_is_bounded_by_request_limit(self):
        streams = []
        original = self.backend.UploadRequest._get_file_stream
        def capture(request, *args, **kwargs):
            stream = original(request, *args, **kwargs)
            streams.append(stream)
            return stream
        with patch.object(self.backend.UploadRequest, '_get_file_stream', capture):
            self.assert_rejected_without_save(self.backend.MAX_UPLOAD_REQUEST_BYTES + 1,
                environ_overrides={'CONTENT_LENGTH': '', 'wsgi.input_terminated': True})
        self.assertTrue(streams)
        self.assertTrue(all(stream.closed for stream in streams))

    def test_missing_file_and_unsupported_extension_keep_existing_errors(self):
        response = self.client.post('/api/upload', data={})
        self.assertEqual(response.status_code, 400)
        response = self.upload(20, filename='file.txt')
        self.assertEqual(response.status_code, 400)
        self.assertIn('JPG/PNG/WebP', response.get_json()['error'])

    def test_upload_limit_does_not_leak_to_other_endpoints(self):
        self.assert_rejected_without_save(self.backend.MAX_UPLOAD_FILE_BYTES + 1)
        with self.backend.app.test_request_context('/api/ai/recommend', method='POST'):
            self.assertIsNone(self.backend.request.max_content_length)


if __name__ == '__main__':
    unittest.main()
