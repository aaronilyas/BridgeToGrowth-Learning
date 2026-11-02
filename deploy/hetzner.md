# Hetzner Cloud VPS with Postgres on the same server

This guide puts the app, Caddy, and Postgres on one Hetzner Cloud server running Ubuntu 24.04. It assumes you have never used Hetzner. Steps that are the same on every provider are in [common.md](common.md); this guide links to them.

Replace `$HOST` with your public hostname, for example `learn.example.com`, and `$IP` with the server's IPv4 address. Commands in `code blocks` run on the server unless a step says otherwise.

## 1. Create the account, a project, and an SSH key

1. Sign up at [hetzner.com/cloud](https://www.hetzner.com/cloud). Hetzner may ask for ID or a payment check before your first server.
2. Open the Cloud Console and create a project, for example `btg`. Servers, firewalls, and keys belong to a project.
3. On **your own computer**, create an SSH key if you don't have one:

   ```sh
   ssh-keygen -t ed25519 -C "btg-hetzner"
   cat ~/.ssh/id_ed25519.pub
   ```

4. In the project, open **Security → SSH keys → Add SSH key** and paste the `.pub` line. Never paste the file without `.pub`; that is your private key.

## 2. Create the server

In the project, click **Add server**:

- **Location**: the one closest to your users. Plan availability varies by location, and US locations offer fewer types.
- **Image**: Ubuntu 24.04.
- **Type**: **CX33** (4 vCPU, 8 GB, x86) to launch. **CX43** if you want more headroom and it is offered. **CAX21** (4 vCPU, 8 GB, ARM64) also works. Do not pick a plan under 4 GB of RAM: `deploy/install.sh` refuses to install there.
- **Networking**: keep public IPv4 and IPv6.
- **SSH keys**: tick the key from step 1. Hetzner then disables root password login.
- **Backups**: turn on. It adds 20% to the server price and keeps daily snapshots of the whole disk. This matters because the nightly database dumps are stored on the same disk as the database ([common.md → Backups](common.md#backups)).
- **Name**: for example `btg-1`.

Click **Create & Buy now**. Note the IPv4 and IPv6 addresses on the server's page.

## 3. Create a firewall

In the project, open **Firewalls → Create Firewall**. Inbound rules:

| Protocol | Port | Source |
|---|---|---|
| TCP | 22 | Any IPv4, Any IPv6 |
| TCP | 80 | Any IPv4, Any IPv6 |
| TCP | 443 | Any IPv4, Any IPv6 |
| ICMP | — | Any IPv4, Any IPv6 |

Leave outbound open. Under **Apply to**, pick your server. Postgres (5432) and the app's port (3000) are never opened: both listen on the server's loopback address only.

Hetzner blocks outbound port 25 on new accounts. That does not matter here: password-reset email goes through Resend over HTTPS.

## 4. Add DNS records

At your domain's DNS provider, add:

- an **A** record: `$HOST` → the server's IPv4 address;
- optionally an **AAAA** record: `$HOST` → the server's IPv6 address. Hetzner shows a `/64` network such as `2a01:4f8:c0c:1234::/64`; the server's address is that network with `1` appended, `2a01:4f8:c0c:1234::1`.

If the domain uses Cloudflare, set the records to **DNS only** (grey cloud), not proxied. Wait until `dig +short $HOST` on your computer prints the server's IP.

## 5. Install packages and Bun, and clone the repository

From your computer, `ssh root@$IP`. Then, on the server:

```sh
apt update && apt upgrade -y
apt install -y git rsync curl unzip bubblewrap util-linux python3 poppler-utils ghostscript
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version
```

If `apt upgrade` installed a new kernel, run `reboot`, wait a minute, and SSH in again.

Clone with a read-only GitHub deploy key:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/btg_deploy -N "" -C "btg deploy key"
cat ~/.ssh/btg_deploy.pub
```

On GitHub, open the repository's **Settings → Deploy keys → Add deploy key**, paste that line, and leave **Allow write access** unticked. Then:

```sh
cat >>~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/btg_deploy
  IdentitiesOnly yes
EOF
git clone git@github.com:<owner>/<repo>.git ~/btg
cd ~/btg
```

## 6. Set up Postgres

```sh
sudo deploy/setup-postgres.sh
```

This installs Postgres 16, binds it to `localhost`, allows the `btg` role from `127.0.0.1` only, sizes its memory for the server, and creates the `btg` and `btg_test` databases. It creates `/etc/btg/btg.env` (root only, mode 0600) and writes a random `DATABASE_URL` into it. The password is never shown.

Rerunning it is safe. Once `DATABASE_URL` is set, it never changes the URL or the password.

## 7. Fill in the environment and install

```sh
sudo nano /etc/btg/btg.env
```

Fill in every variable in [common.md → Environment](common.md#environment) except `DATABASE_URL`, which step 6 already wrote. Leave `STRIPE_PRICE_ID` and `STRIPE_WEBHOOK_SECRET` as they are for now; step 9 fills them in. In nano, save with Ctrl+O, Enter, and quit with Ctrl+X.

Then install:

```sh
sudo BUN="$(command -v bun)" deploy/install.sh
```

The script checks the packages and the [sandbox](common.md#sandbox), sizes `btg.service` to this server ([machine sizing](common.md#machine-sizing)), builds, applies migrations, and waits for the app to answer. If you skipped step 6, the first run creates the env file and stops; fill it in and run the command again.

Read any `warning:` lines. A sandbox warning means code exercises and PDF attachments will be unavailable; the rest of the app works.

## 8. Put Caddy in front

```sh
sudo deploy/setup-proxy.sh $HOST
```

This installs Caddy, gets a Let's Encrypt certificate for `$HOST`, redirects HTTP to HTTPS, and forwards to the app on `127.0.0.1`. DNS from step 4 must already point at the server.

## 9. Connect Stripe

Follow [common.md → Stripe](common.md#stripe): run `scripts/stripe-setup.ts`, put the printed `STRIPE_PRICE_ID` and `STRIPE_WEBHOOK_SECRET` in `/etc/btg/btg.env`, then `sudo systemctl restart btg`. Also do [Turnstile](common.md#turnstile) if you haven't, and set the [OpenRouter credit limit](common.md#openrouter).

## 10. Verify

```sh
curl -fsS https://$HOST/api/health && echo OK
systemctl status btg caddy postgresql --no-pager
systemctl list-timers btg-backup.timer --no-pager
sudo systemctl start btg-backup.service && sudo ls -l /var/backups/btg
```

Open `https://$HOST` in a browser, sign up, and make a lesson.

### Updating

```sh
cd ~/btg && git pull && sudo BUN="$(command -v bun)" deploy/install.sh
```

### Troubleshooting

- **`install.sh` stops with "missing packages"**: run the `apt install` line it printed, then rerun.
- **`btg.service did not become healthy`**: `journalctl -u btg -n 50`. An env error names the variable to fix in `/etc/btg/btg.env`.
- **Migrations fail to connect**: `systemctl status postgresql@16-main`. Rerun `sudo deploy/setup-postgres.sh`; it repairs the config without changing the password.
- **No certificate / browser warning**: `journalctl -u caddy -n 50`. Usually DNS does not point at the server yet, or the firewall is missing port 80 or 443 (Let's Encrypt connects over both). With an AAAA record, IPv6 must reach the server too.
- **Sandbox warning, or the log says `sandbox: cgroup setup failed` or `code: sandbox unavailable`**: code exercises and PDF attachments are off. See [common.md → Sandbox](common.md#sandbox). `ls /etc/apparmor.d/btg-bwrap` shows whether the AppArmor exception was installed.
- **`pg_dump is version N but the database server is M`**: install the matching `postgresql-client-M` and rerun `install.sh`.
- **SSH refused**: check the firewall allows TCP 22 and that you use the key from step 1. The Cloud Console's server page has a web **Console** for emergencies.
- **Server feels slow**: `systemctl status btg` shows memory against `MemoryMax`. Resize the server in the Cloud Console (**Rescale**), then rerun `install.sh` and `setup-postgres.sh` to recompute the limits.
