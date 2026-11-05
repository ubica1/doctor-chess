const assert = require('assert'),
  fs = require('fs'),
  vm = require('vm');
class Element {
  constructor() {
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.textContent = '';
    this.hidden = false;
    this.classes = new Set();
    this.classList = {
      add: (...x) => x.forEach((v) => this.classes.add(v)),
      remove: (...x) => x.forEach((v) => this.classes.delete(v)),
      contains: (x) => this.classes.has(x),
      toggle: (x, on) => {
        if (on === undefined) on = !this.classes.has(x);
        on ? this.classes.add(x) : this.classes.delete(x);
        return on;
      },
    };
    this.parts = {};
    this.captured = new Set();
  }
  set className(v) {
    this.classes = new Set(v.split(/\s+/).filter(Boolean));
  }
  get className() {
    return [...this.classes].join(' ');
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  replaceChildren() {
    this.children = [];
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  append(e) {
    this.children.push(e);
    e.parent = this;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((n) => n !== this);
  }
  querySelector(s) {
    return (this.parts[s] ??= new Element());
  }
  addEventListener(k, fn) {
    this.listeners[k] = fn;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 800, right: 800, bottom: 800 };
  }
  focus() {}
  setPointerCapture(id) {
    this.captured.add(id);
  }
  hasPointerCapture(id) {
    return this.captured.has(id);
  }
  releasePointerCapture(id) {
    this.captured.delete(id);
  }
}
const el = new Map(),
  document = {
    createElement: () => new Element(),
    getElementById: (id) => {
      if (!el.has(id)) el.set(id, new Element());
      return el.get(id);
    },
    querySelector: () => new Element(),
    querySelectorAll: () => [],
    addEventListener() {},
  };
const storage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) || null, setItem: (k, v) => m.set(k, v) };
};
let pendingFetch = null,
  networkGame = null;
