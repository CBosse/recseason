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

These components are not connected to the live-scoring UI or persistence and are
not a complete automatic game engine. Pitch-only strikeouts assume the batter is
retired. Uncaught-third-strike advancement requires explicit runner outcomes;
eligibility and league-specific exceptions still need policy validation before
UI integration. Player identities and statistics are not yet attached to these
base-position outcomes.

## Remaining Implementation

1. Extend the versioned play contract into a pure game reducer. Use the game's immutable
   rule snapshot and explicitly recorded elapsed time, never wall-clock reads
   during replay. Define how unsupported league policies are reported.
2. Apply the play reducer's runs and half-ended signal to game totals and inning
   transitions. Add policy validation for uncaught third strikes, foul bunts,
   appeals, and other league-specific exceptions. Do not assume every hit advances
   every runner equally.
3. Enforce run limits, unlimited final innings, mercy, time limits, ties,
   extra-inning runners, and walk-offs. Make timing and inning-completion
   semantics explicit; add policy fields where the existing profile cannot
   represent league differences without ambiguity.
4. Record actions and derived before/after states atomically with score revision
   checks and assigned-scorer authorization. Verify replay by recomputing actions,
   rather than trusting their saved result. Preserve legacy snapshot histories.
5. Add corrections and replay-derived player statistics with explicit player
   attribution and roster validation. Corrections must retain their audit trail.
6. Connect scoring controls and mobile views. Test full games under multiple
   custom profiles, concurrent scorers, refresh, account switches, corrections,
   archived players, and end-to-end standings updates before release.
