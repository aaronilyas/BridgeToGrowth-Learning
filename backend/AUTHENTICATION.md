# Authentication and account onboarding

## Status: provider selection blocks end-to-end onboarding

The repository defines `AUTH_INTROSPECTION_URL`, but does not select an identity
provider or supply a provider-specific signup, login, or phone verification flow.
The generic introspection adapter is an integration boundary, not a complete
provider implementation. Provider-specific onboarding cannot be completed until
the provider and its client flow are selected. No local credential system,
signup/login endpoints, or provider SDK has been introduced.

To unblock integration, supply the provider choice, its signup/login and phone
verification flow for the mobile client, and a trusted introspection endpoint
implementing the contract below. The provider must supply a stable UUID identity;
mapping a provider's non-UUID subject requires an explicit design decision.
Do not configure a provider's endpoint by assuming it implements this contract:
standard OAuth introspection may use POST and different response fields.

## Existing identity contract

For each protected request, `Integrations.authenticate` sends an HTTP GET to
`AUTH_INTROSPECTION_URL` with `Authorization: Bearer <session>`. Configure a trusted
endpoint and use HTTPS for remote URLs. Its JSON response must contain:

```json
{
  "active": true,
  "user_id": "c50decc4-87f9-42ab-8b67-5ce7beee3e04",
  "phone_number": "+15551234567",
  "phone_verified": true
}
```

The provider owns credentials, session issuance, expiration/revocation, and phone
verification. Both flags must be JSON `true`; the ID must parse as a UUID, and the
phone must match `\+[1-9][0-9]{7,14}`. `backend/auth.py` validates this response and
returns the UUID and verified phone to the API. Missing or non-bearer credentials
return HTTP 401 without contacting the provider. Inactive sessions, malformed
responses, missing configuration, and provider errors also return HTTP 401.
All these responses include `WWW-Authenticate: Bearer`; provider exception details
are not returned. Invalid authentication creates no account or job and refreshes
no user's activity.

## Client onboarding sequence

1. Complete signup/login and phone verification with the selected provider.
2. Obtain its session token and call `PUT /account` with
   `Authorization: Bearer <session>`. No request body is required. Identity and
   recipient come exclusively from the provider, including when a body is sent.
3. Expect HTTP 200 with `{ "id": "<stable UUID>", "phone_number": "+15551234567" }`.
   Repeating registration with the same identity and phone returns the same
   account. A phone already assigned to another identity, or changing an existing
   identity's phone, returns HTTP 409. Phone updates remain a product decision.
4. Use the session token on lesson submission and polling requests. A valid
   identity that has not called `/account` receives HTTP 403 with
   `Register the account first` on lesson routes. Registration creates the account
   and container record; it does not start a container or generation job.

Authenticated requests for registered accounts refresh activity using the
existing registration and lesson dependencies. Rejected authentication does not.
Provider validation runs on every request so inactive sessions are rejected even
after successful registration. Session refresh and reauthentication belong to
the selected provider's client flow.

## Verification

From the repository root, after installing `backend/tests/requirements.txt`:

```sh
python3 -m unittest discover -s backend/tests -p 'test_auth.py' -v
python3 -m unittest discover -s backend/tests -v
```

The dedicated authentication suite uses a disposable in-memory SQLite database
and a mocked HTTP provider. It verifies rejection without side effects, identity
ownership, idempotency, conflicts, activity, and the existing GET/bearer contract.
It does not establish a live provider integration. Once selected, validate signup,
verified-phone onboarding, login, expiration, and revocation with test identities
against that provider before treating end-to-end onboarding as complete.
