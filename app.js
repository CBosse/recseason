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
  getDoc,
  query,
  where,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ── Firebase ───────────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey: "AIzaSyB_qR9FLOCc0uRKmBNmiNBAoAq98tlZ1WU",
  authDomain: "bosse-testing.firebaseapp.com",
  projectId: "bosse-testing",
  storageBucket: "bosse-testing.firebasestorage.app",
  messagingSenderId: "327987648702",
  appId: "1:327987648702:web:b0a2337dc099e6772aa6ef",
};

const firebaseApp = initializeApp(firebaseConfig);
const db   = getFirestore(firebaseApp, 'recseason');
const auth = getAuth(firebaseApp);

// ── Role constants ─────────────────────────────────────────────────────────

const ROLE_LABELS = {
  siteAdmin:     'Site Admin',
  commissioner:  'Commissioner',
  leagueManager: 'League Mgr',
  teamManager:   'Team Manager',
  captain:       'Captain',
  player:        'Player',
  parent:        'Parent',
  umpire:        'Umpire',
  scorekeeper:   'Scorekeeper',
  visitor:       'Visitor',
};

const ROLE_CHIP = {
  siteAdmin:     'chip-brand',
  commissioner:  'chip-brand',
  leagueManager: 'chip-brand',
  teamManager:   'chip-default',
  captain:       'chip-outline',
  player:        'chip-default',
  parent:        'chip-default',
  umpire:        'chip-danger',
  scorekeeper:   'chip-outline',
  visitor:       'chip-outline',
};

// ── State ──────────────────────────────────────────────────────────────────

const state = {
  teams:          [],
  players:        [],
  fields:         [],
  games:          [],
  rsvps:          [],
  umpires:        [],
  allUsers:       [],
  scheduleConfig: { gameDuration: 90, bufferMinutes: 15, startDate: '', endDate: '', rounds: 1 },
  _ready: { teams: false, players: false, fields: false, games: false, scheduleConfig: false, rsvps: false },
};

let currentUser       = null;
let _viewingTeamId    = null;
let _activeView       = 'dashboard';
let _listenersStarted = false;
let _connectTimeout   = null;

// ── Role helpers ───────────────────────────────────────────────────────────

function canEdit() {
  return !!currentUser && ['siteAdmin', 'commissioner', 'leagueManager'].includes(currentUser.role);
}

function canEditTeam(teamId) {
  if (canEdit()) return true;
  return !!(currentUser?.role === 'teamManager' && currentUser.linkedTeamId === teamId);
}

function getRsvpPlayerId() {
  if (!currentUser) return null;
  if (['player', 'captain'].includes(currentUser.role)) return currentUser.linkedPlayerId || null;
  if (currentUser.role === 'parent' && currentUser.linkedPlayerIds?.length) {
    return currentUser._selectedChildId || currentUser.linkedPlayerIds[0];
  }
  if (canEdit() && currentUser._impersonatingPlayerId) return currentUser._impersonatingPlayerId;
  return null;
}

// ── Auth state ─────────────────────────────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        const d = snap.data();
        currentUser = {
          uid:             user.uid,
          email:           user.email,
          displayName:     d.displayName || user.email,
          role:            d.role        || 'player',
          linkedPlayerId:  d.linkedPlayerId  || null,
          linkedTeamId:    d.linkedTeamId    || null,
          linkedLeagueId:  d.linkedLeagueId  || null,
          linkedLeagueIds: d.linkedLeagueIds || [],
          linkedPlayerIds: d.linkedPlayerIds || [],
        };
      } else {
        // No user doc yet — new sign-up.
        // Check if ANY users exist to decide whether this is the first (siteAdmin).
        const usersSnap = await getDocs(collection(db, 'users'));
        const role = usersSnap.empty ? 'siteAdmin' : 'player';
        // Use the name captured from the sign-up form, fall back to email.
        const displayName = _pendingDisplayName || user.email;
        _pendingDisplayName = null;
        currentUser = {
          uid: user.uid, email: user.email,
          displayName,
          role, linkedPlayerId: null, linkedTeamId: null,
          linkedLeagueId: null, linkedLeagueIds: [], linkedPlayerIds: [],
        };
        await setDoc(doc(db, 'users', user.uid), {
          email: currentUser.email, displayName: currentUser.displayName,
          role: currentUser.role, createdAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('Error loading user profile:', err);
      currentUser = {
        uid: user.uid, email: user.email,
        displayName: _pendingDisplayName || user.email,
        role: 'player', linkedPlayerId: null, linkedTeamId: null,
        linkedLeagueId: null, linkedLeagueIds: [], linkedPlayerIds: [],
      };
      _pendingDisplayName = null;
    }
    showApp();
  } else {
    currentUser = null;
    showAuthScreen();
  }
});

function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-layout').style.display  = '';
  applyRoleNav();
  startListeners();
}

function showAuthScreen() {
  document.getElementById('auth-screen').style.display = '';
  document.getElementById('app-layout').style.display  = 'none';
}

// ── Auth form ──────────────────────────────────────────────────────────────

let _authMode = 'signin';
let _pendingDisplayName = null; // passed to onAuthStateChanged on sign-up

document.getElementById('auth-toggle-btn').addEventListener('click', () => {
  _authMode = _authMode === 'signin' ? 'signup' : 'signin';
  const isSignup = _authMode === 'signup';
  document.getElementById('auth-heading').textContent    = isSignup ? 'Create your account' : 'Sign in to your account';
  document.getElementById('auth-submit-btn').textContent = isSignup ? 'Sign Up' : 'Sign In';
  document.getElementById('auth-toggle-msg').textContent = isSignup ? 'Already have an account?' : "Don't have an account?";
  document.getElementById('auth-toggle-btn').textContent = isSignup ? 'Sign In' : 'Sign Up';
  document.getElementById('auth-name-field').style.display = isSignup ? '' : 'none';
  document.getElementById('auth-error').style.display      = 'none';
});

document.getElementById('auth-submit-btn').addEventListener('click', handleAuthSubmit);
document.getElementById('auth-password').addEventListener('keydown', e => { if (e.key === 'Enter') handleAuthSubmit(); });

async function handleAuthSubmit() {
  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  document.getElementById('auth-error').style.display = 'none';
  if (!email || !password) { showAuthError('Please enter email and password.'); return; }

  const submitBtn = document.getElementById('auth-submit-btn');
  submitBtn.disabled   = true;
  submitBtn.textContent = _authMode === 'signup' ? 'Creating account…' : 'Signing in…';

  try {
    if (_authMode === 'signup') {
      // Store name so onAuthStateChanged can use it — do NOT write the user doc
      // here to avoid racing with onAuthStateChanged's first-user siteAdmin check.
      _pendingDisplayName = document.getElementById('auth-name').value.trim() || email;
      await createUserWithEmailAndPassword(auth, email, password);
      // onAuthStateChanged fires next and handles user doc creation with correct role.
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    _pendingDisplayName = null;
    const msgs = {
      'auth/invalid-email':           'Invalid email address.',
      'auth/user-not-found':          'No account found with this email.',
      'auth/wrong-password':          'Incorrect password.',
      'auth/email-already-in-use':    'An account with this email already exists.',
      'auth/weak-password':           'Password must be at least 6 characters.',
      'auth/invalid-credential':      'Incorrect email or password.',
      'auth/too-many-requests':       'Too many attempts — please try again later.',
      'auth/network-request-failed':  'Network error. Check your connection and try again.',
      'auth/operation-not-allowed':   'Email/password sign-in is not enabled. Enable it in Firebase Console → Authentication → Sign-in methods.',
      'auth/internal-error':          'An internal error occurred. Please try again.',
    };
    showAuthError(msgs[err.code] || `Error (${err.code}): ${err.message}`);
    submitBtn.disabled    = false;
    submitBtn.textContent = _authMode === 'signup' ? 'Sign Up' : 'Sign In';
  }
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg; el.style.display = '';
}

document.getElementById('auth-visitor-btn').addEventListener('click', () => {
  currentUser = {
    uid: null, email: null, displayName: 'Visitor', role: 'visitor',
    linkedPlayerId: null, linkedTeamId: null, linkedLeagueId: null,
    linkedLeagueIds: [], linkedPlayerIds: [],
  };
  showApp();
});

// ── Nav + role gating ──────────────────────────────────────────────────────

function applyRoleNav() {
  const role = currentUser?.role || 'visitor';
  document.querySelectorAll('.nav-item[data-roles]').forEach(item => {
    item.style.display = item.dataset.roles.split(',').includes(role) ? '' : 'none';
  });
  if (role === 'umpire')           navigate('umpire');
  else if (role === 'scorekeeper') navigate('scorekeeper');
  else if (role === 'visitor')     navigate('schedule');
  else                             navigate('dashboard');
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => navigate(item.dataset.view));
});

