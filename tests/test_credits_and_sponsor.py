"""Unit tests for AI credits, daily check-in, 163 email verification, and 24h sponsor redemption codes."""
import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock

from PIL import Image


class CreditsAndSponsorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.storage = tempfile.TemporaryDirectory()
        module_path = Path(__file__).resolve().parents[1] / '风景调色协作平台/backend/app.py'
        with patch.object(sys, 'path', [str(module_path.parent), *sys.path]):
            import ai_service
            cls.ai = ai_service
            spec = importlib.util.spec_from_file_location('credits_test_app', module_path)
            cls.backend = importlib.util.module_from_spec(spec)
            with patch('os.path.abspath', return_value=str(Path(cls.storage.name) / 'app.py')), \
                 patch.object(ai_service, 'dotenv_values', return_value={}), \
                 patch.dict(os.environ, {'DASHSCOPE_API_KEY': '', 'AI_MODE': 'demo', 'SMTP_PASS': ''}):
                spec.loader.exec_module(cls.backend)
        cls.backend.app.config['TESTING'] = True
        cls.client = cls.backend.app.test_client()
        buf = io.BytesIO()
        Image.new('RGB', (16, 12), (30, 80, 120)).save(buf, format='JPEG')
        cls.image = base64.b64encode(buf.getvalue()).decode()

    @classmethod
    def tearDownClass(cls):
        cls.storage.cleanup()

    def setUp(self):
        self.backend.ai_service = self.ai.AIService({
            'AI_MODE': 'live',
            'DASHSCOPE_API_KEY': 'unit-test-value',
            'AI_REQUESTS_PER_MINUTE': '120',
        })
        self.body = {
            'intent': '保留暖色，让天空暗一些',
            'image_base64': self.image,
            'current_state': {'adjustments': {'exposure': 0.5, 'temperature': 12}, 'mask_count': 1},
            'history': [],
        }

    def upstream(self):
        output = {
            'message': '建议保留暖色并收住高光。',
            'proposals': [{'name': '保留暖光', 'preset_id': 'golden-sunset', 'strength': 65, 'adjustments': {'highlights': -20}}],
        }
        payload = {
            'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(output)}}],
            'usage': {'prompt_tokens': 400, 'completion_tokens': 100, 'total_tokens': 500},
        }
        return Mock(status_code=200, content=json.dumps(payload).encode(), json=Mock(return_value=payload))

    def test_register_checkin_email_bind_and_public_privacy(self):
        reg = self.client.post('/api/auth/register', json={'username': 'ezio_credit', 'password': 'password123'})
        self.assertEqual(reg.status_code, 200)
        token = reg.json['token']
        user = reg.json['user']
        self.assertEqual(user['credits'], 10)
        self.assertFalse(user['checked_in_today'])
        self.assertFalse(user['email_verified'])

        # Public user profile must NOT expose private credit or email fields
        pub = self.client.get(f"/api/users/{user['id']}")
        self.assertEqual(pub.status_code, 200)
        self.assertNotIn('credits', pub.json['user'])
        self.assertNotIn('email', pub.json['user'])
        self.assertNotIn('checked_in_today', pub.json['user'])

        headers = {'Authorization': f'Bearer {token}'}
        # Daily check-in (+3)
        checkin1 = self.client.post('/api/credits/checkin', headers=headers)
        self.assertEqual(checkin1.status_code, 200)
        self.assertEqual(checkin1.json['credits'], 13)
        self.assertTrue(checkin1.json['checked_in_today'])

        # Duplicate check-in on same day rejected
        checkin2 = self.client.post('/api/credits/checkin', headers=headers)
        self.assertEqual(checkin2.status_code, 400)

        # Send email verification code & bind email (+5 first-time bonus)
        with patch.dict(os.environ, {'SMTP_PASS': ''}):
            send_res = self.client.post(
                '/api/auth/email/send-code',
                json={'email': 'ezio_test@163.com', 'purpose': 'bind'},
                headers=headers,
            )
        self.assertEqual(send_res.status_code, 200)
        code = send_res.json['preview_code']
        self.assertEqual(len(code), 6)

        verify_res = self.client.post(
            '/api/auth/email/verify',
            json={'email': 'ezio_test@163.com', 'code': code},
            headers=headers,
        )
        self.assertEqual(verify_res.status_code, 200)
        self.assertEqual(verify_res.json['mode'], 'bind')
        self.assertEqual(verify_res.json['bonus_credits'], 5)
        self.assertEqual(verify_res.json['credits'], 18)
        self.assertTrue(verify_res.json['user']['email_verified'])

    def test_email_login_creates_or_signs_in_user(self):
        with patch.dict(os.environ, {'SMTP_PASS': ''}):
            send_res = self.client.post(
                '/api/auth/email/send-code',
                json={'email': 'new_photographer@163.com', 'purpose': 'login'},
            )
        self.assertEqual(send_res.status_code, 200)
        code = send_res.json['preview_code']

        login_res = self.client.post(
            '/api/auth/email/verify',
            json={'email': 'new_photographer@163.com', 'code': code},
        )
        self.assertEqual(login_res.status_code, 200)
        self.assertEqual(login_res.json['mode'], 'login')
        self.assertTrue(login_res.json['token'])
        self.assertEqual(login_res.json['user']['credits'], 15)

    def test_sponsor_notify_approve_24h_code_and_single_use_redeem(self):
        reg = self.client.post('/api/auth/register', json={'username': 'sponsor_user', 'password': 'password123'})
        token = reg.json['token']
        headers = {'Authorization': f'Bearer {token}'}

        with patch.dict(os.environ, {'SMTP_PASS': ''}):
            notify = self.client.post(
                '/api/credits/sponsor-notify',
                json={'email': 'sponsor_user@163.com', 'amount_note': '支付宝已转 10 元'},
                headers=headers,
            )
        self.assertEqual(notify.status_code, 200)
        req_id = notify.json['request_id']

        with self.backend.app.app_context():
            conn = self.backend.get_db()
            try:
                row = conn.execute('SELECT approve_token FROM sponsor_requests WHERE id = ?', (req_id,)).fetchone()
                approve_token = row['approve_token']
            finally:
                conn.close()

        with patch.dict(os.environ, {'SMTP_PASS': ''}):
            approve = self.client.get(f'/api/credits/sponsor-approve?token={approve_token}&credits=50')
        self.assertEqual(approve.status_code, 200)
        html = approve.get_data(as_text=True)
        match = re.search(r'LC-[A-Z0-9]{4}-[A-Z0-9]{4}', html)
        self.assertIsNotNone(match)
        issued_code = match.group(0)

        # Redeem the 24h code (+50 credits)
        redeem1 = self.client.post('/api/credits/redeem', json={'code': issued_code}, headers=headers)
        self.assertEqual(redeem1.status_code, 200)
        self.assertEqual(redeem1.json['added'], 50)
        self.assertEqual(redeem1.json['credits'], 60)

        # Single-use: second redemption must fail
        redeem2 = self.client.post('/api/credits/redeem', json={'code': issued_code}, headers=headers)
        self.assertEqual(redeem2.status_code, 400)

        # Expired code check (>24h)
        with self.backend.app.app_context():
            conn = self.backend.get_db()
            try:
                conn.execute(
                    '''INSERT INTO redemption_codes (code, credits, max_uses, used_count, recipient_email, expires_at, created_at)
                       VALUES ('LC-EXPR-0001', 20, 1, 0, 'a@b.com', '2020-01-01 00:00:00', '2019-12-31 00:00:00')'''
                )
                conn.commit()
            finally:
                conn.close()
        expired_res = self.client.post('/api/credits/redeem', json={'code': 'LC-EXPR-0001'}, headers=headers)
        self.assertEqual(expired_res.status_code, 400)
        self.assertIn('24 小时', expired_res.json['error'])

    def test_ai_recommend_deducts_credit_in_live_mode_and_blocks_when_zero(self):
        reg = self.client.post('/api/auth/register', json={'username': 'ai_credit_user', 'password': 'password123'})
        token = reg.json['token']
        uid = reg.json['user']['id']
        headers = {'Authorization': f'Bearer {token}'}

        # Set user credits to 1
        with self.backend.app.app_context():
            conn = self.backend.get_db()
            try:
                conn.execute('UPDATE users SET credits = 1 WHERE id = ?', (uid,))
                conn.commit()
            finally:
                conn.close()

        with patch.object(self.ai.requests, 'post', return_value=self.upstream()):
            res1 = self.client.post('/api/ai/recommend', json=self.body, headers=headers)
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res1.json['credits'], 0)

        # Next live call with 0 credits must return 402 insufficient_credits
        with patch.object(self.ai.requests, 'post', return_value=self.upstream()) as post_mock:
            res2 = self.client.post('/api/ai/recommend', json=self.body, headers=headers)
        self.assertEqual(res2.status_code, 402)
        self.assertEqual(res2.json['code'], 'insufficient_credits')
        post_mock.assert_not_called()


if __name__ == '__main__':
    unittest.main()
