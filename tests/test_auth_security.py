"""Real auth endpoints with temporary databases and synthetic mail only."""
import hashlib
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import test_credits_and_sponsor as support


class AuthSecurity(unittest.TestCase):
    setUpClass = classmethod(support.CreditsAndSponsorTests.setUpClass.__func__)
    tearDownClass = classmethod(support.CreditsAndSponsorTests.tearDownClass.__func__)
    setUp = support.CreditsAndSponsorTests.setUp
    sql = support.CreditsAndSponsorTests.sql
    mail = support.CreditsAndSponsorTests.mail

    def challenge(self, purpose='email', client=None, address='127.0.0.1'):
        from community_modules import security
        with patch.object(security.secrets, 'choice', return_value='A'):
            result = (client or self.client).get('/api/auth/captcha?purpose='+purpose, environ_overrides={'REMOTE_ADDR':address})
        self.assertEqual(result.status_code, 200)
        self.assertNotIn('answer', result.json)
        self.assertTrue(result.json['image'].startswith('data:image/png;base64,'))
        return dict(captcha_id=result.json['captcha_id'],captcha_answer='AAAAA')

    def registration(self, name='synthetic-new', email='new@example.test'):
        challenge = self.challenge()
        sent = self.client.post('/api/auth/email/send-code',json=dict(email=email,purpose='register',**challenge))
        self.assertEqual(sent.status_code,200)
        return dict(username=name,password='synthetic-only',email=email,code=self.codes[email])

    def test_registration_requires_proof_and_cannot_reuse_or_cross_purpose(self):
        self.assertEqual(self.client.post('/api/auth/register',json=dict(username='bot',password='synthetic-only')).status_code,400)
        self.assertEqual(self.client.post('/api/auth/email/send-code',json=dict(email='new@example.test',purpose='register')).json['code'],'captcha_required')
        body=self.registration()
        wrong=self.client.post('/api/auth/email/verify',json=dict(email=body['email'],code=body['code']))
        self.assertEqual(wrong.status_code,400)
        registered=self.client.post('/api/auth/register',json=body)
        self.assertEqual(registered.status_code,200)
        self.assertTrue(registered.json['user']['email_verified'])
        self.assertEqual(registered.json['user']['credits'],15)
        self.assertEqual(self.client.post('/api/auth/register',json={**body,'username':'other'}).status_code,400)
        self.assertEqual(self.client.post('/api/auth/login',json=dict(username=body['username'],password=body['password'])).status_code,200)

    def test_captcha_is_single_use_ip_purpose_and_expiry_bound(self):
        from community_modules import security
        for mismatch in ('purpose','ip','expiry','answer'):
            c=self.challenge()
            if mismatch=='expiry':self.sql('UPDATE auth_captchas SET expires_at=0')
            if mismatch=='answer':c['captcha_answer']='BBBBB'
            with self.app.test_request_context('/api/auth/login',environ_base={'REMOTE_ADDR':'10.0.0.2' if mismatch=='ip' else '127.0.0.1'}):
                self.assertFalse(security.consume_captcha(c,'login' if mismatch=='purpose' else 'email'))
                self.assertFalse(security.consume_captcha({**c,'captcha_answer':'AAAAA'},'email'))

    def test_failed_logins_require_captcha_and_pair_cooldown_is_bounded(self):
        from auth_test_support import seed_user
        seed_user(self.app,'old-user')
        for _ in range(5):self.assertEqual(self.client.post('/api/auth/login',json=dict(username='old-user',password='wrong')).status_code,400)
        blocked=self.client.post('/api/auth/login',json=dict(username='old-user',password='synthetic-only'))
        self.assertEqual(blocked.json['code'],'captcha_required')
        c=self.challenge('login')
        self.assertEqual(self.client.post('/api/auth/login',json=dict(username='old-user',password='synthetic-only',**c)).status_code,200)
        for _ in range(10):
            c=self.challenge('login')
            self.client.post('/api/auth/login',json=dict(username='old-user',password='wrong',**c))
        r=self.client.post('/api/auth/login',json=dict(username='old-user',password='synthetic-only'))
        self.assertEqual(r.status_code,429);self.assertLessEqual(int(r.headers['Retry-After']),60)
        # Another client can still prove ownership; attacker cannot hard-lock the account.
        c=self.challenge('login',address='10.0.0.8')
        self.assertEqual(self.client.post('/api/auth/login',json=dict(username='old-user',password='synthetic-only',**c),environ_overrides={'REMOTE_ADDR':'10.0.0.8'}).status_code,200)

    def test_registration_limit_counts_failures_and_ignores_spoofed_xff(self):
        for n in range(10):
            self.assertEqual(self.client.post('/api/auth/register',json={},headers={'X-Forwarded-For':str(n)}).status_code,400)
        r=self.client.post('/api/auth/register',json={})
        self.assertEqual(r.status_code,429);self.assertIn('Retry-After',r.headers)

    def test_atomic_throttle_and_no_counter_rollback(self):
        from community_modules.security import limits, Throttled
        def hit(_):
            with self.app.app_context():
                try:limits(('concurrent','same',3,60));return 200
                except Throttled:return 429
        with ThreadPoolExecutor(8) as pool:results=list(pool.map(hit,range(12)))
        self.assertEqual(results.count(200),3);self.assertEqual(results.count(429),9)

    def test_concurrent_registration_consumes_one_proof(self):
        body=self.registration()
        def register(n):return self.app.test_client().post('/api/auth/register',json={**body,'username':'new-'+str(n)}).status_code
        with ThreadPoolExecutor(2) as pool:results=list(pool.map(register,range(2)))
        self.assertEqual(sorted(results),[200,400])
        self.assertEqual(self.sql('SELECT count(*) n FROM users',fetch=True)[0]['n'],1)

    def test_email_only_signup_cannot_bypass_account_creation_budget(self):
        body=self.registration()
        self.sql('INSERT OR REPLACE INTO credit_rate_limits VALUES(?,?,?,?)',
            ('account-created-hour',hashlib.sha256(b'127.0.0.1').hexdigest(),int(time.time()),10))
        self.assertEqual(self.client.post('/api/auth/register',json=body).status_code,429)
        email='other@example.test'
        self.assertEqual(self.client.post('/api/auth/email/send-code',json=dict(email=email,purpose='login',**self.challenge())).status_code,200)
        self.assertEqual(self.client.post('/api/auth/email/verify',json=dict(email=email,code=self.codes[email])).status_code,429)
        self.assertEqual(self.sql('SELECT count(*) n FROM users',fetch=True)[0]['n'],0)

    def test_password_upgrade_preserves_old_sessions_and_profile_change(self):
        from community_modules.auth import create_token,verify_password
        legacy=hashlib.sha256(b'legacy-pass').hexdigest()
        self.sql('INSERT INTO users(username,password_hash,display_name) VALUES(?,?,?)',('legacy-user',legacy,'Legacy'))
        with self.app.app_context():token=create_token(1)
        headers={'Authorization':'Bearer '+token}
        self.assertEqual(self.client.post('/api/auth/login',json=dict(username='legacy-user',password='wrong')).status_code,400)
        self.assertEqual(self.sql('SELECT password_hash FROM users',fetch=True)[0]['password_hash'],legacy)
        self.assertEqual(self.client.post('/api/auth/login',json=dict(username='legacy-user',password='legacy-pass')).status_code,200)
        stored=self.sql('SELECT password_hash FROM users',fetch=True)[0]['password_hash']
        self.assertTrue(stored.startswith('pbkdf2:sha256:600000$'));self.assertTrue(verify_password(stored,'legacy-pass'))
        self.assertEqual(self.client.get('/api/auth/me',headers=headers).status_code,200)
        self.assertEqual(self.client.put('/api/users/me/password',headers=headers,json=dict(current_password='legacy-pass',new_password='new-password',confirm_password='new-password')).status_code,200)
        self.assertEqual(self.client.post('/api/auth/login',json=dict(username='legacy-user',password='new-password')).status_code,200)

    def test_logout_limit_and_oversized_auth_body(self):
        from auth_test_support import seed_user
        account=seed_user(self.app,'logout-user');headers={'Authorization':'Bearer '+account['token']}
        self.assertEqual(self.client.post('/api/auth/logout',headers=headers).status_code,200)
        for _ in range(29):self.assertEqual(self.client.post('/api/auth/logout',headers=headers).status_code,401)
        self.assertEqual(self.client.post('/api/auth/logout',headers=headers).status_code,429)
        self.assertEqual(self.client.post('/api/auth/login',json={'username':'x'*17000}).status_code,413)


if __name__=='__main__':unittest.main()