function navigate(viewId) {
  if (!viewId) return;
  _activeView = viewId;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(`view-${viewId}`);
  if (target) target.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewId);
  });
  renderCurrentView();
}

// ── Sidebar user card ──────────────────────────────────────────────────────

function updateSidebarUserCard() {
  const card = document.getElementById('sidebar-user-card');
  if (!card || !currentUser) return;

  const roleLabel = ROLE_LABELS[currentUser.role] || currentUser.role;
  const chipCls   = ROLE_CHIP[currentUser.role]   || 'chip-default';

  let ctx = '';
  if (['player', 'captain'].includes(currentUser.role) && currentUser.linkedPlayerId) {
    const pl = state.players.find(p => p.id === currentUser.linkedPlayerId);
    const tm = pl ? state.teams.find(t => t.id === pl.teamId) : null;
    if (tm) ctx = `<span>&bull; ${escHtml(tm.name)}</span>`;
  } else if (currentUser.role === 'teamManager' && currentUser.linkedTeamId) {
    const tm = state.teams.find(t => t.id === currentUser.linkedTeamId);
    if (tm) ctx = `<span>&bull; ${escHtml(tm.name)}</span>`;
  }

  const actionBtn = currentUser.uid
    ? `<button id="signout-btn" class="btn btn-ghost btn-sm" style="margin-top:8px;width:100%">Sign Out</button>`
    : `<button id="signout-btn" class="btn btn-ghost btn-sm" style="margin-top:8px;width:100%">Sign In</button>`;

  card.innerHTML = `
    <div class="team-label">Signed in as</div>
    <div class="team-name">${escHtml(currentUser.displayName || currentUser.email || 'Visitor')}</div>
    <div class="team-meta">
      <span class="chip ${chipCls}" style="font-size:10px">${escHtml(roleLabel)}</span>
      ${ctx}
    </div>
    ${actionBtn}`;

  document.getElementById('signout-btn')?.addEventListener('click', () => {
    if (currentUser?.uid) fbSignOut(auth);
    else { currentUser = null; showAuthScreen(); }
  });
}

// ── Firestore listeners ────────────────────────────────────────────────────

function startListeners() {
  if (_listenersStarted) { renderCurrentView(); return; }
  _listenersStarted = true;

  document.getElementById('loading-overlay').style.display = '';

  _connectTimeout = setTimeout(() => {
    if (!allReady()) {
      document.getElementById('loading-overlay').style.display = 'none';
      showBanner('Could not connect to database. Check Firestore rules.', 'error');
      renderCurrentView();
    }
  }, 10000);

  onSnapshot(collection(db, 'teams'), snap => {
    state.teams = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.teams.sort((a, b) => a.name.localeCompare(b.name));
    state._ready.teams = true; checkReady();
  }, err => showDbError(err));

  onSnapshot(collection(db, 'players'), snap => {
    state.players = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.players.sort((a, b) => {
      const na = Number(a.number) || 0, nb = Number(b.number) || 0;
      if (na !== nb) return na - nb;
      return a.name.localeCompare(b.name);
    });
    state._ready.players = true; checkReady();
  }, err => showDbError(err));

  onSnapshot(collection(db, 'fields'), snap => {
    state.fields = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.fields.sort((a, b) => a.name.localeCompare(b.name));
    state._ready.fields = true; checkReady();
  }, err => showDbError(err));

  onSnapshot(collection(db, 'games'), snap => {
    state.games = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.games.sort((a, b) => a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time));
    state._ready.games = true; checkReady();
  }, err => showDbError(err));

  onSnapshot(collection(db, 'rsvps'), snap => {
    state.rsvps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state._ready.rsvps = true; checkReady();
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
    state._ready.scheduleConfig = true; checkReady();
  }, err => showDbError(err));

  if (currentUser?.role === 'siteAdmin' || currentUser?.role === 'umpire') {
    onSnapshot(collection(db, 'umpires'), snap => {
      state.umpires = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (_activeView === 'umpire') renderUmpireView();
    }, err => console.warn('Umpires listener:', err));
  }

  if (currentUser?.role === 'siteAdmin') {
    onSnapshot(collection(db, 'users'), snap => {
      state.allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (_activeView === 'admin') renderAdminView();
    }, err => showDbError(err));
  }
}

function allReady() {
  return state._ready.teams && state._ready.players && state._ready.fields &&
         state._ready.games && state._ready.scheduleConfig && state._ready.rsvps;
}

function checkReady() {
  if (allReady()) {
    clearTimeout(_connectTimeout);
    document.getElementById('loading-overlay').style.display = 'none';
    renderCurrentView();
  }
}

// ── Firestore write helpers ────────────────────────────────────────────────

function showDbError(err) {
  console.error('Firestore error:', err);
  const msg = err?.code === 'permission-denied'
    ? 'Database permission denied. Check Firestore security rules.'
    : `Database error: ${err?.message ?? err}`;
  showBanner(msg, 'error');
}

function firestoreWrite(p) { return p.catch(showDbError); }

function saveTeam(team) {
  return firestoreWrite(setDoc(doc(db, 'teams', team.id), {
    name: team.name, color: team.color ?? '', homefield: team.homefield ?? '',
  }));
}
function deleteTeam(id)   { return firestoreWrite(deleteDoc(doc(db, 'teams', id))); }

function savePlayer(player) {
  return firestoreWrite(setDoc(doc(db, 'players', player.id), {
    name: player.name, number: player.number ?? '', phone: player.phone ?? '', teamId: player.teamId,
  }));
}
function deletePlayer(id) { return firestoreWrite(deleteDoc(doc(db, 'players', id))); }

function saveField(field) {
  return firestoreWrite(setDoc(doc(db, 'fields', field.id), {
    name: field.name, availableDays: field.availableDays,
    openTime: field.openTime, closeTime: field.closeTime,
    hasLights: field.hasLights ?? false, zipCode: field.zipCode ?? '',
  }));
}
function deleteField(id)  { return firestoreWrite(deleteDoc(doc(db, 'fields', id))); }

function saveScheduleConfig(cfg) {
  return firestoreWrite(setDoc(doc(db, 'config', 'schedule'), {
    gameDuration: Number(cfg.gameDuration), bufferMinutes: Number(cfg.bufferMinutes),
    startDate: cfg.startDate, endDate: cfg.endDate, rounds: Number(cfg.rounds),
  }));
}

