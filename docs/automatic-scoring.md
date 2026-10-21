# Custom Automatic Scoring Engine

The user authorized a custom, thoroughly tested engine for league-specific rules.
Existing manual scoring remains available for non-automatic games. Snapshot replay
also displays automatic-game events; manual edits cannot overwrite engine state.

## Implemented Foundation

`pitch-rules.mjs` resolves ball, strike, and foul actions from explicit rules and
counts. It returns `continue`, `walk`, or `strikeout`, resetting terminal counts
to the configured starting counts. It does not mutate inputs, consult current
league settings, read the clock, or write data. Invalid rules, counts, and actions
are rejected. Tests cover every legal count for thresholds 1 through 12 under
both foul policies, deterministic sequences, reset counts, and invalid input.

`runner-rules.mjs` applies forced walk advancement and explicit runner outcomes.
It validates participant coverage, destinations, collisions, backward movement,
and surviving-runner order. Recorded outcome order determines whether a run
precedes an inning-ending tag out. An inning-ending force out or batter out before
first suppresses all runs on that play. Out classifications are explicit scorer
judgments; this is not a fielding or umpiring simulation. Fourth-out appeals and
retouch appeals are not implemented.

`play-rules.mjs` combines both components using version-1 pitch and runner actions.
Walks advance forced runners, ordinary strikeouts apply outs, and completed
batter plays reset counts. Non-batter plays preserve counts unless the half ends.
The reducer returns runs and a half-ended signal; it rejects further plays in a
completed half. Tests replay a full half from actions, including four walks and
three strikeouts, and cover steals, caught stealing, and configured foul outs.

`game-rules.mjs` adds a version-1 game reducer and full action replay. It owns a
validated copy of the game's rules snapshot, inning totals, counts, elapsed time,
and completion reason. It applies half-inning transitions, strict run caps,
scheduled-final/extra unlimited innings, mercy, ties, walk-offs, and extra runners.
Complete-game tests include minimum, standard, and maximum out/strike thresholds.

`automatic-scoring.mjs` produces matching game patches and score events, and
recomputes complete saved action histories to detect altered actions, missing
events, discontinuities, or mismatched displayed scores. Existing snapshot replay
remains compatible with these events. `server/game-scoring-service.mjs` persists
the patch and immutable event in one transaction with current-role authorization,
assigned-scorer checks, expected revision checks, and existing team/field checks.
It requires an explicit engine version and a clean scheduled game to start;
manually scored games are not implicitly migrated. Subsequent writes require the
last event, engine state, displayed score, scorer, and rules snapshot to agree.

`POST /api/games/plays` now calls the service with identity from revoked-token-aware
Firebase verification. Its exact payload is `gameId`, `expectedRevision`,
`engineVersion`, and `action`. Nested actions are schema-checked before service
execution; state-dependent legality is checked by the engine inside the
transaction. Requests share the API's 1 KiB body limit and 16-request concurrency
bound. Scoring has a separate durable per-user one-second throttle, with
`Retry-After: 1`. Responses expose only status and revision, or bounded error codes.

`automatic-scoring-client.mjs` validates a play against the frozen game before
sending, captures its payload before asynchronous token retrieval, and checks the
session before and after each asynchronous boundary. It sends no ambient cookies,
rejects redirects, and has a 20-second timeout. It never retries automatically.
Unknown responses carry a refresh-required result, while a known throttle carries
a bounded retry delay. Successful replies must match the expected next revision.

Real emulator account tests cover stale retries, identity spoofing, role removal,
scorer reassignment, disabled accounts, and rate limiting. An integrated client
test loses a response after the server commits, verifies that repeating the stale
request cannot add a duplicate event, then resumes from a freshly loaded game.
The local-only scorer UI now calls this endpoint. Production rejects scoring unless the runtime environment
explicitly sets `RECSEASON_AUTOMATIC_SCORING=v1`; local emulators enable it.
Candidate Firestore rules deny direct manual score writes to automatic games,
including organizers. They are emulator-tested, not deployed to production.
The service and these rules must be released together before enabling production UI.
No production games were converted or written during development.

`scoring-playback.mjs` now connects action replay to the history viewer. Automatic
histories must fully recompute against frozen rules and match the saved game before
any playback frames are displayed. Missing, altered, or mixed histories produce
an explicit verification warning instead of falling back to trusted snapshots.
Playback identifies pitches, elapsed-time entries, and ordered runner outcomes.
Legacy games retain their existing snapshot replay and incomplete-history warnings.
Focused tests cover action-derived frames, labels, corrupt histories, removed engine
markers, and legacy compatibility. The emulator browser check verified navigation
to the two-run home-run action and its runner order on October 21, 2026.

