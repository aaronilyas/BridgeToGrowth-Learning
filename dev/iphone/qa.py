#!/usr/bin/env python3
"""Repeatable physical iPhone QA. Never submit provider-dependent production work.

`probe` makes one synthetic invalid login against the existing API. Every other
stage requires the isolated qa_backend and a forwarder targeting its port.
Credentials and screenshots stay in the ignored, private evidence directory.
"""
import argparse
import base64
import json
from pathlib import Path
import secrets
import os
import signal
import time
import urllib.request
import xml.etree.ElementTree as ET

import appium

LOCAL = appium.LOCAL
EVIDENCE = LOCAL / 'qa-evidence'
BUNDLE = 'com.bridgetogrowth.learning'
ELEMENT = appium.ELEMENT


class Device:
    def __init__(self):
        self.prefix = '/session/' + json.loads((LOCAL / 'session.json').read_text())['sessionId']
        EVIDENCE.mkdir(exist_ok=True, mode=0o700)
        file = EVIDENCE / 'credentials.json'
        if not file.exists():
            file.write_text(json.dumps({'phone': '+15550009991', 'new_phone': '+15550009992',
                                        'password': secrets.token_urlsafe(24)}) + '\n')
            file.chmod(0o600)
        self.credentials = json.loads(file.read_text())
        self.results = []

    def call(self, method, path, data=None):
        return appium.request(method, self.prefix + path, data)

    def mobile(self, script, **args):
        return self.call('POST', '/execute/sync', {'script': 'mobile: ' + script, 'args': [args]})

    def foreground(self):
        if self.mobile('activeAppInfo').get('bundleId') != BUNDLE:
            raise RuntimeError('BridgeToGrowth must be foreground; refusing another app')

    def source(self):
        self.foreground()
        return self.call('GET', '/source')

    def expect(self, text, timeout=40):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            source = self.source()
            if text in source:
                if any(text in e.get('label', '') and e.get('visible') == 'true'
                       and e.get('accessible') == 'true' for e in ET.fromstring(source).iter()):
                    return
                try:
                    buttons = self.mobile('alert', action='getButtons')
                    if 'Not Now' in buttons and 'Save' in buttons:
                        # Decline only the known iOS password-saving prompt.
                        self.mobile('alert', action='dismiss', buttonLabel='Not Now')
                        continue
                except RuntimeError:
                    pass
                if text in {'Welcome back', 'What will you learn?', 'Your account',
                            'Verify your phone', 'Create your account', 'Reset password', 'Setup required'}:
                    time.sleep(.5)
                    continue
                match = self.call('POST', '/element', {
                    'using': '-ios predicate string',
                    'value': 'name CONTAINS ' + json.dumps(text) + ' AND accessible == true AND (type == "XCUIElementTypeStaticText" OR type == "XCUIElementTypeButton")',
                })[ELEMENT]
                if not self.call('GET', '/element/' + match + '/displayed'):
                    try:
                        self.mobile('scrollToElement', elementId=match)
                    except RuntimeError:
                        time.sleep(.5)  # Navigation may still be settling.
                        continue
                return
            time.sleep(.5)
        raise AssertionError('Screen did not contain expected text: ' + text)

    def element(self, label, field=False):
        self.foreground()
        # Field labels also occur on static text: select the actual editable control.
        predicate = 'name == ' + json.dumps(label)
        if field:
            # iOS combines multiline accessibility labels with their placeholder.
            predicate = 'name BEGINSWITH ' + json.dumps(label)
            predicate += ' AND (type == "XCUIElementTypeTextField" OR type == "XCUIElementTypeSecureTextField" OR type == "XCUIElementTypeTextView")'
        else:
            predicate += ' AND type == "XCUIElementTypeButton"'
        element = self.call('POST', '/element', {'using': '-ios predicate string', 'value': predicate})[ELEMENT]
        if not self.call('GET', '/element/' + element + '/displayed'):
            self.mobile('scrollToElement', elementId=element)
        return element

    def expect_absent(self, text, timeout=20):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if text not in self.source():
                return
            time.sleep(.5)
        raise AssertionError('Screen retained unexpected text: ' + text)

    def tap(self, label, twice=False):
        element = self.element(label)
        if twice:
            self.mobile('doubleTap', elementId=element)
        else:
            self.call('POST', '/element/' + element + '/click', {})

    def fill(self, label, text):
        element = self.element(label, field=True)
        # Auth actions clear passwords themselves. WDA clear on an empty
        # new-password field can focus iOS AutoFill instead of the keyboard.
        if 'password' not in label.lower():
            self.call('POST', '/element/' + element + '/click', {})
            self.call('POST', '/element/' + element + '/clear', {})
        else:
            rect = self.call('GET', '/element/' + element + '/rect')
            # Focus the editable area, away from iOS's embedded AutoFill control.
            self.mobile('tap', x=rect['x'] + 20, y=rect['y'] + rect['height'] / 2)
            value = self.call('GET', '/element/' + element + '/attribute/value') or ''
            if len(value) > 1:
                self.call('POST', '/element/' + element + '/clear', {})
                self.mobile('tap', x=rect['x'] + 20, y=rect['y'] + rect['height'] / 2)
        self.call('POST', '/element/' + element + '/value', {'text': text})
        time.sleep(.3)  # Let controlled React Native input state receive the event.
        value = self.call('GET', '/element/' + element + '/attribute/value') or ''
        # iOS may expose one masking bullet regardless of password length.
        masked = bool(value) and all(c in '•●*' for c in value)
        if text and not masked and len(value) != len(text):
            raise AssertionError('Automation did not populate the complete field: ' + label)

    def capture(self, name):
        self.foreground()
        png = EVIDENCE / (name + '.png')
        png.write_bytes(base64.b64decode(self.call('GET', '/screenshot')))
        xml = EVIDENCE / (name + '.xml')
        xml.write_text(self.source())
        png.chmod(0o600)
        xml.chmod(0o600)

    def passed(self, name):
        self.capture(name)
        self.results.append({'test': name, 'status': 'PASS', 'at': time.time()})
        print('PASS ' + name, flush=True)
        path = EVIDENCE / 'results.json'
        previous = json.loads(path.read_text()) if path.exists() else []
        path.write_text(json.dumps(previous + [self.results[-1]], indent=2) + '\n')
        path.chmod(0o600)

    def control(self, **data):
        c = json.loads((LOCAL / 'settings.json').read_text())
        try:
            public = urllib.request.urlopen(f"http://{c['lan_ip']}:{c['forward_port']}/account", timeout=5)
        except urllib.error.HTTPError as error:
            public = error
        if public.headers.get('X-BTG-QA') != 'providers-substituted':
            raise RuntimeError('Refusing QA mutations: public bridge does not target isolated substitutes')
        meta = json.loads((LOCAL / 'qa-backend.json').read_text())
        req = urllib.request.Request(f"http://127.0.0.1:{meta['port']}/__qa/control",
                                     json.dumps(data).encode(), {'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.load(response)

    def relaunch(self):
        self.mobile('terminateApp', bundleId=BUNDLE)
        self.mobile('activateApp', bundleId=BUNDLE)

    def login(self, phone=None):
        self.expect('Welcome back')
        self.fill('Phone number', phone or self.credentials['phone'])
        self.fill('Password', self.credentials['password'])
        self.tap('Log in')
        self.expect('What will you learn?')

    def probe(self):
        self.expect('Welcome back')
        self.passed('01-launch-login')
        self.tap('Log in')
        self.expect('Use an international phone number')
        self.passed('02-empty-login-validation')
        self.fill('Phone number', self.credentials['phone'])
        self.fill('Password', 'short')
        self.tap('Log in')
        self.expect('Password must contain 12')
        self.passed('03-short-password-validation')
        self.fill('Password', self.credentials['password'])
        self.tap('Log in')
        self.expect('Invalid or expired credentials')
        self.passed('04-real-api-invalid-login')
        self.fill('Phone number', '')
        self.fill('Password', '')

    def signup(self):
        self.control()  # Require isolated test backend before any signup.
        if 'Welcome back' not in self.source():
            self.tap('Back to login')
        self.tap('Create account')
        self.expect('Create your account')
        self.fill('Phone number', self.credentials['phone'])
        self.fill('Password', self.credentials['password'])
        self.tap('Request verification')
        self.expect('Verify your phone')
        self.passed('05-signup-challenge')
        code = self.control(phone=self.credentials['phone'])['code']
        assert code, 'Substitute transport did not capture verification code'
        wrong = '000000' if code != '000000' else '000001'
        self.fill('Six-digit verification code', wrong)
        self.tap('Verify phone')
        self.expect('Invalid or expired verification')
        self.expect('4 attempts left')
        self.passed('06-invalid-verification')
        self.fill('Six-digit verification code', code)
        self.tap('Verify phone')
        self.expect('What will you learn?')
        self.passed('07-verified-signup')
        before = self.control()['requests']
        self.relaunch()
        self.expect('What will you learn?')
        new = self.control()['requests'][len(before):]
        assert any(r['path'] == '/auth/refresh' and r['status'] == 200 for r in new)
        self.passed('08-secure-session-relaunch-refresh')

    def lessons(self):
        self.control()
        self.fill('Lesson topic', 'QA:cancel Explain gravity')
        before = self.control()['requests']
        self.tap('Request lesson', twice=True)
        self.expect('Status:')
        self.expect('Request cancellation')
        self.tap('Request cancellation')
        self.expect('Status: cancelled')
        new = self.control()['requests'][len(before):]
        assert sum(r['path'] == '/lessons' and r['method'] == 'POST' for r in new) == 1
        assert any(r['method'] == 'GET' and r['path'].startswith('/lessons/') for r in new)
        self.passed('09-submit-poll-cancel-repeated-taps')
        self.fill('Lesson topic', 'QA:overlong Explain all of physics')
        self.tap('Request lesson')
        self.expect('Status: needs breakdown')
        self.passed('10-overlong-scope-feedback')
        self.fill('Lesson topic', 'QA:failed Synthetic failure')
        self.tap('Request lesson')
        self.expect('Status: failed')
        self.passed('11-renderer-failure')
        self.fill('Lesson topic', 'QA:accepted Explain moon phases')
        self.tap('Request lesson')
        self.expect('Status: accepted', timeout=40)
        self.expect('A read receipt has not been confirmed')
        self.passed('12-substitute-acceptance-unconfirmed-receipt')
        self.fill('Lesson topic', 'QA:unknown Synthetic send ambiguity')
        self.tap('Request lesson')
        self.expect('Status: delivery unknown', timeout=40)
        self.passed('13-delivery-unknown-no-replay')
        self.relaunch()
        self.expect('What will you learn?')
        self.expect('Status: delivery unknown')
        assert len(self.control()['jobs']) == 5, 'Relaunch duplicated a submission'
        self.passed('14-job-retention-relaunch')

    def account(self):
        self.control()
        self.tap('Account')
        self.expect('Your account')
        self.expect('Phone verified')
        self.passed('15-account')
        self.tap('Log out')
        self.expect('Welcome back')
        self.passed('16-logout')
        self.login()
        self.passed('17-login')
        self.tap('Account')
        self.expect('Your account')
        self.tap('Change phone number')
        self.fill('New phone number', self.credentials['new_phone'])
        self.fill('Current password', self.credentials['password'])
        self.tap('Request verification')
        self.expect('Verify your phone')
        code = self.control(phone=self.credentials['new_phone'])['code']
        self.fill('Six-digit verification code', code)
        self.tap('Verify phone')
        self.expect('Welcome back')
        self.passed('18-phone-change-revokes-session')
        self.login(self.credentials['new_phone'])
        self.passed('19-login-new-number')

    def faults(self):
        self.control()
        self.expect('What will you learn?')
        if not any(j['topic'].startswith('QA:background') for j in self.control()['jobs']):
            self.background()

        first = next(j for j in self.control()['jobs'] if j['topic'].startswith('QA:cancel'))
        snapshot = {'id': first['id'], 'status': 'future_stage', 'estimated_duration_seconds': None,
                    'rendered_duration_seconds': None, 'feedback': None, 'failure_reason': None,
                    'evaluation': None, 'cancel_requested': False, 'cleanup_pending': False,
                    'photon_accepted': False, 'provider_message_id': None,
                    'receipt_status': 'unconfirmed', 'read_at': None}
        self.control(fault={'path': '/lessons/' + first['id'], 'status': 200, 'body': snapshot})
        self.tap('Refresh status')
        self.expect('Unknown job status')
        self.passed('21-unknown-server-status-does-not-imply-success')

        self.tap('Account')
        self.expect('Your account')
        self.control(fault={'path': '/account', 'status': 503})
        self.tap('Refresh account')
        self.expect('The service is unavailable')
        self.expect('Account details may be stale')
        self.passed('22-network-service-failure-retains-stale-account')
        self.tap('Refresh account')
        self.expect_absent('The service is unavailable')
        self.passed('23-manual-account-recovery')
        self.session_faults()

    def session_faults(self):
        self.control()
        self.control(fault={'path': '/auth/refresh', 'status': 200, 'body': {'token_type': 'Bearer'}})
        before = self.control()['requests']
        self.relaunch()
        self.expect('Welcome back')
        self.expect('Session renewal could not be confirmed safely')
        self.passed('24-malformed-refresh-signs-out-safely')
        self.relaunch()
        self.expect('Welcome back')
        new = self.control()['requests'][len(before):]
        assert sum(r['path'] == '/auth/refresh' for r in new) == 1, 'Unsafe refresh replay'
        self.passed('25-uncertain-refresh-not-replayed-after-relaunch')

        self.control(fault={'path': '/auth/login', 'status': 200, 'body': {'token_type': 'Bearer'}})
        self.fill('Phone number', self.credentials['phone'])
        self.fill('Password', self.credentials['password'])
        self.tap('Log in')
        self.expect('Invalid session response')
        self.passed('26-malformed-login-does-not-install-session')
        self.login()

    def background(self):
        self.fill('Lesson topic', 'QA:background Foreground reconciliation')
        self.tap('Request lesson')
        self.expect('Status:')
        job = next(j for j in self.control()['jobs'] if j['topic'].startswith('QA:background'))
        self.mobile('backgroundApp', seconds=-1)
        time.sleep(1)
        before = self.control()['requests']
        time.sleep(7)
        after = self.control()['requests'][len(before):]
        assert not any(r['method'] == 'GET' and r['path'].startswith('/lessons/') for r in after), 'Polling continued in background'
        self.mobile('activateApp', bundleId=BUNDLE)
        self.expect('What will you learn?')
        self.expect('Status: accepted', timeout=30)
        after = self.control()['requests'][len(before):]
        assert any(r['path'] == '/lessons/' + job['id'] for r in after), 'No foreground reconciliation'
        self.passed('20-background-polling-paused-foreground-reconciled')

    def recovery(self):
        self.control()
        self.tap('Account')
        self.expect('Your account')
        self.tap('Log out everywhere')
        self.expect('All sessions were revoked')
        self.passed('27-logout-all')
        # Phone changes and recovery share the real recipient-wide cooldown.
        self.control(advance_seconds=61)
        self.tap('Forgot password')
        self.expect('Recover your account')
        self.fill('Phone number', self.credentials['new_phone'])
        self.tap('Request verification')
        self.expect('Reset password')
        code = self.control(phone=self.credentials['new_phone'])['code']
        assert code
        self.fill('Six-digit verification code', code)
        self.fill('New password', self.credentials['password'])
        self.tap('Reset password')
        self.expect('Welcome back')
        self.expect('Password reset')
        self.passed('28-password-recovery-requires-login')
        self.login(self.credentials['new_phone'])
        self.passed('29-login-after-password-recovery')

    def configuration(self):
        self.control()
        import run
        file = LOCAL.parents[1] / 'frontend/.env'
        previous = file.read_bytes()

        def restart_metro():
            pid = run.owned_pid('metro')
            if pid:
                os.killpg(pid, signal.SIGTERM)
                deadline = time.monotonic() + 10
                while run.owned_pid('metro'):
                    if time.monotonic() > deadline:
                        raise RuntimeError('Owned Metro process did not stop')
                    time.sleep(.2)
            run.start('metro')

        try:
            lines = [s for s in previous.decode().splitlines() if not s.startswith('EXPO_PUBLIC_API_BASE_URL=')]
            file.write_text('\n'.join(lines + ['EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:8000/invalid']) + '\n')
            restart_metro()
            self.relaunch()
            self.expect('Setup required', timeout=40)
            self.expect('API configuration must be an origin')
            self.passed('30-invalid-configuration-setup-screen')
        finally:
            file.write_bytes(previous)
            file.chmod(0o600)
            restart_metro()
            self.relaunch()
        self.expect('What will you learn?', timeout=40)
        self.passed('31-configuration-restored-session-preserved')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=['probe', 'signup', 'lessons', 'faults', 'session-faults', 'account', 'recovery', 'configuration'])
    args = parser.parse_args()
    device = Device()
    try:
        getattr(device, args.stage.replace('-', '_'))()
    except Exception:
        try:
            device.capture('failure-' + args.stage)
        except Exception:
            pass
        raise
