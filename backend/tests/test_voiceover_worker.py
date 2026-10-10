"""Trusted worker contract tests; renderer and ffprobe are substituted on the host."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import uuid
from unittest.mock import Mock, patch


spec = importlib.util.spec_from_file_location(
    'voiceover_worker', Path(__file__).resolve().parents[1] / 'container' / 'worker.py')
worker = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {'integrations': Mock()}):
    spec.loader.exec_module(worker)


class VoiceoverWorkerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.work = Path(self.directory.name)
        self.identifier = str(uuid.uuid4())
        self.root = self.work / self.identifier
        self.paths = patch.object(worker, 'Path', side_effect=lambda value: self.work if value == '/work' else Path(value))
        self.paths.start()
        self.addCleanup(self.paths.stop)

    def command(self, action, payload=None):
        with patch.object(sys, 'argv', ['worker.py', action, self.identifier]), \
                patch.object(sys, 'stdin', io.StringIO(json.dumps(payload or {}))):
            return worker.main()

    def generate(self, voiceover):
        # The placeholder is never executed; run() is replaced in every host render test.
        with patch.object(worker, 'gemini', return_value={'code': '# never executed'}):
            self.command('generate', {'intent': 'Explain gravity', 'voiceover': voiceover})

    def render(self, streams, duration='90', probe_error=None):
        candidate = self.root / 'media/videos/lesson/480p15/Lesson.mp4'
        candidate.parent.mkdir(parents=True, exist_ok=True)
        candidate.write_bytes(b'placeholder, not a real video')
        metadata = {'format': {'duration': duration}, 'streams': streams}
        with patch.object(worker, 'run') as renderer, \
                patch.object(worker.subprocess, 'check_output', return_value=json.dumps(metadata).encode(),
                             side_effect=probe_error) as probe:
            result = self.command('render')
            self.assertIn('manim', renderer.call_args.args[0])
            self.assertIn('format=duration:stream=codec_type', probe.call_args.args[0])
            self.assertEqual(probe.call_args.kwargs['timeout'], 30)
            return result

    def test_setting_survives_separate_generate_and_render_commands(self):
        self.generate(True)
        self.assertEqual(json.loads((self.root / 'request.json').read_text()), {'voiceover': True})
        self.assertEqual(self.render([{'codec_type': 'video'}, {'codec_type': 'audio'}]), {'seconds': 90, 'has_audio': True})
        self.assertTrue((self.root / 'video.mp4').exists())
        self.assertFalse((self.root / 'pending.mp4').exists())

    def test_missing_audio_is_rejected_before_video_is_available(self):
        self.generate(True)
        for streams in ([], [{'codec_type': 'video'}], [{'codec_type': 'subtitle'}]):
            with self.subTest(streams=streams), self.assertRaisesRegex(ValueError, 'no audio stream'):
                self.render(streams)
            self.assertFalse((self.root / 'video.mp4').exists())

    def test_voiceover_disabled_accepts_silent_or_audio_video(self):
        self.generate(False)
        for streams in ([{'codec_type': 'video'}], [{'codec_type': 'audio'}, {'codec_type': 'video'}]):
            with self.subTest(streams=streams):
                self.assertEqual(self.render(streams), {'seconds': 90, 'has_audio': any(s['codec_type'] == 'audio' for s in streams)})

    def test_duration_limit_still_applies_with_and_without_voiceover(self):
        for voiceover in (False, True):
            self.generate(voiceover)
            for duration in ('89', '90'):
                with self.subTest(voiceover=voiceover, duration=duration):
                    self.assertEqual(self.render([{'codec_type': 'audio'}], duration), {'seconds': float(duration), 'has_audio': True})
            (self.root / 'video.mp4').unlink()
            for duration in ('90.01', '91', '0', '-1', 'nan', 'inf'):
                with self.subTest(voiceover=voiceover, duration=duration), self.assertRaises(ValueError):
                    self.render([{'codec_type': 'audio'}], duration)
                self.assertFalse((self.root / 'video.mp4').exists())
            # Separate jobs do not share request settings or artifacts.
            self.identifier = str(uuid.uuid4())
            self.root = self.work / self.identifier

    def test_probe_failure_does_not_release_video(self):
        self.generate(True)
        with self.assertRaises(RuntimeError):
            self.render([], probe_error=RuntimeError('probe failed'))
        self.assertFalse((self.root / 'video.mp4').exists())

    def test_missing_or_invalid_setting_fails_closed_before_render(self):
        self.root.mkdir()
        for setting in (None, 'true', 1):
            (self.root / 'request.json').write_text(json.dumps({'voiceover': setting}))
            with patch.object(worker, 'run') as renderer, self.assertRaises(ValueError):
                self.command('render')
            renderer.assert_not_called()
        (self.root / 'request.json').unlink()
        with patch.object(worker, 'run') as renderer, self.assertRaises(FileNotFoundError):
            self.command('render')
        renderer.assert_not_called()


if __name__ == '__main__':
    unittest.main()
