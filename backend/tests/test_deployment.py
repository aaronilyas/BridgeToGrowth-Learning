"""Synthetic Compose/Cloudflare checks and a real loopback coordinator origin."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
SYNTHETIC = dict(POSTGRES_PASSWORD='synthetic-only', PROJECT_ID='synthetic',
                PROJECT_SECRET='synthetic', MESSAGING_TOKEN='synthetic-messaging-secret-' * 2,
                AUTH_CODE_SECRET='synthetic-code-secret-' * 2, RECEIPT_SECRET='synthetic-receipt-secret-' * 2, GEMINI_API_KEY='synthetic',
                GEMINI_MODEL='synthetic')


@unittest.skipUnless(os.environ.get('RUN_ARCHITECTURE_TESTS') == '1', 'Requires disposable Docker acceptance run')
class DeploymentTests(unittest.TestCase):
    def test_compose_node_and_private_control_boundaries(self):
        result = subprocess.run(['docker','compose','--env-file','/dev/null','-f',str(ROOT/'compose.yaml'),
                                 'config','--format','json'], env={**os.environ,**SYNTHETIC},
                                 capture_output=True, check=True)
        services = json.loads(result.stdout)['services']
        self.assertEqual(set(services), {'postgres','messaging','coordinator'})
        for name in ('postgres','messaging'):
            self.assertFalse(services[name].get('ports'))
            self.assertFalse(any('docker.sock' in json.dumps(v) for v in services[name].get('volumes',[])))
        self.assertEqual(services['coordinator']['ports'][0]['host_ip'],'127.0.0.1')
        self.assertEqual(len(services['coordinator']['ports']),1)
        self.assertEqual(services['coordinator']['environment']['MESSAGING_URL'],'http://messaging:3001/video')
        self.assertIn('node', services['messaging']['healthcheck']['test'])
        self.assertNotIn('bun', json.dumps(services))
        for dockerfile in ('deployment/messaging.Dockerfile','deployment/coordinator.Dockerfile','backend/container/Dockerfile'):
            allowlist = (ROOT/(dockerfile+'.dockerignore')).read_text()
            self.assertTrue(allowlist.startswith('**\n'))
            self.assertNotIn('!.env', allowlist)
        for image, command in ((os.environ.get('MESSAGING_TEST_IMAGE','btg-acceptance-messaging'), ['node','--version']),
                               (os.environ.get('COORDINATOR_TEST_IMAGE','btg-acceptance-coordinator'),['docker','--version'])):
            subprocess.run(['docker','run','--rm','--network=none',image,*command],check=True,capture_output=True)

    def test_cloudflare_ingress_reaches_loopback_api_and_denies_private_routes(self):
        database = os.environ['ACCEPTANCE_DB_CONTAINER']
        info = json.loads(subprocess.check_output(['docker','inspect',database]))[0]
        ip = info['NetworkSettings']['Networks']['bridge']['IPAddress']
        name = 'btg-acceptance-api-'+uuid.uuid4().hex
        self.addCleanup(lambda: subprocess.run(['docker','rm','-f',name],check=True,capture_output=True))
        subprocess.run(['docker','run','-d','--name',name,'--read-only','--cap-drop=ALL',
                        '--security-opt=no-new-privileges','--tmpfs=/tmp:rw,nosuid,nodev,size=64m',
                        '-p','127.0.0.1::8000',
                        *[argument for key, value in {**SYNTHETIC, 'MESSAGING_URL': 'http://messaging:3001/video', 'RENDERER_EGRESS_IMAGE': 'btg-egress:local'}.items() for argument in ('-e', f'{key}={value}')],
                        '-e',f'DATABASE_URL=postgresql+psycopg://postgres:synthetic-only@{ip}:5432/btg',
                        os.environ.get('COORDINATOR_TEST_IMAGE','btg-acceptance-coordinator')],check=True,capture_output=True)
        info = json.loads(subprocess.check_output(['docker','inspect',name]))[0]
        binding = info['NetworkSettings']['Ports']['8000/tcp'][0]
        self.assertEqual(binding['HostIp'],'127.0.0.1')
        origin = 'http://127.0.0.1:'+binding['HostPort']
        for attempt in range(100):
            try:
                with urlopen(origin+'/openapi.json',timeout=1) as response:
                    self.assertEqual(response.status,200)
                break
            except (URLError, ConnectionError):
                time.sleep(.1)
        else:
            self.fail('Disposable coordinator did not become ready')
        with self.assertRaises(HTTPError) as error:
            urlopen(origin+'/lessons/'+str(uuid.uuid4()), timeout=3)
        self.assertEqual(error.exception.code,401)
        template = (ROOT/'deploy/cloudflare/config.example.yml').read_text()
        config = template.replace('<TUNNEL_UUID>',str(uuid.uuid4())).replace(
            '<ABSOLUTE_TUNNEL_CREDENTIALS_JSON_PATH>','/nonexistent/synthetic-credentials.json').replace(
            '<PUBLIC_API_HOSTNAME>','lessons.example.test').replace('<API_ORIGIN>',origin)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'synthetic.yml'
            path.write_text(config)
            cli = ['cloudflared','tunnel','--config',str(path),'ingress']
            subprocess.run([*cli,'validate'],check=True,capture_output=True)
            for route in ('/auth/signup','/auth/enrollment/verify','/auth/logout-all','/account/phone/verify','/lessons/'+str(uuid.uuid4())+'/cancel','/account','/lessons','/lessons/'+str(uuid.uuid4()),'/lessons/'):
                output = subprocess.check_output([*cli,'rule','https://lessons.example.test'+route]).decode()
                self.assertIn('Matched rule #0',output)
                self.assertIn(origin,output)
            for url in ('https://lessons.example.test/video','https://lessons.example.test/docs',
                        'https://lessons.example.test/openapi.json','https://lessons.example.test/docker','https://lessons.example.test/verification','https://lessons.example.test/internal/receipts',
                        'https://lessons.example.test/lessons/not-a-uuid','https://other.example.test/lessons'):
                output = subprocess.check_output([*cli,'rule',url]).decode()
                self.assertIn('http_status:404',output)
        self.assertNotIn('docker.sock',config)
        self.assertNotIn('5432',config)
        self.assertNotIn('3001',config)
