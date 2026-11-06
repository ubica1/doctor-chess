const $ = (id) => document.getElementById(id),
  cats = { bullet: 'Пуля', blitz: 'Блиц', rapid: 'Рапид', classical: 'Классика' };
let s = initial(),
  user = null,
  game = null,
  mode = 'online',
  control = '5+0',
  queued = false,
  selected = -1,
  flipped = false,
  history = [],
  moves = [],
  last = [],
  busy = false,
  polling = false,
  clockSample = Date.now(),
  toastTimer;
let remoteGame = null,
  networkEpoch = 0,
  positionFinished = false,
  boardView = null;
let soundsEnabled = localStorage.getItem('dc-sounds') === 'on',
  audioContext = null;
control = ['1+0', '3+0', '3+2', '5+0', '10+0', '15+10', '30+0'].includes(
  localStorage.getItem('dc-control')
)
  ? localStorage.getItem('dc-control')
  : '5+0';
mode = ['online', 'local', 'puzzle', 'computer', 'analysis'].includes(
  localStorage.getItem('dc-mode')
)
  ? localStorage.getItem('dc-mode')
  : 'computer';
function moveSound(capture = false) {
  if (!soundsEnabled) return;
  try {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    audioContext.resume();
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator(),
      gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(capture ? 230 : 390, now);
    oscillator.frequency.exponentialRampToValueAtTime(100, now + 0.065);
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.1);
  } catch {}
}
function updateResume() {
  const practice = $('resume-practice');
  practice.hidden = !['computer', 'local', 'puzzle', 'analysis'].includes(mode) || !moves.length;
  const b = $('resume-game');
  b.hidden =
    !remoteGame ||
    !!remoteGame.result ||
    (mode === 'online' && typeof location !== 'undefined' && gameRoute() === remoteGame.id);
  b.textContent = 'Вернуться в партию · ' + (remoteGame?.control || '') + ' →';
  const notice = $('live-game-notice');
  const away =
    !!remoteGame &&
    !remoteGame.result &&
    !(mode === 'online' && typeof location !== 'undefined' && gameRoute() === remoteGame.id);
  notice.hidden = !away;
  if (away) {
    $('live-game-link').href = '/game/' + remoteGame.id;
    $('live-game-link').textContent = 'Вернуться · ' + remoteGame.control + ' →';
  }
}
function canInteract() {
  return (
    reviewIndex === null &&
    !botThinking &&
    (mode !== 'analysis' || variationEditing) &&
    (mode !== 'computer' || (s.turn === botSide && !learningMatchActive())) &&
    !busy &&
    !queued &&
    !positionFinished &&
    (mode !== 'online' ||
      (connectionState === 'online' && game && !game.result && s.turn === game.you))
  );
}
function saveDesk() {
  if (mode === 'online') return;
  try {
    sessionStorage.setItem(
      'dc-desk-' + mode,
      JSON.stringify({
        s,
        history,
        moves,
        last,
        flipped,
        botSide,
        botLevel,
        archiveInfo,
        reviewIndex,
        localArchiveId,
        variationEditing,
        variationOrigin,
      })
    );
  } catch {}
}
function restoreDesk() {
  if (mode === 'online') return;
  try {
    const d = JSON.parse(sessionStorage.getItem('dc-desk-' + mode));
    if (d && Array.isArray(d.s?.b) && d.s.b.length === 64) {
      s = d.s;
      history = d.history || [];
      moves = d.moves || [];
      last = d.last || [];
      flipped = !!d.flipped;
      botSide = d.botSide === 'b' ? 'b' : 'w';
      botLevel = [1, 2, 3].includes(d.botLevel) ? d.botLevel : 2;
      archiveInfo = d.archiveInfo || null;
      reviewIndex = Number.isInteger(d.reviewIndex) ? d.reviewIndex : null;
      localArchiveId = d.localArchiveId || null;
      variationEditing = !!d.variationEditing;
      variationOrigin = variationOrigin || d.variationOrigin || null;
      return true;
    }
  } catch {}
  return false;
}
function escapeHtml(t) {
  return String(t ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
function toast(t) {
  $('toast').textContent = t;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 4000);
}
async function api(path, data) {
  const accountAtStart = user?.id;
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), 10000) : null;
  let r, x;
  try {
    r = await fetch('/api/' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: controller?.signal,
      cache: 'no-store',
    });
    try {
      x = await r.json();
    } catch {
      connectionFailed();
      throw Error('Нет связи с игровым сервером');
    }
    connectionReceived();
  } catch (error) {
    connectionFailed();
    if (error.message === 'Нет связи с игровым сервером') throw error;
    throw Error(
      'Не удалось подключиться к Doctor Chess. Проверьте соединение и попробуйте ещё раз.'
    );
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
  if (accountAtStart !== user?.id && !['login', 'register', 'logout'].includes(path)) {
    const error = Error('Профиль изменился. Повторите действие.');
    error.staleSession = true;
    throw error;
  }
  if (!r.ok) {
    const error = Error(x.error || 'Не удалось выполнить действие');
    error.status = r.status;
    throw error;
  }
  return x;
}

