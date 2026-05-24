'use strict';

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore,
  doc,
  collection,
  onSnapshot,
  setDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Firebase ───────────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey: "AIzaSyB_qR9FLOCc0uRKmBNmiNBAoAq98tlZ1WU",
  authDomain: "bosse-testing.firebaseapp.com",
  projectId: "bosse-testing",
  storageBucket: "bosse-testing.firebasestorage.app",
  messagingSenderId: "327987648702",
  appId: "1:327987648702:web:b0a2337dc099e6772aa6ef",
};

const db = getFirestore(initializeApp(firebaseConfig), 'recseason');

// ── State ──────────────────────────────────────────────────────────────────

const state = {
  teams:          [],
  players:        [],
  fields:         [],
  games:          [],
  rsvps:          [],
  scheduleConfig: { gameDuration: 90, bufferMinutes: 15, startDate: '', endDate: '', rounds: 1 },
  _ready: { teams: false, players: false, fields: false, games: false, scheduleConfig: false, rsvps: false },
};

const ADMIN_PASSWORD = 'ump-admin';
let isAdminMode = false;
let _viewingTeamId = null;
let _activeView = 'dashboard';

// ── US State → IANA timezone map ───────────────────────────────────────────

const STATE_TZ = {
  AL: 'America/Chicago',  AK: 'America/Anchorage',  AZ: 'America/Phoenix',
  AR: 'America/Chicago',  CA: 'America/Los_Angeles', CO: 'America/Denver',
  CT: 'America/New_York', DE: 'America/New_York',    DC: 'America/New_York',
  FL: 'America/New_York', GA: 'America/New_York',    HI: 'Pacific/Honolulu',
  ID: 'America/Boise',    IL: 'America/Chicago',     IN: 'America/Indiana/Indianapolis',
  IA: 'America/Chicago',  KS: 'America/Chicago',     KY: 'America/New_York',
  LA: 'America/Chicago',  ME: 'America/New_York',    MD: 'America/New_York',
  MA: 'America/New_York', MI: 'America/Detroit',     MN: 'America/Chicago',
  MS: 'America/Chicago',  MO: 'America/Chicago',     MT: 'America/Denver',
  NE: 'America/Chicago',  NV: 'America/Los_Angeles', NH: 'America/New_York',
  NJ: 'America/New_York', NM: 'America/Denver',      NY: 'America/New_York',
  NC: 'America/New_York', ND: 'America/Chicago',     OH: 'America/New_York',
  OK: 'America/Chicago',  OR: 'America/Los_Angeles', PA: 'America/New_York',
  RI: 'America/New_York', SC: 'America/New_York',    SD: 'America/Chicago',
  TN: 'America/Chicago',  TX: 'America/Chicago',     UT: 'America/Denver',
  VT: 'America/New_York', VA: 'America/New_York',    WA: 'America/Los_Angeles',
  WV: 'America/New_York', WI: 'America/Chicago',     WY: 'America/Denver',
};

const zipCache = new Map();
const sunCache = new Map();

// ── Player identity (localStorage) ────────────────────────────────────────

let currentPlayerId   = localStorage.getItem('recseason_playerId')   || null;
let currentPlayerName = localStorage.getItem('recseason_playerName') || null;
let currentTeamId     = null;

function resolveCurrentTeamId() {
  if (!currentPlayerId) { currentTeamId = null; return; }
  const player = state.players.find(p => p.id === currentPlayerId);
  currentTeamId = player ? player.teamId : null;
}

function setIdentity(playerId, playerName) {
  currentPlayerId   = playerId;
  currentPlayerName = playerName;
  localStorage.setItem('recseason_playerId',   playerId);
  localStorage.setItem('recseason_playerName', playerName);
  resolveCurrentTeamId();
}

function clearIdentity() {
  currentPlayerId   = null;
  currentPlayerName = null;
  currentTeamId     = null;
  localStorage.removeItem('recseason_playerId');
  localStorage.removeItem('recseason_playerName');
}

// ── Firestore write helpers ────────────────────────────────────────────────

function showDbError(err) {
  console.error('Firestore error:', err);
  const msg = err?.code === 'permission-denied'
    ? 'Database permission denied. Check Firestore security rules in Firebase Console.'
    : `Database error: ${err?.message ?? err}`;
  showBanner(msg, 'error');
}

function firestoreWrite(promise) {
  return promise.catch(showDbError);
}

function saveTeam(team) {
  return firestoreWrite(setDoc(doc(db, 'teams', team.id), {
    name:      team.name,
    color:     team.color     ?? '',
    homefield: team.homefield ?? '',
  }));
}

function deleteTeam(id) {
  return firestoreWrite(deleteDoc(doc(db, 'teams', id)));
}

function savePlayer(player) {
  return firestoreWrite(setDoc(doc(db, 'players', player.id), {
    name:   player.name,
    number: player.number ?? '',
    phone:  player.phone  ?? '',
    teamId: player.teamId,
  }));
}

function deletePlayer(id) {
  return firestoreWrite(deleteDoc(doc(db, 'players', id)));
}

function saveField(field) {
  return firestoreWrite(setDoc(doc(db, 'fields', field.id), {
    name:          field.name,
    availableDays: field.availableDays,
    openTime:      field.openTime,
    closeTime:     field.closeTime,
    hasLights:     field.hasLights ?? false,
    zipCode:       field.zipCode   ?? '',
  }));
}

function deleteField(id) {
  return firestoreWrite(deleteDoc(doc(db, 'fields', id)));
}

function saveScheduleConfig(cfg) {
  return firestoreWrite(setDoc(doc(db, 'config', 'schedule'), {
    gameDuration:  Number(cfg.gameDuration),
    bufferMinutes: Number(cfg.bufferMinutes),
    startDate:     cfg.startDate,
    endDate:       cfg.endDate,
    rounds:        Number(cfg.rounds),
  }));
}

function setRsvp(gameId, status) {
  if (!currentPlayerId) return;
  const rsvpId = `${gameId}_${currentPlayerId}`;
  firestoreWrite(setDoc(doc(db, 'rsvps', rsvpId), {
    gameId,
    playerId:   currentPlayerId,
    playerName: currentPlayerName,
    teamId:     currentTeamId,
    status,
  }));
}

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Firestore listeners ────────────────────────────────────────────────────

function allReady() {
  return state._ready.teams && state._ready.players &&
         state._ready.fields && state._ready.games &&
         state._ready.scheduleConfig && state._ready.rsvps;
}

function checkReady() {
  if (allReady()) {
    clearTimeout(connectTimeout);
    document.getElementById('loading-overlay').style.display = 'none';
    renderCurrentView();
  }
}

const connectTimeout = setTimeout(() => {
  if (!allReady()) {
    document.getElementById('loading-overlay').style.display = 'none';
    showBanner(
      'Could not connect to database. Check that the "recseason" Firestore database ' +
      'exists and its security rules allow reads and writes.',
      'error'
    );
    renderCurrentView();
  }
}, 10000);

