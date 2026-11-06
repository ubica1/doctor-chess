/* A personal device-based rehearsal deck made from the player's own analysis. */
const MistakeDeck = (() => {
  const N = typeof module !== 'undefined' ? require('./notation.js') : ChessNotation;
  const E = typeof module !== 'undefined' ? require('./engine.js') : { legal, color };
  function key(fen, move) {
    const text = fen + ':' + move.from + ':' + move.to + ':' + (move.promotion || 'q');
    let a = 2166136261,
      b = 5381;
    for (const char of text) {
      a = Math.imul(a ^ char.charCodeAt(0), 16777619);
      b = Math.imul(b, 33) ^ char.charCodeAt(0);
    }
    return 'm' + (a >>> 0).toString(16) + '_' + (b >>> 0).toString(16);
  }
  function read(raw) {
    let values;
    try {
      values = JSON.parse(raw || '[]');
    } catch {
      return [];
    }
    if (!Array.isArray(values)) return [];
    const seen = new Set(),
      out = [];
    for (const row of values.slice(0, 100)) {
      try {
        if (
          !row ||
          typeof row.fen !== 'string' ||
          row.fen.length > 180 ||
          typeof row.source !== 'string' ||
          row.source.length > 80 ||
          typeof row.actual !== 'string' ||
          row.actual.length > 24 ||
          !['inaccuracy', 'mistake', 'blunder'].includes(row.grade)
        )
          continue;
        const position = N.fromFEN(row.fen),
          move = row.move;
        if (
          !move ||
          !Number.isInteger(move.from) ||
          !Number.isInteger(move.to) ||
          !['q', 'r', 'b', 'n'].includes(move.promotion || 'q') ||
          E.color(position.b[move.from]) !== position.turn ||
          !E.legal(position, move.from).includes(move.to)
        )
          continue;
        if (
          move.promotion &&
          move.promotion !== 'q' &&
          !(position.b[move.from]?.toLowerCase() === 'p' && (move.to < 8 || move.to >= 56))
        )
          continue;
        const id = key(row.fen, move);
        if (seen.has(id)) continue;
        if (
          !['created', 'due', 'lastAttempt'].every(
            (field) => Number.isFinite(row[field]) && row[field] >= 0
          ) ||
          !['attempts', 'streak', 'solved'].every(
            (field) => Number.isSafeInteger(row[field]) && row[field] >= 0 && row[field] < 1000000
          )
        )
          continue;
        seen.add(id);
        out.push({
          id,
          fen: row.fen,
          move: { from: move.from, to: move.to, promotion: move.promotion || 'q' },
          best: N.san(position, move),
          actual: row.actual,
          grade: row.grade,
          source: row.source,
          created: row.created,
          due: row.due,
          lastAttempt: row.lastAttempt,
          attempts: row.attempts,
          streak: row.streak,
          solved: row.solved,
        });
      } catch {}
    }
    return out;
  }
  function add(rows, item, now = Date.now()) {
    const normalized = read(
      JSON.stringify([
        { ...item, created: now, due: 0, lastAttempt: 0, attempts: 0, streak: 0, solved: 0 },
      ])
    );
    if (!normalized.length)
      throw Error('В разборе нет допустимого рекомендованного хода для этой позиции.');
    if (rows.some((row) => row.id === normalized[0].id)) return { rows, added: false };
    if (rows.length >= 100) throw Error('В повторении уже 100 позиций. Уберите одну из освоенных.');
    return { rows: [...rows, normalized[0]], added: true };
  }
  function attempt(row, correct, assisted, now = Date.now()) {
    const next = { ...row, attempts: row.attempts + 1, lastAttempt: now };
    if (correct && !assisted) {
      next.solved++;
      next.streak++;
      next.due = now + [1, 3, 7, 14][Math.min(3, next.streak - 1)] * 86400000;
    } else {
      next.streak = 0;
      next.due = now + 300000;
    }
    return next;
  }
  return { key, read, add, attempt };
})();
if (typeof module !== 'undefined') module.exports = MistakeDeck;
let mistakePractice = null,
  mistakeBoard = null;
