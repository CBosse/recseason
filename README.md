# RecSeason

Recreational league management using a static JavaScript interface, Firebase
Authentication, and the named Firestore database `recseason`.

## Development and verification

Serve this folder over HTTP (`python -m http.server 8080`) and open
http://localhost:8080. Firebase configuration currently lives in `app.js`.
The application requires an appropriately configured Firebase project; a local
server alone does not provide an offline database.

Run `node --test tests/*.test.mjs` and `node --check app.js` before publishing.
The GitHub Pages workflow runs both checks before deployment.

## Current behavior

- Schedules prevent overlapping field and team bookings, including buffer time.
- Existing non-scheduled games reserve their time during generation.
- Schedule replacement is one atomic batch, with a maximum of 500 combined
  deletions and additions. Larger changes are rejected without deleting data.
- Zero-capacity generation keeps the current schedule; incomplete schedules
  require confirmation.
- Final scores must be non-negative whole numbers. Result updates retain other
  game fields and fail if the game was deleted concurrently.
- Standings award three points for a win and one for a tie; ties in ranking use
  goal difference, goals scored, then team name. Invalid results are excluded.
- Account changes dispose database listeners and clear cached records.

## MVP work still required

Secure admin provisioning and tested database rules; manual game management;
invitations and parent linking; attendance; persistent live scoring; reminders;
backup and restoration; larger schedule publication; browser acceptance tests;
and production configuration/verification remain outstanding. The test suite
covers domain logic and subscription handling, not live Firebase authorization.
