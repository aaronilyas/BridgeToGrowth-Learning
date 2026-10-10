"""Trusted entrypoint inside a single user's disposable container only."""
import json
import math
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import uuid

from integrations import gemini


def reap_generated_processes():
    # No concurrent job executes in this container. PID 1 is the idle keeper;
    # every other process except this trusted command belongs to the render.
    for _ in range(5):
        remaining = []
        for entry in Path('/proc').iterdir():
            if not entry.name.isdigit() or int(entry.name) in (1, os.getpid()):
                continue
            try:
                state = (entry / 'stat').read_text().split(') ', 1)[1][0]
                if state != 'Z':
                    remaining.append(int(entry.name))
            except FileNotFoundError:
                pass
        if not remaining:
            return
        for pid in remaining:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    raise RuntimeError('Render processes have not stopped; retain protection')


def run(args, cwd):
    process = subprocess.Popen(args, cwd=cwd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               start_new_session=True, env={k: v for k, v in os.environ.items()
                                                          if not k.startswith('GEMINI_')})
    try:
        code = process.wait(timeout=300)
        if code:
            raise RuntimeError("Renderer failed")
    finally:
        # Also reap descendants left behind by generated code, before releasing job protection.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        reap_generated_processes()


def main():
    action, identifier = sys.argv[1:]
    identifier = str(uuid.UUID(identifier))
    root = Path('/work') / identifier
    payload = json.load(sys.stdin)
    if action == 'cleanup':
        reap_generated_processes()
        if root.is_symlink():
            root.unlink()
        elif root.exists():
            shutil.rmtree(root)
        return {}
    if action == 'generate':
        root.mkdir(exist_ok=False)
        if type(payload.get('voiceover')) is not bool:
            raise ValueError('Invalid voiceover setting')
        (root / 'request.json').write_text(json.dumps({'voiceover': payload['voiceover']}))
        result = gemini('Write Manim Python with a Scene named Lesson, at most 90 seconds. '
                        'Return JSON with code (string). Use Manim Voiceover with GTTSService when '
                        'voiceover is enabled. Voiceover enabled: ' + str(payload['voiceover']) +
                        '. Original intent: ' + json.dumps(payload['intent']))
        if not isinstance(result.get('code'), str) or not result['code'].strip():
            raise ValueError('Invalid generated code')
        (root / 'lesson.py').write_text(result['code'])
        return {}
    if action == 'render':
        voiceover = json.loads((root / 'request.json').read_text())['voiceover']
        if type(voiceover) is not bool:
            raise ValueError('Invalid voiceover setting')
        run(['manim', '-ql', '--disable_caching', '--media_dir', str(root / 'media'),
             str(root / 'lesson.py'), 'Lesson'], root)
        candidates = list(root.glob('media/videos/lesson/*/Lesson.mp4'))
        if len(candidates) != 1:
            raise ValueError('Missing or ambiguous video')
        video = candidates[0]
        if video.is_symlink() or root.is_symlink() or not video.resolve().is_relative_to(root.resolve()):
            raise ValueError('Escaped artifact')
        if video.stat().st_size > 12 * 1024 * 1024:
            raise ValueError('Video exceeds inline processing limit')
        # Copy only validated bytes into a fixed, per-job filename.
        pending = root / 'pending.mp4'
        pending.write_bytes(video.read_bytes())
        probe = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type',
                                         '-of', 'json', str(pending)], timeout=30)
        metadata = json.loads(probe)
        duration = float(metadata['format']['duration'])
        if not math.isfinite(duration) or not 0 < duration <= 90:
            raise ValueError('Invalid or overlong duration')
        has_audio = any(stream.get('codec_type') == 'audio' for stream in metadata.get('streams', []))
        if voiceover and not has_audio:
            raise ValueError('Requested voiceover has no audio stream')
        pending.replace(root / 'video.mp4')
        return {'seconds': duration, 'has_audio': has_audio}
    if action == 'video':
        video = root / 'video.mp4'
        if root.is_symlink() or video.is_symlink() or not video.resolve().is_relative_to(Path('/work').resolve()):
            raise ValueError('Escaped artifact')
        sys.stdout.buffer.write(video.read_bytes())
        return None
    raise ValueError('Unknown command')


if __name__ == '__main__':
    result = main()
    if result is not None:
        print(json.dumps(result))
