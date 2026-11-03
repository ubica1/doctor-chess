/* A premove is only a plan. It is revalidated against the server-confirmed position. */
let premoveEnabled = localStorage.getItem('dc-premove') === 'on',
  premove = null,
  premoveGeneration = 0;
function canQueuePremove() {
  return (
    premoveEnabled &&
    mode === 'online' &&
    !!game &&
    !game.result &&
    game.state.turn !== game.you &&
    reviewIndex === null &&
    !busy &&
    !queued
  );
}
function selectablePiece(i) {
  return (
    (canInteract() && color(s.b[i]) === s.turn) || (canQueuePremove() && color(s.b[i]) === game.you)
  );
}
function moveTargets(i) {
  if (canInteract()) return legal(s, i);
  if (canQueuePremove() && color(s.b[i]) === game.you)
    return legal({ ...s, turn: game.you, ep: -1 }, i);
  return [];
}
function clearPremove() {
  premove = null;
  premoveGeneration++;
}
function cancelPremove() {
  clearPremove();
  selected = -1;
  boardView?.cancel();
  render();
}
function planPremove(i) {
  if (!canQueuePremove()) return;
  if (selected >= 0 && moveTargets(selected).includes(i)) {
    premove = {
      gameId: game.id,
      from: selected,
      to: i,
      promotion: 'q',
      armedAt: game.moves.length,
    };
    premoveGeneration++;
    selected = -1;
    render();
    return;
  }
  selected = color(s.b[i]) === game.you ? i : -1;
  render();
}
function consumePremove() {
  if (!premove) return;
  if (mode !== 'online' || !game || game.result || premove.gameId !== game.id) {
    clearPremove();
    updatePremove();
    return;
  }
  if (game.state.turn !== game.you || game.moves.length <= premove.armedAt) return;
  const planned = premove,
    ticket = ++premoveGeneration;
  premove = null;
  updatePremove();
  Promise.resolve().then(() => {
    if (
      ticket !== premoveGeneration ||
      mode !== 'online' ||
      game?.id !== planned.gameId ||
      !canInteract()
    )
      return;
    if (color(s.b[planned.from]) !== game.you || !legal(s, planned.from).includes(planned.to)) {
      toast('Предварительный ход отменён: позиция изменилась.');
      render();
      return;
    }
    makeMove(planned.from, planned.to, planned.promotion);
  });
}
function updatePremove() {
  $('premove-setting').hidden = mode !== 'online';
  $('premove-enabled').checked = premoveEnabled;
  $('premove-enabled').disabled = busy;
  $('premove-bar').hidden = !premove;
  if (premove)
    $('premove-caption').textContent =
      'Предварительный ход: ' +
      name(premove.from) +
      '–' +
      name(premove.to) +
      (s.b[premove.from]?.toLowerCase() === 'p' && (premove.to < 8 || premove.to >= 56)
        ? ' = Ферзь'
        : '');
  for (const square of boardView?.squares || []) {
    square.classList.toggle('premove-from', premove?.from === Number(square.dataset.index));
    square.classList.toggle('premove-to', premove?.to === Number(square.dataset.index));
  }
}
function initializePremoves() {
  $('premove-enabled').onchange = () => {
    premoveEnabled = $('premove-enabled').checked;
    localStorage.setItem('dc-premove', premoveEnabled ? 'on' : 'off');
    cancelPremove();
  };
  $('cancel-premove').onclick = cancelPremove;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && premove && !$('modal').open) cancelPremove();
  });
}
