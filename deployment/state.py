"""Private durable ownership state. Atomic replacements survive interrupted starts."""
import json
import os
from pathlib import Path
import tempfile
import uuid

from .settings import DeploymentError


def private_write(path, content):
    if path.is_symlink():
        raise DeploymentError('Refusing symlink in deployment state.')
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.pending-')
    try:
        with os.fdopen(fd, 'w') as file:
            os.chmod(temporary, 0o600)
            file.write(content)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class State:
    def __init__(self, root):
        self.root = root.resolve()
        self.directory = self.root / '.local/backend'
        if self.directory.is_symlink() or self.directory.parent.is_symlink():
            raise DeploymentError('Refusing symlink deployment directory.')
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.directory, 0o700)
        self.path = self.directory / 'state.json'
        if self.path.is_symlink():
            raise DeploymentError('Refusing symlink ownership state.')
        self.data = json.loads(self.path.read_text()) if self.path.exists() else dict(
            version=1, root=str(self.root), deployment_id=uuid.uuid4().hex, project='btg-learning')
        if (self.data.get('root') != str(self.root) or self.data.get('project') != 'btg-learning'
                or self.data.get('version') != 1 or not isinstance(self.data.get('deployment_id'), str)
                or len(self.data['deployment_id']) != 32):
            raise DeploymentError('Deployment state ownership mismatch. Restore this checkout\'s state backup.')

    def save(self):
        private_write(self.path, json.dumps(self.data, indent=2) + '\n')

    def write(self, name, content):
        private_write(self.directory / name, content)
