# Roster and Team Deletion Integrity

Player creation reads the target team and advances `config/rosterRevision` in
the same transaction as the private player and contact-free roster writes.
Player transfers made through a database client must also advance that revision.

Team removal captures the roster revision before querying current players,
captures the schedule snapshot, and rejects teams with any roster or game
history. The deletion transaction checks both revisions and the captured team,
game, field, and season records, then advances both revisions with the deletion.
Concurrent player creation or schedule publication therefore invalidates the
removal snapshot. Creation retried after deletion rejects the missing team.

Verification: unit revision tests, direct rule rejection tests, and an
authenticated emulator race verify one successful operation and no dangling
player. Existing schedule publication races are covered separately. Browser
verification of empty-team removal is still outstanding.

## Remaining Boundary

Revision rules require coordination but do not prove that an organizer queried
an empty roster. A privileged custom client could advance both revisions while
deleting a referenced team. Fully enforcing reference integrity against such
clients requires a trusted deletion service or rule-validated reference counts
with a migration of existing records. Do not treat this change as completion of
all database-boundary integrity work in the project overview.

Clients loaded before this release must refresh before creating players or
removing teams under the new rules. The new roster revision starts at zero when
absent; existing player/team records require no migration for this protocol.
