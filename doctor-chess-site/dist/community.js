function plural(n, forms) {
  const d = Math.abs(n) % 100;
  return forms[d > 10 && d < 20 ? 2 : d % 10 === 1 ? 0 : d % 10 >= 2 && d % 10 <= 4 ? 1 : 2];
}
let communityRequest = 0;
const emblemNames = { crane: 'Журавль', dragon: 'Дракон', bamboo: 'Бамбук', mountain: 'Горы' };
function emblem(kind = 'crane') {
  const drawings = {
    crane:
      '<circle cx="73" cy="22" r="14" fill="currentColor" opacity=".18" stroke="none"/><path d="M24 68c12-8 22-10 31-7 7 3 7 8 3 11-11 8-24 4-34-4Zm31-5c11-5 19-19 16-28-4-10-15-4-13 3 1 6 5 6 6 12M58 34l-10 2 11 3M38 73l-6 21m15-19 2 19M27 67C9 61 7 45 11 33c11 16 17 18 28 22M28 58C23 42 29 29 35 21c0 20 4 24 13 34M47 66l-12 2m-5 26h10m7 0h9"/>',
    bamboo:
      '<path d="M42 95 48 7M55 95 67 16M41 72h8M43 47h8M45 23h8M57 72h8M60 47h8M64 25h8M46 49C31 26 20 27 12 32c13 1 23 7 34 17Zm0 1C26 45 18 52 15 61c10-6 21-10 31-11Zm15-2c7-23 17-27 27-25-10 6-19 15-27 25Zm-3 22c12-13 24-13 31-5-11-1-22 0-31 5ZM45 27C33 15 23 14 17 18c11 0 20 4 28 9Z"/>',
    mountain:
      '<circle cx="72" cy="22" r="11" fill="currentColor" opacity=".25" stroke="none"/><path d="m7 78 30-48 19 30 9-15 28 34M27 46l10-16 10 16-10-4-10 4Zm29 14 9-15 10 16M14 84h70M27 91h67M8 24h23m-9-8h22M29 73l8-16 11 18"/>',
    dragon: '<use href="#dragon" transform="translate(-12 0) scale(.5)"/>',
  };
  return `<svg viewBox="0 0 100 100" aria-hidden="true" class="emblem-art" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${drawings[kind] || drawings.crane}</svg>`;
}
function profilePath(username) {
  return '/player/' + encodeURIComponent(username);
}
function navigate(path) {
  if ($('modal').open) $('modal').close();
  if (location.pathname + location.search !== path) window.history.pushState({}, '', path);
  routePage();
  scrollRoomToTop();
}
function openPlayer(username) {
  navigate(profilePath(username));
}
function communityNav(which) {
  document
    .querySelectorAll('nav button')
    .forEach((b) => b.classList.toggle('nav-active', b.id === which));
}
async function routePage() {
  roomGeneration++;
  roomLoading = false;
  cancelOutcomeReveal();
  academyBoard?.destroy?.();
  academyBoard = null;
  stopInvitationWatch();
  const path = location.pathname;
  communityRequest++;
  if (path === '/' || path === '/index.html') {
    $('game-page').classList.add('lobby');
    $('game-page').classList.remove('game-room');
    $('room-heading').hidden = true;
    $('game-settings').open = true;
    $('game-page').hidden = false;
    $('community-page').hidden = true;
    communityNav('nav-play');
    document.title = 'Doctor Chess · Шахматная комната';
    updateResume();
    return;
  }
  if (/^\/game\/[a-f0-9]+$/.test(path)) return loadGameRoom(path.slice(6));
  if (/^\/play\/(computer|local|puzzle|analysis)$/.test(path)) {
    const target = path.slice(6),
      generation = roomGeneration;
    if (mode !== target) await changeMode(target);
    if (generation !== roomGeneration) return;
    displayRoom(
      target === 'computer'
        ? 'За столом с DJ Doctor'
        : target === 'analysis'
          ? 'Разбор за своим столом'
          : target === 'local'
            ? 'Домашняя партия'
            : 'Разминка для ума'
    );
    render();
    return;
  }
  $('game-page').classList.remove('lobby', 'game-room');
  $('room-heading').hidden = true;
  if (path.startsWith('/invite/')) return loadInvitation(path.slice(8));
  if (path === '/players') return showPlayers();
  if (path === '/academy') return showAcademy();
  if (path.startsWith('/review/')) return loadReviewGame(path.slice(8));
  if (path.startsWith('/player/')) {
    try {
      return loadPlayer(decodeURIComponent(path.slice(8)));
    } catch {}
  }
  $('game-page').hidden = true;
  $('community-page').hidden = false;
  $('community-page').innerHTML =
    '<div class="page-empty"><h1>Страница не найдена</h1><a href="/">Вернуться к доске →</a></div>';
}
function communityShell() {
  $('game-page').hidden = true;
  $('community-page').hidden = false;
  $('community-page').innerHTML =
    '<div class="community-loading" role="status">Открываем страницу…</div>';
}
function dateLabel(t) {
  return new Date(t * 1000).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
async function loadPlayer(username, page = 1, category = 'all') {
  const request = ++communityRequest;
  communityShell();
  communityNav(user?.username === username ? 'nav-profile' : 'nav-players');
  try {
    const data = await api(
      'players/' + encodeURIComponent(username) + '?page=' + page + '&category=' + category
    );
    if (request !== communityRequest) return;
    const p = data.player,
      own = user?.id === p.id,
      st = p.stats,
      total = st.played;
    document.title = p.username + ' · Doctor Chess';
    $('community-page').innerHTML =
      `<div class="breadcrumbs"><a href="/">棋室 · Клуб</a><span>/</span><a href="/players">Игроки</a><span>/</span><span>${escapeHtml(p.username)}</span></div>
 <section class="profile-banner"><div class="profile-banner-top"><span>棋友录 <small>КНИГА ИГРОКОВ</small></span><span>DOCTOR CHESS / ${new Date(p.created * 1000).getFullYear()}</span></div><div class="profile-identity"><div class="public-avatar">${emblem(p.avatar)}</div><div class="identity-text"><span class="profile-kicker">ИГРОК КЛУБА</span><h1>${escapeHtml(p.username)}</h1><p>В клубе с ${dateLabel(p.created)}</p></div><div class="banner-calligraphy" aria-hidden="true">以棋<br>会友</div></div><div class="profile-banner-bottom"><p>${escapeHtml(p.bio || 'Здесь начинается шахматная история.')}</p><div><button id="share-profile">Ссылка на профиль ↗</button>${own ? '<button id="edit-profile">Редактировать</button>' : ''}</div></div></section>
 <div class="profile-layout"><aside class="profile-side"><div class="profile-section-title"><span>战绩</span><h2>За доской</h2></div><strong class="total-played">${total}</strong><p class="small-caption">${plural(total, ['завершённая партия', 'завершённые партии', 'завершённых партий'])}</p><div class="results-track" aria-label="Результаты партий">${total ? `<span class="win" style="flex:${st.wins}"></span><span class="draw" style="flex:${st.draws}"></span><span class="loss" style="flex:${st.losses}"></span>` : '<span class="unplayed"></span>'}</div><dl class="result-breakdown"><div><dt><i class="win-dot"></i>Победы</dt><dd>${st.wins}</dd></div><div><dt><i class="draw-dot"></i>Ничьи</dt><dd>${st.draws}</dd></div><div><dt><i class="loss-dot"></i>Поражения</dt><dd>${st.losses}</dd></div></dl><div class="win-percent"><strong>${total ? Math.round((st.wins / total) * 100) + '%' : '—'}</strong><span>доля побед</span></div><div class="profile-side-note"><span>棋</span><p>${total ? 'Каждая партия остаётся<br>частью вашей истории.' : 'Первая партия ещё впереди.'}</p></div></aside>
 <div class="profile-main"><section class="public-ratings"><div class="profile-section-title"><span>棋力</span><h2>Рейтинги</h2><small>ELO · СТАРТ 1200</small></div><div class="rating-ledger">${Object.entries(
   cats
 )
   .map(([c, t], i) => {
     const r = p.ratings[c];
     return `<button class="ledger-rating ${category === c ? 'selected' : ''}" data-rating-category="${c}"><span class="ledger-symbol">${['一', '三', '十', '卅'][i]}</span><span class="ledger-name">${t}</span><strong>${r.rating}<sup>${r.played ? '' : '?'}</sup></strong><small>${r.played ? r.played + ' ' + plural(r.played, ['партия', 'партии', 'партий']) : 'Ещё не играл'}</small></button>`;
   })
   .join(
     ''
   )}</div><p class="rating-footnote">? — стартовый рейтинг, пока нет завершённых партий в этом контроле.</p></section>
 <section class="public-history"><div class="profile-section-title"><span>棋谱</span><h2>Последние партии</h2><small>${data.player.total_games}</small></div><div class="history-filters">${[['all', 'Все'], ...Object.entries(cats)].map(([c, t]) => `<button data-history-filter="${c}" class="${category === c ? 'selected' : ''}">${t}</button>`).join('')}</div>${p.games.length ? `<div class="game-log"><div class="game-log-head"><span>Соперник</span><span>Контроль</span><span>Результат</span><span>Дата</span></div>${p.games.map((g) => `<div class="game-log-row"><a class="opponent-link" href="${profilePath(g.opponent.username)}"><span class="opponent-emblem">${emblem(g.opponent.avatar)}</span><span>${escapeHtml(g.opponent.username)}<small>${g.side === 'w' ? 'Белыми' : 'Чёрными'}</small></span></a><span class="log-control">${g.control}<small>${g.kind === 'casual' ? 'Дружеская' : cats[g.category]}</small></span><a href="/review/${g.id}" class="log-result ${g.result}" title="Разобрать партию: ${escapeHtml(g.reason)}">${{ win: 'Победа', draw: 'Ничья', loss: 'Поражение' }[g.result]} ↗</a><time>${dateLabel(g.created)}</time></div>`).join('')}</div>` : `<div class="history-empty"><div>${piece('N')}</div><h3>${category === 'all' ? 'Первая глава ещё не написана.' : 'В этом ритме пока без партий.'}</h3><p>Завершённые партии появятся здесь вместе с результатами.</p><a href="/">К игровой доске →</a></div>`}<div class="history-pagination"><button id="prev-games" ${page === 1 ? 'disabled' : ''}>← Назад</button><span>${page} / ${Math.max(1, Math.ceil(p.total_games / 12))}</span><button id="next-games" ${page * 12 >= p.total_games ? 'disabled' : ''}>Далее →</button></div></section></div></div><div class="community-footer"><span>以棋会友 · Встречаемся за шахматами</span><a href="/">Doctor Chess</a></div>`;
    $('share-profile').onclick = async () => {
      const link = location.origin + profilePath(p.username);
      try {
        await navigator.clipboard.writeText(link);
        toast('Ссылка скопирована');
      } catch {
        show(
          'Ссылка на профиль',
          `<label for="profile-url">Скопируйте адрес</label><input readonly id="profile-url" value="${escapeHtml(link)}">`
        );
      }
    };
    if (own) $('edit-profile').onclick = () => editProfile(p);
    document
      .querySelectorAll('[data-history-filter],[data-rating-category]')
      .forEach(
        (b) =>
          (b.onclick = () =>
            loadPlayer(p.username, 1, b.dataset.historyFilter || b.dataset.ratingCategory))
      );
    $('prev-games').onclick = () => loadPlayer(p.username, page - 1, category);
    $('next-games').onclick = () => loadPlayer(p.username, page + 1, category);
  } catch (e) {
    if (request !== communityRequest) return;
    $('community-page').innerHTML =
      `<div class="page-empty"><span class="error-seal">棋</span><h1>${escapeHtml(e.message)}</h1><p>Проверьте имя игрока в адресе страницы.</p><a href="/players">Открыть книгу игроков →</a></div>`;
  }
}
function editProfile(p) {
  let chosen = p.avatar;
  show(
    'Ваш знак. Ваша история.',
    `<form id="public-profile-form"><label>Эмблема игрока</label><div class="avatar-options">${Object.entries(
      emblemNames
    )
      .map(
        ([v, t]) =>
          `<button type="button" data-avatar="${v}" class="${chosen === v ? 'selected' : ''}" aria-label="${t}">${emblem(v)}<small>${t}</small></button>`
      )
      .join(
        ''
      )}</div><label for="public-bio">О себе</label><textarea id="public-bio" maxlength="240" placeholder="Что вы любите в шахматах?">${escapeHtml(p.bio)}</textarea><p class="muted">Эмблема и описание видны всем посетителям профиля.</p><div class="form-error" id="edit-error" role="alert"></div><button class="primary" id="save-public-profile">Сохранить изменения</button></form><button class="logout" id="logout">Выйти из профиля</button>`
  );
  document.querySelectorAll('[data-avatar]').forEach(
    (b) =>
      (b.onclick = () => {
        chosen = b.dataset.avatar;
        document
          .querySelectorAll('[data-avatar]')
          .forEach((x) => x.classList.toggle('selected', x === b));
      })
  );
  $('public-profile-form').onsubmit = async (e) => {
    e.preventDefault();
    $('save-public-profile').disabled = true;
    try {
      user = (await api('profile', { bio: $('public-bio').value, avatar: chosen })).user;
      updateUser();
      $('modal').close();
      await loadPlayer(user.username);
      toast('Профиль обновлён');
    } catch (e) {
      $('edit-error').textContent = e.message;
    } finally {
      if ($('save-public-profile')) $('save-public-profile').disabled = false;
    }
  };
  $('logout').onclick = async () => {
    try {
      await api('logout', {});
      user = null;
      remoteGame = null;
      game = null;
      queued = false;
      resetBoard();
      updateUser();
      $('modal').close();
      render();
      routePage();
    } catch (e) {
      toast(e.message);
    }
  };
}
async function showPlayers(search = '') {
  const request = ++communityRequest;
  communityShell();
  communityNav('nav-players');
  document.title = 'Книга игроков · Doctor Chess';
  try {
    const x = await api('players?search=' + encodeURIComponent(search));
    if (request !== communityRequest) return;
    $('community-page').innerHTML =
      `<div class="breadcrumbs"><a href="/">棋室 · Клуб</a><span>/</span><span>Игроки</span></div><section class="directory-heading"><span class="directory-seal">棋<br>友</span><div><div class="eyebrow">DOCTOR CHESS / СООБЩЕСТВО</div><h1>Книга игроков</h1><p>У каждого свой стиль. У всех — любовь к игре.</p></div></section><form id="player-search"><label for="search-name">Найти игрока по имени</label><div><input id="search-name" maxlength="24" value="${escapeHtml(search)}" placeholder="Имя игрока"><button>Найти →</button></div></form><section class="player-directory">${x.players.length ? x.players.map((p) => `<a class="directory-player" href="${profilePath(p.username)}"><span class="directory-avatar">${emblem(p.avatar)}</span><span><strong>${escapeHtml(p.username)}</strong><small>В клубе с ${dateLabel(p.created)}</small></span><span class="directory-games">${p.played}<small>${plural(p.played, ['партия', 'партии', 'партий'])}</small></span><span class="directory-arrow">↗</span></a>`).join('') : '<div class="page-empty"><h2>Пока никого.</h2><p>Попробуйте другое имя или создайте первый профиль клуба.</p><button class="outline" id="join-club">Создать профиль →</button></div>'}</section><p class="directory-caption">Последние 50 игроков · Публичные профили открыты без регистрации.</p>`;
    $('player-search').onsubmit = (e) => {
      e.preventDefault();
      showPlayers($('search-name').value.trim());
    };
    if ($('join-club')) $('join-club').onclick = () => auth(true);
  } catch (e) {
    if (request === communityRequest)
      $('community-page').innerHTML =
        `<div class="page-empty"><h1>${escapeHtml(e.message)}</h1><a href="/">Вернуться к доске →</a></div>`;
  }
}
window.addEventListener('popstate', routePage);
document.addEventListener('click', (e) => {
  const link = e.target.closest('a');
  if (!link || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
  const url = new URL(link.href, location.href);
  if (
    url.origin === location.origin &&
    (url.pathname === '/' ||
      url.pathname === '/players' ||
      url.pathname === '/academy' ||
      url.pathname.startsWith('/player/') ||
      url.pathname.startsWith('/review/') ||
      url.pathname.startsWith('/invite/') ||
      url.pathname.startsWith('/game/') ||
      url.pathname.startsWith('/play/'))
  ) {
    e.preventDefault();
    navigate(url.pathname);
  }
});
