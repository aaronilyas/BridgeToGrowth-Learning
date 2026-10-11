# Verification resend follow-up — 2026-10-11

The user reported no verification message after account creation and then no
message after the Resend button became available. Read-only inspection of the
ordinary backend confirmed:

- Recovery for a number without an account created an ineligible challenge.
- Signup followed 47.8 seconds later, inside the recipient-wide 60-second
  cooldown, so that signup challenge was also marked ineligible.
- The subsequent `POST /auth/resend` returned 202 and updated the challenge's
  send timestamp, but retained `eligible=false`. No verification transport failure
  was logged because the transport was never invoked.

Expected: once cooldowns expire, resending a signup challenge for an unoccupied
number dispatches a fresh verification code. Actual: the initial cooldown
permanently suppressed that challenge, including subsequent resends.

`Accounts.resend` now rechecks signup eligibility after both challenge and
recipient-wide cooldown checks. An unoccupied number becomes eligible; an occupied
number remains suppressed. Existing blocked signup challenges can recover without
a schema migration or manual database update. Recovery for unknown accounts is
unchanged. Expiry, attempts, consumed-challenge checks and generic 202 responses
continue to apply.

A real FastAPI regression reproduced the original failure: after unknown-account
recovery, signup at +47 seconds, and resend after another 60 seconds, the mock
transport was still called zero times. With the fix it is called once, verification
succeeds, and login works. Additional tests preserve cross-challenge cooldowns,
occupied-number signup suppression, unknown-account recovery suppression, and
non-disclosing responses. All 16 authentication tests pass.

All 74 required backend acceptance tests pass with zero skips (87.042 seconds).
The full required acceptance suite is recorded privately at
`.local/iphone-testing/verification-resend-acceptance.log`. Provider transport is
substituted in these tests; no live message is sent by the agent. Database inspection
printed only eligibility, purpose, timestamps and account-existence booleans,
never recipients, passwords, code hashes, verification codes or tokens. A physical
screenshot was attempted without interacting with the app, but the existing
automation session was unavailable.

The coordinator image is rebuilt and the coordinator alone is gracefully restarted
after acceptance, leaving PostgreSQL, messaging, existing data and any draining
requests intact. The fix does not trigger a message automatically. The user must
request a resend once permitted, or start a fresh signup if the challenge expired.
Actual provider acceptance and delivery remain unverified until a live request is
made by the user or explicitly authorized.

## Subsequent live attempt: Photon recipient restriction

The user then submitted a new signup themselves. Read-only inspection confirmed
that the running coordinator contained the resend fix, the new challenge was
eligible and unexpired, and a verification transport failure was logged. The
initial cooldown defect no longer explained this attempt.

Read-only provider diagnostics using the messaging container's existing process
credentials found that project authentication succeeds, iMessage is enabled, the
project is named `BridgeToGrowth-Learning`, and it uses the free/shared mode. A
read-only gRPC chat lookup for the signup recipient returned:

```text
[spectrum-imessage] Target not allowed for this project
```

No chat was created and no message was sent by the diagnostic. Temporary SDK
authentication material remained in process memory and was never printed. This
confirms a provider recipient-access restriction; it does not establish whether
the number is missing from the project's Users list or has another authorization
problem. The user was asked to check the correct project's Users list. The shared
browser reached Photon sign-in, so authenticated recipient management was not
available. No external user was created, permissions changed, paid plan selected,
invitation sent, or additional live verification attempted by the agent.

## Authenticated dashboard follow-up

After the user signed into Photon, read-only dashboard inspection confirmed that
the running service's project ID exactly matches the dashboard project. The
signup recipient exactly matches the sole listed user, which is marked active,
has `type=shared` and `meta.project_owner=true`, and has an assigned shared-pool
number. The user was created on 2026-10-10, before the failed signup attempts.
The dashboard confirms the free plan and no dedicated lines, as expected for
shared mode. Missing user registration and a mismatched project are ruled out.

A newly issued SDK token has the running project ID as its subject. With this
fresh token, both read-only `chats.get("any;-;" + recipient)` and
`addresses.get(recipient)` still fail with `internalError` and
`Target not allowed for this project`. Alternate chat identifiers are rejected
as invalid arguments; the installed SDK uses the documented `any;-;` format.
These checks do not create chats or send messages. The coordinator, messaging
service, and PostgreSQL remain healthy; restarting the backend is not a supported
remedy for this reproduced provider restriction.

Photon's [Stable troubleshooting documentation](https://photon.codes/docs/spectrum-ts/troubleshooting/imessage)
describes the shared-plan recipient allowlist and recommends checking the actual
iMessage handle when a registered user is still rejected. The user was asked to
check whether the signup number is enabled in iPhone Messages → Send & Receive;
this check sends no message. If that number is enabled, Photon needs to investigate
the registered recipient's shared-pool authorization/routing. The observed
read-only restriction alone does not prove the precise internal cause of the
earlier send failure, which the service deliberately reports generically.

No user was deleted or recreated, no permissions or subscription were changed,
no credential was rotated, and no live message or video was generated by the
agent. Sanitized evidence is in
`.local/iphone-testing/verification-provider-diagnostic.json`; it contains no
recipient number, verification code, password, or authentication token.
