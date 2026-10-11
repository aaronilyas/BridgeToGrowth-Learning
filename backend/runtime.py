"""Generated Python executes only in user containers behind a trusted egress namespace."""
import json
import os
import subprocess
import time
import tempfile
import uuid
from .integrations import gemini_policy


class DockerRuntime:
    def _run(self, *args, data=None):
        result = subprocess.run(['docker', *args], input=data, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, check=True, timeout=420)
        return result.stdout

    def inspect(self, name):
        try:
            return json.loads(self._run('inspect', name))[0]
        except subprocess.CalledProcessError:
            # Distinguish absence from daemon failure; failure must retain protection.
            names = self._run('ps', '-a', '--format', '{{.Names}}').decode().splitlines()
            if name in names:
                raise
            return None

    def state(self, user_id):
        name = f'btg-user-{uuid.UUID(str(user_id))}'
        info = self.inspect(name)
        if info is None:
            self.stop_idle_egress(user_id)
            return {'handle': None, 'running': False, 'busy': False}
        if info['Config']['Labels'].get('btg.user') != str(user_id):
            raise RuntimeError('Container ownership mismatch')
        running = info['State']['Running']
        if not running:
            self.stop_idle_egress(user_id)
        busy = self.command(name, 'state', uuid.UUID(int=0))['busy'] if running else False
        return {'handle': name, 'running': running, 'busy': busy}

    def stop_idle_egress(self, user_id):
        egress = f'btg-user-{uuid.UUID(str(user_id))}-egress'
        info = self.inspect(egress)
        if info:
            if info['Config']['Labels'].get('btg.egress.user') != str(user_id):
                raise RuntimeError('Egress ownership mismatch')
            if info['State']['Running']:
                self._run('stop', egress)

    def start(self, user_id):
        name = f'btg-user-{uuid.UUID(str(user_id))}'
        network = name + '-network'
        egress = name + '-egress'
        try:
            self._run('network', 'inspect', network)
        except subprocess.CalledProcessError:
            self._run('network', 'create', '--label', 'btg.user=' + str(user_id), network)
        proxy = self.inspect(egress)
        if proxy is None:
            self._run('create', '--network', network, '--name', egress, '--label', 'btg.egress.user=' + str(user_id),
                      '--read-only', '--cap-drop=ALL', '--cap-add=NET_ADMIN', '--cap-add=SETUID', '--cap-add=SETGID', '--cap-add=SETPCAP',
                      '--security-opt=no-new-privileges', '--memory=128m', '--pids-limit=64',
                      '--tmpfs=/tmp:rw,nosuid,nodev,size=32m',
                      os.environ.get('RENDERER_EGRESS_IMAGE', 'btg-egress:local'))
        elif proxy['Config']['Labels'].get('btg.egress.user') != str(user_id):
            raise RuntimeError('Egress ownership mismatch')
        if not proxy or not proxy['State']['Running']:
            self._run('start', egress)
        # Do not start generated work until proxy and namespace rules are ready.
        for _ in range(50):
            try:
                self._run('exec', egress, 'sh', '-c', 'test -s /tmp/squid.pid')
                break
            except subprocess.CalledProcessError:
                if not self.inspect(egress)['State']['Running']:
                    raise RuntimeError('Renderer egress failed to start') from None
                time.sleep(.1)
        else:
            raise RuntimeError('Renderer egress readiness timed out')
        info = self.inspect(name)
        if info is None:
            self._run('create', '--network', 'container:' + egress, '--name', name, '--label', 'btg.user=' + str(user_id),
                      '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
                      '--pids-limit=128', '--memory=1g', '--cpus=1', '--user=1000:1000',
                      '--env=HTTPS_PROXY=http://127.0.0.1:3128', '--env=HTTP_PROXY=http://127.0.0.1:3128', '--env=NO_PROXY=',
                      '--tmpfs=/work:rw,nosuid,nodev,size=512m,uid=1000,gid=1000',
                      '--tmpfs=/tmp:rw,nosuid,nodev,size=128m,uid=1000,gid=1000',
                      os.environ.get('USER_CONTAINER_IMAGE', 'btg-renderer:local'))
        elif info['Config']['Labels'].get('btg.user') != str(user_id):
            raise RuntimeError('Container ownership mismatch')
        elif info['HostConfig']['NetworkMode'] != 'container:' + self.inspect(egress)['Id'] and info['HostConfig']['NetworkMode'] != 'container:' + egress:
            # Old unrestricted containers must be retired during migration, never reused.
            raise RuntimeError('Legacy renderer network must be removed before enrollment')
        if not info or not info['State']['Running']:
            self._run('start', name)
        return name

    def command(self, handle, action, job_id, payload=None):
        if not handle.startswith('btg-user-'):
            raise ValueError('Invalid user container handle')
        args = ['exec', '-i']
        if action == 'generate':
            models, _ = gemini_policy('code')
            args += ['-e', 'GEMINI_API_KEY', '-e', 'GEMINI_CODE_MODELS=' + ','.join(models)]
        try:
            output = self._run(*args, handle, 'python', '/opt/worker.py', action, str(job_id),
                               data=json.dumps(payload or {}).encode())
        except subprocess.CalledProcessError as error:
            # Private, bounded stderr in coordinator tmpfs, surviving job cleanup.
            # Never record stdout: the video action returns video bytes there.
            if action in ('generate', 'render') and error.stderr:
                try:
                    with tempfile.NamedTemporaryFile(prefix=f'btg-{uuid.UUID(str(job_id))}-{action}-',
                                                     suffix='.log', dir='/tmp', delete=False) as diagnostic:
                        diagnostic.write(error.stderr[-65536:])
                except OSError:
                    pass  # Diagnostics must never interfere with job cleanup.
            raise
        return output if action == 'video' else json.loads(output)

    def stop(self, handle):
        self._run('stop', handle)
        self._run('stop', handle + '-egress')
