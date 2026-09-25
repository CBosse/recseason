export function rsvpSchedule(game) {
  return { gameDate: game.date, gameTime: game.time, gameFieldId: game.fieldId };
}

export function isCurrentRsvp(rsvp, game) {
  return rsvp.gameId === game.id && typeof game.date === 'string' &&
    typeof game.time === 'string' && typeof game.fieldId === 'string' &&
    rsvp.gameDate === game.date && rsvp.gameTime === game.time && rsvp.gameFieldId === game.fieldId;
}