onSnapshot(collection(db, 'teams'), snap => {
  state.teams = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  state.teams.sort((a, b) => a.name.localeCompare(b.name));
  state._ready.teams = true;
  resolveCurrentTeamId();
  checkReady();
  if (allReady()) renderCurrentView();
}, err => showDbError(err));

onSnapshot(collection(db, 'players'), snap => {
  state.players = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  state.players.sort((a, b) => {
    const na = Number(a.number) || 0;
    const nb = Number(b.number) || 0;
    if (na !== nb) return na - nb;
    return a.name.localeCompare(b.name);
  });
  state._ready.players = true;
  resolveCurrentTeamId();
  checkReady();
  if (allReady()) renderCurrentView();
}, err => showDbError(err));

onSnapshot(collection(db, 'fields'), snap => {
  state.fields = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  state.fields.sort((a, b) => a.name.localeCompare(b.name));
  state._ready.fields = true;
  checkReady();
  if (allReady()) renderCurrentView();
}, err => showDbError(err));

onSnapshot(collection(db, 'games'), snap => {
  state.games = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  state.games.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.time.localeCompare(b.time);
  });
  state._ready.games = true;
  checkReady();
  if (allReady()) renderCurrentView();
}, err => showDbError(err));

onSnapshot(collection(db, 'rsvps'), snap => {
  state.rsvps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  state._ready.rsvps = true;
  checkReady();
  if (allReady()) renderCurrentView();
}, err => showDbError(err));

onSnapshot(doc(db, 'config', 'schedule'), snap => {
  if (snap.exists()) {
    const d = snap.data();
    state.scheduleConfig = {
      gameDuration:  d.gameDuration  ?? 90,
      bufferMinutes: d.bufferMinutes ?? 15,
      startDate:     d.startDate     ?? '',
      endDate:       d.endDate       ?? '',
      rounds:        d.rounds        ?? 1,
    };
  } else {
    state.scheduleConfig = { gameDuration: 90, bufferMinutes: 15, startDate: '', endDate: '', rounds: 1 };
  }
  state._ready.scheduleConfig = true;
  checkReady();
  if (allReady()) renderCurrentView();
}, err => showDbError(err));

// ── View Navigation ────────────────────────────────────────────────────────

function navigate(viewId) {
  _activeView = viewId;

  // Update active view visibility
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(`view-${viewId}`);
  if (target) target.classList.add('active');

  // Update active nav item
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewId);
  });

  renderCurrentView();
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => navigate(item.dataset.view));
});

function renderCurrentView() {
  updateSidebarTeamCard();
  syncAdminUi();

  if (_activeView === 'dashboard') renderDashboard();
  if (_activeView === 'schedule')  renderScheduleView();
  if (_activeView === 'roster')    renderRosterView();
  if (_activeView === 'league')    renderLeagueView();
  if (_activeView === 'settings')  renderSettingsView();
}

// ── Sidebar Team Card ──────────────────────────────────────────────────────

function updateSidebarTeamCard() {
  const card = document.getElementById('sidebar-team-card');
  if (!card) return;

  if (currentPlayerId && currentPlayerName) {
    const player = state.players.find(p => p.id === currentPlayerId);
    const team   = player ? state.teams.find(t => t.id === player.teamId) : null;
    if (team) {
      const playerCount = state.players.filter(p => p.teamId === team.id).length;
      card.innerHTML = `
        <div class="team-label">Your Team</div>
        <div class="team-name">${escHtml(team.name)}</div>
        <div class="team-meta">
          <span>${playerCount} player${playerCount !== 1 ? 's' : ''}</span>
          ${team.color ? `<span>&bull; ${escHtml(team.color)}</span>` : ''}
        </div>`;
      return;
    }
  }

  // No identity set: show prompt
  const teamCount   = state.teams.length;
  const playerCount = state.players.length;
  card.innerHTML = `
    <div class="team-label">League</div>
    <div class="team-name" style="color:#6e6f6a;font-weight:500;font-size:12px;">No player selected</div>
    <div class="team-meta">
      <span>${teamCount} team${teamCount !== 1 ? 's' : ''}</span>
      <span>&bull; ${playerCount} player${playerCount !== 1 ? 's' : ''}</span>
    </div>`;
}

// ── Admin mode ─────────────────────────────────────────────────────────────

function beginAdminMode() {
  isAdminMode = true;
  showBanner('Admin View enabled.', 'success');
  renderCurrentView();
}

function exitAdminMode() {
  isAdminMode = false;
  showBanner('Returned to View Mode.', 'success');
  renderCurrentView();
}

function syncAdminUi() {
  // Dashboard admin buttons
  const enterBtn  = document.getElementById('admin-view-btn');
  const saveBtn   = document.getElementById('admin-save-btn');
  // Settings admin buttons
  const enterBtn2 = document.getElementById('admin-view-btn2');
  const saveBtn2  = document.getElementById('admin-save-btn2');

  if (enterBtn) {
    enterBtn.textContent = isAdminMode ? 'Admin View Active' : 'Admin View';
    enterBtn.disabled = isAdminMode;
  }
  if (saveBtn)  saveBtn.style.display  = isAdminMode ? '' : 'none';
  if (enterBtn2) {
    enterBtn2.textContent = isAdminMode ? 'Admin View Active' : 'Admin View';
    enterBtn2.disabled = isAdminMode;
  }
  if (saveBtn2) saveBtn2.style.display = isAdminMode ? '' : 'none';

  // Show/hide add forms in roster view
  const teamAddForm   = document.getElementById('team-add-form');
  const playerAddForm = document.getElementById('player-add-form');
  if (teamAddForm)   teamAddForm.style.display   = isAdminMode ? '' : 'none';
  if (playerAddForm) playerAddForm.style.display = isAdminMode ? '' : 'none';

  // Show/hide all remove buttons
  document.querySelectorAll('.remove-btn').forEach(btn => {
    btn.style.display = isAdminMode ? '' : 'none';
  });

  // Field add form
  const fieldAddForm = document.getElementById('field-add-form');
  if (fieldAddForm) fieldAddForm.style.display = isAdminMode ? '' : 'none';
}

// Wire up admin buttons once (they live in the HTML)
document.getElementById('admin-view-btn').addEventListener('click', () => {
  const input = prompt('Enter Admin password');
  if (input === ADMIN_PASSWORD) beginAdminMode();
  else if (input !== null) alert('Incorrect password.');
});

document.getElementById('admin-save-btn').addEventListener('click', exitAdminMode);

document.getElementById('admin-view-btn2').addEventListener('click', () => {
  const input = prompt('Enter Admin password');
  if (input === ADMIN_PASSWORD) beginAdminMode();
  else if (input !== null) alert('Incorrect password.');
});

document.getElementById('admin-save-btn2').addEventListener('click', exitAdminMode);

// ── Teams: add / remove ────────────────────────────────────────────────────

document.getElementById('add-team-btn').addEventListener('click', addTeam);
document.getElementById('team-name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') addTeam();
});

