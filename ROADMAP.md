# RecSeason — Feature Roadmap

## Role Hierarchy (implemented)
1. **Site Admin** — full control, user management, admin panel
2. **Commissioner** — manages multiple leagues
3. **League Manager** — manages one league (assigned by commissioner)
4. **Team Manager** — manages one team (linkedTeamId)
5. **Captain** — attendance/nudge for one team (linkedTeamId)
6. **Player** — personal RSVP + stats (linkedPlayerId)
7. **Parent** — RSVP on behalf of child/children (linkedPlayerIds[])
8. **Umpire** — cross-league game assignments (separate umpires collection)
9. **Scorekeeper** — live score entry (placeholder view only)
10. **Visitor** — read-only, no auth required

---

## High Priority

### Role Features (incomplete / in progress)
- **Captain** — attendance marking flow (game-day check-in per player)
- **Parent** — linked-child management UI (add/remove children from account)
- **Parent** — fee tracking per child
- **Team Manager** — lineup / batting order builder
- **Commissioner** — multi-league dashboard with league switcher
- **League Manager** — assign umpires to specific games from umpire pool
- **Role invitation flow** — invite by email, pending acceptance queue in Admin Panel

### Scorekeeper (Live Scoreboard)
- Ball / strike / out counter
- Base runner diamond (interactive)
- Inning-by-inning scoring grid
- Play-by-play log with auto stat calculation
- Game selection from today's schedule

### Team Chat / Messages
- Real-time team messaging threads
- Coach-only channel
- Attach events / games to messages
- Push notifications

### AI Scheduling & Lineup Helper
- AI-generated batting orders based on player stats
- Lineup confidence score
- Auto-accept or manual review flow

---

## Medium Priority

### Umpire
- Pay calculation: completed games × payRate, season total
- Availability calendar (mark available/unavailable days)
- Accept / decline game assignment flow
- Multiple leagues support

### Player Stats Tracking
- Batting average, OBP, attendance percentage
- Per-game stat entry
- Season aggregates and trending deltas

### Tournament Brackets
- Single/double elimination bracket builder
- Live bracket updates as games complete
- Bracket sharing via link

### Multiple League Management
- Leagues collection (name, season, commissionerIds[], managerIds[])
- Switch between leagues in sidebar
- Commissioner creates / archives leagues

### Mobile App (iOS / Android)
- Native bottom-tab navigation
- Push notifications for RSVP reminders, game-day alerts
- Offline schedule access

---

## Lower Priority / Premium Features

### Notifications & Reminders
- Automated RSVP nudges (configurable days before game)
- Field change alerts
- Weather warnings

### Onboarding Flow
- Create team wizard
- Bulk invite roster via CSV or link
- League join by code

### Fees & Payments
- Season fee tracking per player
- Payment status dashboard
- Integration with Stripe / PayPal

### Weather Integration
- Live game-day weather widget on schedule
- Automatic cancellation suggestions for rain

### Video Clips & Advanced Stats (Premium)
- Attach game film clips to player profiles
- Pitch velocity, exit velocity tracking
- League-wide leaderboards

### Marketing Landing Page
- Public-facing "free for rec teams" pitch
- Feature comparison vs TeamLinkt
- Sign-up / create team CTA
