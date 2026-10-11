# Physical iPhone installation and QA — 2026-10-11

Branch: `testing/physical-iphone-2026-10-11`. Testing used the actual USB-connected
iPhone 13 Pro Max running iOS 26.7.1. No simulator fallback was used. Real
verification messages and provider-dependent video generation were disabled for
the entire session at the user's request. No accounts were deleted.

## Installation and connectivity

- Xcode 27.0, CocoaPods 1.16.2, Node 22.23.3, Python 3.12, Docker Desktop and
  Compose were available. Installed locked frontend, messaging and automation
  dependencies; used Node 22 locally without changing the global Node version.
- A fresh Expo/Xcode Debug build succeeded with zero build errors or warnings,
  was signed with the existing Apple Development identity, installed on the
  physical phone, and launched. Deep/strict signature verification passed.
  An earlier installation was present, so its data was preserved rather than
  uninstalling it. A completely fresh OS permission/onboarding state was not tested.
- The existing Compose PostgreSQL, messaging service and FastAPI coordinator
  remained healthy. The helper validates Compose and uses `start-backend.sh`
  when needed; this session reused the healthy existing stack without restarting it.
- The frontend uses `http://192.168.1.132:8765`. The temporary bridge binds only
  that private LAN address, accepts the trusted subnet, and forwards public
  auth/account/lesson routes to loopback. PostgreSQL, messaging, Docker control,
  private callbacks, video retrieval and API docs were not exposed by this bridge.
- Actual phone-origin `POST /auth/login` reached the ordinary coordinator and
  returned the expected 401 for synthetic invalid credentials. The app displayed
  the matching error. Successful authentication and lesson tests used the isolated
  QA coordinator described below.
- Development ATS has `NSAllowsArbitraryLoads=false` and local networking enabled;
  the development-only local-network usage description is present. Production
  configuration continues to require HTTPS.
- Appium 3.8.0 / XCUITest 12.17.1 / signed WebDriverAgent operated the physical
  device: screenshot, accessibility discovery, tap, typed input, navigation and
  screen assertions all worked. The user unlocked the device and confirmed that
  UI Automation was enabled. A stale WDA runner initially produced Apple Code 41;
  stopping that owned runner and establishing a fresh session resolved it.
- Final state: signed out, test inputs cleared, ordinary loopback coordinator
  restored behind the bridge, Metro and Appium available. A final physical login
  probe again returned the expected 401. The QA server exited gracefully and its
  owned temporary database was removed. Airplane Mode is off and the original
  Wi-Fi/cellular state is restored. Existing backend data and containers remain.

## Results

| Check | Result |
| --- | --- |
| Frontend Jest | 82 passed, 6 suites |
| Frontend TypeScript and ESLint | Passed |
| Expo dependency compatibility | Passed |
| Expo Doctor | 21/21 passed |
| Messaging unit tests, TypeScript and build | 12 tests passed; checks passed |
| Required backend acceptance | 71/71 passed, zero skips, 86.320 seconds |
| Physical UI scenarios | 33 passed; one offline cold-launch limitation |

Physical scenarios and evidence prefixes:

| Evidence | Behavior verified |
| --- | --- |
| 01–04 | Login launch, empty/short input validation, ordinary FastAPI invalid-login response |
| 05–08 | Signup challenge, wrong verification code/remaining attempts, correct verification, secure session restoration and actual refresh after termination/relaunch |
| 09–14 | One lesson despite repeated taps, progress polling, cancellation, overlong scope feedback, renderer failure, substitute acceptance with unconfirmed receipt, ambiguous delivery without replay, retained jobs after relaunch |
| 15–19 | Account details, logout/login, phone change and session revocation, login with the changed number |
| 20 | Polling stopped in background; foreground reconciled the completed job |
| 21–23 | Unknown server status did not imply success; injected 503 retained stale account details; explicit retry recovered |
| 24–26 | Malformed refresh signed out safely without replay; malformed login did not install a session |
| 27–29 | Logout everywhere, password recovery requiring login, successful login afterwards |
| 30–31 | Invalid API origin showed Setup required; restoring configuration preserved the session |
| 32, 34 | Actual Airplane Mode/Wi-Fi loss showed Offline and paused requests; original radios restored and the saved authenticated session recovered |

The captured result name for signup is `05-signup-challenge`: repeated signup
taps are not claimed. Repeated lesson submission taps were tested and produced
exactly one POST. Account deletion was intentionally not exercised.

## What was real and what was substituted

`qa_backend.py` runs the repository's real FastAPI application, Accounts, Service,
Argon password hashing, opaque-token rotation/revocation and PostgreSQL ORM in a
new tmpfs PostgreSQL container. Its database URL overrides inherited configuration;
the existing database is never used for QA mutations. Synthetic verification
codes stay in memory. Generation, rendering, evaluation and delivery are explicitly
substituted. No live Photon, Gemini or speech-service call is made.