function addTeam() {
  if (!isAdminMode) return;
  const nameEl  = document.getElementById('team-name-input');
  const colorEl = document.getElementById('team-color-input');
  const fieldEl = document.getElementById('team-homefield-input');
  const name = nameEl.value.trim();
  if (!name) return;
  const color     = colorEl.value.trim();
  const homefield = fieldEl.value.trim();
  const id = genId('team');
  nameEl.value  = '';
  colorEl.value = '';
  fieldEl.value = '';
  nameEl.focus();
  saveTeam({ id, name, color, homefield });
}

function removeTeam(id) {
  if (!isAdminMode) return;
  if (!confirm('Remove this team? All players on this team will also be removed.')) return;
  const teamPlayers = state.players.filter(p => p.teamId === id);
  Promise.all([deleteTeam(id), ...teamPlayers.map(p => deletePlayer(p.id))]);
  if (_viewingTeamId === id) {
    _viewingTeamId = null;
    renderRosterView();
  }
}

// ── Players: add / remove ──────────────────────────────────────────────────

document.getElementById('add-player-btn').addEventListener('click', addPlayer);
document.getElementById('player-name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') addPlayer();
});

function addPlayer() {
  if (!isAdminMode || !_viewingTeamId) return;
  const nameEl   = document.getElementById('player-name-input');
  const numberEl = document.getElementById('player-number-input');
  const phoneEl  = document.getElementById('player-phone-input');
  const name = nameEl.value.trim();
  if (!name) return;
  const number = numberEl.value.trim();
  const phone  = phoneEl.value.trim();
  const id = genId('player');
  nameEl.value   = '';
  numberEl.value = '';
  phoneEl.value  = '';
  nameEl.focus();
  savePlayer({ id, name, number, phone, teamId: _viewingTeamId });
}

function removePlayer(id) {
  if (!isAdminMode) return;
  if (!confirm('Remove this player?')) return;
  deletePlayer(id);
}

document.getElementById('team-back-btn').addEventListener('click', () => {
  _viewingTeamId = null;
  renderRosterView();
});

// ── Dashboard View ─────────────────────────────────────────────────────────

function renderDashboard() {
  renderKpiStrip();
  renderUpcomingGamesCard();
  renderNeedsAttentionCard();

  // Update topbar subtitle with today's day
  const sub = document.getElementById('dashboard-subtitle');
  if (sub) {
    const today = new Date();
    const dayName = today.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
    const todayStr = today.toISOString().slice(0, 10);
    const hasGameToday = state.games.some(g => g.date === todayStr);
    sub.textContent = hasGameToday ? `GAME DAY · ${dayName}` : dayName;
  }
}

function renderKpiStrip() {
  const strip = document.getElementById('kpi-strip');
  if (!strip) return;

  const today = new Date().toISOString().slice(0, 10);

  // KPI 1: Next game
  const upcomingGames = state.games
    .filter(g => g.status !== 'completed' && g.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const nextGame = upcomingGames[0] || null;
  const nextGameDate = nextGame
    ? formatDateHeader(nextGame.date)
    : '—';
  const nextGameSub = nextGame
    ? `${formatTime(nextGame.time)} · ${escHtml(nextGame.fieldName)}`
    : 'No upcoming games';

  // KPI 2: RSVP rate for next game
  let rsvpRate = '—';
  let rsvpSub = 'no next game';
  if (nextGame) {
    const teamId = nextGame.homeTeamId; // show for home team or all players
    const playersInGame = state.players.filter(
      p => p.teamId === nextGame.homeTeamId || p.teamId === nextGame.awayTeamId
    );
    const rsvpsForGame = state.rsvps.filter(r => r.gameId === nextGame.id && r.status === 'going');
    const total = playersInGame.length;
    const going = rsvpsForGame.length;
    if (total > 0) {
      rsvpRate = `${Math.round((going / total) * 100)}%`;
      rsvpSub  = `${going}/${total} going`;
    } else {
      rsvpRate = '0%';
      rsvpSub  = 'no roster yet';
    }
  }

  // KPI 3: Record
  let wins = 0, losses = 0, ties = 0;
  for (const game of state.games) {
    if (game.status !== 'completed') continue;
    const hs = Number(game.homeScore);
    const as = Number(game.awayScore);
    if (isNaN(hs) || isNaN(as)) continue;
    if (!currentTeamId) {
      // Show overall league totals
      if (hs > as) wins++; else if (as > hs) losses++; else ties++;
    } else {
      const isHome = game.homeTeamId === currentTeamId;
      const isAway = game.awayTeamId === currentTeamId;
      if (!isHome && !isAway) continue;
      const myScore  = isHome ? hs : as;
      const oppScore = isHome ? as : hs;
      if (myScore > oppScore) wins++;
      else if (oppScore > myScore) losses++;
      else ties++;
    }
  }
  const recordStr = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
  const recordSub = currentTeamId ? 'your team' : 'all teams';

  // KPI 4: Total games scheduled
  const totalGames   = state.games.length;
  const completedCnt = state.games.filter(g => g.status === 'completed').length;

  strip.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-left">
        <div class="kpi-label">Next Game</div>
        <div class="kpi-value" style="font-size:16px;margin-top:6px;letter-spacing:-0.01em">${nextGameDate}</div>
        <div class="kpi-sub">${nextGameSub}</div>
      </div>
      <div class="kpi-icon brand">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-left">
        <div class="kpi-label">RSVP Rate</div>
        <div class="kpi-value">${rsvpRate}</div>
        <div class="kpi-sub">${rsvpSub}</div>
      </div>
      <div class="kpi-icon muted-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-left">
        <div class="kpi-label">Record</div>
        <div class="kpi-value">${recordStr}</div>
        <div class="kpi-sub">${recordSub}</div>
      </div>
      <div class="kpi-icon muted-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-left">
        <div class="kpi-label">Games</div>
        <div class="kpi-value">${totalGames}</div>
        <div class="kpi-sub">${completedCnt} completed</div>
      </div>
      <div class="kpi-icon muted-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </div>
    </div>`;
}

function renderUpcomingGamesCard() {
  const card = document.getElementById('upcoming-games-card');
  if (!card) return;

  const today = new Date().toISOString().slice(0, 10);
  const upcomingGames = state.games
    .filter(g => g.status !== 'completed' && g.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
    .slice(0, 6);

  let html = `
    <div class="card-header">
      <span class="card-header-title">Upcoming Games</span>
      <span class="card-header-sub">${upcomingGames.length} scheduled</span>
    </div>`;

  if (upcomingGames.length === 0) {
    html += `<div style="padding:24px 16px;"><p class="muted">No upcoming games. Generate a schedule in the Schedule view.</p></div>`;
  } else {
    for (const game of upcomingGames) {
      const homeRsvps = state.rsvps.filter(r => r.gameId === game.id && r.teamId === game.homeTeamId);
      const awayRsvps = state.rsvps.filter(r => r.gameId === game.id && r.teamId === game.awayTeamId);
      const allRsvps  = [...homeRsvps, ...awayRsvps];
      const going     = allRsvps.filter(r => r.status === 'going').length;
      const maybe     = allRsvps.filter(r => r.status === 'maybe').length;
      const notGoing  = allRsvps.filter(r => r.status === 'not_going').length;
      const total     = going + maybe + notGoing;

      let rsvpBarHtml = '';
      if (total > 0) {
        const goingPct   = Math.round((going   / total) * 100);
        const notPct     = Math.round((notGoing / total) * 100);
        const maybePct   = Math.max(0, 100 - goingPct - notPct);
        rsvpBarHtml = `
          <div class="rsvp-bar-wrap">
            <div class="rsvp-bar">
              <div class="rsvp-bar-going"  style="width:${goingPct}%"></div>
              <div class="rsvp-bar-maybe"  style="width:${maybePct}%"></div>
              <div class="rsvp-bar-out"    style="width:${notPct}%"></div>
            </div>
            <span class="rsvp-label">${going}/${total}</span>
          </div>`;
      } else {
        rsvpBarHtml = `<span class="rsvp-label" style="color:#ece6d6">No RSVPs</span>`;
      }

      html += `
        <div class="dashboard-game-row">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:13px;color:#161816">${escHtml(game.homeName)} <span style="color:#6e6f6a;font-weight:400">vs</span> ${escHtml(game.awayName)}</div>
            <div style="font-family:'Geist Mono',monospace;font-size:11px;color:#6e6f6a;margin-top:2px">${escHtml(formatDateHeader(game.date))} · ${escHtml(formatTime(game.time))} · ${escHtml(game.fieldName)}</div>
          </div>
          ${rsvpBarHtml}
        </div>`;
    }
  }

  card.innerHTML = html;
}

function renderNeedsAttentionCard() {
  const card = document.getElementById('needs-attention-card');
  if (!card) return;

  const today = new Date().toISOString().slice(0, 10);
  const nextGame = state.games
    .filter(g => g.status !== 'completed' && g.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))[0];

  const rows = [];

  if (nextGame) {
    const playersInGame = state.players.filter(
      p => p.teamId === nextGame.homeTeamId || p.teamId === nextGame.awayTeamId
    );
    const rsvpedIds = new Set(
      state.rsvps.filter(r => r.gameId === nextGame.id).map(r => r.playerId)
    );
    const missing = playersInGame.filter(p => !rsvpedIds.has(p.id));
    for (const player of missing.slice(0, 8)) {
      rows.push({ who: player.name, what: `No RSVP for ${formatDateHeader(nextGame.date)}` });
    }
    if (missing.length > 8) {
      rows.push({ who: `+${missing.length - 8} more`, what: 'players without RSVP' });
    }
  }

  if (state.teams.length === 0) {
    rows.push({ who: 'No teams', what: 'Add teams in Roster view' });
  }
  if (state.fields.length === 0) {
    rows.push({ who: 'No fields', what: 'Add fields in Settings' });
  }
  if (!state.scheduleConfig.startDate) {
    rows.push({ who: 'Season dates', what: 'Set start/end date in Settings' });
  }

  let html = `
    <div class="card-header">
      <span class="card-header-title">Needs Attention</span>
      <span class="card-header-sub">${rows.length} item${rows.length !== 1 ? 's' : ''}</span>
    </div>`;

  if (rows.length === 0) {
    html += `<div style="padding:24px 16px;"><p class="muted" style="margin:0">All good! Everyone has RSVP'd.</p></div>`;
  } else {
    for (const row of rows) {
      html += `
        <div class="attention-row">
          <div class="attention-dot"></div>
          <div>
            <div class="attention-who">${escHtml(row.who)}</div>
            <div class="attention-what">${escHtml(row.what)}</div>
          </div>
        </div>`;
    }
  }

  card.innerHTML = html;
}

