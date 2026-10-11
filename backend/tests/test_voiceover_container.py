"""Opt-in real rendering tests: every executable fixture runs in a disposable user container."""
import json
import os
import subprocess
import unittest
import uuid


SILENT = '''from manim import Scene, Dot
class Lesson(Scene):
    def construct(self):
        self.add(Dot())
        self.wait(1)
'''
# Deliberately a silent audio track: stream presence cannot establish narration quality.
WITH_AUDIO = '''from manim import Scene, Dot
import wave
class Lesson(Scene):
    def construct(self):
        with wave.open("/tmp/voiceover-fixture.wav", "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(8000)
            audio.writeframes(bytes(16000))
        self.add(Dot())
        self.add_sound("/tmp/voiceover-fixture.wav")
        self.wait(1)
'''


@unittest.skipUnless(os.environ.get('RUN_VOICEOVER_CONTAINER_TESTS') == '1',
                     'Requires opt-in and Docker renderer image; no host fixture execution')
class VoiceoverContainerTests(unittest.TestCase):
    def setUp(self):
        self.container = 'btg-voiceover-test-' + str(uuid.uuid4())
        self.addCleanup(self.remove_container)
        subprocess.run([
            'docker', 'run', '-d', '--name', self.container, '--network=none',
            '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
            '--pids-limit=128', '--memory=1g', '--cpus=1', '--user=1000:1000',
            '--tmpfs=/work:rw,nosuid,nodev,size=512m,uid=1000,gid=1000',
            '--tmpfs=/tmp:rw,nosuid,nodev,size=128m,uid=1000,gid=1000',
            os.environ.get('VOICEOVER_TEST_IMAGE', 'btg-renderer:voiceover-test'),
        ], check=True, capture_output=True, timeout=60)

    def remove_container(self):
        subprocess.run(['docker', 'rm', '-f', self.container], capture_output=True, timeout=60)

    def execute(self, args, payload):
        return subprocess.run(['docker', 'exec', '-i', self.container, 'python', *args],
                              input=json.dumps(payload).encode(), capture_output=True, timeout=360)

    def check_fixture(self, code, voiceover, accepted):
        job = str(uuid.uuid4())
        # Substitute Gemini inside the container; let the worker save the actual request metadata.
        seed = '''import json, sys
sys.path.insert(0, '/opt')
import worker
payload = json.load(sys.stdin)
worker.gemini = lambda prompt, **kwargs: {'code': payload['code']}
import io
sys.stdin = io.StringIO(json.dumps({'intent': 'fixture', 'voiceover': payload['voiceover']}))
sys.argv = ['worker.py', 'generate', payload['job']]
worker.main()
'''
        generated = self.execute(['-c', seed], {'job': job, 'code': code, 'voiceover': voiceover})
        self.assertEqual(generated.returncode, 0, generated.stderr.decode())
        rendered = self.execute(['/opt/worker.py', 'render', job], {})
        if accepted:
            self.assertEqual(rendered.returncode, 0, rendered.stderr.decode())
            self.assertTrue(0 < json.loads(rendered.stdout)['seconds'] <= 90)
            video = self.execute(['/opt/worker.py', 'video', job], {})
            self.assertEqual(video.returncode, 0, video.stderr.decode())
            self.assertTrue(video.stdout)
        else:
            self.assertNotEqual(rendered.returncode, 0)
            self.assertIn(b'Requested voiceover has no audio stream', rendered.stderr)
            video = self.execute(['/opt/worker.py', 'video', job], {})
            self.assertNotEqual(video.returncode, 0)
            self.assertFalse(video.stdout)
        cleanup = self.execute(['/opt/worker.py', 'cleanup', job], {})
        self.assertEqual(cleanup.returncode, 0, cleanup.stderr.decode())

    def test_voiceover_requires_audio(self):
        self.check_fixture(SILENT, True, False)

    def test_disabled_voiceover_accepts_silent_render(self):
        self.check_fixture(SILENT, False, True)

    def test_audio_stream_passes_without_proving_narration_quality(self):
        self.check_fixture(WITH_AUDIO, True, True)


if __name__ == '__main__':
    unittest.main()
