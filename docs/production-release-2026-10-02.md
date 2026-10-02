# Production Release Verification: October 2, 2026

Verified release: `3373c279b65b82869f851617a42afe0742f4a479`.
GitHub Actions run: https://github.com/CBosse/recseason/actions/runs/37007114544

## Evidence

- Deployment completed successfully. Syntax, regression tests, Firestore
  authorization, authenticated emulator workflows, recovery tests, assembly,
  artifact upload, and Pages deployment all passed on this commit.
- Before deployment the open production page referenced unversioned `app.js`.
  After deployment and normal reload, it referenced
  `assets/baa3f05dc81053d24e5c/app.js` and the stylesheet under the same directory.
- The sign-in screen initialized with no browser error logs.
- Continue as visitor opened the production schedule, loaded the configured
  season dates, and showed the expected empty-game state without errors.
- No production accounts, games, players, or settings were changed.
- Screenshot: local `.tools/production-release-3373c27.png`.

## Remaining Verification

This is a deployment and anonymous-read smoke test, not a production pilot.
Authenticated role journeys, real invitation delivery, consented pilot data,
second-device testing, and operational recovery remain required by the overview.
It does not prove all requirements for the full MVP.

CI also reported deprecated Node 20 action runtimes and setup-java v4, plus an
upcoming ubuntu-latest image change. The run succeeded, but the workflow should
be updated and retested before relying on those moving defaults for a release.
