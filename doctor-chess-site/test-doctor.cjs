const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const E = require('./dist/engine.js');
const N = require('./dist/notation.js');
const B = require('./dist/doctor-book.js');
const O = require('./dist/outcome.js');
const Search = require('./dist/search.js');
const Report = require('./dist/game-report.js');
const { createHash } = require('node:crypto');
const manifest = require('./dist/vendor/stockfish/manifest.json');
for (const [file, hash] of Object.entries(manifest.files)) {
  assert.equal(
    createHash('sha256')
      .update(fs.readFileSync('dist/vendor/stockfish/' + file))
      .digest('hex'),
    hash,
    'Upstream artifact changed: ' + file
  );
}
assert.equal(
  Report.classify({ type: 'cp', score: 100 }, { type: 'cp', score: -240 }, 'w').grade,
  'blunder'
);
assert.equal(
  Report.classify({ type: 'cp', score: 0 }, { type: 'cp', score: 160 }, 'b').grade,
  'mistake'
);
assert.equal(
  Report.classify({ type: 'cp', score: 0 }, { type: 'cp', score: 160 }, 'w').grade,
  'good'
);
const state = (pgn) => N.fromPGN(pgn + ' *').positions.at(-1);
assert.equal(B.compile().size, 101);
for (const [side, title, page, pgn] of B.lines) {
  const line = N.fromPGN(pgn + ' *');
  for (const p of line.positions) {
    if (p.turn !== side) continue;
    const entry = B.lookup(p);
    if (entry) assert(E.legal(p, entry.move.from).includes(entry.move.to), title + ' p.' + page);
  }
}
assert.equal(N.san(E.initial(), B.lookup(E.initial()).move), 'e4');
assert.equal(N.san(state('1.d4'), B.lookup(state('1.d4')).move), 'e6');
assert.equal(N.san(state('1.e4 e5'), B.lookup(state('1.e4 e5')).move), 'Ke2');
assert.equal(N.san(state('1.e4 e6 2.d4'), B.lookup(state('1.e4 e6 2.d4')).move), 'h6');
assert.equal(
  N.san(state('1.e4 e6 2.d4 h6 3.Nf3'), B.lookup(state('1.e4 e6 2.d4 h6 3.Nf3')).move),
  'Ke7'
);
const trap = state('1.e4 d5 2.exd5 Qxd5');
assert(!B.candidates(trap).some((m) => m.from === 60 && m.to === 52), 'Do not play Ke2 into Qe4#');
const checked = state('1.e4 e5 2.Ke2 Nc6 3.d3 Bc5 4.g3 Nd4+');
assert.equal(B.candidates(checked).length, 0, 'A check overrides setup');
const forced = Search.search(E.initial(), {
  level: 3,
  budgetMs: 100,
  searchmoves: [{ from: 52, to: 36, promotion: 'q' }],
});
assert.equal(N.san(E.initial(), forced.move), 'e4');

