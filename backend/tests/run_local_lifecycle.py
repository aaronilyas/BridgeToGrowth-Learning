"""Real operator start/stop/restart in a temporary checkout/project with substitutes.

Uses built acceptance images, a private free port, unique volumes, no SDK/API
connections and no host Docker socket in the test coordinator. No credential
files or production databases are read. Only this unique test project is removed.
"""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from urllib.request import Request, urlopen
import uuid

from deployment.operator import Operator

ROOT = Path(__file__).resolve().parents[2]
COORDINATOR = '''
from backend.main import create_app
from backend.database import SessionLocal
from backend.models import User, UserContainer
from backend.auth import PASSWORDS
class Providers:
    def assess(self, intent):
        if intent == 'drain active':
            from pathlib import Path
            import time
            while not Path('/fixtures/release').exists(): time.sleep(.05)
        return {'seconds': 90, 'feedback': ''}
    def evaluate(self, *args, **kw): return {'approved': True}
    def deliver(self, job, phone, video): return 'substitute-' + str(job)
    def verification(self, *args): raise AssertionError('No verification dispatch in lifecycle exercise')
class Runtime:
    def state(self, owner): return {'running': False, 'busy': False, 'handle': None}
    def start(self, owner): return 'fixture-runtime'
    def command(self, handle, action, job, payload=None):
        if action == 'render': return {'seconds': 10, 'has_audio': True}
        if action == 'video': return b'disposable-fixture'
        return {}
    def remove(self, owner): pass
with SessionLocal() as db:
    if not db.query(User).first():
        user = User(phone_number='+15550009999', password_hash=PASSWORDS.hash('disposable lifecycle password'))
        from datetime import datetime, timezone
        user.phone_verified_at = datetime.now(timezone.utc)
        db.add(user)
        db.flush()
        db.add(UserContainer(user_id=user.id))
        db.commit()
app = create_app()
app.state.service.integrations = Providers()
app.state.service.runtime = Runtime()
'''
MESSAGING = '''
import {createServer} from 'node:http';
import {createDeliveryHandler} from '/app/dist/delivery.js';
const server=createServer(createDeliveryHandler({token:process.env.MESSAGING_TOKEN,
 maxVideoBytes:12582912,deliver:async()=> 'disposable-provider-id',verification:async()=> 'disposable-code-id'}));
server.listen(3001,'0.0.0.0');
process.on('SIGTERM',()=>server.close());
'''


