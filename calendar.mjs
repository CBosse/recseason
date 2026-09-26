// Game dates are local calendar dates, not UTC instants.
export function localDateKey(date = new Date()) {
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid calendar date.');
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
