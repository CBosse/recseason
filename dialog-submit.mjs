// Keep one editor's pending work scoped to its own DOM, even after sign-out.
export function wireDialogSubmission({ dialog, form, controls, error, read, save }) {
  let pending = false;
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  form.onsubmit = async event => {
    event.preventDefault();
    if (pending || !dialog.isConnected) return;
    error.textContent = '';
    let values;
    try { values = read(); }
    catch (failure) { error.textContent = failure.message; return; }
    pending = true;
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    try {
      await save(values);
      if (dialog.isConnected) dialog.close();
    } catch (failure) {
      if (dialog.isConnected) error.textContent = failure.message;
    } finally {
      pending = false;
      controls.forEach((control, index) => { control.disabled = disabled[index]; });
    }
  };
}
