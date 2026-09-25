export function cancellationUpdate(game) {
  if (!game || game.status !== 'scheduled') throw new Error('Only scheduled games can be cancelled. Refresh the schedule.');
  return { status: 'cancelled', locked: false };
}
