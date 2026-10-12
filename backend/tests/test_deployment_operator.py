"""Stdlib operator tests: disposable state, synthetic env, no remote mutations."""
import json
from pathlib import Path
import re
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

from deployment.cloudflare import Cloudflare, PUBLIC_PATH
from deployment.operator import Operator
from deployment.settings import DEFAULTS, DeploymentError, load_env, validate
from deployment.state import State

TUNNEL = str(uuid.UUID(int=1))
VALUES = dict(DEFAULTS, POSTGRES_PASSWORD='abcd0123456789abcdef0123456789',
              AUTH_CODE_SECRET='0123456789abcdef-auth-' * 3, RECEIPT_SECRET='0123456789abcdef-receipt-' * 3,
              MESSAGING_TOKEN='0123456789abcdef-messaging-' * 3, GEMINI_API_KEY='substitute',
              PROJECT_ID='substitute', PROJECT_SECRET='substitute',
              CLOUDFLARE_API_TOKEN='0123456789abcdef0123456789abcdef',
              CLOUDFLARE_ACCOUNT_ID='a' * 32, CLOUDFLARE_ZONE_ID='b' * 32, CLOUDFLARE_TUNNEL_ID=TUNNEL)


class FakeCloudflare:
    def __init__(self, state, values=None):
        self.values = values or VALUES
        self.marker = 'btg-' + state.data['deployment_id']
        self.calls = []
        self.tunnels, self.records, self.rules = [], [], []
        self.config = {'ingress': [dict(hostname=self.values['CLOUDFLARE_HOSTNAME'], path=PUBLIC_PATH, service='http://127.0.0.1:8000'), dict(service='http_status:404')]}
        self.pages, self.routes, self.domains, self.account_sets, self.zone_sets = [], [], [], [], []
        self.denied = None
        self.clients = [{'config_version':1,'conns':[{'is_pending_reconnect':False}]}]
        self.external = self.values['CLOUDFLARE_TUNNEL_MODE'] == 'external'
        if self.external:
            self.records = [dict(id='dns', type='CNAME', content=TUNNEL+'.cfargotunnel.com', proxied=True)]
            self.rules = [dict(id='rule', enabled=True, expression=f'(http.host eq "{self.values["CLOUDFLARE_HOSTNAME"]}")', action='set_cache_settings', action_parameters={'cache': False})]

    def __call__(self, method, path, body, permission, missing):
        self.calls.append((method, path, body))
        if self.denied and self.denied in path:
            raise DeploymentError('Cloudflare denied request: required scoped permission')
        resource = path.split('?')[0]
        result = None
        if resource.endswith('/tokens/verify'): result = {'status': 'active'}
        elif resource == '/zones/' + VALUES['CLOUDFLARE_ZONE_ID']: result = {'name': 'bridgetogrowth-learning.com', 'account': {'id': VALUES['CLOUDFLARE_ACCOUNT_ID']}, 'status': 'active'}
        elif resource.endswith('/settings'): result = []
        elif resource.endswith('/pagerules'): result = self.pages
        elif resource.endswith('/workers/routes'): result = self.routes
        elif resource.endswith('/workers/domains'): result = self.domains
        elif resource.endswith('/rulesets') and method == 'GET': result = self.account_sets if resource.startswith('/accounts') else self.zone_sets
        elif resource.endswith('/entrypoint'): result = {'id': 'ruleset', 'rules': self.rules} if self.rules else None
        elif '/rulesets' in resource and method == 'POST':
            rule = body.get('rules', [body])[0]
            self.rules.append(dict(rule, id='rule'))
            result = {'id': 'ruleset', 'rules': self.rules}
        elif resource.endswith('/dns_records'):
            if method == 'POST': self.records.append(dict(body, id='dns'))
            result = self.records if method == 'GET' else self.records[-1]
        elif resource.endswith('/cfd_tunnel'):
            if method == 'POST': self.tunnels.append(dict(body, id=TUNNEL))
            result = self.tunnels if method == 'GET' else self.tunnels[-1]
        elif resource.endswith('/configurations'):
            if method == 'PUT': self.config = body['config']
            result = {'config': self.config, 'version':1}
        elif resource.endswith('/connections'): result = self.clients
        elif resource.endswith('/token'): result = 'synthetic_connector_token'
        elif '/cfd_tunnel/' in resource: result = dict(id=TUNNEL, name=VALUES['CLOUDFLARE_TUNNEL_NAME'], config_src='cloudflare', status='healthy')
        else: raise AssertionError((method, path))
        return None if result is None else {'success': True, 'result': result, 'result_info': {'total_pages': 1}}


class OperatorTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.state = State(self.root)
        self.state.save()
        self.values = dict(VALUES)
        self.commands = []
        self.containers = {}
        self.probes = []

    def env(self):
        (self.root/'.env').write_text('\n'.join(k+'='+v for k,v in self.values.items()))

    def runner(self, command, **options):
        self.commands.append((command, options))
        if command[:3] == ['docker', 'ps', '-aq']:
            output = ' '.join(self.containers)
        elif command[:2] == ['docker', 'inspect']:
            output = json.dumps(list(self.containers.values()))
        elif command[:2] == ['docker', 'stop']:
            for container in self.containers.values():
                if container['Id'] == command[-1]: container['State']['Running'] = False
            output = ''
        elif command[-3:] == ['config', '--format', 'json']:
            output = json.dumps({'services': {name: {'environment': {}} for name in ('postgres', 'messaging', 'coordinator')}})
        else: output = ''
        return SimpleNamespace(returncode=0, stdout=output)

    def checker(self, *args):
        self.probes.append(args)
        return True

    def owned(self, name, running=True, port='8000'):
        self.containers[name] = dict(Id=name, State={'Running': running}, Config={'Env': [], 'Labels': {
            'com.docker.compose.service': name, 'io.btg.deployment': self.state.data['deployment_id'],
            'com.docker.compose.project.working_dir': str(self.root)}},
            HostConfig={'PortBindings': {'8000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': port}]}})

    def operator(self):
        return Operator(self.root, self.runner, self.checker)

    def test_missing_invalid_environment_and_secrets(self):
        with self.assertRaises(DeploymentError): load_env(self.root/'.env')
        for key, value in [('API_PORT','9000'), ('LOCAL_API_PORT','8000'), ('LOCAL_API_PORT','08000'), ('LESSON_REQUEST_LIMIT','0'),
                           ('CLOUDFLARE_TUNNEL_MODE','guess'), ('AUTH_CODE_SECRET','weak'), ('POSTGRES_PASSWORD','a'*32), ('POSTGRES_PASSWORD',self.values['AUTH_CODE_SECRET']),
                           ('AUTH_CODE_SECRET', self.values['RECEIPT_SECRET']), ('PROJECT_SECRET',''),
                           ('CLOUDFLARE_HOSTNAME', 'Bad.Host'), ('CLOUDFLARE_TUNNEL_ID','bad'), ('CLOUDFLARE_API_TOKEN','')]:
            with self.subTest(key=key, value=value):
                with self.assertRaises(DeploymentError): validate(dict(self.values, **{key:value}))
        self.env()
        with (self.root/'.env').open('a') as file: file.write('\nAPI_PORT=8000\n')
        with self.assertRaisesRegex(DeploymentError, 'Duplicate'): load_env(self.root/'.env')
        (self.root/'.env').write_text('PROJECT_SECRET=$(touch stolen)')
        with self.assertRaises(DeploymentError): load_env(self.root/'.env')

    def test_external_start_checks_prerequisites_before_origin_no_connector(self):
        self.env()
        def inspection():
            self.assertFalse(any(command[-1] == 'coordinator' and 'up' in command for command,_ in self.commands))
        with patch('deployment.operator.shutil.which', return_value='/docker'), patch('deployment.operator.Cloudflare') as factory:
            factory.return_value.inspect_external.side_effect = inspection
            factory.return_value.connected.return_value = True
            operator = self.operator()
            operator.start()
        self.assertTrue(operator.local_ready and operator.public_ready)
        self.assertFalse(any('cloudflared' in command for command,_ in self.commands))
        self.assertTrue(any('/healthz' in probe for probe in self.probes))
        self.assertTrue(any('/internal/receipts' in probe and probe[2] == 404 for probe in self.probes))
        self.assertEqual((self.state.directory/'compose.env').stat().st_mode & 0o777, 0o600)

    def test_local_only_private_port_without_cloudflare_credentials(self):
        for key in ('CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_ZONE_ID', 'CLOUDFLARE_TUNNEL_ID'):
            self.values.pop(key)
        self.env()
        with patch('deployment.operator.shutil.which', return_value='/docker'), patch('deployment.operator.Cloudflare') as factory:
            operator = self.operator()
            operator.start(local_only=True)
            factory.assert_not_called()
        self.assertTrue(operator.local_ready)
        self.assertFalse(operator.public_ready)
        self.assertEqual(self.probes[0][0], 'http://127.0.0.1:18000')
        self.assertIn("API_PORT='18000'", (self.state.directory/'compose.env').read_text())

    def test_managed_start_and_failed_prerequisites_no_origin(self):
        self.values['CLOUDFLARE_TUNNEL_MODE'] = 'managed'
        self.env()
        with patch('deployment.operator.shutil.which', return_value='/docker'), patch('deployment.operator.Cloudflare') as factory:
            factory.return_value.connected.return_value = True
            self.operator().start()
            factory.return_value.provision.assert_called_once()
        self.assertTrue(any('cloudflared' == command[-1] and 'up' in command for command,_ in self.commands))
        self.commands.clear()
        with patch('deployment.operator.shutil.which', return_value='/docker'), patch('deployment.operator.Cloudflare') as factory:
            factory.return_value.provision.side_effect = DeploymentError('denied')
            with self.assertRaisesRegex(DeploymentError, 'denied'): self.operator().start()
        self.assertFalse(any('up' in command for command,_ in self.commands))

    def test_owned_reuse_mode_conflict_and_unowned_conflict(self):
        self.env()
        self.owned('coordinator')
        with patch('deployment.operator.shutil.which', return_value='/docker'), patch('deployment.operator.Cloudflare') as factory:
            factory.return_value.connected.return_value = True
            self.operator().start()
        self.assertTrue(any('--no-recreate' in command for command,_ in self.commands))
        with patch('deployment.operator.shutil.which', return_value='/docker'):
            with self.assertRaisesRegex(DeploymentError, 'port differs'): self.operator().start(True)
        self.containers['coordinator']['Config']['Labels']['io.btg.deployment'] = 'unrelated'
        with self.assertRaisesRegex(DeploymentError, 'ownership'): self.operator().containers()
        self.assertFalse(any(command[:2] == ['docker', 'stop'] for command,_ in self.commands))

    def test_backend_unavailable_and_command_secret_redaction(self):
        self.env()
        with patch('deployment.operator.shutil.which', return_value='/docker'):
            operator = Operator(self.root, self.runner, lambda *args: False)
            with self.assertRaisesRegex(DeploymentError, 'Local API readiness'): operator.start(True)
        operator.runner = lambda *args,**kwargs: SimpleNamespace(returncode=1, stdout='', stderr=self.values['PROJECT_SECRET'])
        with self.assertRaises(DeploymentError) as error: operator.command(['docker', 'info'], 'test')
        self.assertNotIn(self.values['PROJECT_SECRET'], str(error.exception))

    def test_stop_drains_in_order_repeated_preserves_data_and_partial_recovery(self):
        for name in ('postgres','messaging','coordinator','cloudflared'): self.owned(name)
        self.state.save()
        self.state.write('connector-token', 'saved_token')
        with patch('deployment.operator.shutil.which', return_value='/docker'):
            self.operator().stop()
            self.operator().stop()
        stops = [(command[-1], options['timeout']) for command,options in self.commands if command[:2] == ['docker','stop']]
        self.assertEqual(stops, [('cloudflared',None),('coordinator',None),('messaging',None),('postgres',None)])
        self.assertTrue(all('--time=-1' in command for command,_ in self.commands if command[:2] == ['docker','stop']))
        self.assertFalse(any(argument in ('down', 'rm', '-v', 'kill') for command,_ in self.commands for argument in command))
        self.assertEqual((self.state.directory/'connector-token').read_text(), 'saved_token')
        self.assertTrue(self.state.path.exists())

    def test_cloudflare_external_read_only_allowlist_apex_cache_and_conflicts(self):
        fake = FakeCloudflare(self.state)
        cf = Cloudflare(self.values, self.state, fake)
        cf.inspect_external()
        self.assertTrue(all(method == 'GET' for method,_,_ in fake.calls))
        self.assertFalse((self.state.directory/'connector-token').exists())
        for mutation in ('ingress', 'cache', 'dns', 'permission'):
            broken = FakeCloudflare(self.state)
            if mutation == 'ingress': broken.config['ingress'][0].pop('path')
            if mutation == 'cache': broken.rules = []
            if mutation == 'dns': broken.records[0]['content'] = 'unrelated'
            if mutation == 'permission': broken.denied = '/rulesets'
            with self.subTest(mutation=mutation):
                with self.assertRaises(DeploymentError): Cloudflare(self.values, self.state, broken).inspect_external()
                self.assertTrue(all(method == 'GET' for method,_,_ in broken.calls))

    def test_full_hostname_page_worker_and_ambiguous_policy_conflicts(self):
        for path in ('/auth/*', '/lessons/*', '/account/delete*', '/video*', '/anything-else'):
            for kind in ('page', 'worker'):
                fake = FakeCloudflare(self.state)
                if kind == 'page': fake.pages = [{'targets': [{'constraint': {'value': 'https://'+self.values['CLOUDFLARE_HOSTNAME']+path}}]}]
                else: fake.routes = [{'pattern': '*'+self.values['CLOUDFLARE_HOSTNAME']+path}]
                with self.subTest(path=path,kind=kind):
                    with self.assertRaises(DeploymentError): Cloudflare(self.values,self.state,fake).inspect_external()
        for kind in ('domain','account','response','cache'):
            fake = FakeCloudflare(self.state)
            if kind == 'domain': fake.domains = [{'hostname': self.values['CLOUDFLARE_HOSTNAME']}]
            if kind == 'account': fake.account_sets = [{'phase':'http_request_cache_settings'}]
            if kind == 'response': fake.zone_sets = [{'phase':'http_response_cache_settings'}]
            if kind == 'cache': fake.rules.append({'enabled':True,'expression':'anything','action_parameters':{'cache':True}})
            with self.subTest(kind=kind):
                with self.assertRaises(DeploymentError): Cloudflare(self.values,self.state,fake).inspect_external()

    def test_first_managed_provision_and_reuse_token_permissions_ownership(self):
        self.values['CLOUDFLARE_TUNNEL_MODE'] = 'managed'
        fake = FakeCloudflare(self.state, self.values)
        cf = Cloudflare(self.values,self.state,fake)
        self.assertEqual(cf.provision(), TUNNEL)
        first_posts = len([c for c in fake.calls if c[0]=='POST'])
        cf.provision()
        self.assertEqual(len([c for c in fake.calls if c[0]=='POST']), first_posts)
        self.assertEqual((self.state.directory/'connector-token').stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.state.path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.state.directory.stat().st_mode & 0o777, 0o700)
        fake.records[0]['comment']='unrelated'
        with self.assertRaisesRegex(DeploymentError,'DNS conflict'): cf.provision()
        other = State(self.root/'other')
        with self.assertRaisesRegex(DeploymentError,'Pre-existing'): Cloudflare(self.values,other,fake).provision()

    def test_state_rejects_symlinks_and_public_regex_rejects_private_paths(self):
        (self.state.directory/'connector-token').symlink_to(self.root/'target')
        with self.assertRaises(DeploymentError): self.state.write('connector-token','secret')
        for path in ('/account/delete','/auth/login','/account','/lessons/'+str(uuid.uuid4())+'/cancel'):
            self.assertIsNotNone(re.fullmatch(PUBLIC_PATH,path))
        for path in ('/internal/receipts','/video','/verification','/docs','/redoc','/openapi.json','/healthz','/docker','/lessons/bad','/account/delete/extra'):
            self.assertIsNone(re.fullmatch(PUBLIC_PATH,path))

    def test_connector_configuration_convergence_is_required_before_exposure(self):
        for clients in ([], [{'config_version':0,'conns':[{}]}], [{'config_version':1,'conns':[{}]}, {'config_version':0,'conns':[{}]}]):
            fake = FakeCloudflare(self.state)
            fake.clients = clients
            with self.assertRaisesRegex(DeploymentError, 'convergence'):
                Cloudflare(self.values,self.state,fake).inspect_external()
            self.assertTrue(all(method == 'GET' for method,_,_ in fake.calls))

    def test_pagination_does_not_miss_later_policy_conflicts(self):
        calls = []
        def transport(method,path,body,permission,missing):
            calls.append(path)
            return {'result': [path], 'result_info': {'total_count':101,'per_page':50}} 
        cf = Cloudflare(self.values,self.state,transport)
        self.assertEqual(len(cf.listing('/synthetic','read')), 3)
        self.assertIn('page=3',calls[-1])
        cf.transport=lambda *args: {'result':[{}],'result_info':{'count':1}}
        with self.assertRaisesRegex(DeploymentError,'completeness'):
            cf.listing('/synthetic','read')

    def test_failed_public_private_route_probe_is_not_ready(self):
        self.env()
        def checker(origin,path,*args): return path != '/docs'
        with patch('deployment.operator.shutil.which',return_value='/docker'), patch('deployment.operator.Cloudflare') as factory:
            factory.return_value.connected.return_value=True
            operator=Operator(self.root,self.runner,checker)
            with self.assertRaisesRegex(DeploymentError,'private-route'): operator.start()
            self.assertFalse(operator.public_ready)

    def test_permission_api_failures_redact_cloudflare_bodies(self):
        from urllib.error import HTTPError, URLError
        from io import BytesIO
        for error in (HTTPError('https://synthetic',403,'denied',{},BytesIO(b'sensitive-provider-body')),
                      HTTPError('https://synthetic',500,'error',{},BytesIO(b'sensitive-provider-body')),
                      URLError('sensitive-provider-body')):
            cf=Cloudflare(self.values,self.state)
            with patch('deployment.cloudflare.urlopen',side_effect=error):
                with self.assertRaises(DeploymentError) as failure:
                    cf.request('GET','/synthetic',None,'specific read permission')
            self.assertNotIn('sensitive-provider-body',str(failure.exception))
            self.assertNotIn(self.values['CLOUDFLARE_API_TOKEN'],str(failure.exception))

    def test_partial_start_failure_retry_keeps_owned_postgres_and_messaging(self):
        self.env()
        self.owned('postgres')
        self.owned('messaging')
        def fail_run(command,**kwargs):
            if command[-1]=='coordinator' and 'up' in command:
                return SimpleNamespace(returncode=1,stdout='',stderr='private credentials')
            return self.runner(command,**kwargs)
        with patch('deployment.operator.shutil.which',return_value='/docker'):
            operator=Operator(self.root,fail_run,self.checker)
            with self.assertRaisesRegex(DeploymentError,'Coordinator health checks'): operator.start(True)
            self.assertTrue(self.containers['postgres']['State']['Running'])
            self.assertTrue(self.containers['messaging']['State']['Running'])
            self.operator().start(True)
            self.assertTrue(any('--no-recreate' in command for command,_ in self.commands))

    def test_active_loopback_listener_is_rejected_before_startup(self):
        import socket
        with socket.socket() as listener:
            listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
            listener.bind(('127.0.0.1',0))
            listener.listen()
            self.values['LOCAL_API_PORT']=str(listener.getsockname()[1])
            self.env()
            with patch('deployment.operator.shutil.which',return_value='/docker'):
                with self.assertRaisesRegex(DeploymentError,'already in use'):
                    self.operator().start(True)
        self.assertFalse(any('up' in command for command,_ in self.commands))

    def test_provably_unrelated_host_policies_are_preserved(self):
        fake=FakeCloudflare(self.state)
        fake.rules.extend([{'enabled':True,'expression':'(http.host eq "other.example.com")','action_parameters':{'cache':True}},
                           {'enabled':True,'expression':'(http.host ne "bridgetogrowth-learning.com")','action_parameters':{'cache':True}}])
        Cloudflare(self.values,self.state,fake).inspect_external()
        self.assertTrue(all(method=='GET' for method,_,_ in fake.calls))
        fake.rules.append({'enabled':True,'expression':'(http.host ne "other.example.com")','action_parameters':{'cache':True}})
        with self.assertRaises(DeploymentError):Cloudflare(self.values,self.state,fake).inspect_external()
        cf=Cloudflare(self.values,self.state,fake)
        self.assertFalse(cf.excludes_hostname('(http.host eq "other.example.com") or true'))
        self.assertFalse(cf.excludes_hostname('(http.host ne "BRIDGETOGROWTH-LEARNING.COM")'))

    def test_override_rulesets_require_complete_enabled_rule_evidence(self):
        fake=FakeCloudflare(self.state)
        fake.zone_sets=[{'id':'headers','phase':'http_response_headers_transform'}]
        details={'rules':[{'enabled':True,'expression':'(http.host ne "bridgetogrowth-learning.com")'}]}
        def transport(method,path,body,permission,missing):
            if path.endswith('/rulesets/headers'):
                fake.calls.append((method,path,body))
                return {'result':details}
            return fake(method,path,body,permission,missing)
        Cloudflare(self.values,self.state,transport).inspect_external()
        details['rules'][0]['expression']='true'
        with self.assertRaisesRegex(DeploymentError,'may affect'):
            Cloudflare(self.values,self.state,transport).inspect_external()
        details.clear()
        with self.assertRaisesRegex(DeploymentError,'contents unavailable'):
            Cloudflare(self.values,self.state,transport).inspect_external()
        self.assertTrue(all(method=='GET' for method,_,_ in fake.calls))

    def test_public_probe_rejects_cached_redirected_wrong_auth_responses(self):
        from io import BytesIO
        from unittest.mock import Mock
        from deployment.operator import probe
        def check(code=401,cache='DYNAMIC',age=None,control='no-store',detail='Invalid or expired credentials'):
            response=BytesIO(json.dumps({'detail':detail}).encode())
            response.code=code
            response.headers={'CF-Cache-Status':cache,'Cache-Control':control}
            if age is not None:response.headers['Age']=age
            with patch('deployment.operator.build_opener',return_value=Mock(open=Mock(return_value=response))):
                return probe('https://synthetic.test','/account',401,True,True)
        self.assertTrue(check())
        self.assertTrue(check(cache='BYPASS'))
        self.assertFalse(check(cache='HIT'))
        self.assertFalse(check(cache=''))
        self.assertFalse(check(age='0'))
        self.assertFalse(check(control='public, max-age=60'))
        self.assertFalse(check(code=302))
        self.assertFalse(check(detail='wrong service'))
