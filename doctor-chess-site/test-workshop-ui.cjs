const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const N = require('./dist/notation.js');
const T = require('./dist/study-tree.js');
const D = require('./dist/mistake-practice.js');
const nodes = new Map(),
  boards = new Map();
const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
};
const node = (id) => {
  if (!nodes.has(id))
    nodes.set(id, {
      id,
      value: '',
      textContent: '',
      hidden: false,
      disabled: false,
      dataset: {},
      close() {},
      setAttribute() {},
      focus() {},
      select() {},
    });
  return nodes.get(id);
};
let nonce = 0;
const context = vm.createContext({
  console,
  TextEncoder,
  Date,
  Math,
  JSON,
  localStorage: storage(),
  sessionStorage: storage(),
  $: node,
  user: { id: 'owner-a' },
  mode: 'analysis',
  game: null,
  busy: false,
  botThinking: false,
  communityRequest: 0,
  location: { pathname: '/study/new', origin: 'https://doctor-chess.ru' },
  window: {
    crypto: { randomUUID: () => 'create-token-' + ++nonce },
    history: {
      replaceState(_s, _t, path) {
        context.location.pathname = path;
      },
    },
    addEventListener() {},
  },
  document: { title: '', querySelectorAll: () => [], addEventListener() {} },
  ChessBoardView: class {
    constructor(root, options) {
      boards.set(root.id, options);
    }
    render() {}
    setShapes() {}
    destroy() {}
  },
  communityShell() {},
  communityNav() {},
  toast() {},
  auth() {},
  openLibrary() {},
  active: () => context.game && !context.game.result,
  escapeHtml: (s) => String(s).replace(/</g, '&lt;'),
  plural: (_n, words) => words[2],
  dateLabel: () => '',
  piece: () => '',
  navigate(path) {
    context.location.pathname = path;
  },
  api: async () => {
    throw Error('No API fixture');
  },
});
for (const file of [
  'engine.js',
  'notation.js',
  'study-tree.js',
  'notebook.js',
  'position-editor.js',
  'mistake-practice.js',
])
  vm.runInContext(fs.readFileSync('dist/' + file, 'utf8'), context);