// ── Schedule View ──────────────────────────────────────────────────────────

function renderScheduleView() {
  renderIdentityBar();

  const container = document.getElementById('schedule-container');
  if (!container) return;
  container.innerHTML = '';

  // Schedule subtitle
  const sub = document.getElementById('sched-subtitle');
  if (sub) {
    const cfg = state.scheduleConfig;
    if (cfg.startDate && cfg.endDate) {
      sub.textContent = `${formatDateHeader(cfg.startDate)} – ${formatDateHeader(cfg.endDate)}`;
    } else {
      sub.textContent = 'SCHEDULE';
    }
  }

  // Admin action buttons
  if (isAdminMode) {
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'schedule-actions';
    actionsDiv.innerHTML = `
      <button id="generate-schedule-btn" class="btn btn-primary">Generate Schedule</button>
      <button id="clear-schedule-btn" class="btn btn-danger">Clear Schedule</button>`;
    container.appendChild(actionsDiv);
    actionsDiv.querySelector('#generate-schedule-btn').addEventListener('click', handleGenerateSchedule);
    actionsDiv.querySelector('#clear-schedule-btn').addEventListener('click', handleClearSchedule);
  }

  if (state.games.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'schedule-empty';
    empty.innerHTML = `<p class="muted">No games scheduled yet.</p>`;
    if (!isAdminMode) {
      empty.innerHTML += `<p class="muted" style="margin-top:0.4rem;">Use <strong>Admin View</strong> and <strong>Generate Schedule</strong> to create a schedule.</p>`;
    }
    container.appendChild(empty);
    return;
  }

  // Group games by date
  const byDate = new Map();
  for (const game of state.games) {
    if (!byDate.has(game.date)) byDate.set(game.date, []);
    byDate.get(game.date).push(game);
  }

  for (const [date, games] of byDate) {
    const dateGroup = document.createElement('div');
    dateGroup.className = 'schedule-date-group';

    const header = document.createElement('div');
    header.className = 'schedule-date-header';
    header.textContent = formatDateHeader(date);
    dateGroup.appendChild(header);

    const gamesList = document.createElement('ul');
    gamesList.className = 'schedule-games-list';

    for (const game of games) {
      const li = document.createElement('li');
      li.className = 'schedule-game-row';
      li.dataset.gameId = game.id;

      const scoreDisplay = game.status === 'completed'
        ? `<span class="score-display">${game.homeScore} &ndash; ${game.awayScore}</span>`
        : `<span class="score-vs">vs</span>`;

      const editBtnHtml = isAdminMode
        ? `<button class="btn btn-ghost btn-sm edit-score-btn">Edit Score</button>`
        : '';

      li.innerHTML = `
        <span class="game-time">${escHtml(formatTime(game.time))}</span>
        <span class="game-field">${escHtml(game.fieldName)}</span>
        <span class="game-matchup">
          <span class="team-name-home">${escHtml(game.homeName)}</span>
          ${scoreDisplay}
          <span class="team-name-away">${escHtml(game.awayName)}</span>
        </span>
        <span class="game-actions">${editBtnHtml}</span>`;

      if (isAdminMode) {
        li.querySelector('.edit-score-btn').addEventListener('click', () => showInlineScoreEdit(li, game));
      }

      // RSVP buttons for current player's team games
      if (game.status !== 'completed') {
        if (currentPlayerId && currentTeamId &&
            (game.homeTeamId === currentTeamId || game.awayTeamId === currentTeamId)) {
          const existingRsvp = state.rsvps.find(r => r.gameId === game.id && r.playerId === currentPlayerId);
          const currentStatus = existingRsvp ? existingRsvp.status : null;
          const rsvpDiv = document.createElement('div');
          rsvpDiv.className = 'rsvp-buttons';
          rsvpDiv.innerHTML = `
            <button class="rsvp-btn going${currentStatus === 'going' ? ' active' : ''}" data-status="going">Going</button>
            <button class="rsvp-btn maybe${currentStatus === 'maybe' ? ' active' : ''}" data-status="maybe">Maybe</button>
            <button class="rsvp-btn not_going${currentStatus === 'not_going' ? ' active' : ''}" data-status="not_going">Can't Make It</button>`;
          rsvpDiv.querySelectorAll('.rsvp-btn').forEach(btn => {
            btn.addEventListener('click', () => setRsvp(game.id, btn.dataset.status));
          });
          li.appendChild(rsvpDiv);
        }

        // RSVP summary (bar + text)
        const homeRsvps = state.rsvps.filter(r => r.gameId === game.id && r.teamId === game.homeTeamId);
        const awayRsvps = state.rsvps.filter(r => r.gameId === game.id && r.teamId === game.awayTeamId);
        const allR = [...homeRsvps, ...awayRsvps];
        if (allR.length > 0) {
          const going    = allR.filter(r => r.status === 'going').length;
          const notGoing = allR.filter(r => r.status === 'not_going').length;
          const maybe    = allR.filter(r => r.status === 'maybe').length;
          const total    = allR.length;
          const goingPct = Math.round((going   / total) * 100);
          const notPct   = Math.round((notGoing / total) * 100);
          const maybePct = Math.max(0, 100 - goingPct - notPct);

          const summaryDiv = document.createElement('div');
          summaryDiv.className = 'rsvp-summary';
          summaryDiv.innerHTML =
            `<strong>${escHtml(game.homeName)}:</strong> ` +
            `${homeRsvps.filter(r=>r.status==='going').length} going &middot; ` +
            `${homeRsvps.filter(r=>r.status==='maybe').length} maybe &middot; ` +
            `${homeRsvps.filter(r=>r.status==='not_going').length} out` +
            ` &nbsp;|&nbsp; ` +
            `<strong>${escHtml(game.awayName)}:</strong> ` +
            `${awayRsvps.filter(r=>r.status==='going').length} going &middot; ` +
            `${awayRsvps.filter(r=>r.status==='maybe').length} maybe &middot; ` +
            `${awayRsvps.filter(r=>r.status==='not_going').length} out`;
          li.appendChild(summaryDiv);
        }
      }

      gamesList.appendChild(li);
    }

    dateGroup.appendChild(gamesList);
    container.appendChild(dateGroup);
  }
}

