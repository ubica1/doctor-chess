const assert = require('assert'),
  E = require('./dist/engine.js'),
  N = require('./dist/notation.js'),
  S = require('./dist/search.js');
let state = E.initial(),
  records = [];
for (const [from, to] of [
  [52, 36],
  [12, 28],
  [62, 45],
  [1, 18],
  [61, 34],
  [6, 21],
  [60, 62],
]) {
  records.push({ from, to, promotion: 'q' });
  state = E.apply(state, from, to);
}
let line = N.replay(E.initial(), records);
assert.deepEqual(line.sans, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O']);
assert.deepEqual(N.describe(line.positions.slice(0, -1), state).sans, line.sans);
assert(
  N.pgn(line, { White: 'A"\\B', Result: '*' }).includes('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. O-O *')
);
line = N.replay(
  E.initial(),
  [
    [53, 45],
    [12, 28],
    [54, 38],
    [3, 39],
  ].map(([from, to]) => ({ from, to }))
);
assert.equal(line.sans.at(-1), 'Qh4#');
assert.equal(N.pgn(line, { Result: '0-1' }).trim().slice(-3), '0-1');
line = N.replay(
  E.initial(),
  [
    [52, 36],
    [8, 16],
    [36, 28],
    [11, 27],
    [28, 19],
  ].map(([from, to]) => ({ from, to }))
);
assert.equal(line.sans.at(-1), 'exd6');
state = { b: Array(64).fill(null), turn: 'w', rights: '', ep: -1, half: 0 };
state.b[7] = 'k';
state.b[63] = 'K';
state.b[8] = 'P';
assert.equal(N.san(state, { from: 8, to: 0, promotion: 'q' }), 'a8=Q+');
let promotion = N.replay(state, [{ from: 8, to: 0, promotion: 'n' }]);
assert(N.pgn(promotion).includes('[SetUp "1"]'));
assert.equal(promotion.positions[1].b[0], 'N');
state = { b: Array(64).fill(null), turn: 'w', rights: '', ep: -1, half: 0 };
state.b[4] = 'k';
state.b[60] = 'K';
state.b[57] = 'N';
state.b[61] = 'N';
assert.equal(N.san(state, { from: 57, to: 51 }), 'Nbd2');
state = { b: Array(64).fill(null), turn: 'w', rights: '', ep: -1, half: 0 };
state.b[7] = 'k';
state.b[22] = 'K';
state.b[13] = 'Q';
const mate = S.search(state, { level: 3, budgetMs: 500, maxDepth: 2 });
assert(mate.move);
assert(!E.allMoves(E.apply(state, mate.move.from, mate.move.to, mate.move.promotion)));
assert(mate.score > 90000);
for (const level of [1, 2, 3]) {
  const start = Date.now(),
    r = S.search(E.initial(), { level, budgetMs: 150 });
  assert(r.move);
  assert(E.legal(E.initial(), r.move.from).includes(r.move.to));
  assert(Date.now() - start < 1200);
  console.log('Search level', level, 'depth', r.depth, 'nodes', r.nodes, 'ms', r.elapsedMs);
}
console.log(
  'PASS: SAN, disambiguation, castling, en passant, promotion/FEN/PGN, replay, mate search and search budgets'
);
// Import round trips and explicit rejections: parsing never installs a partial game.
const parsed = N.fromPGN(
  '[White "Anna"]\n[Black "Bo"]\n1.e4 {a comment} e5 (1... c5 (1... e6)) 2.Nf3 $1 Nc6 1/2-1/2'
);
assert.deepEqual(parsed.sans, ['e4', 'e5', 'Nf3', 'Nc6']);
assert.equal(parsed.tags.White, 'Anna');
assert.equal(parsed.tags.Result, '1/2-1/2');
assert.deepEqual(N.fromPGN(N.pgn(parsed, parsed.tags)).sans, parsed.sans);
assert.deepEqual(N.fromPGN('1. e2e4 e7e5 *').sans, ['e4', 'e5']);
assert.throws(() => N.fromPGN('1. e5 *'), /не подходит/);
assert.throws(() => N.fromPGN('1. e4 (1. d4 *'), /Незакрытый/);
assert.throws(() => N.fromPGN('1. e4 * 1. d4 *'), /одну партию/);
assert.throws(() => N.fromPGN('[Result "1-0"]\n1.e4 0-1'), /не совпадает/);
const fenStart = N.fromFEN('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 12');
assert.equal(fenStart.fullmove, 12);
assert.equal(N.fen(fenStart), 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 12');
const fenLine = N.replay(fenStart, [{ from: 1, to: 18 }]);
assert.equal(fenLine.positions[1].fullmove, 13);
const fenPgn = N.pgn(fenLine);
assert(fenPgn.includes('12... Nc6 *'));
assert.deepEqual(N.fromPGN(fenPgn).sans, ['Nc6']);
assert.equal(N.fromPGN(fenPgn).positions[0].fullmove, 12);
assert.throws(() => N.fromFEN('8/8/8/8/8/8/8/8 w - - 0 1'), /король/);
assert.throws(() => N.fromFEN('8/8/8/8/8/8/4k3/4K3 w - - 0 1'), /шахом/);
assert.throws(() => N.fromFEN('4k3/8/8/8/8/8/8/4K3 w K - 0 1'), /рокировки/);
assert.throws(() => N.fromFEN('4k3/8/8/8/8/8/8/4K3 w - e6 0 1'), /проходе/);
assert.throws(() => N.fromFEN('P3k3/8/8/8/8/8/8/4K3 w - - 0 1'), /Пешка/);
console.log(
  'PASS: PGN/FEN import, nested comments/variations, custom Black-to-move numbering, malformed/illegal input rejection'
);

// A coordinate promotion suffix must describe a real promotion.
for (const invalid of ['1. g1f3q *', '1. e2e4n *']) assert.throws(() => N.fromPGN(invalid));
for (const promotion of ['q', 'r', 'b', 'n', '']) {
  const imported = N.fromPGN(
    '[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 1"]\n1. a7a8' + promotion + ' *'
  );
  assert.equal(imported.positions.at(-1).b[0], (promotion || 'q').toUpperCase());
  assert.equal(
    N.fen(N.fromPGN(N.pgn(imported)).positions.at(-1)),
    N.fen(imported.positions.at(-1))
  );
}
console.log('PASS: coordinate promotion suffixes and all four promotion round trips');
