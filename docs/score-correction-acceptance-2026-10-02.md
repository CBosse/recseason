# Score Correction Acceptance: October 2, 2026

Tested the versioned local build with synthetic emulator data, using the
organizer account at a 390 x 844 viewport. No production records changed.

- Saved an initial final result of Riverside 3, Northside 1 from the schedule.
- Attempted a correction without a reason; it was rejected and the editor
  remained open. After the UI fix, this is a plain validation message rather
  than a database-error message.
- Corrected the result to Riverside 1, Northside 4 with a scorebook reason.
- Opened Scoreboard and the completed game's Score history. Both revisions,
  server timestamps, before/after scores, and the correction reason appeared.
- League standings showed Northside with one win, +3 goal difference, and
  three points; Riverside had one loss and zero points.
- Reloaded the app and verified the corrected result remained in the schedule.
- Fixed the mobile toolbar overflow found during this test. Add game,
  Generate Schedule, and Clear now all appear inside the narrow viewport.

Local screenshots: `.tools/score-correction-persisted.png` and
`.tools/schedule-toolbar-mobile.png`.

Remaining: stale-correction conflicts and assigned-scorekeeper history access
have emulator coverage but still need browser scenarios. This does not complete
per-inning scoring, runner state, play-log replay, or production role acceptance.
