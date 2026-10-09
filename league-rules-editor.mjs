import { nextRulesProfile, validateRulesProfile } from './league-rules.mjs';

export function openRulesEditor(profile, save) {
  document.getElementById('rules-editor-dialog')?.remove();
  const initial = profile ? validateRulesProfile(profile) : { name: '', rules: { innings: 7, ballsForWalk: 4, strikesForOut: 3, outsPerHalf: 3,
    startingBalls: 0, startingStrikes: 0, foulAtStrikeLimit: 'dead-ball', runsPerHalf: null, unlimitedFinalInning: false, mercy: null,
    timeLimitMinutes: null, tiePolicy: 'extra-innings', extraInningRunner: 'none' } };
  const dialog = document.createElement('dialog'); dialog.id = 'rules-editor-dialog'; dialog.className = 'game-editor-dialog'; dialog.setAttribute('aria-labelledby', 'rules-editor-title');
  const heading = document.createElement('h2'); heading.id = 'rules-editor-title'; heading.textContent = profile ? 'Edit rule profile' : 'New rule profile';
  const form = document.createElement('form'); const grid = document.createElement('div'); grid.className = 'game-editor-grid';
  const controls = {};
  const add = (name, text, input) => { const label = document.createElement('label'); label.textContent = text; input.name = name; label.append(input); grid.append(label); controls[name] = input; return input; };
  const name = add('name', 'Profile name', document.createElement('input')); name.required = true; name.maxLength = 100; name.value = initial.name;
  for (const [key, text, min, max] of [['innings', 'Regulation innings', 1, 99], ['ballsForWalk', 'Balls for a walk', 1, 12], ['strikesForOut', 'Strikes for an out', 1, 12],
    ['outsPerHalf', 'Outs per half inning', 1, 12], ['startingBalls', 'Starting balls', 0, 11], ['startingStrikes', 'Starting strikes', 0, 11]]) {
    const input = add(key, text, document.createElement('input')); input.type = 'number'; input.required = true; input.min = min; input.max = max; input.step = 1; input.value = initial.rules[key];
  }
  for (const [key, text, options] of [['foulAtStrikeLimit', 'Foul at strike limit', [['dead-ball', 'No additional strike'], ['strikeout', 'Strikeout']]],
    ['tiePolicy', 'Tied after regulation', [['extra-innings', 'Extra innings'], ['allow-tie', 'Allow a tie']]],
    ['extraInningRunner', 'Extra-inning runner', [['none', 'No automatic runner'], ['second', 'Runner on second']]]]) {
    const input = add(key, text, document.createElement('select')); options.forEach(([value, title]) => input.add(new Option(title, value))); input.value = initial.rules[key];
  }
  const optional = (key, title, value, max) => {
    const wrap = document.createElement('div'); wrap.className = 'rules-optional';
    const label = document.createElement('label'); label.className = 'rules-toggle';
    const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = value !== null; label.append(enabled, document.createTextNode(title));
    const input = document.createElement('input'); input.type = 'number'; input.min = 1; input.max = max; input.step = 1; input.value = value ?? 1; input.setAttribute('aria-label', title + ' value');
    controls[key] = input;
    const sync = () => { input.disabled = !enabled.checked; input.required = enabled.checked; };
    enabled.onchange = () => { sync(); synchronize(); }; sync(); wrap.append(label, input); grid.append(wrap);
    return enabled;
  };
  const runCap = optional('runsPerHalf', 'Run limit per half inning', initial.rules.runsPerHalf, 99999);
  const finalLabel = document.createElement('label'); finalLabel.className = 'rules-toggle';
  const finalUnlimited = document.createElement('input'); finalUnlimited.type = 'checkbox'; finalUnlimited.checked = initial.rules.unlimitedFinalInning;
  finalLabel.append(finalUnlimited, document.createTextNode('Unlimited final inning')); grid.append(finalLabel);
  const mercy = optional('mercyRuns', 'Mercy run difference', initial.rules.mercy?.runs ?? null, 99999);
  const mercyInning = add('mercyAfterInning', 'Mercy rule after inning', document.createElement('input')); mercyInning.type = 'number'; mercyInning.min = 1; mercyInning.max = 99; mercyInning.step = 1; mercyInning.value = initial.rules.mercy?.afterInning ?? 1;
  const timed = optional('timeLimitMinutes', 'Time limit in minutes', initial.rules.timeLimitMinutes, 1440);
  function synchronize() {
    finalUnlimited.disabled = !runCap.checked; if (!runCap.checked) finalUnlimited.checked = false;
    mercyInning.disabled = !mercy.checked; mercyInning.required = mercy.checked;
    controls.extraInningRunner.disabled = controls.tiePolicy.value === 'allow-tie';
    if (controls.extraInningRunner.disabled) controls.extraInningRunner.value = 'none';
  }
  controls.tiePolicy.onchange = synchronize; synchronize();
  const error = document.createElement('p'); error.setAttribute('role', 'alert');
  const actions = document.createElement('div'); actions.className = 'game-editor-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn btn-ghost'; cancel.textContent = 'Cancel'; cancel.onclick = () => dialog.close();
  const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'btn btn-primary'; submit.textContent = 'Save profile';
  let pending = false;
  form.onsubmit = async event => {
    event.preventDefault(); if (pending) return; error.textContent = '';
    const number = key => controls[key].valueAsNumber;
    const rules = { innings: number('innings'), ballsForWalk: number('ballsForWalk'), strikesForOut: number('strikesForOut'), outsPerHalf: number('outsPerHalf'),
      startingBalls: number('startingBalls'), startingStrikes: number('startingStrikes'), foulAtStrikeLimit: controls.foulAtStrikeLimit.value,
      runsPerHalf: runCap.checked ? number('runsPerHalf') : null, unlimitedFinalInning: finalUnlimited.checked,
      mercy: mercy.checked ? { runs: number('mercyRuns'), afterInning: number('mercyAfterInning') } : null,
      timeLimitMinutes: timed.checked ? number('timeLimitMinutes') : null, tiePolicy: controls.tiePolicy.value, extraInningRunner: controls.extraInningRunner.value };
    try {
      const values = { name: name.value, rules }; nextRulesProfile(profile, values, profile?.revision ?? 0);
      pending = true; submit.disabled = cancel.disabled = true;
      await save(values); if (dialog.isConnected) dialog.close();
    } catch (failure) { if (dialog.isConnected) error.textContent = failure.message; }
    finally { pending = false; submit.disabled = cancel.disabled = false; }
  };
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  actions.append(cancel, submit); form.append(heading, grid, error, actions); dialog.append(form); document.body.append(dialog); dialog.showModal();
}
