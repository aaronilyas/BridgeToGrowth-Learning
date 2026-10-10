# Cloudflare ingress

Run `cloudflared` as a service on the same Docker host as Compose, using the
example configuration with your named tunnel, credentials path, and DNS hostname.
The host process can reach `http://127.0.0.1:8000`; a normal bridge-network
container cannot reach the host's loopback. If the API port changes, update this
origin URL. Do not use `messaging`, PostgreSQL, or Docker's socket as tunnel origins.
The sole public hostname routes to the authenticated FastAPI API; unmatched hosts
return 404. Keep credentials outside Git and build contexts. No credentials,
DNS records, or live tunnel are created by the verification suite.

After configuring the named tunnel in Cloudflare and routing your hostname:

```sh
cloudflared --config /etc/cloudflared/config.yml tunnel ingress validate
cloudflared --config /etc/cloudflared/config.yml tunnel ingress rule https://your-hostname.example/lessons
cloudflared --config /etc/cloudflared/config.yml tunnel run
```

The executable deployment checks use synthetic configuration, verify the fallback
and origin, and probe a disposable loopback API. They do not verify production DNS,
credentials, edge connectivity, or identity-provider availability.
