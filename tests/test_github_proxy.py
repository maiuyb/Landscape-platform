import importlib.util
import json
from pathlib import Path
import unittest
import subprocess
from unittest.mock import patch


class GithubProxyTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('github_proxy', Path(__file__).resolve().parents[1] / 'deploy/install-github-proxy.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_only_github_domains_are_proxied_and_everything_else_is_direct(self):
        c = self.module.configuration('https://subscription.invalid/PRIVATE-SENTINEL')
        self.assertEqual(c['rules'], ['DOMAIN-SUFFIX,github.com,GitHub', 'DOMAIN-SUFFIX,githubusercontent.com,GitHub', 'DOMAIN-SUFFIX,githubassets.com,GitHub', 'MATCH,DIRECT'])
        self.assertEqual(c['proxy-providers']['subscription']['proxy'], 'DIRECT')
        self.assertEqual(c['proxy-providers']['subscription']['health-check']['url'], 'https://github.com/robots.txt')

    def test_loopback_only_no_tun_dns_listener_or_dashboard(self):
        c = self.module.configuration('https://subscription.invalid/test')
        self.assertEqual(c['bind-address'], '127.0.0.1')
        self.assertFalse(c['allow-lan'])
        self.assertFalse(c['tun']['enable'])
        self.assertFalse(c['dns']['enable'])
        self.assertNotIn('external-controller', c)
        self.assertTrue(c['external-controller-unix'].startswith('/var/lib/landscape-github-proxy/'))
        self.assertEqual(c['log-level'], 'silent')
        self.assertEqual(json.loads(json.dumps(c)), c)

    def test_invalid_subscription_is_rejected(self):
        for text in ('http://subscription.invalid/key', 'not-a-url', 'https://subscription.invalid/key\ninvalid'):
            with self.assertRaises(ValueError):
                self.module.configuration(text)

    def test_unit_loads_private_credentials_without_public_logging(self):
        unit = (Path(__file__).resolve().parents[1] / 'deploy/landscape-github-proxy.service').read_text()
        self.assertIn('DynamicUser=true', unit)
        self.assertIn('LoadCredential=config:/etc/landscape/github-proxy.json', unit)
        self.assertIn('StandardOutput=null', unit)
        self.assertIn('StandardError=null', unit)
        self.assertNotIn('0.0.0.0', unit)

    def test_empty_provider_cannot_be_mistaken_for_a_working_proxy(self):
        with patch.object(self.module.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout=b'{"proxies":[]}')) as run:
            self.assertFalse(self.module.check_github())
        self.assertEqual(run.call_count, 1)

    def test_real_selected_node_is_required_before_network_check(self):
        results = [subprocess.CompletedProcess([], 0, stdout=b'{"proxies":[{"name":"synthetic"}]}'),
                   subprocess.CompletedProcess([], 0, stdout=b'{"now":"DIRECT"}')]
        with patch.object(self.module.subprocess, 'run', side_effect=results) as run:
            self.assertFalse(self.module.check_github())
        self.assertEqual(run.call_count, 2)
        results[1] = subprocess.CompletedProcess([], 0, stdout=b'{"now":"synthetic"}')
        with patch.object(self.module.subprocess, 'run', side_effect=results + [subprocess.CompletedProcess([], 0)]) as run:
            self.assertTrue(self.module.check_github())
        self.assertIn('--proxy', run.call_args.args[0])


if __name__ == '__main__':
    unittest.main()
