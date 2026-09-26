export function rosterEntry(player) {
  return { name: player.name, number: player.number ?? '', teamId: player.teamId, archived: player.archived ?? false };
}
