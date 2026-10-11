# Enforced renderer egress

Build `deployment/egress/Dockerfile` on the coordinator's Docker daemon and set
`RENDERER_EGRESS_IMAGE` to its tag. Each account gets its own trusted egress helper,
network namespace and Docker bridge; the renderer joins only that helper's network
namespace. Filesystems and PID namespaces remain separate. Only the helper has
`NET_ADMIN` during trusted initialization; it installs IPv4/IPv6 owner rules and
then drops all capabilities and runs Squid as UID 13. The renderer stays UID 1000,
with `cap-drop=ALL`, `no-new-privileges`, a read-only root, resource limits and
separate tmpfs mounts. It cannot edit proxy configuration or namespace rules.
Neither helper nor renderer mounts the host filesystem or Docker socket.

Kernel OUTPUT rules allow renderer UID 1000 only TCP to `127.0.0.1:3128` and
reject everything else, including DNS, direct internet, host gateways, private
control endpoints, other users, cloud metadata addresses and IPv6. Removing proxy
environment variables does not bypass those rules. The trusted proxy resolves
names and permits HTTPS CONNECT on port 443 only to these exact hostnames:

- `generativelanguage.googleapis.com` for Gemini generation.
- `translate.google.com`, `translate.googleapis.com` and
  `translate.googleusercontent.com` for the selected GTTS voiceover transport.

All IP literals, arbitrary HTTP/ports/hosts, and resolved private, loopback,
link-local, reserved, documentation and multicast addresses are denied. Proxy
logs and caching are disabled; generated video/text never enters a persistent
proxy cache. TLS is end-to-end, with normal certificate verification; no TLS
interception or guessed public CIDR allowlist is introduced. Required hostnames
are fixed in the reviewed image, rather than a generated-code-controlled setting.
The policy permits the required services, not arbitrary external access. Real
Gemini/GTTS connectivity through this policy remains on the later live checklist.
Changes to the chosen voiceover transport require a reviewed allowlist update
and corresponding tests; unsupported endpoints fail closed.

Startup waits for trusted helper initialization before starting the renderer.
A missing image, failed firewall/proxy, or old unrestricted renderer network fails
before generation. After work/cleanup and 25-minute inactivity, both containers
stop; their networks and container identities remain reusable. Startup recovery
stops an orphan helper if its renderer is missing/stopped. Drain before deleting
or rebuilding a helper/renderer: Docker network namespace references bind to a
specific helper container, so removing/replacing it requires recreating the
stopped renderer too. Never stop a helper while its renderer has active work.

Acceptance checks execute probes only in the isolated renderer. They verify
real direct-connect denial and proxy denial for private/control/unknown hosts,
UID/capability/mount/network isolation, real Manim execution, cancellation and
abandoned-file cleanup. No live Gemini, GTTS or Photon call is needed.
