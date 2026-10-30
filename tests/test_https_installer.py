"""No real firewall, network, certificate or privileged file access."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('https_installer',Path(__file__).resolve().parents[1]/'deploy/enable-auth-https.py')
installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)


class Installer(unittest.TestCase):
    def status(self,text,add_output='Rule added\n'):
        return patch.object(installer.subprocess,'run',side_effect=[
            subprocess.CompletedProcess(['ufw'],0,stdout=text,stderr=''),
            subprocess.CompletedProcess(['ufw'],0,stdout=add_output,stderr='')])

    def test_inactive_or_absent_firewall_is_not_enabled(self):
        with patch.object(installer.shutil,'which',return_value=None),patch.object(installer.subprocess,'run') as run:
            self.assertEqual(installer.allow_https_firewall(),('not_installed',False));run.assert_not_called()
        with patch.object(installer.shutil,'which',return_value='/usr/sbin/ufw'),self.status('Status: inactive\n') as run:
            self.assertEqual(installer.allow_https_firewall(),('inactive',False));self.assertEqual(run.call_count,1)

    def test_existing_ipv4_rule_is_preserved(self):
        for rule in ['443/tcp ALLOW Anywhere','443 ALLOW IN Anywhere']:
            with patch.object(installer.shutil,'which',return_value='/usr/sbin/ufw'),self.status('Status: active\n'+rule+'\n') as run:
                self.assertEqual(installer.allow_https_firewall(),('already_allowed',False));self.assertEqual(run.call_count,1)

    def test_adds_only_ipv4_tcp443_leaving_ssh_and_ipv6_untouched(self):
        with patch.object(installer.shutil,'which',return_value='/usr/sbin/ufw'),self.status('Status: active\n22/tcp ALLOW 192.0.2.1\n443/tcp (v6) ALLOW Anywhere (v6)\n') as run:
            self.assertEqual(installer.allow_https_firewall(),('added',True))
            self.assertEqual(run.call_args.args[0],['/usr/sbin/ufw','allow','proto','tcp','from','0.0.0.0/0','to','any','port','443'])
            self.assertEqual(run.call_args.kwargs['env']['LC_ALL'],'C')

    def test_skipped_existing_rule_is_not_marked_for_deletion(self):
        with patch.object(installer.shutil,'which',return_value='/usr/sbin/ufw'),self.status('Status: active\n443/tcp ALLOW Anywhere # existing\n','Skipping adding existing rule\n'):
            self.assertEqual(installer.allow_https_firewall(),('already_allowed',False))

    def test_rollback_targets_exact_added_rule(self):
        with patch.object(installer.shutil,'which',return_value='/usr/sbin/ufw'),patch.object(installer,'run') as run:
            installer.remove_added_firewall_rule()
            run.assert_called_once_with('/usr/sbin/ufw','--force','delete','allow','proto','tcp','from','0.0.0.0/0','to','any','port','443')

    def test_diagnostics_keep_only_safe_categories_across_stages(self):
        with tempfile.TemporaryDirectory() as temp:
            status=Path(temp)/'status.json'
            with patch.object(installer,'STATE',status),patch.object(installer,'_details',{}):
                installer.report('verify_public_https',ufw_status='added',local_tls_ok=True,private_config='must-not-appear')
                installer.report('failed_previous_site_restored','failed',failed_stage='verify_public_https',error_type='TimeoutError')
                data=json.loads(status.read_text());self.assertNotIn('private_config',data)
                self.assertEqual(data['ufw_status'],'added');self.assertEqual(data['failed_stage'],'verify_public_https')


if __name__=='__main__':unittest.main()
