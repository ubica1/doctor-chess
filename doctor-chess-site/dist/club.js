/* Friend invitations and post-game actions; no message is sent on the user's behalf. */
let invitationTimer = null,
  invitationVersion = 0,
  invitationLoading = false;
function stopInvitationWatch() {
  if (invitationTimer) clearInterval(invitationTimer);
  invitationTimer = null;
  invitationVersion++;
  invitationLoading = false;
}
async function enterMatchedGame(next) {
  if (busy) return false;
  remoteGame = next;
  await changeMode('online');
  acceptGame(next);
  navigate('/game/' + next.id);
  return true;
}
function updateSocialPanel() {
  updatePremove();
  const online = mode === 'online',
    finished = online && !!game?.result;
  $('friend-game').disabled = busy || (!!remoteGame && !remoteGame.result);
  $('postgame').hidden = !finished;
  if (finished) {
    $('postgame-review').href = '/review/' + game.id;
    $('rematch').textContent = game.rematch?.own
      ? 'Реванш предложен'
      : game.rematch
        ? 'Принять реванш'
        : 'Предложить реванш';
    $('rematch').disabled = busy || !!game.rematch?.own;
    $('cancel-rematch').hidden = !game.rematch?.own;
    $('rematch-note').textContent = game.rematch
      ? game.rematch.own
        ? 'Ожидаем согласия соперника.'
        : 'Соперник предлагает ещё одну партию.'
      : 'Цвета поменяются, контроль и тип партии сохранятся.';
  }
  const offer = active() && game.offer;
  $('decline-draw').hidden = !offer;
  $('decline-draw').textContent = offer === game?.you ? 'Отозвать ничью' : 'Отклонить ничью';
  $('draw').disabled = !!offer && offer === game?.you;
  if (online && active())
    $('queue-note').textContent =
      (game.kind === 'casual' ? 'Дружеская партия · без рейтинга' : 'Рейтинговая партия') +
      ' · ' +
      game.control;
}
function createFriendGame() {
  if (!user) return auth(true);
  if (remoteGame && !remoteGame.result) return toast('Сначала завершите текущую сетевую партию.');
  show(
    'Позовём друга за доску.',
    `<p>Создайте ссылку на дружескую партию. Рейтинг останется прежним.</p><form id="friend-form"><label for="friend-control">Контроль времени</label><select id="friend-control">${['1+0', '3+0', '3+2', '5+0', '10+0', '15+10', '30+0'].map((c) => `<option value="${c}" ${c === control ? 'selected' : ''}>${c}</option>`).join('')}</select><label for="friend-color">Ваш цвет</label><select id="friend-color"><option value="random">Случайный</option><option value="w">Белые</option><option value="b">Чёрные</option></select><p class="muted">Ссылка действует 30 минут. Отправьте её другу — он сможет присоединиться со своего устройства.</p><div class="form-error" id="friend-error" role="alert"></div><button id="create-friend" class="primary">Создать приглашение →</button></form>`
  );
  $('friend-form').onsubmit = async (e) => {
    e.preventDefault();
    $('create-friend').disabled = true;
    try {
      const out = await api('challenges', {
        control: $('friend-control').value,
        color: $('friend-color').value,
      });
      navigate('/invite/' + out.challenge.id);
    } catch (e) {
      $('friend-error').textContent = e.message;
    } finally {
      if ($('create-friend')) $('create-friend').disabled = false;
    }
  };
}
async function loadInvitation(token) {
  stopInvitationWatch();
  communityShell();
  const version = invitationVersion;
  communityNav('nav-play');
  document.title = 'Приглашение за доску · Doctor Chess';
  let last = '',
    watching = true;
  const refresh = async () => {
    if (invitationLoading || version !== invitationVersion) return;
    invitationLoading = true;
    try {
      const out = await api('challenges/' + encodeURIComponent(token));
      if (version !== invitationVersion) return;
      const c = out.challenge;
      watching = c.status === 'pending';
      if (!watching && invitationTimer) {
        clearInterval(invitationTimer);
        invitationTimer = null;
      }
      if (c.status === 'accepted' && c.participant) {
        const state = await api('state');
        if (version !== invitationVersion) return;
        if (state.game?.id === c.game_id) {
          if (await enterMatchedGame(state.game)) return;
        }
      }
      const key = JSON.stringify(c) + ':' + !!user;
      if (key === last) return;
      last = key;
      const link = location.origin + '/invite/' + c.id;
      $('community-page').innerHTML =
        `<div class="breadcrumbs"><a href="/">Doctor Chess</a><span>/</span><span>Приглашение</span></div><section class="invitation-card"><span class="invitation-stamp">友</span><div class="eyebrow">ДРУЖЕСКАЯ ПАРТИЯ</div><h1>${escapeHtml(c.host.username)} приглашает сыграть</h1><div class="invite-details"><span>${c.control}</span><span>${c.kind === 'rated' ? 'Рейтинговая' : 'Без рейтинга'}</span><span>${c.color === 'random' ? 'Случайные цвета' : c.color === 'w' ? 'Создатель играет белыми' : 'Создатель играет чёрными'}</span></div>${c.status === 'pending' ? (c.own ? `<p>Скопируйте ссылку и откройте её во втором браузере под профилем друга.</p><label for="invite-link">Ссылка на партию</label><input readonly id="invite-link" value="${escapeHtml(link)}"><div class="invite-buttons"><button id="copy-invite" class="primary">Скопировать ссылку</button><button id="cancel-invite" class="outline">Отменить приглашение</button></div><p class="muted">Ждём соперника. Приглашение действует до ${new Date(c.expires * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.</p>` : `<p>Займите свободное место за доской. Партия начнётся, когда вы присоединитесь.</p><button id="join-invite" class="primary">${user ? 'Присоединиться к партии' : 'Войти и присоединиться'} →</button>`) : c.status === 'accepted' ? `<p>По этому приглашению уже началась партия.</p><a class="outline" href="/review/${c.game_id}">Открыть разбор после завершения →</a>` : `<p>${c.status === 'expired' ? 'Срок приглашения истёк.' : 'Приглашение отменено.'}</p><a class="outline" href="/">Вернуться в игровую комнату →</a>`}<div class="form-error" id="invite-error" role="alert"></div></section>`;
      if ($('copy-invite'))
        $('copy-invite').onclick = async () => {
          try {
            await navigator.clipboard.writeText(link);
            toast('Ссылка скопирована');
          } catch {
            $('invite-link').focus();
            $('invite-link').select();
            toast('Скопируйте выделенную ссылку');
          }
        };
      if ($('cancel-invite'))
        $('cancel-invite').onclick = async () => {
          try {
            await api('challenges/' + c.id + '/cancel', {});
            last = '';
            refresh();
          } catch (e) {
            $('invite-error').textContent = e.message;
          }
        };
      if ($('join-invite'))
        $('join-invite').onclick = async () => {
          if (!user) return auth();
          $('join-invite').disabled = true;
          try {
            const joined = await api('challenges/' + c.id + '/join', {});
            await enterMatchedGame(joined.game);
          } catch (e) {
            if ($('invite-error')) $('invite-error').textContent = e.message;
          } finally {
            if ($('join-invite')) $('join-invite').disabled = false;
          }
        };
    } catch (e) {
      if (version === invitationVersion)
        $('community-page').innerHTML =
          `<div class="page-empty"><h1>${escapeHtml(e.message)}</h1><a href="/">Вернуться к доске →</a></div>`;
    } finally {
      if (version === invitationVersion) invitationLoading = false;
    }
  };
  await refresh();
  if (version === invitationVersion && watching) invitationTimer = setInterval(refresh, 1500);
}
async function requestRematch() {
  if (!game?.result || busy) return;
  const gid = game.id;
  $('rematch').disabled = true;
  try {
    const out = await api('games/' + gid + '/rematch', {});
    if (out.game) return enterMatchedGame(out.game);
    if (game?.id === gid) {
      game.rematch = { id: out.challenge.id, own: true };
      updateSocialPanel();
    }
    toast('Реванш предложен. Ожидаем соперника.');
  } catch (e) {
    toast(e.message);
  } finally {
    updateSocialPanel();
  }
}
async function cancelRematch() {
  if (!game?.rematch?.own) return;
  try {
    await api('challenges/' + game.rematch.id + '/cancel', {});
    game.rematch = null;
    updateSocialPanel();
  } catch (e) {
    toast(e.message);
  }
}
function initializeSocial() {
  initializePremoves();
  $('friend-game').onclick = createFriendGame;
  $('rematch').onclick = requestRematch;
  $('cancel-rematch').onclick = cancelRematch;
  $('decline-draw').onclick = async () => {
    if (!active()) return;
    try {
      acceptGame((await api('draw-decline', { game: game.id })).game);
    } catch (e) {
      toast(e.message);
    }
  };
}
