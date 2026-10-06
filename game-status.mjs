import { hasRecordedScore } from './game-editor.mjs';

export function cancellationUpdate(game) {
  if (!game || game.status !== 'scheduled') throw new Error('Only scheduled games can be cancelled. Refresh the schedule.');
  if (hasRecordedScore(game)) throw new Error('A game with recorded scores cannot be cancelled.');
  return { status: 'cancelled', locked: false };
}

export function reschedulingUpdate(game) {
  if (game?.status !== 'cancelled') return {};
  if (hasRecordedScore(game)) throw new Error('A cancelled game with recorded scores cannot be reopened.');
  return { status: 'scheduled' };
}
