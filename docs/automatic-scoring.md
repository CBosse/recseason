# Custom Automatic Scoring Engine

The user authorized a custom, thoroughly tested engine for league-specific rules.
Existing manual scoring and snapshot replay remain available and unchanged.

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

The persistence service is internal only: no HTTP route or live-scoring UI calls
it yet. Its caller must supply the identity from revoked-token-aware verification.
Candidate Firestore rules deny direct manual score writes to automatic games,
including organizers. They are emulator-tested, not deployed to production.
The service and these rules must be released together before enabling the UI.
No production games were converted or written during development.

The engine does not yet cover all league variants. Pitch-only strikeouts assume the batter is
retired. Uncaught-third-strike advancement requires explicit runner outcomes;
eligibility and league-specific exceptions still need policy validation before
UI integration. Player identities and statistics are not yet attached to these
base-position outcomes.

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
Before UI integration, configuration must represent alternative time, run-cap,
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
4. Expose the tested atomic service behind verified HTTP identity, strict payload
   validation, bounded requests, and suitable scoring rate limits. Connect the
   client with session fencing and uncertain-result recovery. Deploy candidate
   direct-write restrictions together with the service; retain legacy histories.
5. Add corrections and replay-derived player statistics with explicit player
   attribution and roster validation. Corrections must retain their audit trail.
6. Connect scoring controls and mobile views. Test full games under multiple
   custom profiles, concurrent scorers, refresh, account switches, corrections,
   archived players, and end-to-end standings updates before release.
