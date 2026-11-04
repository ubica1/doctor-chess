/* One result model for live games, training and imported records. */
const ChessOutcome = (() => {
  const E = typeof module !== 'undefined' ? require('./engine.js') : { end, allMoves, check, opp };
  function describe(state, history, { game, mode, botSide, archiveInfo } = {}) {
    if (game && !game.result) return null;
    let result,
      reason,
      you = game?.you || (mode === 'computer' ? botSide : null);
    if (game?.result) {
      result = game.result;
      reason = game.reason || 'Партия завершена';
      if (reason.includes('сдался')) reason = result === you ? 'Соперник сдался.' : 'Вы сдались.';
      else if (reason.includes('Время'))
        reason =
          result === 'draw'
            ? 'Время вышло, но у другой стороны недостаточно материала для мата.'
            : result === you
              ? 'У соперника закончилось время.'
              : 'Ваше время закончилось.';
    } else if (mode === 'analysis' && archiveInfo?.result && archiveInfo.result !== '*') {
      result = { '1-0': 'w', '0-1': 'b', '1/2-1/2': 'draw' }[archiveInfo.result];
      reason = archiveInfo.reason || 'Результат из записи партии.';
    } else {
      reason = E.end(state, history);
      if (!reason) return null;
      result = !E.allMoves(state) && E.check(state, state.turn) ? E.opp(state.turn) : 'draw';
    }
    if (!result) return null;
    const tone = result === 'draw' ? 'draw' : you ? (result === you ? 'win' : 'loss') : 'neutral';
    return {
      rating:
        game?.kind === 'casual'
          ? 'Дружеская партия · рейтинг не меняется'
          : game?.ratingChange?.[you]
            ? (() => {
                const rating = game.ratingChange[you];
                const category =
                  { bullet: 'Пуля', blitz: 'Блиц', rapid: 'Рапид', classical: 'Классика' }[
                    game.category
                  ] || 'Рейтинг';
                return (
                  category +
                  ': ' +
                  rating.before +
                  ' → ' +
                  rating.after +
                  ' (' +
                  (rating.delta >= 0 ? '+' : '') +
                  rating.delta +
                  ')'
                );
              })()
            : mode === 'computer'
              ? 'Тренировка · без рейтинга'
              : '',
      result,
      reason,
      tone,
      score: { w: '1 — 0', b: '0 — 1', draw: '½ — ½' }[result],
      title:
        result === 'draw'
          ? 'Ничья'
          : you
            ? result === you
              ? 'Вы победили!'
              : 'Вы проиграли'
            : result === 'w'
              ? 'Белые победили'
              : 'Чёрные победили',
      message:
        tone === 'win'
          ? 'Хорошая партия. Запомним этот ритм.'
          : tone === 'loss'
            ? 'Каждая партия чему-то учит. Найдём поворотный момент?'
            : 'Спасибо за партию. За доской всегда есть что открыть.',
      symbol: result === 'draw' ? '和' : tone === 'loss' ? '学' : '胜',
    };
  }
  return { describe };
})();
if (typeof module !== 'undefined') module.exports = ChessOutcome;

let outcomeSeen = '',
  currentOutcome = null;
function updateOutcome() {
  const outcome = ChessOutcome.describe(s, history, { game, mode, botSide, archiveInfo });
  currentOutcome = outcome;
  const showCard = !!outcome && !variationEditing;
  $('result-card').hidden = !showCard;
  if (!showCard) {
    if ($('result-modal').open) $('result-modal').close();
    if (!outcome) outcomeSeen = '';
    return;
  }
  for (const prefix of ['result', 'finish']) {
    $(prefix + '-title').textContent = outcome.title;
    $(prefix + '-score').textContent = outcome.score;
    $(prefix + '-reason').textContent = outcome.reason;
    $(prefix + '-rating').textContent = outcome.rating;
    $(prefix + '-symbol').textContent = outcome.symbol;
    $(prefix + '-surface').dataset.tone = outcome.tone;
  }
  $('finish-message').textContent = outcome.message;
  $('result-again').textContent = game
    ? 'Реванш →'
    : mode === 'computer'
      ? 'Ещё с доктором →'
      : 'Новая партия →';
  $('finish-again').textContent = $('result-again').textContent;
  $('result-again').hidden = mode === 'analysis';
  $('finish-again').hidden = mode === 'analysis';
  const key = game ? game.id + ':' + game.result : mode + ':' + history.length + ':' + s.b.join('');
  // The server confirms online results; an optimistic last move cannot announce a win.
  if (
    mode !== 'analysis' &&
    !$('game-page').hidden &&
    reviewIndex === null &&
    !busy &&
    key !== outcomeSeen &&
    !$('modal').open
  ) {
    outcomeSeen = key;
    $('result-modal').showModal();
  }
}
function initializeOutcome() {
  const close = () => $('result-modal').close();
  $('finish-close').onclick = close;
  const review = () => {
    close();
    setReview(0);
  };
  $('result-review').onclick = review;
  $('finish-review').onclick = review;
  const again = () => {
    close();
    if (game) requestRematch();
    else {
      archiveCurrent(true);
      startLocal();
    }
  };
  $('result-again').onclick = again;
  $('finish-again').onclick = again;
  $('result-detail').onclick = () => $('result-modal').showModal();
  $('finish-export').onclick = exportPGN;
}
