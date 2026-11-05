/* Interactive companion to DJ Doctor's opening handbook. */
const DoctorAcademy = (() => {
  const exercises = [
    {
      title: 'Удержать e4',
      pgn: '1.e4 e5 2.Ke2 Nf6',
      answer: 'd3',
      page: 31,
      prompt: 'Белые. Поддержите центральную пешку, продолжая Атаку Доктора.',
      explanation: 'd3 защищает e4. У короля в центре каждая пешечная опора на счету.',
    },
    {
      title: 'Ранний ферзь',
      pgn: '1.e4 e5 2.Ke2 Qh4',
      answer: 'd3',
      page: 31,
      prompt: 'Белые. Ферзь давит на e4. Сначала укрепите центр.',
      explanation:
        'Сначала d3, затем развитие. Механическое Nf3 оставило бы e4 без достаточной поддержки.',
    },
    {
      title: 'Закрыть линию',
      pgn: '1.e4 e6 2.Ke2 d5',
      answer: 'e5',
      page: 31,
      prompt: 'Белые. Зафиксируйте центр, чтобы избежать немедленного размена на e4.',
      explanation: 'e5 закрывает линию e. Теперь важно следить за подрывами …c5 и …f6.',
    },
    {
      title: 'Цена раннего Ke7',
      pgn: '1.d4 e6 2.c4 Ke7 3.Nc3 d5',
      answer: 'Bg5+',
      page: 31,
      prompt: 'Белые. Найдите развивающий шах по открывшейся диагонали.',
      explanation:
        'Bg5+ использует отсутствие профилактики …h6. Схема не отменяет конкретные угрозы.',
    },
    {
      title: 'Скандинавская ловушка',
      pgn: '1.e4 d5 2.exd5 Qxd5 3.Ke2',
      answer: 'Qe4#',
      page: 32,
      prompt: 'Чёрные. Найдите мат в один ход. За такую ошибку схема наказывает сразу.',
      explanation: 'Qe4# — мат. Поэтому после …d5 нельзя слепо выводить короля на e2.',
    },
  ];
  return { exercises };
})();
let academyBoard = null,
  academyLine = null,
  academyPly = 0,
  academySelected = -1,
  academyExercise = null,
  academySolved = false,
  academyFlipped = false;
let academyLesson = 0,
  academyRehearsal = false,
  academyAssisted = false;
