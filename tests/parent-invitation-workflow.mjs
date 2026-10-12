import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { openReminderRuntime } from '../server/reminder-runtime.mjs';
import { acceptParentInvitation } from '../server/parent-invitation-service.mjs';

if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8180') throw new Error('Both local emulators are required.');
const runtime = openReminderRuntime('demo-recseason');
const { db, auth } = runtime;
const prefix = `parent-${randomUUID()}`;
const issuer = `${prefix}-admin`;
const put = (collection, id, value) => db.collection(collection).doc(id).set(value);
const fixtures = [];
try {
  await put('users', issuer, { role: 'siteAdmin' });
  async function fixture(count = 1) {
    const uid = `${prefix}-${fixtures.length}`, id = `${uid}-invite`, email = `${uid}@example.test`;
    const children = Array.from({ length: count }, (_, i) => `${uid}-child-${i}`);
    const teams = children.map((_, i) => `${uid}-team-${i}`);
    await auth.createUser({ uid, email, emailVerified: true });
    await put('users', uid, { email, displayName: 'Synthetic parent', role: 'player', linkedTeamId: null, linkedPlayerId: null, linkedPlayerIds: [] });
    for (let i = 0; i < count; i++) {
      await put('teams', teams[i], { name: `Synthetic team ${i}` });
      await put('players', children[i], { name: `Synthetic child ${i}`, teamId: teams[i], archived: false });
    }
    await put('invitations', id, { email, role: 'parent', linkedTeamId: null, linkedPlayerId: null, linkedPlayerIds: children,
      createdBy: issuer, status: 'pending', createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 3600000) });
    const value = { uid, id, children, teams, accept: () => acceptParentInvitation({ db, auth, verifiedUid: uid, invitationId: id }) };
    fixtures.push(value); return value;
  }
  async function rejected(f, code) {
    await assert.rejects(f.accept(), error => error.code === code);
    assert.equal((await db.collection('users').doc(f.uid).get()).data().acceptedInvitationId, undefined);
    assert.notEqual((await db.collection('invitations').doc(f.id).get()).data().status, 'accepted');
  }
  const full = await fixture(30);
  console.log('Parent invitations: accepting 30 children on 30 teams with concurrent retries.');
  const outcomes = await Promise.all([full.accept(), full.accept()]);
  assert.deepEqual(outcomes.map(result => result.status).sort(), ['accepted', 'already-accepted']);
  const accepted = (await db.collection('users').doc(full.uid).get()).data();
  assert.equal(accepted.role, 'parent'); assert.deepEqual(accepted.linkedPlayerIds, full.children);
  const invitation = (await db.collection('invitations').doc(full.id).get()).data();
  assert.equal(invitation.acceptedBy, full.uid); assert.ok(invitation.acceptedAt.toMillis() > 0);
  await db.collection('users').doc(full.uid).update({ role: 'siteAdmin' });
  await assert.rejects(full.accept(), error => error.code === 'invitation-unavailable');
  assert.equal((await db.collection('users').doc(full.uid).get()).data().role, 'siteAdmin');
  for (const defect of ['missing-child', 'archived', 'missing-team', 'malformed-archive']) {
    console.log(`Parent invitations: rejecting ${defect} on the last child.`);
    const f = await fixture(30);
    const child = db.collection('players').doc(f.children.at(-1));
    if (defect === 'missing-child') await child.delete();
    if (defect === 'archived') await child.update({ archived: true });
    if (defect === 'malformed-archive') await child.update({ archived: null });
    if (defect === 'missing-team') await db.collection('teams').doc(f.teams.at(-1)).delete();
    await rejected(f, 'stale-links');
  }
  for (const patch of [{ status: 'revoked' }, { expiresAt: Timestamp.fromMillis(0) }, { role: 'siteAdmin' },
    { linkedPlayerIds: [] }, { linkedPlayerIds: ['../players'] }, { linkedTeamId: 'unexpected' }, { email: 'someone-else@example.test' }]) {
    const f = await fixture();
    await db.collection('invitations').doc(f.id).update(patch);
    await rejected(f, 'invitation-unavailable');
  }
  const duplicate = await fixture();
  console.log('Parent invitations: checking malformed links and current account permissions.');
  await db.collection('invitations').doc(duplicate.id).update({ linkedPlayerIds: [duplicate.children[0], duplicate.children[0]] });
  await rejected(duplicate, 'invitation-unavailable');
  const oversized = await fixture(31); await rejected(oversized, 'invitation-unavailable');
  for (const patch of [{ emailVerified: false }, { disabled: true }]) {
    const f = await fixture(); await auth.updateUser(f.uid, patch); await rejected(f, 'permission-denied');
  }
  const staleEmail = await fixture();
  await auth.updateUser(staleEmail.uid, { email: `${staleEmail.uid}-changed@example.test`, emailVerified: true });
  await rejected(staleEmail, 'invitation-unavailable');
  const staff = await fixture(); await db.collection('users').doc(staff.uid).update({ role: 'scorekeeper' });
  await rejected(staff, 'invitation-unavailable');
  const revokedIssuer = await fixture(); await db.collection('users').doc(issuer).update({ role: 'player' });
  await rejected(revokedIssuer, 'invitation-unavailable');
  await assert.rejects(acceptParentInvitation({ db: { databaseId: '(default)' }, auth, verifiedUid: full.uid, invitationId: full.id }), /Invalid/);
  console.log('PASS: server parent acceptance validates 30 child/team links, rejects stale and malformed invitations, checks current Auth identity and issuer role, atomically consumes invitations, and handles concurrent retries.');
} finally { await runtime.close(); }