function setRsvp(gameId, status, playerId, playerName, teamId) {
  if (!playerId) return;
  firestoreWrite(setDoc(doc(db, 'rsvps', `${gameId}_${playerId}`), {
    gameId, playerId, playerName, teamId: teamId || null, status,
  }));
}

function saveUserProfile(uid, updates) {
  return firestoreWrite(setDoc(doc(db, 'users', uid), updates, { merge: true }));
}

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Render dispatcher ──────────────────────────────────────────────────────

function renderCurrentView() {
  updateSidebarUserCard();
  if (_activeView === 'dashboard')   renderDashboard();
  if (_activeView === 'schedule')    renderScheduleView();
  if (_activeView === 'roster')      renderRosterView();
  if (_activeView === 'league')      renderLeagueView();
  if (_activeView === 'umpire')      renderUmpireView();
  if (_activeView === 'scorekeeper') { /* static placeholder */ }
  if (_activeView === 'settings')    renderSettingsView();
  if (_activeView === 'admin')       renderAdminView();
}

// ── Dashboard ──────────────────────────────────────────────────────────────

function renderDashboard() {
  renderKpiStrip();
  renderUpcomingGamesCard();
  renderNeedsAttentionCard();

  const sub      = document.getElementById('dashboard-subtitle');
  const today    = new Date();
  const dayName  = today.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
  const todayStr = today.toISOString().slice(0, 10);
  const gameDay  = state.games.some(g => g.date === todayStr);
  if (sub) {
    const prefix = ROLE_LABELS[currentUser?.role] ? `${ROLE_LABELS[currentUser.role].toUpperCase()} · ` : '';
    sub.textContent = prefix + (gameDay ? `GAME DAY · ${dayName}` : dayName);
  }
}

function renderKpiStrip() {
  const strip = document.getElementById('kpi-strip');
  if (!strip) return;

  const today    = new Date().toISOString().slice(0, 10);
  const myTeamId = currentUser?.linkedTeamId ||
    (currentUser?.linkedPlayerId ? state.players.find(p => p.id === currentUser.linkedPlayerId)?.teamId : null);

  const upcomingGames = state.games
    .filter(g => g.status !== 'completed' && g.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const nextGame = upcomingGames[0] || null;

  const nextGameDate = nextGame ? formatDateHeader(nextGame.date) : '—';
  const nextGameSub  = nextGame ? `${formatTime(nextGame.time)} · ${escHtml(nextGame.fieldName)}` : 'No upcoming games';

  let rsvpRate = '—', rsvpSub = 'no next game';
  if (nextGame) {
    const players = state.players.filter(p => p.teamId === nextGame.homeTeamId || p.teamId === nextGame.awayTeamId);
    const going   = state.rsvps.filter(r => r.gameId === nextGame.id && r.status === 'going').length;
    const total   = players.length;
    rsvpRate = total > 0 ? `${Math.round((going / total) * 100)}%` : '0%';
    rsvpSub  = total > 0 ? `${going}/${total} going` : 'no roster yet';
  }

  let wins = 0, losses = 0, ties = 0;
  for (const game of state.games) {
    if (game.status !== 'completed') continue;
    const hs = Number(game.homeScore), as = Number(game.awayScore);
    if (isNaN(hs) || isNaN(as)) continue;
    if (myTeamId) {
      const isHome = game.homeTeamId === myTeamId, isAway = game.awayTeamId === myTeamId;
      if (!isHome && !isAway) continue;
      const mine = isHome ? hs : as, opp = isHome ? as : hs;
      if (mine > opp) wins++; else if (opp > mine) losses++; else ties++;
    } else {
      if (hs > as) wins++; else if (as > hs) losses++; else ties++;
    }
  }
  const recordStr = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
  const recordSub = myTeamId ? 'your team' : 'all teams';
  const total     = state.games.length;
  const completed = state.games.filter(g => g.status === 'completed').length;

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
        <div class="kpi-value">${total}</div>
        <div class="kpi-sub">${completed} completed</div>
      </div>
      <div class="kpi-icon muted-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </div>
    </div>`;
}

function renderUpcomingGamesCard() {
  const card = document.getElementById('upcoming-games-card');
  if (!card) return;
  const today    = new Date().toISOString().slice(0, 10);
  const upcoming = state.games
    .filter(g => g.status !== 'completed' && g.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
    .slice(0, 6);

  let html = `<div class="card-header">
    <span class="card-header-title">Upcoming Games</span>
    <span class="card-header-sub">${upcoming.length} scheduled</span>
  </div>`;

  if (upcoming.length === 0) {
    html += `<div style="padding:24px 16px;"><p class="muted">No upcoming games. Generate a schedule in the Schedule view.</p></div>`;
  } else {
    for (const game of upcoming) {
      const allR     = state.rsvps.filter(r => r.gameId === game.id);
      const going    = allR.filter(r => r.status === 'going').length;
      const notGoing = allR.filter(r => r.status === 'not_going').length;
      const maybe    = allR.filter(r => r.status === 'maybe').length;
      const tot      = allR.length;
      let rsvpHtml   = '';
      if (tot > 0) {
        const gPct = Math.round((going   / tot) * 100);
        const nPct = Math.round((notGoing / tot) * 100);
        const mPct = Math.max(0, 100 - gPct - nPct);
        rsvpHtml = `<div class="rsvp-bar-wrap">
          <div class="rsvp-bar">
            <div class="rsvp-bar-going" style="width:${gPct}%"></div>
            <div class="rsvp-bar-maybe" style="width:${mPct}%"></div>
            <div class="rsvp-bar-out"   style="width:${nPct}%"></div>
          </div>
          <span class="rsvp-label">${going}/${tot}</span>
        </div>`;
      } else {
        rsvpHtml = `<span class="rsvp-label" style="color:#ece6d6">No RSVPs</span>`;
      }
      html += `<div class="dashboard-game-row">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:13px;color:#161816">${escHtml(game.homeName)} <span style="color:#6e6f6a;font-weight:400">vs</span> ${escHtml(game.awayName)}</div>
          <div style="font-family:'Geist Mono',monospace;font-size:11px;color:#6e6f6a;margin-top:2px">${formatDateHeader(game.date)} · ${formatTime(game.time)} · ${escHtml(game.fieldName)}</div>
        </div>
        ${rsvpHtml}
      </div>`;
    }
  }
  card.innerHTML = html;
}

function renderNeedsAttentionCard() {
  const card = document.getElementById('needs-attention-card');
  if (!card) return;
  const today    = new Date().toISOString().slice(0, 10);
  const nextGame = state.games
    .filter(g => g.status !== 'completed' && g.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))[0];

  const rows = [];
  if (nextGame) {
    const inGame    = state.players.filter(p => p.teamId === nextGame.homeTeamId || p.teamId === nextGame.awayTeamId);
    const rsvpedIds = new Set(state.rsvps.filter(r => r.gameId === nextGame.id).map(r => r.playerId));
    const missing   = inGame.filter(p => !rsvpedIds.has(p.id));
    missing.slice(0, 8).forEach(p => rows.push({ who: p.name, what: `No RSVP for ${formatDateHeader(nextGame.date)}` }));
    if (missing.length > 8) rows.push({ who: `+${missing.length - 8} more`, what: 'players without RSVP' });
  }
  if (state.teams.length === 0)        rows.push({ who: 'No teams',     what: 'Add teams in Roster view' });
  if (state.fields.length === 0)       rows.push({ who: 'No fields',    what: 'Add fields in Settings' });
  if (!state.scheduleConfig.startDate) rows.push({ who: 'Season dates', what: 'Set start/end date in Settings' });

  let html = `<div class="card-header">
    <span class="card-header-title">Needs Attention</span>
    <span class="card-header-sub">${rows.length} item${rows.length !== 1 ? 's' : ''}</span>
  </div>`;

  if (rows.length === 0) {
    html += `<div style="padding:24px 16px;"><p class="muted" style="margin:0">All good! Everyone has RSVP'd.</p></div>`;
  } else {
    for (const row of rows) {
      html += `<div class="attention-row">
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

  const sub = document.getElementById('sched-subtitle');
  if (sub) {
    const cfg = state.scheduleConfig;
    sub.textContent = (cfg.startDate && cfg.endDate)
      ? `${formatDateHeader(cfg.startDate)} – ${formatDateHeader(cfg.endDate)}`
      : 'SCHEDULE';
  }

  const actionsDiv = document.getElementById('sched-actions');
  if (actionsDiv) {
    if (canEdit()) {
      actionsDiv.innerHTML = `
        <button id="generate-schedule-btn" class="btn btn-primary">Generate Schedule</button>
        <button id="clear-schedule-btn" class="btn btn-danger btn-sm">Clear</button>`;
      actionsDiv.querySelector('#generate-schedule-btn').addEventListener('click', handleGenerateSchedule);
      actionsDiv.querySelector('#clear-schedule-btn').addEventListener('click', handleClearSchedule);
    } else {
      actionsDiv.innerHTML = '';
    }
  }

  if (state.games.length === 0) {
    container.innerHTML = `<div class="schedule-empty"><p class="muted">No games scheduled yet.${canEdit() ? '' : ' Contact your league manager.'}</p></div>`;
    return;
  }

  const rsvpPlayerId = getRsvpPlayerId();
  const rsvpPlayer   = rsvpPlayerId ? state.players.find(p => p.id === rsvpPlayerId) : null;
  const rsvpTeamId   = rsvpPlayer?.teamId || null;

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

      const scoreDisplay = game.status === 'completed'
        ? `<span class="score-display">${game.homeScore} &ndash; ${game.awayScore}</span>`
        : `<span class="score-vs">vs</span>`;

      const editBtnHtml = canEdit()
        ? `<button class="btn btn-ghost btn-sm edit-score-btn">Edit Score</button>` : '';

      li.innerHTML = `
        <span class="game-time">${escHtml(formatTime(game.time))}</span>
        <span class="game-field">${escHtml(game.fieldName)}</span>
        <span class="game-matchup">
          <span class="team-name-home">${escHtml(game.homeName)}</span>
          ${scoreDisplay}
          <span class="team-name-away">${escHtml(game.awayName)}</span>
        </span>
        <span class="game-actions">${editBtnHtml}</span>`;

      li.querySelector('.edit-score-btn')?.addEventListener('click', () => showInlineScoreEdit(li, game));

      if (game.status !== 'completed' && rsvpPlayerId && rsvpTeamId &&
          (game.homeTeamId === rsvpTeamId || game.awayTeamId === rsvpTeamId)) {
        const existing  = state.rsvps.find(r => r.gameId === game.id && r.playerId === rsvpPlayerId);
        const curStatus = existing?.status || null;
        const rsvpDiv   = document.createElement('div');
        rsvpDiv.className = 'rsvp-buttons';
        rsvpDiv.innerHTML = `
          <button class="rsvp-btn going${curStatus === 'going' ? ' active' : ''}" data-status="going">Going</button>
          <button class="rsvp-btn maybe${curStatus === 'maybe' ? ' active' : ''}" data-status="maybe">Maybe</button>
          <button class="rsvp-btn not_going${curStatus === 'not_going' ? ' active' : ''}" data-status="not_going">Can't Make It</button>`;
        rsvpDiv.querySelectorAll('.rsvp-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const pl = state.players.find(p => p.id === rsvpPlayerId);
            setRsvp(game.id, btn.dataset.status, rsvpPlayerId, pl?.name || '', rsvpTeamId);
          });
        });
        li.appendChild(rsvpDiv);
      }

      if (game.status !== 'completed') {
        const allR = state.rsvps.filter(r => r.gameId === game.id);
        if (allR.length > 0) {
          const homeR = allR.filter(r => r.teamId === game.homeTeamId);
          const awayR = allR.filter(r => r.teamId === game.awayTeamId);
          const sumDiv = document.createElement('div');
          sumDiv.className = 'rsvp-summary';
          sumDiv.innerHTML =
            `<strong>${escHtml(game.homeName)}:</strong> ${homeR.filter(r=>r.status==='going').length} going &middot; ${homeR.filter(r=>r.status==='maybe').length} maybe &middot; ${homeR.filter(r=>r.status==='not_going').length} out` +
            ` &nbsp;|&nbsp; ` +
            `<strong>${escHtml(game.awayName)}:</strong> ${awayR.filter(r=>r.status==='going').length} going &middot; ${awayR.filter(r=>r.status==='maybe').length} maybe &middot; ${awayR.filter(r=>r.status==='not_going').length} out`;
          li.appendChild(sumDiv);
        }
      }

      gamesList.appendChild(li);
    }
    dateGroup.appendChild(gamesList);
    container.appendChild(dateGroup);
  }
}

