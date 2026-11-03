"""Real temporary config files; no privileged changes or network."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('image_cache_installer', ROOT/'deploy/enable-image-cache.py')
installer = importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)


class ImageCacheDeploymentTests(unittest.TestCase):
    def test_only_general_proxy_header_changes_and_upgrade_is_idempotent(self):
        text = '''location ^~ /landscape/api/auth/ {
    limit_req zone=landscape_auth_ip;
    add_header Cache-Control "no-store" always;
}
location /landscape/ {
    proxy_pass http://127.0.0.1:5051/;
    add_header Cache-Control "no-store" always;
}
'''
        updated = installer.patch_proxy(text)
        self.assertEqual(updated.count('add_header Cache-Control "no-store"'), 1)
        self.assertIn('limit_req zone=landscape_auth_ip;', updated)
        self.assertEqual(updated, installer.patch_proxy(updated))
        with self.assertRaises(ValueError):installer.patch_proxy('server {}')
        redirect = 'location /landscape/ { return 308 https://example.test$request_uri; }\n'
        self.assertEqual(installer.patch_proxy(redirect),redirect)

    def test_validation_and_post_reload_failure_restore_every_file(self):
        for failure in ('syntax','health'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp);old = root/'existing.conf';old.write_bytes(b'original config')
                new = root/'new.conf'
                replacements = {old:b'new config', new:b'new cache zone'}
                def verify():
                    self.assertEqual(old.read_bytes(), b'new config')
                    if failure == 'health':raise RuntimeError('synthetic verification failure')
                effects = [subprocess.CalledProcessError(1, 'nginx'),None,None] if failure == 'syntax' else None
                with patch.object(installer, 'run', side_effect=effects):
                    with self.assertRaises((RuntimeError,subprocess.CalledProcessError)):
                        installer.upgrade(replacements, root/'backups', verify)
                self.assertEqual(old.read_bytes(), b'original config')
                self.assertFalse(new.exists())
                self.assertFalse(list(root.glob('*.image-cache-tmp')))

    def test_success_backups_and_public_only_templates(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp);target = root/'proxy.conf';target.write_bytes(b'old')
            with patch.object(installer,'run'):
                backup = installer.upgrade({target:b'new'}, root/'backups', lambda:None)
            self.assertEqual(target.read_bytes(), b'new')
            self.assertEqual((backup/'0-proxy.conf').read_bytes(), b'old')
        text = (ROOT/'deploy/landscape-image-proxy.conf').read_text()
        self.assertEqual(text.count('location ^~'),2)
        self.assertNotIn('/api/auth/',text)
        self.assertNotIn('proxy_ignore_headers',text)
        self.assertIn('max_size=512m',(ROOT/'deploy/landscape-image-cache.conf').read_text())