const context = {
  console,
  queueMicrotask,
  document,
  window: { addEventListener() {} },
  localStorage: storage(),
  sessionStorage: storage(),
  setTimeout: () => 1,
  clearTimeout() {},
  setInterval() {},
  requestAnimationFrame: (fn) => {
    fn();
    return 1;
  },
  cancelAnimationFrame() {},
  piece: (p) => p,
  emblem: () => '',
  plural: (n, f) => f[2],
  routePage: async () => {},
  navigate() {},
  openPlayer() {},
  fetch: async (url) =>
    pendingFetch
      ? pendingFetch(url)
      : {
          ok: true,
          json: async () =>
            url.endsWith('/me')
              ? { user: null }
              : { user: vm.runInContext('user', context), game: networkGame, queued: false },
        },
  ChessBoardView: class {
    render() {}
    cancel() {}
  },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('dist/engine.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('dist/notation.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('dist/outcome.js', 'utf8'), context);
context.DoctorBook = { lookup: () => null, candidates: () => [] };
vm.runInContext(fs.readFileSync('dist/game-report.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('dist/studio.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('dist/workbench.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('dist/club.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('dist/premoves.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('dist/app.js', 'utf8'), context);
const run = (src) => vm.runInContext(src, context);
async function appTests() {
  await new Promise((r) => setImmediate(r));
  run("user={id:'a',username:'Alpha',avatar:'crane',ratings:{blitz:{rating:1200}}};mode='online'");
  networkGame = run(
    "({id:'g',control:'5+0',you:'w',state:initial(),moves:[],last:[],clocks:{w:300,b:300},white:user,black:user,category:'blitz',result:null})"
  );
  context.g = networkGame;
  run('acceptGame(g)');
  await run("changeMode('local')");
  run('selected=52');
  await run('selectSquare(36)');
  assert.equal(run('s.b[36]'), 'P');
  await run('poll()');
  assert.equal(run('mode'), 'local', 'active remote game must not change local mode');
  assert.equal(run('s.b[36]'), 'P', 'poll must preserve local position');
  await run("changeMode('online')");
  await new Promise((r) => setImmediate(r));
  let resolve;
  pendingFetch = () => new Promise((r) => (resolve = r));
  const poll = run('poll()');
  await run("changeMode('local')");
  resolve({
    ok: true,
    json: async () => ({ user: run('user'), game: networkGame, queued: false }),
  });
  await poll;
  pendingFetch = null;
  assert.equal(run('mode'), 'local', 'late response must not undo explicit mode selection');
  await run("changeMode('online')");
  run("g={...g,result:'draw',reason:'Ничья'};acceptGame(g);control='3+2';acceptGame(g)");
  assert.equal(run('control'), '3+2', 'finished game must not reset chosen control');
  run('g={...g,result:null};game=null;acceptGame(g);s=initial();moves=[]');
  pendingFetch = async () => ({ ok: false, json: async () => ({ error: 'test rejection' }) });
  const move = run("makeMove(52,36,'q')");
  assert.equal(run('s.b[36]'), 'P', 'online move should appear before network round trip');
  await move;
  assert.equal(run('s.b[52]'), 'P', 'rejected move must roll back');
  assert.equal(run('moves.length'), 0);
  pendingFetch = null;

  const workers = [];
  context.Worker = class {
    constructor() {
      workers.push(this);
    }
    postMessage(data) {
      this.data = data;
    }
    terminate() {
      this.terminated = true;
    }
  };
  context.DoctorEngine = context.Worker;
  context.DoctorEngine.uci = (m) =>
    'abcdefgh'[m.from % 8] +
    (8 - Math.floor(m.from / 8)) +
    'abcdefgh'[m.to % 8] +
    (8 - Math.floor(m.to / 8));
  context.crypto = { randomUUID: () => 'test-local-game' };
  run("mode='computer';game=null;botSide='w';resetBoard();render()");
  await run("makeMove(52,36,'q')");
  assert.equal(run('botThinking'), true);
  assert.equal(workers.length, 1);
  await workers[0].onmessage({ data: { move: { from: 12, to: 28, promotion: 'q' } } });
  assert.equal(run('s.turn'), 'w');
  assert.equal(run('history.length'), 2);
  assert.equal(run('botThinking'), false);
  assert.equal(run('currentLine().sans.join(",")'), 'e4,e5');
  run('setReview(0)');
  assert.equal(run('shownState().b[52]'), 'P');
  assert.equal(run('s.b[36]'), 'P', 'review must never overwrite live state');
  assert.equal(run('canInteract()'), false);
  run('setReview(2)');
  assert.equal(run('canInteract()'), true);
  run('archiveCurrent(true)');
  assert.equal(run('savedGames().length'), 1);
  await run("makeMove(62,45,'q')");
  const stale = workers.at(-1);
  assert.equal(run('botThinking'), true);
  await run("changeMode('local')");
  const before = run('JSON.stringify(s)');
  await stale.onmessage({ data: { move: { from: 1, to: 18, promotion: 'q' } } });
  assert.equal(run('JSON.stringify(s)'), before, 'cancelled worker cannot modify another mode');
  assert(stale.terminated);

  run("mode='local';game=null;reviewIndex=null;resetBoard();render()");
  await run("makeMove(52,36,'q')");
  await run("makeMove(12,28,'q')");
  run('setReview(1)');
  const source = run('JSON.stringify(s)');
  await run('startVariation()');
  assert.equal(run('mode'), 'analysis');
  assert.equal(run('variationEditing'), true);
  assert.equal(run('s.turn'), 'b');
  assert.equal(run('canInteract()'), true);
  await run("makeMove(10,26,'q')");
  assert.equal(run('currentLine().sans[0]'), 'c5');
  run('returnOriginal()');
  assert.equal(run('JSON.stringify(s)'), source);
  assert.equal(run('history.length'), 2);
  assert.equal(run('reviewIndex'), 1);
  assert.equal(run('variationOrigin'), null);
  const FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 12';
  context.customFen = FEN;
  run(
    "s=ChessNotation.fromFEN(customFen);history=[];moves=[];mode='analysis';reviewIndex=null;variationEditing=false;render()"
  );
  assert.equal(run('canInteract()'), false);
  await run('trainFromPosition()');
  assert.equal(run('mode'), 'computer');
  assert.equal(run('botSide'), 'b');
  assert.equal(run('s.fullmove'), 12);
  assert.equal(run('canInteract()'), true);
  run('returnOriginal()');
  assert.equal(run('mode'), 'analysis');
  assert.equal(run('s.fullmove'), 12);

  run(
    "mode='computer';game=null;reviewIndex=null;botSide='w';resetBoard();render();restartBotColor('b')"
  );
  assert.equal(run('botSide'), 'b');
  assert.equal(run('botThinking'), true);
  const opening = workers.at(-1);
  await opening.onmessage({ data: { move: { from: 52, to: 36, promotion: 'q' } } });
  assert.equal(run('history.length'), 1);
  assert.equal(run('s.turn'), 'b');
  assert.equal(
    run("$('bot-side').disabled"),
    false,
    'color selector must remain enabled after bot opening'
  );
  run("requestBotColor('w')");
  assert.equal(run('botSide'), 'b', 'dialog must not change color before confirmation');
  run("$('confirm-color').onclick()");
  assert.equal(run('botSide'), 'w');
  assert.equal(run('history.length'), 0);
  assert.equal(run('s.b[52]'), 'P');
  assert.equal(run('canInteract()'), true);
  assert.equal(run("localStorage.getItem('dc-bot-side')"), 'w');

  run(
    "mode='online';game=null;resetBoard();premoveEnabled=true;g={id:'premove-game',control:'5+0',category:'blitz',you:'b',state:initial(),moves:[],last:[],clocks:{w:300,b:300},white:user,black:user,result:null};acceptGame(g)"
  );
  await run('selectSquare(12)');
  await run('selectSquare(28)');
  assert.equal(run('premove.to'), 28);
  assert.equal(run('s.b[12]'), 'p', 'planning must not move a piece yet');
  let premoveRequests = 0;
  const confirmed = run(
    "(()=>{const first={from:52,to:36,promotion:'q',piece:'P'};const state=apply(initial(),52,36);return {...g,state,moves:[first],last:[52,36]}})()"
  );
  const accepted = run(
    "(()=>{const state=apply(apply(initial(),52,36),12,28);return {...g,state,moves:[{from:52,to:36,promotion:'q',piece:'P'},{from:12,to:28,promotion:'q',piece:'p'}],last:[12,28]}})()"
  );
  networkGame = accepted;
  pendingFetch = async (url) => {
    if (url.endsWith('/move')) {
      premoveRequests++;
      return { ok: true, json: async () => ({ game: accepted }) };
    }
    return { ok: true, json: async () => ({ user: run('user'), game: accepted, queued: false }) };
  };
  context.confirmed = confirmed;
  run('acceptGame(confirmed)');
  await new Promise((r) => setImmediate(r));
  assert.equal(premoveRequests, 1);
  assert.equal(run('s.b[28]'), 'p');
  assert.equal(run('premove'), null);
  pendingFetch = null;
  run(
    "clearPremove();game=null;const records=[{from:52,to:36},{from:12,to:28},{from:59,to:31},{from:1,to:18}];const line=ChessNotation.replay(initial(),records);g={...g,id:'checking-game',state:line.positions.at(-1),moves:records,last:[1,18],result:null};acceptGame(g)"
  );
  await run('selectSquare(6)');
  await run('selectSquare(21)');
  assert.equal(run('premove.from'), 6);
  run(
    'acceptGame({...g,state:apply(g.state,31,13),moves:[...g.moves,{from:31,to:13}],last:[31,13]})'
  );
  await new Promise((r) => setImmediate(r));
  assert.equal(run('premove'), null);
  assert.equal(run('s.b[6]'), 'n', 'a check must cancel the now-illegal planned knight move');
  assert.equal(premoveRequests, 1);
  console.log(
    'PASS: premove waits, executes once on confirmed turn, and is cancelled when a check makes it illegal'
  );
  run(
    "stopStudy();game=null;mode='computer';botSide='w';resetBoard();$('modal').close();s=ChessNotation.fromPGN('1.f3 e5 2.g4 Qh4# *').positions.at(-1);render()"
  );
  assert.equal(run("$('finish-title').textContent"), 'Вы проиграли');
  assert(run("$('result-modal').open"));
  run("$('result-modal').close();render();render()");
  assert.equal(
    run("$('result-modal').open"),
    false,
    'Repeated rendering must not reopen a dismissed result'
  );
  run("mode='online';game={result:null};updateOutcome()");
  assert.equal(
    run("$('result-card').hidden"),
    true,
    'Unconfirmed online mate cannot announce a result'
  );
  run("game=null;mode='computer';botSide='w';resetBoard();render();askHint()");
  const oldHint = workers.at(-1);
  run('askHint()');
  const newHint = workers.at(-1);
  oldHint.onmessage({ data: { move: { from: 52, to: 36 }, score: 0 } });
  assert(!newHint.terminated, 'A late hint must not terminate a newer request');
  run('stopStudy()');
  context.DoctorBook = require('./dist/doctor-book.js');
  run("game=null;mode='computer';resetBoard();botSide='b';scheduleBot();stopStudy();mode='local'");
  await new Promise((r) => setImmediate(r));
  assert.equal(run('history.length'), 0, 'Cancelled book microtask cannot move on a new board');
  run("mode='computer';botSide='b';scheduleBot()");
  await new Promise((r) => setImmediate(r));
  assert.equal(run('moves[0]'), 'e4');
  assert.equal(run('s.turn'), 'b');
  run("mode='local';game=null;resetBoard();history=[s];s=apply(s,52,36);moves=['e4'];render()");
  const report = run('analyzeWholeGame()');
  const oldReport = workers.at(-1);
  run('cancelGameReport()');
  const freshReport = run('analyzeWholeGame()');
  const freshWorker = workers.at(-1);
  oldReport.onmessage({ data: { type: 'cp', score: 0, move: { from: 52, to: 36 } } });
  await report;
  assert.equal(
    run('reportWorker') === freshWorker,
    true,
    'An old report cannot clear the new engine'
  );
  run('cancelGameReport()');
  await freshReport;
  assert.equal(run('reportRunning'), false);
  assert.equal(run('reportData.rows.length'), 0);
  const completedReport = run('analyzeWholeGame()');
  workers.at(-1).onmessage({ data: { type: 'cp', score: 20, move: { from: 52, to: 36 } } });
  await new Promise((r) => setImmediate(r));
  workers.at(-1).onmessage({ data: { type: 'cp', score: 10, move: { from: 12, to: 28 } } });
  await completedReport;
  assert.equal(run('reportArchive().length'), 1);
  run("reportIdentity='';reportData=null;updateGameReport()");
  assert.equal(run('reportData.rows[0].san'), 'e4', 'Completed analysis survives reopening');
  run(
    "{const bad=reportArchive();bad[0].rows[0].grade='injected';localStorage.setItem('dc-reports-v1',JSON.stringify(bad));reportIdentity='';updateGameReport()}"
  );
  assert.equal(run('reportData'), null, 'Invalid stored report is rejected');
  run("localStorage.setItem('dc-reports-v1','broken');reportIdentity='';updateGameReport()");
  assert.equal(run('reportData'), null);
  console.log('PASS: cancelled full-game analysis isolates subsequent engine requests');
  vm.runInContext(fs.readFileSync('dist/academy.js', 'utf8'), context);
  const delayedReplies = [],
    previousTimeout = context.setTimeout;
  context.setTimeout = (fn) => {
    delayedReplies.push(fn);
    return 1;
  };
  run(
    'academyBoard={render(){}};loadAcademyLesson(0);startAcademyRehearsal();academySelected=52;academyPick(44)'
  );
  assert.equal(run('academyPly'), 0, 'A legal move outside the lesson does not advance it');
  for (let i = 0; i < 20 && !run('academySolved'); i++) {
    run('{const m=academyLine.records[academyPly];academySelected=m.from;academyPick(m.to)}');
    while (delayedReplies.length) delayedReplies.shift()();
  }
  assert(run('academySolved'));
  assert.equal(run("JSON.parse(localStorage.getItem('dc-repertoire'))[0]"), true);
  assert.equal(
    run("DoctorPractice.status(practiceRecords(),academyProgress('dc-repertoire'),0)"),
    'done'
  );
  run('startAcademyRehearsal();academyAssisted=true');
  for (let i = 0; i < 20 && !run('academySolved'); i++) {
    run('{const m=academyLine.records[academyPly];academySelected=m.from;academyPick(m.to)}');
    while (delayedReplies.length) delayedReplies.shift()();
  }
  assert.equal(
    run("DoctorPractice.status(practiceRecords(),academyProgress('dc-repertoire'),0)"),
    'repeat',
    'Assisted attempt returns even a previously completed line to review'
  );
  run('nextAcademyPractice(true)');
  assert.equal(run('academyLesson'), 0);
  assert.equal(run('academyRehearsal'), true);
  assert.equal(run('Object.keys(DoctorPractice.read("broken",15)).length'), 0);
  assert.equal(run('Object.keys(DoctorPractice.read("[]",15)).length'), 0);
  run("localStorage.setItem('dc-academy-last','7');loadAcademyLesson(0,false)");
  assert.equal(
    run("localStorage.getItem('dc-academy-last')"),
    '7',
    'Opening the school preview must preserve the remembered lesson'
  );
  run('loadAcademyLesson(10);startAcademyRehearsal()');
  assert.equal(run('academyPly'), 1, 'Black repertoire starts after the first white move');
  run('{const m=academyLine.records[academyPly];academySelected=m.from;academyPick(m.to)}');
  run('loadAcademyExercise(0)');
  while (delayedReplies.length) delayedReplies.shift()();
  assert.equal(run('academyPly'), 4, 'A delayed opponent reply cannot alter a new exercise');
  context.setTimeout = previousTimeout;
  console.log(
    'PASS: opening rehearsal, wrong-move retry, completion, Black side and cancelled replies'
  );
  // Library keeps earlier pages after a failed request and never duplicates games.
  run("user={username:'Alpha'}");
  let failSecond = true;
  const pageRequests = [];
  pendingFetch = async (url) => {
    const page = Number(new URL(url, 'http://localhost').searchParams.get('page'));
    pageRequests.push(page);
    if (page === 2 && failSecond) return { ok: false, json: async () => ({ error: 'offline' }) };
    const games = Array.from({ length: page === 3 ? 1 : 12 }, (_, i) => ({
      id: 'archive-' + ((page - 1) * 12 + i),
      opponent: { username: 'Opponent' },
      control: '3+0',
      created: 1,
      result: 'draw',
    }));
    return { ok: true, json: async () => ({ player: { games, total_games: 25 } }) };
  };
  context.dateLabel = () => 'date';
  const validLocal = run('savedGames()[0]');
  context.localStorage.setItem('dc-library', JSON.stringify([null, { id: 'broken' }, validLocal]));
  assert.equal(run('savedGames().length'), 1);
  assert.equal(run('damagedLocalGames'), 2);
  await run('openLibrary()');
  assert.equal((el.get('library-online').innerHTML.match(/href=/g) || []).length, 12);
  const firstPage = el.get('library-online').innerHTML;
  await el.get('library-more').onclick();
  assert.equal(el.get('library-online').innerHTML, firstPage);
  assert.equal(el.get('library-more').hidden, false);
  failSecond = false;
  await el.get('library-more').onclick();
  await el.get('library-more').onclick();
  assert.equal((el.get('library-online').innerHTML.match(/href=/g) || []).length, 25);
  assert.equal(el.get('library-more').hidden, true);
  assert.deepEqual(pageRequests, [1, 2, 2, 3]);
  pendingFetch = null;
  console.log('PASS: library pagination, retry, no duplicates and damaged local records');
  console.log(
    'PASS: result popup once, server confirmation, cancelled book move and stale hint isolation'
  );
  console.log(
    'PASS: bot color switches after opening, confirmation preserves current game, new training honors color'
  );
  console.log(
    'PASS: analysis branch preserves source, return restores cursor, training from custom FEN keeps turn and fullmove'
  );
  console.log(
    'PASS: computer response, replay without altering live state, archive, cancelled worker isolation'
  );
  console.log(
    'PASS: local mode survives active/late polling, control selection stays, optimistic move and rejection rollback'
  );
}
function boardTests() {
  const removedEvents = [];
  const boardContext = {
    document,
    window: {
      addEventListener() {},
      removeEventListener(name) {
        removedEvents.push(name);
      },
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    module: { exports: {} },
  };
  vm.createContext(boardContext);
  vm.runInContext(fs.readFileSync('dist/board-view.js', 'utf8'), boardContext);
  const Board = boardContext.module.exports.ChessBoardView,
    root = new Element(),
    state = { b: Array(64).fill(null), turn: 'w' };
  state.b[52] = 'P';
  let dropped = null,
    clicked = null;
  const b = new Board(root, {
    piece: (p) => p,
    onClick: (i) => (clicked = i),
    onPick() {},
    canDrag: (i) => state.b[i] === 'P',
    onDrop: (i, j) => (dropped = [i, j]),
  });
  b.render(state, false, -1, [], []);
  const node = b.nodes.get(52);
  b.render(state, false, 52, [44, 36], []);
  assert.equal(b.nodes.get(52), node);
  assert.equal(root.children.length, 65, 'no square replacement');
  const ev = (x, y) => ({
    isPrimary: true,
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
    preventDefault() {},
  });
  b.down(ev(450, 650));
  b.move(ev(450, 450));
  assert(node.el.classList.contains('dragging'));
  b.up(ev(450, 450));
  assert.deepEqual(dropped, [52, 36]);
  assert(!node.el.classList.contains('dragging'));
  state.b[52] = null;
  state.b[36] = 'P';
  b.render(state, false, -1, [], [52, 36]);
  assert.equal(b.nodes.get(36), node, 'moving piece must reuse its node');
  assert.equal(node.el.style.transform, 'translate3d(400%,400%,0)');
  b.down(ev(450, 450));
  b.move(ev(900, 900));
  b.cancel();
  assert.equal(b.gesture, null);
  assert.equal(node.el.style.transform, 'translate3d(400%,400%,0)');
  assert(!node.el.classList.contains('dragging'));
  b.render(state, true, -1, [], []);
  assert.equal(node.el.style.transform, 'translate3d(300%,300%,0)');
  assert.equal(b.indexAt(350, 350), 36);
  b.down(ev(350, 350));
  b.up(ev(350, 350));
  assert.equal(clicked, 36, 'tap/click must stay available');
  b.destroy();
  assert.deepEqual(removedEvents, ['blur'], 'Destroyed school boards release their window handler');
  console.log('PASS: stable piece/square nodes, drag, cancel, orientation, tap');
}
appTests()
  .then(boardTests)
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
