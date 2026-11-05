const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const nodes = new Map(),
  events = new Map(),
  docEvents = new Map();
const node = (id) => {
  if (!nodes.has(id)) nodes.set(id, { dataset: {}, hidden: false });
  return nodes.get(id);
};
let now = 100000,
  polls = 0,
  accepted = 0;
const original = {
  id: 'abc123',
  kind: 'casual',
  result: null,
  you: 'w',
  moves: [{}],
  giftsLeft: 20,
  presence: { w: true, b: true },
};
const context = vm.createContext({
  console,
  Date: { now: () => now },
  Math,
  $: node,
  mode: 'online',
  game: original,
  user: { id: 'a' },
  busy: false,
  networkEpoch: 0,
  location: { pathname: '/game/abc123' },
  window: {
    addEventListener(name, fn) {
      events.set(name, fn);
    },
  },
  document: {
    visibilityState: 'visible',
    querySelectorAll: () => [],
    addEventListener(name, fn) {
      docEvents.set(name, fn);
    },
  },
  setInterval() {},
  clearInterval() {},
  plural: () => 'игроков в сети',
  toast() {},
  active: () => context.game && !context.game.result,
  poll: async () => {
    polls++;
  },
  updateUser() {},
  routePage: async () => {},
  acceptGame: (g) => {
    accepted++;
    context.game = g;
  },
});
vm.runInContext(fs.readFileSync('dist/live.js', 'utf8'), context);
const run = (code) => vm.runInContext(code, context);
(async () => {
  run('connectionReceived(); updateFriendlyActions()');
  assert.equal(node('connection-band').dataset.connection, 'online');
  assert.equal(node('takeback-request').disabled, false);
  now += 13000;
  run('updateLiveStatus()');
  assert.equal(node('connection-band').dataset.connection, 'offline');
  run('connectionReceived()');
  const payloads = [];
  context.api = async (_action, payload) => {
    payloads.push(payload);
    if (payloads.length === 1) throw Error('Lost acknowledgement');
    return { game: { ...original, giftsLeft: 19 } };
  };
  await run('friendlyAction("give-time")');
  await run('friendlyAction("give-time")');
  assert.equal(
    payloads[0].token,
    payloads[1].token,
    'an ambiguous retry must reuse the gift token'
  );
  assert.equal(accepted, 1);
  assert.equal(context.busy, false);
  let resolve;
  context.api = () =>
    new Promise((done) => {
      resolve = done;
    });
  const pending = run('friendlyAction("takeback-request")');
  assert.equal(context.busy, true);
  const pendingEpoch = context.networkEpoch;
  await run('friendlyAction("give-time")');
  assert.equal(context.networkEpoch, pendingEpoch, 'a second mutation cannot start while waiting');
  context.mode = 'computer';
  context.networkEpoch++;
  resolve({ game: { ...original, id: 'stale' } });
  await pending;
  assert.equal(accepted, 1, 'late action response preserves the newly selected desk');
  assert.equal(context.busy, false);
  context.mode = 'online';
  context.game = { ...original, takeback: { id: 'offer', side: 'b', ply: 2 } };
  run('updateFriendlyActions()');
  assert.equal(node('takeback-accept').hidden, false);
  context.game = { ...original, kind: 'rated' };
  run('updateFriendlyActions()');
  assert.equal(node('friendly-actions').hidden, true);
  run('initializeLive()');
  const before = polls;
  await events.get('online')();
  assert.equal(polls, before + 1);
  docEvents.get('visibilitychange')();
  await new Promise((done) => setImmediate(done));
  assert.equal(polls, before + 2, 'returning to the tab refreshes the game');
  context.game = null;
  context.busy = true;
  context.escapeHtml = (s) => String(s);
  context.communityShell = () => {};
  context.communityNav = () => {};
  context.changeMode = async (m) => {
    context.mode = m;
  };
  context.navigate = (path) => {
    context.location.pathname = path;
  };
  context.location.pathname = '/invite/targeted';
  let retry;
  context.setInterval = (fn, delay) => {
    if (delay === 1500) retry = fn;
    return 1;
  };
  context.api = async (path) =>
    path === 'state'
      ? { game: original }
      : {
          challenge: {
            id: 'targeted',
            game_id: original.id,
            status: 'accepted',
            participant: true,
            own: true,
            host: { username: 'A' },
            control: '3+2',
            color: 'w',
          },
        };
  vm.runInContext(fs.readFileSync('dist/club.js', 'utf8'), context);
  await run('loadInvitation("targeted")');
  assert.equal(
    typeof retry,
    'function',
    'a temporarily busy desk must keep watching an accepted invitation'
  );
  context.busy = false;
  await retry();
  assert.equal(context.location.pathname, '/game/abc123');
  console.log(
    'PASS: presence status, idempotent gift retry, mutation isolation and tab reconnection'
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
