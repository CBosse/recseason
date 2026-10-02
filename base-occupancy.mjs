const keys = ['first', 'second', 'third'];
export function baseOccupancy(value = { first: false, second: false, third: false }) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => typeof value[key] !== 'boolean')) throw new Error('Choose a valid runner state for each base.');
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}
export function baseLabel(value) {
  const bases = baseOccupancy(value);
  return keys.filter(key => bases[key]).map(key => ({ first: '1st', second: '2nd', third: '3rd' })[key]).join(', ') || 'Bases empty';
}
