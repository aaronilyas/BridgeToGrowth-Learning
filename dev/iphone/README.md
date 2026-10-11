# Physical iPhone development

The setup helpers operate the existing checkout and preserve the backend's
loopback binding. The optional QA helpers below exercise real FastAPI contracts
against a disposable database with substituted providers. They never send real
verification messages or call Gemini or Photon.

Use Python 3 and a supported Node LTS release (22.13+). On this Mac the helpers
prepend Homebrew's `node@22` without changing the shell's global Node version.
Install the separate automation tools once with:

```sh
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm ci --prefix dev/iphone/tools
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm ci --prefix frontend
```

The frontend `.npmrc` matches its existing lockfile's legacy peer-resolution mode;
no Expo or React Native upgrades are required. To validate the frontend:

```sh
cd frontend
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npm run typecheck
npm run lint
npm run check:expo
../dev/iphone/tools/node_modules/.bin/expo-doctor
```

From the repository root, prepare/start services:

```sh
python3 dev/iphone/run.py configure
python3 dev/iphone/run.py backend-start
python3 dev/iphone/run.py forward-start
python3 dev/iphone/run.py metro-start
python3 dev/iphone/run.py appium-start
python3 dev/iphone/run.py readiness
```

`configure` selects the active interface, writes the public API origin to
`frontend/.env`, and preserves a private backup if that file already existed.
Only that public key is changed. It never copies backend secrets into the frontend.
Local settings, device identifier, signing team, PIDs, builds, screenshots and logs
live in ignored `.local/iphone-testing/` with owner-only permissions. Native
projects, provisioning profiles and environment files are not committed.

The forwarder binds only the selected private LAN address on port 8765. It accepts
clients from the configured trusted /24 or narrower subnet, allows only public
auth/account/lesson routes, and forwards only to loopback FastAPI. It blocks
private callbacks, `/video`, API docs, encoded paths, queries and absolute URLs.
Its diagnostic `/__btg_readiness` endpoint is served locally. Request logs contain
only peer address, method, public path and status; headers and bodies are not logged.
Use it only on the trusted test network. It uses development HTTP; production API
configuration must use HTTPS. Database, messaging and Docker listeners stay private.

Metro uses its normal LAN development listener. Appium binds only to
`127.0.0.1:4723`, with no relaxed-security or insecure-feature flags. These three
processes run detached and survive the setup terminal closing; they do not restart
automatically after reboot. Rerun their start commands after reboot or after stopping.
After an IP/network change, stop test services, rerun `configure`, restart them,
and rebuild/relaunch the app so its embedded API origin and Metro IP are current.
Appium logs only warnings/errors; command bodies and typed credentials are not
logged at info/debug level.

## Signing, building and installing

Keep the phone connected, unlocked and trusted, with Developer Mode and
Settings → Developer → Enable UI Automation enabled. A valid existing Apple
Development identity and device provisioning profiles are required. Local
`settings.json` must contain `udid`, `team_id` and `wda_bundle_id`. Discover the
device with `xcrun devicectl list devices`, and inspect the team in existing
certificates/profiles. Do not put these values in tracked files.

The setup user authorized development identifier/profile provisioning through
their existing team. Do not change Apple credentials, certificates or security
settings. Any new account/security operation requires separate authorization.

```sh
python3 dev/iphone/run.py build-install
# Reinstall/launch the existing signed build without recompiling:
python3 dev/iphone/run.py install-launch
# If first launch races Metro startup, restart only the app:
python3 dev/iphone/run.py relaunch
```

This uses Expo's `run:ios --device ... --no-bundler` workflow and the already
running Metro server. `BTG_IPHONE_DEV=1` opts into a local-network usage description;
ordinary/production Expo config is unchanged. Generated native code is ignored.
For manual prebuild, run `BTG_IPHONE_DEV=1 npx expo prebuild --platform ios`, then
install pods if necessary before opening the generated `.xcworkspace`.

For WebDriverAgent, find its npm package from
`dev/iphone/tools/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent`.
Build `WebDriverAgentRunner` with `xcodebuild build-for-testing`, the local team's
`DEVELOPMENT_TEAM`, the local `wda_bundle_id` as `PRODUCT_BUNDLE_IDENTIFIER`,
`CODE_SIGN_STYLE=Automatic`, `CODE_SIGN_IDENTITY='Apple Development'`, the local
device destination and `.local/iphone-testing/wda-build` as derived data.
Use `-allowProvisioningUpdates` only within the authorized development-profile
scope. The XCUITest driver then runs the prebuilt signed WDA over USB.

The repeatable command is `python3 dev/iphone/run.py wda-build`. It reads all
signing/device values privately and uses provisioning updates only when the local
`development_provisioning_authorized` setting records the user's authorization.

## Connecting the next testing agent

```sh
python3 dev/iphone/appium.py session
python3 dev/iphone/appium.py device-info
python3 dev/iphone/appium.py source
python3 dev/iphone/appium.py screenshot
# Inspect the current source before selecting an accessibility label:
python3 dev/iphone/appium.py tap --label 'Create account'
```

