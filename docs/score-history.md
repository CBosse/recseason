# Score History

Both app score-writing paths save an immutable `scoreEvents/{gameId}_{revision}`
record in the same transaction as the game score. Entries contain before/after
score and inning/counter state, scorer UID, server timestamp, revision, and an
optional reason. Correcting a completed result requires a nonblank reason.
The organizer's result editor also rejects an out-of-date score revision.

Organizers and the currently assigned scorekeeper can inspect history from the
Scoreboard, including completed games. History is not exposed to unrelated
accounts. Firestore rules reject missing, mismatched, or rewritten history.
Old results are not backfilled with invented history. Backups include the new
collection and older backup files remain readable.

The score editor now tracks occupied first, second, and third bases manually.
Runner state is stored in the game and history snapshots with the same revision
and atomic-write protections. Existing games default to empty bases; older
history entries remain readable without invented runner history.

Scorers can add an optional play note of up to 300 characters with any live-score
save, including a scoreless play. The note is stored in the event's `reason` field
with its before/after state, not as mutable game metadata. History and recorded-state
replay show it alongside the corresponding revision. Database workflow tests verify
that the description persists with the scoring transaction.

Per-inning totals and recorded-state replay are implemented. The local automatic
scoring preview additionally supports structured plays, automatic runner advancement,
action-derived replay, and organizer corrections with recomputation of later plays;
see [Automatic Scoring](automatic-scoring.md) for its release gates and limitations.
Batter/runner identities and derived player statistics remain unfinished.
Notes do not supply those missing semantics. Scored games cannot be deleted or have
their team IDs changed; raw organizer status changes still need further hardening.
The identity check covers both the previous and proposed game state, so replacing
teams in the same transaction as the first score is rejected even with an otherwise
valid score event and schedule revision. Correct an unscored matchup separately
before recording its first play.

## Recovery Coverage

The encrypted recovery workflow includes a finished automatic game with ordered
runner outcomes, a replacement correction, a voided final strike, and its
restoration. After restoring into the isolated emulator `recovery` database, it
reads native Firestore values, recomputes every audit frame, compares the complete
engine history, checks event timestamps, and derives another valid correction from
the restored history. This covers nested outcome arrays and null replacements,
not just score totals. The workflow retains wrong-passphrase and nonempty-target
rejection checks.

REST verification normalizes omitted empty map fields and array values before
comparison because Firestore may omit those containers when returning a document.
It still detects different field names, types, values, array order, and extra data;
the encrypted backup checksum is not rewritten. This is a local recovery rehearsal,
not a production disaster-recovery certification. The 500-document backup limit,
off-device retention, Auth/config recovery, and operational restoration procedures
still need completion before a live season.
