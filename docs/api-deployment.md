# API Deployment

The API image is separate from GitHub Pages. Pushing this repository tests the
image but does not deploy it or modify IAM. Production client endpoint constants
remain disabled until a hosted release is verified. No email sender is started.

## Package And Test

```sh
docker build --tag recseason-api:test .
node tests/container-smoke.mjs
```

The Docker context is an allowlist: server modules, the server entrypoint,
explicit shared domain and scoring modules, and the npm manifests. It excludes `.tools`, `.git`, local
credentials, emulator data, frontend assets, and tests. Dependencies are installed
from the lockfile with development dependencies and install scripts excluded.
The process runs as the image's non-root `node` user. CI verifies it with a
read-only filesystem and no Linux capabilities, cloud credentials, or database.

`GET /healthz` reports process liveness only. It does not prove Auth permissions,
Firestore permissions, database availability, or end-to-end acceptance. All API
mutations still require a Firebase ID token; the probe cannot access private data.

## Automatic Scoring Gate

`POST /api/games/plays` is tested with local Auth and Firestore emulators. Production
scoring is disabled unless `RECSEASON_AUTOMATIC_SCORING=v1` is explicitly set.
Do not set that flag for the initial API deployment. First deploy and verify the
candidate rules that deny manual score writes to automatic games, complete the
league-policy configuration, client session/error handling, corrections, and
controlled-game acceptance tests described in `automatic-scoring.md`. Roll back
by disabling the flag without removing the direct-write restriction.

The endpoint accepts only the game ID, expected score revision, engine version,
and versioned action. Identity comes from the verified bearer token. Each user
has an independent durable scoring throttle of one request per second; notice
and deletion throttles remain unchanged. A timeout is not proof of a failed write:
refresh the game and history before deciding whether to submit again.

## Production Release Gates

1. Obtain approval for usage-based Cloud Run hosting in `bosse-testing`. A read-only
   check on 2026-10-12 confirmed billing and the Run, Functions, and Build APIs are
   enabled; it did not create a service or grant permissions.
2. Use a dedicated runtime service account, not a project-wide Editor account.
   Grant Firestore data access only with a database condition matching
   `projects/bosse-testing/databases/recseason`. Never grant access to `(default)`
   or `umpcalendar`. Auth needs user-read permissions for current identity and
   revoked-token checks, not user creation or modification. Keep build/deploy
   permissions on a separate identity. Do not create downloadable service keys.
3. Build the reviewed commit, record the immutable image digest, and deploy that
   digest. Set minimum instances to zero, maximum instances to one, concurrency
   to 16, and request timeout to 30 seconds for the initial pilot. These are
   capacity limits, not a spending cap. Review a billing budget and alert policy.
4. Cloud Run provides `PORT`; the production process binds `0.0.0.0`. Do not set
   emulator variables or add service-account JSON to the image. Cloud Run's service
   identity supplies credentials. Browser Firebase tokens are validated by this
   application; Cloud Run's own IAM authentication is a separate mechanism.
5. Verify liveness, missing/invalid-token rejection, allowed-origin preflight,
   foreign-origin rejection, and generic errors on the hosted URL. Then verify
   one consented invitation with a real verified account and named-database
   records. Test identity revocation, stale child links, and durable rate limiting.
   Do not claim production acceptance from an unauthenticated health check.
6. Audit and save the currently deployed named-database rules, deploy the candidate
   rules using `firebase.production.json`, and configure the verified HTTPS parent
   endpoint in `parent-invitation-client.mjs`. Release and verify Pages assets.
   Confirm that direct parent acceptance is denied and HTTP acceptance succeeds.
7. Keep notification endpoints disabled in the browser until sender/domain,
   provider, scheduler, indexes, and controlled-inbox tests are complete. Hosting
   this API alone does not send email or satisfy notification delivery gates.

## Rollback

Keep the last verified image digest, Cloud Run revision, Pages commit, and named
Firestore rules snapshot. Roll back the API revision and disable the client
endpoint if acceptance cannot be verified. Keep direct parent acceptance denied;
do not restore the bypass as an availability workaround. An accepted invitation
and its profile change are atomic and must not be replayed or manually undone
without reviewing the current account role and links.

## References

- [Cloud Run container contract](https://docs.cloud.google.com/run/docs/container-contract)
- [Cloud Run service identity](https://docs.cloud.google.com/run/docs/configuring/instances/service-identity)
- [Firestore per-database IAM conditions](https://cloud.google.com/blog/products/databases/firestore-multiple-databases-is-now-generally-available)
- [Firebase Authentication IAM permissions](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth)