const DoctorPractice = {
  read(raw, count) {
    let data;
    try {
      data = JSON.parse(raw || '{}');
    } catch {
      return {};
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const valid = {};
    for (let i = 0; i < count; i++) {
      const r = data[i];
      if (
        r &&
        Number.isSafeInteger(r.attempts) &&
        r.attempts > 0 &&
        typeof r.needsPractice === 'boolean' &&
        Number.isFinite(r.lastAt) &&
        r.lastAt > 0
      )
        valid[i] = { attempts: r.attempts, needsPractice: r.needsPractice, lastAt: r.lastAt };
    }
    return valid;
  },
  status(records, legacy, i) {
    return records[i]
      ? records[i].needsPractice
        ? 'repeat'
        : 'done'
      : legacy[i] === true
        ? 'done'
        : 'new';
  },
  finish(records, i, assisted, now) {
    return {
      ...records,
      [i]: {
        attempts: Math.min((records[i]?.attempts || 0) + 1, 1000000),
        needsPractice: !!assisted,
        lastAt: now,
      },
    };
  },
};
let academyFilter = 'all';
function practiceRecords() {
  return DoctorPractice.read(localStorage.getItem('dc-practice-v1'), DoctorBook.lines.length);
}
function refreshPractice() {
  const records = practiceRecords(),
    legacy = academyProgress('dc-repertoire');
  const states = DoctorBook.lines.map((_, i) => DoctorPractice.status(records, legacy, i));
  const done = states.filter((x) => x === 'done').length,
    repeat = states.filter((x) => x === 'repeat').length;
  $('academy-meter').value = done;
  $('practice-summary').textContent =
    'Самостоятельно: ' + done + ' из ' + states.length + ' · повторить: ' + repeat;
  $('academy-repeat').disabled = !repeat;
  $('academy-next-new').disabled = states.every((x) => x === 'done');
  document.querySelectorAll('[data-lesson]').forEach((b) => {
    const i = Number(b.dataset.lesson),
      state = states[i],
      [side, title, page] = DoctorBook.lines[i];
    b.hidden = academyFilter !== 'all' && state !== academyFilter;
    b.querySelector('strong').textContent = title;
    b.querySelector('span').textContent =
      (side === 'w' ? '♔ Атака' : '♚ Защита') +
      ' · стр. ' +
      page +
      ' · ' +
      { done: '✓ Пройдено', repeat: '↻ Повторить', new: 'Не пройдено' }[state];
  });
  for (const filter of ['all', 'new', 'repeat'])
    $('practice-filter-' + filter).setAttribute('aria-pressed', String(filter === academyFilter));
}
function nextAcademyPractice(repeatOnly = false) {
  const records = practiceRecords(),
    legacy = academyProgress('dc-repertoire');
  const i = DoctorBook.lines.findIndex((_, n) =>
    repeatOnly
      ? DoctorPractice.status(records, legacy, n) === 'repeat'
      : DoctorPractice.status(records, legacy, n) !== 'done'
  );
  if (i < 0)
    return toast('Все варианты уже пройдены самостоятельно. Можно повторить любой из списка.');
  academyLesson = i;
  startAcademyRehearsal();
  $('academy-title').scrollIntoView?.({ block: 'start', behavior: 'smooth' });
}
function academyCanPlay() {
  return (
    !academySolved &&
    (!!academyExercise ||
      (academyRehearsal &&
        academyLine.positions[academyPly].turn === DoctorBook.lines[academyLesson][0]))
  );
}
function startAcademyRehearsal() {
  loadAcademyLesson(academyLesson);
  academyRehearsal = true;
  academyAssisted = false;
  academyFlipped = DoctorBook.lines[academyLesson][0] === 'b';
  if (academyFlipped) academyPly = 1;
  $('academy-prompt').textContent =
    'Вы играете ходы Доктора из учебника. Соперник отвечает по выбранной линии. Это репетиция, а не свободная партия.';
  $('academy-feedback').textContent = 'Ваш ход. Вспомните план.';
  $('academy-answer').hidden = false;
  $('academy-answer').disabled = false;
  renderAcademy();
}
function academyRehearseMove(from, to) {
  const move = academyLine.records[academyPly];
  if (!move || move.from !== from || move.to !== to) {
    $('academy-feedback').textContent =
      'Допустимый ход, но в этом варианте учебника продолжение другое. Попробуйте ещё или откройте подсказку.';
    return;
  }
  academyPly++;
  const line = academyLine;
  const finish = () => {
    if (!academyBoard || academyLine !== line || !academyRehearsal) return;
    if (academyPly >= line.records.length) {
      academySolved = true;
      $('academy-feedback').textContent = academyAssisted
        ? 'Вариант пройден с подсказкой. Повторите самостоятельно, чтобы закрепить.'
        : 'Весь вариант сыгран самостоятельно. Отличная работа!';
      if (!academyAssisted) {
        let saved;
        try {
          saved = JSON.parse(localStorage.getItem('dc-repertoire') || '{}');
        } catch {
          saved = {};
        }
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
        saved[academyLesson] = true;
        try {
          localStorage.setItem('dc-repertoire', JSON.stringify(saved));
        } catch {
          toast('Не удалось сохранить прогресс репетиции.');
        }
      }
      try {
        localStorage.setItem(
          'dc-practice-v1',
          JSON.stringify(
            DoctorPractice.finish(practiceRecords(), academyLesson, academyAssisted, Date.now())
          )
        );
      } catch {
        toast('Не удалось сохранить прогресс обучения.');
      }
      refreshPractice();
      $('academy-answer').hidden = true;
    } else
      $('academy-feedback').textContent =
        'Ответ соперника: ' + line.sans[academyPly - 1] + '. Ваш ход.';
    renderAcademy();
  };
  renderAcademy();
  if (
    academyPly < line.records.length &&
    line.positions[academyPly].turn !== DoctorBook.lines[academyLesson][0]
  ) {
    $('academy-feedback').textContent = 'Соперник отвечает…';
    setTimeout(() => {
      if (!academyBoard || academyLine !== line || !academyRehearsal) return;
      academyPly++;
      finish();
    }, 400);
  } else finish();
}
function academyProgress(key = 'dc-academy') {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}
function showAcademy() {
  communityShell();
  communityNav('nav-academy');
  document.title = 'Школа Доктора · Doctor Chess';
  const progress = academyProgress(),
    completed = academyProgress('dc-repertoire');
  $('community-page').innerHTML =
    `<div class="breadcrumbs"><a href="/">Игровая комната</a><span>/</span><span>Школа Доктора</span></div><header class="academy-heading"><span class="academy-seal">学</span><div><div class="eyebrow">DJ DOCTOR · ДЕБЮТНАЯ МАСТЕРСКАЯ</div><h1>Свой путь в центре.</h1><p>Атака Доктора за белых. Защита Доктора за чёрных.<br>Сначала понимаем план, потом двигаем фигуры.</p></div></header><section class="practice-dashboard" aria-label="Прогресс обучения"><p class="eyebrow">ВАША ДЕБЮТНАЯ ТЕТРАДЬ</p><h2 id="practice-summary"></h2><progress id="academy-meter" max="15" value="0" aria-label="Самостоятельно пройденные варианты"></progress><div class="academy-buttons"><button id="academy-continue" class="primary">Продолжить последний вариант →</button><button id="academy-next-new" class="outline">Следующий непройденный</button><button id="academy-repeat" class="outline">Повторить с подсказками ↻</button></div><p>Прогресс хранится в этом браузере. Подсказки помогают учиться; после них вариант остаётся в списке повторения.</p></section><div class="academy-layout"><aside class="academy-list"><h2>Дебютная тетрадь</h2><div class="practice-filters" role="group" aria-label="Фильтр вариантов"><button id="practice-filter-all" aria-pressed="true">Все</button><button id="practice-filter-new" aria-pressed="false">Новые</button><button id="practice-filter-repeat" aria-pressed="false">Повторить</button></div><p>Линии из учебника DJ Doctor · 2026</p>${DoctorBook.lines.map(([side, title, page], i) => `<button data-lesson="${i}"><span>${side === 'w' ? '♔ Атака' : '♚ Защита'} · стр. ${page}</span><strong>${title}${completed[i] ? ' · ✓' : ''}</strong></button>`).join('')}<h2>Проверь себя</h2><p id="academy-progress">${DoctorAcademy.exercises.filter((_, i) => progress[i]).length} из ${DoctorAcademy.exercises.length} задач решено на этом устройстве</p>${DoctorAcademy.exercises.map((x, i) => `<button data-exercise="${i}"><span>ЗАДАЧА ${i + 1} ${progress[i] ? '· ✓ РЕШЕНА' : ''}</span><strong>${x.title}</strong></button>`).join('')}</aside><section class="academy-workspace"><p class="eyebrow" id="academy-label"></p><h2 id="academy-title"></h2><p id="academy-prompt"></p><div class="board-frame academy-frame"><div id="academy-board" class="chessboard" role="group" aria-label="Учебная шахматная доска"></div></div><div class="academy-controls"><button id="academy-first" aria-label="Начало учебного варианта">|‹</button><button id="academy-prev" aria-label="Предыдущий учебный ход">‹</button><span id="academy-position"></span><button id="academy-next" aria-label="Следующий учебный ход">›</button><button id="academy-last" aria-label="Конец учебного варианта">›|</button></div><p id="academy-feedback" class="academy-feedback" role="status"></p><div class="academy-buttons"><button id="academy-rehearse" class="outline">Отрепетировать вариант</button><button id="academy-train" class="primary">С доктором из этой позиции →</button><button id="academy-answer" class="outline" hidden>Показать ответ</button><button id="academy-retry" class="outline" hidden>Попробовать ещё раз</button></div><p class="academy-footnote">Необычный выход короля лишает рокировки. Это авторский учебный репертуар; при шахах и вскрытии центра конкретный расчёт важнее схемы.</p></section></div>`;
  academyBoard = new ChessBoardView($('academy-board'), {
    piece,
    onClick: academyPick,
    onPick: (i) => {
      academySelected = i;
      renderAcademy();
    },
    canDrag: (i) =>
      academyCanPlay() &&
      color(academyLine.positions[academyPly].b[i]) === academyLine.positions[academyPly].turn,
    onDrop: (i, j) => {
      academySelected = i;
      academyPick(j);
    },
  });
  document
    .querySelectorAll('[data-lesson]')
    .forEach((b) => (b.onclick = () => loadAcademyLesson(Number(b.dataset.lesson))));
  document
    .querySelectorAll('[data-exercise]')
    .forEach((b) => (b.onclick = () => loadAcademyExercise(Number(b.dataset.exercise))));
  $('academy-first').onclick = () => academyStep(0);
  $('academy-prev').onclick = () => academyStep(academyPly - 1);
  $('academy-next').onclick = () => academyStep(academyPly + 1);
  $('academy-last').onclick = () => academyStep(academyLine.records.length);
  $('academy-answer').onclick = () => {
    if (academyRehearsal) {
      if (!academyCanPlay()) return;
      academyAssisted = true;
      $('academy-feedback').textContent = 'По учебнику: ' + academyLine.sans[academyPly];
      return;
    }
    $('academy-feedback').textContent =
      'Ответ: ' + academyExercise.answer + '. ' + academyExercise.explanation;
    $('academy-answer').disabled = true;
  };
  $('academy-retry').onclick = () =>
    loadAcademyExercise(DoctorAcademy.exercises.indexOf(academyExercise));
  $('academy-train').onclick = async () => {
    const position = JSON.parse(JSON.stringify(academyLine.positions[academyPly]));
    if (moves.length && !game) archiveCurrent(true);
    navigate('/');
    await changeMode('computer');
    resetBoard();
    s = position;
    botSide = position.turn;
    flipped = botSide === 'b';
    openPracticeRoom();
    render();
    toast('Вы играете ' + (botSide === 'w' ? 'белыми' : 'чёрными') + ' из учебной позиции.');
  };
  loadAcademyLesson(0, false);
  academyFilter = 'all';
  refreshPractice();
  $('academy-next-new').onclick = () => nextAcademyPractice();
  $('academy-repeat').onclick = () => nextAcademyPractice(true);
  $('academy-continue').onclick = () => {
    const saved = localStorage.getItem('dc-academy-last');
    const i = Number(saved);
    academyLesson =
      saved !== null && Number.isInteger(i) && i >= 0 && i < DoctorBook.lines.length ? i : 0;
    startAcademyRehearsal();
    $('academy-title').scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  };
  for (const filter of ['all', 'new', 'repeat'])
    $('practice-filter-' + filter).onclick = () => {
      academyFilter = filter;
      refreshPractice();
    };
}
function loadAcademyLesson(i, remember = true) {
  if (remember) {
    try {
      localStorage.setItem('dc-academy-last', String(i));
    } catch {}
  }
  academyLesson = i;
  academyRehearsal = false;
  const [side, title, page, pgn] = DoctorBook.lines[i];
  academyExercise = null;
  academyFlipped = false;
  academySolved = false;
  academyLine = ChessNotation.fromPGN(pgn + ' *');
  academyPly = 0;
  academySelected = -1;
  $('academy-label').textContent =
    (side === 'w' ? 'АТАКА ДОКТОРА' : 'ЗАЩИТА ДОКТОРА') + ' · СТР. ' + page;
  $('academy-title').textContent = title;
  $('academy-prompt').textContent =
    'Листайте ходы. В любой позиции можно продолжить тренировку против Доктора.';
  $('academy-feedback').textContent = '';
  $('academy-answer').hidden = true;
  $('academy-retry').hidden = true;
  renderAcademy();
}
function loadAcademyExercise(i) {
  academyRehearsal = false;
  academyExercise = DoctorAcademy.exercises[i];
  academyLine = ChessNotation.fromPGN(academyExercise.pgn + ' *');
  academyPly = academyLine.records.length;
  academyFlipped = academyLine.positions[academyPly].turn === 'b';
  academySelected = -1;
  academySolved = false;
  $('academy-label').textContent = 'ЗАДАЧА ' + (i + 1) + ' · СТР. ' + academyExercise.page;
  $('academy-title').textContent = academyExercise.title;
  $('academy-prompt').textContent = academyExercise.prompt;
  $('academy-feedback').textContent =
    'Сделайте ход на доске — мышью, перетаскиванием или с клавиатуры.';
  $('academy-answer').hidden = false;
  $('academy-answer').disabled = false;
  $('academy-retry').hidden = false;
  renderAcademy();
}
function academyStep(n) {
  if (academyExercise || academyRehearsal) return;
  academyPly = Math.max(0, Math.min(n, academyLine.records.length));
  academySelected = -1;
  renderAcademy();
}
function renderAcademy() {
  const state = academyLine.positions[academyPly],
    record = academyLine.records[academyPly - 1];
  academyBoard.render(
    state,
    academyFlipped,
    academySelected,
    academySelected >= 0 && academyCanPlay() ? legal(state, academySelected) : [],
    record ? [record.from, record.to] : [],
    check(state, state.turn) ? state.b.indexOf(state.turn === 'w' ? 'K' : 'k') : -1
  );
  $('academy-position').textContent = academyExercise
    ? academySolved
      ? 'Верно ✓'
      : 'Ваш ход'
    : academyPly +
      ' / ' +
      academyLine.records.length +
      (academyPly ? ' · ' + academyLine.sans[academyPly - 1] : ' · Старт');
  for (const id of ['academy-first', 'academy-prev'])
    $(id).disabled = !!academyExercise || academyRehearsal || academyPly === 0;
  for (const id of ['academy-next', 'academy-last'])
    $(id).disabled =
      !!academyExercise || academyRehearsal || academyPly === academyLine.records.length;
  $('academy-rehearse').hidden = !!academyExercise;
  $('academy-rehearse').textContent = academyRehearsal
    ? academySolved
      ? 'Повторить вариант'
      : 'Вернуться к просмотру'
    : 'Отрепетировать вариант';
  $('academy-rehearse').onclick = () =>
    academyRehearsal && !academySolved ? loadAcademyLesson(academyLesson) : startAcademyRehearsal();
  $('academy-train').disabled = academyRehearsal && !academySolved && !academyCanPlay();
}
function academyPick(to) {
  if (!academyCanPlay()) return;
  const state = academyLine.positions[academyPly],
    from = academySelected;
  if (from >= 0 && legal(state, from).includes(to)) {
    if (academyRehearsal) {
      academySelected = -1;
      academyRehearseMove(from, to);
      renderAcademy();
      return;
    }
    const answer = ChessNotation.san(state, { from, to, promotion: 'q' });
    academySelected = -1;
    if (answer === academyExercise.answer) {
      const next = apply(state, from, to);
      academyLine.positions.push(next);
      academyLine.records.push({ from, to, promotion: 'q' });
      academyLine.sans.push(answer);
      academyPly++;
      academySolved = true;
      const progress = academyProgress();
      // Revealed solutions remain practice; they do not mark a task solved.
      if (!$('academy-answer').disabled) {
        progress[DoctorAcademy.exercises.indexOf(academyExercise)] = true;
        localStorage.setItem('dc-academy', JSON.stringify(progress));
      }
      $('academy-feedback').textContent = 'Верно! ' + academyExercise.explanation;
      $('academy-answer').hidden = true;
      const currentProgress = academyProgress();
      $('academy-progress').textContent =
        DoctorAcademy.exercises.filter((_, i) => currentProgress[i]).length +
        ' из ' +
        DoctorAcademy.exercises.length +
        ' задач решено на этом устройстве';
      document.querySelectorAll('[data-exercise]').forEach((b) => {
        const i = Number(b.dataset.exercise);
        b.querySelector('span').textContent =
          'ЗАДАЧА ' + (i + 1) + (currentProgress[i] ? ' · ✓ РЕШЕНА' : '');
      });
    } else
      $('academy-feedback').textContent =
        answer + ' — допустимый ход, но здесь ищем другой план. Попробуйте ещё.';
  } else academySelected = color(state.b[to]) === state.turn ? to : -1;
  renderAcademy();
}
