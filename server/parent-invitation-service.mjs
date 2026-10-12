import { FieldValue } from 'firebase-admin/firestore';
import { invitationProfilePatch } from '../invitations.mjs';

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fail = (code, message) => Object.assign(new Error(message), { code });
const linksMatch = (profile, invite, id) => profile.acceptedInvitationId === id && profile.role === 'parent' &&
  profile.linkedTeamId === null && profile.linkedPlayerId === null && Array.isArray(profile.linkedPlayerIds) &&
  profile.linkedPlayerIds.length === invite.linkedPlayerIds.length && profile.linkedPlayerIds.every((value, index) => value === invite.linkedPlayerIds[index]);

// Internal only: verifiedUid must come from a server-verified ID token, not the body.
export async function acceptParentInvitation({ db, auth, verifiedUid, invitationId, clock = Date.now }) {
  if (db.databaseId !== 'recseason' || !['demo-recseason', 'bosse-testing'].includes(db.projectId) ||
      !validId(verifiedUid) || !validId(invitationId)) throw fail('invalid-request', 'Invalid invitation request.');
  const identity = await auth.getUser(verifiedUid);
  if (identity.uid !== verifiedUid || identity.disabled || !identity.emailVerified || typeof identity.email !== 'string') {
    throw fail('permission-denied', 'A current verified email address is required.');
  }
  const email = identity.email.toLowerCase();
  return db.runTransaction(async tx => {
    const inviteRef = db.collection('invitations').doc(invitationId);
    const userRef = db.collection('users').doc(verifiedUid);
    const invitation = await tx.get(inviteRef);
    const user = await tx.get(userRef);
    const invite = invitation.data(), profile = user.data();
    if (!invite || !profile || invite.email !== email || invite.role !== 'parent' ||
        invite.linkedTeamId !== null || invite.linkedPlayerId !== null || !Array.isArray(invite.linkedPlayerIds) ||
        invite.linkedPlayerIds.length < 1 || invite.linkedPlayerIds.length > 30 ||
        invite.linkedPlayerIds.some(id => !validId(id)) || new Set(invite.linkedPlayerIds).size !== invite.linkedPlayerIds.length) {
      throw fail('invitation-unavailable', 'Invitation unavailable for this account.');
    }
    if (invite.status === 'accepted' && invite.acceptedBy === verifiedUid && linksMatch(profile, invite, invitationId)) {
      return { status: 'already-accepted' };
    }
    const now = clock();
    const expires = invite.expiresAt?.toMillis?.();
    if (!Number.isSafeInteger(now) || !Number.isFinite(expires) || expires <= now || invite.status !== 'pending' ||
        !['player', 'visitor'].includes(profile.role) || !validId(invite.createdBy)) {
      throw fail('invitation-unavailable', 'Invitation is no longer available.');
    }
    const issuer = await tx.get(db.collection('users').doc(invite.createdBy));
    if (!issuer.exists || issuer.data().role !== 'siteAdmin') throw fail('invitation-unavailable', 'Invitation is no longer available.');
    const teams = new Set();
    for (const id of invite.linkedPlayerIds) {
      const player = await tx.get(db.collection('players').doc(id));
      if (!player.exists || (player.data().archived !== undefined && player.data().archived !== false) || !validId(player.data().teamId)) {
        throw fail('stale-links', 'An administrator must refresh this invitation before it can be accepted.');
      }
      teams.add(player.data().teamId);
    }
    for (const id of teams) {
      if (!(await tx.get(db.collection('teams').doc(id))).exists) {
        throw fail('stale-links', 'An administrator must refresh this invitation before it can be accepted.');
      }
    }
    tx.update(userRef, invitationProfilePatch(invitationId, invite));
    tx.update(inviteRef, { status: 'accepted', acceptedBy: verifiedUid, acceptedAt: FieldValue.serverTimestamp() });
    return { status: 'accepted' };
  });
}
