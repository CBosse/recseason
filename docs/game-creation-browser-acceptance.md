# Local Add Game browser acceptance

Verified October 28, 2026 against the local emulator app, using synthetic Demo
siteAdmin, Riverside and Northside records. No production data was changed.

- Created a 90-minute game on November 2 at 18:00 on API verified field.
- All form controls disabled during the request; successful save closed the form.
- Reloaded the app. The game persisted on the dashboard and schedule.
- Repeated the booking. The one-minute server throttle initially rejected it.
- After cooldown, the overlapping booking was rejected and the form stayed open.
- A further submission from that conflicted form was blocked locally with an
  instruction to close the form and inspect the schedule.
- Checked the form at 390 x 844: controls fit the viewport and the dialog scrolls.
- Exact label lookup revealed select labels including option text. Explicit
  accessible names now allow exact Date, Time, Home team and Away team lookup.

Local screenshots: `.tools/game-creation-saved-verified.png` and
`.tools/game-creation-conflict-verified.png` (not committed).

The pre-existing invalid-record banner refers to synthetic emulator fixtures.
This check does not validate production deployment, game editing/regeneration,
unlit-field browser flows, or all league-rule variants. Those remain open.
