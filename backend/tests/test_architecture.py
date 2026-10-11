"""Opt-in isolation, lifecycle and real Node HTTP acceptance; no live Photon."""
from datetime import timedelta
import json
import os
from pathlib import Path
import subprocess
import threading
import unittest
import uuid
from unittest.mock import patch
from urllib.request import Request, urlopen

import test_backend as fixtures
from backend.integrations import Integrations
from backend.runtime import DockerRuntime

SILENT = '''from manim import Scene, Dot
class Lesson(Scene):
    def construct(self):
        self.add(Dot())
        self.wait(1)
'''
VOICEOVER = '''from manim import Dot
from manim_voiceover import VoiceoverScene
from manim_voiceover.services.base import SpeechService
from pathlib import Path
import wave, subprocess
class OfflineSpeech(SpeechService):
    def generate_from_text(self, text, cache_dir=None, **kwargs):
        directory = Path(cache_dir or self.cache_dir)
        directory.mkdir(parents=True, exist_ok=True)
        with wave.open(str(directory / 'fixture.wav'), 'wb') as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(8000)
            audio.writeframes(bytes(16000))
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(directory / 'fixture.wav'),
                        str(directory / 'fixture.mp3')], check=True)
        return {'input_text': text, 'original_audio': 'fixture.mp3', 'final_audio': 'fixture.mp3'}
class Lesson(VoiceoverScene):
    def construct(self):
        self.set_speech_service(OfflineSpeech())
        self.add(Dot())
        with self.voiceover(text='Synthetic speech substitute; no quality claim.') as tracker:
            self.wait(tracker.duration)
'''

# This code is input data until Manim runs it INSIDE the owning container.
ISOLATION = '''from manim import Scene, Dot
from pathlib import Path
import os, socket
class Lesson(Scene):
    def construct(self):
        assert not Path(HOST_SENTINEL).exists()
        assert not Path(B_SENTINEL).exists()
        assert not Path('/var/run/docker.sock').exists()
        assert os.getuid() == 1000
        try:
            Path('/escape').write_text('bad')
        except OSError:
            pass
        else:
            raise AssertionError('Root filesystem writable')
        with socket.socket() as probe:
            probe.settimeout(1)
            assert probe.connect_ex((B_ADDRESS, 8765)) != 0
        self.add(Dot())
        self.wait(1)
'''
ESCAPE = '''from manim import Scene, Dot
from pathlib import Path
class Lesson(Scene):
    def construct(self):
        self.add(Dot())
        self.wait(1)
        # Replace the job root with a symlink before artifact lookup.
        root = Path.cwd()
        root.rename(root.with_name(root.name + '-escaped'))
        root.symlink_to('/tmp')
'''

MOCK_NODE = '''import { createServer } from 'node:http';
import { createDeliveryHandler } from './dist/delivery.js';
import { createPhotonDelivery } from './dist/photon.js';
let mode = 'accept'; let messageSequence = 0;
const deliver = createPhotonDelivery({
 user: async phone => { if (phone !== '+15550000001') throw Error('wrong recipient'); return phone; },
 space: {create: async () => ({send: async builder => {
   const content = await builder.build();
   if (content.type !== 'attachment' || content.mimeType !== 'video/mp4' || !(await content.read()).length) throw Error('invalid attachment');
   if (mode === 'reject') throw Error('substituted rejection');
   if (mode === 'noop') return undefined;
   return {id: 'offline-photon-acceptance-' + ++messageSequence};
 }})}
});
const handler = createDeliveryHandler({token: 'synthetic-only', maxVideoBytes: 12582912, deliver});
createServer((req,res) => {
 if (req.url === '/test-mode' && req.headers.authorization === 'Bearer synthetic-only') {
   mode = req.headers['x-test-mode']; res.end('{}'); return;
 }
 void handler(req,res);
}).listen(3001,'0.0.0.0');
'''


class FixtureRuntime(DockerRuntime):
    """Only Gemini code generation is substituted; the trusted worker does the rest."""
    code = SILENT
    barrier = None

    def command(self, handle, action, job, payload=None):
        if self.barrier and self.barrier[0] == action:
            self.barrier[1].set()
            if not self.barrier[2].wait(30):
                raise RuntimeError('Architecture barrier timed out')
        if action == 'generate':
            seed = '''import io, json, sys
sys.path.insert(0, '/opt')
import worker
payload = json.load(sys.stdin)
worker.gemini = lambda prompt, **kwargs: {'code': payload['code']}
sys.stdin = io.StringIO(json.dumps(payload['request']))
sys.argv = ['worker.py', 'generate', payload['job']]
print(json.dumps(worker.main()))
'''
            return json.loads(self._run('exec', '-i', handle, 'python', '-c', seed,
                data=json.dumps({'code': self.code, 'request': payload, 'job': str(job)}).encode()))
        return super().command(handle, action, job, payload)