function renderIdentityBar() {
  const bar  = document.getElementById('identity-bar');
  if (!bar) return;
  bar.innerHTML = '';
  const role = currentUser?.role;

  if (['player', 'captain'].includes(role) && currentUser.linkedPlayerId) {
    const player = state.players.find(p => p.id === currentUser.linkedPlayerId);
    const team   = player ? state.teams.find(t => t.id === player.teamId) : null;
    if (player && team) {
      bar.innerHTML = `<div class="identity-bar"><span>Viewing as: <strong>${escHtml(player.name)}</strong> &mdash; ${escHtml(team.name)}</span></div>`;
    } else {
      bar.innerHTML = `<div class="identity-bar"><span style="color:#b1361b">⚠ Your player profile is not linked. Ask an admin to link your account in Admin Panel.</span></div>`;
    }
    return;
  }

  if (role === 'parent' && currentUser.linkedPlayerIds?.length) {
    const children = state.players.filter(p => currentUser.linkedPlayerIds.includes(p.id));
    const selected = currentUser._selectedChildId || currentUser.linkedPlayerIds[0];
    const opts = children.map(p => `<option value="${p.id}"${p.id === selected ? ' selected' : ''}>${escHtml(p.name)}</option>`).join('');
    bar.innerHTML = `<div class="identity-bar"><span>RSVP for:</span><select id="parent-child-sel">${opts}</select></div>`;
    bar.querySelector('#parent-child-sel').addEventListener('change', e => {
      currentUser._selectedChildId = e.target.value; renderScheduleView();
    });
    return;
  }

  if (role === 'visitor') {
    bar.innerHTML = `<div class="identity-bar"><span>Read-only view &mdash; <a href="#" id="visitor-signin-link" style="color:#1e6b4a;font-weight:600">Sign in</a> to RSVP</span></div>`;
    bar.querySelector('#visitor-signin-link')?.addEventListener('click', e => { e.preventDefault(); currentUser = null; showAuthScreen(); });
    return;
  }

  if (canEdit() && state.players.length > 0) {
    const opts = '<option value="">— none —</option>' + state.players.map(p => {
      const t = state.teams.find(t => t.id === p.teamId);
      return `<option value="${p.id}"${p.id === currentUser._impersonatingPlayerId ? ' selected' : ''}>${escHtml(p.name)}${t ? ' (' + escHtml(t.name) + ')' : ''}</option>`;
    }).join('');
    bar.innerHTML = `<div class="identity-bar"><span>RSVP as (admin):</span><select id="admin-rsvp-sel">${opts}</select></div>`;
    bar.querySelector('#admin-rsvp-sel').addEventListener('change', e => {
      currentUser._impersonatingPlayerId = e.target.value || null; renderScheduleView();
    });
  }
}

