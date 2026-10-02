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

This is score-change history, not the complete scoring milestone. Per-inning
totals, play-by-play entry/replay, automatic runner advancement, and
correction-aware replay remain unfinished. Privileged game creation/deletion and raw organizer status
changes also require further database-boundary hardening; historical records
do not by themselves close those integrity gaps.
