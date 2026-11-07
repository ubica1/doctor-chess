const ChessDaily = (() => {
  const E =
    typeof module !== 'undefined'
      ? require('./engine.js')
      : { color, legal, apply, check, allMoves };
  const calendar = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const dayLength = 86400000;
  const start = Date.UTC(2026, 10, 7) / dayLength;
  const puzzles = [
    [1, '8/8/4p3/7R/7B/8/2K5/k7 w - - 0 1'],
    [1, '8/8/2P5/6q1/8/6k1/8/7K b - - 0 1'],
    [2, 'n5k1/8/Q7/6N1/8/8/4K3/8 w - - 0 1'],
    [1, '8/8/8/p7/8/7K/5B2/5N1k w - - 0 1'],
    [2, '1K6/4P3/8/8/7r/2q5/3k4/8 b - - 0 1'],
    [1, '8/8/8/8/8/1K6/B6p/k5B1 w - - 0 1'],
    [1, '8/8/6k1/8/3P4/2n5/2p5/K7 b - - 0 1'],
    [2, '1k5n/8/8/2K5/8/2Q5/2R5/8 w - - 0 1'],
    [1, '8/2R4p/8/8/8/8/2K5/k5N1 w - - 0 1'],
    [2, 'K7/p7/q7/8/b7/8/8/k7 b - - 0 1'],
    [1, '7K/8/6r1/8/8/1q1P4/1k6/8 b - - 0 1'],
    [2, '8/6n1/7K/8/6B1/8/3Q4/7k w - - 0 1'],
    [1, '1r4nK/5k2/P7/8/8/8/8/8 b - - 0 1'],
    [1, 'k1K5/8/5Q2/8/8/1n6/8/8 w - - 0 1'],
    [2, '7K/4k1P1/8/8/4b3/8/8/r7 b - - 0 1'],
    [1, '8/8/4K3/8/3N4/1Q6/4p3/k7 w - - 0 1'],
    [1, '1K6/8/8/2q5/2P3k1/q7/8/8 b - - 0 1'],
    [2, '6k1/2Q5/5p2/2N5/8/6K1/8/8 w - - 0 1'],
    [1, '6K1/r6P/8/8/8/2kr4/8/8 b - - 0 1'],
    [2, '2r5/5P2/8/8/8/k4b2/8/1K6 b - - 0 1'],
  ];
  function day(now = Date.now()) {
    const { year, month, day } = Object.fromEntries(
      calendar.formatToParts(now).map(({ type, value }) => [type, Number(value)])
    );
    return Date.UTC(year, month - 1, day) / dayLength;
  }
  function puzzle(day) {
    const index = (day - start) % puzzles.length;
    return puzzles.at(index);
  }
  function promotion(state, from, to) {
    return state.b[from]?.toLowerCase() === 'p' && (to < 8 || to >= 56);
  }
  function moves(state) {
    return state.b.flatMap((piece, from) =>
      E.color(piece) === state.turn
        ? E.legal(state, from).flatMap((to) =>
            (promotion(state, from, to) ? ['q', 'r', 'b', 'n'] : ['q']).map((promotion) => ({
              from,
              to,
              promotion,
            }))
          )
        : []
    );
  }
  function after(state, move) {
    return E.apply(state, move.from, move.to, move.promotion);
  }
  function mate(state) {
    return E.check(state, state.turn) && !E.allMoves(state);
  }
  function solutions(state, distance) {
    const lines = [];
    for (const move of moves(state)) {
      const next = after(state, move);
      if (distance === 1) {
        if (mate(next)) lines.push([move]);
        continue;
      }
      const replies = moves(next);
      if (!replies.length) continue;
      // Keep a representative defense only if every legal reply has a mate.
      const finish = solutions(after(next, replies[0]), 1)[0];
      if (finish && replies.slice(1).every((reply) => solutions(after(next, reply), 1).length))
        lines.push([move, replies[0], finish[0]]);
    }
    return lines;
  }
  function streak(day, read) {
    let cursor = read(day) === 'solved' ? day : day - 1;
    const end = cursor;
    while (read(cursor) === 'solved') cursor--;
    return end - cursor;
  }
  return { day, dayLength, puzzle, promotion, after, solutions, streak };
})();
if (typeof module !== 'undefined') module.exports = ChessDaily;

