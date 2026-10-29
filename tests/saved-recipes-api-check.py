"""Disposable database tests for account-private recipe snapshots."""
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('profile_checks', Path(__file__).with_name('profile-api-check.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SavedRecipes(module.Profiles):
    recipe = {'version': 8, 'rendering': {'legacyTone': {'highlights': False, 'shadows': False}},
              'steps': [{'type': 'exposure', 'params': {'value': .7}},
                        {'type': 'upright', 'params': {'matrix': [1, 0, 0, 0, 1, 0, 0, 0, 1], 'autoCrop': True}}]}

    def save(self, **values):
        return self.client.post('/api/me/saved-recipes', headers=self.headers,
                                json={'name': '合成私有配方', 'recipe': self.recipe, **values})

    def test_private_create_update_delete(self):
        self.assertEqual(self.client.get('/api/me/saved-recipes').status_code, 401)
        response = self.save(note='仅在测试数据库中')
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        saved = response.json['saved_recipe']
        self.assertEqual(saved['recipe'], self.recipe)
        other = {'Authorization': 'Bearer '+self.users[1]['token']}
        path = '/api/me/saved-recipes/'+str(saved['id'])
        self.assertEqual(self.client.get('/api/me/saved-recipes', headers=other).json['total'], 0)
        for method in (self.client.patch, self.client.delete):
            self.assertEqual(method(path, headers=other, json={'note': '不允许'}).status_code, 404)
        updated = self.client.patch(path, headers=self.headers, json={'name': '我的名字', 'note': '<script>literal</script>'})
        self.assertEqual(updated.json['saved_recipe']['note'], '<script>literal</script>')
        self.assertEqual(self.client.get('/api/recipes').json['total'], 0)
        self.assertEqual(self.client.delete(path, headers=self.headers).status_code, 200)

    def test_source_snapshot_is_idempotent_and_survives_deletion(self):
        # Use a synthetic source record without uploading any real photograph.
        with self.backend.app.app_context():
            conn = self.backend.get_db()
            cursor = conn.execute('INSERT INTO recipes (name, author, author_id, description, tags, version, rendering, steps) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                                  ('测试来源', '测试作者', self.users[1]['user']['id'], '原作者说明', '["暖调"]', 8,
                                   json.dumps(self.recipe['rendering']), json.dumps(self.recipe['steps'])))
            source = cursor.lastrowid
            conn.commit(); conn.close()
        first = self.save(source_recipe_id=source).json['saved_recipe']
        path = '/api/me/saved-recipes/'+str(first['id'])
        self.client.patch(path, headers=self.headers, json={'note': '自定义备注'})
        repeated = self.save(source_recipe_id=source)
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(repeated.json['saved_recipe']['note'], '自定义备注')
        self.assertEqual(first['description'], '原作者说明')
        self.assertEqual(first['tags'], ['暖调'])
        with self.backend.app.app_context():
            conn = self.backend.get_db(); conn.execute("UPDATE recipes SET deleted_at = datetime('now') WHERE id = ?", (source,)); conn.commit(); conn.close()
        self.assertEqual(self.client.get('/api/me/saved-recipes', headers=self.headers).json['recipes'][0]['recipe'], self.recipe)
        self.assertEqual(self.save(source_recipe_id=source).status_code, 404)

    def test_invalid_content_limits_and_migration(self):
        for payload in ({'version': 99}, {'version': 8, 'steps': []}, {'version': 8, 'steps': [{'type': 'exposure', 'params': {'value': 'invalid'}}]}):
            self.assertEqual(self.save(recipe=payload).status_code, 400)
        self.assertEqual(self.save(note='x'*501).status_code, 400)
        self.assertEqual(self.save(source_recipe_id=True).status_code, 400)
        self.assertEqual(self.save(name='').status_code, 400)
        self.save()
        with self.backend.app.app_context():
            self.backend.community_db.init_db(); self.backend.community_db.init_db()
        self.assertEqual(self.client.get('/api/me/saved-recipes', headers=self.headers).json['total'], 1)

    def test_pagination_and_literal_search(self):
        for index in range(13): self.assertEqual(self.save(name='合成配方 '+str(index)).status_code, 201)
        a=self.client.get('/api/me/saved-recipes', headers=self.headers).json
        b=self.client.get('/api/me/saved-recipes?page=2', headers=self.headers).json
        self.assertEqual((len(a['recipes']),len(b['recipes']),a['total']), (12,1,13))
        self.assertFalse({r['id'] for r in a['recipes']} & {r['id'] for r in b['recipes']})
        self.assertEqual(self.client.get('/api/me/saved-recipes?search=%25', headers=self.headers).json['total'],0)


if __name__ == '__main__': unittest.main()
