import { sameScoringData } from './automatic-scoring.mjs';

export function createScoringSession({ initial, load, save, isCurrent, now = Date.now }) {
  let game = structuredClone(initial), busy = false, refreshRequired = false, retryAt = 0;
  const check = () => { if (!isCurrent()) throw Object.assign(new Error('Your scoring session changed. Reopen the game.'), { needsRefresh: true }); };
  const refresh = async minimumRevision => {
    check();
    const fresh = await load();
    check();
    if (!fresh || !sameScoringData(fresh.rulesSnapshot, initial.rulesSnapshot) ||
        (initial.id && fresh.id !== initial.id) ||
        (minimumRevision !== undefined && (!fresh.automaticScoring || !Number.isSafeInteger(fresh.scoreRevision) || fresh.scoreRevision < minimumRevision))) {
      throw Object.assign(new Error('The saved play could not be verified. Refresh the game.'), { needsRefresh: true });
    }
    game = structuredClone(fresh); refreshRequired = false;
  };
  return {
    get game() { return structuredClone(game); },
    get busy() { return busy; },
    get refreshRequired() { return refreshRequired; },
    get waitMs() { return Math.max(0, retryAt - now()); },
    async refresh() {
      if (busy) return false;
      busy = true;
      try { await refresh(); return true; }
      catch (error) { refreshRequired = true; throw error; }
      finally { busy = false; }
    },
    async submit(action) {
      check();
      if (busy) return false;
      if (refreshRequired) throw new Error('Refresh the game before recording another play.');
      if (now() < retryAt) throw new Error('Please wait before recording another play.');
      busy = true;
      let acknowledged = false;
      try {
        const result = await save(structuredClone(game), structuredClone(action));
        acknowledged = true;
        check();
        if (!Number.isSafeInteger(result?.revision) || result.revision !== (game.scoreRevision ?? 0) + 1) throw new Error('The saved revision could not be verified. Refresh the game.');
        await refresh(result.revision);
        retryAt = now() + 1000;
        return true;
      } catch (error) {
        if (acknowledged || error.needsRefresh) refreshRequired = true;
        if (error.retryAfterMs) retryAt = now() + error.retryAfterMs;
        throw error;
      } finally { busy = false; }
    },
  };
}

export function orderedRunnerOutcomes(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 4) throw new Error('Choose runner outcomes.');
  const sorted = rows.map(row => ({ ...row, order: Number(row.order) })).sort((a, b) => a.order - b.order);
  if (sorted.some((row, index) => row.order !== index + 1)) throw new Error('Give each runner a unique play order, starting at 1.');
  return sorted.map(({ runner, destination, outType }) => destination === 'out' ? { runner, destination, outType } : { runner, destination });
}
