#!/usr/bin/env python3
"""Minimal W3C client for the local physical iPhone. No npm/Python client required."""
import argparse
import base64
import json
from pathlib import Path
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
LOCAL = ROOT / '.local/iphone-testing'
ELEMENT = 'element-6066-11e4-a52e-4f735466cecf'


def request(method, path, payload=None):
    c = json.loads((LOCAL / 'settings.json').read_text())
    url = f"http://127.0.0.1:{c['appium_port']}" + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            result = json.load(r)
    except urllib.error.HTTPError as e:
        result = json.load(e)
    value = result.get('value')
    if isinstance(value, dict) and value.get('error'):
        # Error text is private because it can include local identifiers/paths.
        (LOCAL / 'appium-error.json').write_text(json.dumps(value, indent=2))
        (LOCAL / 'appium-error.json').chmod(0o600)
        raise RuntimeError(f"Appium: {value['error']}; details in ignored appium-error.json")
    return value


def session():
    c = json.loads((LOCAL / 'settings.json').read_text())
    file = LOCAL / 'session.json'
    if file.exists():
        old = json.loads(file.read_text())
        try:
            request('GET', f"/session/{old['sessionId']}/window/rect")
            print('Existing physical-device session is available.')
            return
        except (RuntimeError, OSError):
            pass
    caps = {'platformName': 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': c['udid'], 'appium:bundleId': 'com.bridgetogrowth.learning', 'appium:noReset': True, 'appium:useNewWDA': False, 'appium:usePrebuiltWDA': True, 'appium:derivedDataPath': str(LOCAL / 'wda-build'), 'appium:updatedWDABundleId': c['wda_bundle_id'], 'appium:xcodeOrgId': c['team_id'], 'appium:xcodeSigningId': 'Apple Development', 'appium:newCommandTimeout': 3600, 'appium:wdaLaunchTimeout': 120000, 'appium:showXcodeLog': False}
    # React Native rerenders and native reinstalls can invalidate cached inputs.
    caps['appium:useNativeCachingStrategy'] = False
    # Countdown timers update every second; waiting for complete idleness stalls UI commands.
    caps['appium:waitForIdleTimeout'] = 0
    value = request('POST', '/session', {'capabilities': {'alwaysMatch': caps, 'firstMatch': [{}]}})
    file.write_text(json.dumps({'sessionId': value['sessionId']}, indent=2) + '\n')
    file.chmod(0o600)
    print('Physical iPhone Appium session established. Session ID is in ignored session.json.')


def command(name, locator=None):
    sid = json.loads((LOCAL / 'session.json').read_text())['sessionId']
    prefix = '/session/' + sid
    if name == 'source':
        source = request('GET', prefix + '/source')
        file = LOCAL / 'initial-screen.xml'
        file.write_text(source)
        file.chmod(0o600)
        print(f'Element source saved: {file}')
    elif name == 'screenshot':
        active = request('POST', prefix + '/execute/sync', {'script': 'mobile: activeAppInfo', 'args': []})
        if active.get('bundleId') != 'com.bridgetogrowth.learning':
            raise RuntimeError('BridgeToGrowth is not foreground; refusing to capture another app.')
        image = request('GET', prefix + '/screenshot')
        file = LOCAL / 'initial-screen.png'
        file.write_bytes(base64.b64decode(image))
        file.chmod(0o600)
        print(f'Physical iPhone screenshot saved: {file}')
    elif name == 'device-info':
        data = request('POST', prefix + '/execute/sync', {'script': 'mobile: deviceInfo', 'args': []})
        print(json.dumps({k: v for k, v in data.items() if k in ['model', 'name', 'platformVersion', 'productType', 'timeZone', 'userInterfaceIdiom']}, indent=2))
    elif name == 'tap':
        active = request('POST', prefix + '/execute/sync', {'script': 'mobile: activeAppInfo', 'args': []})
        if active.get('bundleId') != 'com.bridgetogrowth.learning':
            raise RuntimeError('BridgeToGrowth is not foreground; refusing to interact with another app.')
        element = request('POST', prefix + '/element', {'using': 'accessibility id', 'value': locator})
        request('POST', prefix + '/element/' + element[ELEMENT] + '/click', {})
        print('Tapped the selected BridgeToGrowth element.')
    elif name == 'close':
        request('DELETE', prefix)
        (LOCAL / 'session.json').unlink()
        print('Automation session closed; app data and backend preserved.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['session', 'source', 'screenshot', 'device-info', 'tap', 'close'])
    parser.add_argument('--label')
    args = parser.parse_args()
    try:
        if args.command == 'session':
            session()
        else:
            if args.command == 'tap' and not args.label:
                parser.error('tap needs --label from the current element source')
            command(args.command, args.label)
    except (RuntimeError, OSError, KeyError) as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
