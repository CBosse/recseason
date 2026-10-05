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

Per-inning totals and recorded-state replay are implemented. Structured play types,
batter/runner identities, automatic runner advancement, correction of an individual
play with recomputation of later plays, and derived player statistics remain unfinished.
Notes do not supply those missing semantics. Scored games cannot be deleted or have
their team IDs changed; raw organizer status changes still need further hardening.
