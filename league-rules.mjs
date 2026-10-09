const ruleKeys = ['innings', 'ballsForWalk', 'strikesForOut', 'outsPerHalf', 'startingBalls', 'startingStrikes', 'foulAtStrikeLimit', 'runsPerHalf', 'unlimitedFinalInning', 'mercy', 'timeLimitMinutes', 'tiePolicy', 'extraInningRunner'];
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function validateLeagueRules(rules) {
  if (!exactKeys(rules, ruleKeys)) throw new Error('Provide every supported rule; unknown rules are not silently ignored.');
  for (const [key, min, max] of [['innings', 1, 99], ['ballsForWalk', 1, 12], ['strikesForOut', 1, 12], ['outsPerHalf', 1, 12],
    ['startingBalls', 0, rules.ballsForWalk - 1], ['startingStrikes', 0, rules.strikesForOut - 1]]) {
    if (!integer(rules[key], min, max)) throw new Error(`Invalid league rule: ${key}.`);
  }
  if (!['dead-ball', 'strikeout'].includes(rules.foulAtStrikeLimit)) throw new Error('Choose the foul-at-strike-limit policy.');
  if (rules.runsPerHalf !== null && !integer(rules.runsPerHalf, 1, 99999)) throw new Error('Invalid half-inning run limit.');
  if (typeof rules.unlimitedFinalInning !== 'boolean' || (rules.runsPerHalf === null && rules.unlimitedFinalInning)) throw new Error('An unlimited final inning requires a regular run limit.');
  if (rules.mercy !== null && (!exactKeys(rules.mercy, ['runs', 'afterInning']) || !integer(rules.mercy.runs, 1, 99999) || !integer(rules.mercy.afterInning, 1, rules.innings))) throw new Error('Invalid mercy rule.');
  if (rules.timeLimitMinutes !== null && !integer(rules.timeLimitMinutes, 1, 1440)) throw new Error('Invalid game time limit.');
  if (!['allow-tie', 'extra-innings'].includes(rules.tiePolicy) || !['none', 'second'].includes(rules.extraInningRunner) ||
    (rules.tiePolicy === 'allow-tie' && rules.extraInningRunner !== 'none')) throw new Error('Invalid extra-inning policy.');
  return structuredClone(rules);
}

export function validateRulesProfile(profile) {
  if (!exactKeys(profile, ['schemaVersion', 'revision', 'name', 'rules']) || profile.schemaVersion !== 1 ||
    !integer(profile.revision, 1, Number.MAX_SAFE_INTEGER) || typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 100 || /[\r\n]/.test(profile.name)) throw new Error('Invalid rules profile.');
  return { schemaVersion: 1, revision: profile.revision, name: profile.name, rules: validateLeagueRules(profile.rules) };
}

export function nextRulesProfile(current, values, expectedRevision) {
  const revision = current === null ? 0 : validateRulesProfile(current).revision;
  if (!integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1) || revision !== expectedRevision) throw new Error('League rules changed in another session. Refresh before saving.');
  if (!exactKeys(values, ['name', 'rules'])) throw new Error('Invalid rules profile fields.');
  return validateRulesProfile({ schemaVersion: 1, revision: revision + 1, name: typeof values.name === 'string' ? values.name.trim() : values.name, rules: values.rules });
}

export function validateGameRulesSnapshot(snapshot) {
  const { profileId, ...profile } = snapshot ?? {};
  if (typeof profileId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(profileId)) throw new Error('Invalid saved game rules.');
  return { profileId, ...validateRulesProfile(profile) };
}

export function scoreCounterLimits(game) {
  if (game.rulesSnapshot === undefined) return { balls: 3, strikes: 2, outs: 2 };
  const { rules } = validateGameRulesSnapshot(game.rulesSnapshot);
  return { balls: rules.ballsForWalk - 1, strikes: rules.strikesForOut - 1, outs: rules.outsPerHalf - 1 };
}

export function gameRulesSnapshot(game, profileId, profile) {
  if (!game || typeof profileId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(profileId)) throw new Error('Invalid game rules source.');
  if (game.rulesSnapshot !== undefined) {
    return validateGameRulesSnapshot(game.rulesSnapshot);
  }
  if (game.status !== 'scheduled' || (game.scoreRevision ?? 0) !== 0 || game.homeScore != null || game.awayScore != null || game.lineScore != null) throw new Error('Rules must be assigned before scoring begins. Legacy scored games require an explicit migration.');
  return { profileId, ...validateRulesProfile(profile) };
}