const run = (source) => vm.runInContext(source, context);
const clone = (value) => JSON.parse(JSON.stringify(value));
const doc = T.fromPGN('1.e4 e5 (1...c5) *').document;
context.fixtureDocument = doc;
(async () => {
  run('studySeed={document:fixtureDocument,title:"Тетрадь A"}');
  await run('loadNotebook("new")');
  assert.equal(run('notebook.tree.document.nodes.length'), 4);
  boards.get('study-board').onShapes([{ from: 52, to: 36, color: 'green' }]);
  assert.equal(run('notebook.tree.byId.get("root").shapes[0].color'), 'green');
  assert(run('notebook.dirty'));
  assert.equal(
    JSON.parse(context.localStorage.getItem('dc-study-draft:owner-a:new')).document.nodes[0].shapes
      .length,
    1
  );

  const payloads = [];
  context.api = async (_path, payload) => {
    payloads.push(clone(payload));
    if (payloads.length === 1) throw Error('Соединение прервалось');
    return { study: { ...payload, id: 'a'.repeat(24), revision: 1, own: true } };
  };
  await run('saveNotebook()');
  assert.equal(run('notebook.dirty'), true);
  assert(context.localStorage.getItem('dc-study-draft:owner-a:new'));
  await run('saveNotebook()');
  assert.equal(payloads[0].clientKey, payloads[1].clientKey);
  assert.equal(run('notebook.dirty'), false);
  assert.equal(context.localStorage.getItem('dc-study-draft:owner-a:new'), null);
  assert.equal(context.location.pathname, '/study/' + 'a'.repeat(24));
  assert.equal(node('study-save-status').textContent, 'Сохранено в профиле');
  let resolve, outbound;
  run('notebook.tree.byId.get("root").comment="Несохранённая заметка";notebookChanged()');
  context.api = (_path, payload) => {
    outbound = clone(payload);
    return new Promise((done) => {
      resolve = done;
    });
  };
  const saving = run('saveNotebook()');
  run('closeLearningPages(); studySeed={document:fixtureDocument,title:"Тетрадь B"}');
  context.location.pathname = '/study/new';
  await run('loadNotebook("new")');
  resolve({ study: { ...outbound, id: 'a'.repeat(24), revision: 2 } });
  await saving;
  assert.equal(run('notebook.title'), 'Тетрадь B');
  assert.equal(run('notebook.id'), null, 'late save cannot replace the newly opened notebook');
  context.api = async () => {
    throw Error('Исследование изменено в другой вкладке.');
  };
  await run('saveNotebook()');
  assert.equal(run('notebook.dirty'), true);
  assert(node('study-save-status').textContent.includes('другой вкладке'));
  run('closeLearningPages()');
  context.api = async () => ({
    study: {
      document: doc,
      id: 'c'.repeat(24),
      title: 'Чужая тетрадь',
      description: '',
      public: true,
      revision: 1,
      own: false,
      author: 'Друг',
    },
  });
  await run('loadNotebook("' + 'c'.repeat(24) + '")');
  assert.equal(node('study-comment').readOnly, true);
  assert.equal(node('study-comment').disabled, false, 'reader can select and copy the note');
  const before = run('notebook.tree.document.nodes.length');
  run('notebook.selected=52;notebookSquare(36)');
  assert.equal(run('notebook.tree.document.nodes.length'), before);
  run('closeLearningPages()');
  // An explicit editor seed must win over an unrelated unsaved new notebook.
  context.localStorage.setItem(
    'dc-study-draft:owner-a:new',
    JSON.stringify({
      title: 'Старый черновик',
      description: '',
      public: false,
      document: doc,
      revision: 0,
      current: 'root',
    })
  );
  context.editorSeed = T.create('4k3/8/8/8/8/8/8/4K2R b - - 0 23');
  run('studySeed={document:editorSeed,title:"Моё исследование"}');
  await run('loadNotebook("new")');
  assert.equal(run('notebook.tree.document.start'), context.editorSeed.start);
  run('closeLearningPages();loadPositionEditor()');
  node('editor-empty').onclick();
  assert.equal(run('positionEditor.valid'), null);
  run(
    'positionEditor.brush="K";editorPaint(60);positionEditor.brush="k";editorPaint(4);positionEditor.brush="R";editorPaint(63)'
  );
  assert.equal(
    run('positionEditor.rights'),
    '',
    'painting rooks does not grant castling automatically'
  );
  assert(run('!!positionEditor.valid'));
  const beforeDrag = run('editorFEN()');
  boards.get('editor-board').onDrop(63, 63);
  assert.equal(
    run('editorFEN()'),
    beforeDrag,
    'dropping on the same square cannot erase the piece'
  );
  node('editor-fen').value = context.editorSeed.start;
  node('editor-apply-fen').onclick();
  assert.equal(run('positionEditor.valid.turn'), 'b');
  assert.equal(run('positionEditor.valid.fullmove'), 23);
  node('editor-fen').value = 'invalid';
  node('editor-apply-fen').onclick();
  assert.equal(
    run('positionEditor.valid.fullmove'),
    23,
    'invalid FEN preserves the current position'
  );
  assert(node('editor-error').textContent);
  run(
    'positionEditor.ep="invalid";renderPositionEditor();closePositionEditor();loadPositionEditor()'
  );
  assert.equal(
    run('positionEditor.b[63]'),
    'R',
    'an unfinished auxiliary field must not discard the painted board'
  );
  assert.equal(run('positionEditor.ep'), '');
  run('closeLearningPages()');
  const line = N.fromPGN('1.f3 e5 2.g4 Qh4# *');
  const deck = D.add([], {
    fen: N.fen(line.positions[3]),
    move: line.records[3],
    actual: 'Nc6',
    grade: 'blunder',
    source: 'Моя партия',
  }).rows;
  context.localStorage.setItem('dc-mistakes-v1:owner-a', JSON.stringify(deck));
  run('loadMistakePractice();mistakePractice.selected=3;mistakeSquare(39)');
  assert.equal(run('mistakePractice.item.solved'), 1);
  assert.equal(run('mistakePractice.done'), true);
  assert.equal(node('mistake-answer').disabled, true);
  node('mistake-retry').onclick();
  run('mistakePractice.selected=1;mistakeSquare(18)');
  assert.equal(run('mistakePractice.done'), false);
  assert.equal(run('mistakePractice.item.streak'), 0);
  node('mistake-answer').onclick();
  assert.equal(
    run('mistakePractice.item.solved'),
    1,
    'revealing the answer is not a self-solved attempt'
  );
  node('mistake-retry').onclick();
  context.game = { result: null };
  const attempts = run('mistakePractice.item.attempts');
  run('mistakePractice.selected=3;mistakeSquare(39)');
  node('mistake-answer').onclick();
  assert.equal(
    run('mistakePractice.item.attempts'),
    attempts,
    'active online game blocks rehearsal answers'
  );
  context.game = null;
  context.user = { id: 'owner-b' };
  run('closeMistakePractice();loadMistakePractice()');
  assert.equal(
    run('mistakePractice.records.length'),
    0,
    'different profiles do not see each other’s device deck'
  );
  console.log(
    'PASS: cloud draft recovery, nonce retries, stale saves, read-only sharing, editor safety and personal rehearsal'
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
