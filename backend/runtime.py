"""Docker is the only execution boundary for generated Python."""
import json
import os
import subprocess


class DockerRuntime:
    def _run(self, *args, data=None):
        result = subprocess.run(["docker", *args], input=data, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, check=True)
        return result.stdout

    def start(self, user_id):
        name = f"btg-user-{user_id}"
        network = name + "-network"
        try:
            self._run("inspect", name)
        except subprocess.CalledProcessError:
            try:
                self._run("network", "inspect", network)
            except subprocess.CalledProcessError:
                self._run("network", "create", network)
            self._run("create", "--network", network, "--name", name, "--label", "btg.user=" + str(user_id),
                      "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
                      "--pids-limit=128", "--memory=1g", "--cpus=1", "--user=1000:1000",
                      "--tmpfs=/work:rw,nosuid,nodev,size=512m,uid=1000,gid=1000",
                      "--tmpfs=/tmp:rw,nosuid,nodev,size=128m,uid=1000,gid=1000",
                      os.environ.get("USER_CONTAINER_IMAGE", "btg-renderer:local"))
        self._run("start", name)
        return name

    def command(self, handle, action, job_id, payload=None):
        args = ["exec", "-i"]
        if action == "generate":
            args += ["-e", "GEMINI_API_KEY", "-e", "GEMINI_MODEL"]
        output = self._run(*args, handle, "python", "/opt/worker.py", action, str(job_id),
                           data=json.dumps(payload or {}).encode())
        return output if action == "video" else json.loads(output)

    def stop(self, handle):
        self._run("stop", handle)
