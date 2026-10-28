# Account access updates

`profile-access.mjs` defines role-specific account links. Team managers require an
existing team; captains require an active player on that team; players may be
unlinked or linked to an active player and its team. Parents require 1-30 distinct
active players whose teams exist. Other roles have no player/team links. Every
transition replaces all four access fields, clearing obsolete links.

`server/profile-access-service.mjs` checks the acting administrator in a Firestore
transaction, compares the target's confirmed access fields, validates every linked
record, and advances the shared roster revision. The revision coordinates with
roster changes and team removal. It preserves unrelated profile preferences and
rejects self-demotion to avoid removing the administrator's own recovery access.
Two administrators concurrently demoting each other cannot both succeed because
both actor and target documents are transaction reads.

`POST /api/accounts/access` now verifies a revocation-checked Firebase token and
accepts exactly `targetUid`, `expectedAccess`, `expectedRosterRevision`, and `access`.
It has an independent durable per-user 60-second throttle. Its 16 KiB body limit
supports 30 maximum-length child IDs in both the old and new access snapshots;
other routes retain their 1 KiB limit. Only the update status is returned, never
profile details. Conflicts return 409, invalid input 400, lost administrator access
403, and unknown failures 503. The container smoke test covers unauthenticated calls.

The local admin panel now uses a role-aware account-access dialog and the verified
API. Player/captain team links are derived from the selected player; parents can
select up to 30 children. Unavailable current selections remain visible until
explicitly removed. Changing roles clears irrelevant links. Session changes and
stale or uncertain saves require reopening; no automatic retry is performed.
Candidate rules deny direct administrator role/link changes while retaining profile
preferences and the existing validated invitation-acceptance workflow. Production
editing stays disabled until the API endpoint is configured. Coordinated API/rules
deployment and full role-change browser acceptance are still required; the production
profile-link integrity gap is not yet claimed as closed.

Tests cover role combinations, all 30 child references, archived/missing/mismatched
records, access revocation, self-demotion, concurrent saves, unrelated preference
changes and a team-deletion race. Emulator fixtures are synthetic and never touch
production accounts or data.
