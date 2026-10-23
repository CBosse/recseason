import { automaticCorrectionEntry } from './automatic-scoring.mjs';
import { correctionTargets } from './correction-preview.mjs';
import { createScoringSession, orderedRunnerOutcomes } from './automatic-scoring-session.mjs';
import { baseLabel } from './base-occupancy.mjs';

export function openCorrectionEditor({ initial, load, save, isCurrent, uid }) {
  if (document.getElementById('correction-dialog')) return;
  const dialog = document.createElement('dialog'); dialog.id = 'correction-dialog'; dialog.className = 'game-editor-dialog automatic-editor';
  dialog.setAttribute('aria-labelledby', 'correction-title');
  let entries = structuredClone(initial.entries), targets, draft = null, runnerControls = [], timer;
  const current = () => dialog.isConnected && isCurrent();
  const session = createScoringSession({ initial: initial.game, isCurrent: current,
    load: async () => { const fresh = await load(); correctionTargets(fresh.game, fresh.entries); entries = fresh.entries; return fresh.game; },
    save: (game, action) => save(game, entries, action) });
  const title = document.createElement('h2'); title.id = 'correction-title'; title.textContent = `${initial.game.awayName} at ${initial.game.homeName}: correction`;
  const badge = document.createElement('p'); badge.textContent = 'Organizer correction / Local preview'; badge.className = 'muted';
  const form = document.createElement('div');
  const field = (name, control, parent = form) => { const label = document.createElement('label'); label.textContent = name; label.append(control); parent.append(label); return control; };
  const select = options => { const control = document.createElement('select'); for (const [value, label] of options) control.add(new Option(label, value)); return control; };
  const target = field('Recorded action', select([]));
  const mode = field('Correction', select([['void', 'Void action'], ['pitch', 'Replace with pitch'], ['runners', 'Replace with runner play'], ['clock', 'Replace clock entry'], ['restore', 'Restore original action']]));
  const pitch = field('Pitch', select([['ball', 'Ball'], ['strike', 'Strike'], ['foul', 'Foul']]));
  const time = field('Elapsed game time (seconds)', document.createElement('input')); time.type = 'number'; time.min = '0'; time.step = '0.001';
  const runners = document.createElement('section'); form.append(runners);
  const include = field('Batter in this play', document.createElement('input'), runners); include.type = 'checkbox'; include.parentElement.className = 'automatic-toggle';
  const grid = document.createElement('div'); grid.className = 'automatic-runners'; runners.append(grid);
  const homer = field('Over-the-fence home run', document.createElement('input'), runners); homer.type = 'checkbox'; homer.parentElement.className = 'automatic-toggle';
  const reason = field('Correction reason', document.createElement('textarea')); reason.maxLength = 300; reason.rows = 3;
  const result = document.createElement('p'); result.setAttribute('role', 'status');
  const confirm = field('Confirm this previewed correction', document.createElement('input'), dialog); confirm.type = 'checkbox'; confirm.parentElement.className = 'automatic-toggle';
  const confirmation = confirm.parentElement;
  const error = document.createElement('p'); error.setAttribute('role', 'alert');
  const footer = document.createElement('div'); footer.className = 'game-editor-actions';
  const button = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-secondary'; b.textContent = label; b.onclick = fn; footer.append(b); return b; };
  const preview = button('Preview correction', () => {
    invalidate();
    try {
      const action = buildAction();
      const { patch } = automaticCorrectionEntry({ gameId: session.game.id, game: session.game, entries, action, uid, expectedRevision: session.game.scoreRevision, engineVersion: 1 });
      const describe = game => `${game.awayScore}-${game.homeScore}, ${game.status}, ${game.half} ${game.inning}, balls ${game.balls}, strikes ${game.strikes}, outs ${game.outs}, ${baseLabel(game.bases)}, ${(game.automaticScoring?.elapsedMs ?? 0) / 1000}s`;
      draft = structuredClone(action); result.textContent = `Before: ${describe(session.game)}. After: ${describe(patch)}.`;
    } catch (failure) { error.textContent = message(failure); }
    sync();
  });
  const commit = button('Save correction', () => perform(draft));
  const refresh = button('Reload game and history', () => perform(null));
  const close = button('Close', () => dialog.close());
  function message(failure) {
    return ({ 'correction-conflict': 'This change conflicts with later plays or clock entries. Review the action order.',
      'invalid-correction': 'Choose an original action, make a change, and enter a correction reason.',
      'invalid-request': 'Enter a valid correction and reason.',
      'history-inconsistent': 'Game history could not be verified. Reload the game and history.' })[failure.code] ?? failure.message;
  }
  function invalidate() { draft = null; confirm.checked = false; result.textContent = ''; error.textContent = ''; }
  function selected() { return targets.find(item => item.revision === Number(target.value)); }
  function renderRunners() {
    runnerControls = []; grid.replaceChildren();
    const selectedTarget = selected(), action = selectedTarget.action;
    const originalOutcomes = action?.play?.type === 'runners' ? action.play.outcomes : [];
    const names = ['third', 'second', 'first'].filter(base => selectedTarget.before.bases[base]); if (include.checked) names.push('batter');
    const defaultOrder = [...names];
    names.sort((a, b) => {
      const order = name => { const i = originalOutcomes.findIndex(item => item.runner === name); return i < 0 ? 10 + defaultOrder.indexOf(name) : i; };
      return order(a) - order(b);
    });
    for (const [index, runner] of names.entries()) {
      const row = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = runner === 'batter' ? 'Batter' : `Runner on ${runner}`; row.append(legend);
      const original = originalOutcomes.find(item => item.runner === runner);
      const order = field(`${legend.textContent} play order`, document.createElement('input'), row); order.type = 'number'; order.min = '1'; order.max = String(names.length); order.step = '1'; order.value = String(index + 1);
      const destination = field(`${legend.textContent} outcome`, select([['first', 'First'], ['second', 'Second'], ['third', 'Third'], ['home', 'Run'], ['out', 'Out']]), row);
      destination.value = original?.destination ?? (runner === 'batter' ? 'first' : runner);
      const outType = field(`${legend.textContent} out ruling`, select([['tag', 'Tag'], ['force', 'Force'], ['batter-before-first', 'Batter before first']]), row);
      outType.value = original?.outType ?? (runner === 'batter' ? 'batter-before-first' : 'tag');
      const showOut = () => { outType.parentElement.hidden = destination.value !== 'out'; }; showOut(); destination.onchange = showOut;
      runnerControls.push({ runner, order, destination, outType }); grid.append(row);
    }
  }
  function selectionChanged() {
    invalidate(); const action = selected().action ?? selected().original;
    time.value = String(action.elapsedMs / 1000); pitch.value = action.play?.pitch ?? 'ball';
    include.checked = action.play?.includesBatter ?? true; homer.checked = action.runAward === 'home-run'; renderRunners(); sync();
  }
  function buildAction() {
    let replacement = null;
    if (mode.value === 'restore') replacement = selected().original;
    else if (mode.value !== 'void') {
      const elapsedMs = Math.round(Number(time.value) * 1000);
      if (!time.value.trim() || !time.checkValidity() || !Number.isSafeInteger(elapsedMs) || elapsedMs < 0) throw new Error('Enter valid elapsed game time.');
      replacement = mode.value === 'clock' ? { schemaVersion: 1, type: 'clock', elapsedMs } : {
        schemaVersion: 1, type: 'play', elapsedMs, runAward: mode.value === 'runners' && homer.checked ? 'home-run' : 'ordinary',
        play: mode.value === 'pitch' ? { schemaVersion: 1, type: 'pitch', pitch: pitch.value } : {
          schemaVersion: 1, type: 'runners', includesBatter: include.checked,
          outcomes: orderedRunnerOutcomes(runnerControls.map(row => ({ runner: row.runner, order: row.order.value, destination: row.destination.value, outType: row.outType.value }))),
        },
      };
    }
    return { schemaVersion: 1, type: 'correction', targetRevision: Number(target.value), replacement, reason: reason.value.trim() };
  }
  function sync() {
    const locked = session.busy || session.refreshRequired || session.waitMs > 0 || !current();
    dialog.setAttribute('aria-busy', String(session.busy));
    for (const input of form.querySelectorAll('input, select, textarea')) input.disabled = locked;
    preview.disabled = locked; confirm.disabled = locked || !draft; commit.disabled = locked || !draft || !confirm.checked;
    refresh.disabled = session.busy || !current(); close.disabled = session.busy;
    pitch.parentElement.hidden = mode.value !== 'pitch'; runners.hidden = mode.value !== 'runners';
    time.parentElement.hidden = ['void', 'restore'].includes(mode.value);
    clearTimeout(timer); if (session.waitMs > 0) timer = setTimeout(() => { if (dialog.isConnected) sync(); }, session.waitMs + 10);
  }
  function reset() {
    targets = correctionTargets(session.game, entries); target.replaceChildren();
    for (const item of targets) target.add(new Option(`#${item.revision}: ${item.original.type === 'clock' ? 'Clock' : item.original.play.type === 'pitch' ? item.original.play.pitch : 'Runner play'}${item.action === null ? ' (voided)' : ''}`, String(item.revision)));
    target.value = String(targets.at(-1).revision); reason.value = ''; mode.value = 'void'; selectionChanged();
  }
  async function perform(action) {
    if (session.busy || (action && (!draft || !confirm.checked))) return;
    try {
      const pending = action ? session.submit(structuredClone(action)) : session.refresh();
      invalidate(); sync(); await pending;
      if (dialog.isConnected) { reset(); result.textContent = action ? 'Correction saved and verified.' : 'Game and history reloaded.'; }
    } catch (failure) { if (dialog.isConnected) error.textContent = message(failure); }
    finally { if (dialog.isConnected) sync(); }
  }
  target.onchange = selectionChanged; include.onchange = renderRunners;
  form.addEventListener('input', () => { invalidate(); sync(); }); form.addEventListener('change', () => { invalidate(); sync(); }); confirm.onchange = sync;
  dialog.addEventListener('cancel', event => { if (session.busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { clearTimeout(timer); dialog.remove(); }, { once: true });
  dialog.append(title, badge, form, result, confirmation, error, footer);
  form.className = 'correction-fields'; document.body.append(dialog);
  try { reset(); dialog.showModal(); } catch (failure) { dialog.remove(); throw failure; }
}
