/* Spectator boards are isolated from the player's live game and never run an engine. */
let watching = null,
  watchGeneration = 0,
  watchConsentBusy = false;
function stopWatching() {
  watchGeneration++;
  if (watching) {
    clearInterval(watching.pollTimer);
    clearInterval(watching.clockTimer);
    watching.board?.destroy();
  }
  watching = null;
}
function watchingCurrent(session) {
  return watching === session && session.generation === watchGeneration;
}
function watchClock(seconds) {
  const value = Math.max(0, Math.ceil(seconds));
  return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
}
async function loadWatchHall() {
  communityShell();
  communityNav('nav-watch');
  document.title = 'Зрительный зал · Doctor Chess';
  const session = (watching = {
    generation: watchGeneration,
    kind: 'hall',
    busy: false,
    filter: 'all',
    games: [],
  });
  $('community-page').innerHTML =
    '<section class="workspace-heading"><span class="workspace-seal">观</span><div><p>ЗРИТЕЛЬНЫЙ ЗАЛ</p><h1>У каждой доски — своя история.</h1><p>Живые рейтинговые партии, открытые обоими игроками. Дружеские встречи смотрят по личной ссылке.</p></div></section><div class="watch-hall-tools"><label for="watch-filter">Контроль</label><select id="watch-filter"><option value="all">Все контроли</option>' +
    ['1+0', '3+0', '3+2', '5+0', '10+0', '15+10', '30+0']
      .map((control) => '<option>' + control + '</option>')
      .join('') +
    '</select><button id="watch-refresh">Обновить</button><span id="watch-hall-status" role="status">Заглядываем в зал…</span></div><div id="watch-hall-list" class="watch-hall-list"></div><p class="muted">До 20 последних открытых партий. Чтобы пригласить зрителей к своей доске, оба участника включают просмотр в игровой комнате.</p>';
  $('watch-filter').onchange = () => {
    session.filter = $('watch-filter').value;
    renderWatchHall(session);
  };
  $('watch-refresh').onclick = () => refreshWatchHall(session);
  session.pollTimer = setInterval(() => {
    if (document.visibilityState !== 'hidden') refreshWatchHall(session);
  }, 8000);
  await refreshWatchHall(session);
}
function renderWatchHall(session) {
  if (!watchingCurrent(session)) return;
  const games = session.games.filter(
    (g) => session.filter === 'all' || g.control === session.filter
  );
  $('watch-hall-list').innerHTML = games.length
    ? games
        .map(
          (g) =>
            `<a class="watch-table-card" href="/watch/${g.id}"><span class="watch-table-top"><b>● В эфире</b><span>${escapeHtml(g.control)}</span></span><strong>${escapeHtml(g.white.username)} <small>${g.white.rating}</small></strong><span class="watch-versus">против</span><strong>${escapeHtml(g.black.username)} <small>${g.black.rating}</small></strong><span class="watch-table-bottom">${g.ply} ${plural(g.ply, ['полуход', 'полухода', 'полуходов'])}<span>Смотреть →</span></span></a>`
        )
        .join('')
    : '<div class="page-empty"><h2>Пока тихо.</h2><p>Сейчас нет открытых партий с выбранным контролем. Пригласите друга и откройте свою доску для зрителей.</p><a href="/">За свой стол →</a></div>';
}
async function refreshWatchHall(session) {
  if (!watchingCurrent(session) || session.busy) return;
  session.busy = true;
  $('watch-refresh').disabled = true;
  try {
    const out = await api('watch');
    if (!watchingCurrent(session)) return;
    session.games = out.games;
    renderWatchHall(session);
    $('watch-hall-status').textContent =
      'Список обновлён · ' +
      new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    if (watchingCurrent(session)) $('watch-hall-status').textContent = error.message;
  } finally {
    session.busy = false;
    if (watchingCurrent(session)) $('watch-refresh').disabled = false;
  }
}
async function loadWatchRoom(id) {
  communityShell();
  communityNav('nav-watch');
  document.title = 'Наблюдаем партию · Doctor Chess';
  const session = (watching = {
    generation: watchGeneration,
    id,
    kind: 'room',
    busy: false,
    board: null,
    game: null,
    cursor: null,
    flipped: false,
    received: 0,
  });
  session.pollTimer = setInterval(() => {
    if (document.visibilityState !== 'hidden') refreshWatchRoom(session);
  }, 2000);
  session.clockTimer = setInterval(() => tickWatchClocks(session), 200);
  await refreshWatchRoom(session);
}
function createWatchRoom(session) {
  session.boardKey = session.moveKey = null;
  $('community-page').innerHTML =
    `<div class="breadcrumbs"><a href="/watch">Зрительный зал</a><span>/</span><span>Партия ${session.id.slice(0, 8)}</span></div><section class="watch-room-heading"><div><p class="eyebrow">У ДОСКИ · В ГОСТЯХ</p><h1>Смотрим, думаем, болеем.</h1></div><img src="/doctor.svg" alt="DJ Doctor" width="84" height="76"></section><p id="watch-connection" role="status"></p><div class="watch-room-layout"><section><div class="watch-player"><a id="watch-top-player"></a><strong id="watch-top-clock" class="watch-clock"></strong></div><div class="board-frame"><div class="board-rim"><div id="watch-board" class="chessboard" tabindex="0" role="group" aria-label="Доска зрителя"></div></div></div><div class="watch-player"><a id="watch-bottom-player"></a><strong id="watch-bottom-clock" class="watch-clock"></strong></div><div class="study-board-tools"><button id="watch-first" aria-label="Начало партии">|‹</button><button id="watch-prev" aria-label="Предыдущий ход">‹</button><button id="watch-next" aria-label="Следующий ход">›</button><button id="watch-live">К текущей позиции</button><button id="watch-flip">Перевернуть</button><button id="watch-link">Скопировать ссылку</button></div><p id="watch-replay-status" role="status"></p><section id="watch-result" class="watch-result" hidden><h2 id="watch-result-title"></h2><p id="watch-result-reason"></p><a id="watch-review">Разобрать партию →</a></section><button id="watch-retry" hidden>Повторить подключение</button></section><aside class="notebook-paper"><p id="watch-control"></p><h2>Как развивалась партия</h2><div id="watch-moves" class="watch-moves" aria-label="Ходы партии"></div><p class="muted">Вы наблюдаете: ходы и часы задают игроки. Движок во время трансляции недоступен. Свои стрелки и круги видите только вы.</p></aside></div>`;
  session.board = new ChessBoardView($('watch-board'), {
    piece,
    onClick: () => {},
    onPick: () => {},
    onDrop: () => {},
    canDrag: () => false,
  });
  $('watch-first').onclick = () => watchSeek(session, 0);
  $('watch-prev').onclick = () =>
    watchSeek(session, (session.cursor ?? session.game.moves.length) - 1);
  $('watch-next').onclick = () =>
    watchSeek(session, (session.cursor ?? session.game.moves.length) + 1);
  $('watch-live').onclick = () => watchSeek(session, null);
  $('watch-flip').onclick = () => {
    session.flipped = !session.flipped;
    renderWatchRoom(session);
  };
  $('watch-retry').onclick = () => refreshWatchRoom(session);
  $('watch-link').onclick = async () => {
    try {
      await navigator.clipboard.writeText(location.origin + '/watch/' + session.id);
      toast('Ссылка на трансляцию скопирована');
    } catch {
      toast('Скопируйте адрес страницы из строки браузера.');
    }
  };
}
function watchSeek(session, cursor) {
  if (!watchingCurrent(session) || !session.game) return;
  session.cursor =
    cursor === null ? null : Math.max(0, Math.min(session.game.moves.length, cursor));
  renderWatchRoom(session);
}
async function refreshWatchRoom(session) {
  if (!watchingCurrent(session) || session.busy) return;
  session.busy = true;
  try {
    const out = await api('watch/' + session.id);
    if (!watchingCurrent(session)) return;
    if (!session.board) createWatchRoom(session);
    const signature = JSON.stringify(out.game.moves);
    if (signature !== session.signature) {
      session.line = ChessNotation.replay(initial(), out.game.moves);
      session.signature = signature;
    }
    session.game = out.game;
    session.received = performance.now();
    session.revoked = false;
    if (session.cursor !== null) session.cursor = Math.min(session.cursor, out.game.moves.length);
    $('watch-connection').textContent = out.game.result
      ? 'Партия завершена'
      : '● Прямой эфир · обновление каждые 2 секунды';
    $('watch-retry').hidden = true;
    renderWatchRoom(session);
    if (out.game.result) {
      clearInterval(session.pollTimer);
      session.pollTimer = null;
    }
  } catch (error) {
    if (!watchingCurrent(session)) return;
    if (error.status === 404) {
      session.revoked = true;
      session.received = 0;
      clearInterval(session.pollTimer);
      session.pollTimer = null;
      session.board?.destroy();
      session.board = null;
      $('community-page').innerHTML =
        '<div class="page-empty"><h1>Трансляция закрыта</h1><p>Для просмотра нужно согласие обоих игроков. Возможно, один из участников закрыл доступ.</p><button id="watch-reopen">Проверить ещё раз</button><a href="/watch">В зрительный зал →</a></div>';
      $('watch-reopen').onclick = () => {
        if (!session.pollTimer)
          session.pollTimer = setInterval(() => {
            if (document.visibilityState !== 'hidden') refreshWatchRoom(session);
          }, 2000);
        refreshWatchRoom(session);
      };
    } else if (session.board) {
      $('watch-connection').textContent =
        'Связь прервалась · показываем последнюю полученную позицию';
      $('watch-retry').hidden = false;
    } else {
      $('community-page').innerHTML =
        '<div class="page-empty"><h1>Не удалось подключиться</h1><p>' +
        escapeHtml(error.message) +
        '</p><button id="watch-reopen">Попробовать снова</button><a href="/watch">В зрительный зал →</a></div>';
      $('watch-reopen').onclick = () => refreshWatchRoom(session);
    }
  } finally {
    session.busy = false;
  }
}
function renderWatchRoom(session) {
  if (!watchingCurrent(session) || !session.board || !session.game) return;
  const g = session.game,
    line = session.line,
    index = session.cursor ?? g.moves.length,
    state = line.positions[index],
    last = index ? g.moves[index - 1] : null;
  const king = check(state, state.turn) ? state.b.indexOf(state.turn === 'w' ? 'K' : 'k') : -1;
  const boardKey = index + ':' + session.flipped + ':' + JSON.stringify(state);
  if (session.boardKey !== boardKey) {
    session.board.render(
      state,
      session.flipped,
      -1,
      [],
      last ? [last.from, last.to] : [],
      king,
      king >= 0 && !allMoves(state) ? king : -1
    );
    session.boardKey = boardKey;
  }
  for (const [where, side] of [
    ['top', session.flipped ? 'w' : 'b'],
    ['bottom', session.flipped ? 'b' : 'w'],
  ]) {
    const player = side === 'w' ? g.white : g.black,
      link = $('watch-' + where + '-player');
    link.href = profilePath(player.username);
    link.textContent = player.username + ' · ' + player.rating;
    $('watch-' + where + '-clock').dataset.side = side;
  }
  $('watch-control').textContent =
    g.control + ' · ' + (g.kind === 'casual' ? 'Дружеская партия' : 'Рейтинговая партия');
  const moveKey = session.signature + ':' + index;
  if (session.moveKey !== moveKey) {
    $('watch-moves').innerHTML =
      line.sans
        .map(
          (san, i) =>
            `<button data-watch-ply="${i + 1}" ${index === i + 1 ? 'aria-current="true"' : ''}><small>${Math.floor(i / 2) + 1}${i % 2 ? '…' : '.'}</small> ${escapeHtml(san)}</button>`
        )
        .join('') || '<p>Белые готовят первый ход.</p>';
    document
      .querySelectorAll('[data-watch-ply]')
      .forEach(
        (button) => (button.onclick = () => watchSeek(session, Number(button.dataset.watchPly)))
      );
    session.moveKey = moveKey;
  }
  $('watch-first').disabled = $('watch-prev').disabled = index === 0;
  $('watch-next').disabled = index === g.moves.length;
  $('watch-live').disabled = session.cursor === null;
  $('watch-live').textContent =
    session.cursor === null
      ? 'Вы у текущей позиции'
      : 'К текущей позиции' + (g.moves.length - index ? ' · +' + (g.moves.length - index) : '');
  $('watch-replay-status').textContent =
    session.cursor === null
      ? 'Текущая позиция · часы игроков'
      : 'Просмотр записи: ' +
        index +
        ' / ' +
        g.moves.length +
        ' полуходов. Часы показывают текущее время игроков.';
  $('watch-result').hidden = !g.result;
  if (g.result) {
    $('watch-result-title').textContent =
      g.result === 'draw'
        ? 'Ничья · ½–½'
        : g.result === 'w'
          ? 'Победили белые · 1–0'
          : 'Победили чёрные · 0–1';
    $('watch-result-reason').textContent = g.reason || '';
  }
  $('watch-review').href = '/review/' + g.id;
  $('watch-review').hidden = !g.result || learningMatchActive();
  tickWatchClocks(session);
}
function tickWatchClocks(session) {
  if (!watchingCurrent(session) || !session.board || !session.game || session.revoked) return;
  const elapsed = Math.max(0, (performance.now() - session.received) / 1000),
    g = session.game;
  // Freeze at the last trusted reading after a prolonged outage; do not invent a result.
  for (const where of ['top', 'bottom']) {
    const node = $('watch-' + where + '-clock'),
      side = node.dataset.side;
    node.textContent = watchClock(
      g.clocks[side] - (g.result || g.state.turn !== side ? 0 : Math.min(elapsed, 12))
    );
    node.dataset.running = String(!g.result && g.state.turn === side);
  }
  if (!g.result && elapsed > 12)
    $('watch-connection').textContent =
      'Нет свежего подтверждения · часы приостановлены на последнем расчёте, результат определит сервер';
}
function updateWatchConsent() {
  const visible = mode === 'online' && !!active();
  $('spectator-actions').hidden = !visible;
  if (!visible) return;
  const consent = game.watch || {},
    own = !!consent[game.you],
    other = !!consent[game.you === 'w' ? 'b' : 'w'];
  const summary = $('spectator-actions').querySelector('summary');
  summary.textContent = consent.enabled
    ? '● Зрители · трансляция открыта'
    : other && !own
      ? 'Соперник предлагает открыть трансляцию'
      : 'Зрители у вашей доски';
  $('spectator-toggle').textContent = own ? 'Закрыть зрителям' : 'Разрешить зрителей';
  $('spectator-toggle').disabled = watchConsentBusy || busy;
  $('spectator-caption').textContent = consent.enabled
    ? game.kind === 'casual'
      ? 'Трансляция открыта по ссылке.'
      : 'Трансляция открыта в зрительном зале.'
    : own
      ? 'Вы согласны · ждём согласия соперника.'
      : other
        ? 'Соперник уже согласен. Разрешить зрителей для этой партии?'
        : 'Смотреть можно только после согласия обоих игроков.';
  $('spectator-link').hidden = !consent.enabled;
}
async function toggleWatchConsent() {
  if (!active() || mode !== 'online' || busy || watchConsentBusy) return;
  const id = game.id,
    enabled = !game.watch?.[game.you];
  watchConsentBusy = true;
  updateWatchConsent();
  try {
    const out = await api('games/' + id + '/spectators', { enabled });
    if (mode === 'online' && game?.id === id) {
      game.watch = out.game.watch;
      updateWatchConsent();
    }
  } catch (error) {
    toast(error.message);
  } finally {
    watchConsentBusy = false;
    updateWatchConsent();
  }
}
function initializeWatching() {
  const resume = () => {
    if (!watching || document.visibilityState === 'hidden') return;
    if (watching.kind === 'hall') refreshWatchHall(watching);
    else if (!watching.game?.result && !watching.revoked) refreshWatchRoom(watching);
  };
  window.addEventListener('focus', resume);
  window.addEventListener('online', resume);
  document.addEventListener('visibilitychange', resume);
  $('nav-watch').onclick = () => navigate('/watch');
  $('spectator-toggle').onclick = toggleWatchConsent;
  $('spectator-link').onclick = async () => {
    if (!game?.watch?.enabled) return;
    try {
      await navigator.clipboard.writeText(location.origin + '/watch/' + game.id);
      toast('Ссылка для зрителей скопирована');
    } catch {
      toast('Ссылка для зрителей: ' + location.origin + '/watch/' + game.id);
    }
  };
}
