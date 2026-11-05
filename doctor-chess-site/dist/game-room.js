/* Stable URLs for private live games; practice remains local to this browser. */
let roomGeneration = 0,
  roomLoading = false;
function scrollRoomToTop() {
  // Scrolling is cosmetic: it must never interrupt accepting a match.
  try {
    window.scrollTo(0, 0);
  } catch {}
}
function gameRoute() {
  return typeof location === 'undefined'
    ? null
    : /^\/game\/([a-f0-9]+)$/.exec(location.pathname)?.[1] || null;
}
function displayRoom(label) {
  $('game-page').classList.remove('lobby');
  $('game-page').classList.add('game-room');
  $('game-page').hidden = false;
  $('community-page').hidden = true;
  $('room-heading').hidden = false;
  $('room-label').textContent = label;
  $('game-settings').open = false;
  communityNav('nav-play');
  updateResume();
  document.title = label + ' · Doctor Chess';
}
function syncGameRoute(next, previous) {
  if (typeof location === 'undefined' || roomLoading || next.result) return;
  if (previous && previous.id === next.id) {
    if (
      gameRoute() === next.id &&
      ($('game-page').hidden || $('game-page').classList.contains('lobby'))
    ) {
      displayRoom('Партия ' + next.id.slice(0, 8) + ' · ' + next.control);
      render();
    }
    return;
  }
  if (location.pathname !== '/' && !gameRoute()) return;
  window.history.pushState({}, '', '/game/' + next.id);
  displayRoom('Партия ' + next.id.slice(0, 8) + ' · ' + next.control);
  scrollRoomToTop();
}
async function loadGameRoom(id) {
  const generation = roomGeneration;
  communityShell();
  if (!user) {
    $('community-page').innerHTML =
      '<div class="page-empty"><h1>Войдите в профиль участника</h1><p>Игровая комната доступна участникам партии. Для завершённых партий есть публичный разбор.</p><button id="room-login" class="primary">Войти</button><a href="/">В игровую комнату</a></div>';
    $('room-login').onclick = () => auth();
    return;
  }
  roomLoading = true;
  try {
    const data = await api('play/' + encodeURIComponent(id));
    if (generation !== roomGeneration || gameRoute() !== id) return;
    if (busy) throw Error('Дождитесь подтверждения хода и откройте партию ещё раз.');
    remoteGame = data.game;
    if (mode !== 'online' || game?.id !== id) await changeMode('online');
    if (generation !== roomGeneration || gameRoute() !== id) return;
    acceptGame(data.game);
    displayRoom('Партия ' + id.slice(0, 8) + ' · ' + data.game.control);
    render();
  } catch (error) {
    if (generation !== roomGeneration || gameRoute() !== id) return;
    $('community-page').innerHTML =
      '<div class="page-empty"><h1>Не удалось открыть партию</h1><p>' +
      escapeHtml(error.message) +
      '</p><a href="/">Вернуться в игровую комнату →</a></div>';
  } finally {
    if (generation === roomGeneration) roomLoading = false;
  }
}
function openPracticeRoom() {
  if (
    typeof location === 'undefined' ||
    !['computer', 'local', 'puzzle', 'analysis'].includes(mode)
  )
    return;
  if (location.pathname !== '/play/' + mode) window.history.pushState({}, '', '/play/' + mode);
  displayRoom(
    mode === 'computer'
      ? 'За столом с DJ Doctor'
      : mode === 'analysis'
        ? 'Разбор за своим столом'
        : mode === 'puzzle'
          ? 'Разминка для ума'
          : 'Домашняя партия'
  );
  scrollRoomToTop();
}
