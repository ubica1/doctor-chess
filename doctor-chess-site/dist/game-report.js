/* Sequential analysis of an immutable game snapshot. Never runs during live online play. */
const DoctorReport = (() => {
  function value(info) {
    return info.type === 'mate'
      ? Math.sign(info.score) * (10000 - Math.min(Math.abs(info.score), 100) * 10)
      : info.score;
  }
  function classify(before, after, side) {
    const loss = Math.max(0, Math.round((value(before) - value(after)) * (side === 'w' ? 1 : -1)));
    return {
      loss,
      grade: loss >= 300 ? 'blunder' : loss >= 150 ? 'mistake' : loss >= 70 ? 'inaccuracy' : 'good',
    };
  }
  return { value, classify };
})();
if (typeof module !== 'undefined') module.exports = DoctorReport;
let reportGeneration = 0,
  reportWorker = null,
  reportPending = null,
  reportRunning = false,
  reportData = null,
  reportIdentity = '',
  reportRenderKey = '',
  reportProgress = 0;
function reportKey(line = currentLine()) {
  return (
    ChessNotation.fen(line.positions[0]) +
    '|' +
    line.records.map((m) => m.from + ':' + m.to + ':' + m.promotion).join(',')
  );
}
function cancelGameReport() {
  reportGeneration++;
  reportWorker?.terminate();
  reportWorker = null;
  reportPending?.(null);
  reportPending = null;
  reportRunning = false;
}
function updateGameReport() {
  const line = currentLine(),
    key = reportKey(line);
  $('analyze-game').disabled =
    !!active() || busy || botThinking || !line.records.length || reportRunning;
  $('analyze-game').textContent = reportRunning
    ? 'Разбираем ' + reportProgress + ' / ' + Math.min(line.records.length, 200)
    : 'Разобрать всю партию';
  if (key !== reportIdentity && reportRunning) cancelGameReport();
  $('game-report').hidden = !reportData || key !== reportIdentity || !!active();
  if ($('game-report').hidden) return;
  $('report-cancel').hidden = !reportRunning;
  const renderKey = reportData.rows.length + ':' + reportRunning + ':' + reportIdentity;
  if (renderKey === reportRenderKey) return;
  reportRenderKey = renderKey;
  const rows = reportData.rows,
    labels = { good: 'Ровный ход', inaccuracy: 'Неточность', mistake: 'Ошибка', blunder: 'Зевок' };
  $('report-summary').textContent =
    (reportRunning ? 'Считаем · ' : 'Разобрано · ') +
    rows.length +
    ' ' +
    plural(rows.length, ['полуход', 'полухода', 'полуходов']) +
    '. ' +
    rows.filter((r) => r.grade === 'blunder').length +
    ' зевков, ' +
    rows.filter((r) => r.grade === 'mistake').length +
    ' ошибок.';
  $('report-rows').innerHTML = rows
    .map(
      (r) =>
        `<button class="report-row" data-report-ply="${r.ply}"><span>${r.number}${r.side === 'w' ? '.' : '…'} <b>${escapeHtml(r.san)}</b><small>${r.book ? 'Ход репертуара Доктора' : 'Лучше: ' + escapeHtml(r.best)}</small></span><span class="report-grade ${r.grade}">${labels[r.grade]}<small>${r.loss >= 9000 ? 'Изменилась оценка мата' : '−' + (r.loss / 100).toFixed(2)} · ${r.after.type === 'mate' ? '#' + r.after.score : (r.after.score >= 0 ? '+' : '') + (r.after.score / 100).toFixed(2)}</small></span></button>`
    )
    .join('');
  document
    .querySelectorAll('[data-report-ply]')
    .forEach((b) => (b.onclick = () => setReview(Number(b.dataset.reportPly))));
}
async function analyzeWholeGame() {
  if (active() || busy || botThinking || reportRunning || !currentLine().records.length) return;
  cancelGameReport();
  const generation = reportGeneration,
    line = JSON.parse(JSON.stringify(currentLine()));
  reportIdentity = reportKey(line);
  reportRunning = true;
  reportProgress = 0;
  reportData = { rows: [], created: Date.now() };
  reportRenderKey = '';
  const score = async (position, ply) => {
    const ended = end(position, line.positions.slice(0, ply));
    if (ended)
      return {
        type: !allMoves(position) && check(position, position.turn) ? 'mate' : 'cp',
        score:
          !allMoves(position) && check(position, position.turn)
            ? position.turn === 'w'
              ? -1
              : 1
            : 0,
        depth: 0,
        move: null,
      };
    reportWorker = new DoctorEngine();
    const worker = reportWorker;
    try {
      return await new Promise((resolve, reject) => {
        reportPending = resolve;
        worker.onmessage = (event) => resolve(event.data);
        worker.onerror = reject;
        worker.postMessage({
          id: generation,
          state: position,
          line:
            'position fen ' +
            ChessNotation.fen(line.positions[0]) +
            (ply
              ? ' moves ' +
                line.records
                  .slice(0, ply)
                  .map((m, i) =>
                    DoctorEngine.uci({
                      ...m,
                      promotes:
                        line.positions[i].b[m.from].toLowerCase() === 'p' &&
                        (m.to < 8 || m.to >= 56),
                    })
                  )
                  .join(' ')
              : ''),
          options: { level: 3, budgetMs: 350 },
        });
      });
    } finally {
      worker.terminate();
      if (reportWorker === worker) {
        reportWorker = null;
        reportPending = null;
      }
    }
  };
  updateGameReport();
  try {
    let before = await score(line.positions[0], 0);
    for (let i = 0; i < Math.min(line.records.length, 200); i++) {
      if (generation !== reportGeneration || !before) return;
      const after = await score(line.positions[i + 1], i + 1);
      if (generation !== reportGeneration || !after) return;
      const position = line.positions[i],
        actual = line.records[i],
        book = DoctorBook.lookup(position),
        best =
          before.move && legal(position, before.move.from).includes(before.move.to)
            ? ChessNotation.san(position, before.move)
            : '—';
      reportData.rows.push({
        ply: i + 1,
        number: position.fullmove,
        side: position.turn,
        san: line.sans[i],
        best,
        book: book?.move.from === actual.from && book?.move.to === actual.to,
        after,
        ...DoctorReport.classify(before, after, position.turn),
      });
      reportProgress = i + 1;
      before = after;
      updateGameReport();
    }
  } catch {
    if (generation === reportGeneration)
      toast('Расчёт остановлен: Stockfish недоступен. Уже разобранные ходы сохранены на экране.');
  } finally {
    if (generation === reportGeneration) {
      reportRunning = false;
      updateGameReport();
    }
  }
}
function initializeGameReport() {
  $('analyze-game').onclick = analyzeWholeGame;
  $('report-cancel').onclick = () => {
    cancelGameReport();
    updateGameReport();
  };
}