Injected unusual responses are delivered before the real route runs. In particular,
the malformed-refresh device scenario does not actually consume the server token;
it verifies client handling of an uncertain response. Actual rotation, reuse and
revocation contracts are exercised by the backend acceptance suite.

The acceptance suite uses real disposable PostgreSQL and isolated renderer/egress
containers, including deterministic Manim fixtures and process/cancellation/cleanup
checks. Its providers and speech fixture are substitutes. It does not prove live
provider availability, generated lesson quality, real delivery or real read receipts.

## Reproduced issues and fixes

1. **Private proxy target timed out during reverse DNS.** The architecture test
   attempted CONNECT to `169.254.169.254:443` inside the isolated renderer. Expected:
   immediate denial. Actual: a three-second client timeout while the `dstdomain`
   ACL performed a lookup. Added Squid's `-n` option to the allowed-host ACL, rebuilt
   `btg-egress:local`, and reran the required acceptance suite. The private-target
   check now passes. [Squid ACL documentation](https://www.squid-cache.org/Doc/config/acl/)
   documents the lookup behavior. Logs: `acceptance.log`, `egress-build.log`,
   `acceptance-fixed.log`. This is a backend/container check, so a UI screenshot
   is not applicable.
2. **Process recovery fixture ended before reconciliation.** Expected: the test
   process stays active while recovery checks it. Actual: its fixed two-second
   sleep ended during Docker operations, causing an interrupted state assertion.
   Replaced the sleep with an explicit release marker and finally cleanup. The
   real process recovery test and all acceptance checks pass. Production lifecycle
   logic was unchanged.
3. **Development tooling interruptions.** Restarted the owned Metro after dependency
   installation invalidated its resolver cache. Recreated the stale WDA session;
   disabled native element caching and idle waits for timer-driven UI. Fixed QA
   field focus, button selection, visibility waits and known native password-save
   prompt handling. These are automation/setup repairs, not confirmed app defects.

No speculative frontend logic changes were made. The prompt was appended to the
end of the AI-generated section of `prompts.md` as requested.

## Evidence

All runtime evidence is private and ignored under `.local/iphone-testing/`:

- `device-build.log`: complete native build/install output.
- `acceptance-fixed.log`: final backend result; `acceptance.log`: initial failures.
- `qa-evidence/results.json`: 33 timestamped passing physical checks.
- `qa-evidence/<scenario>.png` and `.xml`: physical screenshots and accessibility trees.
- `qa-evidence/backend-observations.json`: sanitized QA request/status and job observations;
  no request bodies, passwords, tokens or real verification codes.
- `qa-evidence/accepted-visible.png`, `delivery-unknown-visible.png`: visible terminal
  delivery distinctions in addition to the numbered screen captures.
- `qa-evidence/32-physical-airplane-mode-pauses-requests.png` and
  `34-network-restored-session-preserved.png`: actual offline/recovery states.
- `qa-evidence/restore-network-state.png`: Metro's offline cold-launch error;
  `offline-limitations.json`: limitation and restored radio state.
- `forward.log`, `appium.log`, `device-network-evidence.json`: device network and
  automation diagnostics. `readiness.md` is an earlier setup snapshot; this report
  supersedes its deferred functional-testing statements.
- `qa-evidence/final-real-backend-connectivity.png` and `final-clean-login.png`:
  final ordinary-backend response and signed-out app state.

Screenshots and accessibility trees can contain synthetic account data and codes;
do not publish the private directory or its credentials file.

## Limits and repeat instructions

- **Offline cold launch:** this Expo Debug build cannot reload JavaScript from
  Metro with Wi-Fi/cellular disabled; it showed `No script URL provided`.
  The running app's offline banner/paused requests and recovery were verified.
  Offline cold-start session restoration still needs a development build with an
  embedded JavaScript bundle. An online termination/relaunch/refresh passed.
- **Crash reports:** Appium could not collect crash reports because its optional
  RemoteXPC tunnel was unavailable. USB WDA automation worked; screenshots, UI
  state, build and service logs were collected. No confirmed application crash
  was observed during the tested online flows.
- **Provider-dependent tests:** real verification, video generation, speech,
  delivery and read receipts remain intentionally untested under the user's
  explicit instruction. No live-account deletion was performed.

See [README.md](README.md) for setup, build, safe QA stages, normal/QA bridge
switching, acceptance commands and stopping. Keep the phone unlocked, USB connected
and on the Mac's trusted network. Start the disposable QA server, switch the bridge
to it, then run `signup`, `lessons`, `faults`, `account`, `recovery`, `configuration`
in that order on a signed-out app. Log out before returning the bridge to the
ordinary backend. Stop only the QA server's owned container. Restore normal
Auto-Lock after the session. No push, deployment or external account action is needed.
