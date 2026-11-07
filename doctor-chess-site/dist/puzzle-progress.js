const puzzleResults = {
  all: 'Все попытки',
  win: 'Решено самостоятельно',
  retry: 'Решено после ошибки',
  revealed: 'Решение открыто',
  active: 'В процессе',
};

function showPuzzleProgressLogin(message) {
  $('community-page').innerHTML =
    '<div class="page-empty"><h1>Мой прогресс</h1><p>' +
    escapeHtml(message) +
    '</p><button class="primary" id="puzzle-progress-login">Войти</button><a href="/puzzles">К задачам →</a></div>';
  $('puzzle-progress-login').onclick = () => auth();
}

function puzzleRatingTrend(trend) {
  if (!trend.length)
    return '<p class="muted">График появится после первой новой попытки с рейтингом.</p>';
  const first = trend[0],
    last = trend.at(-1);
  const low = Math.min(...trend) - 4;
  const high = Math.max(...trend) + 4;
  const points = trend.map((rating, i) => [
    14 + (492 * i) / (trend.length - 1),
    100 - (86 * (rating - low)) / (high - low),
  ]);
  const [x, y] = points.at(-1);
  return `<svg class="puzzle-trend" viewBox="0 0 520 114" role="img" aria-label="Рейтинг за последние ${trend.length - 1} попыток: от ${first} до ${last}">
    <path d="M14 14h492m-492 43h492m-492 43h492" class="puzzle-trend-grid" />
    <polyline points="${points.map(([x, y]) => x + ',' + y).join(' ')}" class="puzzle-trend-line" />
    <circle cx="${x}" cy="${y}" r="5" />
  </svg><p class="puzzle-trend-label"><span>${first}</span><span>${last}</span></p>`;
}

function puzzleProgressPath(theme, result, page = 1) {
  const params = new URLSearchParams();
  if (theme !== 'mix') params.set('theme', theme);
  if (result !== 'all') params.set('result', result);
  if (page > 1) params.set('page', page);
  const query = params.toString();
  return '/puzzles/progress' + (query ? '?' + query : '');
}

async function loadPuzzleProgress() {
  const request = communityRequest;
  communityShell();
  communityNav('nav-puzzles');
  document.title = 'Прогресс в задачах · Doctor Chess';
  if (!user) {
    showPuzzleProgressLogin('Войдите, чтобы увидеть рейтинг, историю и результаты по темам.');
    return;
  }
  const params = new URLSearchParams(location.search);
  const theme = params.get('theme') || 'mix';
  const result = params.get('result') || 'all';
  try {
    const data = await api(
      'puzzles/progress?' +
        new URLSearchParams({
          theme,
          result,
          page: params.get('page') || '1',
        })
    );
    if (request !== communityRequest) return;
    const { progress, trend, themes, history, page, pages, total } = data;
    const accuracy = progress.played
      ? Math.round((100 * progress.wins) / progress.played) + '%'
      : '—';
    const options = [{ id: 'mix', name: 'Все темы' }, ...themes];
    $('community-page').innerHTML = `
      <div class="puzzle-progress">
        <section class="workspace-heading">
          <span class="workspace-seal" aria-hidden="true">练</span>
          <div><p>ТАКТИЧЕСКАЯ ТРЕНИРОВКА</p><h1>Мой прогресс</h1><p>История задач и результаты по темам.</p></div>
        </section>
        <nav class="workspace-tabs" aria-label="Тренировка">
          <a href="/puzzles">← К задачам</a><a href="/daily">Задача дня</a>
        </nav>
        <div class="puzzle-progress-summary">
          <section class="notebook-paper">
            <h2>Рейтинг задач</h2>
            <dl class="puzzle-progress-totals">
              <div><dt>Рейтинг</dt><dd>${progress.rating}</dd></div>
              <div><dt>Решено</dt><dd>${progress.wins} из ${progress.played}</dd></div>
              <div><dt>Доля решений</dt><dd>${accuracy}</dd></div>
            </dl>
            ${puzzleRatingTrend(trend)}
          </section>
          <section class="notebook-paper">
            <h2>Результаты по темам</h2>
            <ul class="puzzle-theme-stats">${themes
              .map(
                (item) => `
              <li>
                <div><a href="/puzzles?theme=${encodeURIComponent(item.id)}">${escapeHtml(item.name)}</a>
                  <span>${item.played ? item.wins + ' из ' + item.played : '—'}</span></div>
                ${item.played ? `<progress max="${item.played}" value="${item.wins}" aria-label="Самостоятельные решения: ${escapeHtml(item.name)}"></progress>` : ''}
              </li>`
              )
              .join('')}</ul>
            <p class="muted">Одна задача может учитываться сразу в нескольких темах.</p>
          </section>
        </div>
        <section class="notebook-paper puzzle-history">
          <h2>История задач</h2>
          <div class="trainer-filters" aria-label="Фильтры истории">
            <label>Тема<select id="puzzle-history-theme">${options.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === theme ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label>
            <label>Результат<select id="puzzle-history-result">${Object.entries(puzzleResults)
              .map(
                ([key, label]) =>
                  `<option value="${key}" ${key === result ? 'selected' : ''}>${label}</option>`
              )
              .join('')}</select></label>
            <span>${total} ${plural(total, ['попытка', 'попытки', 'попыток'])}</span>
          </div>
          ${
            history.length
              ? `<ul class="puzzle-history-list">${history
                  .map(
                    (attempt) => `
            <li><a href="/puzzles/progress/${encodeURIComponent(attempt.id)}">
              <div><strong>Задача #${escapeHtml(attempt.id)}</strong><small>${escapeHtml(attempt.themes.join(' · '))}</small></div>
              <span>${puzzleResults[attempt.result]}<small>${attempt.updatedAt ? dateLabel(attempt.updatedAt) : 'Дата не записана'}</small></span>
              <span class="puzzle-history-score" data-positive="${attempt.delta > 0}">${attempt.delta === null ? '—' : (attempt.delta > 0 ? '+' : '') + attempt.delta}</span>
            </a></li>`
                  )
                  .join('')}</ul>`
              : '<p class="puzzle-history-empty">Пока нет задач для этих фильтров. <a href="/puzzles">К тренировке →</a></p>'
          }
          ${
            pages > 1
              ? `<div class="history-pagination" aria-label="Страницы истории">
            ${page > 1 ? `<a href="${escapeHtml(puzzleProgressPath(theme, result, page - 1))}">← Назад</a>` : '<span></span>'}
            <span>${page} / ${pages}</span>
            ${page < pages ? `<a href="${escapeHtml(puzzleProgressPath(theme, result, page + 1))}">Далее →</a>` : '<span></span>'}
          </div>`
              : ''
          }
        </section>
      </div>`;
    const filter = () =>
      navigate(
        puzzleProgressPath($('puzzle-history-theme').value, $('puzzle-history-result').value)
      );
    $('puzzle-history-theme').onchange = filter;
    $('puzzle-history-result').onchange = filter;
  } catch (error) {
    if (request !== communityRequest || error.staleSession) return;
    $('community-page').innerHTML =
      '<div class="page-empty"><h1>Не удалось открыть прогресс</h1><p>' +
      escapeHtml(error.message) +
      '</p><a href="/puzzles/progress">Повторить →</a></div>';
  }
}