@unittest.skipUnless(os.environ.get('RUN_ARCHITECTURE_TESTS') == '1', 'Requires disposable Docker acceptance run')
class ArchitectureTests(unittest.TestCase):
    headers = fixtures.BackendTests.headers
    submit = fixtures.BackendTests.submit
    status = fixtures.BackendTests.status
    renew_access = fixtures.BackendTests.renew_access

    def setUp(self):
        fixtures.BackendTests.setUp(self)
        self.addCleanup(fixtures.BackendTests.tearDown, self)
        self.runtime = FixtureRuntime()
        self.service.runtime = self.runtime
        self.addCleanup(self.remove_user_containers)
        self.messaging = 'btg-acceptance-messaging-' + uuid.uuid4().hex
        self.addCleanup(lambda: subprocess.run(['docker', 'rm', '-f', self.messaging], capture_output=True, check=True))
        subprocess.run(['docker','run','-d','--name',self.messaging,'--label','btg.acceptance=true',
            '--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--user=1000:1000',
            '--tmpfs=/tmp:rw,nosuid,nodev,size=64m,uid=1000,gid=1000','-p','127.0.0.1::3001',
            os.environ.get('MESSAGING_TEST_IMAGE','btg-acceptance-messaging'),
            'node','--input-type=module','-e',MOCK_NODE], check=True, capture_output=True)
        port = json.loads(self.runtime._run('inspect',self.messaging))[0]['NetworkSettings']['Ports']['3001/tcp'][0]['HostPort']
        self.url = 'http://127.0.0.1:'+port+'/video'
        # Wait on service readiness with a bounded HTTP probe; never credentials or messages.
        import time
        from urllib.error import HTTPError, URLError
        for attempt in range(100):
            try:
                urlopen(Request(self.url, data=b''), timeout=1)
            except HTTPError as error:
                self.assertEqual(error.code, 401)
                break
            except (URLError, ConnectionError):
                time.sleep(.05)
        else:
            raise RuntimeError('Disposable messaging server not ready')
        self.environment = patch.dict(os.environ, {'MESSAGING_URL': self.url, 'MESSAGING_TOKEN': 'synthetic-only'})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.dependencies.deliver = Integrations().deliver
        self.narration_approved = True
        def evaluate(intent, video, voiceover=False):
            self.dependencies.call('evaluate', intent, video)
            result = dict(accurate=True, defect_free=True, consistent=True, findings='',
                          narration_accurate=True, narration_intelligible=self.narration_approved,
                          narration_consistent=True)
            with patch('backend.integrations.gemini', return_value=result) as model:
                approved = Integrations().evaluate(intent, video, voiceover=voiceover)
                self.assertEqual(model.call_args.args[1], video)
                if voiceover:
                    self.assertIn('intelligibility', model.call_args.args[0])
                return approved
        self.dependencies.evaluate = evaluate

    def remove_user_containers(self):
        for owner in (self.a, self.b):
            if self.service.active[owner]:
                raise RuntimeError('Refusing to remove a container still protected by active work')
            name = 'btg-user-'+str(owner)
            # process() is synchronous except a test-owned thread, always joined before cleanup.
            subprocess.run(['docker','rm','-f',name], capture_output=True)
            subprocess.run(['docker','rm','-f',name+'-egress'], capture_output=True)
            subprocess.run(['docker','network','rm',name+'-network'], capture_output=True)

    def assert_clean(self, owner, job):
        handle = 'btg-user-'+str(owner)
        self.assertEqual(self.runtime._run('exec',handle,'sh','-c','test ! -e /work/'+str(job)), b'')

    def test_pipeline_voiceover_node_boundary_and_temporary_cleanup(self):
        for voiceover in (False, True):
            self.runtime.code = VOICEOVER if voiceover else SILENT
            job = self.submit(voiceover)
            self.assertEqual(self.status(job)['status'], 'accepted', self.status(job))
            self.assertTrue(self.status(job)['provider_message_id'].startswith('offline-photon-acceptance-'))
            self.assert_clean(self.a, job)
        before = len(self.dependencies.calls)
        self.runtime.code = SILENT
        self.assertEqual(self.status(self.submit(True))['status'], 'failed')
        self.assertFalse(any(call[0] == 'evaluate' for call in self.dependencies.calls[before:]))
        self.runtime.code = VOICEOVER
        self.narration_approved = False
        self.assertEqual(self.status(self.submit(True))['status'], 'failed')
        self.narration_approved = True
        self.runtime.code = SILENT
        for mode in ('reject', 'noop'):
            with urlopen(Request(self.url.replace('/video','/test-mode'), data=b'', headers={
                'Authorization':'Bearer synthetic-only','X-Test-Mode':mode})) as response:
                response.read()
            self.assertEqual(self.status(self.submit())['status'], 'delivery_unknown')
        self.assertEqual(self.service.active[self.a],0)

    def test_isolation_configuration_and_hostile_fixture(self):
        a, b = self.runtime.start(self.a), self.runtime.start(self.b)
        b_file = '/work/b-private-'+uuid.uuid4().hex
        self.runtime._run('exec',b,'sh','-c','echo private > '+b_file+'; python -m http.server 8765 >/tmp/server.log 2>&1 &')
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as directory:
            sentinel = Path(directory)/'host-sentinel'
            sentinel.write_text('private host bytes')
            address = next(iter(json.loads(self.runtime._run('inspect',b+'-egress'))[0]['NetworkSettings']['Networks'].values()))['IPAddress']
            self.runtime.code = 'HOST_SENTINEL='+repr(str(sentinel))+'\nB_SENTINEL='+repr(b_file)+'\nB_ADDRESS='+repr(address)+'\n'+ISOLATION
            self.assertEqual(self.status(self.submit())['status'],'accepted')
            self.assertEqual(sentinel.read_text(),'private host bytes')
        self.assertEqual(self.runtime._run('exec',b,'cat',b_file),b'private\n')
        for handle in (a,b):
            info = json.loads(self.runtime._run('inspect',handle))[0]
            config = info['HostConfig']
            self.assertTrue(config['ReadonlyRootfs'])
            self.assertEqual(info['Config']['User'],'1000:1000')
            self.assertIn('ALL',config['CapDrop'])
            self.assertIn('no-new-privileges',config['SecurityOpt'])
            self.assertEqual(config['PidsLimit'],128)
            self.assertEqual(config['Memory'],1024**3)
            self.assertEqual(config['NanoCpus'],10**9)
            self.assertFalse(config['Privileged'])
            self.assertFalse(config['Binds'])
            self.assertFalse(info['Mounts'])
            self.assertEqual(set(config['Tmpfs']),{'/work','/tmp'})
            self.assertTrue(config['NetworkMode'].startswith('container:'))
        self.assertNotEqual(json.loads(self.runtime._run('inspect',a))[0]['HostConfig']['NetworkMode'],
                            json.loads(self.runtime._run('inspect',b))[0]['HostConfig']['NetworkMode'])

    def test_active_job_polling_inactivity_restart_and_partial_cleanup(self):
        entered, release = threading.Event(), threading.Event()
        self.runtime.barrier = ('render',entered,release)
        job = self.service.submit(self.a,'isolated lesson')
        thread = threading.Thread(target=self.service.process,args=(self.a,job,False))
        thread.start()
        try:
            self.assertTrue(entered.wait(30))
            self.now += timedelta(minutes=26)
            self.renew_access()
            self.service.sweep()
            self.assertTrue(json.loads(self.runtime._run('inspect','btg-user-'+str(self.a)))[0]['State']['Running'])
            self.assertEqual(self.status(job)['status'],'rendering')
        finally:
            release.set()
            thread.join(360)
        self.assertFalse(thread.is_alive())
        self.runtime.barrier = None
        self.assert_clean(self.a,job)
        self.now += timedelta(minutes=24,seconds=59)
        self.service.sweep()
        self.assertTrue(json.loads(self.runtime._run('inspect','btg-user-'+str(self.a)))[0]['State']['Running'])
        self.now += timedelta(seconds=2)
        self.service.sweep()
        self.assertFalse(json.loads(self.runtime._run('inspect','btg-user-'+str(self.a)))[0]['State']['Running'])
        self.assertEqual(self.status(self.submit())['status'],'accepted')
        self.runtime.code = "raise RuntimeError('partial generated render failure')"
        failed = self.submit()
        self.assertEqual(self.status(failed)['status'],'failed')
        self.assert_clean(self.a,failed)

    def test_escaped_artifact_is_not_evaluated_or_delivered(self):
        self.runtime.code = ESCAPE
        job = self.submit()
        self.assertEqual(self.status(job)['status'],'failed')
        self.assertFalse(any(call[0] == 'evaluate' for call in self.dependencies.calls))
        self.assert_clean(self.a,job)
        # Directory moved by fixture is also ephemeral; stopping must erase every tmpfs byte.
        self.now += timedelta(minutes=26)
        self.service.sweep()
        handle = self.runtime.start(self.a)
        self.assertEqual(self.runtime._run('exec',handle,'sh','-c','test -z "$(ls -A /work)"'), b'')


    def test_enforced_egress_blocks_direct_connections_and_private_proxy_targets(self):
        handle = self.runtime.start(self.a)
        # Every executable fixture runs only inside the restricted user container.
        code = r"""import os, socket, urllib.request
assert os.getuid() == 1000
for host, port in [('127.0.0.1', 8000), ('172.17.0.1', 5432), ('1.1.1.1', 443), ('169.254.169.254', 80)]:
    with socket.socket() as probe:
        probe.settimeout(1)
        assert probe.connect_ex((host, port)) != 0, (host, port)
# Proxy remains reachable, but rejects unapproved hosts and IP literal/private targets.
for authority in ['postgres:5432', 'messaging:3001', '127.0.0.1:443', '169.254.169.254:443', 'example.com:443']:
    with socket.create_connection(('127.0.0.1', 3128), timeout=3) as probe:
        probe.sendall(('CONNECT ' + authority + ' HTTP/1.1\r\nHost: ' + authority + '\r\n\r\n').encode())
        assert b'403' in probe.recv(1024), authority
"""
        self.runtime._run('exec', handle, 'python', '-c', code)
        proxy = json.loads(self.runtime._run('inspect', handle + '-egress'))[0]
        self.assertNotIn('1000', proxy['Config'].get('User', ''))
        self.assertFalse(proxy['HostConfig']['Privileged'])
        self.assertEqual(proxy['HostConfig']['Binds'], None)
        self.assertTrue(proxy['HostConfig']['ReadonlyRootfs'])

    def test_actual_process_state_preserved_and_abandoned_tmpfs_cleaned_on_recovery(self):
        from backend.models import LessonJob, UserContainer
        from backend.service import Service
        from sqlalchemy import select
        import time
        handle = self.runtime.start(self.a)
        job = self.service.submit(self.a, 'interrupted topic')
        self.service.update(job, 'generating', cleanup_required=True)
        with self.sessions() as db:
            container = db.scalar(select(UserContainer).where(UserContainer.user_id == self.a))
            container.container_handle, container.status = handle, 'running'
            db.commit()
        self.runtime._run('exec', '-d', handle, 'python', '-c',
            "from pathlib import Path; import time; Path('/work/abandoned.mp4').write_bytes(b'temporary')\n"
            "while not Path('/tmp/recovery-release').exists(): time.sleep(.05)")
        try:
            deadline = time.monotonic() + 10
            while not self.runtime.state(self.a)['busy']:
                self.assertLess(time.monotonic(), deadline)
            recovered = Service(self.sessions, self.dependencies, self.runtime, lambda: self.now)
            self.service = recovered
            recovered.reconcile()
            self.assertEqual(recovered.status(self.a, job)['status'], 'generating')
            self.assertTrue(self.runtime.state(self.a)['running'])
        finally:
            # A timed sleep could finish while Docker/reconciliation was running.
            # Explicitly release this fixture before cleanup, including on failure.
            self.runtime._run('exec', handle, 'touch', '/tmp/recovery-release')
        deadline = time.monotonic() + 10
        while self.runtime.state(self.a)['busy']:
            self.assertLess(time.monotonic(), deadline)
            time.sleep(.1)
        recovered.sweep()
        self.assertEqual(recovered.status(self.a, job)['status'], 'interrupted')
        self.assertFalse(recovered.status(self.a, job)['cleanup_pending'])
        self.assertEqual(self.runtime._run('exec', handle, 'sh', '-c', 'test ! -e /work/abandoned.mp4'), b'')


    def test_actual_generated_process_cancellation_reaps_and_cleans(self):
        import time
        self.runtime.code = "from manim import Scene\nimport time\nclass Lesson(Scene):\n    def construct(self):\n        time.sleep(100)\n"
        job = self.service.submit(self.a, 'cancellation fixture')
        worker = threading.Thread(target=self.service.process, args=(self.a, job))
        worker.start()
        try:
            deadline = time.monotonic() + 20
            while self.service.status(self.a, job)['status'] != 'rendering' or not self.runtime.state(self.a)['busy']:
                self.assertLess(time.monotonic(), deadline)
                time.sleep(.05)
            result = self.client.post(f'/lessons/{job}/cancel', headers=self.headers())
            self.assertEqual(result.status_code, 202)
            worker.join(20)
            self.assertFalse(worker.is_alive())
            self.assertEqual(self.status(job)['status'], 'cancelled')
            self.assertFalse(self.status(job)['cleanup_pending'])
            self.assertFalse(self.runtime.state(self.a)['busy'])
            self.assert_clean(self.a, job)
        finally:
            # Finish this isolated test's process before removing its container.
            if worker.is_alive():
                self.runtime.command('btg-user-' + str(self.a), 'cancel', job)
                worker.join(20)