function show(title, html) {
  $('modal-title').textContent = title;
  $('content').innerHTML = html;
  if (!$('modal').open) $('modal').showModal();
}
function active() {
  return game && !game.result;
}
function forgetAccount() {
  networkEpoch++;
  user = null;
  remoteGame = null;
  game = null;
  queued = false;
  resetBoard();
  updateUser();
  render();
}
function auth(register = false) {
  show(
    register ? 'Приятно познакомиться.' : 'С возвращением.',
    `<p>${register ? 'Создайте свой профиль. С него начинается ваша история за доской.' : 'Ваш стол уже ждёт.'}</p><form id="auth-form"><label for="auth-name">Имя игрока</label><input id="auth-name" name="username" minlength="3" maxlength="24" required autocomplete="username" placeholder="Как к вам обращаться?"><label for="auth-password">Пароль</label><input id="auth-password" name="password" type="password" minlength="8" maxlength="128" required autocomplete="${register ? 'new-password' : 'current-password'}" placeholder="Не менее 8 символов"><div class="form-error" id="auth-error" role="alert"></div><button class="primary" id="auth-submit">${register ? 'Создать профиль' : 'Войти'} <span>↗</span></button></form><button class="form-switch" id="auth-switch">${register ? 'Уже есть профиль? Войти' : 'Первый раз здесь? Зарегистрироваться'}</button>`
  );
  $('auth-switch').onclick = () => auth(!register);
  $('auth-form').onsubmit = async (e) => {
    e.preventDefault();
    $('auth-submit').disabled = true;
    networkEpoch++;
    try {
      const x = await api(register ? 'register' : 'login', {
        username: $('auth-name').value,
        password: $('auth-password').value,
      });
      networkEpoch++;
      user = x.user;
      $('modal').close();
      updateUser();
      toast(register ? 'Добро пожаловать в клуб!' : 'Рады видеть вас снова');
      await routePage();
      await poll();
    } catch (e) {
      $('auth-error').textContent = e.message;
    } finally {
      if ($('auth-submit')) $('auth-submit').disabled = false;
    }
  };
}
function updateUser() {
  $('account').textContent = user ? user.username + ' ↗' : 'Войти ↗';
  $('username').textContent = user ? user.username : 'Гость клуба';
  $('avatar').innerHTML = emblem(user?.avatar || 'crane');
  $('bio').textContent = user
    ? user.bio || 'Рады видеть вас за доской.'
    : 'Заглянули на партию? Будем знакомы.';
  $('member-id').textContent = user ? user.id.slice(0, 5).toUpperCase() : '—';
  $('mini-rating').textContent = user ? user.ratings.blitz.rating : '1200';
  $('profile-action').textContent = user ? 'Мой профиль ↗' : 'Создать профиль ↗';
  const caption = document.querySelector('.rating-mini div>span');
  caption.textContent = user ? 'РЕЙТИНГ В БЛИЦЕ' : 'СТАРТОВЫЙ РЕЙТИНГ';
}
function profile() {
  if (!user) return auth(true);
  openPlayer(user.username);
}
async function ratings() {
  try {
    const data = await api('leaderboard');
    show(
      'За столами клуба.',
      `<div class="leader-tabs">${Object.entries(cats)
        .map(([c, t]) => `<button data-cat="${c}">${t}</button>`)
        .join(
          ''
        )}</div><div id="leader-content"></div><p class="muted">Только реальные игроки с завершёнными партиями.</p>`
    );
    const fill = (c) => {
      document
        .querySelectorAll('[data-cat]')
        .forEach((b) => b.classList.toggle('selected', b.dataset.cat === c));
      $('leader-content').innerHTML = data[c].length
        ? data[c]
            .map(
              (r, i) =>
                `<div class="leader-row"><a href="/player/${encodeURIComponent(r.username)}">${i + 1}. ${escapeHtml(r.username)}</a><strong>${r.rating} <small>· ${r.played} игр</small></strong></div>`
            )
            .join('')
        : '<div class="empty-note">Пока тихо. Завершите первую партию — и откройте таблицу клуба.</div>';
    };
    document.querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => fill(b.dataset.cat)));
    fill('blitz');
  } catch (e) {
    toast(e.message);
  }
}
function resetBoard() {
  cancelOutcomeReveal();
  cancelGameReport();
  clearPremove();
  stopStudy();
  botMoveSource = '';
  botProblem = false;
  botEngineNote = 'Stockfish 19 Lite · репертуар Доктора';
  variationEditing = false;
  reviewIndex = null;
  archiveInfo = null;
  localArchiveId = null;
  s = initial();
  selected = -1;
  history = [];
  moves = [];
  last = [];
  flipped = false;
}
function capturedPieces() {
  const budget = (game ? initial() : history[0] || s).b.filter(Boolean),
    promotions = [];
  if (game) {
    for (const m of game.moves)
      if (m.piece?.toLowerCase() === 'p' && (m.to < 8 || m.to >= 56))
        promotions.push([
          m.piece,
          color(m.piece) === 'w' ? (m.promotion || 'q').toUpperCase() : m.promotion || 'q',
        ]);
  } else
    for (let n = 0; n < history.length; n++) {
      const before = history[n].b,
        after = (history[n + 1] || s).b;
      for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 56, 57, 58, 59, 60, 61, 62, 63]) {
        const p = after[i];
        if (p && p.toLowerCase() !== 'p' && p.toLowerCase() !== 'k' && before[i] !== p) {
          const pawn = i < 8 ? 'P' : 'p';
          if (before.some((v, j) => v === pawn && after[j] !== pawn)) promotions.push([pawn, p]);
        }
      }
    }
  for (const [pawn, p] of promotions) {
    const i = budget.indexOf(pawn);
    if (i >= 0) budget.splice(i, 1);
    budget.push(p);
  }
  for (const p of s.b.filter(Boolean)) {
    const i = budget.indexOf(p);
    if (i >= 0) budget.splice(i, 1);
  }
  return budget;
}
function render() {
  positionFinished = !!(game?.result || (!game && end(s, history)));
  $('game-page').classList.toggle('playing', !!game || moves.length > 0 || botThinking);
  if (!boardView)
    boardView = new ChessBoardView($('board'), {
      piece,
      onClick: selectSquare,
      onPick: (i) => {
        selected = i;
        if (i < 0) clearPremove();
        render();
      },
      canDrag: selectablePiece,
      onDrop: (i, j) => {
        if (selectablePiece(i) && moveTargets(i).includes(j)) {
          selected = i;
          selectSquare(j);
        } else {
          selected = -1;
          render();
        }
      },
    });
  const displayed = shownState(),
    displayLine = currentLine(),
    displayLast =
      reviewIndex === null
        ? last
        : reviewIndex > 0
          ? [displayLine.records[reviewIndex - 1]?.from, displayLine.records[reviewIndex - 1]?.to]
          : [];
  const checked = check(displayed, displayed.turn),
    kingSquare = checked ? displayed.b.indexOf(displayed.turn === 'w' ? 'K' : 'k') : -1;
  boardView.render(
    displayed,
    flipped,
    selected,
    selected >= 0 && reviewIndex === null ? moveTargets(selected) : [],
    displayLast,
    kingSquare,
    checked && !allMoves(displayed) && (!game || !!game.result) ? kingSquare : -1
  );
  $('count').textContent =
    moves.length + ' ' + plural(moves.length, ['полуход', 'полухода', 'полуходов']);
  const taken = capturedPieces();
  $('captured').innerHTML =
    mode === 'puzzle' ? '' : taken.map((p) => '<span>' + piece(p) + '</span>').join('');
  $('captured').hidden = mode === 'puzzle' || reviewIndex !== null || !taken.length;
  updatePanel();
  updatePlayers();
  saveDesk();
}
function updatePanelBase() {
  updateResume();
  $('sound').classList.toggle('sound-on', soundsEnabled);
  $('sound').setAttribute('aria-pressed', String(soundsEnabled));
  $('sound').setAttribute(
    'aria-label',
    soundsEnabled ? 'Выключить звук ходов' : 'Включить звук ходов'
  );
  const online = mode === 'online';
  $('online').classList.toggle('selected', online);
  $('local').classList.toggle('selected', mode === 'local');
  document.querySelectorAll('[data-control]').forEach((b) => {
    b.classList.toggle('selected', b.dataset.control === control);
    b.disabled = !!active() || queued || mode === 'local' || mode === 'puzzle';
  });
  $('new').textContent = active()
    ? 'Партия идёт'
    : queued
      ? 'Отменить поиск'
      : mode === 'local'
        ? 'Новая домашняя партия'
        : mode === 'puzzle'
          ? 'Повторить задачу'
          : 'Найти соперника ↗';
  $('new').disabled = !!active();
  $('new').classList.toggle('queueing', queued);
  $('queue-note').textContent = queued
    ? 'Ищем игрока с таким же контролем. Оставайтесь здесь.'
    : active()
      ? 'Рейтинговая партия · ' + game.control
      : mode === 'local'
        ? 'На одном устройстве · без часов и рейтинга'
        : mode === 'puzzle'
          ? 'Белые начинают. Поставьте мат за один ход.'
          : 'Рейтинговая партия · случайный соперник';
  $('game-actions').hidden = !active();
  $('draw').textContent =
    game?.offer && game.offer !== game.you
      ? 'Принять ничью'
      : game?.offer
        ? 'Ничья предложена'
        : 'Предложить ничью';
  $('undo').disabled = mode === 'online' || !history.length;
  let message = 'Выберите режим и начните партию';
  if (game) {
    message = game.result
      ? (game.result === 'draw'
          ? 'Ничья'
          : game.result === game.you
            ? 'Вы победили!'
            : 'Победа соперника') +
        ' · ' +
        game.reason
      : (s.turn === game.you ? 'Ваш ход' : 'Ход соперника') + (check(s, s.turn) ? ' · Шах!' : '');
  } else if (mode === 'local' || mode === 'puzzle')
    message =
      end(s, history) ||
      (check(s, s.turn) ? 'Шах! ' : '') + (s.turn === 'w' ? 'Ход белых' : 'Ход чёрных');
  if (queued) message = 'Ждём соперника за вашим столом…';
  $('status').textContent = message;
}
function updatePanel() {
  updatePanelBase();
  updateStudioPanel();
  updateFriendlyActions();
}
function updatePlayers() {
  const topSide = flipped ? 'w' : 'b',
    bottomSide = opp(topSide);
  if (game) {
    for (const [pos, side] of [
      ['top', topSide],
      ['bottom', bottomSide],
    ]) {
      const u = side === 'w' ? game.white : game.black;
      $(pos).textContent = u.username + (side === game.you ? ' · вы' : '');
      $(pos).classList.add('player-link');
      $(pos).onclick = () => openPlayer(u.username);
      $(pos + '-meta').textContent =
        game.kind === 'casual'
          ? 'Дружеская · ' + game.control + ' · ' + (side === 'w' ? 'белые' : 'чёрные')
          : cats[game.category] +
            ' · ' +
            u.ratings[game.category].rating +
            ' · ' +
            (side === 'w' ? 'белые' : 'чёрные');
    }
  } else {
    for (const pos of ['top', 'bottom']) {
      $(pos).classList.remove('player-link');
      $(pos).onclick = null;
    }
    $('top').textContent =
      mode === 'local'
        ? topSide === 'w'
          ? 'Белые'
          : 'Чёрные'
        : mode === 'puzzle'
          ? 'Чёрные'
          : 'Соперник';
    $('bottom').textContent =
      mode === 'local'
        ? bottomSide === 'w'
          ? 'Белые'
          : 'Чёрные'
        : mode === 'puzzle'
          ? 'Белые'
          : user?.username || 'Вы';
    $('top-meta').textContent =
      mode === 'local' ? 'За одной доской' : 'Новая история за этой доской';
    $('bottom-meta').textContent =
      mode === 'puzzle'
        ? 'Мат в один ход'
        : mode === 'local'
          ? 'За одной доской'
          : 'Белые начинают';
  }
  tickClocks();
  updateBotPlayers();
}
function tickClocks() {
  for (const [pos, side] of [
    ['top', flipped ? 'w' : 'b'],
    ['bottom', flipped ? 'b' : 'w'],
  ]) {
    let seconds = game ? game.clocks[side] : Number(control.split('+')[0]) * 60;
    if (game && !game.result && s.turn === side)
      seconds -= Math.max(0, (Date.now() - clockSample) / 1000);
    const v = Math.max(0, Math.ceil(seconds));
    $('clock-' + pos).textContent = ['local', 'puzzle', 'computer', 'analysis'].includes(mode)
      ? '∞'
      : String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
    $('clock-' + pos).classList.toggle('ticking', !!active() && s.turn === side);
    $('clock-' + pos).classList.toggle('low', !!game && v < 20);
  }
}
async function selectSquare(i) {
  if (canQueuePremove()) return planPremove(i);
  if (!canInteract()) return;
  if (selected >= 0 && legal(s, selected).includes(i)) {
    let from = selected;
    if (s.b[from]?.toLowerCase() === 'p' && (i < 8 || i >= 56)) {
      show(
        'Новая сила пешки.',
        '<p>В какую фигуру превращаем?</p><div class="promotion" id="promotion"></div>'
      );
      for (const [p, label] of [
        ['q', 'Ферзь'],
        ['r', 'Ладья'],
        ['b', 'Слон'],
        ['n', 'Конь'],
      ]) {
        let b = document.createElement('button');
        b.innerHTML = piece(p.toUpperCase());
        b.setAttribute('aria-label', label);
        b.onclick = () => {
          $('modal').close();
          makeMove(from, i, p);
        };
        $('promotion').append(b);
      }
      return;
    }
    return makeMove(from, i, 'q');
  }
  selected = color(s.b[i]) === s.turn ? i : -1;
  render();
}
async function makeMove(i, j, p) {
  if (busy) return;
  busy = true;
  networkEpoch++;
  const viewMode = mode,
    epoch = networkEpoch,
    previous = s,
    previousMoves = [...moves],
    previousHistory = [...history],
    previousLast = [...last],
    currentGame = game;
  const next = apply(s, i, j, p),
    capture = !!s.b[j] || (s.b[i].toLowerCase() === 'p' && j === s.ep);
  if (mode === 'puzzle' && !(check(next, next.turn) && !allMoves(next))) {
    busy = false;
    selected = -1;
    render();
    toast('Почти! Найдите ход, который сразу ставит мат.');
    return;
  }
  // Move immediately on the local board; the server still has final authority.
  s = next;
  last = [i, j];
  selected = -1;
  moves.push(ChessNotation.san(previous, { from: i, to: j, promotion: p }));
  history.push(previous);
  render();
  moveSound(capture);
  try {
    if (currentGame) {
      const x = await api('move', { game: currentGame.id, from: i, to: j, promotion: p });
      remoteGame = x.game;
      if (epoch === networkEpoch && mode === viewMode) acceptGame(x.game);
    } else if (mode === 'puzzle') toast('Точно! Красивый мат.');
  } catch (e) {
    if (epoch === networkEpoch && mode === viewMode) {
      s = previous;
      moves = previousMoves;
      history = previousHistory;
      last = previousLast;
      selected = -1;
      render();
    }
    toast(e.message);
  } finally {
    busy = false;
    networkEpoch++;
    if (mode === viewMode) render();
    if (currentGame) poll();
    if (mode === 'computer') {
      if (end(s, history)) archiveCurrent(true);
      else scheduleBot();
    }
    if (mode === 'local' && end(s, history)) archiveCurrent(true);
  }
}
function acceptGame(g) {
  if (!g) return;
  connectionReceived();
  remoteGame = g;
  if (mode !== 'online') {
    updateLearningSafety();
    updateResume();
    return;
  }
  const previous = game,
    changed =
      !previous ||
      previous.id !== g.id ||
      moves.length !== g.moves.length ||
      previous.result !== g.result ||
      JSON.stringify(s.b) !== JSON.stringify(g.state.b);
  const opponentMove = previous && previous.id === g.id && g.moves.length > moves.length;
  if (previous?.id === g.id && g.moves.length < moves.length) {
    clearPremove();
    reviewIndex = null;
    cancelGameReport();
  }
  game = g;
  updateLearningSafety();
  queued = false;
  if (!g.result) control = g.control;
  clockSample = Date.now();
  last = g.last;
  if (changed) {
    const line = ChessNotation.replay(initial(), g.moves);
    s = g.state;
    history = line.positions.slice(0, -1);
    moves = line.sans;
    lineCache = line;
    lineHistory = history;
    lineState = s;
  }
  syncGameRoute(g, previous);
  if (changed) {
    selected = -1;
    if (!previous || previous.id !== g.id) flipped = g.you === 'b';
    render();
    if (opponentMove) moveSound();
  } else {
    updatePanel();
    updatePlayers();
  }
  consumePremove();
}
async function poll() {
  if (polling || busy || !user) return;
  polling = true;
  const epoch = networkEpoch;
  try {
    const x = await api('state');
    if (epoch !== networkEpoch || busy) return;
    if (!x.user) {
      user = null;
      remoteGame = null;
      game = null;
      queued = false;
      updateUser();
      render();
      return;
    }
    user = x.user;
    updateUser();
    remoteGame = x.game;
    updateLearningSafety();
    updateResume();
    if (mode !== 'online') return;
    if (gameRoute() && x.game?.id !== gameRoute() && !game?.rematch) return;
    queued = x.queued;
    if (x.game) acceptGame(x.game);
    else if (queued) {
      if (game) {
        game = null;
        resetBoard();
        render();
      } else updatePanel();
    } else if (game) {
      game = null;
      render();
    } else updatePanel();
  } catch (e) {
    if (!e.staleSession) connectionFailed();
  } finally {
    polling = false;
  }
}
async function changeMode(m) {
  if (busy) return toast('Дождитесь подтверждения хода.');
  if (
    m !== 'analysis' &&
    typeof location !== 'undefined' &&
    location.pathname.startsWith('/review/')
  ) {
    window.history.replaceState({}, '', '/');
    document.title = 'Doctor Chess · Шахматная комната';
  }
  const cancel = queued,
    background = active();
  networkEpoch++;
  saveDesk();
  mode = m;
  localStorage.setItem('dc-mode', m);
  queued = false;
  game = null;
  selected = -1;
  boardView?.cancel();
  resetBoard();
  if (!restoreDesk() && m === 'puzzle') {
    s.b = Array(64).fill(null);
    s.b[7] = 'k';
    s.b[22] = 'K';
    s.b[13] = 'Q';
    s.rights = '';
  }
  render();
  if (background && m !== 'online')
    toast('Сетевая партия продолжается. Вернуться можно кнопкой над режимами.');
  if (cancel) {
    try {
      const cancellation = await api('cancel', {});
      if (cancellation.game) {
        remoteGame = cancellation.game;
        updateLearningSafety();
        updateResume();
      }
    } catch (e) {
      toast(e.message);
    }
  }
  networkEpoch++;
  if (m === 'online') {
    if (remoteGame) acceptGame(remoteGame);
    poll();
  }
  if (m === 'computer') {
    flipped = botSide === 'b';
    render();
    scheduleBot();
  }
}
async function start() {
  if (busy) return;
  if (mode === 'analysis') {
    await changeMode('computer');
    return startLocal();
  }
  if (mode === 'computer' && (botThinking || botProblem)) {
    stopStudy();
    openPracticeRoom();
    render();
    return scheduleBot();
  }
  networkEpoch++;
  if (mode === 'online') {
    if (!user) return auth(true);
    busy = true;
    try {
      if (queued) {
        const cancellation = await api('cancel', {});
        if (cancellation.game) acceptGame(cancellation.game);
        queued = false;
        render();
      } else {
        const x = await api('queue', { control });
        if (x.game) acceptGame(x.game);
        else {
          queued = true;
          game = null;
          resetBoard();
          render();
        }
      }
    } catch (e) {
      toast(e.message);
    } finally {
      busy = false;
      networkEpoch++;
    }
  } else {
    if (moves.length) {
      show(
        'Ещё одну?',
        '<p>Текущая позиция будет сброшена.</p><button id="confirm-reset" class="primary">Начать заново</button>'
      );
      $('confirm-reset').onclick = () => {
        $('modal').close();
        startLocal();
      };
    } else startLocal();
  }
}
function startLocal() {
  resetBoard();
  if (mode === 'puzzle') {
    s.b = Array(64).fill(null);
    s.b[7] = 'k';
    s.b[22] = 'K';
    s.b[13] = 'Q';
    s.rights = '';
  }
  if (mode === 'computer') flipped = botSide === 'b';
  openPracticeRoom();
  render();
  if (mode === 'computer') scheduleBot();
}
$('resume-practice').onclick = () => navigate('/play/' + mode);
$('resume-game').onclick = () => {
  if (remoteGame) navigate('/game/' + remoteGame.id);
};
$('sound').onclick = () => {
  soundsEnabled = !soundsEnabled;
  localStorage.setItem('dc-sounds', soundsEnabled ? 'on' : 'off');
  updatePanel();
  if (soundsEnabled) moveSound();
};
$('new').onclick = start;
$('online').onclick = () => changeMode('online').catch((e) => toast(e.message));
$('local').onclick = () => changeMode('local').catch((e) => toast(e.message));
document.querySelectorAll('[data-control]').forEach(
  (b) =>
    (b.onclick = () => {
      control = b.dataset.control;
      networkEpoch++;
      localStorage.setItem('dc-control', control);
      updatePanel();
      tickClocks();
    })
);
$('account').onclick = () => (user ? profile() : auth());
$('profile-action').onclick = () => (user ? profile() : auth(true));
$('nav-profile').onclick = profile;
$('nav-ratings').onclick = ratings;
$('nav-play').onclick = () => navigate('/');
$('nav-players').onclick = () => navigate('/players');
$('puzzle').onclick = async () => {
  try {
    await changeMode('puzzle');
    if (mode === 'puzzle') startLocal();
  } catch (e) {
    toast(e.message);
  }
};
$('undo').onclick = () => {
  if (mode !== 'online' && (mode !== 'analysis' || variationEditing) && history.length) {
    stopStudy();
    reviewIndex = null;
    let n = mode === 'computer' && s.turn === botSide && history.length > 1 ? 2 : 1;
    while (n-- && history.length) {
      s = history.pop();
      moves.pop();
    }
    selected = -1;
    last = [];
    render();
    if (mode === 'computer') scheduleBot();
  }
};
$('flip').onclick = () => {
  flipped = !flipped;
  render();
};
$('resign').onclick = () => {
  if (!active() || busy) return;
  const id = game.id;
  show(
    'Завершить эту партию?',
    `<p>После сдачи победа будет присуждена сопернику.${game.kind === 'casual' ? ' Дружеская партия не меняет рейтинг.' : ' Результат будет учтён в рейтинге.'}</p><button id="confirm-resign" class="primary">Да, сдаться</button>`
  );
  $('confirm-resign').onclick = () => {
    $('modal').close();
    if (game?.id === id) onlineAction('resign');
  };
};
$('draw').onclick = () => onlineAction('draw');
$('close').onclick = () => $('modal').close();
function closeMenu() {
  $('main-nav').classList.remove('menu-open');
  $('menu-toggle').setAttribute('aria-expanded', 'false');
}
$('menu-toggle').onclick = () => {
  const open = $('main-nav').classList.toggle('menu-open');
  $('menu-toggle').setAttribute('aria-expanded', String(open));
};
$('main-nav').addEventListener('click', (event) => {
  if (event.target.closest('button')) closeMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && $('main-nav').classList.contains('menu-open')) {
    closeMenu();
    $('menu-toggle').focus();
  }
});
$('rules').onclick = () =>
  show(
    'Дом хорошей игры.',
    '<p>Doctor Chess — шахматный клуб на хорошей волне. Найдите соперника, пригласите друга по ссылке или сыграйте с DJ Doctor.</p><p>Для пули, блица, рапида и классики ведутся отдельные рейтинги. Старт — 1200; дружеские партии и тренировки рейтинг не меняют.</p><p>В Школе Доктора изучайте дебюты и решайте задачи. После партии возвращайтесь к важным моментам с разбором Stockfish.</p>'
  );
