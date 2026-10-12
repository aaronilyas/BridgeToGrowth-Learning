"""Single-command deployment lifecycle; Python stdlib only on Linux/macOS."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
import uuid

from .cloudflare import Cloudflare
from .settings import DEFAULTS, DeploymentError, load_env, validate
from .state import State

ROOT = Path(__file__).resolve().parents[1]
SERVICES = ('cloudflared', 'coordinator', 'messaging', 'postgres')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def probe(origin, path, expected, no_store=False, public=False):
    # Ignore host proxy env so local readiness checks reach the actual coordinator.
    opener = build_opener(NoRedirect(), ProxyHandler({}))
    try:
        response = opener.open(Request(origin + path), timeout=8)
    except HTTPError as error:
        response = error
    except (URLError, TimeoutError, OSError):
        return False
    with response:
        if response.code != expected:
            return False
        if no_store and response.headers.get('Cache-Control', '').lower() != 'no-store':
            return False
        if public and (response.headers.get('CF-Cache-Status', '').upper() not in ('DYNAMIC', 'BYPASS')
                       or response.headers.get('Age') is not None):
            return False
        if path == '/account':
            try:
                return json.load(response).get('detail') == 'Invalid or expired credentials'
            except (ValueError, AttributeError):
                return False
    return True


class Operator:
    def __init__(self, root=ROOT, runner=None, checker=probe):
        self.root, self.state = root, State(root)
        self.runner = runner or subprocess.run
        self.checker = checker
        self.local_ready = False
        self.public_ready = False
        self.stage = 'configuration'
        self.env = {key: value for key, value in os.environ.items() if key not in DEFAULTS}
        self.compose = []

    def command(self, args, operation, timeout=180):
        try:
            result = self.runner(args, cwd=self.root, env=self.env, capture_output=True, text=True, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired):
            raise DeploymentError(f'{operation} could not complete; check Docker connectivity and retry.') from None
        if result.returncode:
            # Neither command output nor its exception is safe to echo: Compose errors can include interpolated secrets.
            raise DeploymentError(f'{operation} failed. Inspect the relevant service status/logs using compose.md; saved data and ownership state are preserved.')
        return result.stdout

    def containers(self):
        ids = self.command(['docker','ps','-aq','--filter','label=com.docker.compose.project=btg-learning'], 'Project discovery').split()
        if not ids:
            return {}
        inspected = json.loads(self.command(['docker', 'inspect', *ids], 'Project ownership inspection'))
        services = {}
        for info in inspected:
            labels = info['Config'].get('Labels') or {}
            service = labels.get('com.docker.compose.service')
            if (service not in SERVICES or labels.get('io.btg.deployment') != self.state.data['deployment_id']
                    or Path(labels.get('com.docker.compose.project.working_dir', '/')).resolve() != self.root.resolve()
                    or service in services):
                raise DeploymentError('Existing Compose project ownership cannot be established. Restore its .local/backend state or drain/migrate the legacy deployment; no containers were adopted.')
            services[service] = info
        return services

    def stop_service(self, name, containers):
        info = containers.get(name)
        if info and info['State']['Running']:
            print(f'Stopping {name}; waiting without a force-kill deadline.', flush=True)
            self.command(['docker', 'stop', '--time=-1', info['Id']], f'Graceful {name} stop', timeout=None)

    def prerequisites(self):
        if not shutil.which('docker'):
            raise DeploymentError('Docker and the Docker Compose plugin are required. Install/start Docker Desktop or Docker Engine with Compose v2.')
        self.command(['docker', 'compose', 'version'], 'Docker Compose v2 check')
        self.command(['docker', 'info'], 'Docker daemon check')

    def start(self, local_only=False):
        values = load_env(self.root / '.env')
        enabled = validate(values, local_only)
        managed = enabled and values['CLOUDFLARE_TUNNEL_MODE'] == 'managed'
        if not enabled:
            values['API_PORT'] = values['LOCAL_API_PORT']
        # Do not let inherited shell variables override the one configured root file.
        for key in values:
            self.env.pop(key, None)
        for key in ('COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', 'COMPOSE_PROFILES', 'COMPOSE_ENV_FILES', 'BTG_DEPLOYMENT_ID'):
            self.env.pop(key, None)
        values['BTG_DEPLOYMENT_ID'] = self.state.data['deployment_id']
        normalized = '\n'.join(key + "='" + value.replace("'", "\\'") + "'" for key, value in values.items()) + '\n'
        self.state.write('compose.env', normalized)
        self.state.save()
        self.prerequisites()
        existing = self.containers()
        # Prevent previous public activation continuing after failed safety checks or --local-only.
        self.stop_service('cloudflared', existing)
        self.stage = 'port and Compose validation'
        if not existing.get('coordinator', {}).get('State', {}).get('Running'):
            with socket.socket() as test:
                # Closed accepted connections can leave TIME_WAIT after graceful
                # drain. Match normal listener reuse without allowing an active listener.
                test.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                try:
                    test.bind(('127.0.0.1', int(values['API_PORT'])))
                except OSError:
                    raise DeploymentError('Requested loopback port is already in use; stop its owner or choose another LOCAL_API_PORT for staging.') from None
        self.compose = ['docker','compose','--project-directory',str(self.root),'--env-file',str(self.state.directory / 'compose.env'), '-f', str(self.root / 'compose.yaml')]
        if managed:
            self.compose += ['-f', str(self.root / 'compose.cloudflare.yaml')]
        self.command([*self.compose,'config','--quiet'], 'Compose validation')
        expanded = json.loads(self.command([*self.compose,'config','--format','json'], 'Compose configuration inspection'))
        for name, info in existing.items():
            if name == 'cloudflared' or not info['State']['Running']:
                continue
            if name == 'coordinator':
                bindings = info.get('HostConfig', {}).get('PortBindings', {}).get('8000/tcp', [])
                if bindings != [{'HostIp': '127.0.0.1', 'HostPort': values['API_PORT']}]:
                    raise DeploymentError('Running coordinator port differs from requested mode. Run ./stop-backend.sh before changing public/private modes.')
            configured = expanded['services'][name].get('environment', {})
            current = dict(value.split('=',1) for value in info['Config'].get('Env',[]) if '=' in value)
            if any(str(value) != current.get(key) for key, value in configured.items()):
                raise DeploymentError(f'Running {name} configuration differs from .env. Run ./stop-backend.sh before restarting with changed settings; database password changes require explicit SQL rotation.')
        cf = None
        if enabled:
            self.stage = 'public routing/cache prerequisites'
            print('Verifying full-hostname ingress, DNS and edge policy before new origin startup.', flush=True)
            cf = Cloudflare(values, self.state)
            try:
                if managed:
                    cf.provision()
                else:
                    cf.inspect_external()
            except Exception:
                # An already-running owned coordinator must also fail closed.
                # Drain; never touch an external host connector or unrelated process.
                self.stop_service('coordinator', existing)
                raise
        self.stage = 'image builds'
        print('Building renderer, restricted egress, messaging and coordinator images.', flush=True)
        for dockerfile, key in [('deployment/egress/Dockerfile','RENDERER_EGRESS_IMAGE'), ('backend/container/Dockerfile','USER_CONTAINER_IMAGE')]:
            self.command(['docker','build','-f',dockerfile,'-t',values[key],'.'], 'Isolated runtime image build', timeout=1800)
        self.command([*self.compose,'build','messaging','coordinator'], 'Backend image build', timeout=1800)
        running = any(existing.get(name, {}).get('State', {}).get('Running') for name in ('coordinator','messaging','postgres'))
        reuse = ['--no-recreate'] if running else []
        self.stage = 'database and messaging readiness'
        self.command([*self.compose,'up','-d','--wait','--wait-timeout','180',*reuse,'postgres','messaging'], 'Database/messaging health checks', timeout=240)
        self.stage = 'database schema compatibility'
        # Read-only preflight in a disposable one-off coordinator. No migration writes.
        self.command([*self.compose,'run','--rm','--no-deps','-T','coordinator','python','-m','backend.check_schema'],
                     'Database schema check (apply documented offline migrations in compose.md if incompatible)', timeout=90)
        if enabled and not managed:
            self.stage = 'final external prerequisites before origin exposure'
            cf.inspect_external()  # Recheck after long image builds/dependency startup.
        self.stage = 'coordinator readiness'
        self.command([*self.compose,'up','-d','--wait','--wait-timeout','180',*reuse,'coordinator'], 'Coordinator health checks', timeout=240)
        origin = 'http://127.0.0.1:' + values['API_PORT']
        if not self.checker(origin, '/healthz', 200) or not self.checker(origin, '/account', 401, True):
            raise DeploymentError('Local API readiness/authentication check failed; public activation stopped.')
        self.local_ready = True
        if enabled:
            self.stage = 'connector/public HTTPS readiness'
            # Recreate just connector to reopen an atomically rotated token bind inode.
            if managed:
                self.command([*self.compose,'up','-d','--no-deps','--force-recreate','cloudflared'], 'Cloudflare connector startup')
            deadline = time.monotonic() + 180
            public = 'https://' + values['CLOUDFLARE_HOSTNAME']
            while True:
                if cf.connected() and self.checker(public, '/account', 401, True, True):
                    break
                if time.monotonic() >= deadline:
                    raise DeploymentError('Public readiness failed (DNS/TLS/tunnel/cache/authentication). Check tunnel logs, DNS, WAF/Access policies and outbound connectivity; local backend remains available.')
                time.sleep(3)
            for path in ('/lessons/' + str(uuid.UUID(int=0)),):
                if not self.checker(public, path, 401, True, True):
                    raise DeploymentError('Public lesson bearer protection or cache policy check failed.')
            for path in ('/internal/receipts','/video','/verification','/docs','/redoc','/openapi.json','/healthz','/docker'):
                if not self.checker(public, path, 404):
                    raise DeploymentError('Public private-route rejection check failed; owned backend will drain. External connector remains untouched.')
            self.public_ready = True
        print('Backend: healthy | Database: healthy | Messaging: healthy')
        print('Public HTTPS readiness: ' + ('passed' if self.public_ready else 'not checked (private staging)'))
        print('Connector: ' + ('owned Compose connector, healthy' if managed else
                               'externally managed; API reports healthy' if enabled else
                               'external status unknown; existing port-8000 route untouched'))
        print('Local API: ' + origin)
        if enabled:
            print('Public API: https://' + values['CLOUDFLARE_HOSTNAME'])
        print('Warnings: auth IP throttling shares connector addresses; no forwarded headers are trusted.')
        if running:
            print('Warnings: reused running services; stop then start to apply newly built images.')

    def stop(self):
        self.stage = 'shutdown'
        # No credential requirement: Docker labels + saved deployment IDs establish ownership.
        if (self.root / '.env').is_file():
            try:
                load_env(self.root / '.env')
            except DeploymentError:
                print('Warning: invalid .env; shutdown uses recorded ownership state only.')
        self.prerequisites()
        containers = self.containers()
        for name in SERVICES:
            self.stop_service(name, containers)
        remaining = self.containers()
        if any(info['State']['Running'] for info in remaining.values()):
            raise DeploymentError('Shutdown incomplete; retry ./stop-backend.sh. Persistent data preserved.')
        print('Owned backend services and any owned Compose connector stopped. External host connector untouched (status unknown). Volumes, receipt metadata, tunnel, DNS and credentials preserved.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('start', 'stop'))
    parser.add_argument('--local-only', action='store_true')
    args = parser.parse_args()
    operator = None
    try:
        operator = Operator()
        lock_path = operator.state.directory / 'operator.lock'
        if lock_path.is_symlink():
            raise DeploymentError('Refusing symlink operator lock.')
        with open(lock_path, 'a') as lock:
            os.chmod(lock_path, 0o600)
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise DeploymentError('Another start/stop is running; wait for it to finish.') from None
            operator.state = State(operator.root)  # Reload after lock acquisition.
            if args.action == 'start':
                operator.start(args.local_only)
            else:
                operator.stop()
    except (DeploymentError, KeyboardInterrupt, ValueError, KeyError, OSError):
        error = sys.exc_info()[1]
        if isinstance(error, DeploymentError):
            print(str(error), file=sys.stderr)
        else:
            print('Deployment interrupted or invalid/unavailable state; inspect configuration and restore state as described in compose.md.', file=sys.stderr)
        if operator:
            if args.action == 'start' and not operator.public_ready:
                try:
                    owned = operator.containers()
                    operator.stop_service('cloudflared', owned)
                    operator.stop_service('coordinator', owned)
                    operator.local_ready = False
                except DeploymentError:
                    print('Owned ingress/backend stop could not be confirmed; retry ./stop-backend.sh. External connector was not stopped.', file=sys.stderr)
            print(f'Failed step: {operator.stage}. Local readiness: {operator.local_ready}; public readiness: {operator.public_ready}.', file=sys.stderr)
        print('Partial services may remain running. Safe recovery: ./stop-backend.sh; correct the error; ./start-backend.sh. No volumes or remote resources were removed.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
