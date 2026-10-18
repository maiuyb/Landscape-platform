"""Updater failure modes with synthetic SQLite and no network/system changes."""
import importlib.util
from contextlib import closing
from pathlib import Path
import sqlite3
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

FILE = Path(__file__).resolve().parents[1] / 'deploy/landscape-update.py'


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('deployment_update', FILE)
        self.updater = importlib.util.module_from_spec(spec)
        # Windows exercises transaction logic; flock is exercised by systemd on Ubuntu.
        with patch.dict(sys.modules, {'fcntl': types.ModuleType('fcntl')}):
            spec.loader.exec_module(self.updater)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.updater.ROOT = Path(self.tmp.name) / 'code'
        self.updater.DATA = Path(self.tmp.name) / 'data'
        self.updater.ROOT.mkdir()
        self.updater.DATA.mkdir()
        (self.updater.ROOT / 'releases').mkdir()

    def test_failed_activation_restores_code_without_restoring_database(self):
        u = self.updater
        old, new = 'a' * 40, 'b' * 40
        pointer = [old]
        database = u.DATA / 'recipes.db'
        with closing(sqlite3.connect(database)) as db, db:
            db.execute('CREATE TABLE records(value TEXT)')
            db.execute("INSERT INTO records VALUES ('existing user data')")
        def restart():
            if pointer[0] == new:
                with closing(sqlite3.connect(database)) as db, db:
                    db.execute("INSERT INTO records VALUES ('write during rollout')")
        with patch.object(u, 'revision', side_effect=lambda: pointer[0]), \
             patch.object(u, 'switch', side_effect=lambda path: pointer.__setitem__(0, path.name)) as switch, \
             patch.object(u, 'restart', side_effect=restart), patch.object(u, 'healthy', side_effect=[False, True]):
            with self.assertRaisesRegex(RuntimeError, 'New release failed'):
                u.activate(new, u.ROOT / 'releases' / new)
        self.assertEqual(pointer[0], old)
        self.assertEqual(switch.call_count, 2)
        with closing(sqlite3.connect(database)) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM records').fetchone()[0], 2)
        backup = next((u.DATA / 'backups').glob('*.db'))
        with closing(sqlite3.connect(backup)) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM records').fetchone()[0], 1)

    def test_unchanged_main_never_builds_or_restarts(self):
        u = self.updater
        (u.ROOT / 'repository.git').mkdir()
        sha = 'a' * 40
        with patch.object(u, 'run'), patch.object(u.subprocess, 'check_output', return_value=sha), \
             patch.object(u, 'revision', return_value=sha), patch.object(u, 'build') as build, \
             patch.object(u, 'activate') as activate:
            u.update()
        build.assert_not_called()
        activate.assert_not_called()

    def test_build_failure_never_activates(self):
        u = self.updater
        (u.ROOT / 'repository.git').mkdir()
        with patch.object(u, 'run'), patch.object(u.subprocess, 'check_output', return_value='b' * 40), \
             patch.object(u, 'revision', return_value='a' * 40), \
             patch.object(u, 'build', side_effect=RuntimeError('network failed')), \
             patch.object(u, 'activate') as activate:
            with self.assertRaisesRegex(RuntimeError, 'network failed'):
                u.update()
        activate.assert_not_called()

    def test_failed_rollback_is_reported(self):
        u = self.updater
        with patch.object(u, 'backup_database'), patch.object(u, 'revision', return_value='a' * 40), \
             patch.object(u, 'switch'), patch.object(u, 'restart'), patch.object(u, 'healthy', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'Rollback readiness check failed'):
                u.activate('b' * 40, u.ROOT / 'releases' / ('b' * 40))


if __name__ == '__main__':
    unittest.main()
