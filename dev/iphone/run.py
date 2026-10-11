#!/usr/bin/env python3
"""Project-local setup/service helpers; device settings and artifacts are ignored."""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
LOCAL = ROOT / '.local/iphone-testing'
TOOLS = HERE / 'tools/node_modules/.bin'
ENV = dict(os.environ)
NODE_BIN = Path('/opt/homebrew/opt/node@22/bin')
if NODE_BIN.exists():
    ENV['PATH'] = str(NODE_BIN) + ':' + ENV['PATH']
ENV['APPIUM_HOME'] = str(LOCAL / 'appium-home')
ENV['EXPO_NO_TELEMETRY'] = '1'
ENV['BTG_IPHONE_DEV'] = '1'


def run(args, cwd=ROOT):
    return subprocess.run([str(x) for x in args], cwd=cwd, env=ENV, check=True)


def capture(args):
    return subprocess.check_output(args, text=True, env=ENV).strip()


def settings():
    file = LOCAL / 'settings.json'
    if not file.exists():
        raise RuntimeError('Run configure first.')
    return json.loads(file.read_text())


def save(file, data):
    file.write_text(json.dumps(data, indent=2) + '\n')
    file.chmod(0o600)


def probe(url, expected=200):
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            code = r.status
    except urllib.error.HTTPError as e:
        code = e.code
    except urllib.error.URLError:
        return False
    return code == expected


def configure():
    route = capture(['/sbin/route', '-n', 'get', 'default'])
    interface = next(line.split(':', 1)[1].strip() for line in route.splitlines() if 'interface:' in line)
    address = capture(['/usr/sbin/ipconfig', 'getifaddr', interface])
    mask = capture(['/usr/sbin/ipconfig', 'getoption', interface, 'subnet_mask'])
    network = ipaddress.ip_network(f'{address}/{mask}', strict=False)
    if network.prefixlen < 24:
        raise RuntimeError('Specify a trusted /24 or narrower network manually in local settings.')
    current = settings() if (LOCAL / 'settings.json').exists() else {}
    api_port = 8000
    for line in (ROOT / '.env').read_text().splitlines():
        if line.startswith('API_PORT='):
            api_port = int(line.split('=', 1)[1].strip().strip('"\''))
    current.update({'interface': interface, 'lan_ip': address, 'trusted_cidr': str(network), 'api_port': api_port, 'forward_port': 8765, 'metro_port': 8081, 'appium_port': 4723})
    save(LOCAL / 'settings.json', current)
    origin = f'http://{address}:8765'
    file = ROOT / 'frontend/.env'
    previous = file.read_text() if file.exists() else ''
    if file.exists() and not (LOCAL / 'frontend.env.before').exists():
        (LOCAL / 'frontend.env.before').write_text(previous)
        (LOCAL / 'frontend.env.before').chmod(0o600)
    lines = [line for line in previous.splitlines() if not line.startswith('EXPO_PUBLIC_API_BASE_URL=')]
    file.write_text('\n'.join(lines + ['EXPO_PUBLIC_API_BASE_URL=' + origin]) + '\n')
    file.chmod(0o600)
    print(f'API origin: {origin}; interface {interface}; trusted network {network}')


def owned_pid(name):
    file = LOCAL / f'{name}.pid'
    if not file.exists():
        return None
    pid = int(file.read_text())
    try:
        os.kill(pid, 0)
        command = capture(['/bin/ps', '-p', str(pid), '-o', 'command='])
        markers = {'forward': str(HERE / 'api-forward.py'), 'metro': str(ROOT / 'frontend/node_modules/expo/bin/cli') + ' start', 'appium': str(TOOLS / 'appium')}
        if os.getpgid(pid) != pid or markers[name] not in command:
            raise RuntimeError(f'{name} PID belongs to a different process; refusing to signal it.')
        return pid
    except ProcessLookupError:
        return None
    except subprocess.CalledProcessError:
        return None