const mate = state('1.f3 e5 2.g4 Qh4#');
assert.equal(O.describe(mate, [], { mode: 'computer', botSide: 'w' }).tone, 'loss');
assert.equal(O.describe(mate, [], { mode: 'local' }).title, 'Чёрные победили');
const fifty = { ...E.initial(), half: 100 };
assert.equal(O.describe(fifty, [], {}).result, 'draw');
assert.equal(O.describe(E.initial(), [], {}), null);
assert.equal(
  O.describe(mate, [], { game: { result: null } }),
  null,
  'Server confirmation wins over optimistic board'
);
const bishops = N.fromFEN('4k3/8/2b5/8/8/5B2/8/4K3 w - - 0 1');
assert(E.insufficientMaterial(bishops));
const opposite = N.fromFEN('4k3/8/3b4/8/8/5B2/8/4K3 w - - 0 1');
assert(!E.insufficientMaterial(opposite));
const ep = E.apply(E.initial(), 52, 36);
assert.equal(
  E.repetitionKey(ep),
  E.repetitionKey({ ...ep, ep: -1 }),
  'Uncapturable EP does not change repetition'
);
const canEp = state('1.e4 a6 2.e5 d5');
assert.notEqual(
  E.repetitionKey(canEp),
  E.repetitionKey({ ...canEp, ep: -1 }),
  'Legal EP changes repetition'
);
for (const result of ['w', 'b', 'draw']) {
  const out = O.describe(E.initial(), [], {
    game: { result, you: 'w', reason: 'Соперник сдался' },
  });
  assert.equal(out.tone, result === 'w' ? 'win' : result === 'b' ? 'loss' : 'draw');
  if (result === 'b') assert.equal(out.reason, 'Вы сдались.');
}
assert.equal(
  O.describe(E.initial(), [], { mode: 'analysis', archiveInfo: { result: '0-1' } }).result,
  'b'
);
console.log(
  'PASS: 15 handbook lines, 101 legal book positions, signature moves, Scandinavian safety, result perspectives'
);

// Exercise the production UCI adapter against the exact shipped WASM, not a mock engine.
class EngineWorker {
  constructor() {
    this.child = spawn(process.execPath, ['dist/vendor/stockfish/stockfish-19-lite-single.js']);
    let pending = '';
    this.child.stdout.on('data', (chunk) => {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) this.onmessage?.({ data: line.trim() });
    });
    this.child.on('error', (error) => this.onerror?.(error));
    this.child.stderr.on('data', () => {});
    this.child.on('exit', (code) => {
      if (code && !this.dead) this.onerror?.(new Error('Engine exited ' + code));
    });
  }
  postMessage(command) {
    this.child.stdin.write(command + '\n');
  }
  terminate() {
    this.dead = true;
    this.child.kill();
  }
}
const context = { Worker: EngineWorker, ChessNotation: N, setTimeout, clearTimeout, console };
vm.createContext(context);
vm.runInContext(
  fs.readFileSync('dist/stockfish-client.js', 'utf8') + '\nglobalThis.Engine = DoctorEngine;',
  context
);
async function search(p, roots) {
  const engine = new context.Engine();
  try {
    return await new Promise((resolve, reject) => {
      engine.onmessage = (e) => resolve(e.data);
      engine.onerror = reject;
      engine.postMessage({
        id: 17,
        state: p,
        options: { level: 3, budgetMs: 200, searchmoves: roots },
      });
    });
  } finally {
    engine.terminate();
  }
}
(async () => {
  const p = state('1.e4 d5 2.exd5 Qxd5 3.Ke2');
  const d = await search(p);
  assert.equal(d.id, 17);
  assert.equal(N.san(p, d.move), 'Qe4#');
  assert.equal(d.type, 'mate');
  const roots = [{ from: 52, to: 36, promotion: 'q' }];
  const forced = await search(E.initial(), roots);
  assert.equal(N.san(E.initial(), forced.move), 'e4');
  assert.equal(forced.source, 'plan');
  console.log(
    'PASS: bundled Stockfish 19 WASM, UCI handshake, mate, score, constrained search and shutdown'
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

const exportLine = N.fromPGN('1.e4 e5 2.Nf3 *');
const annotated = Report.annotatedPGN(
  exportLine,
  { Result: '*' },
  [{ after: { type: 'cp', score: 32 }, grade: 'good' }],
  N
);
assert(annotated.includes('[%eval 0.32]'));
assert.deepEqual(N.fromPGN(annotated).sans, exportLine.sans);
const blackLine = N.fromPGN(
  '[SetUp "1"]\n[FEN "4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 b - - 0 12"]\n\n12...e5 *'
);
assert(Report.annotatedPGN(blackLine, { Result: '*' }, [], N).includes('12... e5'));
console.log('PASS: annotated analysis PGN retains original moves and Black-to-move numbering');
