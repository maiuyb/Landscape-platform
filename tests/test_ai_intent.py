"""Assistant intent validation and forwarding; no network or project storage."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock


class AssistantIntentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.storage = tempfile.TemporaryDirectory()
        module_path = Path(__file__).resolve().parents[1] / '风景调色协作平台/backend/app.py'
        spec = importlib.util.spec_from_file_location('assistant_test_app', module_path)
        cls.backend = importlib.util.module_from_spec(spec)
        with patch('os.path.abspath', return_value=str(Path(cls.storage.name) / 'app.py')):
            spec.loader.exec_module(cls.backend)
        cls.backend.app.config['TESTING'] = True
        cls.client = cls.backend.app.test_client()

    @classmethod
    def tearDownClass(cls):
        cls.storage.cleanup()

    def test_optional_intent_preserves_old_requests_and_forwards_trimmed_text(self):
        for body, expected in [({'image_base64': 'example', 'diagnosis': []}, ''),
                               ({'intent': '  保留暖色，让天空暗一些  '}, '保留暖色，让天空暗一些')]:
            with patch.object(self.backend, 'call_tongyi_qianwen', return_value={'demo': True, 'recipes': []}) as call:
                response = self.client.post('/api/ai/recommend', json=body)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(call.call_args.args[2], expected)

    def test_bad_intent_rejected_before_model_call(self):
        with patch.object(self.backend, 'call_tongyi_qianwen') as call:
            for body in [[], {'intent': 7}, {'intent': 'x' * 801}]:
                self.assertEqual(self.client.post('/api/ai/recommend', json=body).status_code, 400)
            call.assert_not_called()

    def test_cloud_prompt_contains_intent_and_demo_stays_explicit(self):
        response = Mock()
        response.json.return_value = {'output': {'text': json.dumps({'recipes': []})}}
        with patch.object(self.backend, 'DASHSCOPE_API_KEY', 'unit-test-value'), patch('requests.post', return_value=response) as post:
            self.backend.call_tongyi_qianwen('example', [], '减少饱和度，保持自然')
            prompt = post.call_args.kwargs['json']['input']['messages'][0]['content'][0]['text']
            self.assertIn('减少饱和度，保持自然', prompt)
            self.assertIn('JSON', prompt)
        with patch.object(self.backend, 'DASHSCOPE_API_KEY', ''):
            result = self.backend.call_tongyi_qianwen('', [], '减少饱和度')
            self.assertTrue(result['demo'])
            self.assertTrue(result['recipes'])


if __name__ == '__main__':
    unittest.main()
