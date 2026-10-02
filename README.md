# RecSeason

Recreational league management using a static JavaScript interface, Firebase
Authentication, and the named Firestore database `recseason`.

## Development and verification

Run `node scripts/build-site.mjs`, then `node scripts/serve-site.mjs` and open
http://127.0.0.1:8081. Firebase configuration lives in `firebase-config.js`.
Rebuild after source edits and reload the browser. The build places all modules
and styles under one content-hashed release directory so cached modules from
different releases cannot be mixed. The preview server sends `Cache-Control:
no-store` and serves only `dist`; set `PORT` to change its default 8081 port.
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
second terminal run `npm run seed:local`, build and serve as above, then
open `http://127.0.0.1:8081/?emulator=1`. The query parameter is required; ordinary
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
  coordinated with concurrent game creation through the shared schedule revision.
- Manually arranged games default to locked against regeneration. Locked and
  existing non-scheduled games reserve their time during generation.
- Retained games count toward their home-away matchup quota during regeneration.
  Cancelled games neither consume that quota nor block available time.
- Organizers can cancel scheduled games without deleting game or attendance
  history, then reschedule them through the game editor. Cancellation and result
  saves check the current game status in a transaction.
- Schedule publication uses a shared revision in a transaction, with a maximum
  of 499 combined game deletions/additions plus the revision write. Manual game
  saves, field creation/editing/removal, season settings, cancellation, clearing
  and regeneration use the same revision. Stale
  publications reject instead of overwriting another organizer's changes; all
  previously read game, field, team and season-setting documents are rechecked,
  including scoring status changes. Season settings cannot exclude active games
  or introduce buffer conflicts. Legacy games need explicit durations before the
  default duration can change.
  Larger changes are rejected without deleting data.
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
- Upcoming-game and game-day boundaries use the device's local calendar date,
  not UTC midnight. Explicit league-timezone configuration is not implemented.
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
- Player creation, editing, and archiving now atomically synchronize a `teamRoster`
  record containing only name, jersey number, team, and archive status. Rules require
  both records to agree. Active captains may read only their team's projection,
  not teammates' private player records.
  Existing installations with players need projection backfill before these rules
  are deployed; older browser clients cannot make unsynchronized roster edits.
- Schedule rows offer team check-in for active captains, team managers, and
  organizers. Present/absent/unmarked attendance is separate from RSVPs. Saves
  validate the current roster, game schedule and attendance revision atomically;
  cancelled/completed games reject changes. Up to ten changed players can be saved
  at once. Reopen the dialog to review saved attendance or resolve a stale edit.
- Site admins can open a reminder draft from a scheduled game. Recipients are
  deduplicated linked players/parents, team managers and assigned officials.
  The preview reports players without a linked email and exports an editable
  `.eml` draft with Bcc recipients. No email is sent by RecSeason, and downloading
  never marks a reminder as delivered. Automatic delivery, preferences and a
  delivery log still need a sending service and server-side implementation.
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

### Backup and recovery

Run `npm run backup:production` with the Firebase CLI signed in and
`RECSEASON_BACKUP_PASSPHRASE` supplied by your secret manager in the process environment.
Use a strong, unique passphrase (at least 16 characters); never put it in command-line
arguments, source files, shell history, or Git. Store it separately from backups.
Losing it makes encrypted backups unrecoverable. No production backup is attempted
when the environment variable is missing.
The export reads the named production database only and writes an authenticated,
encrypted `.encrypted.json` file under ignored `.tools/backups`. It includes all
twelve app collections, including score history, and retains raw
Firestore value types, and uses one `readTime` for every page for a consistent
snapshot. This follows the [Firestore list API](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/list).
The file contains private data. Keep it protected and out of Git, Pages, and shared
folders. New exports use AES-256-GCM with fresh random salt and nonce and a
scrypt-derived key (N=32768, r=8, p=1). The encrypted content also retains the
existing document checksum. Legacy plaintext backups remain readable but are not
automatically encrypted or deleted. File mode restrictions are not a substitute for
Windows folder ACLs. Keep this folder restricted to the backup operator.

With a fresh local Firestore emulator on port 8180 and
`FIRESTORE_EMULATOR_HOST=127.0.0.1:8180`, run
`node scripts/restore-recovery.mjs <backup-file>` with the same passphrase environment
variable to decrypt in memory and restore into the isolated
`demo-recseason` project's `recovery` database. The script refuses other endpoints,
nonempty app collections, overwrites, invalid checksums, and snapshots above 500
documents. It verifies every restored document after one atomic create-only commit.
Encrypted input is authenticated before any database request. Files above 48 MiB
and encrypted plaintext above 32 MiB are rejected. No decrypted file is written.
`npm run test:recovery` tests encrypted synthetic data, a wrong passphrase before
restore, and an overwrite attempt; it runs in CI. A five-document production export was successfully restored
and verified locally on September 26, 2026. Production was not modified.

This is an app-data recovery tool, not complete disaster recovery. Auth accounts,
storage files, indexes, rules and unknown collections/subcollections are not included.
Scheduled encrypted off-device backups, larger snapshots, retention policy, and an
operator-approved production restore procedure remain outstanding.

### Feature gaps

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

Per-inning scoring now derives totals from saved inning entries. Earlier innings can
be corrected without rewinding the current inning; finalized-game corrections require
an organizer and a reason. Legacy totals stay visible as unallocated runs and cannot
yet be reassigned to innings. Manual base occupancy and immutable score history are
implemented; automatic runner advancement and a replayable play-by-play log are not.
Score history now supports chronological recorded-state replay with previous/next
controls and a revision slider. Corrections remain separate events. Missing revisions,
state discontinuities, and disagreement with the displayed game produce visible warnings.
This replays saved score snapshots, not individual pitches or plays that were never entered.

Production admin and captain acceptance testing; replayable play logs; automatic reminders;
backup and restoration; larger schedule publication; browser acceptance tests;
and production configuration/verification remain outstanding. The test suite
covers domain logic, subscription handling, emulator authorization, and authenticated
emulator workflows, not signed-in production acceptance.
The standalone `tests/game-editor.html` fixture exercises the editor without
connecting to Firebase or writing live records. Game, field and season-setting
publications are serialized; team removal still needs coordinated referential
checks. Cancellation and rescheduling do not yet
notify participants. RSVPs now confirm a specific date, time, and field. After
rescheduling, old responses remain stored but are excluded from current totals
and the participant is prompted to reconfirm. Legacy responses without these
schedule fields also need reconfirmation. The matching rules are deployed;
stale-browser RSVP writes are rejected by those rules.
The `tests/live-scoring.html` fixture checks the score form with in-memory data.
Live scoring has emulator authorization and cross-account integration coverage;
signed-in production verification remains required before a live season.
