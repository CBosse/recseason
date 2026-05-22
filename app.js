'use strict';

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore,
  doc,
  collection,
  addDoc,
  onSnapshot,
  setDoc,
  deleteDoc,
  query,
  where,
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
  teams:   [],   // [{ id, name, color, homefield }]
  players: [],   // [{ id, name, number, phone, teamId }]
  _ready: { teams: false, players: false },
};

const ADMIN_PASSWORD = 'ump-admin';
let isAdminMode = false;
let _viewingTeamId = null;

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

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Firestore listeners ────────────────────────────────────────────────────

function allReady() {
  return state._ready.teams && state._ready.players;
}

function checkReady() {
  if (allReady()) {
    clearTimeout(connectTimeout);
    document.getElementById('loading-overlay').style.display = 'none';
    renderCurrentTab();
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
    renderCurrentTab();
  }
}, 10000);

onSnapshot(collection(db, 'teams'), snap => {
  state.teams = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  state.teams.sort((a, b) => a.name.localeCompare(b.name));
  state._ready.teams = true;
  checkReady();
  if (allReady()) renderCurrentTab();
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
  checkReady();
  if (allReady()) renderCurrentTab();
}, err => showDbError(err));

// ── Tab routing ────────────────────────────────────────────────────────────

function activeTab() {
  return document.querySelector('.tab.active')?.dataset.tab ?? 'teams';
}

function renderCurrentTab() {
  const tab = activeTab();
  if (tab === 'teams')    renderTeamsTab();
  if (tab === 'schedule') renderScheduleTab();
  if (tab === 'settings') renderSettingsTab();
  syncAdminUi();
}

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    renderCurrentTab();
  });
});

// ── Admin mode ─────────────────────────────────────────────────────────────

function beginAdminMode() {
  isAdminMode = true;
  showBanner('Admin View enabled.', 'success');
  renderCurrentTab();
}

function exitAdminMode() {
  isAdminMode = false;
  showBanner('Returned to View Mode.', 'success');
  renderCurrentTab();
}

function syncAdminUi() {
  const status   = document.getElementById('admin-status-msg');
  const enterBtn = document.getElementById('admin-view-btn');
  const saveBtn  = document.getElementById('admin-save-btn');
  const lockMsg  = document.getElementById('settings-lock-msg');

  if (status)   status.textContent = isAdminMode
    ? 'Admin View is active.'
    : 'Settings are locked in View Mode.';
  if (enterBtn) { enterBtn.textContent = isAdminMode ? 'Admin View Active' : 'Admin View'; enterBtn.disabled = isAdminMode; }
  if (saveBtn)  saveBtn.style.display = isAdminMode ? '' : 'none';
  if (lockMsg)  lockMsg.style.display = isAdminMode ? 'none' : '';

  // Show/hide add forms
  const teamAddForm   = document.getElementById('team-add-form');
  const playerAddForm = document.getElementById('player-add-form');
  if (teamAddForm)   teamAddForm.style.display   = isAdminMode ? '' : 'none';
  if (playerAddForm) playerAddForm.style.display = isAdminMode ? '' : 'none';

  // Show/hide all remove buttons
  document.querySelectorAll('.remove-btn').forEach(btn => {
    btn.style.display = isAdminMode ? '' : 'none';
  });
}

document.getElementById('admin-view-btn').addEventListener('click', () => {
  const input = prompt('Enter Admin password');
  if (input === ADMIN_PASSWORD) beginAdminMode();
  else if (input !== null) alert('Incorrect password.');
});

document.getElementById('admin-save-btn').addEventListener('click', () => {
  exitAdminMode();
});

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
  // Remove all players on this team
  const teamPlayers = state.players.filter(p => p.teamId === id);
  const writes = [deleteTeam(id), ...teamPlayers.map(p => deletePlayer(p.id))];
  Promise.all(writes);
  if (_viewingTeamId === id) {
    _viewingTeamId = null;
    renderTeamsTab();
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

// ── Teams tab rendering ────────────────────────────────────────────────────

function renderTeamsTab() {
  if (_viewingTeamId) {
    const team = state.teams.find(t => t.id === _viewingTeamId);
    if (team) { showTeamDetail(team); return; }
    _viewingTeamId = null;
  }
  showTeamList();
}

function showTeamList() {
  document.getElementById('team-list-view').style.display   = '';
  document.getElementById('team-detail-view').style.display = 'none';

  // Teams list
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
        renderTeamsTab();
      });
      li.querySelector('.remove-btn').addEventListener('click', () => removeTeam(team.id));
      list.appendChild(li);
    });
  }

  // All players list
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

  syncAdminUi();
}

document.getElementById('team-back-btn').addEventListener('click', () => {
  _viewingTeamId = null;
  renderTeamsTab();
});

// ── Schedule tab ───────────────────────────────────────────────────────────

function renderScheduleTab() {
  // Placeholder — schedule features coming soon
}

// ── Settings tab ───────────────────────────────────────────────────────────

function renderSettingsTab() {
  syncAdminUi();
}

// ── Utilities ──────────────────────────────────────────────────────────────

function showBanner(msg, type = 'error') {
  const el = document.getElementById('db-banner');
  el.textContent = msg;
  el.className   = `db-banner db-banner--${type}`;
  el.style.display = 'block';
  if (type !== 'error') {
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
