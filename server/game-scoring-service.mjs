import { FieldValue } from '@google-cloud/firestore';
import { automaticScoreEntry, automaticCorrectionEntry, sameScoringData } from '../automatic-scoring.mjs';
import { scoreState } from '../score-state.mjs';

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fail = code => Object.assign(new Error('Automatic scoring could not be completed.'), { code });

// Internal boundary: verifiedUid must come from revoked-token-aware verification.
export async function recordAutomaticPlay({ db, verifiedUid, gameId, expectedRevision, engineVersion, action }) {
  if (db.databaseId !== 'recseason' || !['demo-recseason', 'bosse-testing'].includes(db.projectId) ||
      !validId(verifiedUid) || !validId(gameId) || engineVersion !== 1 || !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) throw fail('invalid-request');
  return db.runTransaction(async tx => {
    const user = await tx.get(db.doc(`users/${verifiedUid}`));
    const gameRef = db.doc(`games/${gameId}`), snapshot = await tx.get(gameRef);
    const game = snapshot.data(), role = user.data()?.role;
    const correction = action?.type === 'correction';
    const organizer = ['siteAdmin', 'commissioner', 'leagueManager'].includes(role);
    if ((correction && !organizer) || (!organizer &&
        !(role === 'scorekeeper' && game?.scorekeeperId === verifiedUid))) throw fail('permission-denied');
    if (!game || !(correction ? ['live', 'completed'] : ['scheduled', 'live']).includes(game.status)) throw fail('game-unavailable');
    if ((game.scoreRevision ?? 0) !== expectedRevision) throw fail('stale-revision');
    if (!validId(game.homeTeamId) || !validId(game.awayTeamId) || game.homeTeamId === game.awayTeamId || !validId(game.fieldId)) throw fail('game-incompatible');
    for (const path of [`teams/${game.homeTeamId}`, `teams/${game.awayTeamId}`, `fields/${game.fieldId}`]) {
      if (!(await tx.get(db.doc(path))).exists) throw fail('game-incompatible');
    }
    const eventRef = db.doc(`scoreEvents/${gameId}_${expectedRevision + 1}`);
    if ((await tx.get(eventRef)).exists) throw fail('history-inconsistent');
    if (game.automaticScoring !== undefined) {
      const previous = (await tx.get(db.doc(`scoreEvents/${gameId}_${expectedRevision}`))).data();
      if (!previous || previous.gameId !== gameId || previous.revision !== expectedRevision ||
          previous.automatic?.engineVersion !== engineVersion || previous.scoredBy !== game.scoredBy ||
          !sameScoringData(previous.after, scoreState(game)) || !sameScoringData(previous.automatic.after, game.automaticScoring)) throw fail('history-inconsistent');
    }
    const request = { gameId, game, action, uid: verifiedUid, expectedRevision, engineVersion };
    // All history reads stay inside the transaction so concurrent plays force a retry.
    const entries = correction ? (await tx.get(db.collection('scoreEvents').where('gameId', '==', gameId))).docs.map(doc => doc.data()) : undefined;
    const { patch, entry } = correction ? automaticCorrectionEntry({ ...request, entries }) : automaticScoreEntry(request);
    tx.update(gameRef, patch);
    tx.create(eventRef, { ...entry, recordedAt: FieldValue.serverTimestamp() });
    return { status: patch.status, revision: patch.scoreRevision };
  });
}
