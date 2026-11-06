/* Training, move timeline and archive share one legal game record. */
let reviewIndex = null,
  botSide = localStorage.getItem('dc-bot-side') === 'b' ? 'b' : 'w',
  botLevel = [1, 2, 3].includes(Number(localStorage.getItem('dc-bot-level')))
    ? Number(localStorage.getItem('dc-bot-level'))
    : 2,
  botThinking = false,
  botProblem = false,
  botEngineNote = 'Stockfish 19 Lite · репертуар Доктора',
  botMoveSource = '',
  botWorker = null,
  botGeneration = 0,
  hintWorker = null,
  hintMove = null,
  hintKey = '',
  hintGeneration = 0,
  archiveInfo = null,
  localArchiveId = null,
  lineCache = null,
  lineHistory = null,
  lineState = null,
  timelineKey = '';
function currentLine() {
  if (lineHistory === history && lineState === s && lineCache) return lineCache;
  try {
    if (
      lineCache &&
      history.length === lineCache.positions.length &&
      history.every((p, i) => p === lineCache.positions[i])
    ) {
      const previous = lineCache.positions.at(-1),
        record = ChessNotation.infer(previous, s);
      lineCache = {
        positions: [...lineCache.positions, s],
        records: [...lineCache.records, record],
        sans: [...lineCache.sans, ChessNotation.san(previous, record)],
      };
    } else lineCache = ChessNotation.describe(history, s);
  } catch (e) {
    console.warn('Game record', e);
    lineCache = { positions: [s], records: [], sans: [] };
  }
  lineHistory = history;
  lineState = s;
  return lineCache;
}
function shownState() {
  const line = currentLine();
  return reviewIndex === null
    ? s
    : line.positions[Math.max(0, Math.min(reviewIndex, line.positions.length - 1))];
}
function positionKey() {
  const p = shownState();
  return p.b.join(',') + p.turn + p.rights + p.ep;
}
function studyTags() {
  let white =
      archiveInfo?.white ||
      game?.white.username ||
      (mode === 'computer' && botSide === 'b' ? 'DJ Doctor' : user?.username || 'Белые'),
    black =
      archiveInfo?.black ||
      game?.black.username ||
      (mode === 'computer' && botSide === 'w' ? 'DJ Doctor' : 'Чёрные');
  let result = archiveInfo?.result || '*';
  if (game?.result)
    result = game.result === 'draw' ? '1/2-1/2' : game.result === 'w' ? '1-0' : '0-1';
  else if (end(s, history))
    result = !allMoves(s) && check(s, s.turn) ? (s.turn === 'w' ? '0-1' : '1-0') : '1/2-1/2';
  const date = new Date(archiveInfo?.created || game?.created * 1000 || Date.now())
    .toLocaleDateString('sv-SE')
    .replace(/-/g, '.');
  return { White: white, Black: black, Result: result, Date: date };
}
function setReview(n) {
  boardView?.cancel();
  const max = currentLine().records.length;
  reviewIndex = n >= max ? null : Math.max(0, n);
  selected = -1;
  hintMove = null;
  render();
}
function updateTimeline() {
  const line = currentLine(),
    ply = reviewIndex === null ? line.records.length : reviewIndex,
    key = line.sans.join('|') + ':' + ply + ':' + (reviewIndex === null);
  if (key !== timelineKey) {
    timelineKey = key;
    const list = $('moves');
    list.replaceChildren();
    list.classList.toggle('empty-score', !line.sans.length);
    if (!line.sans.length) list.textContent = 'Первые ходы задают ритм.';
    for (let i = 0; i < line.sans.length; i++) {
      const before = line.positions[i];
      if (before.turn === 'w' || i === 0) {
        const number = document.createElement('span');
        number.className = 'move-number';
        number.textContent =
          (before.fullmove || Math.floor(i / 2) + 1) + (before.turn === 'b' ? '…' : '.');
        list.append(number);
        if (before.turn === 'b') {
          const empty = document.createElement('span');
          list.append(empty);
        }
      }
      const button = document.createElement('button');
      button.className = 'move-step' + (ply === i + 1 ? ' selected' : '');
      button.textContent = line.sans[i];
      button.title = 'Позиция после ' + line.sans[i];
      button.onclick = () => setReview(i + 1);
      list.append(button);
    }
    if (reviewIndex === null) list.scrollTop = list.scrollHeight;
  }
  $('review-position').textContent =
    reviewIndex === null
      ? 'Сейчас · ' +
        line.records.length +
        ' ' +
        plural(line.records.length, ['полуход', 'полухода', 'полуходов'])
      : 'Просмотр · ' + ply + ' / ' + line.records.length;
  $('review-first').disabled = ply === 0;
  $('review-prev').disabled = ply === 0;
  $('review-next').disabled = ply >= line.records.length;
  $('review-live').disabled = reviewIndex === null;
}
function updateStudioPanel() {
  const computer = mode === 'computer',
    analysis = mode === 'analysis';
  $('computer').classList.toggle('selected', computer);
  $('bot-settings').hidden = !computer;
  $('bot-level').value = String(botLevel);
  $('bot-side').value = botSide;
  $('bot-side').disabled = busy;
  $('controls').hidden = computer || analysis;
  $('rhythm-label').hidden = computer || analysis;
  document.querySelector('.classical').hidden = computer || analysis;
  if (computer) {
    $('new').textContent = botProblem ? 'Продолжить ход доктора →' : 'Новая партия';
    $('new').disabled = busy || !!learningMatchActive();
    $('queue-note').textContent = botThinking
      ? 'Доктор обдумывает ответ…'
      : 'Можно взять ход назад и попросить подсказку.';
    $('status').textContent = learningMatchActive()
      ? 'Сетевая партия продолжается · тренировка доступна после её завершения'
      : botThinking
        ? 'Доктор думает…'
        : end(s, history) ||
          (s.turn === botSide
            ? moves.length
              ? 'Ваш ход. Без спешки.'
              : 'Вы играете ' + (botSide === 'w' ? 'белыми' : 'чёрными') + '. Сделайте ход.'
            : 'Ход доктора');
    $('undo').disabled =
      busy || !history.length || (history.length === 1 && history[0].turn !== botSide);
  }
  if (analysis) {
    $('new').textContent = 'Выбрать режим для новой партии';
    $('queue-note').textContent = 'Разбор сохранённой партии · кликайте по ходам';
    $('status').textContent =
      'Разбираем партию: ' +
      (archiveInfo?.white || 'Белые') +
      ' — ' +
      (archiveInfo?.black || 'Чёрные');
    $('undo').disabled = true;
  }
  if (reviewIndex !== null)
    $('status').textContent =
      'Просмотр записи. ' +
      (active()
        ? 'Сетевая партия продолжается — вернитесь к текущей позиции.'
        : mode === 'analysis'
          ? 'Выбирайте ходы или используйте стрелки.'
          : 'Вернитесь в текущую позицию, чтобы играть.');
  $('hint').disabled = busy || botThinking || !!learningMatchActive();
  $('hint').title = learningMatchActive()
    ? 'Подсказки доступны после завершения сетевой партии'
    : 'Разбор Stockfish 19 Lite · лучший ход и продолжение';
  $('export-pgn').disabled = !currentLine().records.length;
  $('save-game').disabled = !currentLine().records.length;
  if (hintKey && hintKey !== positionKey()) {
    hintMove = null;
    hintKey = '';
    $('hint-note').textContent = '';
    $('coach-panel').hidden = true;
  }
  for (const square of boardView?.squares || []) {
    square.classList.toggle('hint-from', hintMove?.from === Number(square.dataset.index));
    square.classList.toggle('hint-to', hintMove?.to === Number(square.dataset.index));
  }
  updateTimeline();
  updateWorkbench();
  updateSocialPanel();
  updateOutcome();
  updateGameReport();
  if (computer) {
    $('engine-status').textContent = botEngineNote;
    $('opening-status').textContent =
      botMoveSource ||
      (botSide === 'w'
        ? 'Доктор играет Защиту Доктора: …e6, …h6, …Ke7.'
        : 'Доктор играет Атаку Доктора: e4 и Ke2.');
  }
}
function updateBotPlayers() {
  if (mode !== 'computer' && mode !== 'analysis') return;
  for (const [pos, side] of [
    ['top', flipped ? 'w' : 'b'],
    ['bottom', flipped ? 'b' : 'w'],
  ]) {
    if (mode === 'analysis') {
      $(pos).textContent =
        side === 'w' ? archiveInfo?.white || 'Белые' : archiveInfo?.black || 'Чёрные';
      $(pos + '-meta').textContent = 'Запись партии';
    } else {
      $(pos).textContent = side === botSide ? user?.username || 'Вы' : 'DJ Doctor';
      $(pos + '-meta').textContent =
        side === botSide
          ? 'Учебная партия'
          : botMoveSource.includes('Резервный')
            ? 'Резервный соперник'
            : ['Stockfish · спокойный', 'Stockfish · сильный', 'Stockfish · максимум'][
                botLevel - 1
              ];
    }
    $('clock-' + pos).textContent = '∞';
    $('clock-' + pos).classList.remove('ticking', 'low');
  }
}
function stopStudy() {
  botGeneration++;
  botWorker?.terminate();
  botWorker = null;
  botThinking = false;
  hintWorker?.terminate();
  hintGeneration++;
  hintWorker = null;
  hintMove = null;
  hintKey = '';
  if ($('hint-note')) $('hint-note').textContent = '';
  $('coach-panel').hidden = true;
}
function suspendTrainingForGame() {
  if (!learningMatchActive()) return;
  if (botThinking || botWorker || hintWorker) stopStudy();
  if (reportRunning) cancelGameReport();
}
function enginePosition() {
  const line = currentLine();
  return (
    'position fen ' +
    ChessNotation.fen(line.positions[0]) +
    (line.records.length
      ? ' moves ' +
        line.records
          .map((m, i) =>
            DoctorEngine.uci({
              ...m,
              promotes:
                line.positions[i].b[m.from].toLowerCase() === 'p' && (m.to < 8 || m.to >= 56),
            })
          )
          .join(' ')
      : '')
  );
}
function scheduleBot() {
  if (
    learningMatchActive() ||
    mode !== 'computer' ||
    s.turn === botSide ||
    end(s, history) ||
    botThinking ||
    busy
  )
    return;
  botThinking = true;
  botProblem = false;
  const generation = ++botGeneration,
    board = s;
  render();
  try {
    const book = DoctorBook.lookup(board);
    const onMove = async (e) => {
      if (generation !== botGeneration) return;
      const data = e.data;
      botWorker?.terminate();
      botWorker = null;
      botThinking = false;
      if (mode !== 'computer' || s !== board) return;
      if (data.error || !data.move) {
        botProblem = true;
        render();
        toast('Доктор не смог выбрать ход. Нажмите «Продолжить».');
        $('new').textContent = 'Продолжить';
        return;
      }
      const m = data.move;
      if (color(s.b[m.from]) !== s.turn || !legal(s, m.from).includes(m.to)) {
        botProblem = true;
        render();
        toast('Не удалось подтвердить ход компьютера');
        return;
      }
      botEngineNote = data.engine || 'Дебютная книга Доктора';
      botMoveSource =
        data.source === 'book'
          ? data.title + ' · стр. ' + data.page
          : data.source === 'fallback'
            ? 'Резервный соперник · Stockfish недоступен'
            : data.source === 'plan'
              ? 'Продолжает построение Доктора · расчёт Stockfish'
              : 'Вне книжной линии · тактический расчёт Stockfish';
      await makeMove(m.from, m.to, m.promotion);
    };
    if (book) {
      botEngineNote = 'Ход из учебника Доктора';
      queueMicrotask(() => onMove({ data: book }));
      return;
    }
    botEngineNote = 'Stockfish 19 Lite · рассчитывает позицию…';
    botWorker?.terminate();
    botWorker = new DoctorEngine();
    botWorker.onmessage = onMove;
    botWorker.onerror = () => {
      if (generation !== botGeneration) return;
      // Stay playable offline/on unsupported WASM devices; never label fallback Stockfish.
      botWorker?.terminate();
      botEngineNote = 'Stockfish недоступен · резервный соперник';
      botWorker = new Worker('/doctor-worker.js');
      botWorker.onmessage = (e) =>
        onMove({ data: { ...e.data, engine: 'Учебный движок', source: 'fallback' } });
      botWorker.onerror = () => {
        stopStudy();
        botProblem = true;
        render();
        toast('Движок недоступен. Нажмите «Продолжить».');
      };
      botWorker.postMessage({
        id: generation,
        state: board,
        options: { level: 3, budgetMs: 1800, searchmoves: DoctorBook.candidates(board) },
      });
      render();
    };
    botWorker.postMessage({
      id: generation,
      state: board,
      line: enginePosition(),
      options: {
        level: botLevel,
        budgetMs: [500, 1400, 3000][botLevel - 1],
        searchmoves: DoctorBook.candidates(board),
      },
    });
  } catch {
    stopStudy();
    botProblem = true;
    render();
    toast('Этот браузер не поддерживает учебный движок');
  }
}
function askHint() {
  if (learningMatchActive() || botThinking || busy) return;
  hintWorker?.terminate();
  const request = ++hintGeneration;
  const board = shownState(),
    key = positionKey();
  $('hint-note').textContent = 'Посмотрим на позицию вместе…';
  hintWorker = new DoctorEngine();
  hintWorker.onmessage = (e) => {
    if (request !== hintGeneration) return;
    hintWorker?.terminate();
    hintWorker = null;
    if (key !== positionKey()) return;
    const d = e.data;
    if (d.error || !d.move) {
      $('hint-note').textContent = 'В этой позиции больше нет ходов.';
      return;
    }
    hintMove = d.move;
    hintKey = key;
    const san = ChessNotation.san(board, d.move);
    $('hint-note').textContent =
      'Попробуйте ' +
      san +
      '. ' +
      (d.type === 'mate'
        ? (d.score > 0 ? 'Белые' : 'Чёрные') + ' ставят мат при лучшей игре.'
        : 'Оценка за белых: ' + (d.score >= 0 ? '+' : '') + (d.score / 100).toFixed(1));
    showCoachLine(board, d);
    render();
  };
  hintWorker.onerror = () => {
    if (request !== hintGeneration) return;
    hintWorker?.terminate();
    hintWorker = null;
    $('hint-note').textContent = 'Подсказка недоступна. Попробуйте ещё раз.';
  };
  hintWorker.postMessage({
    id: 1,
    state: board,
    options: { level: 3, budgetMs: 1800 },
  });
}
function showCoachLine(position, data) {
  let state = position;
  const sans = [];
  for (const text of (data.pv || []).slice(0, 8)) {
    const move = DoctorEngine.move(text);
    if (
      !move ||
      color(state.b[move.from]) !== state.turn ||
      !legal(state, move.from).includes(move.to)
    )
      break;
    sans.push(
      (state.turn === 'w' ? state.fullmove + '. ' : sans.length ? '' : state.fullmove + '… ') +
        ChessNotation.san(state, move)
    );
    state = apply(state, move.from, move.to, move.promotion);
  }
  $('coach-panel').hidden = false;
  $('coach-score').textContent =
    data.type === 'mate'
      ? (data.score > 0 ? 'Белые' : 'Чёрные') + ': мат в ' + Math.abs(data.score)
      : (data.score >= 0 ? '+' : '') + (data.score / 100).toFixed(1);
  $('coach-line').textContent = sans.join('  ') || 'Продолжение недоступно';
  $('coach-depth').textContent = 'Stockfish 19 Lite · глубина ' + data.depth + ' · оценка за белых';
  $('coach-fill').style.width =
    (data.type === 'mate' ? (data.score > 0 ? 100 : 0) : 100 / (1 + Math.exp(-data.score / 350))) +
    '%';
}
function exportPGN() {
  const content = ChessNotation.pgn(currentLine(), studyTags()),
    blob = new Blob([content], { type: 'application/x-chess-pgn;charset=utf-8' }),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = 'doctor-chess-' + new Date().toLocaleDateString('sv-SE') + '.pgn';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let damagedLocalGames = 0;
function savedGames() {
  damagedLocalGames = 0;
  try {
    const x = JSON.parse(localStorage.getItem('dc-library') || '[]');
    if (!Array.isArray(x)) throw Error('library');
    return x.filter((g) => {
      const valid =
        g &&
        typeof g.id === 'string' &&
        Number.isFinite(g.created) &&
        g.tags &&
        ['White', 'Black', 'Result'].every((k) => typeof g.tags[k] === 'string') &&
        Array.isArray(g.positions) &&
        g.positions.length > 0 &&
        g.positions.every(
          (p) =>
            p &&
            Array.isArray(p.b) &&
            p.b.length === 64 &&
            p.b.every((piece) => piece === null || /^[kqrbnpKQRBNP]$/.test(piece)) &&
            p.b.filter((piece) => piece === 'K').length === 1 &&
            p.b.filter((piece) => piece === 'k').length === 1 &&
            ['w', 'b'].includes(p.turn) &&
            typeof p.rights === 'string' &&
            Number.isInteger(p.ep) &&
            Number.isInteger(p.half)
        );
      if (!valid) damagedLocalGames++;
      return valid;
    });
  } catch {
    damagedLocalGames = 1;
    return [];
  }
}
function archiveCurrent(quiet = false) {
  if (
    (!currentLine().records.length && ChessNotation.fen(s) === ChessNotation.fen(initial())) ||
    mode === 'puzzle' ||
    game
  )
    return;
  if (!localArchiveId) localArchiveId = crypto.randomUUID();
  const list = savedGames(),
    record = {
      id: localArchiveId,
      created: Date.now(),
      tags: studyTags(),
      positions: currentLine().positions,
      mode,
      botLevel,
      botSide,
    };
  const old = list.findIndex((g) => g.id === record.id);
  if (old >= 0) list.splice(old, 1);
  list.unshift(record);
  try {
    localStorage.setItem('dc-library', JSON.stringify(list.slice(0, 40)));
    if (!quiet) toast('Партия сохранена в «Мои партии» на этом устройстве');
  } catch {
    if (!quiet) toast('Не хватает места. Скачайте PGN партии.');
  }
}
function exportLocalGame(record) {
  try {
    const line = ChessNotation.describe(record.positions.slice(0, -1), record.positions.at(-1));
    const url = URL.createObjectURL(
      new Blob([ChessNotation.pgn(line, record.tags)], {
        type: 'application/x-chess-pgn;charset=utf-8',
      })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'doctor-chess-local.pgn';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    toast('Не удалось экспортировать повреждённую запись');
  }
}
async function openLibrary() {
  const local = savedGames();
  show(
    'Партии, к которым возвращаемся.',
    `<p class="muted">Сетевые партии хранятся в профиле. В этом браузере — до 40 домашних записей; при сохранении 41-й самая старая заменяется. Экспортируйте важные партии в PGN.</p>
    <h3 class="library-label">На этом устройстве · ${local.length} / 40</h3>
    ${damagedLocalGames ? '<p role="status">Есть повреждённые записи: они пропущены. Исправные партии доступны ниже.</p>' : ''}
    <div class="library-list">${local.length ? local.map((g, i) => `<div class="local-library-row"><button data-open-local="${i}"><span>${escapeHtml(g.tags.White)} — ${escapeHtml(g.tags.Black)}<small>${new Date(g.created).toLocaleDateString('ru-RU')} · ${g.positions.length - 1} ${plural(g.positions.length - 1, ['полуход', 'полухода', 'полуходов'])}</small></span><b>${escapeHtml(g.tags.Result)}</b></button><button data-export-local="${i}" aria-label="Экспорт партии в PGN">PGN ↓</button></div>`).join('') : '<p>Сохраните тренировку кнопкой под записью ходов.</p><button id="library-train">Начать тренировку</button>'}</div>
    <h3 class="library-label">Сетевые партии</h3><div class="library-list" id="library-online"></div>
    <p id="library-status" role="status"></p><button id="library-more" hidden>Показать ещё</button>`
  );
  document
    .querySelectorAll('[data-open-local]')
    .forEach((b) => (b.onclick = () => openLocalReview(local[Number(b.dataset.openLocal)].id)));
  document
    .querySelectorAll('[data-export-local]')
    .forEach((b) => (b.onclick = () => exportLocalGame(local[Number(b.dataset.exportLocal)])));
  if (!local.length)
    $('library-train').onclick = async () => {
      $('modal').close();
      navigate('/');
      await changeMode('computer');
      openPracticeRoom();
    };
  const container = $('library-online'),
    status = $('library-status'),
    more = $('library-more');
  if (!user) {
    status.textContent = 'Войдите в профиль, чтобы увидеть сетевые партии.';
    return;
  }
  const username = user.username;
  let page = 1;
  const games = new Map();
  async function loadPage() {
    more.disabled = true;
    status.textContent = 'Загружаем партии…';
    try {
      const player = (await api('players/' + encodeURIComponent(username) + '?page=' + page))
        .player;
      if ($('library-online') !== container || !$('modal').open) return;
      for (const g of player.games) games.set(g.id, g);
      container.innerHTML = [...games.values()]
        .map(
          (g) =>
            `<a href="/review/${encodeURIComponent(g.id)}"><span>С ${escapeHtml(g.opponent.username)}<small>${escapeHtml(g.control)} · ${dateLabel(g.created)}</small></span><b>${{ win: 'Победа', draw: 'Ничья', loss: 'Поражение' }[g.result]}</b></a>`
        )
        .join('');
      page++;
      status.textContent = games.size
        ? `Показано ${games.size} из ${player.total_games}`
        : 'Завершённых сетевых партий пока нет.';
      more.hidden = games.size >= player.total_games || !player.games.length;
      more.textContent = 'Показать ещё';
    } catch {
      if ($('library-online') !== container || !$('modal').open) return;
      status.textContent =
        'Не удалось загрузить партии. Уже загруженные записи сохранены в списке.';
      more.hidden = false;
      more.textContent = 'Повторить загрузку';
    } finally {
      more.disabled = false;
    }
  }
  more.onclick = loadPage;
  await loadPage();
}
async function openLocalReview(id) {
  if (learningMatchActive() || busy)
    return toast('Завершите свою сетевую партию, чтобы открыть разбор.');
  const r = savedGames().find((g) => g.id === id);
  if (!r) return;
  try {
    ChessNotation.describe(r.positions.slice(0, -1), r.positions.at(-1));
    navigate('/');
    await changeMode('analysis');
    archiveInfo = {
      white: r.tags.White,
      black: r.tags.Black,
      result: r.tags.Result,
      created: r.created,
    };
    history = r.positions.slice(0, -1);
    s = r.positions.at(-1);
    moves = currentLine().sans;
    reviewIndex = 0;
    flipped = false;
    openPracticeRoom();
    render();
  } catch {
    toast('Не удалось прочитать запись партии');
  }
}
async function loadReviewGame(id) {
  const request = typeof communityRequest === 'undefined' ? null : communityRequest,
    path = typeof location === 'undefined' ? null : location.pathname,
    current = () =>
      (request === null || request === communityRequest) &&
      (path === null || path === location.pathname);
  if (typeof learningMatchActive === 'function' && learningMatchActive()) {
    toast('Завершите свою сетевую партию, чтобы открыть разбор.');
    navigate('/');
    return;
  }
  try {
    const data = await api('games/' + encodeURIComponent(id));
    if (!current()) return;
    if (learningMatchActive() || busy)
      throw Error('Сначала завершите сетевую партию или дождитесь подтверждения хода.');
    const g = data.game,
      line = ChessNotation.replay(initial(), g.moves);
    await changeMode('analysis');
    if (!current()) return;
    archiveInfo = {
      white: g.white,
      black: g.black,
      result: g.result === 'draw' ? '1/2-1/2' : g.result === 'w' ? '1-0' : '0-1',
      created: g.created * 1000,
    };
    history = line.positions.slice(0, -1);
    s = line.positions.at(-1);
    moves = line.sans;
    reviewIndex = 0;
    flipped = false;
    displayRoom('Разбор партии');
    communityNav('nav-play');
    document.title = 'Разбор партии · Doctor Chess';
    render();
  } catch (e) {
    if (!current()) return;
    toast(e.message);
    navigate('/');
  }
}
function restartBotColor(side) {
  if (mode !== 'computer' || !['w', 'b'].includes(side)) return;
  const seed = JSON.parse(JSON.stringify(currentLine().positions[0]));
  if (history.length) archiveCurrent(true);
  stopStudy();
  resetBoard();
  botSide = side;
  localStorage.setItem('dc-bot-side', side);
  s = seed;
  flipped = side === 'b';
  archiveInfo = {
    white: side === 'w' ? user?.username || 'Вы' : 'DJ Doctor',
    black: side === 'b' ? user?.username || 'Вы' : 'DJ Doctor',
    result: '*',
    created: Date.now(),
  };
  lineCache = null;
  render();
  scheduleBot();
}
function requestBotColor(side) {
  $('bot-side').value = botSide;
  if (busy || side === botSide || !['w', 'b'].includes(side)) return;
  if (!moves.length && !botThinking) return restartBotColor(side);
  show(
    side === 'b' ? 'Новую тренировку чёрными?' : 'Новую тренировку белыми?',
    `<p>Текущая тренировка сохранится в «Мои партии». Новая начнётся с её стартовой позиции, а вы сыграете ${side === 'b' ? 'чёрными' : 'белыми'}.</p><button class="primary" id="confirm-color">Сохранить и начать ${side === 'b' ? 'чёрными' : 'белыми'}</button><button class="form-switch" id="cancel-color">Продолжить текущую тренировку</button>`
  );
  $('confirm-color').onclick = () => {
    $('modal').close();
    restartBotColor(side);
  };
  $('cancel-color').onclick = () => $('modal').close();
}
function initializeStudio() {
  initializeOutcome();
  initializeGameReport();
  $('engine-credits').onclick = () =>
    show(
      'Движок на хорошей волне.',
      '<p>DJ Doctor использует неизменённую сборку Stockfish.js 19.0.1 Lite Single (GPLv3). Авторы: команда Stockfish, Nathan Rugg, Chess.com и участники проекта.</p><p><a href="/vendor/stockfish/Copying.txt" target="_blank" rel="noopener">Лицензия GNU GPLv3 ↗</a></p><p><a href="/vendor/stockfish/source-19.0.1.zip" download>Соответствующий исходный код и скрипты сборки ↓</a></p><p><a href="/vendor/stockfish/nn-61e7af4bb97d.nnue" download>Нейросеть Lite для сборки ↓</a></p><p><a href="https://github.com/nmrugg/stockfish.js/tree/0d5dd7944f88c817c07a26bc4fb1905d5f9c46d6" target="_blank" rel="noopener">Проект Stockfish.js ↗</a></p><p>Дебютный репертуар и учебная мастерская основаны на книге DJ Doctor «Атака Доктора и Защита Доктора», 2026.</p>'
    );
  $('doctor-academy').onclick = () => navigate('/academy');
  $('nav-academy').onclick = () => navigate('/academy');
  initializeWorkbench();
  initializeSocial();
  $('computer').onclick = () => changeMode('computer');
  $('nav-library').onclick = openLibrary;
  $('hint').onclick = askHint;
  $('export-pgn').onclick = exportPGN;
  $('save-game').onclick = () =>
    game ? toast('Сетевая партия сохраняется автоматически.') : archiveCurrent();
  $('review-first').onclick = () => setReview(0);
  $('review-prev').onclick = () => setReview((reviewIndex ?? currentLine().records.length) - 1);
  $('review-next').onclick = () => setReview((reviewIndex ?? currentLine().records.length) + 1);
  $('review-live').onclick = () => setReview(currentLine().records.length);
  $('bot-level').onchange = () => {
    botLevel = Number($('bot-level').value);
    localStorage.setItem('dc-bot-level', String(botLevel));
    stopStudy();
    render();
    scheduleBot();
  };
  $('bot-side').onchange = () => requestBotColor($('bot-side').value);
  document.addEventListener('keydown', (e) => {
    if (
      $('game-page').hidden ||
      $('modal').open ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)
    )
      return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setReview((reviewIndex ?? currentLine().records.length) - 1);
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setReview((reviewIndex ?? currentLine().records.length) + 1);
    }
  });
}
