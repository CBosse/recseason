export function createSubscriptions(subscribe) {
  let generation = 0;
  let disposers = [];
  return {
    listen(ref, next, error) {
      const activeGeneration = generation;
      const dispose = subscribe(ref,
        value => { if (generation === activeGeneration) next(value); },
        reason => { if (generation === activeGeneration) error?.(reason); });
      disposers.push(dispose);
    },
    clear() {
      generation++;
      const previous = disposers;
      disposers = [];
      previous.forEach(dispose => dispose());
    },
  };
}

export async function writeResult(promise, reportError) {
  try { await promise; return true; }
  catch (error) { reportError(error); return false; }
}
