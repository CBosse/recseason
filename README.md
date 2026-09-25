# RecSeason

Recreational league management using a static JavaScript interface, Firebase
Authentication, and the named Firestore database `recseason`.

## Development and verification

Serve this folder over HTTP (`python -m http.server 8080`) and open
http://localhost:8080. Firebase configuration lives in `firebase-config.js`.
The application requires an appropriately configured Firebase project; a local
server alone does not provide an offline database.

Run `node --test tests/*.test.mjs` and `node --check app.js` before publishing.
The GitHub Pages workflow runs both checks before deployment.

For authorization tests, install Node 22, Java 21, and run `npm ci` followed by
`npm run test:rules`. Tests use the Firestore emulator at 127.0.0.1:8180 and the
non-production project ID `demo-recseason`. No Firebase login is needed. On this
workstation Java 21 is available under `.tools/java21`; set `JAVA_HOME` to its
JRE folder and prepend `$env:JAVA_HOME/bin` to PATH for the test command.

`firestore.rules` was deployed to the named production `recseason` database on
September 25, 2026, replacing expired test-mode rules that denied all client access.
`firebase.test.json` is emulator-only; never use it for production deployment.
Use `firebase deploy --project bosse-testing --config firebase.production.json
--only firestore:rules --non-interactive` for the named database only.
Before any future rollout, run `node scripts/audit-production.mjs`. It uses the
Firebase CLI login, reads production without changing it, saves deployed rules
under ignored `.tools/production-audit`, and reports schema/reference issues
without printing personal data. It depends on the pinned Firebase CLI internals.
The audit snapshot is a rules rollback reference, not a database backup.
Production role acceptance tests remain required before a live season.
GitHub Pages publishes only static application files, not dependencies or tests.
The initial tooling audit reports six moderate advisories in development-only
dependencies. Track updates to Firebase CLI and its transitive dependencies;
these packages are excluded from the published application.

## Local sample season

With Java 21 and Node 22 on PATH, run `npm run emulators` in one terminal. In a
second terminal run `npm run seed:local`, then serve the repository over HTTP and
open `http://127.0.0.1:8080/?emulator=1`. The query parameter is required; ordinary
URLs still use the configured production project. Emulator mode is restricted to
localhost and uses a separate Firebase app/auth session and the `demo-recseason`
project's named `recseason` database.

Sample accounts are `siteadmin@recseason.test`, `leaguemanager@recseason.test`,
`teammanager@recseason.test`, `captain@recseason.test`, `player@recseason.test`,
`parent@recseason.test`, `umpire@recseason.test`, and `scorekeeper@recseason.test`.
All use the local-only password `LocalDemo123!`. The seed includes two teams,
three players, a lit field, and a scheduled game with an umpire and scorekeeper.
These accounts exist only in the local Auth emulator. The seed refuses to
overwrite an existing sample season; stopping the emulators discards its data.

`npm run test:workflows` starts disposable Auth and Firestore emulators, seeds
the season, signs in real emulator accounts, verifies scoped rosters and RSVPs,
records a live and final score, and checks the resulting standings. It then
stops the emulators. Stop an interactive emulator session before running tests
because both use the same ports. This is SDK integration coverage, not browser
acceptance coverage or proof of production deployment.

## Current behavior

- Schedules prevent overlapping field and team bookings, including buffer time.
- Organizers can add and edit games, including field, teams, duration and umpire.
  Validation checks field hours, season dates, daylight for unlit fields, and
  field/team/umpire conflicts. Completed games retain their participating teams.
- Fields can be edited with weekday, opening-hour and lighting validation against
  existing scheduled/live games. Unlit fields require a ZIP code; scheduling
  skips slots when daylight cannot be verified. Field-edit preflight checks are
  not yet serialized with concurrent game creation.
- Manually arranged games default to locked against regeneration. Locked and
  existing non-scheduled games reserve their time during generation.
- Retained games count toward their home-away matchup quota during regeneration.
  Cancelled games neither consume that quota nor block available time.
- Organizers can cancel scheduled games without deleting game or attendance
  history, then reschedule them through the game editor. Cancellation and result
  saves check the current game status in a transaction.
