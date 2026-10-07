# Release Verification and Rollback

The Pages workflow now compares every published HTML, JavaScript, module and CSS
file to the SHA-256 checksums generated during that same build. Verification runs
after deployment. A missing, stale or altered file fails the workflow; up to five
attempts allow brief propagation delays. This is a read-only check.

The workflow uses Ubuntu 24.04 explicitly and pins its top-level GitHub actions to
reviewed release commit hashes. Action execution uses Node 24; application tests
remain on Node 22 and the Firestore emulator uses Java 21. Update the hashes and
version comments together when maintaining CI, and require a complete successful
deployment plus live checksum verification before accepting a tooling upgrade.

Regenerate dependency lockfiles with npm 10.9.9, matching the verified Node 22 CI
toolchain: `npm exec --yes --package=npm@10.9.9 -- npm install --package-lock-only --ignore-scripts`.
Before pushing dependency changes, run
`npm exec --yes --package=npm@10.9.9 -- npm ci --dry-run --ignore-scripts --no-audit --no-fund`.
Then require the real Linux clean install and complete deployment to pass. A local
incremental install is not sufficient: npm 11 previously omitted a nested picomatch
dependency from the lockfile even though local tests continued to run.

`dist/release.json` records the expected release version and file checksums.
`node scripts/verify-release.mjs` checks the production Pages URL against that
local manifest. Do not download an untrusted manifest from the live site and treat
it as independent proof. Use the manifest retained with the approved CI artifact.
Windows and Linux checkouts can differ in line endings, so a local rebuild is not
necessarily byte-identical to the deployed CI artifact.

## Recovery Procedure

1. Identify the failed release commit and the last known-good workflow run.
2. Inspect the failed verification file and compare the expected build artifact.
   A green checksum check proves file identity, not working business behavior.
3. Choose an operator-approved rollback commit. Review intervening Firestore
   schema and rules changes before reverting application code. Do not blindly
   restore older rules or production data.
4. Revert the faulty application change through a reviewed commit and push it.
   The normal workflow rebuilds, tests, deploys, and verifies the rollback release.
5. Confirm the live verification step passes, then smoke-test sign-in, reads and
   the affected workflow using consented pilot accounts.

This procedure has not yet been rehearsed as a production rollback. A failed
post-deploy check does not automatically restore an older release. Rules deployment,
data recovery, external Firebase availability, runtime errors, authenticated pilot
journeys and alert delivery remain separate operational requirements.