function renderIdentityBar() {
  const bar = document.getElementById('identity-bar');
  if (!bar) return;

  if (currentPlayerId && currentPlayerName) {
    const player   = state.players.find(p => p.id === currentPlayerId);
    const team     = player ? state.teams.find(t => t.id === player.teamId) : null;
    const teamName = team ? team.name : 'Unknown team';
    bar.innerHTML = `
      <div class="identity-bar">
        <span>Viewing as: <strong>${escHtml(currentPlayerName)}</strong> &mdash; ${escHtml(teamName)}</span>
        <button id="identity-change-btn" class="btn btn-ghost btn-sm">Change</button>
      </div>`;
    bar.querySelector('#identity-change-btn').addEventListener('click', () => {
      clearIdentity();
      renderScheduleView();
    });
  } else {
    let optionsHtml = '<option value="">— select player —</option>';
    for (const team of state.teams) {
      const teamPlayers = state.players.filter(p => p.teamId === team.id);
      if (teamPlayers.length === 0) continue;
      optionsHtml += `<optgroup label="${escHtml(team.name)}">` +
        teamPlayers.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('') +
        '</optgroup>';
    }
    const noTeamPlayers = state.players.filter(p => !state.teams.find(t => t.id === p.teamId));
    if (noTeamPlayers.length > 0) {
      optionsHtml += '<optgroup label="(No Team)">' +
        noTeamPlayers.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('') +
        '</optgroup>';
    }
    bar.innerHTML = `
      <div class="identity-bar">
        <span>Who are you?</span>
        <select id="identity-select">${optionsHtml}</select>
        <button id="identity-set-btn" class="btn btn-primary btn-sm">Set</button>
      </div>`;
    bar.querySelector('#identity-set-btn').addEventListener('click', () => {
      const sel = bar.querySelector('#identity-select');
      const playerId = sel.value;
      if (!playerId) { alert('Please select a player.'); return; }
      const player = state.players.find(p => p.id === playerId);
      if (!player) return;
      setIdentity(player.id, player.name);
      renderScheduleView();
    });
  }
}

function showInlineScoreEdit(li, game) {
  const actionsSpan = li.querySelector('.game-actions');
  const matchupSpan = li.querySelector('.game-matchup');
  const scoreNode   = matchupSpan.querySelector('.score-display, .score-vs');

  const homeInput = document.createElement('input');
  homeInput.type = 'number'; homeInput.min = '0'; homeInput.className = 'score-input';
  homeInput.value = game.homeScore != null ? game.homeScore : ''; homeInput.placeholder = '0';

  const sep = document.createElement('span');
  sep.className = 'score-sep'; sep.textContent = '–';

  const awayInput = document.createElement('input');
  awayInput.type = 'number'; awayInput.min = '0'; awayInput.className = 'score-input';
  awayInput.value = game.awayScore != null ? game.awayScore : ''; awayInput.placeholder = '0';

  scoreNode.replaceWith(homeInput, sep, awayInput);

  actionsSpan.innerHTML = `<button class="btn btn-primary btn-sm save-score-btn">Save</button>`;
  actionsSpan.querySelector('.save-score-btn').addEventListener('click', () => {
    const hs = parseInt(homeInput.value, 10);
    const as = parseInt(awayInput.value, 10);
    if (isNaN(hs) || isNaN(as)) { alert('Please enter valid scores.'); return; }
    firestoreWrite(setDoc(doc(db, 'games', game.id), {
      date: game.date, time: game.time, fieldId: game.fieldId, fieldName: game.fieldName,
      homeTeamId: game.homeTeamId, homeName: game.homeName,
      awayTeamId: game.awayTeamId, awayName: game.awayName,
      homeScore: hs, awayScore: as, status: 'completed',
    }));
  });
}

async function handleClearSchedule() {
  if (!isAdminMode) return;
  if (!confirm('Delete ALL games? This cannot be undone.')) return;
  const snap  = await getDocs(collection(db, 'games'));
  const CHUNK = 500;
  const docs  = snap.docs;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = writeBatch(db);
    docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  showBanner('Schedule cleared.', 'success');
}