- Schedule replacement is one atomic batch, with a maximum of 500 combined
  deletions and additions. Larger changes are rejected without deleting data.
- Zero-capacity generation keeps the current schedule; incomplete schedules
  require confirmation.
- Final scores must be non-negative whole numbers. Result updates retain other
  game fields and fail if the game was deleted concurrently.
- Standings award three points for a win and one for a tie; ties in ranking use
  goal difference, goals scored, then team name. Invalid results are excluded.
- Account changes dispose database listeners and clear cached records.
- Participant dashboards follow linked teams/children; RSVP totals exclude
  archived players. Live games display live scores instead of RSVP prompts,
  and cancelled games are excluded from upcoming views. Dashboard records use
  the same validated results as the standings table.
- Organizers and the assigned team manager can edit team/player metadata with
  stale-edit checks. Players can be archived/restored without deleting account
  links or attendance history. Archived players cannot submit new RSVPs under
  the deployed rules. Teams with roster/game history and fields with games are
  protected from removal in the UI. These removal checks are not yet serialized
  with concurrent organizer writes; database-level referential enforcement is
  still required.
- Private player and attendance queries are scoped to linked players/children
  or the manager's team; organizers can access league records. Visitors do not
  request private player or attendance data. Team-wide participant views need a
  separate contact-free roster projection before they can be exposed safely.
- Game editors can assign a scorekeeper from registered scorekeeper accounts.
  Assigned scorekeepers and league organizers can save live totals, inning/half,
  balls, strikes, and outs, then finalize the result into the standings. Saves use
  transactions and score revisions to reject stale edits. The schedule displays
  live totals through its existing database subscription.

## Account setup

New accounts always start as players. To bootstrap a new deployment, the Firebase
project owner creates an account, then sets that account's `users/{uid}.role` to
`siteAdmin` in the named `recseason` database through Firebase Console. Existing
admin records continue to work. The app never chooses an administrator by counting
users. Other roles are assigned from the Admin Panel. Password recovery is available
on the sign-in screen.

This client change is not a substitute for deployed Firestore security rules.
Production role workflows still require validation before this app is ready for a
live season. The deployment audit found one existing admin profile; older profiles
without `linkedPlayerIds` are accepted as having no child links. The live anonymous
read check allows teams and denies players/users. Point-in-time recovery and deletion
protection are currently disabled; backups and recovery work remain outstanding.
Use a separate Firebase project for development and replace the public
client identifiers in `firebase-config.js` for that environment.

## Remaining work

Invitation domain validation and database rules are implemented and
emulator-tested. Only site admins may issue invitations, never for the site-admin
role. Acceptance requires a verified matching email and an atomic profile/invite
update; invitations expire within seven days and can be revoked. Parent invites
carry explicit child links. Automated invitation delivery and authenticated production
acceptance testing remain outstanding. The Admin Panel now creates shareable invitation links,
shows status, and revokes pending invitations. Recipients open the link, sign in
or register with the invited email, request verification if needed, and accept.
Acceptance reloads the account with its assigned role and links. Created links
expire after six days (the rules cap is seven). Invitations are not automatically
emailed; admins share the displayed link. Test invitations in the local emulators
before sending real invitations.

Production admin acceptance testing; captain attendance; per-inning linescores, runner tracking
and play logs; reminders;
backup and restoration; larger schedule publication; browser acceptance tests;
and production configuration/verification remain outstanding. The test suite
covers domain logic, subscription handling, emulator authorization, and authenticated
emulator workflows, not signed-in production acceptance.
The standalone `tests/game-editor.html` fixture exercises the editor without
connecting to Firebase or writing live records. Concurrent schedule edits and
regeneration are not yet serialized. Cancellation and rescheduling do not yet
notify participants. RSVPs now confirm a specific date, time, and field. After
rescheduling, old responses remain stored but are excluded from current totals
and the participant is prompted to reconfirm. Legacy responses without these
schedule fields also need reconfirmation. The matching rules are deployed;
stale-browser RSVP writes are rejected by those rules.
The `tests/live-scoring.html` fixture checks the score form with in-memory data.
Live scoring has emulator authorization and cross-account integration coverage;
signed-in production verification remains required before a live season.