function showInlineScoreEdit(li, game) {
  const matchupSpan = li.querySelector('.game-matchup');
  const scoreNode   = matchupSpan.querySelector('.score-display, .score-vs');
  const actionsSpan = li.querySelector('.game-actions');

  const homeInput = Object.assign(document.createElement('input'), { type:'number', min:'0', className:'score-input', value: game.homeScore ?? '', placeholder:'0' });
  const sep       = Object.assign(document.createElement('span'), { className:'score-sep', textContent:'–' });
  const awayInput = Object.assign(document.createElement('input'), { type:'number', min:'0', className:'score-input', value: game.awayScore ?? '', placeholder:'0' });

  scoreNode.replaceWith(homeInput, sep, awayInput);
  actionsSpan.innerHTML = `<button class="btn btn-primary btn-sm save-score-btn">Save</button>`;
  actionsSpan.querySelector('.save-score-btn').addEventListener('click', () => {
    const hs = parseInt(homeInput.value, 10), as2 = parseInt(awayInput.value, 10);
    if (isNaN(hs) || isNaN(as2)) { alert('Please enter valid scores.'); return; }
    firestoreWrite(setDoc(doc(db, 'games', game.id), {
      date: game.date, time: game.time, fieldId: game.fieldId, fieldName: game.fieldName,
      homeTeamId: game.homeTeamId, homeName: game.homeName,
      awayTeamId: game.awayTeamId, awayName: game.awayName,
      homeScore: hs, awayScore: as2, status: 'completed',
    }));
  });
}

async function handleClearSchedule() {
  if (!canEdit()) return;
  if (!confirm('Delete ALL games? This cannot be undone.')) return;
  const snap = await getDocs(collection(db, 'games'));
  for (let i = 0; i < snap.docs.length; i += 500) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  showBanner('Schedule cleared.', 'success');
}

async function handleGenerateSchedule() {
  if (!canEdit()) return;
  if (state.teams.length < 2)    { showBanner('Need at least 2 teams.', 'error'); return; }
  if (state.fields.length === 0) { showBanner('Add at least one field.', 'error'); return; }
  const cfg = state.scheduleConfig;
  if (!cfg.startDate || !cfg.endDate)  { showBanner('Set season dates in Settings.', 'error'); return; }
  if (cfg.startDate > cfg.endDate)     { showBanner('Start date must be before end date.', 'error'); return; }

  const scheduled = state.games.filter(g => g.status === 'scheduled');
  if (scheduled.length > 0 && !confirm(`Delete ${scheduled.length} existing scheduled game(s) and regenerate?`)) return;

  showBanner('Generating schedule…', 'success');
  const { games: newGames, skipped, daylightConstrainedCount } = await generateSchedule(state.teams, state.fields, cfg);

  try {
    const snap = await getDocs(query(collection(db, 'games'), where('status', '==', 'scheduled')));
    for (let i = 0; i < snap.docs.length; i += 500) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    for (let i = 0; i < newGames.length; i += 500) {
      const batch = writeBatch(db);
      newGames.slice(i, i + 500).forEach(g => batch.set(doc(collection(db, 'games')), { ...g, homeScore: null, awayScore: null, status: 'scheduled' }));
      await batch.commit();
    }
    const parts = [`Schedule generated: ${newGames.length} game(s).`];
    if (daylightConstrainedCount > 0) parts.push(`${daylightConstrainedCount} field-date(s) daylight-limited.`);
    if (skipped > 0) parts.push(`${skipped} matchup(s) could not be scheduled.`);
    showBanner(parts.join(' '), skipped > 0 ? 'error' : 'success');
  } catch (err) { showDbError(err); }
}

// ── Roster View ────────────────────────────────────────────────────────────

function renderRosterView() {
  if (_viewingTeamId) {
    const team = state.teams.find(t => t.id === _viewingTeamId);
    if (team) { showTeamDetail(team); return; }
    _viewingTeamId = null;
  }
  showTeamList();
  const sub = document.getElementById('roster-subtitle');
  if (sub) sub.textContent = `${state.teams.length} TEAM${state.teams.length !== 1 ? 'S' : ''} · ${state.players.length} PLAYERS`;
}