The engine does not yet cover all league variants. Pitch-only strikeouts assume the batter is
retired. Uncaught-third-strike advancement requires explicit runner outcomes;
eligibility and league-specific exceptions still need policy validation before
production release. Player identities and statistics are not yet attached to these
base-position outcomes.

## Local Scorer Preview

`automatic-scoring-editor.mjs` exposes ball, strike, foul, explicit runner outcomes
and their chronological order, over-the-fence home runs, and elapsed-time entry.
Starting requires confirmation of the displayed frozen version-1 rules. Elapsed
time is manually entered, not a running or pause-aware clock. Completed games
are read-only. This preview is available only in emulator mode for clean scheduled
games with rules snapshots, or games already using automatic scoring.

`automatic-scoring-session.mjs` keeps save and server reload single-flight, applies
the throttle delay, and blocks another play after an uncertain response until an
authoritative refresh succeeds. Session and assignment checks prevent late results
from being consumed after access changes. Unit tests cover these transitions,
explicit runner ordering, and guards against manual score overwrite.

Browser acceptance on October 21, 2026 used synthetic emulator data: one inning,
two balls per walk, two strikes per out, and one out per half. Two balls placed a
runner on first; an explicit two-run home run made the score 2-0; four strikes
completed both halves. The final score survived server reload, scoring controls
were disabled, and all seven events appeared in snapshot history. The editor was
visually checked at desktop and 390px mobile width with no horizontal overflow.
This is a focused preview check, not acceptance of all league policies or roles.

Malformed scheduling records are now omitted with a visible warning instead of
crashing the shared game subscription's sort. Records are not changed or deleted;
an organizer repair workflow remains to be added.

## Version-1 Game Semantics

- Actions carry nondecreasing elapsed milliseconds measured by the scorer's
  game clock. Replay never reads wall-clock time. A clock-only action can record
  elapsed time without inventing a pitch.
- The time limit means finish the current inning, with the home side receiving
  its opportunity. A leading home side need not continue batting. A tied game
  follows the tie policy, including extra innings after the time threshold.
- The unlimited-final setting applies to the scheduled final inning and all
  extra innings, including timed extras. It does not retroactively uncap a
  shortened inning when the time threshold is reached during that inning.
- Run caps truncate runs even on home runs. Other cap policies need explicit
  profile configuration before release to leagues using them.
- Ordinary walk-offs award only the winning run. An explicit `home-run` award
  requires every existing runner and the batter to reach home and awards the
  full play, subject to the strict run cap. This denotes an over-the-fence home
  run, not an inferred award from arbitrary runner destinations.
- Mercy starts in the configured inning. An away lead cannot end the game until
  the home half ends. A qualifying home lead ends the game after the top half or
  after a play in the bottom half.
- Extra runners start on second in both halves. This currently records occupied
  bases only; lineup-based runner identity is pending.
- Completing a half resets counts and bases. A final game rejects further
  actions; correction replay is not yet connected. An unresolved tie at inning
  99 fails explicitly rather than inventing a result or overflowing storage.

These are explicit engine semantics, not a claim of universal league rules.
Before production release, configuration must represent alternative time, run-cap,
mercy, and final-inning policies instead of silently applying these semantics.

## Remaining Implementation

1. Connect game-engine versions and policy semantics to frozen game configuration;
   explicitly reject or configure unsupported league variants. Add clock pause,
   resume, and scorer-authority validation rather than trusting arbitrary client
   elapsed values at the persistence boundary.
2. Add policy validation for uncaught third strikes, foul bunts,
   appeals, and other league-specific exceptions. Do not assume every hit advances
   every runner equally.
3. Extend tested ending rules with the policy fields needed for league differences
   (hard stop versus finish inning, cap exceptions, declared last innings, mercy
   timing). Do not migrate already-scored legacy games implicitly.
4. Finish production readiness of the local scorer UI and its session safeguards.
   Deploy candidate
   direct-write restrictions together with the service; retain legacy histories.
5. Add corrections and replay-derived player statistics with explicit player
   attribution and roster validation. Corrections must retain their audit trail.
6. Expand browser acceptance beyond the local preview. Test full games under multiple
   custom profiles, concurrent scorers, refresh, account switches, corrections,
   archived players, and end-to-end standings updates before release.
