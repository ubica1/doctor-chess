let puzzleTraining = null;

function closePuzzleTraining() {
  if (!puzzleTraining) return;
  clearTimeout(puzzleTraining.replyTimer);
  puzzleTraining.board?.destroy();
  puzzleTraining = null;
}

function puzzleCoordinates(uci) {
  const square = (file, rank) => (8 - Number(rank)) * 8 + 'abcdefgh'.indexOf(file);
  return {
    from: square(uci[0], uci[1]),
    to: square(uci[2], uci[3]),
    promotion: uci[4] || 'q',
  };
}

function updatePuzzleTrainingSafety() {
  const session = puzzleTraining;
  if (!session?.board) return;
  const blocked = learningMatchActive(),
    active = session.task?.state === 'active',
    finished = !!session.task && !active;
  $('trainer-blocked').hidden = !blocked;
  $('trainer-next').hidden = active;
  $('trainer-next').disabled = blocked || session.busy;
  $('trainer-reveal').hidden = !active;
  $('trainer-reveal').disabled = blocked || session.busy;
  $('trainer-review').hidden = !finished;
  $('trainer-theme').disabled = session.busy;
  $('trainer-level').disabled = session.busy;
  $('trainer-back').disabled = session.shown === 0;
  $('trainer-forward').disabled = session.shown === session.task?.step;
}

function renderPuzzleTrainingBoard() {
  const session = puzzleTraining;
  const position = session.replay.positions[session.shown],
    last = session.replay.records[session.shown - 1] || session.lead,
    checked = check(position, position.turn)
      ? position.b.indexOf(position.turn === 'w' ? 'K' : 'k')
      : -1;
  session.board.render(
    position,
    session.replay.positions[0].turn === 'b',
    session.selected,
    session.selected >= 0 ? legal(position, session.selected) : [],
    last ? [last.from, last.to] : [],
    checked,
    checked >= 0 && !allMoves(position) ? checked : -1
  );
  updatePuzzleTrainingSafety();
}

function refreshPuzzleTrainingProgress(progress) {
  $('trainer-rating').textContent = progress ? progress.rating : '—';
  $('trainer-stats').textContent = progress
    ? `Самостоятельно решено ${progress.wins} из ${progress.played}`
    : 'Войдите, чтобы сохранять рейтинг и прогресс.';
}

function showPuzzleTask(session, task, animate = false) {
  const oldStep = session.task?.step;
  const replay = ChessNotation.replay(
    ChessNotation.fromFEN(task.fen),
    task.moves.map(puzzleCoordinates)
  );
  Object.assign(session, {
    task,
    replay,
    lead: puzzleCoordinates(task.lead),
    selected: -1,
    shown: task.step,
  });
  const finished = task.state !== 'active';
  $('trainer-board-shell').hidden = false;
  $('trainer-turn').textContent =
    (replay.positions[0].turn === 'w' ? 'Ход белых' : 'Ход чёрных') + ' · Задача ' + task.rating;
  $('trainer-source').hidden = !finished;
  if (finished) {
    $('trainer-source').href = task.game;
    $('trainer-motifs').textContent = task.themes.join(' · ');
    $('trainer-line').textContent = replay.sans.join(' · ');
  }
  refreshPuzzleTrainingProgress(task.progress);
  $('trainer-score').textContent = task.score
    ? `Рейтинг за задачу: ${task.score.delta > 0 ? '+' : ''}${task.score.delta}`
    : '';
  const feedback = () =>
    task.state === 'revealed'
      ? 'Решение открыто. Посмотрите всю линию по ходам.'
      : task.state === 'solved'
        ? 'Решение найдено!'
        : task.feedback === 'wrong'
          ? 'Есть более сильный ход. Попробуйте ещё раз.'
          : 'Найдите лучший ход.';
  if (animate && !finished && task.step === oldStep + 2) {
    session.shown = oldStep + 1;
    $('trainer-feedback').textContent = 'Соперник отвечает…';
    renderPuzzleTrainingBoard();
    session.replyTimer = setTimeout(() => {
      if (puzzleTraining !== session) return;
      session.shown = task.step;
      session.busy = false;
      $('trainer-feedback').textContent = 'Найдите продолжение.';
      renderPuzzleTrainingBoard();
    }, 360);
    return true;
  }
  $('trainer-feedback').textContent = feedback();
  renderPuzzleTrainingBoard();
  return false;
}