function showTeamList() {
  document.getElementById('team-list-view').style.display   = '';
  document.getElementById('team-detail-view').style.display = 'none';

  const addForm = document.getElementById('team-add-form');
  if (addForm) addForm.style.display = canEdit() ? '' : 'none';

  const list = document.getElementById('team-list'), msg = document.getElementById('no-teams-msg');
  list.innerHTML = '';

  if (state.teams.length === 0) {
    msg.style.display = '';
  } else {
    msg.style.display = 'none';
    state.teams.forEach(team => {
      const cnt = state.players.filter(p => p.teamId === team.id).length;
      const li  = document.createElement('li');
      li.innerHTML = `
        <span class="info">
          <button class="name-btn">${escHtml(team.name)}</button>
          <span class="sub">${team.color ? escHtml(team.color) + ' &bull; ' : ''}${team.homefield ? escHtml(team.homefield) : ''}</span>
        </span>
        <span class="badge">${cnt} player${cnt !== 1 ? 's' : ''}</span>
        ${canEdit() ? `<button class="remove-btn">Remove</button>` : ''}`;
      li.querySelector('.name-btn').addEventListener('click', () => { _viewingTeamId = team.id; renderRosterView(); });
      li.querySelector('.remove-btn')?.addEventListener('click', () => removeTeam(team.id));
      list.appendChild(li);
    });
  }

  const allList = document.getElementById('all-players-list'), allMsg = document.getElementById('no-players-msg');
  allList.innerHTML = '';
  if (state.players.length === 0) {
    allMsg.style.display = '';
  } else {
    allMsg.style.display = 'none';
    state.players.forEach(player => {
      const team = state.teams.find(t => t.id === player.teamId);
      const li   = document.createElement('li');
      li.innerHTML = `
        <span class="info">
          <span class="name">${player.number ? `<span class="jersey-badge">#${escHtml(player.number)}</span>` : ''}${escHtml(player.name)}</span>
          <span class="sub">${team ? escHtml(team.name) : '<em>Unknown team</em>'}${player.phone ? ' &bull; ' + escHtml(player.phone) : ''}</span>
        </span>
        ${canEdit() ? `<button class="remove-btn">Remove</button>` : ''}`;
      li.querySelector('.remove-btn')?.addEventListener('click', () => removePlayer(player.id));
      allList.appendChild(li);
    });
  }
}

function showTeamDetail(team) {
  document.getElementById('team-list-view').style.display   = 'none';
  document.getElementById('team-detail-view').style.display = '';

  const sub = document.getElementById('roster-subtitle');
  if (sub) sub.textContent = team.name.toUpperCase();
  document.getElementById('team-detail-name').textContent = team.name;
  const meta = [team.color, team.homefield].filter(Boolean);
  document.getElementById('team-detail-meta').textContent = meta.join(' · ');

  const playerAddForm = document.getElementById('player-add-form');
  if (playerAddForm) playerAddForm.style.display = canEditTeam(team.id) ? '' : 'none';

  const roster = state.players.filter(p => p.teamId === team.id);
  const list   = document.getElementById('roster-list'), msg = document.getElementById('no-roster-msg');
  list.innerHTML = '';

  if (roster.length === 0) {
    msg.style.display = '';
  } else {
    msg.style.display = 'none';
    roster.forEach(player => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="info">
          <span class="name">${player.number ? `<span class="jersey-badge">#${escHtml(player.number)}</span>` : ''}${escHtml(player.name)}</span>
          ${player.phone ? `<span class="sub">${escHtml(player.phone)}</span>` : ''}
        </span>
        ${canEditTeam(team.id) ? `<button class="remove-btn">Remove</button>` : ''}`;
      li.querySelector('.remove-btn')?.addEventListener('click', () => removePlayer(player.id));
      list.appendChild(li);
    });
  }

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
      const isHome = game.homeTeamId === team.id;
      const opp    = isHome ? game.awayName : game.homeName;
      const gRsvps = state.rsvps.filter(r => r.gameId === game.id && r.teamId === team.id);
      const going  = gRsvps.filter(r => r.status === 'going').length;
      const maybe  = gRsvps.filter(r => r.status === 'maybe').length;
      const out    = gRsvps.filter(r => r.status === 'not_going').length;
      const line   = (going + maybe + out > 0) ? `${going} going · ${maybe} maybe · ${out} out` : '';
      html += `<li><span class="info">
        <span class="name">${escHtml(formatDateHeader(game.date))} ${escHtml(formatTime(game.time))} — ${isHome ? 'vs' : '@'} ${escHtml(opp)}</span>
        <span class="sub">${escHtml(game.fieldName)}${line ? ' · ' + line : ''}</span>
      </span></li>`;
    }
    html += '</ul>';
    upcomingSection.innerHTML = html;
  }
}

document.getElementById('add-team-btn').addEventListener('click', addTeam);
document.getElementById('team-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') addTeam(); });

function addTeam() {
  if (!canEdit()) return;
  const nameEl = document.getElementById('team-name-input'), colorEl = document.getElementById('team-color-input'), fieldEl = document.getElementById('team-homefield-input');
  const name = nameEl.value.trim();
  if (!name) return;
  saveTeam({ id: genId('team'), name, color: colorEl.value.trim(), homefield: fieldEl.value.trim() });
  nameEl.value = ''; colorEl.value = ''; fieldEl.value = ''; nameEl.focus();
}

function removeTeam(id) {
  if (!canEdit() || !confirm('Remove this team? All players on this team will also be removed.')) return;
  const players = state.players.filter(p => p.teamId === id);
  Promise.all([deleteTeam(id), ...players.map(p => deletePlayer(p.id))]);
  if (_viewingTeamId === id) { _viewingTeamId = null; renderRosterView(); }
}

document.getElementById('add-player-btn').addEventListener('click', addPlayer);
document.getElementById('player-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') addPlayer(); });

function addPlayer() {
  if (!_viewingTeamId || !canEditTeam(_viewingTeamId)) return;
  const nameEl = document.getElementById('player-name-input'), numEl = document.getElementById('player-number-input'), phoneEl = document.getElementById('player-phone-input');
  const name = nameEl.value.trim();
  if (!name) return;
  savePlayer({ id: genId('player'), name, number: numEl.value.trim(), phone: phoneEl.value.trim(), teamId: _viewingTeamId });
  nameEl.value = ''; numEl.value = ''; phoneEl.value = ''; nameEl.focus();
}

function removePlayer(id) {
  if (!confirm('Remove this player?')) return;
  deletePlayer(id);
}

document.getElementById('team-back-btn').addEventListener('click', () => { _viewingTeamId = null; renderRosterView(); });

// ── League View ────────────────────────────────────────────────────────────

function renderLeagueView() {
  const container = document.getElementById('standings-container');
  if (!container) return;
  if (state.teams.length === 0 || !state.games.some(g => g.status === 'completed')) {
    container.innerHTML = '<p class="muted" style="padding:1rem 0;">No completed games yet. Standings will appear here once scores are recorded.</p>';
    return;
  }
  const rows = computeStandings();
  let html = `<table class="standings-table"><thead><tr>
    <th class="standings-rank">#</th><th>Team</th>
    <th>GP</th><th>W</th><th>L</th><th>T</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th>
  </tr></thead><tbody>`;
  rows.forEach((row, i) => {
    const gd = row.GF - row.GA;
    html += `<tr${i === 0 ? ' class="standings-leader"' : ''}>
      <td class="standings-rank">${i + 1}</td><td>${escHtml(row.name)}</td>
      <td>${row.GP}</td><td>${row.W}</td><td>${row.L}</td><td>${row.T}</td>
      <td>${row.GF}</td><td>${row.GA}</td><td>${gd > 0 ? '+' : ''}${gd}</td>
      <td><strong>${row.Pts}</strong></td>
    </tr>`;
  });
  container.innerHTML = html + '</tbody></table>';
}

function computeStandings() {
  const map = new Map();
  state.teams.forEach(t => map.set(t.id, { name: t.name, GP:0, W:0, L:0, T:0, GF:0, GA:0, Pts:0 }));
  for (const game of state.games) {
    if (game.status !== 'completed') continue;
    const hs = Number(game.homeScore), as = Number(game.awayScore);
    if (isNaN(hs) || isNaN(as)) continue;
    const home = map.get(game.homeTeamId), away = map.get(game.awayTeamId);
    if (!home || !away) continue;
    home.GP++; away.GP++; home.GF += hs; home.GA += as; away.GF += as; away.GA += hs;
    if (hs > as)      { home.W++; home.Pts += 3; away.L++; }
    else if (as > hs) { away.W++; away.Pts += 3; home.L++; }
    else              { home.T++; home.Pts++; away.T++; away.Pts++; }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (b.Pts !== a.Pts) return b.Pts - a.Pts;
    const gdA = a.GF - a.GA, gdB = b.GF - b.GA;
    if (gdB !== gdA) return gdB - gdA;
    if (b.GF !== a.GF) return b.GF - a.GF;
    return a.name.localeCompare(b.name);
  });
}

// ── Umpire View ────────────────────────────────────────────────────────────

function renderUmpireView() {
  renderUmpireKpi();
  renderUmpireGames();
}

function renderUmpireKpi() {
  const strip = document.getElementById('umpire-kpi');
  if (!strip) return;
  const today   = new Date().toISOString().slice(0, 10);
  const myUid   = currentUser?.uid;
  const myGames = currentUser?.role === 'siteAdmin' ? state.games : state.games.filter(g => g.umpireId === myUid);
  const upcoming = myGames.filter(g => g.status !== 'completed' && g.date >= today).length;
  const done     = myGames.filter(g => g.status === 'completed').length;
  const umpDoc   = state.umpires.find(u => u.id === myUid);
  const payRate  = umpDoc?.payRate ?? 0;

  strip.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-left"><div class="kpi-label">Upcoming</div><div class="kpi-value">${upcoming}</div><div class="kpi-sub">assigned games</div></div>
      <div class="kpi-icon brand"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-left"><div class="kpi-label">Completed</div><div class="kpi-value">${done}</div><div class="kpi-sub">this season</div></div>
      <div class="kpi-icon muted-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
    </div>
    <div class="kpi-card">
      <div class="kpi-left"><div class="kpi-label">Season Earnings</div><div class="kpi-value">$${done * payRate}</div><div class="kpi-sub">$${payRate}/game</div></div>
      <div class="kpi-icon muted-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
    </div>`;
}

function renderUmpireGames() {
  const container = document.getElementById('umpire-games');
  if (!container) return;
  const today   = new Date().toISOString().slice(0, 10);
  const myUid   = currentUser?.uid;
  const myGames = currentUser?.role === 'siteAdmin' ? state.games : state.games.filter(g => g.umpireId === myUid);

  if (myGames.length === 0) {
    container.innerHTML = `<div class="schedule-empty"><p class="muted">No games assigned yet.</p></div>`;
    return;
  }

  const upcoming = myGames.filter(g => g.status !== 'completed' && g.date >= today);
  const past     = myGames.filter(g => g.status === 'completed' || g.date < today);
  let html = '';

  const gameRow = (game, dim) => `
    <div class="schedule-game-row" style="margin-bottom:6px;${dim ? 'opacity:0.65' : ''}">
      <span class="game-time">${escHtml(formatTime(game.time))}</span>
      <span class="game-field">${escHtml(game.fieldName)}</span>
      <span class="game-matchup">
        <span class="team-name-home">${escHtml(game.homeName)}</span>
        <span class="score-vs">vs</span>
        <span class="team-name-away">${escHtml(game.awayName)}</span>
      </span>
      <span class="game-actions">
        <span class="chip ${game.status === 'completed' ? 'chip-brand' : 'chip-default'}">${game.status === 'completed' ? 'Completed' : 'Scheduled'}</span>
      </span>
    </div>`;

  if (upcoming.length > 0) {
    html += `<div class="section-heading">Upcoming</div>`;
    upcoming.forEach(g => html += gameRow(g, false));
  }
  if (past.length > 0) {
    html += `<div class="section-heading" style="margin-top:24px">Past</div>`;
    past.slice(0, 10).forEach(g => html += gameRow(g, true));
  }
  container.innerHTML = html;
}

// ── Settings View ──────────────────────────────────────────────────────────

function renderSettingsView() {
  renderFieldsSection();
  renderScheduleConfigSection();
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function renderFieldsSection() {
  const list = document.getElementById('fields-list'), noMsg = document.getElementById('no-fields-msg');
  if (!list || !noMsg) return;
  list.innerHTML = '';

  const fieldAddForm = document.getElementById('field-add-form');
  if (fieldAddForm) fieldAddForm.style.display = canEdit() ? '' : 'none';

  if (state.fields.length === 0) {
    noMsg.style.display = '';
  } else {
    noMsg.style.display = 'none';
    state.fields.forEach(field => {
      const days   = Array.isArray(field.availableDays) ? field.availableDays : [];
      const dayStr = days.map(d => DAY_LABELS[d]).join(', ');
      const li     = document.createElement('li');
      li.innerHTML = `
        <span class="info">
          <span class="name"><span class="field-lights-icon">${field.hasLights ? '💡' : '🌙'}</span>${escHtml(field.name)}</span>
          <span class="sub">${dayStr || 'No days'} · ${escHtml(field.openTime)} – ${escHtml(field.closeTime)}${field.zipCode ? ' · ZIP ' + escHtml(field.zipCode) : ''}</span>
        </span>
        ${canEdit() ? `<button class="remove-btn">Remove</button>` : ''}`;
      li.querySelector('.remove-btn')?.addEventListener('click', () => {
        if (!canEdit() || !confirm('Remove this field?')) return;
        deleteField(field.id);
      });
      list.appendChild(li);
    });
  }
}

function addField() {
  if (!canEdit()) return;
  const nameEl = document.getElementById('field-name-input'), openEl = document.getElementById('field-open-input');
  const closeEl = document.getElementById('field-close-input'), lightsEl = document.getElementById('field-lights-input');
  const zipEl   = document.getElementById('field-zip-input');
  const name = nameEl.value.trim(), openTime = openEl.value, closeTime = closeEl.value;
  if (!name)                   { alert('Please enter a field name.'); return; }
  if (!openTime || !closeTime) { alert('Please set open and close times.'); return; }
  const days = [];
  DAY_LABELS.forEach((_, i) => { const cb = document.getElementById(`field-day-${i}`); if (cb?.checked) days.push(i); });
  if (days.length === 0)       { alert('Select at least one available day.'); return; }
  saveField({ id: genId('field'), name, availableDays: days, openTime, closeTime, hasLights: lightsEl?.checked ?? false, zipCode: zipEl?.value.trim() ?? '' });
  nameEl.value = ''; openEl.value = ''; closeEl.value = '';
  if (lightsEl) lightsEl.checked = false;
  if (zipEl)    zipEl.value = '';
  DAY_LABELS.forEach((_, i) => { const cb = document.getElementById(`field-day-${i}`); if (cb) cb.checked = false; });
}

function renderScheduleConfigSection() {
  const cfg = state.scheduleConfig;
  const durEl = document.getElementById('cfg-game-duration'), bufEl = document.getElementById('cfg-buffer-minutes');
  const startEl = document.getElementById('cfg-start-date'), endEl = document.getElementById('cfg-end-date');
  const rndEl   = document.getElementById('cfg-rounds');
  if (!durEl) return;

  durEl.value = cfg.gameDuration; bufEl.value = cfg.bufferMinutes;
  startEl.value = cfg.startDate; endEl.value = cfg.endDate; rndEl.value = cfg.rounds;
  const disabled = !canEdit();
  [durEl, bufEl, startEl, endEl, rndEl].forEach(el => { el.disabled = disabled; });

  const saveBtn = document.getElementById('save-config-btn');
  if (saveBtn) {
    saveBtn.style.display = canEdit() ? '' : 'none';
    const newBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newBtn, saveBtn);
    newBtn.addEventListener('click', () => {
      if (!canEdit()) return;
      saveScheduleConfig({ gameDuration: Number(durEl.value)||90, bufferMinutes: Number(bufEl.value)||15, startDate: startEl.value||'', endDate: endEl.value||'', rounds: Number(rndEl.value)||1 })
        .then(() => showBanner('Schedule config saved.', 'success'));
    });
  }
}

document.getElementById('add-field-btn').addEventListener('click', addField);

// ── Admin Panel ────────────────────────────────────────────────────────────

function renderAdminView() {
  if (currentUser?.role !== 'siteAdmin') return;

  document.getElementById('admin-refresh-btn').onclick = () => renderAdminView();

  const container = document.getElementById('admin-users-list');
  const noMsg     = document.getElementById('admin-no-users-msg');
  if (!container) return;

  if (state.allUsers.length === 0) {
    container.innerHTML = ''; noMsg.style.display = ''; return;
  }
  noMsg.style.display = 'none';

  const teamOptions = '<option value="">— none —</option>' +
    state.teams.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('');

  const playerOptions = '<option value="">— none —</option>' +
    state.players.map(p => {
      const t = state.teams.find(t => t.id === p.teamId);
      return `<option value="${p.id}">${escHtml(p.name)}${t ? ' (' + escHtml(t.name) + ')' : ''}</option>`;
    }).join('');

  container.innerHTML = state.allUsers.map(user => `
    <div class="admin-user-row" data-uid="${escHtml(user.id)}">
      <div class="admin-user-info">
        <div class="admin-user-name">${escHtml(user.displayName || user.email || user.id)}</div>
        <div class="admin-user-email">${escHtml(user.email || '')}</div>
      </div>
      <div class="admin-user-controls">
        <select class="admin-role-sel">
          ${Object.keys(ROLE_LABELS).filter(r => r !== 'visitor').map(r =>
            `<option value="${r}"${user.role === r ? ' selected' : ''}>${ROLE_LABELS[r]}</option>`
          ).join('')}
        </select>
        <select class="admin-team-sel" title="Linked team">
          ${teamOptions.replace(`value="${user.linkedTeamId}"`, `value="${user.linkedTeamId}" selected`)}
        </select>
        <select class="admin-player-sel" title="Linked player">
          ${playerOptions.replace(`value="${user.linkedPlayerId}"`, `value="${user.linkedPlayerId}" selected`)}
        </select>
        <button class="btn btn-primary btn-sm admin-save-user-btn">Save</button>
      </div>
    </div>`).join('');

  container.querySelectorAll('.admin-save-user-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row      = btn.closest('.admin-user-row');
      const uid      = row.dataset.uid;
      const role     = row.querySelector('.admin-role-sel').value;
      const teamId   = row.querySelector('.admin-team-sel').value   || null;
      const playerId = row.querySelector('.admin-player-sel').value || null;
      saveUserProfile(uid, { role, linkedTeamId: teamId, linkedPlayerId: playerId })
        .then(() => showBanner(`${ROLE_LABELS[role]} saved.`, 'success'));
    });
  });
}

