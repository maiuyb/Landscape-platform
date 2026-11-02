"""Member account/privacy/search regressions with disposable synthetic storage."""
from concurrent.futures import ThreadPoolExecutor
import threading
import unittest
from unittest.mock import patch
import test_credits_and_sponsor as support
from auth_test_support import seed_user


class MemberAccounts(unittest.TestCase):
    setUpClass=classmethod(support.CreditsAndSponsorTests.setUpClass.__func__)
    tearDownClass=classmethod(support.CreditsAndSponsorTests.tearDownClass.__func__)
    setUp=support.CreditsAndSponsorTests.setUp
    sql=support.CreditsAndSponsorTests.sql
    mail=support.CreditsAndSponsorTests.mail

    def account(self,name='owner',email='owner@example.test'):
        result=seed_user(self.app,name)
        self.sql('UPDATE users SET email=?,email_verified=1,bio=?,location=? WHERE id=?',
                 (email,'Private biography','Private city',result['user']['id']))
        return result,{'Authorization':'Bearer '+result['token']}

    def proof(self,email='owner@example.test',purpose='reset'):
        from community_modules import security
        with patch.object(security.secrets,'choice',return_value='A'):
            challenge=self.client.get('/api/auth/captcha?purpose=email').json
        sent=self.client.post('/api/auth/email/send-code',json=dict(email=email,purpose=purpose,captcha_id=challenge['captcha_id'],captcha_answer='AAAAA'))
        self.assertEqual(sent.status_code,200)
        return self.codes[email]

    def reset(self,code,email='owner@example.test',password='new-synthetic-password',client=None):
        return (client or self.client).post('/api/auth/password/reset',json=dict(email=email,code=code,password=password))

    def test_reset_revokes_all_owner_sessions_but_not_other_users(self):
        owner,headers=self.account();other,other_headers=self.account('other','other@example.test')
        second=self.client.post('/api/auth/login',json=dict(username='owner',password='synthetic-only')).json['token']
        before=self.client.get('/api/users/me',headers=headers).json['user']
        code=self.proof();response=self.reset(code)
        self.assertEqual(response.status_code,200);self.assertEqual(set(response.json),{'ok','username','message'})
        for token in [owner['token'],second]:self.assertEqual(self.client.get('/api/auth/me',headers={'Authorization':'Bearer '+token}).status_code,401)
        self.assertEqual(self.client.get('/api/auth/me',headers=other_headers).status_code,200)
        self.assertEqual(self.client.post('/api/auth/login',json=dict(username='owner',password='synthetic-only')).status_code,400)
        login=self.client.post('/api/auth/login',json=dict(username='owner',password='new-synthetic-password'))
        self.assertEqual(login.status_code,200)
        for key in ['id','display_name','bio','location','credits','email','email_verified']:
            self.assertEqual(login.json['user'][key],before[key])
        self.assertEqual(self.reset(code).status_code,400)

    def test_reset_code_cannot_cross_purpose_expire_or_be_guessed(self):
        owner,headers=self.account()
        code=self.proof(purpose='login');self.assertEqual(self.reset(code).status_code,400)
        self.sql('DELETE FROM credit_rate_limits');code=self.proof()
        for _ in range(5):self.assertEqual(self.reset('000000').status_code,400)
        self.assertEqual(self.reset(code).status_code,400)
        self.sql('DELETE FROM credit_rate_limits');code=self.proof()
        self.sql("UPDATE email_verifications SET expires_at='2000-01-01 00:00:00'")
        self.assertEqual(self.reset(code).status_code,400)
        self.assertEqual(self.client.get('/api/auth/me',headers=headers).status_code,200)
        self.assertEqual(self.reset('123456',password='short').status_code,400)

    def test_unbound_reset_never_creates_an_account(self):
        code=self.proof('nobody@example.test')
        self.assertEqual(self.reset(code,'nobody@example.test').status_code,404)
        self.assertEqual(self.sql('SELECT count(*) n FROM users',fetch=True)[0]['n'],0)

    def test_concurrent_reset_has_one_winner(self):
        self.account();code=self.proof()
        def reset(n):return self.reset(code,password='synthetic-password-'+str(n),client=self.app.test_client()).status_code
        with ThreadPoolExecutor(2) as pool:results=list(pool.map(reset,range(2)))
        self.assertEqual(sorted(results),[200,400])

    def test_reset_rate_limit_is_429_with_retry_after(self):
        self.account()
        for _ in range(20):self.assertEqual(self.reset('123456').status_code,400)
        response=self.reset('123456');self.assertEqual(response.status_code,429);self.assertIn('Retry-After',response.headers)

    def test_privacy_is_account_owned_and_does_not_erase_private_profile(self):
        owner,headers=self.account();other,other_headers=self.account('other','other@example.test')
        response=self.client.put('/api/users/me',headers=headers,json=dict(show_bio=False,show_location=False,show_stats=False,id=other['user']['id']))
        self.assertEqual(response.status_code,200)
        private=self.client.get('/api/users/me',headers=headers).json['user']
        public=self.client.get('/api/users/'+str(owner['user']['id'])).json['user']
        self.assertEqual((private['bio'],private['location']),('Private biography','Private city'))
        self.assertEqual((public['bio'],public['location']),('',''));self.assertTrue(public['stats_hidden'])
        self.assertEqual((public['works_count'],public['favorites_received']),(0,0))
        self.assertTrue(self.client.get('/api/users/me',headers=other_headers).json['user']['show_bio'])
        self.assertEqual(self.client.put('/api/users/me',headers=headers,json={'show_bio':'false'}).status_code,400)
        self.assertEqual(self.client.put('/api/users/me',json={'show_bio':True}).status_code,401)
        self.assertEqual(self.client.put('/api/users/me',headers=headers,json=dict(show_bio=True,show_location=True,show_stats=True)).status_code,200)
        self.assertEqual(self.client.get('/api/users/'+str(owner['user']['id'])).json['user']['bio'],'Private biography')

    def test_parallel_privacy_and_profile_updates_do_not_overwrite_other_fields(self):
        from community_modules import repository as repo
        owner,headers=self.account();barrier=threading.Barrier(3);original=repo.get_user_by_token
        def snapshot(conn,token):
            user=original(conn,token);barrier.wait(timeout=8);return user
        payloads=[dict(show_bio=False),dict(show_location=False),dict(bio='Updated biography')]
        with patch.object(repo,'get_user_by_token',side_effect=snapshot),ThreadPoolExecutor(3) as pool:
            results=list(pool.map(lambda body:self.app.test_client().put('/api/users/me',headers=headers,json=body).status_code,payloads))
        self.assertEqual(results,[200,200,200])
        user=self.client.get('/api/users/me',headers=headers).json['user']
        self.assertFalse(user['show_bio']);self.assertFalse(user['show_location']);self.assertEqual(user['bio'],'Updated biography')

    def test_owned_search_categories_and_pagination_never_include_unrelated_work(self):
        owner,headers=self.account();other,other_headers=self.account('other','other@example.test')
        for n in range(18):
            self.sql('INSERT INTO recipes(name,author,author_id,category,tags) VALUES(?,?,?,?,?)',
                ('Shared work '+str(n),'owner',owner['user']['id'],'Lake' if n%2==0 else 'Forest','["Shared"]'))
        for n in range(3):
            self.sql('INSERT INTO recipes(name,author,author_id,category) VALUES(?,?,?,?)',('Shared foreign '+str(n),'other',other['user']['id'],'Foreign'))
        for recipe_id in (1,2,19):self.sql('INSERT INTO favorites(user_id,recipe_id) VALUES(?,?)',(owner['user']['id'],recipe_id))
        result=self.client.get('/api/me/recipes?search=Shared&category=Lake&page_size=3&page=2&author_id='+str(other['user']['id']),headers=headers).json
        self.assertEqual(result['total'],9);self.assertEqual(len(result['recipes']),3)
        self.assertTrue(all(r['author_id']==owner['user']['id'] for r in result['recipes']))
        mine=self.client.get('/api/me/categories?scope=mine',headers=headers).json['categories']
        favorites=self.client.get('/api/me/categories?scope=favorites',headers=headers).json['categories']
        self.assertEqual({c['name']:c['count'] for c in mine},{'Lake':9,'Forest':9})
        self.assertEqual({c['name']:c['count'] for c in favorites},{'Lake':1,'Forest':1,'Foreign':1})
        result=self.client.get('/api/me/favorites?search=foreign&category=Foreign',headers=headers).json
        self.assertEqual(result['total'],1);self.assertEqual(result['recipes'][0]['author_id'],other['user']['id'])
        for route in ['/api/me/recipes','/api/me/favorites','/api/me/categories']:
            self.assertEqual(self.client.get(route).status_code,401)
        self.assertEqual(self.client.get('/api/me/categories?scope=all',headers=headers).status_code,400)


if __name__=='__main__':unittest.main()
