/* Independent UCI worker adapter. The engine never touches application state. */
class DoctorEngine {
  constructor() {
    this.worker = new Worker('/vendor/stockfish/stockfish-19-lite-single.js');
    this.worker.onmessage = (event) => this.receive(String(event.data));
    this.worker.onerror = () => this.fail('Не удалось загрузить Stockfish');
    this.worker.postMessage('uci');
    this.timer = setTimeout(() => this.fail('Stockfish не ответил вовремя'), 20000);
  }
  receive(text) {
    if (this.dead) return;
    for (const line of text.split('\n')) {
      if (line === 'uciok') {
        this.worker.postMessage('setoption name Hash value 32');
        this.worker.postMessage('isready');
      }
      if (line === 'readyok') {
        this.ready = true;
        clearTimeout(this.timer);
        if (this.request) this.search();
      }
      if (line.startsWith('info ')) {
        const score = line.match(/score (cp|mate) (-?\d+)/),
          depth = line.match(/depth (\d+)/),
          pv = line.match(/\bpv (.+)/);
        if (score)
          this.info = {
            ...this.info,
            type: score[1],
            score: Number(score[2]) * (this.request.state.turn === 'w' ? 1 : -1),
          };
        if (depth) this.info = { ...this.info, depth: Number(depth[1]) };
        if (pv) this.info = { ...this.info, pv: pv[1].split(' ') };
      }
      if (line.startsWith('bestmove ')) {
        clearTimeout(this.timer);
        const move = DoctorEngine.move(line.split(' ')[1]);
        this.onmessage?.({
          data: {
            id: this.request.id,
            move,
            ...this.info,
            engine: 'Stockfish 19 Lite',
            source: this.request.options?.searchmoves?.length ? 'plan' : 'search',
          },
        });
      }
    }
  }
  static move(uci) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci || '')) return null;
    const sq = (s) => (8 - Number(s[1])) * 8 + s.charCodeAt(0) - 97;
    return { from: sq(uci.slice(0, 2)), to: sq(uci.slice(2, 4)), promotion: uci[4] || 'q' };
  }
  static uci(m) {
    const sq = (i) => 'abcdefgh'[i % 8] + (8 - Math.floor(i / 8));
    return sq(m.from) + sq(m.to) + (m.promotion && m.promotes ? m.promotion : '');
  }
  postMessage(request) {
    this.request = request;
    if (this.ready) this.search();
  }
  search() {
    const { state, options = {} } = this.request,
      level = options.level || 3;
    this.info = { score: 0, type: 'cp', depth: 0, pv: [] };
    this.worker.postMessage('setoption name Skill Level value ' + [8, 16, 20][level - 1]);
    // Include the real preceding positions so repetitions influence the engine.
    const line = this.request.line;
    this.worker.postMessage(line || 'position fen ' + ChessNotation.fen(state));
    const roots = options.searchmoves || [],
      budget = options.budgetMs || [500, 1400, 3000][level - 1];
    this.timer = setTimeout(() => this.fail('Stockfish не завершил расчёт'), budget + 12000);
    this.worker.postMessage(
      'go movetime ' +
        budget +
        (roots.length
          ? ' searchmoves ' +
            roots
              .map((m) =>
                DoctorEngine.uci({
                  ...m,
                  promotes: state.b[m.from]?.toLowerCase() === 'p' && (m.to < 8 || m.to >= 56),
                })
              )
              .join(' ')
          : '')
    );
  }
  fail(message) {
    if (this.dead) return;
    this.terminate();
    this.onerror?.(new Error(message));
  }
  terminate() {
    this.dead = true;
    clearTimeout(this.timer);
    this.worker.terminate();
  }
}
