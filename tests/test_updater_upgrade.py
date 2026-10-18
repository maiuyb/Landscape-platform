"""System installer transaction using temporary files and mocked systemd only."""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


class UpdaterUpgradeTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('updater_upgrade', Path(__file__).resolve().parents[1] / 'deploy/upgrade-updater.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'source'
        self.target = self.root / 'target'
        self.source.mkdir()
        self.target.mkdir()
        self.files = {name: self.target / name for name in self.module.FILES}
        self.module.FILES = self.files
        for name, target in self.files.items():
            target.write_text('old ' + name)
            (self.source / name).write_text('# new ' + name)

    def execute(self, runner):
        with patch.object(self.module, 'run', side_effect=runner) as calls, \
             patch.object(self.module.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)), \
             patch.object(self.module.os, 'chown', create=True), contextlib.redirect_stdout(io.StringIO()):
            self.module.upgrade(self.source, self.root / 'backups')
        return calls

    def test_only_updater_files_are_replaced_and_backed_up(self):
        calls = self.execute(lambda *args: None)
        for name, target in self.files.items():
            self.assertEqual(target.read_text(), '# new ' + name)
            self.assertEqual(next((self.root / 'backups').glob('*/' + name)).read_text(), 'old ' + name)
        commands = [call.args for call in calls.call_args_list]
        self.assertIn(('systemctl', 'start', '--no-block', 'landscape-update.service'), commands)
        self.assertFalse(any('landscape.service' in cmd for cmd in commands))
        self.assertFalse(any('nginx' in str(cmd) or 'sudoers' in str(cmd) for cmd in commands))

    def test_failed_start_restores_updater_and_timer(self):
        def run(*args):
            if args == ('systemctl', 'start', '--no-block', 'landscape-update.service'):
                raise RuntimeError('simulated start failure')
        with self.assertRaisesRegex(RuntimeError, 'simulated'):
            self.execute(run)
        for name, target in self.files.items():
            self.assertEqual(target.read_text(), 'old ' + name)

    def test_invalid_source_fails_before_any_service_stop(self):
        (self.source / 'landscape-update.py').write_text('invalid syntax %')
        with patch.object(self.module, 'run') as run, self.assertRaises(SyntaxError):
            self.module.upgrade(self.source, self.root / 'backups')
        run.assert_not_called()

    def test_unit_verification_failure_leaves_files_untouched(self):
        with self.assertRaisesRegex(RuntimeError, 'verify failed'):
            self.execute(lambda *args: (_ for _ in ()).throw(RuntimeError('verify failed')))
        for name, target in self.files.items():
            self.assertEqual(target.read_text(), 'old ' + name)


if __name__ == '__main__':
    unittest.main()