async function startPuzzleTrainingTask() {
  const session = puzzleTraining;
  if (!session?.board || session.busy) return;
  const theme = $('trainer-theme').value,
    level = $('trainer-level').value,
    group = session.overview.themes.find((group) => group.id === theme);
  const count = group.counts[level];
  $('trainer-count').textContent = count + ' ' + plural(count, ['позиция', 'позиции', 'позиций']);
  try {
    localStorage.setItem('dc-puzzle-theme', theme);
    localStorage.setItem('dc-puzzle-level', level);
  } catch {}
  session.task = null;
  session.shown = 0;
  session.busy = true;
  $('trainer-board-shell').hidden = true;
  $('trainer-turn').textContent = 'Тактическая тренировка';
  $('trainer-score').textContent = '';
  $('trainer-source').hidden = true;
  $('trainer-motifs').textContent = '';
  $('trainer-feedback').textContent = 'Выбираем позицию…';
  updatePuzzleTrainingSafety();
  try {
    const task = await api('puzzles/start', { theme, level, previous: session.previous });
    if (puzzleTraining !== session) return;
    if (task.exhausted) {
      refreshPuzzleTrainingProgress(task.progress);
      $('trainer-feedback').textContent =
        'Вы прошли все задачи в этой подборке. Смените тему или уровень.';
    } else {
      session.previous = task.id;
      showPuzzleTask(session, task);
    }
  } catch (error) {
    if (puzzleTraining === session && !error.staleSession)
      $('trainer-feedback').textContent = error.message;
  } finally {
    if (puzzleTraining === session) {
      session.busy = false;
      updatePuzzleTrainingSafety();
    }
  }
}

function canPlayTraining(session) {
  return session?.task?.state === 'active' && !session.busy && !learningMatchActive();
}

async function submitPuzzleTrainingMove(data) {
  const session = puzzleTraining;
  if (!canPlayTraining(session)) return;
  session.busy = true;
  session.selected = -1;
  renderPuzzleTrainingBoard();
  let animating = false;
  try {
    const task = await api('puzzles/play', {
      id: session.task.id,
      step: session.task.step,
      guestKey: session.task.guestKey,
      ...data,
    });
    if (puzzleTraining === session) animating = showPuzzleTask(session, task, !data.reveal);
  } catch (error) {
    if (puzzleTraining === session && !error.staleSession)
      $('trainer-feedback').textContent = error.message;
  } finally {
    if (puzzleTraining === session && !animating) {
      session.busy = false;
      updatePuzzleTrainingSafety();
    }
  }
}

function puzzleTrainingSquare(to) {
  const session = puzzleTraining;
  if (!canPlayTraining(session)) return;
  const position = session.replay.positions[session.shown],
    from = session.selected;
  if (from < 0 || !legal(position, from).includes(to)) {
    session.selected = color(position.b[to]) === position.turn ? to : -1;
    renderPuzzleTrainingBoard();
    return;
  }
  const uci = name(from) + name(to);
  if (position.b[from].toLowerCase() === 'p' && (to < 8 || to >= 56))
    chooseLearningPromotion((promotion) => {
      if (puzzleTraining === session) submitPuzzleTrainingMove({ move: uci + promotion });
    });
  else submitPuzzleTrainingMove({ move: uci });
}