let dailyPuzzle = null;
function closeDailyPuzzle() {
  if (!dailyPuzzle) return;
  clearTimeout(dailyPuzzle.replyTimer);
  dailyPuzzle.board.destroy();
  dailyPuzzle = null;
}
function dailyProgress(day) {
  try {
    const progress = localStorage.getItem('dc-daily-mate:' + day);
    if (['hint', 'solved', 'assisted', 'revealed'].includes(progress)) return progress;
  } catch {}
  return '';
}
function dailyFinished(progress) {
  return progress === 'solved' || progress === 'assisted' || progress === 'revealed';
}
function saveDailyProgress(session, progress) {
  const saved = dailyProgress(session.day);
  if (dailyFinished(saved)) return saved;
  if (progress === 'solved' && saved === 'hint') progress = 'assisted';
  try {
    localStorage.setItem('dc-daily-mate:' + session.day, progress);
  } catch {
    toast('Браузер не смог сохранить прогресс задачи.');
  }
  return progress;
}
function updateDailySafety() {
  const session = dailyPuzzle;
  if (!session) return;
  $('daily-actions').hidden = session.done;
  $('daily-hint').disabled = session.waiting || learningMatchActive();
  $('daily-answer').disabled = session.waiting || learningMatchActive();
  $('daily-blocked').hidden = !learningMatchActive();
  $('daily-today').hidden = session.day === ChessDaily.day();
}
function renderDailyPuzzle() {
  const session = dailyPuzzle;
  const state = session.state;
  const king = check(state, state.turn) ? state.b.indexOf(state.turn === 'w' ? 'K' : 'k') : -1;
  session.board.render(
    state,
    session.start.turn === 'b',
    session.selected,
    session.selected >= 0 ? legal(state, session.selected) : [],
    session.last,
    king,
    session.done ? king : -1
  );
  updateDailySafety();
}
function finishDailyPuzzle(session, progress, line, shown = false) {
  session.done = true;
  session.selected = -1;
  const replay = ChessNotation.replay(session.start, line);
  const last = line.at(-1);
  session.state = replay.positions.at(-1);
  session.last = [last.from, last.to];
  $('daily-feedback').textContent =
    {
      solved: 'Мат! Решено самостоятельно.',
      assisted: 'Мат! Решено с подсказкой.',
      revealed: 'Решение открыто.',
    }[progress] +
    (shown ? ' Вариант: ' : ' Ваш вариант: ') +
    replay.sans.join(' · ');
  refreshDailyStreak();
  renderDailyPuzzle();
}
function refreshDailyStreak() {
  const streak = ChessDaily.streak(ChessDaily.day(), dailyProgress);
  $('daily-streak').textContent =
    'Серия без подсказок: ' + streak + ' ' + plural(streak, ['день', 'дня', 'дней']);
}
function canSolveDaily(session) {
  return session && !session.done && !session.waiting && !learningMatchActive();
}
function dailySquare(to) {
  const session = dailyPuzzle;
  if (!canSolveDaily(session)) return;
  const state = session.state;
  const from = session.selected;
  if (from < 0 || !legal(state, from).includes(to)) {
    session.selected = color(state.b[to]) === state.turn ? to : -1;
    renderDailyPuzzle();
    return;
  }
  const play = (promotion) => {
    if (dailyPuzzle !== session || !canSolveDaily(session)) return;
    session.selected = -1;
    const line = session.lines.find(
      ([move]) => move.from === from && move.to === to && move.promotion === promotion
    );
    if (!line) {
      $('daily-feedback').textContent =
        'Этот ход не приводит к мату за указанное число ходов. Попробуйте ещё.';
      renderDailyPuzzle();
      return;
    }
    if (line.length === 1) {
      const progress = saveDailyProgress(session, session.hinted ? 'assisted' : 'solved');
      finishDailyPuzzle(session, progress, [...session.played, line[0]]);
      return;
    }
    const [first, reply] = line;
    session.played = [first, reply];
    session.state = ChessDaily.after(state, first);
    session.last = [first.from, first.to];
    session.waiting = true;
    $('daily-feedback').textContent = 'Соперник отвечает…';
    renderDailyPuzzle();
    session.replyTimer = setTimeout(() => {
      if (dailyPuzzle !== session) return;
      session.state = ChessDaily.after(session.state, reply);
      session.last = [reply.from, reply.to];
      session.lines = ChessDaily.solutions(session.state, 1);
      session.waiting = false;
      $('daily-feedback').textContent = 'Теперь поставьте мат.';
      renderDailyPuzzle();
    }, 380);
  };
  if (ChessDaily.promotion(state, from, to)) chooseLearningPromotion(play);
  else play('q');
}
function loadDailyPuzzle() {
  $('game-page').hidden = true;
  $('community-page').hidden = false;
  communityNav('nav-play');
  document.title = 'Задача дня · Doctor Chess';
  const day = ChessDaily.day();
  const [distance, fen] = ChessDaily.puzzle(day);
  const start = ChessNotation.fromFEN(fen);
  const lines = ChessDaily.solutions(start, distance);
  const progress = dailyProgress(day);
  const date = new Date(day * ChessDaily.dayLength).toLocaleDateString('ru-RU', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
  });
  $('community-page').innerHTML = `
    <section class="workspace-heading">
      <span class="workspace-seal" aria-hidden="true">棋</span>
      <div><p>РАЗМИНКА С ДОКТОРОМ</p><h1>Задача дня</h1><p>${date} · Мат в ${distance === 1 ? 'один ход' : 'два хода'} · Ход ${start.turn === 'w' ? 'белых' : 'чёрных'}</p></div>
    </section>
    <div class="mistake-layout daily-layout">
      <section>
        <div class="board-frame"><div class="board-rim"><div id="daily-board" tabindex="0" role="group" aria-label="Доска задачи дня"></div></div></div>
      </section>
      <aside class="notebook-paper">
        <h2>У доски</h2>
        <p id="daily-feedback" role="status">Найдите ход, с которого начинается мат.</p>
        <p id="daily-blocked" role="status" hidden>Решение доступно после завершения сетевой партии.</p>
        <div class="study-board-tools" id="daily-actions">
          <button id="daily-hint">Подсказка</button><button id="daily-answer">Показать решение</button>
        </div>
        <p class="daily-streak" id="daily-streak"></p>
        <p class="muted">Прогресс хранится в браузере. Новая позиция появляется в полночь по Москве.</p>
        <button id="daily-today" class="outline" hidden>К новой задаче →</button>
        <a href="/academy">Ещё упражнения в Школе Доктора →</a>
      </aside>
    </div>`;
  const session = (dailyPuzzle = {
    day,
    start,
    state: start,
    lines,
    example: lines[0],
    played: [],
    last: [],
    selected: -1,
    hinted: progress === 'hint',
  });
  session.board = new ChessBoardView($('daily-board'), {
    piece,
    onClick: dailySquare,
    onPick: (from) => {
      if (!canSolveDaily(session)) return;
      session.selected = from;
      renderDailyPuzzle();
    },
    canDrag: (from) =>
      canSolveDaily(session) && color(session.state.b[from]) === session.state.turn,
    onDrop: (from, to) => {
      session.selected = from;
      dailySquare(to);
    },
  });
  $('daily-hint').onclick = () => {
    if (!canSolveDaily(session)) return;
    saveDailyProgress(session, 'hint');
    session.hinted = true;
    session.selected = session.lines[0][0].from;
    $('daily-feedback').textContent = 'Попробуйте сходить выделенной фигурой.';
    renderDailyPuzzle();
  };
  $('daily-answer').onclick = () => {
    if (!canSolveDaily(session)) return;
    finishDailyPuzzle(session, saveDailyProgress(session, 'revealed'), session.example, true);
  };
  $('daily-today').onclick = () => navigate('/daily');
  if (dailyFinished(progress)) finishDailyPuzzle(session, progress, session.example, true);
  else {
    refreshDailyStreak();
    renderDailyPuzzle();
  }
}
if (typeof document !== 'undefined')
  document.addEventListener('visibilitychange', () => {
    if (dailyPuzzle && !document.hidden) {
      refreshDailyStreak();
      updateDailySafety();
    }
  });
