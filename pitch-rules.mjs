import { validateLeagueRules } from './league-rules.mjs';

// Pure transitions: no clock, database, or current league-profile lookups.
export function resolvePitch(rulesValue, count, pitch) {
  const rules = validateLeagueRules(rulesValue);
  if (!count || typeof count !== 'object' || Array.isArray(count) ||
      Object.keys(count).length !== 2 || !Object.hasOwn(count, 'balls') || !Object.hasOwn(count, 'strikes') ||
      !Number.isSafeInteger(count.balls) || count.balls < 0 || count.balls >= rules.ballsForWalk ||
      !Number.isSafeInteger(count.strikes) || count.strikes < 0 || count.strikes >= rules.strikesForOut) {
    throw new Error('Invalid pitch count.');
  }
  if (!['ball', 'strike', 'foul'].includes(pitch)) throw new Error('Unsupported pitch action.');
  let { balls, strikes } = count;
  if (pitch === 'ball') balls++;
  else if (pitch === 'strike' || strikes < rules.strikesForOut - 1 || rules.foulAtStrikeLimit === 'strikeout') strikes++;
  const outcome = balls === rules.ballsForWalk ? 'walk' : strikes === rules.strikesForOut ? 'strikeout' : 'continue';
  return outcome === 'continue'
    ? { balls, strikes, outcome }
    : { balls: rules.startingBalls, strikes: rules.startingStrikes, outcome };
}
