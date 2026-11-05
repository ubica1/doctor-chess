const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const nodes = new Map();
const node = (id) => {
  if (!nodes.has(id)) nodes.set(id, { classList: { add() {}, remove() {} } });
  return nodes.get(id);
};
const location = { pathname: '/' };
const pushes = [];
const context = vm.createContext({
  location,
  window: {
    history: {
      pushState(_state, _title, path) {
        pushes.push(path);
        location.pathname = path;
      },
    },
    scrollTo() {},
  },
  document: {},
  $: node,
  user: { id: 1 },
  mode: 'online',
  game: null,
  remoteGame: null,
  busy: false,
  communityNav() {},
  updateResume() {},
  communityShell() {},
  render() {},
  escapeHtml: (s) => s,
  async changeMode(mode) {
    context.mode = mode;
  },
  acceptGame(g) {
    context.game = g;
  },
});
vm.runInContext(fs.readFileSync('dist/game-room.js', 'utf8'), context);
const run = (code) => vm.runInContext(code, context);
(async () => {
  const g = { id: 'abc123', control: '3+2', result: null };
  context.next = g;
  run('syncGameRoute(next, null)');
  assert.equal(location.pathname, '/game/abc123');
  run('syncGameRoute(next, next)');
  assert.equal(pushes.length, 1, 'polling must not add history entries');
  location.pathname = '/academy';
  run('syncGameRoute(next, null)');
  assert.equal(location.pathname, '/academy', 'background polling preserves other pages');
  location.pathname = '/game/abc123';
  context.mode = 'computer';
  context.api = async (path) => {
    assert.equal(path, 'play/abc123');
    return { game: g };
  };
  await run('loadGameRoom("abc123")');
  assert.equal(context.mode, 'online');
  assert.equal(context.game.id, g.id);
  assert.equal(node('community-page').hidden, true);
  assert.equal(node('room-heading').hidden, false);
  context.game = null;
  let resolve;
  context.api = () =>
    new Promise((done) => {
      resolve = done;
    });
  const pending = run('loadGameRoom("abc123")');
  run('roomGeneration++; roomLoading = false');
  location.pathname = '/';
  resolve({ game: g });
  await pending;
  assert.equal(context.game, null, 'late room request cannot replace a newly opened page');
  context.mode = 'local';
  run('openPracticeRoom()');
  assert.equal(location.pathname, '/play/local');
  const count = pushes.length;
  run('openPracticeRoom()');
  assert.equal(pushes.length, count, 'resetting a practice game keeps the same URL');
  console.log(
    'PASS: game URLs, participant restoration, navigation isolation and practice history'
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
