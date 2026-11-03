"""Verified-library import: real temporary SQLite/files, no user storage or network."""
from contextlib import closing
import copy
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from flask import Flask
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('community_import', ROOT/'scripts/seed_community_recipes.py')
seed = importlib.util.module_from_spec(spec);spec.loader.exec_module(seed)


class CommunityImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name);self.uploads = self.root/'uploads';self.uploads.mkdir()
        self.bundle = self.root/'bundle';self.bundle.mkdir()
        for d in ('before', 'after'):(self.bundle/d).mkdir()
        self.db = self.root/'community.db'
        self.app = Flask(__name__);self.app.config['COMMUNITY_DB_PATH'] = str(self.db)
        from community_modules.db import init_db
        with self.app.app_context():init_db()
        self.items = []
        for index, color in [(1, '#315a77'), (2, '#d7b182')]:
            name = f'landscape_{index:03d}'
            Image.new('RGB', (32, 24), color).save(self.bundle/'before'/f'{name}.jpg')
            Image.new('RGB', (32, 24), '#578782').save(self.bundle/'after'/f'{name}.webp', lossless=True)
            self.items.append(dict(id=name, name='合成风光 '+str(index), category='测试', tags=['合成'],
                author='Synthetic photographer', source_url='https://example.test/photo/'+str(index),
                license='CC BY-SA 4.0', license_url='https://creativecommons.org/licenses/by-sa/4.0/',
                description='Synthetic curated demonstration', before_note='调色前基底经过整理。',
                parameter_summary='曝光 +0.2 EV', width=32, height=24,
                cover_before=f'before/{name}.jpg', cover_after=f'after/{name}.webp',
                source_sha256=str(index)*64,
                before_sha256=seed.digest_file(self.bundle/'before'/f'{name}.jpg'),
                after_sha256=seed.digest_file(self.bundle/'after'/f'{name}.webp'),
                features={}, version=7, rendering={'legacyTone': {'highlights': False, 'shadows': False}},
                steps=[{'type':'exposure','params':{'value':.2}}]))
        self.write_manifest()
        with closing(seed.connection(self.db)) as conn:
            conn.execute("INSERT INTO users(id,username,password_hash,display_name) VALUES(1,'demo','synthetic-only','demo')")
            conn.execute("INSERT INTO users(id,username,password_hash,display_name) VALUES(2,'other','synthetic-only','other')")
            for index in (1,2):
                conn.execute("INSERT INTO recipes(id,name,author_id,author,cover_before,steps,created_at,likes) VALUES(?, ?, 1, 'demo', ?, '[]', '2020-01-01', 7)",
                             (100+index, 'Original '+str(index), '/landscape/uploads/import-'+str(index)*64+'.jpg'))
            conn.execute("INSERT INTO recipes(id,name,author_id,author,cover_before) VALUES(103,'Foreign',2,'other',?)",('/uploads/import-'+'1'*64+'.jpg',))
            conn.execute('INSERT INTO favorites(user_id,recipe_id) VALUES(2,101)');conn.commit()

    def write_manifest(self):
        (self.bundle/'manifest.json').write_text(json.dumps(dict(dataset='landscape-curated-v1',format_version=1,
            verified='browser-full-render-lossless-webp',items=self.items)),encoding='utf8')

    def assets(self):return seed.read_bundle(self.bundle)[1]

    def test_dry_run_updates_in_place_preserves_ownership_favorites_and_dates_then_is_idempotent(self):
        before = seed.digest_file(self.db)
        plan = seed.import_bundle(self.db,self.uploads,self.assets())
        self.assertEqual(plan['update'],2);self.assertFalse(plan['applied'])
        self.assertEqual(seed.digest_file(self.db),before);self.assertEqual(list(self.uploads.iterdir()),[])
        result = seed.import_bundle(self.db,self.uploads,self.assets(),apply=True)
        self.assertEqual(result['update'],2);self.assertTrue(Path(result['backup']).is_file())
        with closing(seed.connection(self.db)) as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM recipes').fetchone()[0],3)
            self.assertEqual(conn.execute('SELECT count(*) FROM users').fetchone()[0],2)
            row = conn.execute('SELECT * FROM recipes WHERE id=101').fetchone()
            self.assertEqual((row['author_id'],row['author'],row['likes'],row['created_at']),(1,'demo',7,'2020-01-01'))
            self.assertEqual(conn.execute('SELECT recipe_id FROM favorites').fetchone()[0],101)
            self.assertEqual(conn.execute('SELECT name FROM recipes WHERE id=103').fetchone()[0],'Foreign')
            from community_modules.repository import serialize_recipe
            data = serialize_recipe(conn,row)
            self.assertEqual(data['source']['photographer'],'Synthetic photographer')
            self.assertEqual(data['parameter_summary'],'曝光 +0.2 EV')
            self.assertEqual(data['steps'],self.items[0]['steps']);self.assertEqual(data['pairing'],'editor')
            self.assertNotIn('source',serialize_recipe(conn,row,with_steps=False))
        again = seed.import_bundle(self.db,self.uploads,self.assets(),apply=True)
        self.assertEqual(again['unchanged'],2);self.assertFalse(again['applied'])
        self.assertEqual(len(list((self.root/'backups').glob('*.db'))),1)

    def test_invalid_hash_duplicate_id_path_recipe_and_links_are_rejected_before_writes(self):
        original = copy.deepcopy(self.items)
        for mutate in [lambda a:a[0].update(after_sha256='0'*64),lambda a:a[0].update(cover_before='../outside.jpg'),
                       lambda a:a.append(copy.deepcopy(a[0])),lambda a:a[0].update(version=99),
                       lambda a:a[0].update(source_url='javascript:alert(1)')]:
            self.items=copy.deepcopy(original);mutate(self.items);self.write_manifest()
            with self.assertRaises(ValueError):self.assets()
        self.assertFalse((self.root/'backups').exists());self.assertEqual(list(self.uploads.iterdir()),[])

    def test_missing_owner_or_source_does_not_create_accounts_or_duplicate_works(self):
        with self.assertRaises(ValueError):seed.import_bundle(self.db,self.uploads,self.assets(),owner='missing',apply=True)
        self.items[0]['source_sha256']='9'*64;self.write_manifest()
        with self.assertRaises(ValueError):seed.import_bundle(self.db,self.uploads,self.assets(),apply=True)
        with closing(seed.connection(self.db)) as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM users').fetchone()[0],2)
            self.assertEqual(conn.execute('SELECT count(*) FROM recipes').fetchone()[0],3)

    def test_deleted_work_is_not_resurrected(self):
        with closing(seed.connection(self.db)) as conn:
            conn.execute("UPDATE recipes SET deleted_at='2026-01-01' WHERE id=101");conn.commit()
        result=seed.import_bundle(self.db,self.uploads,self.assets(),apply=True)
        self.assertEqual((result['deleted-skip'],result['update']),(1,1))
        with closing(seed.connection(self.db)) as conn:
            self.assertEqual(conn.execute('SELECT name,deleted_at FROM recipes WHERE id=101').fetchone()[:],('Original 1','2026-01-01'))

    def test_transaction_failure_rolls_back_records_and_removes_only_new_files(self):
        keep=self.uploads/'existing-user-photo.jpg';keep.write_bytes(b'unchanged')
        with patch.object(seed,'write_source',side_effect=RuntimeError('synthetic interruption')):
            with self.assertRaises(RuntimeError):seed.import_bundle(self.db,self.uploads,self.assets(),apply=True)
        with closing(seed.connection(self.db)) as conn:
            self.assertEqual(conn.execute('SELECT name FROM recipes WHERE id=101').fetchone()[0],'Original 1')
            self.assertEqual(conn.execute('SELECT count(*) FROM recipe_sources').fetchone()[0],0)
        self.assertEqual(list(self.uploads.iterdir()),[keep]);self.assertEqual(keep.read_bytes(),b'unchanged')


if __name__=='__main__':unittest.main()