async function loadPuzzleTraining() {
  communityShell();
  communityNav('nav-puzzles');
  document.title = 'Задачи · Doctor Chess';
  const session = (puzzleTraining = { shown: 0, selected: -1 });
  try {
    const overview = await api('puzzles');
    if (puzzleTraining !== session) return;
    session.overview = overview;
    $('community-page').innerHTML = `
      <section class="workspace-heading">
        <span class="workspace-seal" aria-hidden="true">练</span>
        <div><p>ТАКТИЧЕСКАЯ ТРЕНИРОВКА</p><h1>Задачи</h1><p>Выберите тему или сыграйте подборку вперемешку.</p></div>
      </section>
      <section class="trainer-filters" aria-label="Подбор задач">
        <label>Тема<select id="trainer-theme">${overview.themes.map(({ id, name }) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join('')}</select></label>
        <label>Сложность<select id="trainer-level">${overview.levels.map(({ id, name }) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join('')}</select></label>
        <span id="trainer-count"></span>
        <a href="/daily">Задача дня →</a>
      </section>
      <div class="mistake-layout daily-layout trainer-layout">
        <section id="trainer-board-shell" hidden>
          <div class="board-frame"><div class="board-rim"><div id="trainer-board" tabindex="0" role="group" aria-label="Доска тактической задачи"></div></div></div>
          <div class="study-board-tools" id="trainer-review" hidden>
            <button id="trainer-back" aria-label="Предыдущий ход">←</button><button id="trainer-forward" aria-label="Следующий ход">→</button>
            <span id="trainer-line"></span>
          </div>
        </section>
        <aside class="notebook-paper">
          <h2 id="trainer-turn">Тактическая тренировка</h2>
          <p id="trainer-feedback" role="status"></p>
          <p id="trainer-blocked" role="status" hidden>Вернитесь к тренировке после завершения сетевой партии.</p>
          <p id="trainer-score"></p>
          <div class="study-board-tools">
            <button id="trainer-reveal" hidden>Показать решение</button><button id="trainer-next">Следующая задача →</button>
          </div>
          <a id="trainer-source" target="_blank" rel="noopener" hidden>Исходная партия на Lichess ↗</a>
          <p id="trainer-motifs" class="muted"></p>
          <div class="trainer-rating">
            <span>Рейтинг задач</span><strong id="trainer-rating"></strong>
            <p id="trainer-stats"></p>
            ${overview.progress ? '<p>Первая ошибка или открытие решения снижают рейтинг один раз.</p>' : '<button id="trainer-login" class="outline">Войти</button>'}
          </div>
        </aside>
      </div>`;
    for (const [field, options] of [
      ['theme', overview.themes],
      ['level', overview.levels],
    ]) {
      const select = $('trainer-' + field);
      try {
        const saved = localStorage.getItem('dc-puzzle-' + field);
        if (options.some(({ id }) => id === saved)) select.value = saved;
      } catch {}
      select.onchange = startPuzzleTrainingTask;
    }
    session.board = new ChessBoardView($('trainer-board'), {
      piece,
      onClick: puzzleTrainingSquare,
      onPick: (from) => {
        if (!canPlayTraining(session)) return;
        session.selected = from;
        renderPuzzleTrainingBoard();
      },
      canDrag: (from) => {
        if (!canPlayTraining(session)) return false;
        const state = session.replay.positions[session.shown];
        return color(state.b[from]) === state.turn;
      },
      onDrop: (from, to) => {
        session.selected = from;
        puzzleTrainingSquare(to);
      },
    });
    $('trainer-next').onclick = startPuzzleTrainingTask;
    $('trainer-reveal').onclick = () => submitPuzzleTrainingMove({ reveal: true });
    for (const [button, offset] of [
      ['back', -1],
      ['forward', 1],
    ]) {
      $('trainer-' + button).onclick = () => {
        session.shown += offset;
        renderPuzzleTrainingBoard();
      };
    }
    if ($('trainer-login')) $('trainer-login').onclick = () => auth();
    refreshPuzzleTrainingProgress(overview.progress);
    startPuzzleTrainingTask();
  } catch (error) {
    if (puzzleTraining === session && !error.staleSession)
      $('community-page').innerHTML =
        '<div class="page-empty"><h1>Не удалось открыть задачи</h1><p>' +
        escapeHtml(error.message) +
        '</p><a href="/puzzles">Повторить →</a></div>';
  }
}