async function handleGenerateSchedule() {
  if (!isAdminMode) return;
  if (state.teams.length < 2)    { showBanner('Need at least 2 teams to generate a schedule.', 'error'); return; }
  if (state.fields.length === 0)  { showBanner('Add at least one field before generating a schedule.', 'error'); return; }
  const cfg = state.scheduleConfig;
  if (!cfg.startDate || !cfg.endDate) { showBanner('Set a season start and end date in Settings before generating.', 'error'); return; }
  if (cfg.startDate > cfg.endDate)    { showBanner('Season start date must be before end date.', 'error'); return; }

  const scheduledGames = state.games.filter(g => g.status === 'scheduled');
  if (scheduledGames.length > 0) {
    if (!confirm(`This will delete ${scheduledGames.length} existing scheduled game(s) and regenerate. Continue?`)) return;
  }

  showBanner('Generating schedule… (fetching daylight data for fields without lights)', 'success');

  const { games: newGames, skipped, daylightConstrainedCount } = await generateSchedule(state.teams, state.fields, cfg);

  try {
    const snap = await getDocs(query(collection(db, 'games'), where('status', '==', 'scheduled')));
    const CHUNK = 500;
    for (let i = 0; i < snap.docs.length; i += CHUNK) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    for (let i = 0; i < newGames.length; i += CHUNK) {
      const batch = writeBatch(db);
      newGames.slice(i, i + CHUNK).forEach(game => {
        const ref = doc(collection(db, 'games'));
        batch.set(ref, {
          date: game.date, time: game.time, fieldId: game.fieldId, fieldName: game.fieldName,
          homeTeamId: game.homeTeamId, homeName: game.homeName,
          awayTeamId: game.awayTeamId, awayName: game.awayName,
          homeScore: null, awayScore: null, status: 'scheduled',
        });
      });
      await batch.commit();
    }
    const parts = [`Schedule generated: ${newGames.length} game(s) scheduled.`];
    if (daylightConstrainedCount > 0) parts.push(`${daylightConstrainedCount} field-date(s) were daylight-limited.`);
    if (skipped > 0) parts.push(`${skipped} matchup(s) could not be scheduled — add more field slots or extend the season.`);
    showBanner(parts.join(' '), skipped > 0 ? 'error' : 'success');
  } catch (err) {
    showDbError(err);
  }
}

// ── Roster View ────────────────────────────────────────────────────────────

function renderRosterView() {
  if (_viewingTeamId) {
    const team = state.teams.find(t => t.id === _viewingTeamId);
    if (team) { showTeamDetail(team); return; }
    _viewingTeamId = null;
  }
  showTeamList();

  // Update subtitle
  const sub = document.getElementById('roster-subtitle');
  if (sub) sub.textContent = `${state.teams.length} TEAM${state.teams.length !== 1 ? 'S' : ''} · ${state.players.length} PLAYERS`;
}

