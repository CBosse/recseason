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

This component is not connected to the live-scoring UI and is not a complete
automatic game engine. In particular, a returned strikeout is not yet an applied
out, and a walk does not yet move runners.

## Remaining Implementation

1. Version the action contract and pure game reducer. Use the game's immutable
   rule snapshot and explicitly recorded elapsed time, never wall-clock reads
   during replay. Define how unsupported league policies are reported.
2. Apply forced walks, explicit runner destinations, outs, runs, and half-inning
   transitions. Reject duplicate runners, impossible destinations, and invalid
   action order. Do not assume every hit advances every runner equally.
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
