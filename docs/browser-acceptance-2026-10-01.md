# Browser Acceptance: October 1, 2026

Environment: local app at `http://127.0.0.1:8080/?emulator=1`, isolated
`demo-recseason` Auth and named `recseason` Firestore emulators. Synthetic
accounts only; no production accounts or data were changed.

## Verified

- Parent sign-in loads the child's upcoming game and outstanding RSVP.
- At 390 x 844, the roster lists one linked child, labels the section
  Linked Players, and describes the other team's count as zero linked players,
  not an empty team roster.
- While the parent remains signed in, an emulator administrator changes the
  account to visitor and clears child links. The browser automatically leaves
  the roster for the schedule, removes roster navigation and RSVP controls,
  and displays the access-change notification.
- Signed-in visitors see Your account has read-only access, rather than an
  invitation to sign in again. Verified after reloading the wording fix.
- Restoring the parent role and child link automatically restores the dashboard,
  navigation, and linked-child data without reloading.
- Temporary viewport override reset; demo parent profile restored.
- Parent Going RSVP persists across reload and changes the dashboard to 1/1
  going with no outstanding RSVP item.
- Captain sees the contact-free two-player team roster in check-in, saves a
  teammate as Present, and reopens the dialog to verify persistence.
- Assigned scorekeeper saves a final 3-1 result. The game leaves the open-game
  list; the public schedule shows 3-1 and standings show Riverside with one win,
  +2 goal difference, and three points. The save interaction timed out in browser
  control, but subsequent independent public views verified the saved outcome.

## Limitations and Follow-Up

- The first page load preceded emulator readiness and showed a connection
  failure. Reloaded after seeding before acceptance checks.
- Desktop click targeting was inconsistent in the automation surface; keyboard
  submission and mobile navigation succeeded. Desktop pointer behavior needs
  another controlled verification before attributing this to app code.
- This is not full season acceptance. Organizer creation/editing, invitations,
  schedule concurrency, and multi-role privacy still need a consolidated browser
  walkthrough. Attendance and scoring happy paths are verified above; failure
  and stale-edit browser paths remain untested beyond emulator coverage.
- The role-aware RSVP summary correction has unit coverage but still needs a
  browser recheck against a scheduled game; the demonstration game is now final.
- This does not verify production sign-in, email delivery, or disaster recovery.

Screenshot evidence remains local in `.tools/visitor-mobile-acceptance.png`.
Additional check-in evidence: `.tools/captain-checkin-acceptance.png`.
Final standings evidence: `.tools/final-standings-acceptance.png`.