// ── Timezone + sunrise/sunset ──────────────────────────────────────────────

const STATE_TZ = {
  AL:'America/Chicago',AK:'America/Anchorage',AZ:'America/Phoenix',AR:'America/Chicago',CA:'America/Los_Angeles',
  CO:'America/Denver',CT:'America/New_York',DE:'America/New_York',DC:'America/New_York',FL:'America/New_York',
  GA:'America/New_York',HI:'Pacific/Honolulu',ID:'America/Boise',IL:'America/Chicago',IN:'America/Indiana/Indianapolis',
  IA:'America/Chicago',KS:'America/Chicago',KY:'America/New_York',LA:'America/Chicago',ME:'America/New_York',
  MD:'America/New_York',MA:'America/New_York',MI:'America/Detroit',MN:'America/Chicago',MS:'America/Chicago',
  MO:'America/Chicago',MT:'America/Denver',NE:'America/Chicago',NV:'America/Los_Angeles',NH:'America/New_York',
  NJ:'America/New_York',NM:'America/Denver',NY:'America/New_York',NC:'America/New_York',ND:'America/Chicago',
  OH:'America/New_York',OK:'America/Chicago',OR:'America/Los_Angeles',PA:'America/New_York',RI:'America/New_York',
  SC:'America/New_York',SD:'America/Chicago',TN:'America/Chicago',TX:'America/Chicago',UT:'America/Denver',
  VT:'America/New_York',VA:'America/New_York',WA:'America/Los_Angeles',WV:'America/New_York',WI:'America/Chicago',WY:'America/Denver',
};

