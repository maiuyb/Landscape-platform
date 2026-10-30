"""Mailbox/credit boundaries, atomic operations and sponsor delivery; synthetic storage only."""
import base64
from concurrent.futures import ThreadPoolExecutor
from html import unescape
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import sys
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit
from PIL import Image


class CreditsAndSponsorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parents[1]
        cls.storage = tempfile.TemporaryDirectory()
        sys.path.insert(0, str(cls.root/'风景调色协作平台/backend'))
        with patch('dotenv.dotenv_values', return_value={}), patch.dict(os.environ, {
            'LANDSCAPE_DB': str(Path(cls.storage.name)/'bootstrap.sqlite'),
            'LANDSCAPE_UPLOAD_DIR': str(Path(cls.storage.name)/'uploads'),
            'AI_MODE': 'demo', 'DASHSCOPE_API_KEY': '', 'SMTP_PASS': ''}):
            spec = importlib.util.spec_from_file_location('credits_test_app', cls.root/'风景调色协作平台/backend/app.py')
            cls.backend = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cls.backend)
        from community_modules import credits, db
        cls.credits, cls.db = credits, db
        cls.backend.app.config.update(TESTING=True, ENFORCE_CREDITS_IN_TESTS=True)
        image = io.BytesIO()
        Image.new('RGB', (16, 12), (30, 80, 120)).save(image, format='JPEG')
        cls.body = dict(intent='合成调色请求', image_base64=base64.b64encode(image.getvalue()).decode(), current_state={'adjustments': {}, 'mask_count': 0}, history=[])

    @classmethod
    def tearDownClass(cls):
        cls.storage.cleanup()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.app = self.backend.app
        self.app.config['COMMUNITY_DB_PATH'] = str(Path(self.tmp.name)/'test.sqlite')
        with self.app.app_context():
            self.db.init_db()
        self.client = self.app.test_client()
        self.codes, self.messages = {}, []
        self.sent = True
        self.cfg = dict(configured=True, host='smtp.163.com', port=465, user='sender@163.com', password='synthetic-only', admin_email='admin@example.test', public_origin='http://localhost')
        self.config_patch = patch.object(self.credits, '_smtp_config', side_effect=lambda: self.cfg)
        self.mail_patch = patch.object(self.credits, 'send_email_163', side_effect=self.mail)
        self.config_patch.start(); self.mail_patch.start()
        self.addCleanup(self.config_patch.stop); self.addCleanup(self.mail_patch.stop)
        self.backend.ai_service = Mock(public_origin='')
        self.backend.ai_service.status.return_value = dict(mode='live', requires_key=False)
        self.backend.ai_service.recommend.return_value = dict(demo=False, message='synthetic', proposals=[])

    def mail(self, to, subject, html):
        self.messages.append((to, subject, html))
        match = re.search(r'<strong>([0-9]{6})</strong>', html)
        if match:
            self.codes[to] = match[1]
        return dict(sent=self.sent, mode='smtp' if self.sent else 'error')

    def sql(self, query, args=(), fetch=False):
        with self.app.app_context():
            conn = self.db.get_db()
            try:
                cur = conn.execute(query, args)
                data = cur.fetchall() if fetch else None
                conn.commit()
                return data
            finally:
                conn.close()

    def register(self, name='synthetic'):
        from auth_test_support import seed_user
        account = seed_user(self.app, name)
        return account['user'], {'Authorization': 'Bearer '+account['token']}

    def send(self, email, headers=None):
        from community_modules import security
        with patch.object(security, 'consume_captcha', return_value=True):
            return self.client.post('/api/auth/email/send-code', json=dict(email=email, purpose='bind' if headers else 'login'), headers=headers or {})

    def verify(self, email, headers=None, code=None):
        return self.client.post('/api/auth/email/verify', json=dict(email=email, code=code or self.codes[email]), headers=headers or {})

    def clear_limits(self):
        self.sql('DELETE FROM credit_rate_limits')

    def sponsor(self, note='synthetic'):
        response = self.client.post('/api/credits/sponsor-notify', json=dict(email='sponsor@example.test', amount_note=note))
        link = unescape(re.search(r'href="([^"]+)"', self.messages[-1][2])[1])
        return response, parse_qs(urlsplit(link).query)['token'][0]

    def approve(self, token, value='50'):
        response = self.client.get('/api/credits/sponsor-approve', query_string=dict(token=token))
        nonce = re.search(r'name="confirmation" value="([^"]+)"', response.text)[1]
        return self.client.post('/api/credits/sponsor-approve', data=dict(token=token, confirmation=nonce, credits=value), follow_redirects=True)

    def test_missing_smtp_fails_closed_without_issuing_login_code(self):
        self.cfg['configured'] = False
        response = self.send('owner@example.test')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('preview_code', response.json)
        self.assertEqual(self.sql('SELECT count(*) n FROM email_verifications', fetch=True)[0]['n'], 0)
        self.assertEqual(self.verify('owner@example.test', code='123456').status_code, 400)

    def test_real_server_limits_and_failed_delivery_code_cannot_authenticate(self):
        self.sent = False
        self.assertEqual(self.send('test@example.test').status_code, 502)
        self.assertEqual(self.verify('test@example.test').status_code, 400)
        self.assertEqual(self.send('test@example.test').status_code, 429)
        self.assertEqual(self.send('test@example.test').status_code, 429)
        self.assertEqual(len(self.messages), 1)
        self.assertNotIn(self.codes['test@example.test'], self.client.get('/api/credits/status').text)

    def test_attempt_limit_latest_code_and_single_consumption(self):
        self.assertEqual(self.send('test@example.test').status_code, 200)
        original = self.codes['test@example.test']
        self.clear_limits()
        self.assertEqual(self.send('test@example.test').status_code, 200)
        row = self.sql('SELECT code FROM email_verifications ORDER BY id DESC LIMIT 1', fetch=True)[0]
        self.assertNotEqual(row['code'], self.codes['test@example.test'])
        for _ in range(5):
            self.assertEqual(self.verify('test@example.test', code='000000').status_code, 400)
        self.assertEqual(self.verify('test@example.test').status_code, 400)
        self.clear_limits(); self.send('test@example.test')
        self.assertEqual(self.verify('test@example.test').status_code, 200)
        self.assertEqual(self.verify('test@example.test').status_code, 400)

    def test_email_identity_unique_bound_to_requester_and_private(self):
        first, h1 = self.register('first'); second, h2 = self.register('second')
        self.send('User@Example.test', h1)
        self.assertEqual(self.verify('user@example.test', h2).status_code, 400)
        self.assertEqual(self.verify('user@example.test').status_code, 400)
        response = self.verify('user@example.test', h1)
        self.assertEqual(response.json['credits'], 15)
        self.clear_limits(); self.send('user@example.test', h2)
        self.assertEqual(self.verify('user@example.test', h2).status_code, 409)
        self.assertEqual(self.sql("SELECT count(*) n FROM users WHERE email='user@example.test'", fetch=True)[0]['n'], 1)
        public = self.client.get('/api/users/'+str(first['id'])).json['user']
        for key in ('email', 'email_verified', 'credits', 'checked_in_today'):
            self.assertNotIn(key, public)
        self.clear_limits(); self.send('user@example.test')
        logged = self.verify('user@example.test')
        self.assertEqual(logged.json['user']['id'], first['id'])
        self.assertEqual(logged.json['credits'], 15)

    def test_email_new_account_and_expiry(self):
        self.send('new@example.test')
        response = self.verify('new@example.test')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json['token'])
        self.assertEqual(response.json['credits'], 15)
        self.clear_limits(); self.send('new@example.test')
        self.sql("UPDATE email_verifications SET expires_at='2000-01-01 00:00:00'")
        self.assertEqual(self.verify('new@example.test').status_code, 400)

    def test_concurrent_checkin_and_redeem_are_atomic(self):
        first, h1 = self.register('first'); second, h2 = self.register('second')
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda _: self.app.test_client().post('/api/credits/checkin', headers=h1).status_code, range(2)))
        self.assertEqual(sorted(results), [200, 400])
        with self.app.app_context():
            conn = self.db.get_db()
            item = self.credits.generate_redemption_code(conn, 50)
            conn.close()
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda h: self.app.test_client().post('/api/credits/redeem', json=dict(code=item['code']), headers=h).status_code, [h1, h2]))
        self.assertEqual(sorted(results), [200, 400])
        self.assertEqual(self.sql('SELECT used_count FROM redemption_codes', fetch=True)[0]['used_count'], 1)
        self.assertEqual(self.sql('SELECT sum(credits) n FROM users', fetch=True)[0]['n'], 73)
        self.sql("UPDATE redemption_codes SET used_count=0,expires_at='2000-01-01 00:00:00'")
        self.assertEqual(self.client.post('/api/credits/redeem', json=dict(code=item['code']), headers=h2).status_code, 400)

    def test_ai_reservation_blocks_parallel_call_and_failure_refunds(self):
        user, headers = self.register()
        self.sql('UPDATE users SET credits=1 WHERE id=?', (user['id'],))
        entered, release = threading.Event(), threading.Event()
        def upstream(body):
            entered.set(); self.assertTrue(release.wait(5))
            return dict(demo=False, proposals=[], message='synthetic')
        self.backend.ai_service.recommend.side_effect = upstream
        with ThreadPoolExecutor(1) as pool:
            future = pool.submit(lambda: self.app.test_client().post('/api/ai/recommend', json=self.body, headers=headers))
            self.assertTrue(entered.wait(5))
            blocked = self.client.post('/api/ai/recommend', json=self.body, headers=headers)
            self.assertEqual(blocked.status_code, 402)
            # A concurrent check-in must not be overwritten when the first AI request finishes.
            self.assertEqual(self.client.post('/api/credits/checkin', headers=headers).json['credits'], 3)
            release.set(); self.assertEqual(future.result().status_code, 200)
        self.assertEqual(self.sql('SELECT credits FROM users', fetch=True)[0]['credits'], 3)
        from ai_service import AIError
        self.backend.ai_service.recommend.side_effect = AIError('synthetic failure', 502)
        self.assertEqual(self.client.post('/api/ai/recommend', json=self.body, headers=headers).status_code, 502)
        self.assertEqual(self.sql('SELECT credits FROM users', fetch=True)[0]['credits'], 3)
        self.backend.ai_service.recommend.side_effect = RuntimeError('synthetic')
        with self.assertRaises(RuntimeError):
            self.client.post('/api/ai/recommend', json=self.body, headers=headers)
        self.assertEqual(self.sql('SELECT credits FROM users', fetch=True)[0]['credits'], 3)
        self.assertEqual(self.client.post('/api/ai/recommend', json=self.body).status_code, 401)

    def test_abandoned_ai_reservation_refunded_once_and_demo_is_free(self):
        user, headers = self.register()
        with self.app.app_context():
            reservation = self.credits._reserve_ai_credit(user['id'])
        self.sql('UPDATE ai_credit_reservations SET created_at=0 WHERE id=?', (reservation,))
        self.assertEqual(self.client.get('/api/credits/status', headers=headers).json['credits'], 10)
        with self.app.app_context():
            newer = self.credits._reserve_ai_credit(user['id'])
            self.assertEqual(self.credits._finish_ai_credit(newer, False), 10)
            self.assertEqual(self.credits._finish_ai_credit(newer, False), 10)
        self.backend.ai_service.status.return_value = dict(mode='demo', requires_key=False)
        self.backend.ai_service.recommend.return_value = dict(demo=True)
        response = self.client.post('/api/ai/recommend', json=self.body, headers=headers)
        self.assertEqual(response.json['credits'], 10)

    def test_sponsor_prefix_get_is_safe_and_approval_requires_confirmation(self):
        response = self.client.post('/api/credits/sponsor-notify', json=dict(email='sponsor@example.test'), environ_overrides={'SCRIPT_NAME': '/landscape'})
        self.assertEqual(response.status_code, 200)
        html = self.messages[-1][2]
        self.assertIn('http://localhost/landscape/api/credits/sponsor-approve?', html)
        token = parse_qs(urlsplit(unescape(re.search(r'href="([^"]+)"', html)[1])).query)['token'][0]
        self.assertNotEqual(self.sql('SELECT approve_token FROM sponsor_requests', fetch=True)[0]['approve_token'], token)
        for _ in range(2):
            page = self.client.get('/api/credits/sponsor-approve', query_string=dict(token=token))
            self.assertEqual(page.status_code, 200)
            self.assertIn("default-src 'none'", page.headers['Content-Security-Policy'])
        self.assertEqual(self.sql('SELECT count(*) n FROM redemption_codes', fetch=True)[0]['n'], 0)
        self.assertEqual(self.client.post('/api/credits/sponsor-approve', data=dict(token=token, credits='50')).status_code, 403)
        self.assertEqual(self.approve(token, '1000').status_code, 400)
        self.assertEqual(self.approve(token).status_code, 200)
        self.assertEqual(self.sql('SELECT count(*) n FROM redemption_codes', fetch=True)[0]['n'], 1)
        self.assertIn('已发放', self.client.get('/api/credits/sponsor-approve', query_string=dict(token=token)).text)

    def test_delivery_retry_keeps_one_code_and_expired_approval_rejected(self):
        response, token = self.sponsor()
        self.sent = False
        self.assertEqual(self.approve(token).status_code, 502)
        original = self.sql('SELECT code FROM redemption_codes', fetch=True)[0]['code']
        self.sent = True
        self.assertEqual(self.approve(token).status_code, 200)
        self.assertEqual(self.sql('SELECT count(*) n FROM redemption_codes', fetch=True)[0]['n'], 1)
        self.assertIn(original, self.messages[-1][2])
        self.sql("UPDATE sponsor_requests SET expires_at='2000-01-01 00:00:00'")
        self.assertEqual(self.client.get('/api/credits/sponsor-approve', query_string=dict(token=token)).status_code, 410)

    def test_notification_failure_is_honest_retry_reuses_request_html_escaped(self):
        self.sent = False
        response, token = self.sponsor('<b>synthetic</b>')
        self.assertEqual(response.status_code, 502)
        self.assertFalse(response.json['smtp_sent'])
        self.assertNotIn('<b>synthetic</b>', self.messages[-1][2])
        self.assertIn('&lt;b&gt;synthetic&lt;/b&gt;', self.messages[-1][2])
        page = self.client.get('/api/credits/sponsor-approve', query_string=dict(token=token))
        self.assertNotIn('<b>synthetic</b>', page.text)
        self.sent = True; self.clear_limits()
        retried, new_token = self.sponsor('<b>synthetic</b>')
        self.assertEqual(retried.json['request_id'], response.json['request_id'])
        self.clear_limits()
        again, _ = self.sponsor('<b>synthetic</b>')
        self.assertEqual(again.json['request_id'], response.json['request_id'])
        self.assertEqual(len(self.messages), 2)
        self.assertEqual(self.client.get('/api/credits/sponsor-approve', query_string=dict(token=token)).status_code, 410)
        self.assertEqual(self.client.post('/api/credits/sponsor-notify', json=dict(email='<img/src=x/onerror=alert(1)>@example.test')).status_code, 400)

    def test_cli_targets_explicit_database_and_refuses_invalid_terms(self):
        wrong = str(Path(self.tmp.name)/'must-not-create.sqlite')
        env = {**os.environ, 'LANDSCAPE_DB': wrong, 'PYTHONUTF8': '1'}
        args = [sys.executable, str(self.root/'scripts/generate_codes.py'), '--database', self.app.config['COMMUNITY_DB_PATH'], '--credits', '20']
        process = subprocess.run(args, cwd=self.root, env=env, capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(self.sql('SELECT count(*) n FROM redemption_codes', fetch=True)[0]['n'], 1)
        self.assertFalse(Path(wrong).exists())
        bad = subprocess.run(args+['--hours', '25'], cwd=self.root, env=env, capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(bad.returncode, 2)
        self.assertEqual(self.sql('SELECT count(*) n FROM redemption_codes', fetch=True)[0]['n'], 1)

    def test_migration_is_idempotent_and_preserves_existing_accounts(self):
        user, headers = self.register()
        self.sql('UPDATE users SET credits=17,bio=? WHERE id=?', ('synthetic-preserved', user['id']))
        with self.app.app_context():
            self.db.init_db(); self.db.init_db()
        row = self.sql('SELECT credits,bio FROM users WHERE id=?', (user['id'],), True)[0]
        self.assertEqual((row['credits'], row['bio']), (17, 'synthetic-preserved'))
        self.assertEqual(self.client.get('/api/auth/me', headers=headers).status_code, 200)

    def test_concurrent_approval_issues_and_delivers_only_once(self):
        response, token = self.sponsor()
        page = self.client.get('/api/credits/sponsor-approve', query_string=dict(token=token))
        nonce = re.search(r'name="confirmation" value="([^"]+)"', page.text)[1]
        entered, release = threading.Event(), threading.Event()
        self.credits.send_email_163.side_effect = lambda *args: (entered.set(), release.wait(5), dict(sent=True))[-1]
        def send():
            client = self.app.test_client()
            client.set_cookie('landscape_sponsor_confirmation', nonce)
            return client.post('/api/credits/sponsor-approve', data=dict(token=token, confirmation=nonce, credits='50'), follow_redirects=True)
        with ThreadPoolExecutor(1) as pool:
            future = pool.submit(send); self.assertTrue(entered.wait(5))
            self.assertEqual(send().status_code, 409)
            release.set(); self.assertEqual(future.result().status_code, 200)
        self.assertEqual(self.sql('SELECT count(*) n FROM redemption_codes', fetch=True)[0]['n'], 1)
        self.assertEqual(self.credits.send_email_163.call_count, 2)  # initial notice + one code


if __name__ == '__main__':
    unittest.main()
