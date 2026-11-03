/* Training, move timeline and archive share one legal game record. */
let reviewIndex = null,
  botSide = localStorage.getItem('dc-bot-side') === 'b' ? 'b' : 'w',
  botLevel = [1, 2, 3].includes(Number(localStorage.getItem('dc-bot-level')))
    ? Number(localStorage.getItem('dc-bot-level'))
    : 2,
  botThinking = false,
  botWorker = null,
  botGeneration = 0,
  hintWorker = null,
  hintMove = null,
  hintKey = '',
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
    result = check(s, s.turn) ? (s.turn === 'w' ? '0-1' : '1-0') : '1/2-1/2';
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
    $('new').textContent = moves.length ? 'Новая тренировка ↗' : 'Начать тренировку ↗';
    $('new').disabled = busy;
    $('queue-note').textContent = botThinking
      ? 'Доктор обдумывает ответ…'
      : 'Можно взять ход назад и попросить подсказку.';
    $('status').textContent = botThinking
      ? 'Доктор думает…'
      : end(s, history) || (s.turn === botSide ? 'Ваш ход. Без спешки.' : 'Ход доктора');
    $('undo').disabled = busy || !history.length || (history.length === 1 && botSide === 'b');
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
  $('hint').disabled = busy || botThinking || !!active();
  $('hint').title = active()
    ? 'Подсказки доступны после завершения рейтинговой партии'
    : 'Учебная оценка локального движка';
  $('export-pgn').disabled = !currentLine().records.length;
  $('save-game').disabled = !currentLine().records.length;
  if (hintKey && hintKey !== positionKey()) {
    hintMove = null;
    hintKey = '';
    $('hint-note').textContent = '';
  }
  for (const square of boardView?.squares || []) {
    square.classList.toggle('hint-from', hintMove?.from === Number(square.dataset.index));
    square.classList.toggle('hint-to', hintMove?.to === Number(square.dataset.index));
  }
  updateTimeline();
  updateWorkbench();
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
          : ['Знакомство · мягкий ритм', 'Партнёр · средний ритм', 'Собранный · внимательная игра'][
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
  hintWorker = null;
  hintMove = null;
  hintKey = '';
  if ($('hint-note')) $('hint-note').textContent = '';
}
function scheduleBot() {
  if (mode !== 'computer' || s.turn === botSide || end(s, history) || botThinking || busy) return;
  botThinking = true;
  const generation = ++botGeneration,
    board = s;
  render();
  try {
    botWorker = new Worker('/doctor-worker.js');
    botWorker.onmessage = async (e) => {
      if (generation !== botGeneration) return;
      const data = e.data;
      botWorker?.terminate();
      botWorker = null;
      botThinking = false;
      if (mode !== 'computer' || s !== board) return;
      if (data.error || !data.move) {
        toast('Доктор не смог выбрать ход. Нажмите «Продолжить».');
        $('new').textContent = 'Продолжить';
        return;
      }
      const m = data.move;
      if (color(s.b[m.from]) !== s.turn || !legal(s, m.from).includes(m.to)) {
        toast('Не удалось подтвердить ход компьютера');
        return;
      }
      await makeMove(m.from, m.to, m.promotion);
    };
    botWorker.onerror = () => {
      if (generation !== botGeneration) return;
      stopStudy();
      render();
      toast('Не удалось запустить компьютер. Обновите страницу.');
    };
    botWorker.postMessage({
      id: generation,
      state: board,
      options: { level: botLevel, budgetMs: [250, 850, 1800][botLevel - 1] },
    });
  } catch {
    stopStudy();
    render();
    toast('Этот браузер не поддерживает учебный движок');
  }
}
function askHint() {
  if (active() || botThinking || busy) return;
  hintWorker?.terminate();
  const board = shownState(),
    key = positionKey();
  $('hint-note').textContent = 'Посмотрим на позицию вместе…';
  hintWorker = new Worker('/doctor-worker.js');
  hintWorker.onmessage = (e) => {
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
      ' · учебная оценка ' +
      (d.score >= 0 ? '+' : '') +
      (d.score / 100).toFixed(1) +
      ' за белых';
    render();
  };
  hintWorker.onerror = () => {
    $('hint-note').textContent = 'Подсказка недоступна. Попробуйте ещё раз.';
  };
  hintWorker.postMessage({
    id: 1,
    state: board,
    options: { level: 3, budgetMs: 1200, maxDepth: 3 },
  });
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
function savedGames() {
  try {
    const x = JSON.parse(localStorage.getItem('dc-library') || '[]');
    return Array.isArray(x) ? x : [];
  } catch {
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
async function openLibrary() {
  let online = [];
  if (user)
    try {
      online = (await api('players/' + encodeURIComponent(user.username))).player.games;
    } catch {}
  const local = savedGames();
  show(
    'Партии, к которым возвращаемся.',
    `<p class="muted">Домашние записи хранятся в этом браузере. Сетевые — в вашем профиле.</p><h3 class="library-label">На этом устройстве</h3><div class="library-list">${local.length ? local.map((g) => `<button data-open-local="${g.id}"><span>${escapeHtml(g.tags.White)} — ${escapeHtml(g.tags.Black)}<small>${new Date(g.created).toLocaleDateString('ru-RU')} · ${g.positions.length - 1} ${plural(g.positions.length - 1, ['полуход', 'полухода', 'полуходов'])}</small></span><b>${escapeHtml(g.tags.Result)} ↗</b></button>`).join('') : '<p>Сохраните тренировку или домашнюю партию кнопкой под записью ходов.</p>'}</div><h3 class="library-label">Сетевые партии</h3><div class="library-list">${online.length ? online.map((g) => `<a href="/review/${g.id}"><span>С ${escapeHtml(g.opponent.username)}<small>${g.control} · ${dateLabel(g.created)}</small></span><b>${{ win: 'Победа', draw: 'Ничья', loss: 'Поражение' }[g.result]} ↗</b></a>`).join('') : '<p>Завершённые сетевые партии появятся здесь после игры.</p>'}</div>`
  );
  document
    .querySelectorAll('[data-open-local]')
    .forEach((b) => (b.onclick = () => openLocalReview(b.dataset.openLocal)));
}
async function openLocalReview(id) {
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
    render();
  } catch {
    toast('Не удалось прочитать запись партии');
  }
}
async function loadReviewGame(id) {
  try {
    const data = await api('games/' + encodeURIComponent(id)),
      g = data.game,
      line = ChessNotation.replay(initial(), g.moves);
    await changeMode('analysis');
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
    $('game-page').hidden = false;
    $('community-page').hidden = true;
    communityNav('nav-play');
    document.title = 'Разбор партии · Doctor Chess';
    render();
  } catch (e) {
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
  initializeWorkbench();
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