def start(name):
    if owned_pid(name):
        print(f'{name} already running')
        return
    c = settings()
    if name == 'forward':
        args = [sys.executable, '-u', str(HERE / 'api-forward.py'), '--bind', c['lan_ip'], '--trusted-cidr', c['trusted_cidr'], '--port', str(c['forward_port']), '--upstream-port', str(c['api_port'])]
        cwd, url = ROOT, f"http://{c['lan_ip']}:{c['forward_port']}/__btg_readiness"
    elif name == 'metro':
        args = ['node', str(ROOT / 'frontend/node_modules/expo/bin/cli'), 'start', '--host', 'lan', '--port', str(c['metro_port'])]
        cwd, url = ROOT / 'frontend', f"http://127.0.0.1:{c['metro_port']}/status"
        ENV['REACT_NATIVE_PACKAGER_HOSTNAME'] = c['lan_ip']
    else:
        listed = subprocess.run([str(TOOLS / 'appium'), 'driver', 'list', '--installed', '--json'], cwd=HERE / 'tools', env=ENV, capture_output=True, text=True, check=True)
        if 'xcuitest' not in json.loads(listed.stdout):
            run([TOOLS / 'appium', 'driver', 'install', '--source=local', HERE / 'tools/node_modules/appium-xcuitest-driver'], HERE / 'tools')
        # HTTP info/debug logs can contain future test input/passwords. Keep them off.
        args = [str(TOOLS / 'appium'), '--address', '127.0.0.1', '--port', str(c['appium_port']), '--log-level', 'warn', '--log-no-colors']
        # Appium discovers the npm-installed driver in this separate tools package.
        cwd, url = HERE / 'tools', f"http://127.0.0.1:{c['appium_port']}/status"
    if probe(url):
        raise RuntimeError(f'{name} endpoint is occupied by an unowned service; refusing to duplicate it.')
    with (LOCAL / f'{name}.log').open('a') as log:
        (LOCAL / f'{name}.log').chmod(0o600)
        process = subprocess.Popen(args, cwd=cwd, env=ENV, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    (LOCAL / f'{name}.pid').write_text(str(process.pid))
    for _ in range(30):
        if process.poll() is not None:
            raise RuntimeError(f'{name} exited; inspect its private local log.')
        try:
            if probe(url):
                print(f'{name} ready: {url}')
                return
        except OSError:
            pass
        time.sleep(1)
    raise RuntimeError(f'{name} did not become ready within 30 seconds; inspect its local log.')


def backend_health():
    run(['docker', 'compose', '--env-file', os.environ.get('ENV_FILE', str(ROOT / '.env')), 'config', '--quiet'])
    run(['docker', 'compose', '--env-file', os.environ.get('ENV_FILE', str(ROOT / '.env')), 'ps', '--format', '{{.Name}} {{.State}} {{.Health}}'])
    if not probe(f"http://127.0.0.1:{settings()['api_port']}/openapi.json"):
        raise RuntimeError('FastAPI is unavailable.')
    print('FastAPI loopback health verified (no provider requests).')


def build(existing=False):
    c = settings()
    if not c.get('team_id') or not c.get('udid'):
        raise RuntimeError('Set team_id and udid in ignored settings.json after verifying signing readiness.')
    ENV['BTG_APPLE_TEAM_ID'] = c['team_id']
    args = ['node', 'node_modules/expo/bin/cli', 'run:ios', '--device', c['udid'], '--no-bundler']
    if existing:
        binary = LOCAL / 'app-build/Build/Products/Debug-iphoneos/BridgeToGrowth.app'
        if not binary.exists():
            raise RuntimeError('No previously built signed app is available; use build-install.')
        args += ['--binary', str(binary), '--no-install']
    run(args, ROOT / 'frontend')
    run(['xcrun', 'devicectl', 'device', 'process', 'launch', '--device', c['udid'], 'com.bridgetogrowth.learning'])


def wda_build():
    c = settings()
    if not c.get('team_id') or not c.get('udid') or not c.get('wda_bundle_id'):
        raise RuntimeError('Local device/team/WDA signing settings are required.')
    project = HERE / 'tools/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent/WebDriverAgent.xcodeproj'
    args = ['xcodebuild', '-project', str(project), '-scheme', 'WebDriverAgentRunner', '-destination', 'id=' + c['udid'], '-derivedDataPath', str(LOCAL / 'wda-build'), 'DEVELOPMENT_TEAM=' + c['team_id'], 'PRODUCT_BUNDLE_IDENTIFIER=' + c['wda_bundle_id'], 'CODE_SIGN_STYLE=Automatic', 'CODE_SIGN_IDENTITY=Apple Development', 'build-for-testing']
    if c.get('development_provisioning_authorized'):
        args.insert(1, '-allowProvisioningUpdates')
    with (LOCAL / 'wda-build.log').open('w') as log:
        (LOCAL / 'wda-build.log').chmod(0o600)
        result = subprocess.run(args, cwd=ROOT, env=ENV, stdout=log, stderr=log)
    if result.returncode:
        raise RuntimeError('WDA build failed; inspect ignored wda-build.log for the signing/build blocker.')
    print('Signed physical-device WebDriverAgent build succeeded.')


def stop():
    # Only these owned test services. Never stop Docker, backend or user containers.
    for name in ('appium', 'metro', 'forward'):
        pid = owned_pid(name)
        if pid:
            os.killpg(pid, signal.SIGTERM)
            print(f'Sent graceful stop to owned {name} process group.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['configure', 'backend-start', 'backend-health', 'forward-start', 'metro-start', 'appium-start', 'build-install', 'install-launch', 'relaunch', 'wda-build', 'readiness', 'stop'])
    args = parser.parse_args()
    LOCAL.mkdir(parents=True, exist_ok=True)
    LOCAL.chmod(0o700)
    try:
        if args.command == 'configure':
            configure()
        elif args.command == 'backend-start':
            # Existing healthy services remain untouched; explicit repository script handles missing services/images.
            if probe(f"http://127.0.0.1:{settings()['api_port']}/openapi.json"):
                backend_health()
            else:
                run(['bash', ROOT / 'start-backend.sh'])
        elif args.command == 'backend-health':
            backend_health()
        elif args.command.endswith('-start'):
            start(args.command.split('-')[0])
        elif args.command == 'build-install':
            build()
        elif args.command == 'install-launch':
            build(existing=True)
        elif args.command == 'relaunch':
            run(['xcrun', 'devicectl', 'device', 'process', 'launch', '--device', settings()['udid'], '--terminate-existing', 'com.bridgetogrowth.learning'])
        elif args.command == 'wda-build':
            wda_build()
        elif args.command == 'stop':
            stop()
        else:
            backend_health()
            c = settings()
            for label, url in [('forward', f"http://{c['lan_ip']}:{c['forward_port']}/__btg_readiness"), ('metro', f"http://127.0.0.1:{c['metro_port']}/status"), ('appium', f"http://127.0.0.1:{c['appium_port']}/status")]:
                try:
                    print(label, 'VERIFIED' if probe(url) else 'UNAVAILABLE')
                except OSError:
                    print(label, 'UNAVAILABLE')
            try:
                import appium
                sid = json.loads((LOCAL / 'session.json').read_text())['sessionId']
                active = appium.request('POST', '/session/' + sid + '/execute/sync', {'script': 'mobile: activeAppInfo', 'args': []})
                print('Physical app/automation', 'VERIFIED (live session, BridgeToGrowth foreground)' if active.get('bundleId') == 'com.bridgetogrowth.learning' else 'AVAILABLE (another app foreground)')
            except (OSError, KeyError, RuntimeError):
                print('Physical app/automation UNVERIFIED; establish a session and launch the app.')
            evidence = LOCAL / 'device-network-evidence.json'
            if evidence.exists():
                data = json.loads(evidence.read_text())
                current_origin = f"http://{c['lan_ip']}:{c['forward_port']}"
                print('Physical app API', 'PREVIOUSLY VERIFIED' if data.get('origin') == current_origin else 'UNVERIFIED for current origin', 'at', data.get('verifiedAt'))
            else:
                print('Physical app API UNVERIFIED; Mac checks alone cannot establish device connectivity.')
    except (RuntimeError, OSError, subprocess.CalledProcessError, urllib.error.URLError) as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
