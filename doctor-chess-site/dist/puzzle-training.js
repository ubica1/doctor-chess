let puzzleTraining = null;

function closePuzzleTraining() {
  if (!puzzleTraining) return;
  clearTimeout(puzzleTraining.replyTimer);
  stopPuzzleEvaluation(puzzleTraining);
  puzzleTraining.board?.destroy();
  puzzleTraining = null;
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
  $('trainer-reveal').disabled = blocked || session.busy || session.shown !== session.task?.step;
  $('trainer-review').hidden = !session.task;
  $('trainer-theme').disabled = session.busy;
  $('trainer-level').disabled = session.busy;
  $('trainer-first').disabled = $('trainer-back').disabled = session.busy || session.shown === 0;
  $('trainer-last').disabled = $('trainer-forward').disabled =
    session.busy || session.shown === session.task?.step;
  $('trainer-evaluate').hidden = !finished;
  $('trainer-evaluate').disabled = blocked || session.busy;
  $('trainer-evaluate').setAttribute('aria-pressed', String(!!session.evaluate && !blocked));
  $('trainer-evaluation').hidden = !finished || !session.evaluate || blocked;
  if (blocked) {
    stopPuzzleEvaluation(session);
    session.evaluate = false;
  }
  for (const button of $('trainer-line').children) {
    button.disabled = session.busy;
    if (Number(button.dataset.ply) === session.shown) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
}

function renderPuzzleTrainingBoard() {
  const session = puzzleTraining;
  const position = session.replay.positions[session.shown],
    last = session.replay.records[session.shown - 1] || session.lead,
    checked = check(position, position.turn)
      ? position.b.indexOf(position.turn === 'w' ? 'K' : 'k')
      : -1;
  const ended = checked >= 0 && !allMoves(position);
  session.board.render(
    position,
    session.replay.positions[0].turn === 'b',
    session.selected,
    session.selected >= 0 ? legal(position, session.selected) : [],
    last ? [last.from, last.to] : [],
    checked,
    ended ? checked : -1
  );
  const correct = session.shown % 2 === 1 && session.shown <= session.accepted;
  const verdict = session.wrongMove || (correct ? last : null);
  session.badge.hidden = !verdict;
  if (verdict) {
    const tone = session.wrongMove ? 'wrong' : 'correct';
    for (const square of [verdict.from, verdict.to])
      session.board.squares[session.board.flipped ? 63 - square : square].classList.add(
        'trainer-' + tone
      );
    const { x, y } = session.board.position(verdict.to);
    session.badge.dataset.tone = tone;
    session.badge.textContent = tone === 'correct' ? '✓' : '×';
    session.badge.style.left = (x + 1) * 12.5 + '%';
    session.badge.style.top = y * 12.5 + '%';
  }
  const ply = session.shown
    ? 'Ход ' + session.shown + ' из ' + session.task.step
    : 'Начальная позиция';
  const turn = position.turn === 'w' ? 'Ход белых' : 'Ход чёрных';
  const reviewing = session.shown < session.task.step && !session.busy;
  $('trainer-position').textContent =
    ply +
    ' · ' +
    (ended ? 'Мат' : turn) +
    (correct ? ' · Верный ход' : '') +
    (reviewing && session.task.state === 'active'
      ? ' · Чтобы играть, вернитесь к последнему ходу'
      : '');
  updatePuzzleTrainingSafety();
}

function selectPuzzlePly(ply) {
  const session = puzzleTraining;
  if (!session?.task || session.busy || ply < 0 || ply > session.task.step || ply === session.shown)
    return;
  session.shown = ply;
  session.selected = -1;
  session.wrongMove = null;
  renderPuzzleTrainingBoard();
  refreshPuzzleEvaluation(session);
}

function renderPuzzleLine(session) {
  $('trainer-line').replaceChildren(
    ...session.replay.sans.map((san, i) => {
      const before = session.replay.positions[i];
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.ply = i + 1;
      button.textContent = before.fullmove + (before.turn === 'w' ? '. ' : '… ') + san;
      button.onclick = () => selectPuzzlePly(i + 1);
      return button;
    })
  );
}

function stopPuzzleEvaluation(session) {
  clearTimeout(session.evaluationTimer);
  session.worker?.terminate();
  session.worker = null;
}

function refreshPuzzleEvaluation(session) {
  stopPuzzleEvaluation(session);
  if (!session.evaluate || session.task.state === 'active' || learningMatchActive()) return;
  const ply = session.shown;
  const state = session.replay.positions[ply];
  const output = $('trainer-evaluation');
  const saved = session.evaluations.get(ply);
  if (saved) {
    output.textContent = saved;
    return;
  }
  const result = end(state, session.replay.positions.slice(0, ply));
  if (result) {
    output.textContent = result;
    return;
  }
  output.textContent = 'Stockfish считает позицию…';
  session.evaluationTimer = setTimeout(() => {
    if (puzzleTraining !== session || !session.evaluate || learningMatchActive()) return;
    const unavailable = 'Не удалось оценить позицию. Выключите и снова включите оценку.';
    let worker;
    try {
      worker = session.worker = new DoctorEngine();
    } catch {
      output.textContent = unavailable;
      return;
    }
    const isCurrent = () =>
      puzzleTraining === session &&
      session.worker === worker &&
      session.shown === ply &&
      session.evaluate &&
      !learningMatchActive();
    worker.onerror = () => {
      if (!isCurrent()) return;
      stopPuzzleEvaluation(session);
      output.textContent = unavailable;
    };
    worker.onmessage = ({ data }) => {
      if (!isCurrent()) return;
      stopPuzzleEvaluation(session);
      const score =
        data.type === 'mate'
          ? 'Мат в ' + Math.abs(data.score) + (data.score > 0 ? ' за белых' : ' за чёрных')
          : (data.score > 0 ? '+' : '') + (data.score / 100).toFixed(2) + ' за белых';
      let best = '';
      if (data.move && legal(state, data.move.from).includes(data.move.to))
        best = ' · лучший ход ' + ChessNotation.san(state, data.move);
      const text = score + best + ' · глубина ' + data.depth;
      session.evaluations.set(ply, text);
      output.textContent = text;
    };
    worker.postMessage({
      id: ply,
      state,
      line:
        'position fen ' +
        session.task.fen +
        (ply ? ' moves ' + session.task.moves.slice(0, ply).join(' ') : ''),
      options: { level: 3, budgetMs: 650 },
    });
  }, 160);
}

function refreshPuzzleTrainingProgress(progress) {
  $('trainer-rating').textContent = progress ? progress.rating : '—';
  $('trainer-stats').textContent = progress
    ? `Самостоятельно решено ${progress.wins} из ${progress.played}`
    : 'Войдите, чтобы сохранять рейтинг и прогресс.';
}

function showPuzzleTask(session, task, attemptedMove) {
  const oldStep = session.task?.step;
  const replay = ChessNotation.replay(
    ChessNotation.fromFEN(task.fen),
    task.moves.map(DoctorEngine.move)
  );
  Object.assign(session, {
    task,
    replay,
    lead: DoctorEngine.move(task.lead),
    selected: -1,
    shown: task.step,
    accepted: task.state === 'revealed' ? (oldStep ?? 0) : task.step,
    wrongMove: task.feedback === 'wrong' ? DoctorEngine.move(attemptedMove) : null,
  });
  const finished = task.state !== 'active';
  $('trainer-board-shell').hidden = false;
  $('trainer-turn').textContent = 'Задача · ' + task.rating;
  $('trainer-source').hidden = !finished;
  if (finished) {
    $('trainer-source').href = task.game;
    $('trainer-motifs').textContent = task.themes.join(' · ');
  }
  if (oldStep !== task.step) renderPuzzleLine(session);
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
  if (attemptedMove && !finished && task.step === oldStep + 2) {
    session.shown = oldStep + 1;
    $('trainer-feedback').textContent = 'Соперник отвечает…';
    renderPuzzleTrainingBoard();
    session.replyTimer = setTimeout(() => {
      if (puzzleTraining !== session) return;
      session.shown = task.step;
      session.busy = false;
      $('trainer-feedback').textContent = 'Найдите продолжение.';
      renderPuzzleTrainingBoard();
    }, 570);
    return true;
  }
  $('trainer-feedback').textContent = feedback();
  renderPuzzleTrainingBoard();
  return false;
}

async function startPuzzleTrainingTask() {
  const session = puzzleTraining;
  if (!session?.board || session.busy) return;
  stopPuzzleEvaluation(session);
  session.evaluate = false;
  session.evaluations.clear();
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
  return (
    session?.task?.state === 'active' &&
    session.shown === session.task.step &&
    !session.busy &&
    !learningMatchActive()
  );
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
    if (puzzleTraining === session) animating = showPuzzleTask(session, task, data.move);
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
    session.wrongMove = null;
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
  const session = (puzzleTraining = { shown: 0, selected: -1, evaluations: new Map() });
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
        </section>
        <aside class="notebook-paper">
          <h2 id="trainer-turn">Тактическая тренировка</h2>
          <p id="trainer-feedback" role="status"></p>
          <p id="trainer-blocked" role="status" hidden>Вернитесь к тренировке после завершения сетевой партии.</p>
          <p id="trainer-score"></p>
          <div class="study-board-tools">
            <button id="trainer-reveal" hidden>Показать решение</button><button id="trainer-next">Следующая задача →</button>
          </div>
          <div id="trainer-review" hidden>
            <div class="study-board-tools">
              <button id="trainer-first" aria-label="Начальная позиция">|‹</button>
              <button id="trainer-back" aria-label="Предыдущий ход" aria-keyshortcuts="ArrowLeft">←</button>
              <button id="trainer-forward" aria-label="Следующий ход" aria-keyshortcuts="ArrowRight">→</button>
              <button id="trainer-last" aria-label="Последний ход">›|</button>
            </div>
            <p id="trainer-position" role="status"></p>
            <div id="trainer-line" class="study-board-tools" role="group" aria-label="Ходы задачи"></div>
            <button id="trainer-evaluate" class="outline" aria-pressed="false" hidden>Оценка Stockfish</button>
            <p id="trainer-evaluation" class="study-evaluation" role="status" hidden></p>
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
        session.wrongMove = null;
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
    session.badge = document.createElement('span');
    session.badge.className = 'trainer-verdict';
    session.badge.setAttribute('aria-hidden', 'true');
    session.badge.hidden = true;
    $('trainer-board').append(session.badge);
    $('trainer-next').onclick = startPuzzleTrainingTask;
    $('trainer-reveal').onclick = () => submitPuzzleTrainingMove({ reveal: true });
    $('trainer-first').onclick = () => selectPuzzlePly(0);
    $('trainer-back').onclick = () => selectPuzzlePly(session.shown - 1);
    $('trainer-forward').onclick = () => selectPuzzlePly(session.shown + 1);
    $('trainer-last').onclick = () => selectPuzzlePly(session.task.step);
    $('trainer-evaluate').onclick = () => {
      if (session.task.state === 'active' || learningMatchActive()) return;
      session.evaluate = !session.evaluate;
      updatePuzzleTrainingSafety();
      refreshPuzzleEvaluation(session);
    };
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

document.addEventListener('keydown', (event) => {
  const session = puzzleTraining;
  if (
    !session?.task ||
    session.busy ||
    $('modal').open ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.target.closest?.('input, textarea, select, [contenteditable]')
  )
    return;
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  selectPuzzlePly(session.shown + (event.key === 'ArrowLeft' ? -1 : 1));
});