def main():
    project = 'btg-lifecycle-' + uuid.uuid4().hex[:12]
    with tempfile.TemporaryDirectory(prefix='btg-lifecycle-') as directory:
        root = Path(directory)
        for file in ('compose.yaml',): shutil.copy(ROOT/file, root/file)
        (root/'backend').mkdir()
        shutil.copy(ROOT/'backend/schema.sql',root/'backend/schema.sql')
        (root/'gates').mkdir()
        (root/'fixture.py').write_text(COORDINATOR)
        (root/'messaging.mjs').write_text(MESSAGING)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0))
            port = str(sock.getsockname()[1])
        assert port != '8000'
        values = dict(POSTGRES_PASSWORD='abcdef0123456789abcdef0123456789',
                      AUTH_CODE_SECRET='0123456789abcdef-auth-'*3, RECEIPT_SECRET='0123456789abcdef-receipt-'*3,
                      MESSAGING_TOKEN='0123456789abcdef-messaging-'*3, PROJECT_ID='substitute',
                      PROJECT_SECRET='substitute', GEMINI_API_KEY='substitute', LOCAL_API_PORT=port)
        (root/'.env').write_text('\n'.join(key+'='+value for key,value in values.items()))
        os.chmod(root/'.env',0o600)
        override_path = root/'substitutes.yaml'
        override_path.write_text('services:\n  coordinator:\n    image: btg-acceptance-coordinator\n'
            '    command: [uvicorn, fixture:app, --host, 0.0.0.0, --port, "8000", --workers, "1", --no-proxy-headers]\n'
            '    volumes: !override\n      - type: bind\n        source: '+str(root/'fixture.py')+'\n        target: /app/fixture.py\n        read_only: true\n'
            '      - type: bind\n        source: '+str(root/'gates')+'\n        target: /fixtures\n        read_only: true\n'
            '    environment:\n      DOCKER_HOST: unix:///nonexistent-test-socket\n'
            '  messaging:\n    image: btg-acceptance-messaging\n    command: [node, /app/messaging.mjs]\n'
            '    volumes:\n      - type: bind\n        source: '+str(root/'messaging.mjs')+'\n        target: /app/messaging.mjs\n        read_only: true\n')
        def runner(command, **kwargs):
            command = list(command)
            if command[:2] == ['docker','build'] or ('compose' in command and 'build' in command):
                # The documented acceptance build creates the exact current code images.
                return subprocess.CompletedProcess(command,0,stdout='',stderr='')
            if command[:3] == ['docker','ps','-aq']:
                command[-1] = 'label=com.docker.compose.project='+project
            if command[:2] == ['docker','compose'] and str(root/'compose.yaml') in command:
                command[2:2] = ['-p',project]
                position = command.index(str(root/'compose.yaml'))+1
                command[position:position] = ['-f',str(override_path)]
            return subprocess.run(command, **kwargs)
        operator = Operator(root,runner)
        try:
            operator.start(local_only=True)
            origin = 'http://127.0.0.1:'+port
            def post(path, payload, token=None):
                headers={'Content-Type':'application/json'}
                if token: headers['Authorization']='Bearer '+token
                with urlopen(Request(origin+path, json.dumps(payload).encode(), headers),timeout=10) as response:
                    return json.load(response)
            session = post('/auth/login',{'phone_number':'+15550009999','password':'disposable lifecycle password'})
            lesson = post('/lessons',{'topic':'disposable substitute lesson'},session['access_token'])
            messaging_id = operator.containers()['messaging']['Id']
            subprocess.run(['docker','exec',messaging_id,'node','-e',
                            "require('node:fs').writeFileSync('/receipts/preservation-marker.json','synthetic-receipt-metadata',{mode:0o600})"],
                           capture_output=True,check=True)
            operator.start(local_only=True)  # running reuse
            active = post('/lessons',{'topic':'drain active'},session['access_token'])
            stopped = threading.Event()
            errors = []
            def stop_active():
                try: operator.stop()
                except Exception as error: errors.append(error)
                finally: stopped.set()
            stopper = threading.Thread(target=stop_active)
            stopper.start()
            try:
                time.sleep(.5)
                assert not stopped.is_set(), 'Active work was not drained'
                during = operator.containers()
                assert during['messaging']['State']['Running'] and during['postgres']['State']['Running']
            finally:
                (root/'gates/release').touch()
                stopper.join(30)
            assert stopped.is_set() and not errors, errors
            operator.stop()
            operator.start(local_only=True)
            with urlopen(Request(origin+'/lessons/'+lesson['id'],headers={'Authorization':'Bearer '+session['access_token']}),timeout=10) as response:
                result=json.load(response)
                assert result['status']=='accepted',result
            with urlopen(Request(origin+'/lessons/'+active['id'],headers={'Authorization':'Bearer '+session['access_token']}),timeout=10) as response:
                assert json.load(response)['status']=='accepted', 'Drain lost active acceptance'
            containers=operator.containers()
            retained = subprocess.check_output(['docker','exec',containers['messaging']['Id'],'node','-e',
                                               "process.stdout.write(require('node:fs').readFileSync('/receipts/preservation-marker.json','utf8'))"])
            assert retained == b'synthetic-receipt-metadata', retained
            bindings=containers['coordinator']['HostConfig']['PortBindings']['8000/tcp']
            assert bindings == [{'HostIp':'127.0.0.1','HostPort':port}], bindings
            assert all(not containers[name]['HostConfig']['PortBindings'] for name in ('postgres','messaging'))
            assert not any(mount.get('Source','').endswith('docker.sock') for mount in containers['coordinator']['Mounts'])
            operator.stop()
            assert len(subprocess.check_output(['docker','volume','ls','-q','--filter','label=com.docker.compose.project='+project]).split())==2
            print('PASS: private start, running reuse, active-work drain before dependencies, repeated stop, restart; account/session/job, receipt metadata and both volumes preserved; no host socket or connector.')
        finally:
            # Only disposable test resources after operator drain, never production volumes.
            operator.stop()
            subprocess.run(['docker','compose','-p',project,'--env-file',str(root/'.local/backend/compose.env'),
                            '-f',str(root/'compose.yaml'),'-f',str(override_path),'down','-v'],capture_output=True,check=True)
    return 0


if __name__=='__main__':
    raise SystemExit(main())
