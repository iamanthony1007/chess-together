/* Network: the socket connection, this player's identity and the current room. */
(function () {
  'use strict';

  const CT = window.CT;
  const { store, $ } = CT.ui;

  function makeToken() {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  let token = store.get('token', null);
  if (!token || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
    token = makeToken();
    store.set('token', token);
  }

  const bus = new EventTarget();
  const emitLocal = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

  const socket = io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });

  const net = {
    socket,
    bus,
    token,
    room: null, // { code, color }

    get name() {
      return store.get('name', '') || '';
    },
    set name(v) {
      store.set('name', String(v || '').slice(0, 20));
    },

    request(event, data) {
      return new Promise((resolve) => {
        if (!socket.connected) return resolve({ ok: false, error: 'Not connected to the server yet. Try again in a moment.' });
        const timer = setTimeout(() => resolve({ ok: false, error: 'The server did not answer. Check your connection.' }), 8000);
        socket.emit(event, data, (res) => {
          clearTimeout(timer);
          resolve(res || { ok: false, error: 'No answer from server.' });
        });
      });
    },

    async create() {
      const res = await net.request('create', { token, name: net.name });
      if (res.ok) setRoom(res.code, res.color, []);
      return res;
    },

    async join(code) {
      const res = await net.request('join', { code, token, name: net.name });
      if (res.ok) setRoom(res.code, res.color, res.chat || []);
      return res;
    },

    leave() {
      socket.emit('leave');
      net.room = null;
      store.remove('room');
      emitLocal('room', null);
    },

    send(event, data) {
      if (net.room) socket.emit(event, data);
    },
  };

  function setRoom(code, color, chat) {
    net.room = { code, color };
    store.set('room', code);
    emitLocal('room', { code, color, chat });
  }

  // ---------------------------------------------------------------- connection status
  const conn = $('#conn');
  const setConn = (state, text) => {
    conn.dataset.state = state;
    conn.querySelector('.conn-text').textContent = text;
  };

  socket.on('connect', async () => {
    setConn('online', 'Online');
    // Rejoin the room we were in (refresh, sleep, lost signal).
    // On first load an invite link (#/room/CODE) is handled by the router instead.
    const linkCode = /^#\/room\/[A-Za-z]{6}/.test(location.hash);
    const saved = (net.room && net.room.code) || (linkCode ? null : store.get('room', null));
    if (saved) {
      const res = await net.join(saved);
      if (!res.ok) {
        store.remove('room');
        if (net.room) {
          net.room = null;
          emitLocal('room', null);
          CT.ui.toast('That room has closed.');
        }
      }
    }
  });

  socket.on('disconnect', () => setConn('offline', 'Reconnecting…'));
  socket.io.on('reconnect_attempt', () => setConn('offline', 'Reconnecting…'));

  socket.on('seat', ({ color }) => {
    if (net.room) {
      net.room.color = color;
      emitLocal('seat', color);
    }
  });

  socket.on('replaced', () => {
    net.room = null;
    emitLocal('room', null);
    CT.ui.toast('This game was opened in another tab.', { tone: 'bad', ms: 5000 });
  });

  CT.net = net;
})();