const zipCache = new Map(), sunCache = new Map();

async function fetchZipInfo(zip) {
  if (zipCache.has(zip)) return zipCache.get(zip);
  try {
    const r = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!r.ok) return null;
    const d = await r.json();
    const place = d.places[0], st = place['state abbreviation'];
    const info = { lat: parseFloat(place.latitude), lng: parseFloat(place.longitude), timezone: STATE_TZ[st] || 'America/Chicago' };
    zipCache.set(zip, info); return info;
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
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false });
    const norm = t => t.startsWith('24') ? '00' + t.slice(2) : t;
    const result = { sunrise: norm(fmt.format(new Date(d.results.sunrise))), sunset: norm(fmt.format(new Date(d.results.sunset))) };
    sunCache.set(key, result); return result;
  } catch { return null; }
}

function clampTimeToWindow(t, min, max) { return t < min ? min : t > max ? max : t; }

// ── Auto-Scheduler ─────────────────────────────────────────────────────────

async function generateSchedule(teams, fields, config) {
  const matchups = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      for (let r = 0; r < config.rounds; r++) {
        if (r % 2 === 0) { matchups.push({ home: teams[i], away: teams[j] }); matchups.push({ home: teams[j], away: teams[i] }); }
        else             { matchups.push({ home: teams[j], away: teams[i] }); matchups.push({ home: teams[i], away: teams[j] }); }
      }
    }
  }
  for (let i = matchups.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [matchups[i], matchups[j]] = [matchups[j], matchups[i]];
  }

  const slots = [];
  const gameDur = Number(config.gameDuration) || 90, bufferMins = Number(config.bufferMinutes) || 15;
  const interval = gameDur + bufferMins;
  let daylightConstrainedCount = 0;

  const [sy, sm, sd] = config.startDate.split('-').map(Number);
  const [ey, em, ed] = config.endDate.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd), end = new Date(ey, em - 1, ed);

  for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const dow = cur.getDay();
    const yy  = cur.getFullYear(), mm = String(cur.getMonth() + 1).padStart(2, '0'), dd = String(cur.getDate()).padStart(2, '0');
    const dateStr = `${yy}-${mm}-${dd}`;

    for (const field of fields) {
      if (!(Array.isArray(field.availableDays) ? field.availableDays : []).includes(dow)) continue;
      let effOpen = field.openTime, effClose = field.closeTime;

      if (!field.hasLights && field.zipCode) {
        const zi = await fetchZipInfo(field.zipCode);
        if (zi) {
          const sun = await fetchSunriseSunset(zi.lat, zi.lng, dateStr, zi.timezone);
          if (sun) {
            const co = clampTimeToWindow(field.openTime, sun.sunrise, sun.sunset);
            const cc = clampTimeToWindow(field.closeTime, sun.sunrise, sun.sunset);
            if (co >= cc) { daylightConstrainedCount++; continue; }
            if (co !== field.openTime || cc !== field.closeTime) daylightConstrainedCount++;
            effOpen = co; effClose = cc;
          }
        }
      }

      const [oh, om] = effOpen.split(':').map(Number), [ch, cm] = effClose.split(':').map(Number);
      let slotStart = oh * 60 + om;
      while (slotStart + gameDur <= ch * 60 + cm) {
        const hh = String(Math.floor(slotStart / 60)).padStart(2, '0'), min = String(slotStart % 60).padStart(2, '0');
        slots.push({ date: dateStr, time: `${hh}:${min}`, fieldId: field.id, fieldName: field.name });
        slotStart += interval;
      }
    }
  }

  slots.sort((a, b) => a.date !== b.date ? a.date.localeCompare(b.date) : a.time !== b.time ? a.time.localeCompare(b.time) : a.fieldId.localeCompare(b.fieldId));

  const busyTeams = new Map(), assignedGames = [];
  let skipped = 0;
  for (const matchup of matchups) {
    let assigned = false;
    for (const slot of slots) {
      const key = `${slot.date} ${slot.time}`;
      if (!busyTeams.has(key)) busyTeams.set(key, new Set());
      const busy = busyTeams.get(key);
      if (!busy.has(matchup.home.id) && !busy.has(matchup.away.id)) {
        busy.add(matchup.home.id); busy.add(matchup.away.id);
        assignedGames.push({ date: slot.date, time: slot.time, fieldId: slot.fieldId, fieldName: slot.fieldName, homeTeamId: matchup.home.id, homeName: matchup.home.name, awayTeamId: matchup.away.id, awayName: matchup.away.name });
        assigned = true; break;
      }
    }
    if (!assigned) skipped++;
  }
  return { games: assignedGames, skipped, daylightConstrainedCount };
}

// ── Utilities ──────────────────────────────────────────────────────────────

function formatDateHeader(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(timeStr) {
  const [h, min] = timeStr.split(':').map(Number);
  return `${h % 12 || 12}:${String(min).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function showBanner(msg, type = 'error') {
  const el = document.getElementById('db-banner');
  el.textContent = msg; el.className = `db-banner--${type}`; el.style.display = 'block';
  if (type !== 'error') { clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 6000); }
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
