# Messaging service on Node.js

The messaging service uses Node.js >=22.6.0 and npm. Production runs compiled
ES modules, so it needs neither Bun nor a TypeScript runtime loader. The npm
lockfile replaces `services/messaging/bun.lock` and resolves both `spectrum-ts`
and `@spectrum-ts/imessage` to the existing SDK version, 12.10.1.

From `services/messaging`:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm start
```

`npm test` builds and runs the compiled delivery tests using Node's test runner.
`npm run dev` builds and watches emitted JavaScript. After a TypeScript edit,
run `npm run build`, or keep `npm run build -- --watch` running in another
terminal. This also works with Node builds that omit TypeScript stripping. TypeScript 5.9
rewrites relative `.ts` imports to `.js` when emitting to `dist/`.

Supply `MESSAGING_TOKEN`, `PROJECT_ID`, and `PROJECT_SECRET` through the process
environment. Node does not automatically load `.env`; an operator who wants
explicit file loading can run `node --env-file=.env dist/index.js` after building.
Credentials were not accessed during this migration. `HOST`, `PORT`, and
`MAX_VIDEO_BYTES` retain their existing defaults and validation.

## Delivery contract

The service still accepts `POST /video` with a Bearer token, `X-Recipient` in
E.164 format, `X-Lesson-Job`, and a `video/mp4` body. It buffers a bounded upload
in memory and passes a Buffer to the Photon attachment builder. It writes no
video files. The response is `202` with `accepted: true` and `message_id` only
after Photon returns a nonblank message ID; rejection or an unsupported SDK
send returns `502`. Authentication and all other HTTP behavior are unchanged.
Shutdown stops accepting requests, finishes active HTTP deliveries, then stops
Spectrum.

## Verification and limitations

- On Node 23.5.0, typechecking, compilation, and all seven existing delivery
  tests passed against emitted JavaScript, including the real SDK attachment
  builder and rejected or missing provider acceptance IDs.
- All seven compiled tests also passed on the declared minimum Node 22.6.0.
  Directly stripping the test source on that release fails on TypeScript's
  definite-assignment declarations (`let accept!`); the supported `npm test`
  command compiles them first and avoids this runtime limitation. The source
  entry point itself loads on Node 22.6.0 and fails closed without a token.
- A compiled-entry-point smoke check confirmed failure without
  `MESSAGING_TOKEN`, then successful startup, HTTP authentication, in-memory
  attachment delivery, and SIGTERM shutdown. The check used the real Spectrum
  SDK with no cloud providers, a substituted cloud iMessage facade, and
  synthetic credentials. No real messages were sent.
- The installed core and cloud iMessage JavaScript contains no Bun-only API
  calls. No Node incompatibility was observed in the exercised paths. Live
  Photon authentication, cloud transport, and provider acceptance still require
  credentials and a permitted recipient; they were not verified here.
- The bundled SDK also installs providers this service does not use. This
  migration keeps the existing SDK imports and dependency scope; optional
  provider capabilities and native dependencies were not exercised.
- `npm audit` reports 18 moderate findings in the SDK's transitive
  OpenTelemetry dependency chain, including
  [GHSA-8988-4f7v-96qf](https://github.com/advisories/GHSA-8988-4f7v-96qf).
  These are dependency findings rather than observed Node incompatibilities.
  SDK upgrades or forced dependency overrides need a separate compatibility
  review.

Photon's upstream [contribution guide](https://github.com/photon-hq/spectrum-ts/blob/main/CONTRIBUTING.md)
describes running its tests under both Node and Bun; the checks above cover
this service's installed version and exercised paths.
