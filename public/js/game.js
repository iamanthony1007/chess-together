/* Online game: renders the server's state, sends moves, runs the clock display,
 * draw and rematch offers, and the room chat.
 */
(function () {
  'use strict';

  const CT = window.CT;
  const { $, toast, dialog, closeDialog, sound, kingSquare, material, formatClock, destsFor } = CT.ui;
  const net = CT.net;

  const REASONS = {
    checkmate: 'by checkmate',
    resignation: 'by resignation',
    timeout: 'on time',
    stalemate: 'by stalemate',
    'insufficient material': 'by insufficient material',
    'threefold repetition': 'by threefold repetition',
    '50-move rule': 'by the 50-move rule',
    agreement: 'by agreement',
    'timeout vs insufficient material': 'on time, but the opponent could not mate',
  };

  const els = {
    status: $('#game-status'),
    roomCode: $('#room-code'),
    waiting: $('#waiting'),
    waitingCode: $('#waiting-code'),
    moves: $('#moves'),
    movesEmpty: $('#moves-empty'),
    offer: $('#offer-bar'),
    offerText: $('#offer-text'),
    offerAccept: $('#offer-accept'),
    offerDecline: $('#offer-decline'),
    drawBtn: $('#draw-btn'),
    resignBtn: $('#resign-btn'),
    flipBtn: $('#flip-btn'),
    videoBtn: $('#call-video-btn'),
    audioBtn: $('#call-audio-btn'),
    chat: $('#chat'),
    chatToggle: $('#chat-toggle'),
    chatClose: $('#chat-close'),
    chatLog: $('#chat-log'),
    chatEmpty: $('#chat-empty'),
    chatForm: $('#chat-form'),
    chatInput: $('#chat-input'),
    chatBadge: $('#chat-badge'),
    top: $('#strip-top'),
    bottom: $('#strip-bottom'),
  };

  const game = {
    state: null,
    chess: new Chess(),
    board: null,
    flipped: false,
    clockBase: null, // { w, b, at, running, turn }
    shownResultFor: 0,
    unread: 0,
    pending: false,
  };

  const myColor = () => (net.room ? net.room.color : 'w');
  const oppColor = () => (myColor() === 'w' ? 'b' : 'w');
  const playerName = (c) => (game.state && game.state.players[c] ? game.state.players[c].name : null);

  function ensureBoard() {
    if (game.board) return;
    game.board = new CT.Board($('#game-board'), {
      dests: (sq) => (canMove() ? destsFor(game.chess)(sq) : []),
      onMove: sendMove,
      label: 'Game board. Use arrow keys to move between squares and Enter to pick up or drop a piece.',
    });
  }

  function canMove() {
    const s = game.state;
    return !!s && s.status === 'playing' && s.turn === myColor() && !game.pending;
  }

  // ---------------------------------------------------------------- moves

  async function sendMove({ from, to, promotion }) {
    if (!canMove()) return;
    // Show the move straight away; the server confirms or we roll back.
    const local = game.chess.move({ from, to, promotion: promotion || 'q' });
    if (!local) return;
    game.pending = true;
    sound.forSan(local.san);
    game.board.setPosition(game.chess.fen(), {
      lastMove: { from, to },
      check: game.chess.in_check() ? kingSquare(game.chess.fen(), game.chess.turn()) : null,
      animate: false,
    });
    game.board.setMovable(null);
    const res = await net.request('move', { from, to, promotion });
    game.pending = false;
    if (!res.ok) {
      toast(res.error || 'Move not accepted.', { tone: 'bad' });
      if (game.state) render(game.state, { animate: false });
    }
  }

  // ---------------------------------------------------------------- render

  function render(s, { animate = true } = {}) {
    const prev = game.state;
    game.state = s;
    ensureBoard();
    game.chess.load(s.fen);

    const me = myColor();
    const orientation = game.flipped ? (me === 'w' ? 'b' : 'w') : me;
    game.board.setOrientation(orientation);

    const changed = !prev || prev.fen !== s.fen;
    if (changed || !animate) {
      const isMyEcho = prev && s.moves.length === prev.moves.length + 1 && prev.turn === me;
      game.board.setPosition(s.fen, {
        lastMove: s.lastMove,
        check: s.inCheck ? kingSquare(s.fen, s.turn) : null,
        animate: animate && !isMyEcho,
      });
      if (prev && s.moves.length === prev.moves.length + 1 && prev.turn !== me) sound.forSan(s.moves[s.moves.length - 1]);
    }
    game.board.setMovable(canMove() ? me : null);

    els.roomCode.textContent = s.code;
    els.waitingCode.textContent = s.code;
    els.waiting.hidden = s.status !== 'waiting';

    renderStrips(s, orientation);
    renderMoves(s);
    renderStatus(s);
    renderOffers(s, prev);

    game.clockBase = { w: s.clock.w, b: s.clock.b, at: performance.now(), running: s.clock.running, turn: s.turn };
    tickClocks();

    const opp = playerName(oppColor());
    CT.call.setOpponentName(opp);
    const oppOnline = !!(s.players[oppColor()] && s.players[oppColor()].connected);
    els.videoBtn.disabled = !oppOnline;
    els.audioBtn.disabled = !oppOnline;
    els.drawBtn.disabled = s.status !== 'playing' || !!s.drawOffer;
    els.resignBtn.disabled = s.status !== 'playing';

    // Don't pop a result for a game that had already finished before we arrived.
    if (!prev && s.status === 'over') game.shownResultFor = s.gameNumber;
    if (s.status === 'over' && s.gameNumber !== game.shownResultFor) {
      game.shownResultFor = s.gameNumber;
      showResult(s);
    }
    if (prev && prev.status === 'over' && s.status === 'playing') {
      closeDialog();
      toast(`New game. You play ${me === 'w' ? 'White' : 'Black'}.`);
    }
  }

  function renderStrips(s, orientation) {
    const topColor = orientation === 'w' ? 'b' : 'w';
    const bottomColor = orientation;
    const mat = material(s.fen);
    for (const [strip, color] of [[els.top, topColor], [els.bottom, bottomColor]]) {
      const p = s.players[color];
      const isMe = color === myColor();
      let name = p ? p.name : 'Waiting for player…';
      if (p && isMe) name += ' (you)';
      strip.querySelector('[data-name]').textContent = name;
      const presence = strip.querySelector('[data-presence]');
      presence.dataset.state = !p ? 'none' : p.connected ? 'online' : 'offline';
      presence.title = !p ? '' : p.connected ? 'Online' : 'Offline';
      const caps = mat.captured[color];
      const adv = color === 'w' ? mat.score : -mat.score;
      strip.querySelector('[data-material]').innerHTML =
        caps.map((c) => `<img src="/pieces/${c[0]}${c[1].toUpperCase()}.svg" alt="">`).join('') +
        (adv > 0 ? `<span class="adv">+${adv}</span>` : '');
      strip.querySelector('[data-clock]').dataset.color = color;
    }
  }

  function renderMoves(s) {
    els.moves.textContent = '';
    els.movesEmpty.hidden = s.moves.length > 0;
    for (let i = 0; i < s.moves.length; i += 2) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="n">${i / 2 + 1}.</span>`;
      for (const j of [i, i + 1]) {
        const span = document.createElement('span');
        span.className = 'm' + (j === s.moves.length - 1 ? ' current' : '');
        span.textContent = s.moves[j] || '';
        li.appendChild(span);
      }
      els.moves.appendChild(li);
    }
    const cur = els.moves.querySelector('.current');
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderStatus(s) {
    const me = myColor();
    const opp = playerName(oppColor()) || 'your friend';
    let text = '';
    if (s.status === 'waiting') text = 'Waiting for your friend to join.';
    else if (s.status === 'over') text = resultText(s).title;
    else if (!s.players[oppColor()] || !s.players[oppColor()].connected) text = `${opp} is offline. Their clock keeps running.`;
    else if (s.turn === me) text = s.inCheck ? 'You are in check. Your move.' : 'Your move.';
    else text = `${opp} is thinking…`;
    els.status.textContent = text;
  }

  function renderOffers(s, prev) {
    const me = myColor();
    const opp = playerName(oppColor()) || 'Your friend';
    els.offer.hidden = true;
    els.offer.dataset.kind = '';
    if (s.status === 'playing' && s.drawOffer === oppColor()) {
      els.offer.hidden = false;
      els.offer.dataset.kind = 'draw';
      els.offerText.textContent = `${opp} offers a draw.`;
      els.offerAccept.hidden = false;
      els.offerDecline.hidden = false;
      if (!prev || prev.drawOffer !== s.drawOffer) sound.ring();
    } else if (s.status === 'playing' && s.drawOffer === me) {
      els.offer.hidden = false;
      els.offerText.textContent = `Draw offered. Waiting for ${opp}.`;
      els.offerAccept.hidden = true;
      els.offerDecline.hidden = true;
    } else if (s.status === 'over' && s.rematch[oppColor()] && !s.rematch[me]) {
      els.offer.hidden = false;
      els.offer.dataset.kind = 'rematch';
      els.offerText.textContent = `${opp} wants a rematch.`;
      els.offerAccept.hidden = false;
      els.offerDecline.hidden = true;
    } else if (s.status === 'over' && s.rematch[me] && !s.rematch[oppColor()]) {
      els.offer.hidden = false;
      els.offerText.textContent = `Rematch offered. Waiting for ${opp}.`;
      els.offerAccept.hidden = true;
      els.offerDecline.hidden = true;
    }
  }

  function resultText(s) {
    const r = s.result || {};
    const reason = REASONS[r.reason] || r.reason || '';
    if (!r.winner) return { title: 'Draw', body: `The game is drawn ${reason}.` };
    const won = r.winner === myColor();
    const winnerName = r.winner === myColor() ? 'You' : playerName(r.winner) || 'Your opponent';
    return { title: won ? 'You won' : 'You lost', body: `${winnerName} won ${reason}.` };
  }

  async function showResult(s) {
    const { title, body } = resultText(s);
    if (s.result && s.result.winner === myColor()) sound.good();
    const choice = await dialog({
      title,
      body,
      actions: [
        { label: 'Close', value: 'close' },
        { label: 'Rematch', value: 'rematch', kind: 'primary' },
      ],
    });
    if (choice === 'rematch' && game.state && game.state.status === 'over' && !game.state.rematch[myColor()]) net.send('rematch');
  }

  // ---------------------------------------------------------------- clocks

  function tickClocks() {
    const base = game.clockBase;
    if (!base) return;
    const elapsed = performance.now() - base.at;
    for (const strip of [els.top, els.bottom]) {
      const el = strip.querySelector('[data-clock]');
      const c = el.dataset.color;
      if (!c) continue;
      const active = base.running && base.turn === c;
      const ms = active ? base[c] - elapsed : base[c];
      el.textContent = formatClock(ms);
      el.classList.toggle('active', game.state && game.state.status === 'playing' && base.turn === c);
      el.classList.toggle('low', ms < 30000);
    }
  }
  setInterval(tickClocks, 100);

  // ---------------------------------------------------------------- chat

  function addChat(msg) {
    const li = document.createElement('li');
    const mine = msg.color === myColor();
    li.className = mine ? 'mine' : '';
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = mine ? 'You' : msg.name;
    const text = document.createElement('span');
    text.textContent = msg.text;
    li.append(who, text);
    els.chatLog.appendChild(li);
    els.chatEmpty.hidden = true;
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
  }

  function chatVisible() {
    return els.chat.classList.contains('open') || window.matchMedia('(min-width: 960px)').matches;
  }

  function setUnread(n) {
    game.unread = n;
    els.chatBadge.hidden = n === 0;
    els.chatBadge.textContent = String(n);
  }

  function openChat(open) {
    els.chat.classList.toggle('open', open);
    els.chatToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      setUnread(0);
      els.chatLog.scrollTop = els.chatLog.scrollHeight;
      els.chatInput.focus({ preventScroll: true });
    }
  }

  els.chatToggle.addEventListener('click', () => openChat(!els.chat.classList.contains('open')));
  els.chatClose.addEventListener('click', () => {
    openChat(false);
    els.chatToggle.focus();
  });
  els.chat.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.chat.classList.contains('open')) {
      openChat(false);
      els.chatToggle.focus();
    }
  });
  els.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text) return;
    net.send('chat', { text });
    els.chatInput.value = '';
  });

  net.socket.on('chat', (msg) => {
    addChat(msg);
    if (msg.color !== myColor()) {
      if (!chatVisible()) {
        setUnread(game.unread + 1);
        toast(`${msg.name}: ${msg.text.slice(0, 80)}`);
      }
      sound.tone(880, 0.06, 'sine', 0.06);
    }
  });

  // ---------------------------------------------------------------- controls

  els.flipBtn.addEventListener('click', () => {
    game.flipped = !game.flipped;
    els.flipBtn.setAttribute('aria-pressed', String(game.flipped));
    if (game.state) render(game.state, { animate: false });
  });

  els.drawBtn.addEventListener('click', async () => {
    const choice = await dialog({
      title: 'Offer a draw?',
      body: 'If your friend accepts, the game ends in a draw.',
      actions: [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Offer draw', value: 'yes', kind: 'primary' },
      ],
    });
    if (choice === 'yes') net.send('draw-offer');
  });

  els.resignBtn.addEventListener('click', async () => {
    const choice = await dialog({
      title: 'Resign this game?',
      body: 'Your friend wins. You can ask for a rematch afterwards.',
      actions: [
        { label: 'Keep playing', value: 'cancel' },
        { label: 'Resign', value: 'yes', kind: 'danger' },
      ],
    });
    if (choice === 'yes') net.send('resign');
  });

  els.offerAccept.addEventListener('click', () => {
    if (els.offer.dataset.kind === 'draw') net.send('draw-answer', { accept: true });
    if (els.offer.dataset.kind === 'rematch') net.send('rematch');
  });
  els.offerDecline.addEventListener('click', () => net.send('draw-answer', { accept: false }));

  els.videoBtn.addEventListener('click', () => CT.call.start(true));
  els.audioBtn.addEventListener('click', () => CT.call.start(false));

  // ---------------------------------------------------------------- wiring

  net.socket.on('state', (s) => {
    if (!net.room || s.code !== net.room.code) return;
    render(s);
  });

  net.bus.addEventListener('room', (e) => {
    els.chatLog.textContent = '';
    els.chatEmpty.hidden = false;
    setUnread(0);
    game.state = null;
    game.flipped = false;
    game.shownResultFor = 0;
    if (e.detail) {
      (e.detail.chat || []).forEach(addChat);
    }
  });

  net.bus.addEventListener('seat', () => {
    if (game.state) render(game.state, { animate: false });
  });

  CT.game = {
    hasRoom: () => !!net.room,
    onShow() {
      if (game.board && game.state) render(game.state, { animate: false });
    },
  };
})();
