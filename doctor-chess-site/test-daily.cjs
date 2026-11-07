const assert = require('node:assert/strict');
const Daily = require('./dist/daily-puzzle.js');
const Engine = require('./dist/engine.js');
const Notation = require('./dist/notation.js');

const day = Daily.day(Date.parse('2026-11-06T21:00:00Z'));
assert.equal(Daily.day(Date.parse('2026-11-06T20:59:59Z')), day - 1);
assert.notEqual(Daily.puzzle(day - 1), Daily.puzzle(day));
assert.equal(Daily.puzzle(day + 20), Daily.puzzle(day));

const positions = new Set();
for (let n = 0; n < 20; n++) {
  const [distance, fen] = Daily.puzzle(day + n);
  const start = Notation.fromFEN(fen);
  assert(!Engine.check(start, Engine.opp(start.turn)), fen);
  assert(!positions.has(fen), fen);
  positions.add(fen);
  if (distance === 2) assert.equal(Daily.solutions(start, 1).length, 0, fen);
  const lines = Daily.solutions(start, distance);
  assert.equal(lines.length, 1, fen);
  assert.equal(lines[0].length, distance * 2 - 1, fen);
  const replay = Notation.replay(start, lines[0]);
  assert(replay.sans.at(-1).endsWith('#'), fen);
}

const [distance, fen] = Daily.puzzle(day + 2);
const start = Notation.fromFEN(fen);
const [line] = Daily.solutions(start, distance);
assert.equal(Notation.san(start, line[0]), 'Qg6+');
const defense = Daily.after(start, line[0]);
for (const to of Engine.legal(defense, defense.b.indexOf('k'))) {
  const reply = Engine.apply(defense, defense.b.indexOf('k'), to);
  assert(Daily.solutions(reply, 1).length > 0);
}
const promotion = Notation.fromFEN(Daily.puzzle(day + 6)[1]);
assert.deepEqual(Notation.replay(promotion, Daily.solutions(promotion, 1)[0]).sans, ['c1=Q#']);

const days = new Map([
  [day - 1, 'solved'],
  [day - 2, 'solved'],
  [day - 3, 'assisted'],
]);
const read = (day) => days.get(day);
assert.equal(Daily.streak(day, read), 2);
days.set(day, 'hint');
assert.equal(Daily.streak(day + 1, read), 0);
days.set(day, 'solved');
assert.equal(Daily.streak(day, read), 3);
console.log(
  'PASS: 20 unique daily positions, Moscow rollover, mate distances, defenses, promotion and streak'
);
