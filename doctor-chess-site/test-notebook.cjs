const assert = require('node:assert/strict');
const E = require('./dist/engine.js');
const N = require('./dist/notation.js');
const T = require('./dist/study-tree.js');
const D = require('./dist/mistake-practice.js');
const clone = (x) => JSON.parse(JSON.stringify(x));
function shape(document) {
  const t = T.read(document);
  const visit = (id) => ({
    san: t.sans.get(id) || '',
    comment: t.byId.get(id).comment,
    nag: t.byId.get(id).nag,
    children: (t.children.get(id) || []).map(visit),
  });
  return { start: t.document.start, root: visit('root') };
}
const parsed = T.fromPGN(
  '[Event "Тетрадь"]\n\n{План} 1.e4! {Центр} (1.d4 d5 (1...Nf6)) e5 2.Nf3 (2.Bc4 Nf6) Nc6 *'
);
assert.equal(parsed.title, 'Тетрадь');
assert.equal(parsed.document.nodes.length, 10);
assert.deepEqual(
  shape(T.fromPGN(T.pgn(parsed.document, parsed.title)).document),
  shape(parsed.document)
);
assert.equal(T.fromPGN('1.e4$1 e5 *').document.nodes[1].nag, 1);
assert.equal(T.fromPGN('1.e4 ! e5 *').document.nodes[1].nag, 1);
let tree = T.read(parsed.document);
const [main, alternative] = tree.children.get('root');
const promoted = T.promote(parsed.document, alternative);
assert.equal(T.read(promoted).children.get('root')[0], alternative);
const removed = T.remove(parsed.document, main);
assert.equal(T.read(removed).children.get('root').length, 1);
assert.equal(T.read(removed).sans.get(alternative), 'd4');
assert.throws(() => T.remove(parsed.document, 'root'));
assert.equal(
  T.add(parsed.document, 'root', { from: 52, to: 36 }).document.nodes.length,
  parsed.document.nodes.length
);
const cyclic = clone(parsed.document);
cyclic.nodes[1].parent = cyclic.nodes[1].id;
assert.throws(() => T.read(cyclic));
const bad = clone(parsed.document);
bad.nodes[1].move.to = 20;
assert.throws(() => T.read(bad));
const duplicate = clone(parsed.document);
duplicate.nodes.push({ ...duplicate.nodes[1], id: 'duplicate' });
assert.throws(() => T.read(duplicate));
const longNote = clone(parsed.document);
longNote.nodes[0].comment = 'x'.repeat(2001);
assert.throws(() => T.read(longNote));
const underpromotion = T.fromPGN('[SetUp "1"]\n[FEN "7k/P7/6K1/8/8/8/8/8 w - - 0 1"]\n\n1.a8=N *');
assert.equal(T.read(underpromotion.document).positions.get('n1').b[0], 'N');
assert.deepEqual(
  shape(T.fromPGN(T.pgn(underpromotion.document)).document),
  shape(underpromotion.document)
);
const black = T.fromPGN(
  '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/4K2R b - - 0 23"]\n\n23... Kd7 24.Rh7+ *'
);
assert(T.pgn(black.document).includes('23... Kd7'));
const castling = T.fromPGN('1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.O-O *');
assert.equal(T.read(castling.document).positions.get('n7').b[62], 'K');
const ep = T.fromPGN('1.e4 a6 2.e5 d5 3.exd6 *');
assert.equal(T.read(ep.document).positions.get('n5').b[27], null);
assert.equal(T.read(ep.document).positions.get('n5').b[19], 'P');
for (const pgn of [
  '1.e4 (1.d4',
  '1.e4 {unclosed',
  '1.e4 * 1...e5',
  '1.e4 )',
  '(1.e4)',
  '1.e4 e4 *',
])
  assert.throws(() => T.fromPGN(pgn));
let deep = T.create(),
  at = 'root';
for (let n = 0; n < 200; n++) {
  const m = [
    { from: 62, to: 45 },
    { from: 6, to: 21 },
    { from: 45, to: 62 },
    { from: 21, to: 6 },
  ][n % 4];
  const next = T.add(deep, at, m);
  deep = next.document;
  at = next.id;
}
assert.throws(() => T.add(deep, at, { from: 62, to: 45 }), /200/);
console.log(
  'PASS: legal study trees, nested PGN, comments/NAG, promotion, branches, cycles and depth limits'
);
const line = N.fromPGN('1.f3 e5 2.g4 Qh4# *'),
  position = line.positions[3];
const item = {
  fen: N.fen(position),
  move: line.records[3],
  source: 'Моя партия',
  actual: 'Nc6',
  grade: 'blunder',
};
const first = D.add([], item, 1000);
assert(first.added);
assert.equal(D.add(first.rows, item, 5000).added, false);
let row = D.attempt(first.rows[0], true, false, 2000);
assert.equal(row.solved, 1);
assert.equal(row.streak, 1);
assert.equal(row.due, 2000 + 86400000);
row = D.attempt(row, true, false, 3000);
assert.equal(row.due, 3000 + 3 * 86400000);
row = D.attempt(row, true, true, 4000);
assert.equal(row.solved, 2);
assert.equal(row.streak, 0);
assert.equal(row.due, 304000);
assert.equal(D.read(JSON.stringify([row]))[0].best, 'Qh4#');
assert.deepEqual(D.read('{broken'), []);
assert.deepEqual(D.read(JSON.stringify([{ ...row, attempts: -1 }])), []);
assert.throws(() => D.add([], { ...item, move: { from: 99, to: 0 } }));
assert.throws(() => D.add([], { ...item, move: { ...item.move, promotion: 'n' } }));
assert.equal(N.fen(E.initial()), T.create().start);
console.log(
  'PASS: personal mistake deduplication, assisted attempts, scheduling and damaged storage'
);
