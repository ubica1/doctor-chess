/* Connection recovery, presence and consensual actions at a friend's table. */
let connectionState = 'connecting',
  lastConnectionAt = 0,
  lobbyBusy = false;
let recoveryBusy = false;
let friendlyBusy = false,
  pendingGiftToken = null;
function connectionReceived() {
  connectionState = 'online';
  lastConnectionAt = Date.now();
  updateLiveStatus();
}
function connectionFailed() {
  connectionState = 'offline';
  updateLiveStatus();
}
function updateLiveStatus() {
  const band = $('connection-band');
  band.hidden = mode !== 'online' || !active();
  const stale = lastConnectionAt && Date.now() - lastConnectionAt > 12000;
  const connected = connectionState === 'online' && !stale;
  band.dataset.connection = connected ? 'online' : 'offline';
  $('connection-self').textContent = connected ? 'Вы на связи' : 'Восстанавливаем связь…';
  const opponent = game?.you === 'w' ? 'b' : 'w';
  $('connection-opponent').textContent = !connected
    ? 'Часы продолжают идти. Вернём позицию после подключения.'
    : game?.presence?.[opponent] === false
      ? 'Соперник не в сети · ждём возвращения'
      : game?.presence?.[opponent] === true
        ? 'Соперник на связи'
        : 'Проверяем связь с соперником…';
}
async function refreshLobby() {
  if (lobbyBusy || typeof location === 'undefined' || location.pathname !== '/') return;
  lobbyBusy = true;
  try {
    const data = await api('lobby');
    $('lobby-summary').textContent =
      `${data.online} ${plural(data.online, ['игрок в сети', 'игрока в сети', 'игроков в сети'])}`;
    document.querySelectorAll('[data-control]').forEach((button) => {
      const waiting = data.waiting[button.dataset.control] || 0;
      const badge = button.querySelector('.waiting-count');
      if (badge) {
        badge.textContent = waiting ? `Ждут: ${waiting}` : '';
        badge.hidden = !waiting;
      }
    });
  } catch {
    $('lobby-summary').textContent = 'Обновляем список игроков…';
  } finally {
    lobbyBusy = false;
  }
}
function updateFriendlyActions() {
  const casual = mode === 'online' && !!active() && game.kind === 'casual';
  $('friendly-actions').hidden = !casual;
  const offer = casual && game.takeback;
  $('takeback-offer').hidden = !offer;
  if (offer) {
    const own = offer.side === game.you;
    $('takeback-caption').textContent = own
      ? 'Просим соперника вернуть последний ход. Часы идут.'
      : 'Соперник просит вернуть свой последний ход. Потраченное время не возвращается.';
    $('takeback-accept').hidden = own;
    $('takeback-decline').textContent = own ? 'Отозвать' : 'Отклонить';
  }
  const lastSide = game?.moves?.length % 2 ? 'w' : 'b';
  $('takeback-request').disabled =
    friendlyBusy ||
    busy ||
    !casual ||
    !game.moves.length ||
    lastSide !== game.you ||
    !!offer ||
    (!!game?.takebackDeclined && lastSide === game.you);
  $('takeback-request').textContent =
    game?.takebackDeclined && lastSide === game.you
      ? 'Соперник отклонил возврат'
      : 'Попросить вернуть ход';
  $('takeback-request').title =
    'Вернуть свой последний ход до ответа соперника — только по его согласию';
  $('give-time').disabled = friendlyBusy || busy || !casual || game.giftsLeft === 0;
  $('give-time').title =
    game?.giftsLeft === 0
      ? 'В этой партии уже подарено пять минут'
      : 'Подарить сопернику 15 секунд';
  $('takeback-accept').disabled = $('takeback-decline').disabled = friendlyBusy || busy;
  $('resign').disabled = $('decline-draw').disabled = busy;
  $('draw').disabled = busy || (!!game?.offer && game.offer === game.you);
  updateLiveStatus();
  if (typeof updateWatchConsent === 'function') updateWatchConsent();
}
async function onlineAction(action) {
  if (!active() || busy) return;
  busy = true;
  networkEpoch++;
  const id = game.id,
    epoch = networkEpoch;
  render();
  try {
    const out = await api(action, { game: id });
    if (networkEpoch === epoch && mode === 'online' && game?.id === id) acceptGame(out.game);
  } catch (error) {
    toast(error.message);
  } finally {
    busy = false;
    networkEpoch++;
    render();
    poll();
  }
}
async function friendlyAction(action) {
  if (!active() || game.kind !== 'casual' || busy || friendlyBusy) return;
  busy = true;
  networkEpoch++;
  const id = game.id,
    epoch = networkEpoch;
  const payload = { game: id, ply: game.moves.length, offer: game.takeback?.id };
  if (action === 'give-time') {
    if (!pendingGiftToken || pendingGiftToken.game !== id) {
      pendingGiftToken = {
        game: id,
        token:
          window.crypto?.randomUUID?.() ||
          Date.now().toString(36) + Math.random().toString(36).slice(2),
      };
    }
    payload.token = pendingGiftToken.token;
  }
  friendlyBusy = true;
  updateFriendlyActions();
  try {
    const out = await api(action, payload);
    if (action === 'give-time') pendingGiftToken = null;
    if (networkEpoch === epoch && mode === 'online' && game?.id === id) acceptGame(out.game);
    if (action === 'give-time') toast('Сопернику добавлено 15 секунд');
  } catch (error) {
    toast(error.message);
  } finally {
    friendlyBusy = false;
    busy = false;
    networkEpoch++;
    updateFriendlyActions();
    poll();
  }
}
async function resumeLive() {
  if (recoveryBusy) return;
  recoveryBusy = true;
  try {
    if (!user && connectionState !== 'online') {
      const epoch = networkEpoch,
        path = location.pathname;
      const data = await api('me');
      if (epoch !== networkEpoch || user) return;
      user = data.user;
      updateUser();
      if (location.pathname === path) await routePage();
    }
    await poll();
    refreshLobby();
  } catch (error) {
    if (!error.staleSession) connectionFailed();
  } finally {
    recoveryBusy = false;
  }
}
function initializeLive() {
  for (const action of ['give-time', 'takeback-request', 'takeback-accept', 'takeback-decline'])
    $(action).onclick = () => friendlyAction(action);
  const resume = () => resumeLive();
  window.addEventListener('online', resume);
  window.addEventListener('offline', connectionFailed);
  window.addEventListener('focus', resume);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resume();
  });
  setInterval(updateLiveStatus, 1000);
  setInterval(() => {
    if (connectionState === 'offline') resumeLive();
  }, 5000);
  setInterval(refreshLobby, 10000);
  refreshLobby();
}