The client uses the W3C HTTP API directly, so no Python client dependency is
needed. The session ID is saved privately in `session.json`; the next agent can
use `http://127.0.0.1:4723/session/<sessionId>` or create a session using the
capabilities in `appium.py`. Sessions preserve app data (`noReset`) and expire
after one hour without commands. Screenshot and tap commands verify that
BridgeToGrowth is foreground before operating. Screenshots/source can contain
user data during later tests; keep those ignored artifacts private.

`readiness` verifies Mac services, the current physical Appium/app state, and
reports the timestamp of earlier device-network evidence. A READY verdict also requires actual
device launch, a network request from that device/app, screenshot/element discovery
and a verified harmless interaction. Mac HTTP checks alone cannot prove this.
See the local `readiness.md` for this setup run's actual evidence and blockers.
The setup verified the app's API connection with one synthetic invalid login:
the physical app sent `POST /auth/login`, FastAPI returned 401, and the app showed
the matching authentication error. Login does not send verification messages.
Probe inputs were cleared afterwards. No real account credentials were used.
Do not repeat this automatically during readiness checks: login attempts are
rate limited, and later testing may have a real account open.

## Physical-device functional QA without provider calls

`qa_backend.py` creates a new, uniquely named PostgreSQL container with tmpfs
storage and a random password. It overrides any inherited database URL. It runs
the repository's real FastAPI routes, authentication, opaque-token sessions and
lesson state machine. Verification transport, generation, rendering, evaluation
and delivery are substitutes; the fake video bytes are never sent externally.
This proves API/UI integration, not provider availability or output quality.
Loopback-only `/__qa/control` captures synthetic verification codes, advances the
test clock and injects response failures. The LAN bridge blocks that route.

Use the repository's backend/test requirements in a local virtual environment:

```sh
python3 -m venv .local/iphone-testing/venv
.local/iphone-testing/venv/bin/pip install -r backend/requirements.txt -r backend/tests/requirements.txt
# Keep this running in a separate terminal; Ctrl-C gracefully drains the server
# and removes only its own disposable QA database.
.local/iphone-testing/venv/bin/python dev/iphone/qa_backend.py
```

Then switch the existing restricted bridge and run these stages in order on a
signed-out app. Start with a fresh QA database and remove only the private
`qa-evidence/credentials.json` before a repeat session so fresh synthetic
credentials are created. Preserve old evidence in a private directory first.

```sh
python3 dev/iphone/run.py qa-forward-start
python3 dev/iphone/appium.py session
python3 dev/iphone/qa.py signup
python3 dev/iphone/qa.py lessons
python3 dev/iphone/qa.py faults
python3 dev/iphone/qa.py account
python3 dev/iphone/qa.py recovery
python3 dev/iphone/qa.py configuration
```

Every mutating QA stage checks the bridge response's QA marker before proceeding.
`probe` is separate: it performs a synthetic invalid login against the ordinary
API and never requests verification. Do not use production accounts with these
scripts. Evidence and synthetic credentials remain ignored and owner-only in
`.local/iphone-testing/qa-evidence/`. The device tests require the phone to remain
unlocked. The helper declines the known iOS Save Password prompt with **Not Now**;
it never saves test passwords. The recovery fixture advances its isolated clock
to respect the real recipient-wide verification cooldown.

For a physical offline check, record the original radio settings, enable Airplane
Mode with Wi-Fi disconnected, and verify the app's offline banner and paused
requests. Restore the original settings afterwards. Radio changes can restart
WebDriverAgent's transport; restore connectivity and recreate the session if
needed. An Expo Debug build also needs Metro to reload its JavaScript on a cold
launch. See the dated report for the actual offline and relaunch results.

Before returning to the ordinary backend, log out from the QA app, switch the
bridge back, then stop the QA server:

```sh
python3 dev/iphone/run.py production-forward-start
# Ctrl-C in the QA backend terminal; do not remove unrelated containers.
python3 dev/iphone/run.py relaunch
python3 dev/iphone/run.py readiness
```

The required backend acceptance suite also uses its own disposable database and
isolated renderer containers. With the existing local images built, repeat:

```sh
USER_CONTAINER_IMAGE=btg-renderer:local RENDERER_EGRESS_IMAGE=btg-egress:local \
COORDINATOR_TEST_IMAGE=btg-learning-coordinator MESSAGING_TEST_IMAGE=btg-learning-messaging \
.local/iphone-testing/venv/bin/python -m backend.tests.run_acceptance
```

## Safe stopping

```sh
python3 dev/iphone/appium.py close
python3 dev/iphone/run.py stop
```

`stop` gracefully signals only recorded, verified process groups for the test
forwarder, Metro and Appium. It does not stop Docker, backend services, active
jobs, dynamic renderer containers, or remove app/database data. If the backend
must also be stopped, explicitly run the repository's `./stop-backend.sh`, which
waits indefinitely for active jobs while keeping dependencies available. Never
use `docker compose down -v`, kill active renderers, or reset the database.
