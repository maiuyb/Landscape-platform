"""Updater failure modes with synthetic SQLite and no network/system changes."""
import importlib.util
import io
from contextlib import closing
from contextlib import redirect_stdout
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import types
import unittest
import subprocess
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
        with patch.object(u, 'fetch_repository', return_value=sha), \
             patch.object(u, 'revision', return_value=sha), patch.object(u, 'build') as build, \
             patch.object(u, 'activate') as activate:
            u.update()
        build.assert_not_called()
        activate.assert_not_called()

    def test_build_failure_never_activates(self):
        u = self.updater
        (u.ROOT / 'repository.git').mkdir()
        with patch.object(u, 'fetch_repository', return_value='b' * 40), \
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

    def test_parse_git_progress_with_received_bytes(self):
        u = self.updater
        self.assertEqual(u.git_progress('Receiving objects:  27% (27/100), 1.50 MiB | 5.00 KiB/s'),
                         {'phase': 'Receiving objects', 'percent': 27, 'completed': 27, 'total': 100, 'received_bytes': 1572864})
        self.assertEqual(u.git_progress('remote: Counting objects: 100% (4/4), done.')['phase'], 'Counting objects')
        self.assertIsNone(u.git_progress('https://secret:password@proxy.invalid'))

    def test_quiet_slow_work_gets_heartbeats_and_is_not_treated_as_stalled(self):
        u = self.updater
        output = io.StringIO()
        with patch.object(u, 'HEARTBEAT', .01), redirect_stdout(output):
            result = u.run([sys.executable, '-c', 'import time; time.sleep(.3)'], stage='python_dependencies', timeout=3)
        self.assertEqual(result.returncode, 0)
        events = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertTrue(any(e['message'] == 'waiting_for_command' for e in events))
        self.assertEqual(json.loads((u.ROOT / 'update-status.json').read_text())['message'], 'completed')
        self.assertFalse((u.ROOT / 'update-status.tmp').exists())

    def test_progress_stream_handles_carriage_returns_and_does_not_log_raw_output(self):
        u = self.updater
        script = "import sys,time; print('Receiving objects: 27% (27/100), 1.50 MiB | 5 KiB/s',end='\\r',flush=True); print('PRIVATE-SENTINEL',flush=True); time.sleep(.3)"
        output = io.StringIO()
        with patch.object(u, 'HEARTBEAT', .01), redirect_stdout(output):
            u.run([sys.executable, '-c', script], stage='fetch', timeout=3)
        events = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertTrue(any(e.get('received_bytes') == 1572864 and 'progress_age_seconds' in e for e in events))
        self.assertNotIn('PRIVATE-SENTINEL', output.getvalue())
        self.assertNotIn('PRIVATE-SENTINEL', (u.ROOT / 'update-status.json').read_text())

    def test_command_deadline_stops_process_and_is_classified(self):
        u = self.updater
        with redirect_stdout(io.StringIO()), self.assertRaises(u.UpdateError) as result:
            u.run([sys.executable, '-c', 'import time; time.sleep(30)'], timeout=.15)
        self.assertEqual(result.exception.category, 'time_limit')

    def test_network_errors_are_classified_without_echoing_credentials(self):
        u = self.updater
        output = io.StringIO()
        with redirect_stdout(output), self.assertRaises(u.UpdateError) as result:
            u.run([sys.executable, '-c', "import sys; print('PRIVATE-SENTINEL SSL certificate failed'); sys.exit(1)"], timeout=3)
        self.assertEqual(result.exception.category, 'tls_failed')
        self.assertNotIn('PRIVATE-SENTINEL', output.getvalue())
        self.assertEqual(u.category('Operation too slow. Less than 1 bytes/sec transferred'), 'transfer_stalled')
        self.assertEqual(u.category('Could not resolve host'), 'dns_failed')
        self.assertEqual(u.category('proxy connect aborted'), 'proxy_failed')

    def test_connection_retry_is_bounded_and_can_recover(self):
        u = self.updater
        sha = 'b' * 40
        remote = subprocess.CompletedProcess([], 0, stdout=sha + '\trefs/heads/main\n')
        with patch.object(u, 'run', side_effect=[u.UpdateError('connection_timeout'), remote, remote]) as run, \
             patch.object(u.time, 'sleep') as sleep, patch.object(u, 'revision', return_value='a' * 40), \
             patch.object(u.subprocess, 'check_output', return_value=sha), redirect_stdout(io.StringIO()):
            self.assertEqual(u.fetch_repository(u.ROOT / 'repository.git', {}), sha)
        self.assertEqual(run.call_count, 3)
        sleep.assert_called_once_with(5)
        self.assertIn('--progress', run.call_args.args[0])
        self.assertIn('http.lowSpeedTime=45', run.call_args.args[0])
        self.assertEqual(run.call_args.kwargs['timeout'], u.FETCH_TIMEOUT)

    def test_two_failed_attempts_leave_failure_visible_and_do_not_build(self):
        u = self.updater
        with patch.object(u, 'run', side_effect=u.UpdateError('transfer_stalled')) as run, \
             patch.object(u.time, 'sleep'), redirect_stdout(io.StringIO()), self.assertRaises(u.UpdateError):
            u.fetch_repository(u.ROOT / 'repository.git', {})
        self.assertEqual(run.call_count, 2)
        status = json.loads((u.ROOT / 'update-status.json').read_text())
        self.assertEqual(status['state'], 'failed')
        self.assertEqual(status['category'], 'transfer_stalled')

    def test_same_remote_revision_skips_object_transfer(self):
        u = self.updater
        sha = 'a' * 40
        with patch.object(u, 'run', return_value=subprocess.CompletedProcess([], 0, stdout=sha + '\trefs/heads/main\n')) as run, \
             patch.object(u, 'revision', return_value=sha), redirect_stdout(io.StringIO()):
            self.assertEqual(u.fetch_repository(u.ROOT / 'repository.git', {'HTTPS_PROXY': 'http://PRIVATE-SENTINEL'}), sha)
        self.assertEqual(run.call_count, 1)
        self.assertNotIn('fetch', run.call_args.args[0])
        self.assertNotIn('PRIVATE-SENTINEL', (u.ROOT / 'update-status.json').read_text())

    def test_invalid_remote_revision_never_reaches_fetch(self):
        u = self.updater
        with patch.object(u, 'run', return_value=subprocess.CompletedProcess([], 0, stdout='not-a-revision')) as run, \
             patch.object(u.time, 'sleep'), redirect_stdout(io.StringIO()), self.assertRaises(u.UpdateError) as result:
            u.fetch_repository(u.ROOT / 'repository.git', {})
        self.assertEqual(result.exception.category, 'invalid_remote_revision')
        self.assertTrue(all('fetch' not in call.args[0] for call in run.call_args_list))

    def test_github_proxy_is_scoped_to_git_and_does_not_mutate_parent_environment(self):
        u = self.updater
        original = {'LANDSCAPE_GITHUB_PROXY': 'http://127.0.0.1:17890', 'PATH': 'kept', 'HTTPS_PROXY': 'http://unrelated.invalid'}
        result = u.github_environment(original)
        self.assertEqual(result['https_proxy'], 'http://127.0.0.1:17890')
        self.assertEqual(result['no_proxy'], '127.0.0.1,localhost')
        self.assertNotIn('HTTPS_PROXY', result)
        self.assertNotIn('https_proxy', original)
        self.assertEqual(original['HTTPS_PROXY'], 'http://unrelated.invalid')
        self.assertEqual(result['PATH'], 'kept')

    def test_no_github_proxy_does_not_accidentally_use_broad_proxy(self):
        result = self.updater.github_environment({'HTTPS_PROXY': 'http://other.invalid', 'ALL_PROXY': 'socks5://other.invalid', 'PATH': 'kept'})
        self.assertFalse(any('proxy' in key.lower() for key in result))

    def test_bad_github_proxy_is_rejected_without_exposing_its_value(self):
        u = self.updater
        with self.assertRaises(u.UpdateError) as result:
            u.github_environment({'LANDSCAPE_GITHUB_PROXY': 'PRIVATE-SENTINEL\ninvalid'})
        self.assertEqual(str(result.exception), 'invalid_proxy_configuration')


if __name__ == '__main__':
    unittest.main()
