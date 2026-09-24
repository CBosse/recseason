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

export async function replaceDocuments(createBatch, removedRefs, replacements) {
  // A single commit keeps the previous schedule intact if publication fails.
  if (removedRefs.length + replacements.length > 500) {
    throw new Error('This update exceeds 500 document changes. The existing schedule has not been changed.');
  }
  const batch = createBatch();
  removedRefs.forEach(ref => batch.delete(ref));
  replacements.forEach(({ ref, data }) => batch.set(ref, data));
  await batch.commit();
}
