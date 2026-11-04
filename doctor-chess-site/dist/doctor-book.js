/* DJ Doctor's repertoire. Move data adapted from the author's 2026 handbook.
   Positions, not opponent move assumptions, select each continuation. */
const DoctorBook = (() => {
  const E =
      typeof module !== 'undefined'
        ? require('./engine.js')
        : { initial, color, legal, apply, check, allMoves },
    N = typeof module !== 'undefined' ? require('./notation.js') : ChessNotation;
  const lines = [
    [
      'w',
      'Открытая игра · спокойное развитие',
      10,
      '1.e4 e5 2.Ke2 Nf6 3.d3 Nc6 4.c3 d5 5.Nd2 Be7 6.g3 O-O 7.Bg2 Be6 8.Ngf3',
    ],
    ['w', 'Открытая игра · ранний центр', 11, '1.e4 e5 2.Ke2 d5 3.d3 Nf6 4.Nd2 Nc6 5.Ngf3'],
    ['w', 'Ранний ферзь · защита e4', 12, '1.e4 e5 2.Ke2 Qh4 3.d3 Bc5 4.g3 Qf6 5.Nf3 d6'],
    [
      'w',
      'Открытая игра · размен ферзей',
      28,
      '1.e4 e5 2.Ke2 Nc6 3.d3 Nf6 4.c3 d5 5.Nd2 dxe4 6.Nxe4 Be7 7.Nxf6+ Bxf6 8.g3 O-O 9.Bg2 Bg4+ 10.Nf3 e4 11.dxe4 Ne5 12.Qxd8 Raxd8 13.h3 Bxf3+ 14.Bxf3 Nc4 15.Be3 Nxe3 16.Kxe3',
    ],
    [
      'w',
      'Сицилианская · пешечный треугольник',
      26,
      '1.e4 c5 2.Ke2 d6 3.c3 e6 4.d3 Nf6 5.Nd2 Be7 6.g3 b6 7.Bg2 Bb7 8.Ngf3 Nc6 9.Re1 O-O 10.Nb3 d5 11.e5 Nd7 12.d4 Re8 13.Be3 cxd4 14.cxd4 Nf8 15.Rc1 Ng6',
    ],
    [
      'w',
      'Французская · закрыть центр',
      15,
      '1.e4 e6 2.Ke2 d5 3.e5 c5 4.d3 Nc6 5.Nf3 Nge7 6.g3 Ng6 7.Bg2 Be7',
    ],
    [
      'w',
      'Французская · фианкетто',
      27,
      '1.e4 e6 2.Ke2 d6 3.c3 g6 4.d3 Bg7 5.Nd2 Ne7 6.g3 O-O 7.Bg2 Nbc6 8.Ngf3 b6 9.Re1 Bb7',
    ],
    ['w', 'Каро–Канн · удержать e5', 16, '1.e4 c6 2.Ke2 d5 3.e5 Bf5 4.d3 e6 5.Nf3 Nd7 6.g3'],
    [
      'w',
      'Пирц · опора на d3',
      17,
      '1.e4 d6 2.Ke2 Nf6 3.d3 g6 4.g3 Bg7 5.Bg2 O-O 6.Nf3 c5 7.c3 Nc6 8.Re1',
    ],
    ['w', 'Модерн · фианкетто', 17, '1.e4 g6 2.Ke2 Bg7 3.d3 d6 4.Nf3 Nf6 5.g3 O-O 6.Bg2 e5 7.Re1'],
    [
      'b',
      'Против e4 · профилактика h6',
      20,
      '1.e4 e6 2.d4 h6 3.Nf3 Ke7 4.Bd3 d6 5.O-O g6 6.Re1 Bg7 7.c3 Nf6 8.Nbd2',
    ],
    [
      'b',
      'Против Nf3 · компактный центр',
      21,
      '1.e4 e6 2.Nf3 h6 3.d4 Ke7 4.Nc3 d6 5.Be2 g6 6.O-O Bg7 7.Re1',
    ],
    [
      'b',
      'Против d4 · закрытая структура',
      22,
      '1.d4 e6 2.c4 h6 3.Nc3 Ke7 4.Nf3 d6 5.e4 g6 6.Be2 Bg7 7.O-O',
    ],
    [
      'b',
      'Английское начало · компактный центр',
      23,
      '1.c4 e6 2.Nc3 h6 3.g3 Ke7 4.Bg2 d6 5.d4 g6 6.Nf3 Bg7',
    ],
    ['b', 'Рети · подготовка Ke7', 24, '1.Nf3 e6 2.g3 h6 3.Bg2 Ke7 4.O-O d6 5.d4 g6 6.c4 Bg7'],
  ];
  let entries;
  const key = (s) => N.fen(s).split(' ').slice(0, 4).join(' ');
  function compile() {
    if (entries) return entries;
    entries = new Map();
    for (const [side, title, page, pgn] of lines) {
      const line = N.fromPGN(pgn + ' *');
      line.records.forEach((move, i) => {
        const before = line.positions[i];
        if (before.turn !== side) return;
        const k = key(before);
        if (!entries.has(k)) entries.set(k, { move, title, page, side, source: 'book' });
      });
    }
    return entries;
  }
  function lookup(state) {
    return compile().get(key(state)) || null;
  }
  function candidates(state) {
    // Outside printed lines the king plan is attempted only while it is safe.
    // Checks and immediate tactics always override a development scheme.
    if (E.check(state, state.turn) || (state.fullmove || 1) > 10) return [];
    const white = state.turn === 'w',
      index = (square) => (8 - Number(square[1])) * 8 + square.charCodeAt(0) - 97,
      plans = white
        ? ['e2e4', 'e1e2', 'd2d3', 'c2c3', 'b1d2', 'g2g3', 'f1g2', 'g1f3', 'h1e1', 'e4e5']
        : ['e7e6', 'h7h6', 'e8e7', 'd7d6', 'g7g6', 'f8g7', 'g8f6', 'b8d7', 'c7c6'];
    const out = [],
      start = white ? 60 : 4,
      target = white ? 52 : 12,
      kingUnmoved = state.b[start] === (white ? 'K' : 'k');
    for (const uci of plans) {
      const from = index(uci.slice(0, 2)),
        to = index(uci.slice(2));
      if (E.color(state.b[from]) !== state.turn || !E.legal(state, from).includes(to)) continue;
      const next = E.apply(state, from, to);
      // Never follow a setup into a one-move mate, including the Scandinavian trap.
      const mateInOne = next.b.some(
        (p, i) =>
          E.color(p) === next.turn &&
          E.legal(next, i).some((j) => {
            const reply = E.apply(next, i, j);
            return E.check(reply, reply.turn) && !E.allMoves(reply);
          })
      );
      if (!mateInOne) out.push({ from, to, promotion: 'q' });
    }
    // Keep the signature opening when there is no immediate central conflict.
    const king = out.find((m) => m.from === start && m.to === target);
    if (!white && kingUnmoved) {
      const first = out.find((m) => m.from === 12 && m.to === 20);
      if (first && (state.fullmove || 1) === 1) return [first];
      const prophylaxis = out.find((m) => m.from === 15 && m.to === 23);
      if (prophylaxis && (state.fullmove || 1) === 2 && state.b[20] === 'p' && state.b[28] !== 'P')
        return [prophylaxis];
    }
    const early = (state.fullmove || 1) <= (white ? 2 : 3);
    const centralThreat = white ? state.b[27] === 'p' || state.b[21] === 'n' : state.b[28] === 'P';
    if (kingUnmoved && king && early && !centralThreat && (white || state.b[23] === 'p'))
      return [king];
    // Tactical captures/checks are included; no unrelated opening book is used.
    state.b.forEach((p, from) => {
      if (E.color(p) !== state.turn) return;
      for (const to of E.legal(state, from)) {
        if (state.b[to] || E.check(E.apply(state, from, to), white ? 'b' : 'w'))
          if (!out.some((m) => m.from === from && m.to === to))
            out.push({ from, to, promotion: 'q' });
      }
    });
    return out;
  }
  return { lines, key, lookup, candidates, compile };
})();
if (typeof module !== 'undefined') module.exports = DoctorBook;
