const E = require('./dist/engine.js');

function validate(input) {
  try {
    const x = JSON.parse(input);
    if (x.action === 'initial') return { state: E.initial() };
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
    return {
      state: next,
      message,
      result: message ? (message.includes('Ничья') ? 'draw' : s.turn) : null,
    };
  } catch (error) {
    return { error: error.message };
  }
}

if (process.argv.includes('--stream')) {
  const lines = require('node:readline').createInterface({
    input: process.stdin,
    terminal: false,
    crlfDelay: Infinity,
  });
  lines.on('line', (line) => console.log(JSON.stringify(validate(line))));
} else {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (input += chunk));
  process.stdin.on('end', () => {
    const result = validate(input);
    console.log(JSON.stringify(result));
    if (result.error) process.exitCode = 1;
  });
}
