/* Personal variation notebooks. Drafts survive navigation; cloud writes use revisions. */
let notebook = null,
  notebookBoard = null,
  notebookEpoch = 0,
  studySeed = null;
function learningMatchActive() {
  return !!active() || (typeof remoteGame !== 'undefined' && !!remoteGame && !remoteGame.result);
}
const copyStudy = (value) => JSON.parse(JSON.stringify(value));
const studySignature = (value) =>
  JSON.stringify({
    title: value.title,
    description: value.description,
    public: value.public,
    document: value.document,
  });
function workspaceLinks(selected = 'studies') {
  return `<div class="workspace-tabs"><a href="/studies" ${selected === 'studies' ? 'aria-current="page"' : ''}>Исследования</a><a href="/editor" ${selected === 'editor' ? 'aria-current="page"' : ''}>Редактор позиций</a><a href="/practice" ${selected === 'practice' ? 'aria-current="page"' : ''}>Работа над ошибками</a></div>`;
}
function closeLearningPages() {
  persistNotebook();
  notebook?.worker?.terminate();
  notebookBoard?.destroy();
  notebookBoard = null;
  notebook = null;
  notebookEpoch++;
  if (typeof closePositionEditor === 'function') closePositionEditor();
  if (typeof closeMistakePractice === 'function') closeMistakePractice();
}
async function loadStudies(page = 1, archived = false) {
  const request = ++communityRequest;
  communityShell();
  communityNav('nav-import');
  document.title = 'Мастерская · Doctor Chess';
  $('community-page').innerHTML =
    `<section class="workspace-heading"><span class="workspace-seal">研</span><div><p>МАСТЕРСКАЯ ДОКТОРА</p><h1>Мысли, к которым возвращаемся.</h1><p>Сохраняйте варианты, собирайте позиции и разбирайтесь в своих решениях.</p></div></section>${workspaceLinks()}<div class="workspace-actions"><button id="study-new" class="primary">Новое исследование</button><button id="workspace-import">Открыть PGN или FEN</button><button id="study-list-toggle">${archived ? 'Мои исследования' : 'Архив'}</button></div><div id="study-list" class="study-list" role="status">Открываем ваши тетради…</div>`;
  $('study-new').onclick = () => seedNotebook(StudyTree.create(), 'Моё исследование');
  $('workspace-import').onclick = openImport;
  $('study-list-toggle').onclick = () => loadStudies(1, !archived);
  if (!user) {
    $('study-list').innerHTML =
      '<h2>Ваше место для шахматных идей.</h2><p>Исследование можно начать без регистрации и скачать в PGN. Войдите, чтобы сохранять тетради в профиле и открывать их с других устройств.</p><button id="study-list-login">Войти</button>';
    $('study-list-login').onclick = () => auth();
    return;
  }
  try {
    const data = await api(`studies?page=${page}&archived=${archived ? 1 : 0}`);
    if (request !== communityRequest || location.pathname !== '/studies') return;
    $('study-list').innerHTML = data.studies.length
      ? data.studies
          .map(
            (item) =>
              `<article class="study-list-row"><div><h2>${archived ? escapeHtml(item.title) : `<a href="/study/${item.id}">${escapeHtml(item.title)}</a>`}</h2><p>${escapeHtml(item.description || 'Варианты и заметки к позициям.')}</p><small>${item.public ? 'Доступ по ссылке' : 'Только мне'} · ${dateLabel(item.updated)}</small></div><button data-study-archive="${item.id}">${archived ? 'Вернуть из архива' : 'В архив'}</button></article>`
          )
          .join('')
      : `<div class="page-empty"><h2>${archived ? 'Архив пока пуст.' : 'Первая тетрадь ждёт вашего хода.'}</h2><p>${archived ? 'Архивные исследования можно вернуть в любое время.' : 'Начните с партии, дебюта или одной интересной позиции.'}</p></div>`;
    $('study-list').innerHTML +=
      `<div class="history-pagination"><button id="study-prev" ${page <= 1 ? 'disabled' : ''}>← Назад</button><span>${page} / ${Math.max(1, Math.ceil(data.total / 20))}</span><button id="study-next" ${page * 20 >= data.total ? 'disabled' : ''}>Далее →</button></div><p class="muted">До 100 исследований в профиле, включая архив. Архивные тетради недоступны по ссылке.</p>`;
    $('study-prev').onclick = () => loadStudies(page - 1, archived);
    $('study-next').onclick = () => loadStudies(page + 1, archived);
    document.querySelectorAll('[data-study-archive]').forEach(
      (button) =>
        (button.onclick = async () => {
          const item = data.studies.find((x) => x.id === button.dataset.studyArchive);
          button.disabled = true;
          try {
            await api(`studies/${item.id}/${archived ? 'restore' : 'archive'}`, {
              revision: item.revision,
            });
            if (location.pathname === '/studies') loadStudies(page, archived);
          } catch (error) {
            toast(error.message);
            button.disabled = false;
          }
        })
    );
  } catch (error) {
    if (request === communityRequest) $('study-list').textContent = error.message;
  }
}
function seedNotebook(document, title = 'Моё исследование', description = '') {
  studySeed = {
    document: StudyTree.read(document).document,
    title: title.slice(0, 80),
    description,
  };
  navigate('/study/new');
}
function notebookDraftKey(id) {
  return 'dc-study-draft:' + (user?.id || 'guest') + ':' + (id || 'new');
}
function persistNotebook() {
  if (!notebook?.own || !notebook.dirty) return;
  try {
    localStorage.setItem(
      notebook.draftKey,
      JSON.stringify({
        ...notebookSnapshot(),
        revision: notebook.revision,
        clientKey: notebook.clientKey,
      })
    );
    notebook.draftSaved = true;
  } catch {
    notebook.draftSaved = false;
  }
}
function notebookSnapshot() {
  return copyStudy({
    title: notebook.title,
    description: notebook.description,
    public: notebook.public,
    document: notebook.tree.document,
    current: notebook.current,
  });
}
function notebookChanged(tag = '') {
  notebook.dirty = true;
  notebook.lastEdit = tag;
  persistNotebook();
  $('study-save-status').textContent = notebook.draftSaved
    ? 'Есть изменения · черновик на устройстве'
    : 'Есть изменения · скачайте PGN или сохраните в профиль';
}
function notebookCheckpoint(tag = '') {
  if (tag && notebook.lastEdit === tag) return;
  notebook.undo.push(notebookSnapshot());
  notebook.undo = notebook.undo.slice(-40);
  notebook.redo = [];
}
async function loadNotebook(id) {
  const epoch = notebookEpoch,
    request = communityRequest;
  communityShell();
  communityNav('nav-import');
  let data;
  const seeded = !!studySeed;
  try {
    if (id === 'new') {
      data = {
        id: null,
        title: 'Моё исследование',
        description: '',
        public: false,
        revision: 0,
        own: true,
        document: StudyTree.create(),
        ...studySeed,
      };
      studySeed = null;
    } else data = (await api('studies/' + encodeURIComponent(id))).study;
    if (epoch !== notebookEpoch || request !== communityRequest) return;
    const key = notebookDraftKey(data.id);
    let draft;
    if (data.own) {
      try {
        draft = JSON.parse(localStorage.getItem(key) || 'null');
        if (draft && studySignature(draft) === studySignature(data)) {
          localStorage.removeItem(key);
          draft = null;
        }
        if (draft) StudyTree.read(draft.document);
      } catch {
        draft = null;
      }
    }
    // An explicit new seed takes precedence over a previous unsaved new notebook.
    const explicit = id === 'new' && seeded;
    const restored = draft && !explicit;
    notebook = {
      ...data,
      ...(restored ? draft : {}),
      id: data.id,
      own: data.own,
      tree: StudyTree.read(restored ? draft.document : data.document),
      current: restored && draft.current ? draft.current : 'root',
      draftKey: key,
      clientKey:
        (restored && draft.clientKey) ||
        window.crypto?.randomUUID?.() ||
        Date.now().toString(36) + Math.random().toString(36).slice(2),
      dirty: !!restored || !data.id,
      draftSaved: !!restored,
      undo: [],
      redo: [],
      selected: -1,
      flipped: false,
      worker: null,
      saving: false,
      lastEdit: '',
    };
    if (!notebook.tree.byId.has(notebook.current)) notebook.current = 'root';
    document.title = notebook.title + ' · Doctor Chess';
    $('community-page').innerHTML =
      `<div class="breadcrumbs"><a href="/studies">Мастерская</a><span>/</span><span>Исследование</span></div><div class="notebook-heading"><span class="workspace-seal">谱</span><div><label for="study-title">Название тетради</label><input id="study-title" maxlength="80" value="${escapeHtml(notebook.title)}" ${notebook.own ? '' : 'readonly'}><p>${notebook.own ? 'Варианты и заметки остаются только у вас, пока вы сами не откроете доступ.' : 'Автор: ' + escapeHtml(data.author) + ' · просмотр по ссылке'}</p></div></div>${workspaceLinks()}<div class="notebook-layout"><section class="notebook-board-column"><div class="board-frame"><div class="board-rim"><div id="study-board" tabindex="0" role="group" aria-label="Доска исследования"></div></div></div><div class="study-board-tools"><button id="study-back">← Назад</button><button id="study-forward">Далее →</button><button id="study-flip">Перевернуть</button><button id="study-evaluate">Оценить позицию</button><button id="study-train">С доктором отсюда</button></div><p id="study-position-label" role="status"></p><p id="study-evaluation" class="study-evaluation" role="status"></p></section><aside class="notebook-paper"><div class="study-toolbar"><button id="study-save" class="primary" ${notebook.own ? '' : 'hidden'}>Сохранить в профиль</button><button id="study-copy">Сохранить копию</button><button id="study-pgn">PGN ↓</button><button id="study-import-pgn" ${notebook.own ? '' : 'hidden'}>Импорт PGN с вариантами</button></div><p id="study-save-status" role="status">${restored ? 'Восстановлен черновик с этого устройства. При конфликте версий можно сохранить копию.' : notebook.id ? (notebook.own ? 'Сохранено в профиле' : 'Просмотр исследования') : 'Новая тетрадь · ещё не сохранена'}</p><details class="study-settings"><summary>Настройки тетради и доступ</summary><label for="study-description">О чём исследование</label><textarea id="study-description" rows="2" maxlength="400" ${notebook.own ? '' : 'readonly'}>${escapeHtml(notebook.description)}</textarea><label for="study-access">Доступ</label><select id="study-access" ${notebook.own ? '' : 'disabled'}><option value="private" ${notebook.public ? '' : 'selected'}>Только мне</option><option value="link" ${notebook.public ? 'selected' : ''}>Всем, у кого есть ссылка</option></select><p class="muted">Доступ меняется после сохранения. Пока действует доступ по ссылке, любой её получатель может читать варианты и заметки.</p></details><button id="study-share" ${notebook.id && notebook.public ? '' : 'hidden'}>Скопировать ссылку</button><div class="study-tree-actions" ${notebook.own ? '' : 'hidden'}><button id="study-undo">Отменить изменение</button><button id="study-redo">Повторить</button><button id="study-promote">Сделать главным</button><button id="study-delete">Убрать вариант</button></div><div id="study-move-tree" class="study-move-tree" aria-label="Дерево вариантов"></div><label for="study-nag">Отметка хода</label><select id="study-nag" ${notebook.own ? '' : 'disabled'}>${StudyTree.glyphs.map((mark, index) => `<option value="${index}">${mark || 'Без отметки'}</option>`).join('')}</select><label for="study-comment">Заметка к позиции</label><textarea id="study-comment" rows="5" maxlength="2000" placeholder="Идея, план или вопрос к этой позиции…" ${notebook.own ? '' : 'readonly'}></textarea><p class="muted">До 400 позиций во всей тетради и 200 полуходов в одной линии. PGN сохраняет варианты, заметки и отметки.</p></aside></div>`;
    notebookBoard = new ChessBoardView($('study-board'), {
      piece,
      onClick: notebookSquare,
      autoClear: false,
      onShapes: (shapes) => {
        if (!notebook?.own || notebook.saving) return;
        notebookCheckpoint();
        const node = notebook.tree.byId.get(notebook.current);
        if (shapes.length) node.shapes = shapes;
        else delete node.shapes;
        notebookChanged();
        renderNotebook();
      },
      onPick: (i) => {
        if (notebook) {
          notebook.selected = i;
          renderNotebookBoard();
        }
      },
      canDrag: (i) =>
        notebook.own &&
        !notebook.saving &&
        color(notebook.tree.positions.get(notebook.current).b[i]) ===
          notebook.tree.positions.get(notebook.current).turn,
      onDrop: (from, to) => {
        if (notebook) {
          notebook.selected = from;
          notebookSquare(to);
        }
      },
    });
    bindNotebook();
    renderNotebook();
  } catch (error) {
    if (epoch === notebookEpoch && request === communityRequest)
      $('community-page').innerHTML =
        `<div class="page-empty"><h1>Не удалось открыть исследование</h1><p>${escapeHtml(error.message)}</p><a href="/studies">Вернуться в мастерскую →</a></div>`;
  }
}
function stopNotebookAnalysis() {
  notebook?.worker?.terminate();
  if (notebook) notebook.worker = null;
}
function selectNotebookNode(id) {
  if (!notebook?.tree.byId.has(id)) return;
  stopNotebookAnalysis();
  notebook.current = id;
  notebook.selected = -1;
  notebook.lastEdit = '';
  $('study-evaluation').textContent = '';
  renderNotebook();
  persistNotebook();
}
function renderNotebookBoard() {
  if (!notebook || !notebookBoard) return;
  const state = notebook.tree.positions.get(notebook.current),
    node = notebook.tree.byId.get(notebook.current);
  notebookBoard.setShapes(node.shapes || [], notebook.own && !notebook.saving, notebook.current);
  notebookBoard.render(
    state,
    notebook.flipped,
    notebook.selected,
    notebook.selected >= 0 && notebook.own ? legal(state, notebook.selected) : [],
    node.move ? [node.move.from, node.move.to] : [],
    check(state, state.turn) ? state.b.indexOf(state.turn === 'w' ? 'K' : 'k') : -1
  );
}
function renderNotebook() {
  if (!notebook) return;
  renderNotebookBoard();
  const tree = notebook.tree,
    current = tree.byId.get(notebook.current),
    editable = notebook.own && !notebook.saving;
  $('study-position-label').textContent =
    (tree.positions.get(notebook.current).turn === 'w' ? 'Ход белых' : 'Ход чёрных') +
    ' · ' +
    (tree.document.nodes.length - 1) +
    ' ходов в тетради';
  function branch(parent, depth = 0) {
    return (tree.children.get(parent) || [])
      .map((id, index) => {
        const before = tree.positions.get(parent),
          node = tree.byId.get(id);
        return `<div class="study-tree-node" style="--branch-depth:${Math.min(depth, 6)}"><button data-study-node="${id}" ${id === notebook.current ? 'aria-current="true"' : ''}><span>${before.fullmove || 1}${before.turn === 'w' ? '.' : '…'}</span> ${escapeHtml(tree.sans.get(id))}${StudyTree.glyphs[node.nag]} ${node.comment ? '<small>✎</small>' : ''}${index ? '<small>вариант</small>' : ''}</button></div>${branch(id, depth + (index ? 1 : 0))}`;
      })
      .join('');
  }
  $('study-move-tree').innerHTML =
    `<button data-study-node="root" ${notebook.current === 'root' ? 'aria-current="true"' : ''}>Начальная позиция ${tree.byId.get('root').comment ? '✎' : ''}</button>` +
    branch('root');
  document
    .querySelectorAll('[data-study-node]')
    .forEach((button) => (button.onclick = () => selectNotebookNode(button.dataset.studyNode)));
  $('study-comment').value = current.comment;
  $('study-nag').value = String(current.nag);
  $('study-back').disabled = notebook.current === 'root';
  $('study-forward').disabled = !tree.children.get(notebook.current)?.length;
  for (const id of ['study-title', 'study-description', 'study-comment']) {
    $(id).readOnly = !editable;
    $(id).disabled = notebook.saving;
  }
  for (const id of ['study-access', 'study-nag']) $(id).disabled = !editable;
  $('study-import-pgn').disabled = !editable;
  $('study-save').disabled = notebook.saving;
  $('study-delete').disabled = $('study-promote').disabled =
    !editable || notebook.current === 'root';
  $('study-undo').disabled = !editable || !notebook.undo.length;
  $('study-redo').disabled = !editable || !notebook.redo.length;
  $('study-share').hidden = !notebook.id || !notebook.public || notebook.dirty;
  updateLearningSafety();
}
function notebookApply(document, id) {
  notebook.tree = StudyTree.read(document);
  notebook.current = id;
  notebook.selected = -1;
  stopNotebookAnalysis();
  notebookChanged();
  renderNotebook();
}
function notebookSquare(to) {
  if (!notebook?.own || notebook.saving) return;
  const state = notebook.tree.positions.get(notebook.current),
    from = notebook.selected;
  if (from >= 0 && legal(state, from).includes(to)) {
    const play = (promotion) => {
      if (!notebook) return;
      try {
        const next = StudyTree.add(notebook.tree.document, notebook.current, {
          from,
          to,
          promotion,
        });
        if (next.document.nodes.length === notebook.tree.document.nodes.length)
          return selectNotebookNode(next.id);
        notebookCheckpoint();
        notebookApply(next.document, next.id);
      } catch (error) {
        toast(error.message);
      }
    };
    if (state.b[from].toLowerCase() === 'p' && (to < 8 || to >= 56))
      return chooseLearningPromotion(play);
    return play('q');
  }
  notebook.selected = color(state.b[to]) === state.turn ? to : -1;
  renderNotebookBoard();
}
function chooseLearningPromotion(callback) {
  show(
    'Во что превращаем пешку?',
    '<div class="promotion">' +
      [
        ['q', 'Ферзь'],
        ['r', 'Ладья'],
        ['b', 'Слон'],
        ['n', 'Конь'],
      ]
        .map(
          ([p, label]) =>
            `<button data-learning-promotion="${p}" aria-label="${label}">${piece(p.toUpperCase())}</button>`
        )
        .join('') +
      '</div>'
  );
  const epoch = notebookEpoch;
  document.querySelectorAll('[data-learning-promotion]').forEach(
    (button) =>
      (button.onclick = () => {
        $('modal').close();
        if (epoch === notebookEpoch) callback(button.dataset.learningPromotion);
      })
  );
}
function bindNotebook() {
  for (const [id, key] of [
    ['study-title', 'title'],
    ['study-description', 'description'],
  ])
    $(id).oninput = () => {
      notebookCheckpoint(id);
      notebook[key] = $(id).value;
      notebookChanged(id);
    };
  $('study-access').onchange = () => {
    notebookCheckpoint();
    notebook.public = $('study-access').value === 'link';
    notebookChanged();
    renderNotebook();
  };
  $('study-comment').oninput = () => {
    notebookCheckpoint('note:' + notebook.current);
    notebook.tree.byId.get(notebook.current).comment = $('study-comment').value;
    notebookChanged('note:' + notebook.current);
  };
  $('study-nag').onchange = () => {
    notebookCheckpoint();
    notebook.tree.byId.get(notebook.current).nag = Number($('study-nag').value);
    notebookChanged();
    renderNotebook();
  };
  $('study-back').onclick = () =>
    selectNotebookNode(notebook.tree.byId.get(notebook.current).parent);
  $('study-forward').onclick = () =>
    selectNotebookNode(notebook.tree.children.get(notebook.current)?.[0]);
  $('study-flip').onclick = () => {
    notebook.flipped = !notebook.flipped;
    renderNotebookBoard();
  };
  $('study-save').onclick = saveNotebook;
  $('study-import-pgn').onclick = importNotebookPGN;
  $('study-copy').onclick = () =>
    seedNotebook(
      notebook.tree.document,
      (notebook.title + ' · копия').slice(0, 80),
      notebook.description
    );
  $('study-promote').onclick = () => {
    notebookCheckpoint();
    notebookApply(StudyTree.promote(notebook.tree.document, notebook.current), notebook.current);
  };
  $('study-delete').onclick = () => {
    const parent = notebook.tree.byId.get(notebook.current).parent;
    if (parent) {
      notebookCheckpoint();
      notebookApply(StudyTree.remove(notebook.tree.document, notebook.current), parent);
    }
  };
  for (const [id, source, target] of [
    ['study-undo', 'undo', 'redo'],
    ['study-redo', 'redo', 'undo'],
  ])
    $(id).onclick = () => {
      if (!notebook[source].length) return;
      notebook[target].push(notebookSnapshot());
      const value = notebook[source].pop();
      Object.assign(notebook, value);
      notebook.tree = StudyTree.read(value.document);
      notebook.selected = -1;
      $('study-title').value = notebook.title;
      $('study-description').value = notebook.description;
      $('study-access').value = notebook.public ? 'link' : 'private';
      notebookChanged();
      renderNotebook();
    };
  $('study-pgn').onclick = () =>
    downloadLearningPGN(
      StudyTree.pgn(notebook.tree.document, notebook.title),
      'doctor-chess-study.pgn'
    );
  $('study-share').onclick = async () => {
    try {
      await navigator.clipboard.writeText(location.origin + '/study/' + notebook.id);
      toast('Ссылка скопирована');
    } catch {
      show(
        'Ссылка на исследование',
        `<input readonly value="${escapeHtml(location.origin + '/study/' + notebook.id)}">`
      );
    }
  };
  $('study-evaluate').onclick = evaluateNotebook;
  $('study-train').onclick = () =>
    trainLearningPosition(notebook.tree.positions.get(notebook.current));
}
async function saveNotebook() {
  if (!notebook?.own || notebook.saving) return;
  if (!user) {
    studySeed = {
      document: notebook.tree.document,
      title: notebook.title,
      description: notebook.description,
    };
    return auth(true);
  }
  try {
    notebook.tree = StudyTree.read(notebook.tree.document);
  } catch (error) {
    return toast(error.message);
  }
  notebook.title = notebook.title.trim();
  notebook.description = notebook.description.trim();
  $('study-title').value = notebook.title;
  $('study-description').value = notebook.description;
  const session = notebook,
    epoch = notebookEpoch,
    snapshot = notebookSnapshot();
  const payload = { ...snapshot, revision: notebook.revision, clientKey: notebook.clientKey };
  if (new TextEncoder().encode(JSON.stringify(payload)).length > 195000)
    return toast(
      'Тетрадь слишком большая для сохранения. Уменьшите заметки или разделите варианты.'
    );
  session.saving = true;
  renderNotebook();
  $('study-save-status').textContent = 'Проверяем ходы и сохраняем…';
  try {
    const out = (await api('studies' + (session.id ? '/' + session.id : ''), payload)).study;
    if (epoch !== notebookEpoch || notebook !== session) return;
    session.id = out.id;
    session.revision = out.revision;
    if (studySignature(out) === studySignature(snapshot)) {
      session.dirty = false;
      try {
        localStorage.removeItem(session.draftKey);
      } catch {}
      $('study-save-status').textContent = 'Сохранено в профиле';
    } else {
      session.dirty = true;
      $('study-save-status').textContent =
        'Создание подтверждено. Нажмите «Сохранить», чтобы записать последние правки.';
    }
    session.draftKey = notebookDraftKey(out.id);
    if (location.pathname === '/study/new') window.history.replaceState({}, '', '/study/' + out.id);
    document.title = session.title + ' · Doctor Chess';
    persistNotebook();
  } catch (error) {
    if (epoch === notebookEpoch && notebook === session) {
      $('study-save-status').textContent = error.message;
      persistNotebook();
    }
  } finally {
    session.saving = false;
    if (notebook === session) renderNotebook();
  }
}
function downloadLearningPGN(text, filename) {
  const url = URL.createObjectURL(
      new Blob([text], { type: 'application/x-chess-pgn;charset=utf-8' })
    ),
    link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function updateLearningSafety() {
  if (typeof suspendTrainingForGame === 'function') suspendTrainingForGame();
  if (typeof updateMistakeSafety === 'function') updateMistakeSafety();
  if (!notebook) return;
  $('study-evaluate').disabled = !!learningMatchActive();
  $('study-train').disabled = !!learningMatchActive() || busy;
  if (learningMatchActive()) {
    stopNotebookAnalysis();
    $('study-evaluation').textContent = 'Расчёт доступен после завершения сетевой партии.';
  }
}
function evaluateNotebook() {
  if (!notebook || learningMatchActive()) return;
  stopNotebookAnalysis();
  const session = notebook,
    id = session.current,
    state = session.tree.positions.get(id);
  $('study-evaluation').textContent = 'Доктор изучает позицию…';
  const worker = (session.worker = new DoctorEngine());
  worker.onmessage = ({ data }) => {
    worker.terminate();
    if (
      notebook !== session ||
      session.current !== id ||
      session.worker !== worker ||
      learningMatchActive()
    )
      return;
    session.worker = null;
    const score =
      data.type === 'mate'
        ? 'Мат ' + data.score
        : (data.score >= 0 ? '+' : '') + (data.score / 100).toFixed(2);
    let best = '';
    try {
      if (data.move) best = ' · лучший ход ' + ChessNotation.san(state, data.move);
    } catch {}
    $('study-evaluation').textContent = score + ' за белых' + best;
  };
  worker.onerror = () => {
    worker.terminate();
    if (notebook === session && session.worker === worker) {
      session.worker = null;
      $('study-evaluation').textContent = 'Не удалось рассчитать позицию. Попробуйте ещё раз.';
    }
  };
  const path = [];
  for (let at = id; at !== 'root'; at = session.tree.byId.get(at).parent)
    path.unshift(session.tree.byId.get(at));
  worker.postMessage({
    id: notebookEpoch,
    state,
    line:
      'position fen ' +
      session.tree.document.start +
      (path.length
        ? ' moves ' +
          path
            .map((node) =>
              DoctorEngine.uci({
                ...node.move,
                promotes:
                  node.move.promotion !== 'q' ||
                  (session.tree.positions.get(node.parent).b[node.move.from]?.toLowerCase() ===
                    'p' &&
                    (node.move.to < 8 || node.move.to >= 56)),
              })
            )
            .join(' ')
        : ''),
    options: { level: 3, budgetMs: 1400 },
  });
}
async function trainLearningPosition(position) {
  if (learningMatchActive() || busy)
    return toast('Сначала завершите сетевую партию или дождитесь подтверждения хода.');
  const copy = copyStudy(position);
  if (end(copy, [])) return toast('В этой позиции игра уже завершена.');
  await changeMode('computer');
  resetBoard();
  variationOrigin = null;
  s = copy;
  botSide = copy.turn;
  flipped = botSide === 'b';
  openPracticeRoom();
  navigate('/play/computer');
  render();
}
function openDeskAsStudy() {
  if (learningMatchActive() || busy) return;
  const line = copyStudy(currentLine()),
    title = (studyTags().White + ' — ' + studyTags().Black).slice(0, 80);
  show(
    'Что исследуем?',
    `<p>Исходная партия сохранится. В новой тетради можно добавлять варианты и заметки.</p><button id="study-entire-game" class="primary" ${line.records.length > 200 ? 'disabled' : ''}>Всю партию</button><button id="study-current-position">Текущую позицию</button>${line.records.length > 200 ? '<p>В линии исследования может быть до 200 полуходов. Выберите отдельную позицию.</p>' : ''}`
  );
  $('study-entire-game').onclick = () => {
    const doc = StudyTree.fromPGN(ChessNotation.pgn(line, studyTags())).document;
    $('modal').close();
    seedNotebook(doc, title);
  };
  $('study-current-position').onclick = () => {
    const doc = StudyTree.create(ChessNotation.fen(shownState()));
    $('modal').close();
    seedNotebook(doc, title);
  };
}

function initializeLearning() {
  $('workshop-home').onclick = () => navigate('/studies');
  $('study-from-game').onclick = openDeskAsStudy;
  window.addEventListener('beforeunload', (event) => {
    if (notebook?.dirty && !notebook.draftSaved) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  document.addEventListener('keydown', (event) => {
    if (
      !notebook ||
      $('modal').open ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '')
    )
      return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      selectNotebookNode(notebook.tree.byId.get(notebook.current).parent);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      selectNotebookNode(notebook.tree.children.get(notebook.current)?.[0]);
    }
  });
}

function importNotebookPGN() {
  if (!notebook?.own || notebook.saving) return;
  const session = notebook,
    epoch = notebookEpoch;
  show(
    'PGN в тетрадь вариантов',
    '<p>Загрузим основную линию, вложенные варианты, заметки и отметки ходов. Текущие варианты будут заменены; изменение можно отменить.</p><form id="study-pgn-form"><label for="study-pgn-input">Запись PGN · до 128 КБ</label><textarea id="study-pgn-input" class="notation-input" rows="8" maxlength="131072" required spellcheck="false" placeholder="1.e4 e5 (1...c5) 2.Nf3 *"></textarea><label for="study-pgn-file">Или файл .pgn</label><input id="study-pgn-file" type="file" accept=".pgn,text/plain,application/x-chess-pgn"><p id="study-pgn-error" role="alert"></p><button class="primary">Открыть варианты</button></form>'
  );
  $('study-pgn-file').onchange = async () => {
    const file = $('study-pgn-file').files[0];
    if (!file) return;
    try {
      if (file.size > 131072) throw Error('Размер файла должен быть не больше 128 КБ.');
      const text = await file.text();
      if (epoch === notebookEpoch && notebook === session && $('study-pgn-input'))
        $('study-pgn-input').value = text;
    } catch (error) {
      if ($('study-pgn-error')) $('study-pgn-error').textContent = error.message;
    }
  };
  $('study-pgn-form').onsubmit = (event) => {
    event.preventDefault();
    if (epoch !== notebookEpoch || notebook !== session) return;
    try {
      const value = StudyTree.fromPGN($('study-pgn-input').value);
      notebookCheckpoint();
      notebookApply(value.document, 'root');
      $('modal').close();
    } catch (error) {
      $('study-pgn-error').textContent = error.message;
    }
  };
}