function showTeamList() {
  document.getElementById('team-list-view').style.display   = '';
  document.getElementById('team-detail-view').style.display = 'none';

  const list = document.getElementById('team-list');
  const msg  = document.getElementById('no-teams-msg');
  list.innerHTML = '';

  if (state.teams.length === 0) {
    msg.style.display = '';
  } else {
    msg.style.display = 'none';
    state.teams.forEach(team => {
      const playerCount = state.players.filter(p => p.teamId === team.id).length;
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="info">
          <button class="name-btn">${escHtml(team.name)}</button>
          <span class="sub">
            ${team.color ? escHtml(team.color) + ' &bull; ' : ''}
            ${team.homefield ? escHtml(team.homefield) : ''}
          </span>
        </span>
        <span class="badge">${playerCount} player${playerCount !== 1 ? 's' : ''}</span>
        <button class="remove-btn" style="display:${isAdminMode ? '' : 'none'}">Remove</button>`;
      li.querySelector('.name-btn').addEventListener('click', () => {
        _viewingTeamId = team.id;
        renderRosterView();
      });
      li.querySelector('.remove-btn').addEventListener('click', () => removeTeam(team.id));
      list.appendChild(li);
    });
  }

  const allList = document.getElementById('all-players-list');
  const allMsg  = document.getElementById('no-players-msg');
  allList.innerHTML = '';

  if (state.players.length === 0) {
    allMsg.style.display = '';
  } else {
    allMsg.style.display = 'none';
    state.players.forEach(player => {
      const team = state.teams.find(t => t.id === player.teamId);
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="info">
          <span class="name">
            ${player.number ? `<span class="jersey-badge">#${escHtml(player.number)}</span>` : ''}
            ${escHtml(player.name)}
          </span>
          <span class="sub">
            ${team ? escHtml(team.name) : '<em>Unknown team</em>'}
            ${player.phone ? ' &bull; ' + escHtml(player.phone) : ''}
          </span>
        </span>
        <button class="remove-btn" style="display:${isAdminMode ? '' : 'none'}">Remove</button>`;
      li.querySelector('.remove-btn').addEventListener('click', () => removePlayer(player.id));
      allList.appendChild(li);
    });
  }

  syncAdminUi();
}

function showTeamDetail(team) {
  document.getElementById('team-list-view').style.display   = 'none';
  document.getElementById('team-detail-view').style.display = '';

  const sub = document.getElementById('roster-subtitle');
  if (sub) sub.textContent = team.name.toUpperCase();

  document.getElementById('team-detail-name').textContent = team.name;
  const metaParts = [];
  if (team.color)     metaParts.push(team.color);
  if (team.homefield) metaParts.push(team.homefield);
  document.getElementById('team-detail-meta').textContent = metaParts.join(' · ');

  const roster = state.players.filter(p => p.teamId === team.id);
  const list   = document.getElementById('roster-list');
  const msg    = document.getElementById('no-roster-msg');
  list.innerHTML = '';

  if (roster.length === 0) {
    msg.style.display = '';
  } else {
    msg.style.display = 'none';
    roster.forEach(player => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="info">
          <span class="name">
            ${player.number ? `<span class="jersey-badge">#${escHtml(player.number)}</span>` : ''}
            ${escHtml(player.name)}
          </span>
          ${player.phone ? `<span class="sub">${escHtml(player.phone)}</span>` : ''}
        </span>
        <button class="remove-btn" style="display:${isAdminMode ? '' : 'none'}">Remove</button>`;
      li.querySelector('.remove-btn').addEventListener('click', () => removePlayer(player.id));
      list.appendChild(li);
    });
  }

  // Upcoming games for this team
  const upcomingSection = document.getElementById('team-upcoming-section');
  const today = new Date().toISOString().slice(0, 10);
  const upcomingGames = state.games
    .filter(g => g.status !== 'completed' && g.date >= today &&
                 (g.homeTeamId === team.id || g.awayTeamId === team.id))
    .slice(0, 5);

  if (upcomingGames.length === 0) {
    upcomingSection.innerHTML = '';
  } else {
    let html = '<hr class="section-divider"/><div class="section-heading">Upcoming Games</div><ul class="item-list">';
    for (const game of upcomingGames) {
      const isHome   = game.homeTeamId === team.id;
      const opponent = isHome ? game.awayName : game.homeName;
      const role     = isHome ? 'vs' : '@';
      const gameRsvps = state.rsvps.filter(r => r.gameId === game.id && r.teamId === team.id);
      const going    = gameRsvps.filter(r => r.status === 'going').length;
      const maybe    = gameRsvps.filter(r => r.status === 'maybe').length;
      const notGoing = gameRsvps.filter(r => r.status === 'not_going').length;
      const rsvpLine = (going + maybe + notGoing > 0)
        ? `${going} going · ${maybe} maybe · ${notGoing} out`
        : '';
      html += `
        <li>
          <span class="info">
            <span class="name">${escHtml(formatDateHeader(game.date))} ${escHtml(formatTime(game.time))} — ${escHtml(role)} ${escHtml(opponent)}</span>
            <span class="sub">${escHtml(game.fieldName)}${rsvpLine ? ' · ' + rsvpLine : ''}</span>
          </span>
        </li>`;
    }
    html += '</ul>';
    upcomingSection.innerHTML = html;
  }

  syncAdminUi();
}

// ── League View ────────────────────────────────────────────────────────────

function renderLeagueView() {
  const container = document.getElementById('standings-container');
  if (!container) return;

  const hasCompleted = state.games.some(g => g.status === 'completed');
  if (state.teams.length === 0 || !hasCompleted) {
    container.innerHTML = '<p class="muted" style="padding:1rem 0;">No completed games yet. Standings will appear here once scores are recorded.</p>';
    return;
  }

  const rows = computeStandings();
  let html = `
    <table class="standings-table">
      <thead><tr>
        <th class="standings-rank">#</th>
        <th>Team</th><th>GP</th><th>W</th><th>L</th><th>T</th>
        <th>GF</th><th>GA</th><th>GD</th><th>Pts</th>
      </tr></thead>
      <tbody>`;
  rows.forEach((row, idx) => {
    const gd = row.GF - row.GA;
    const gdStr = gd > 0 ? `+${gd}` : String(gd);
    const leaderClass = idx === 0 ? ' class="standings-leader"' : '';
    html += `<tr${leaderClass}>
      <td class="standings-rank">${idx + 1}</td>
      <td>${escHtml(row.name)}</td>
      <td>${row.GP}</td><td>${row.W}</td><td>${row.L}</td><td>${row.T}</td>
      <td>${row.GF}</td><td>${row.GA}</td><td>${gdStr}</td>
      <td><strong>${row.Pts}</strong></td>
    </tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

function computeStandings() {
  const statsMap = new Map();
  for (const team of state.teams) {
    statsMap.set(team.id, { teamId: team.id, name: team.name, GP: 0, W: 0, L: 0, T: 0, GF: 0, GA: 0, Pts: 0 });
  }
  for (const game of state.games) {
    if (game.status !== 'completed') continue;
    const hs = Number(game.homeScore);
    const as = Number(game.awayScore);
    if (isNaN(hs) || isNaN(as)) continue;
    const home = statsMap.get(game.homeTeamId);
    const away = statsMap.get(game.awayTeamId);
    if (!home || !away) continue;
    home.GP++; away.GP++;
    home.GF += hs; home.GA += as;
    away.GF += as; away.GA += hs;
    if (hs > as)      { home.W++; home.Pts += 3; away.L++; }
    else if (as > hs) { away.W++; away.Pts += 3; home.L++; }
    else              { home.T++; home.Pts += 1; away.T++; away.Pts += 1; }
  }
  const rows = Array.from(statsMap.values());
  rows.sort((a, b) => {
    if (b.Pts !== a.Pts) return b.Pts - a.Pts;
    const gdA = a.GF - a.GA, gdB = b.GF - b.GA;
    if (gdB !== gdA) return gdB - gdA;
    if (b.GF !== a.GF) return b.GF - a.GF;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

// ── Settings View ──────────────────────────────────────────────────────────

function renderSettingsView() {
  renderFieldsSection();
  renderScheduleConfigSection();
  syncAdminUi();
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function renderFieldsSection() {
  const list  = document.getElementById('fields-list');
  const noMsg = document.getElementById('no-fields-msg');
  if (!list || !noMsg) return;
  list.innerHTML = '';

  if (state.fields.length === 0) {
    noMsg.style.display = '';
  } else {
    noMsg.style.display = 'none';
    state.fields.forEach(field => {
      const days      = Array.isArray(field.availableDays) ? field.availableDays : [];
      const dayStr    = days.map(d => DAY_LABELS[d]).join(', ');
      const lightsIcon = field.hasLights ? '💡' : '🌙';
      const zipText   = field.zipCode ? ` · ZIP ${escHtml(field.zipCode)}` : '';
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="info">
          <span class="name">
            <span class="field-lights-icon">${lightsIcon}</span>${escHtml(field.name)}
          </span>
          <span class="sub">${dayStr || 'No days'} · ${escHtml(field.openTime)} – ${escHtml(field.closeTime)}${zipText}</span>
        </span>
        <button class="remove-btn" style="display:${isAdminMode ? '' : 'none'}">Remove</button>`;
      li.querySelector('.remove-btn').addEventListener('click', () => {
        if (!isAdminMode) return;
        if (!confirm('Remove this field?')) return;
        deleteField(field.id);
      });
      list.appendChild(li);
    });
  }

  const addForm = document.getElementById('field-add-form');
  if (addForm) addForm.style.display = isAdminMode ? '' : 'none';
}

function addField() {
  if (!isAdminMode) return;
  const nameEl    = document.getElementById('field-name-input');
  const openEl    = document.getElementById('field-open-input');
  const closeEl   = document.getElementById('field-close-input');
  const lightsEl  = document.getElementById('field-lights-input');
  const zipEl     = document.getElementById('field-zip-input');
  const name      = nameEl.value.trim();
  const openTime  = openEl.value;
  const closeTime = closeEl.value;
  const hasLights = lightsEl ? lightsEl.checked : false;
  const zipCode   = zipEl ? zipEl.value.trim() : '';
  if (!name)               { alert('Please enter a field name.'); return; }
  if (!openTime || !closeTime) { alert('Please set open and close times.'); return; }
  const availableDays = [];
  DAY_LABELS.forEach((_, i) => {
    const cb = document.getElementById(`field-day-${i}`);
    if (cb && cb.checked) availableDays.push(i);
  });
  if (availableDays.length === 0) { alert('Select at least one available day.'); return; }
  nameEl.value = ''; openEl.value = ''; closeEl.value = '';
  if (lightsEl) lightsEl.checked = false;
  if (zipEl)    zipEl.value = '';
  DAY_LABELS.forEach((_, i) => {
    const cb = document.getElementById(`field-day-${i}`);
    if (cb) cb.checked = false;
  });
  saveField({ id: genId('field'), name, availableDays, openTime, closeTime, hasLights, zipCode });
}

function renderScheduleConfigSection() {
  const cfg     = state.scheduleConfig;
  const durEl   = document.getElementById('cfg-game-duration');
  const bufEl   = document.getElementById('cfg-buffer-minutes');
  const startEl = document.getElementById('cfg-start-date');
  const endEl   = document.getElementById('cfg-end-date');
  const rndEl   = document.getElementById('cfg-rounds');
  if (!durEl) return;

  durEl.value   = cfg.gameDuration;
  bufEl.value   = cfg.bufferMinutes;
  startEl.value = cfg.startDate;
  endEl.value   = cfg.endDate;
  rndEl.value   = cfg.rounds;

  const disabled = !isAdminMode;
  [durEl, bufEl, startEl, endEl, rndEl].forEach(el => { el.disabled = disabled; });

  const saveBtn = document.getElementById('save-config-btn');
  if (saveBtn) {
    saveBtn.style.display = isAdminMode ? '' : 'none';
    const newBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newBtn, saveBtn);
    newBtn.addEventListener('click', () => {
      if (!isAdminMode) return;
      saveScheduleConfig({
        gameDuration:  Number(durEl.value)   || 90,
        bufferMinutes: Number(bufEl.value)   || 15,
        startDate:     startEl.value         || '',
        endDate:       endEl.value           || '',
        rounds:        Number(rndEl.value)   || 1,
      }).then(() => showBanner('Schedule config saved.', 'success'));
    });
  }
}

// Wire field add button once
document.getElementById('add-field-btn').addEventListener('click', addField);

// ── Sunrise/sunset helpers ─────────────────────────────────────────────────

async function fetchZipInfo(zip) {
  if (zipCache.has(zip)) return zipCache.get(zip);
  try {
    const r = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!r.ok) return null;
    const d = await r.json();
    const place = d.places[0];
    const st    = place['state abbreviation'];
    const info  = {
      lat:      parseFloat(place.latitude),
      lng:      parseFloat(place.longitude),
      timezone: STATE_TZ[st] || 'America/Chicago',
    };
    zipCache.set(zip, info);
    return info;
  } catch { return null; }
}

async function fetchSunriseSunset(lat, lng, date, timezone) {
  const key = `${lat},${lng},${date}`;
  if (sunCache.has(key)) return sunCache.get(key);
  try {
    const r = await fetch(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&date=${date}&formatted=0`);
    if (!r.ok) return null;
    const d = await r.json();
    if (d.status !== 'OK') return null;
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const normalize = t => t.startsWith('24') ? '00' + t.slice(2) : t;
    const result = {
      sunrise: normalize(fmt.format(new Date(d.results.sunrise))),
      sunset:  normalize(fmt.format(new Date(d.results.sunset))),
    };
    sunCache.set(key, result);
    return result;
  } catch { return null; }
}

function clampTimeToWindow(time, min, max) {
  if (time < min) return min;
  if (time > max) return max;
  return time;
}

// ── Auto-Scheduler ─────────────────────────────────────────────────────────

async function generateSchedule(teams, fields, config) {
  const matchups = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      for (let r = 0; r < config.rounds; r++) {
        if (r % 2 === 0) {
          matchups.push({ home: teams[i], away: teams[j] });
          matchups.push({ home: teams[j], away: teams[i] });
        } else {
          matchups.push({ home: teams[j], away: teams[i] });
          matchups.push({ home: teams[i], away: teams[j] });
        }
      }
    }
  }
  for (let i = matchups.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [matchups[i], matchups[j]] = [matchups[j], matchups[i]];
  }

  const slots = [];
  const gameDur    = Number(config.gameDuration)  || 90;
  const bufferMins = Number(config.bufferMinutes) || 15;
  const interval   = gameDur + bufferMins;
  let daylightConstrainedCount = 0;

  const [sy, sm, sd] = config.startDate.split('-').map(Number);
  const [ey, em, ed] = config.endDate.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd);
  const end   = new Date(ey, em - 1, ed);

  for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const dow = cur.getDay();
    const yy  = cur.getFullYear();
    const mm  = String(cur.getMonth() + 1).padStart(2, '0');
    const dd  = String(cur.getDate()).padStart(2, '0');
    const dateStr = `${yy}-${mm}-${dd}`;

    for (const field of fields) {
      const days = Array.isArray(field.availableDays) ? field.availableDays : [];
      if (!days.includes(dow)) continue;

      let effectiveOpen  = field.openTime;
      let effectiveClose = field.closeTime;

      if (!field.hasLights && field.zipCode) {
        const zipInfo = await fetchZipInfo(field.zipCode);
        if (zipInfo) {
          const sun = await fetchSunriseSunset(zipInfo.lat, zipInfo.lng, dateStr, zipInfo.timezone);
          if (sun) {
            const clampedOpen  = clampTimeToWindow(field.openTime,  sun.sunrise, sun.sunset);
            const clampedClose = clampTimeToWindow(field.closeTime, sun.sunrise, sun.sunset);
            if (clampedOpen >= clampedClose) { daylightConstrainedCount++; continue; }
            if (clampedOpen !== field.openTime || clampedClose !== field.closeTime) daylightConstrainedCount++;
            effectiveOpen  = clampedOpen;
            effectiveClose = clampedClose;
          }
        }
      }

      const [oh, om] = effectiveOpen.split(':').map(Number);
      const [ch, cm] = effectiveClose.split(':').map(Number);
      const openMins  = oh * 60 + om;
      const closeMins = ch * 60 + cm;

      let slotStart = openMins;
      while (slotStart + gameDur <= closeMins) {
        const hh  = String(Math.floor(slotStart / 60)).padStart(2, '0');
        const min = String(slotStart % 60).padStart(2, '0');
        slots.push({ date: dateStr, time: `${hh}:${min}`, fieldId: field.id, fieldName: field.name });
        slotStart += interval;
      }
    }
  }

  slots.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.time !== b.time) return a.time.localeCompare(b.time);
    return a.fieldId.localeCompare(b.fieldId);
  });

  const busyTeams    = new Map();
  const assignedGames = [];
  let skipped = 0;

  for (const matchup of matchups) {
    let assigned = false;
    for (const slot of slots) {
      const key = `${slot.date} ${slot.time}`;
      if (!busyTeams.has(key)) busyTeams.set(key, new Set());
      const busy = busyTeams.get(key);
      if (!busy.has(matchup.home.id) && !busy.has(matchup.away.id)) {
        busy.add(matchup.home.id);
        busy.add(matchup.away.id);
        assignedGames.push({
          date: slot.date, time: slot.time,
          fieldId: slot.fieldId, fieldName: slot.fieldName,
          homeTeamId: matchup.home.id, homeName: matchup.home.name,
          awayTeamId: matchup.away.id, awayName: matchup.away.name,
        });
        assigned = true;
        break;
      }
    }
    if (!assigned) skipped++;
  }

  return { games: assignedGames, skipped, daylightConstrainedCount };
}

// ── Utilities ──────────────────────────────────────────────────────────────

function formatDateHeader(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(timeStr) {
  const [h, min] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(min).padStart(2, '0')} ${ampm}`;
}

function showBanner(msg, type = 'error') {
  const el = document.getElementById('db-banner');
  el.textContent = msg;
  el.className   = `db-banner--${type}`;
  el.style.display = 'block';
  if (type !== 'error') {
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 6000);
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
