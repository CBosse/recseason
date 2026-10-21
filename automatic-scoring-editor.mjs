import { createScoringSession, orderedRunnerOutcomes } from './automatic-scoring-session.mjs';
import { baseLabel } from './base-occupancy.mjs';

export function openAutomaticScoring({ game, load, save, isCurrent }) {
  if (document.getElementById('automatic-scoring-dialog')) return;
  const dialog = document.createElement('dialog'); dialog.id = 'automatic-scoring-dialog'; dialog.className = 'game-editor-dialog automatic-editor';
  dialog.setAttribute('aria-labelledby', 'automatic-scoring-title');
  const session = createScoringSession({ initial: game, load, save, isCurrent: () => dialog.isConnected && isCurrent() });
  const title = document.createElement('h2'); title.id = 'automatic-scoring-title'; title.textContent = `${game.awayName} at ${game.homeName}`;
  const badge = document.createElement('p'); badge.className = 'muted'; badge.textContent = 'Automatic scoring · Local preview';
  const score = document.createElement('p'); score.className = 'automatic-score'; score.setAttribute('role', 'status');
  const summary = document.createElement('p');
  const rules = document.createElement('details'), ruleTitle = document.createElement('summary'); ruleTitle.textContent = 'Frozen game rules';
  const ruleValues = document.createElement('dl'); ruleValues.className = 'automatic-rules';
  const r = game.rulesSnapshot.rules;
  for (const [name, value] of Object.entries({ Profile: `${game.rulesSnapshot.name} / revision ${game.rulesSnapshot.revision}`,
    Innings: r.innings, 'Walk / strikeout / half outs': `${r.ballsForWalk} / ${r.strikesForOut} / ${r.outsPerHalf}`,
    'Starting balls / strikes': `${r.startingBalls} / ${r.startingStrikes}`, 'Foul at strike limit': r.foulAtStrikeLimit,
    'Strict half-inning run cap': r.runsPerHalf ?? 'None', 'Unlimited scheduled final and extras': r.unlimitedFinalInning ? 'Yes' : 'No',
    Mercy: r.mercy ? `${r.mercy.runs} runs from inning ${r.mercy.afterInning}` : 'None',
    'Time limit / finish current inning': r.timeLimitMinutes === null ? 'None' : `${r.timeLimitMinutes} minutes`,
    Ties: r.tiePolicy, 'Extra runner': r.extraInningRunner })) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = name; dd.textContent = value; ruleValues.append(dt, dd);
  }
  rules.append(ruleTitle, ruleValues);
  const consentLabel = document.createElement('label'); consentLabel.className = 'automatic-toggle';
  const consent = document.createElement('input'); consent.type = 'checkbox'; consent.checked = Boolean(game.automaticScoring);
  consentLabel.append(consent, document.createTextNode('Use these version 1 rules'));
  const clockLabel = document.createElement('label'); clockLabel.textContent = 'Elapsed game time (seconds)';
  const clock = document.createElement('input'); clock.type = 'number'; clock.min = '0'; clock.step = '0.001'; clock.required = true; clockLabel.append(clock);
  const clockGrid = document.createElement('div'); clockGrid.className = 'game-editor-grid'; clockGrid.append(clockLabel);
  const pitches = document.createElement('div'); pitches.className = 'automatic-pitches';
  const actions = [];
  const button = (text, parent, handler) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-secondary'; b.textContent = text;
    b.onclick = handler; parent.append(b); return b;
  };
  const elapsed = () => {
    if (!clock.checkValidity() || clock.value.trim() === '') throw new Error('Enter valid elapsed game time.');
    const value = Math.round(Number(clock.value) * 1000);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Enter valid elapsed game time.');
    return value;
  };
  for (const [label, pitch] of [['Ball', 'ball'], ['Strike', 'strike'], ['Foul', 'foul']]) {
    actions.push(button(label, pitches, () => perform(() => ({ schemaVersion: 1, type: 'play', elapsedMs: elapsed(), runAward: 'ordinary', play: { schemaVersion: 1, type: 'pitch', pitch } }))));
  }
  actions.push(button('Record time', pitches, () => perform(() => ({ schemaVersion: 1, type: 'clock', elapsedMs: elapsed() }))));
  const runnerSection = document.createElement('details'); const runnerHeading = document.createElement('summary'); runnerHeading.textContent = 'Runner play';
  const includeLabel = document.createElement('label'); includeLabel.className = 'automatic-toggle';
  const include = document.createElement('input'); include.type = 'checkbox'; include.checked = true; includeLabel.append(include, document.createTextNode('Batter in this play'));
  const homerLabel = document.createElement('label'); homerLabel.className = 'automatic-toggle';
  const homer = document.createElement('input'); homer.type = 'checkbox'; homerLabel.append(homer, document.createTextNode('Over-the-fence home run'));
  const runnerGrid = document.createElement('div'); runnerGrid.className = 'automatic-runners';
  let runnerControls = [], timer;
  const runners = () => {
    runnerControls = []; runnerGrid.replaceChildren();
    const bases = session.game.bases ?? {};
    const names = ['third', 'second', 'first'].filter(base => bases[base]); if (include.checked) names.push('batter');
    names.forEach((runner, index) => {
      const row = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = runner === 'batter' ? 'Batter' : `Runner on ${runner}`; row.append(legend);
      const controls = { runner };
      const orderLabel = document.createElement('label'); orderLabel.textContent = `${legend.textContent} play order`;
      const order = document.createElement('input'); order.type = 'number'; order.min = '1'; order.max = String(names.length); order.step = '1'; order.value = String(index + 1); orderLabel.append(order); controls.order = order; row.append(orderLabel);
      for (const [key, label, options, value] of [
        ['destination', 'Outcome', [['first', 'First'], ['second', 'Second'], ['third', 'Third'], ['home', 'Run'], ['out', 'Out']], runner === 'batter' ? 'first' : runner],
        ['outType', 'Out ruling', [['tag', 'Tag'], ['force', 'Force'], ['batter-before-first', 'Batter before first']], runner === 'batter' ? 'batter-before-first' : 'tag'],
      ]) {
        const field = document.createElement('label'); field.textContent = `${legend.textContent} ${label.toLowerCase()}`;
        const select = document.createElement('select'); for (const [id, name] of options) select.add(new Option(name, id));
        select.value = value; field.append(select); row.append(field); controls[key] = select;
      }
      const showOut = () => { controls.outType.parentElement.hidden = controls.destination.value !== 'out'; };
      controls.destination.onchange = showOut; showOut(); runnerControls.push(controls); runnerGrid.append(row);
    });
  };
  include.onchange = () => { runners(); sync(); };
  runnerSection.append(runnerHeading, includeLabel, runnerGrid, homerLabel);
  actions.push(button('Record runner play', runnerSection, () => perform(() => ({ schemaVersion: 1, type: 'play', elapsedMs: elapsed(), runAward: homer.checked ? 'home-run' : 'ordinary',
    play: { schemaVersion: 1, type: 'runners', includesBatter: include.checked, outcomes: orderedRunnerOutcomes(runnerControls.map(row => ({ runner: row.runner, order: row.order.value, destination: row.destination.value, outType: row.outType.value }))) } }))));
  const error = document.createElement('p'); error.setAttribute('role', 'alert');
  const footer = document.createElement('div'); footer.className = 'game-editor-actions';
  const refresh = button('Reload game', footer, () => perform(null));
  const close = button('Close', footer, () => dialog.close());
  function sync() {
    const active = isCurrent(), locked = session.busy || session.refreshRequired || session.waitMs > 0 || !consent.checked || session.game.status === 'completed' || !active;
    for (const control of [...actions, clock, include, homer, ...runnerGrid.querySelectorAll('input, select')]) control.disabled = locked;
    consent.disabled = session.busy || Boolean(session.game.automaticScoring) || !active;
    refresh.disabled = session.busy || !active; close.disabled = session.busy;
    dialog.setAttribute('aria-busy', String(session.busy));
    clearTimeout(timer); if (session.waitMs > 0) timer = setTimeout(() => { if (dialog.isConnected) sync(); }, session.waitMs + 10);
  }
  function render() {
    const current = session.game;
    score.textContent = `${current.awayName} ${current.awayScore ?? 0} - ${current.homeScore ?? 0} ${current.homeName}`;
    summary.textContent = current.status === 'completed' ? `Final · ${current.automaticScoring?.endReason ?? ''}` :
      `${current.half ?? 'top'} ${current.inning ?? 1} · Balls ${current.balls ?? r.startingBalls} · Strikes ${current.strikes ?? r.startingStrikes} · Outs ${current.outs ?? 0} · ${baseLabel(current.bases)}`;
    clock.value = String((current.automaticScoring?.elapsedMs ?? 0) / 1000); clock.min = clock.value;
    if (current.automaticScoring) consent.checked = true;
    homer.checked = false; runners(); sync();
  }
  async function perform(buildAction) {
    if (session.busy) return;
    error.textContent = '';
    try {
      const promise = buildAction ? session.submit(buildAction()) : session.refresh();
      sync(); await promise; if (dialog.isConnected) render();
    } catch (reason) { if (dialog.isConnected) error.textContent = reason.message; }
    finally { if (dialog.isConnected) sync(); }
  }
  consent.onchange = sync;
  dialog.addEventListener('cancel', event => { if (session.busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { clearTimeout(timer); dialog.remove(); }, { once: true });
  dialog.append(title, badge, score, summary, rules, consentLabel, clockGrid, pitches, runnerSection, error, footer);
  document.body.append(dialog); render(); dialog.showModal();
}