$('about-club').onclick = $('rules').onclick;
$('privacy-info').onclick = () =>
  show(
    'Ваши партии и данные.',
    '<p>Имя, эмблема, описание, рейтинги и завершённые сетевые партии видны другим игрокам. Войти в активную игровую комнату могут её участники. Зрительский просмотр включается отдельно, только с согласия обоих игроков; любой из них может его закрыть.</p><p>Сетевые партии и рейтинги сохраняются в профиле. Домашние записи, настройки, разборы и прогресс обучения хранятся в браузере на этом устройстве. Очистка данных браузера удаляет эти записи; важные партии можно скачать в PGN.</p><p>Соединение с Doctor Chess защищено HTTPS. Пароли и сессии не видны другим игрокам. Расчёт Stockfish выполняется на вашем устройстве.</p>'
  );
initializeStudio();
initializeLive();
initializeLearning();
initializeWatching();
restoreDesk();
render();
api('me')
  .then(async (x) => {
    user = x.user;
    updateUser();
    await routePage();
    await poll();
    scheduleBot();
  })
  .catch((error) => {
    if (!error.staleSession)
      toast('Не удалось подключиться к Doctor Chess. Проверьте соединение и обновите страницу.');
  });
setInterval(poll, 1000);
setInterval(tickClocks, 200);
