const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
const nodes = new Map(),
  boards = [],
  cleared = [];
const node = (id) => {
  if (!nodes.has(id))
    nodes.set(id, {
      id,
      dataset: {},
      hidden: false,
      disabled: false,
      innerHTML: '',
      textContent: '',
      setAttribute() {},
      querySelector: (selector) => node(id + selector),
    });
  return nodes.get(id);
};
let now = 1000,
  nextTimer = 0;
const context = vm.createContext({
  console,
  Date,
  Math,
  JSON,
  performance: { now: () => now },
  $: node,
  document: { title: '', visibilityState: 'visible', querySelectorAll: () => [] },
  location: { origin: 'https://doctor-chess.ru' },
  setInterval: () => ++nextTimer,
  clearInterval: (id) => cleared.push(id),
  ChessBoardView: class {
    constructor(root, options) {
      this.options = options;
      this.renders = [];
      boards.push(this);
    }
    render(...args) {
      this.renders.push(args);
    }
    destroy() {
      this.destroyed = true;
    }
  },
  piece: () => '',
  communityShell() {},
  communityNav() {},
  escapeHtml: (s) => String(s).replace(/</g, '&lt;'),
  profilePath: (name) => '/player/' + name,
  plural: () => 'полуходов',
  learningMatchActive: () => false,
  mode: 'online',
  game: { id: 'own', result: null, you: 'w', watch: { w: false, b: false, enabled: false } },
  busy: false,
  active: () => context.game && !context.game.result,
  toast() {},
  navigator: { clipboard: { writeText: async () => {} } },
});
for (const file of ['engine.js', 'notation.js', 'watching.js'])
  vm.runInContext(fs.readFileSync('dist/' + file, 'utf8'), context);
const run = (code) => vm.runInContext(code, context),
  clone = (v) => JSON.parse(JSON.stringify(v));
const original = context.game;
let fixture = {
  id: 'abc123',
  white: { username: 'White', rating: 1200 },
  black: { username: 'Black', rating: 1200 },
  control: '5+0',
  kind: 'rated',
  state: clone(run('initial()')),
  moves: [],
  last: [],
  clocks: { w: 90, b: 120 },
  result: null,
  reason: null,
};
context.api = async () => ({ game: clone(fixture) });
(async () => {
  await run('loadWatchRoom("abc123")');
  assert.equal(context.game, original, 'spectator cannot replace participant game');
  assert.equal(boards[0].options.canDrag(52), false);
  assert.equal(node('watch-bottom-clock').textContent, '1:30');
  now += 5000;
  run('tickWatchClocks(watching)');
  assert.equal(node('watch-bottom-clock').textContent, '1:25');
  now += 30000;
  run('tickWatchClocks(watching)');
  assert.equal(
    node('watch-bottom-clock').textContent,
    '1:18',
    'stale clocks freeze without inventing a flag'
  );
  fixture.moves = [{ from: 52, to: 36, promotion: 'q' }];
  fixture.state = clone(run('apply(initial(),52,36)'));
  await run('refreshWatchRoom(watching)');
  run('watchSeek(watching,0)');
  assert.equal(boards[0].renders.at(-1)[0].b[52], 'P');
  fixture.moves.push({ from: 12, to: 28, promotion: 'q' });
  fixture.state = clone(run('apply(apply(initial(),52,36),12,28)'));
  await run('refreshWatchRoom(watching)');
  assert.equal(run('watching.cursor'), 0, 'live updates do not drag a reader out of history');
  run('watchSeek(watching,null)');
  assert.equal(boards[0].renders.at(-1)[0].b[28], 'p');
  context.api = async () => {
    const error = Error('closed');
    error.status = 404;
    throw error;
  };
  await run('refreshWatchRoom(watching)');
  assert.equal(boards[0].destroyed, true);
  assert.equal(run('watching.revoked'), true);
  assert(node('community-page').innerHTML.includes('Трансляция закрыта'));
  context.api = async () => ({ game: clone(fixture) });
  await run('refreshWatchRoom(watching)');
  assert.equal(run('watching.revoked'), false);
  fixture.result = 'w';
  fixture.reason = 'Мат';
  await run('refreshWatchRoom(watching)');
  assert.equal(node('watch-result').hidden, false);
  assert.equal(node('watch-result-title').textContent, 'Победили белые · 1–0');
  assert.equal(run('watching.pollTimer'), null);
  context.learningMatchActive = () => true;
  run('renderWatchRoom(watching)');
  assert.equal(node('watch-review').hidden, true, 'own live game blocks review link');
  let resolve;
  context.api = () => new Promise((done) => (resolve = done));
  run('stopWatching()');
  const pending = run('loadWatchRoom("deadbeef")');
  run('stopWatching()');
  resolve({ game: clone(fixture) });
  await pending;
  assert.equal(run('watching'), null, 'late fetch cannot reopen a closed viewer');
  assert.equal(context.game, original);
  context.api = async () => ({
    game: { ...fixture, watch: { w: true, b: false, enabled: false } },
  });
  await run('toggleWatchConsent()');
  assert.equal(context.game.id, 'own', 'consent reply never rolls back board state');
  assert.equal(context.game.watch.w, true);
  context.game.watch = { w: false, b: true, enabled: false };
  run('updateWatchConsent()');
  assert(node('spectator-actionssummary').textContent.includes('Соперник'));
  console.log(
    'PASS: isolated spectator boards, replay pinning, stale clocks, revocation/recovery, finish and late replies'
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
