/* App shell: routing between Play, Puzzles and Learn, the lobby, and sharing. */
(function () {
  'use strict';

  const CT = window.CT;
  const { $, store, toast, dialog, sound } = CT.ui;
  const net = CT.net;

  const views = {
    lobby: $('#view-lobby'),
    game: $('#view-game'),
    puzzles: $('#view-puzzles'),
    learn: $('#view-learn'),
  };

  // ---------------------------------------------------------------- routing

  function parseRoute() {
    const h = location.hash.replace(/^#\/?/, '');
    const [name, arg] = h.split('/');
    if (name === 'room' && arg) return { name: 'room', code: arg.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) };
    if (name === 'puzzles' || name === 'learn') return { name };
    return { name: 'play' };
  }

  function show(viewName, tab) {
    for (const [k, el] of Object.entries(views)) el.hidden = k !== viewName;
    for (const a of document.querySelectorAll('.tabbar a')) {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    if (viewName === 'game') CT.game.onShow();
    if (viewName === 'puzzles') CT.puzzles.onShow();
    if (viewName === 'learn') CT.lessons.onShow();
    if (viewName === 'lobby') renderLobby();
  }

  async function route() {
    const r = parseRoute();
    if (r.name === 'puzzles') return show('puzzles', 'puzzles');
    if (r.name === 'learn') return show('learn', 'learn');
    if (r.name === 'room') {
      if (net.room && net.room.code === r.code) return show('game', 'play');
      show('lobby', 'play');
      $('#join-code').value = r.code;
      if (!net.socket.connected) await new Promise((res) => net.socket.once('connect', res));
      const res = await net.join(r.code);
      if (!res.ok) {
        showJoinError(res.error);
        history.replaceState(null, '', '#/play');
      }
      return;
    }
    show(net.room ? 'game' : 'lobby', 'play');
  }

  window.addEventListener('hashchange', route);

  net.bus.addEventListener('room', (e) => {
    const r = parseRoute();
    if (e.detail) {
      if (r.name === 'play' || r.name === 'room') {
        if (location.hash !== `#/room/${e.detail.code}`) history.replaceState(null, '', `#/room/${e.detail.code}`);
        show('game', 'play');
      }
    } else if (r.name === 'play' || r.name === 'room') {
      history.replaceState(null, '', '#/play');
      show('lobby', 'play');
    }
  });

  // The Play tab returns to the open game if there is one.
  document.querySelector('.tabbar a[data-tab="play"]').addEventListener('click', (e) => {
    if (net.room) {
      e.preventDefault();
      location.hash = `#/room/${net.room.code}`;
    }
  });

  // ---------------------------------------------------------------- lobby

  const nameInput = $('#player-name');
  const joinInput = $('#join-code');
  const joinError = $('#join-error');
  let lobbyBoard = null;

  function renderLobby() {
    nameInput.value = net.name;
    const saved = store.get('room', null);
    const card = $('#resume-card');
    card.hidden = !saved || !!net.room;
    $('#resume-code').textContent = saved || '';
    if (!lobbyBoard && window.matchMedia('(min-width: 960px)').matches) {
      lobbyBoard = new CT.Board($('#lobby-board'));
      lobbyBoard.el.tabIndex = -1;
      lobbyBoard.setPosition('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', { lastMove: { from: 'e2', to: 'e4' }, animate: false });
    }
  }

  function showJoinError(msg) {
    joinError.textContent = msg || '';
    joinInput.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (msg) joinInput.focus();
  }

  nameInput.addEventListener('change', () => (net.name = nameInput.value.trim()));

  const createBtn = $('#create-btn');
  createBtn.addEventListener('click', async () => {
    net.name = nameInput.value.trim();
    createBtn.disabled = true;
    createBtn.textContent = 'Creating…';
    const res = await net.create();
    createBtn.disabled = false;
    createBtn.textContent = 'Create a room';
    if (!res.ok) toast(res.error, { tone: 'bad' });
  });

  joinInput.addEventListener('input', () => {
    const v = joinInput.value.toUpperCase().replace(/[^A-Z]/g, '');
    if (v !== joinInput.value) joinInput.value = v;
    if (joinError.textContent && v.length === 6) showJoinError('');
  });

  joinInput.addEventListener('blur', () => {
    const v = joinInput.value;
    if (v && v.length !== 6) showJoinError('Room codes are 6 letters.');
  });

  $('#join-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = joinInput.value.trim().toUpperCase();
    if (code.length !== 6) return showJoinError('Room codes are 6 letters.');
    net.name = nameInput.value.trim();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Joining…';
    const res = await net.join(code);
    btn.disabled = false;
    btn.textContent = 'Join';
    if (!res.ok) showJoinError(res.error);
    else showJoinError('');
  });

  $('#resume-btn').addEventListener('click', async () => {
    const saved = store.get('room', null);
    if (!saved) return;
    const res = await net.join(saved);
    if (!res.ok) {
      store.remove('room');
      renderLobby();
      toast(res.error, { tone: 'bad' });
    }
  });

  // ---------------------------------------------------------------- sharing

  function inviteUrl() {
    return `${location.origin}/#/room/${net.room ? net.room.code : ''}`;
  }

  async function copy(text, done) {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch (_) {
      toast(text, { ms: 6000 });
    }
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !net.room) return;
    if (btn.dataset.action === 'copy-code') copy(net.room.code, `Code ${net.room.code} copied.`);
    if (btn.dataset.action === 'share') {
      const url = inviteUrl();
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Chess Together', text: `Play chess with me. Room ${net.room.code}`, url });
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
        }
      }
      copy(url, 'Invite link copied. Send it to your friend.');
    }
  });

  $('#leave-btn').addEventListener('click', async () => {
    const choice = await dialog({
      title: 'Leave this room?',
      body: 'Your seat is kept. Open the invite link or enter the code to come back. If a game is running, your clock keeps going.',
      actions: [
        { label: 'Stay', value: 'stay' },
        { label: 'Leave room', value: 'leave', kind: 'primary' },
      ],
    });
    if (choice === 'leave') net.leave();
  });

  // ---------------------------------------------------------------- sound toggle

  const soundBtn = $('#sound-toggle');
  const renderSound = () => {
    soundBtn.setAttribute('aria-pressed', String(sound.on));
    soundBtn.setAttribute('aria-label', sound.on ? 'Sound on' : 'Sound off');
  };
  soundBtn.addEventListener('click', () => {
    sound.on = !sound.on;
    store.set('sound', sound.on);
    renderSound();
  });
  renderSound();

  route();
})();
