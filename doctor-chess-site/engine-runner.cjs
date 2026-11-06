const E = require('./dist/engine.js');
let input = '';
process.stdin.on('data', (s) => (input += s));
process.stdin.on('end', () => {
  try {
    const x = JSON.parse(input);
    if (x.action === 'initial') return console.log(JSON.stringify({ state: E.initial() }));
    const { state: s, from: i, to: j, promotion: p = 'q' } = x;
    if (
      !Number.isInteger(i) ||
      !Number.isInteger(j) ||
      i < 0 ||
      i > 63 ||
      j < 0 ||
      j > 63 ||
      !['q', 'r', 'b', 'n'].includes(p) ||
      E.color(s.b[i]) !== s.turn ||
      !E.legal(s, i).includes(j)
    )
      throw Error('Недопустимый ход');
    if (p !== 'q' && !(s.b[i].toLowerCase() === 'p' && (j < 8 || j >= 56)))
      throw Error('Превращение возможно только для пешки на последней горизонтали');
    const next = E.apply(s, i, j, p),
      message = E.end(next, x.history || []);
    console.log(
      JSON.stringify({
        state: next,
        message,
        result: message ? (message.includes('Ничья') ? 'draw' : s.turn) : null,
      })
    );
  } catch (e) {
    console.log(JSON.stringify({ error: e.message }));
    process.exitCode = 1;
  }
});
