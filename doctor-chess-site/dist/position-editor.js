/* Position editor has its own board and never mutates an active game. */
let positionEditor = null,
  positionEditorBoard = null;
function closePositionEditor() {
  positionEditorBoard?.destroy();
  positionEditorBoard = null;
  positionEditor = null;
}
function editorSnapshot() {
  return copyStudy({
    b: positionEditor.b,
    turn: positionEditor.turn,
    rights: positionEditor.rights,
    ep: positionEditor.ep,
    half: positionEditor.half,
    fullmove: positionEditor.fullmove,
  });
}
function editorCheckpoint() {
  positionEditor.undo.push(editorSnapshot());
  positionEditor.undo = positionEditor.undo.slice(-50);
}
function editorFEN() {
  const rows = [];
  for (let rank = 0; rank < 8; rank++) {
    let row = '',
      empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = positionEditor.b[rank * 8 + file];
      if (!p) empty++;
      else {
        if (empty) row += empty;
        empty = 0;
        row += p;
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join('/')} ${positionEditor.turn} ${positionEditor.rights || '-'} ${positionEditor.ep || '-'} ${positionEditor.half} ${positionEditor.fullmove}`;
}
function editorPaint(to) {
  if (!positionEditor) return;
  if (positionEditor.brush === 'move') {
    const from = positionEditor.selected;
    if (from >= 0 && from !== to && positionEditor.b[from]) {
      editorCheckpoint();
      positionEditor.b[to] = positionEditor.b[from];
      positionEditor.b[from] = null;
      positionEditor.selected = -1;
    } else positionEditor.selected = positionEditor.b[to] ? to : -1;
  } else {
    editorCheckpoint();
    positionEditor.b[to] = positionEditor.brush || null;
    positionEditor.selected = -1;
  }
  editorRemoveImpossibleRights();
  renderPositionEditor();
}
function editorRemoveImpossibleRights() {
  const b = positionEditor.b;
  positionEditor.rights = [...positionEditor.rights]
    .filter(
      (right) =>
        ({
          K: b[60] === 'K' && b[63] === 'R',
          Q: b[60] === 'K' && b[56] === 'R',
          k: b[4] === 'k' && b[7] === 'r',
          q: b[4] === 'k' && b[0] === 'r',
        })[right]
    )
    .join('');
}
function renderPositionEditor() {
  if (!positionEditor || !positionEditorBoard) return;
  const fen = editorFEN();
  try {
    positionEditor.valid = ChessNotation.fromFEN(fen);
    $('editor-validation').textContent =
      'Позиция готова · ' + (positionEditor.turn === 'w' ? 'ход белых' : 'ход чёрных');
    $('editor-validation').dataset.valid = 'yes';
  } catch (error) {
    positionEditor.valid = null;
    $('editor-validation').textContent = error.message;
    $('editor-validation').dataset.valid = 'no';
  }
  positionEditorBoard.render(
    { b: positionEditor.b, turn: positionEditor.turn, rights: positionEditor.rights, ep: -1 },
    positionEditor.flipped,
    positionEditor.selected,
    [],
    []
  );
  $('editor-fen').value = fen;
  $('editor-turn').value = positionEditor.turn;
  $('editor-ep').value = positionEditor.ep;
  $('editor-half').value = positionEditor.half;
  $('editor-fullmove').value = positionEditor.fullmove;
  document
    .querySelectorAll('[data-editor-right]')
    .forEach((box) => (box.checked = positionEditor.rights.includes(box.dataset.editorRight)));
  document
    .querySelectorAll('[data-editor-piece]')
    .forEach((button) =>
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.editorPiece === positionEditor.brush)
      )
    );
  $('editor-undo').disabled = !positionEditor.undo.length;
  $('editor-study').disabled = $('editor-copy').disabled = !positionEditor.valid;
  $('editor-train').disabled =
    !positionEditor.valid || !!end(positionEditor.valid, []) || !!learningMatchActive() || busy;
  try {
    sessionStorage.setItem('dc-position-editor', JSON.stringify(editorSnapshot()));
  } catch {}
}
function loadPositionEditor() {
  communityNav('nav-import');
  $('game-page').hidden = true;
  $('community-page').hidden = false;
  document.title = 'Редактор позиций · Doctor Chess';
  const state = initial();
  let saved = null;
  try {
    const raw = JSON.parse(sessionStorage.getItem('dc-position-editor') || 'null');
    if (
      raw &&
      Array.isArray(raw.b) &&
      raw.b.length === 64 &&
      raw.b.every((p) => p === null || (typeof p === 'string' && /^[KQRBNPkqrbnp]$/.test(p)))
    ) {
      saved = {
        b: raw.b,
        turn: raw.turn === 'b' ? 'b' : 'w',
        rights:
          typeof raw.rights === 'string'
            ? [...'KQkq'].filter((right) => raw.rights.includes(right)).join('')
            : '',
        ep: typeof raw.ep === 'string' && /^(?:[a-h][36])?$/.test(raw.ep) ? raw.ep : '',
        half: Number.isSafeInteger(raw.half) && raw.half >= 0 && raw.half <= 10000 ? raw.half : 0,
        fullmove:
          Number.isSafeInteger(raw.fullmove) && raw.fullmove >= 1 && raw.fullmove <= 10000
            ? raw.fullmove
            : 1,
      };
    }
  } catch {}
  positionEditor = {
    b: state.b.slice(),
    turn: 'w',
    rights: 'KQkq',
    ep: '',
    half: 0,
    fullmove: 1,
    ...saved,
    selected: -1,
    brush: 'move',
    flipped: false,
    undo: [],
    valid: null,
  };
  $('community-page').innerHTML =
    `<section class="workspace-heading"><span class="workspace-seal">局</span><div><p>РЕДАКТОР ПОЗИЦИЙ</p><h1>Начните с интересного места.</h1><p>Расставьте фигуры, проверьте позицию и продолжите её исследование.</p></div></section>${workspaceLinks('editor')}<div class="position-editor-layout"><section><div class="board-frame"><div class="board-rim"><div id="editor-board" tabindex="0" role="group" aria-label="Редактор шахматной позиции"></div></div></div><div class="study-board-tools"><button id="editor-undo">Отменить</button><button id="editor-flip">Перевернуть</button><button id="editor-start">Начальная позиция</button><button id="editor-empty">Очистить доску</button></div><p id="editor-validation" role="status"></p></section><aside class="notebook-paper"><h2>Ваши фигуры</h2><p>Выберите фигуру и нажмите на клетку. В режиме перемещения фигуры можно перетаскивать.</p><div class="editor-palette">${'KQRBNPkqrbnp'
      .split('')
      .map(
        (p) =>
          `<button data-editor-piece="${p}" aria-label="${{ k: 'Король', q: 'Ферзь', r: 'Ладья', b: 'Слон', n: 'Конь', p: 'Пешка' }[p.toLowerCase()]} · ${p === p.toUpperCase() ? 'белые' : 'чёрные'}">${piece(p)}</button>`
      )
      .join(
        ''
      )}<button data-editor-piece="" aria-label="Убирать фигуры">×</button><button data-editor-piece="move">Перемещать</button></div><label for="editor-turn">Чья очередь хода</label><select id="editor-turn"><option value="w">Белые</option><option value="b">Чёрные</option></select><fieldset class="editor-castles"><legend>Права рокировки</legend>${[
      ['K', 'Белые · короткая'],
      ['Q', 'Белые · длинная'],
      ['k', 'Чёрные · короткая'],
      ['q', 'Чёрные · длинная'],
    ]
      .map(
        ([right, label]) =>
          `<label><input type="checkbox" data-editor-right="${right}">${label}</label>`
      )
      .join(
        ''
      )}</fieldset><label for="editor-ep">Поле взятия на проходе</label><input id="editor-ep" maxlength="2" placeholder="Например e3 · оставьте пустым, если его нет"><div class="editor-numbers"><div><label for="editor-fullmove">Номер хода</label><input type="number" id="editor-fullmove" min="1" max="10000"></div><div><label for="editor-half">Полуходов без взятия и пешки</label><input type="number" id="editor-half" min="0" max="10000"></div></div><label for="editor-fen">Позиция FEN</label><textarea id="editor-fen" rows="3" maxlength="180" spellcheck="false"></textarea><div class="study-board-tools"><button id="editor-apply-fen">Применить FEN</button><button id="editor-copy">Скопировать FEN</button></div><p id="editor-error" role="alert"></p><div class="study-board-tools"><button id="editor-study" class="primary">Исследовать позицию</button><button id="editor-train">Сыграть с доктором</button></div></aside></div>`;
  positionEditorBoard = new ChessBoardView($('editor-board'), {
    piece,
    onClick: editorPaint,
    onPick: (i) => {
      if (positionEditor) {
        positionEditor.selected = i;
        renderPositionEditor();
      }
    },
    canDrag: (i) => !!positionEditor?.b[i],
    onDrop: (from, to) => {
      if (positionEditor && from !== to && positionEditor.b[from]) {
        editorCheckpoint();
        positionEditor.b[to] = positionEditor.b[from];
        positionEditor.b[from] = null;
        positionEditor.selected = -1;
        editorRemoveImpossibleRights();
        renderPositionEditor();
      }
    },
  });
  document.querySelectorAll('[data-editor-piece]').forEach(
    (button) =>
      (button.onclick = () => {
        positionEditor.brush = button.dataset.editorPiece;
        positionEditor.selected = -1;
        renderPositionEditor();
      })
  );
  for (const [id, key] of [
    ['editor-turn', 'turn'],
    ['editor-ep', 'ep'],
    ['editor-half', 'half'],
    ['editor-fullmove', 'fullmove'],
  ])
    $(id).onchange = () => {
      editorCheckpoint();
      positionEditor[key] =
        key === 'half' || key === 'fullmove' ? Number($(id).value) : $(id).value.trim();
      renderPositionEditor();
    };
  document.querySelectorAll('[data-editor-right]').forEach(
    (box) =>
      (box.onchange = () => {
        editorCheckpoint();
        positionEditor.rights = [...document.querySelectorAll('[data-editor-right]')]
          .filter((item) => item.checked)
          .map((item) => item.dataset.editorRight)
          .join('');
        renderPositionEditor();
      })
  );
  $('editor-undo').onclick = () => {
    if (positionEditor.undo.length) {
      Object.assign(positionEditor, positionEditor.undo.pop());
      positionEditor.selected = -1;
      renderPositionEditor();
    }
  };
  $('editor-flip').onclick = () => {
    positionEditor.flipped = !positionEditor.flipped;
    renderPositionEditor();
  };
  $('editor-empty').onclick = () => {
    editorCheckpoint();
    Object.assign(positionEditor, {
      b: Array(64).fill(null),
      rights: '',
      ep: '',
      half: 0,
      fullmove: 1,
      selected: -1,
    });
    renderPositionEditor();
  };
  const apply = (fen) => {
    try {
      const value = ChessNotation.fromFEN(fen);
      editorCheckpoint();
      Object.assign(positionEditor, value, {
        ep: value.ep < 0 ? '' : name(value.ep),
        selected: -1,
      });
      $('editor-error').textContent = '';
      renderPositionEditor();
    } catch (error) {
      $('editor-error').textContent = error.message;
    }
  };
  $('editor-start').onclick = () => apply(ChessNotation.fen(initial()));
  $('editor-apply-fen').onclick = () => apply($('editor-fen').value);
  $('editor-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(editorFEN());
      toast('Позиция скопирована');
    } catch {
      $('editor-fen').focus();
      $('editor-fen').select();
    }
  };
  $('editor-study').onclick = () => {
    if (positionEditor.valid) seedNotebook(StudyTree.create(editorFEN()), 'Исследование позиции');
  };
  $('editor-train').onclick = () => {
    if (positionEditor.valid) trainLearningPosition(positionEditor.valid);
  };
  renderPositionEditor();
}