function mistakeStorageKey() {
  return 'dc-mistakes-v1:' + (user?.id || 'guest');
}
function mistakeRecords() {
  try {
    return MistakeDeck.read(localStorage.getItem(mistakeStorageKey()));
  } catch {
    return [];
  }
}
function saveMistakeRecords(records, scope = mistakeStorageKey()) {
  try {
    localStorage.setItem(scope, JSON.stringify(records));
    return true;
  } catch {
    toast('Не хватает места для сохранения повторения. Скачайте важную партию в PGN.');
    return false;
  }
}
function closeMistakePractice() {
  mistakeBoard?.destroy();
  mistakeBoard = null;
  mistakePractice = null;
}
function reportMistakeItem(row, line = currentLine()) {
  const position = line.positions[row.ply - 1];
  const expected = ChessNotation.fromPGN(
    `[SetUp "1"]\n[FEN "${ChessNotation.fen(position)}"]\n\n${row.best} *`
  ).records[0];
  if (!expected) throw Error('Для этой позиции пока нет рекомендации.');
  return {
    fen: ChessNotation.fen(position),
    move: expected,
    actual: row.san,
    grade: row.grade,
    source: (studyTags().White + ' — ' + studyTags().Black).slice(0, 80),
  };
}
function saveReportMistakes(ply = null) {
  if (learningMatchActive() || !reportData || reportIdentity !== reportKey()) return;
  let rows = mistakeRecords(),
    added = 0,
    full = false;
  for (const row of reportData.rows.filter(
    (row) => row.grade !== 'good' && (ply === null || row.ply === ply)
  )) {
    try {
      const next = MistakeDeck.add(rows, reportMistakeItem(row));
      rows = next.rows;
      if (next.added) added++;
    } catch {
      if (rows.length >= 100) {
        full = true;
        break;
      }
    }
  }
  if (saveMistakeRecords(rows))
    toast(
      added
        ? `Добавлено в повторение: ${added}${full ? ' · достигнут лимит 100 позиций' : ''}`
        : full
          ? 'В повторении уже 100 позиций.'
          : 'Эти позиции уже сохранены или пока не имеют рекомендации.'
    );
}
function recordMistakeAttempt(correct, assisted) {
  const session = mistakePractice,
    index = session.records.findIndex((row) => row.id === session.item.id);
  if (index < 0) return;
  session.records[index] = MistakeDeck.attempt(session.records[index], correct, assisted);
  session.item = session.records[index];
  saveMistakeRecords(session.records, session.scope);
  refreshMistakeStats();
}
function refreshMistakeStats() {
  if (!mistakePractice) return;
  const rows = mistakePractice.records,
    now = Date.now();
  document.querySelectorAll('[data-mistake-id]').forEach((button) => {
    const row = rows.find((item) => item.id === button.dataset.mistakeId);
    if (row)
      button.querySelector('small').textContent =
        (row.due <= now ? 'Пора повторить' : 'На повторении') +
        ' · ' +
        row.solved +
        ' ' +
        plural(row.solved, ['решение', 'решения', 'решений']);
  });
  $('mistake-stats').textContent =
    `${rows.length} ${plural(rows.length, ['позиция', 'позиции', 'позиций'])} · к повторению: ${rows.filter((row) => row.due <= now).length} · самостоятельных решений: ${rows.reduce((sum, row) => sum + row.solved, 0)}`;
}
function renderMistakeBoard() {
  if (!mistakePractice?.item || !mistakeBoard) return;
  const session = mistakePractice,
    state = session.done
      ? apply(
          session.position,
          session.item.move.from,
          session.item.move.to,
          session.item.move.promotion
        )
      : session.position;
  mistakeBoard.render(
    state,
    session.flipped,
    session.selected,
    session.selected >= 0 && !session.done ? legal(state, session.selected) : [],
    session.done ? [session.item.move.from, session.item.move.to] : [],
    check(state, state.turn) ? state.b.indexOf(state.turn === 'w' ? 'K' : 'k') : -1
  );
}
function selectMistake(id) {
  if (!mistakePractice) return;
  const item = mistakePractice.records.find((row) => row.id === id);
  if (!item) return;
  Object.assign(mistakePractice, {
    item,
    position: ChessNotation.fromFEN(item.fen),
    selected: -1,
    done: false,
    assisted: false,
    attempted: false,
    flipped: ChessNotation.fromFEN(item.fen).turn === 'b',
  });
  $('mistake-source').textContent = item.source;
  $('mistake-prompt').textContent =
    (mistakePractice.position.turn === 'w' ? 'Белые' : 'Чёрные') +
    ': в партии было ' +
    item.actual +
    '. Найдите рекомендацию из разбора.';
  $('mistake-feedback').textContent = '';
  $('mistake-answer').disabled = false;
  $('mistake-list').innerHTML = mistakePractice.records
    .map(
      (row) =>
        `<button data-mistake-id="${row.id}" ${row.id === id ? 'aria-current="true"' : ''}><strong>Вместо ${escapeHtml(row.actual)}</strong><span>${escapeHtml(row.source)}</span><small>${row.due <= Date.now() ? 'Пора повторить' : 'На повторении'} · ${row.solved} ${plural(row.solved, ['решение', 'решения', 'решений'])}</small></button>`
    )
    .join('');
  document
    .querySelectorAll('[data-mistake-id]')
    .forEach((button) => (button.onclick = () => selectMistake(button.dataset.mistakeId)));
  renderMistakeBoard();
  refreshMistakeStats();
  updateMistakeSafety();
}
function mistakeSquare(to) {
  const session = mistakePractice;
  if (!session?.item || session.done || learningMatchActive()) return;
  const state = session.position,
    from = session.selected;
  if (from >= 0 && legal(state, from).includes(to)) {
    const answer = (promotion) => {
      if (mistakePractice !== session || learningMatchActive()) return;
      const expected = session.item.move;
      if (from === expected.from && to === expected.to && promotion === expected.promotion) {
        recordMistakeAttempt(true, session.assisted);
        session.done = true;
        session.selected = -1;
        $('mistake-feedback').textContent = session.assisted
          ? `Рекомендация: ${session.item.best}. Повторите позже без подсказки.`
          : `Да, ${session.item.best}. Следующее повторение — через ${[1, 3, 7, 14][Math.min(3, session.item.streak - 1)]} дн.`;
      } else {
        if (!session.attempted) {
          recordMistakeAttempt(false, false);
          session.attempted = true;
        }
        session.assisted = true;
        session.selected = -1;
        $('mistake-feedback').textContent =
          'Ход допустим, но в разборе рекомендован другой. Попробуйте найти его или откройте ответ.';
      }
      renderMistakeBoard();
      updateMistakeSafety();
    };
    if (state.b[from].toLowerCase() === 'p' && (to < 8 || to >= 56))
      return chooseLearningPromotion(answer);
    return answer('q');
  }
  session.selected = color(state.b[to]) === state.turn ? to : -1;
  renderMistakeBoard();
}
function updateMistakeSafety() {
  if (!mistakePractice?.item) return;
  $('mistake-answer').disabled = !!learningMatchActive() || mistakePractice.done;
  $('mistake-study').disabled = !!learningMatchActive();
  if (learningMatchActive())
    $('mistake-feedback').textContent =
      'Сетевая партия продолжается. Вернитесь к ней, а повторение оставьте на потом.';
}
function loadMistakePractice() {
  communityNav('nav-import');
  $('game-page').hidden = true;
  $('community-page').hidden = false;
  document.title = 'Работа над ошибками · Doctor Chess';
  const records = mistakeRecords();
  $('community-page').innerHTML =
    `<section class="workspace-heading"><span class="workspace-seal">复</span><div><p>РАБОТА НАД ОШИБКАМИ</p><h1>Вернитесь и найдите свой ход.</h1><p>Повторяйте рекомендации из собственных разборов. Это тренировка памяти и решений, а не задача с единственным верным ответом.</p></div></section>${workspaceLinks('practice')}<p id="mistake-stats" class="practice-stats"></p>${records.length ? '<div class="mistake-layout"><section><h2 id="mistake-source"></h2><p id="mistake-prompt"></p><div class="board-frame"><div class="board-rim"><div id="mistake-board" tabindex="0" role="group" aria-label="Повторение позиции из разбора"></div></div></div><p id="mistake-feedback" role="status"></p><div class="study-board-tools"><button id="mistake-answer">Показать рекомендацию</button><button id="mistake-next">Следующая позиция</button><button id="mistake-retry">Повторить</button><button id="mistake-study">В исследование</button><button id="mistake-remove">Убрать позицию</button></div></section><aside class="notebook-paper"><h2>Ваше повторение</h2><p>Ошибку повторяем через пять минут; самостоятельное решение — через 1, 3, 7 и затем 14 дней.</p><div id="mistake-list" class="mistake-list"></div><p class="muted">До 100 позиций. Повторение хранится на этом устройстве отдельно для каждого профиля.</p></aside></div>' : '<div class="page-empty"><h2>Здесь появятся ваши поворотные моменты.</h2><p>Откройте завершённую партию, запустите разбор и нажмите «Сохранить ошибки в повторение».</p><button id="mistake-library">Открыть мои партии</button></div>'}`;
  mistakePractice = { records, item: null, scope: mistakeStorageKey() };
  refreshMistakeStats();
  if (!records.length) {
    $('mistake-library').onclick = openLibrary;
    return;
  }
  mistakeBoard = new ChessBoardView($('mistake-board'), {
    piece,
    onClick: mistakeSquare,
    onPick: (i) => {
      if (mistakePractice) {
        mistakePractice.selected = i;
        renderMistakeBoard();
      }
    },
    canDrag: (i) =>
      !learningMatchActive() &&
      !mistakePractice.done &&
      color(mistakePractice.position.b[i]) === mistakePractice.position.turn,
    onDrop: (from, to) => {
      if (mistakePractice) {
        mistakePractice.selected = from;
        mistakeSquare(to);
      }
    },
  });
  $('mistake-answer').onclick = () => {
    if (learningMatchActive() || !mistakePractice?.item || mistakePractice.done) return;
    mistakePractice.assisted = true;
    mistakePractice.done = true;
    recordMistakeAttempt(false, true);
    $('mistake-feedback').textContent =
      'Рекомендованный ход: ' + mistakePractice.item.best + '. Повторите его позже самостоятельно.';
    renderMistakeBoard();
  };
  $('mistake-next').onclick = () => {
    const sorted = [...mistakePractice.records].sort(
      (a, b) => a.due - b.due || a.lastAttempt - b.lastAttempt
    );
    const next = sorted.find((row) => row.id !== mistakePractice.item.id) || sorted[0];
    selectMistake(next.id);
  };
  $('mistake-retry').onclick = () => selectMistake(mistakePractice.item.id);
  $('mistake-study').onclick = () =>
    seedNotebook(
      StudyTree.create(mistakePractice.item.fen),
      'Повторение: ' + mistakePractice.item.source
    );
  $('mistake-remove').onclick = () => {
    const id = mistakePractice.item.id,
      scope = mistakePractice.scope;
    show(
      'Убрать позицию из повторения?',
      '<p>Запись партии сохранится. Прогресс повторения этой позиции будет удалён с устройства.</p><button id="mistake-confirm-remove" class="primary">Убрать позицию</button>'
    );
    const epoch = notebookEpoch;
    $('mistake-confirm-remove').onclick = () => {
      $('modal').close();
      if (epoch !== notebookEpoch || !mistakePractice) return;
      saveMistakeRecords(
        mistakePractice.records.filter((row) => row.id !== id),
        scope
      );
      closeMistakePractice();
      loadMistakePractice();
    };
  };
  const first = [...records].sort((a, b) => a.due - b.due || a.lastAttempt - b.lastAttempt)[0];
  selectMistake(first.id);
}
