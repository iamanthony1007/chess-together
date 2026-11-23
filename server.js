'use strict';

/**
 * Chess Together server.
 *
 * The server owns every game: it checks each move with chess.js, runs the clocks,
 * decides results, and relays chat, call signalling and puzzle sync between the
 * two players in a room. Clients only render the state they are sent.
 */

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;
const GAME_TIME_MS = 10 * 60 * 1000;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000; // delete a room 10 min after both players leave
const WAITING_ROOM_TTL_MS = 60 * 60 * 1000; // delete an unjoined room after 1 hour
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, they get misread
const CODE_LENGTH = 6;
const MAX_CHAT_LENGTH = 400;
const CHAT_HISTORY = 60;
const MAX_SIGNAL_BYTES = 30 * 1024;
const EVENTS_PER_SECOND = 40;

// ---------------------------------------------------------------------------
// ICE servers (STUN + optional TURN relay)
// ---------------------------------------------------------------------------
const STUN_SERVERS = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const CF_TURN_KEY_ID = process.env.CF_TURN_KEY_ID || '';
const CF_TURN_API_TOKEN = process.env.CF_TURN_API_TOKEN || '';
const TURN_TTL_SECONDS = 6 * 60 * 60; // credentials live 6 hours
const TURN_REFRESH_MS = 60 * 60 * 1000; // fetch fresh ones every hour
let turnCache = { servers: null, at: 0 };

/** Static TURN from env (any provider that gives a fixed username and password). */
function staticTurn() {
  if (!process.env.TURN_URL) return [];
  return [
    {
      urls: process.env.TURN_URL.split(',').map((u) => u.trim()),
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || '',
    },
  ];
}

/** Short-lived Cloudflare TURN credentials, cached and shared for an hour. */
async function cloudflareTurn() {
  if (!CF_TURN_KEY_ID || !CF_TURN_API_TOKEN) return [];
  if (turnCache.servers && Date.now() - turnCache.at < TURN_REFRESH_MS) return turnCache.servers;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(CF_TURN_KEY_ID)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${CF_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Cloudflare TURN answered ${res.status}`);
    const data = await res.json();
    const servers = (Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers])
      .filter((s) => s && s.username && s.credential && s.urls)
      .map((s) => ({
        // Port 53 is often blocked and makes browsers wait; drop those entries.
        urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)),
        username: s.username,
        credential: s.credential,
      }))
      .filter((s) => s.urls.length);
    turnCache = { servers, at: Date.now() };
    return servers;
  } catch (err) {
    console.warn('[turn] could not get Cloudflare credentials:', err.message);
    return turnCache.servers || [];
  }
}

async function iceServersFor() {
  const relay = await cloudflareTurn();
  return [...STUN_SERVERS, ...(relay.length ? relay : staticTurn())];
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "media-src 'self' blob:",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );
  next();
});

app.get('/vendor/chess.js', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(require.resolve('chess.js'));
});

app.get('/api/ice-servers', (_req, res) => {
  // Public endpoint returns STUN only. Relay (TURN) credentials are handed out
  // over the socket, and only to players seated in a room.
  res.json({ iceServers: STUN_SERVERS });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', rooms: rooms.size, uptime: Math.round(process.uptime()) });
});

app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      else if (/\.(svg|woff2)$/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=604800');
      else res.setHeader('Cache-Control', 'public, max-age=300');
    },
  })
);

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 64 * 1024, pingInterval: 20000, pingTimeout: 30000 });

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------
/** @type {Map<string, Room>} */
const rooms = new Map();

/**
 * @typedef {{ token: string, name: string, socketId: string|null }} Seat
 * @typedef {{ winner: 'w'|'b'|null, reason: string }} Result
 * @typedef {Object} Room
 * @property {string} code
 * @property {{ w: Seat|null, b: Seat|null }} seats
 * @property {Chess} chess
 * @property {'waiting'|'playing'|'over'} status
 * @property {Result|null} result
 * @property {{ w: number, b: number, turnStartedAt: number|null }} clock
 * @property {NodeJS.Timeout|null} flagTimer
 * @property {'w'|'b'|null} drawOffer
 * @property {{ w: boolean, b: boolean }} rematch
 * @property {Array<object>} chat
 * @property {number} lastActivity
 * @property {number} createdAt
 * @property {number} gameNumber
 */

function newCode() {
  for (;;) {
    let code = '';
    const bytes = crypto.randomBytes(CODE_LENGTH);
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (!rooms.has(code)) return code;
  }
}

function createRoom() {
  const room = {
    code: newCode(),
    seats: { w: null, b: null },
    chess: new Chess(),
    status: 'waiting',
    result: null,
    clock: { w: GAME_TIME_MS, b: GAME_TIME_MS, turnStartedAt: null },
    flagTimer: null,
    drawOffer: null,
    rematch: { w: false, b: false },
    chat: [],
    lastActivity: Date.now(),
    createdAt: Date.now(),
    gameNumber: 1,
  };
  rooms.set(room.code, room);
  return room;
}

const other = (color) => (color === 'w' ? 'b' : 'w');

function remaining(room, color) {
  const { clock } = room;
  const running = room.status === 'playing' && clock.turnStartedAt !== null && room.chess.turn() === color;
  return Math.max(0, clock[color] - (running ? Date.now() - clock.turnStartedAt : 0));
}

function publicState(room) {
  const history = room.chess.history({ verbose: true });
  const last = history[history.length - 1];
  const seat = (c) => (room.seats[c] ? { name: room.seats[c].name, connected: !!room.seats[c].socketId } : null);
  return {
    code: room.code,
    status: room.status,
    result: room.result,
    fen: room.chess.fen(),
    turn: room.chess.turn(),
    inCheck: room.chess.in_check(),
    moves: history.map((m) => m.san),
    lastMove: last ? { from: last.from, to: last.to } : null,
    clock: {
      w: remaining(room, 'w'),
      b: remaining(room, 'b'),
      running: room.status === 'playing' && room.clock.turnStartedAt !== null,
      serverTime: Date.now(),
    },
    players: { w: seat('w'), b: seat('b') },
    drawOffer: room.drawOffer,
    rematch: room.rematch,
    gameNumber: room.gameNumber,
  };
}

function broadcast(room) {
  room.lastActivity = Date.now();
  io.to(room.code).emit('state', publicState(room));
}

function endGame(room, winner, reason) {
  room.status = 'over';
  room.result = { winner, reason };
  room.drawOffer = null;
  room.rematch = { w: false, b: false };
  if (room.clock.turnStartedAt !== null) {
    const mover = room.chess.turn();
    room.clock[mover] = remaining(room, mover);
    room.clock.turnStartedAt = null;
  }
  clearTimeout(room.flagTimer);
  room.flagTimer = null;
}

function onlyKing(chess, color) {
  return chess
    .board()
    .flat()
    .every((sq) => !sq || sq.color !== color || sq.type === 'k');
}

function scheduleFlag(room) {
  clearTimeout(room.flagTimer);
  room.flagTimer = null;
  if (room.status !== 'playing' || room.clock.turnStartedAt === null) return;
  const mover = room.chess.turn();
  room.flagTimer = setTimeout(() => {
    if (room.status !== 'playing' || room.chess.turn() !== mover) return;
    if (remaining(room, mover) > 0) return scheduleFlag(room);
    room.clock[mover] = 0;
    // A player who runs out of time only loses if the opponent could still mate.
    if (onlyKing(room.chess, other(mover))) endGame(room, null, 'timeout vs insufficient material');
    else endGame(room, other(mover), 'timeout');
    broadcast(room);
  }, remaining(room, mover) + 50);
}

function startNewGame(room) {
  room.chess = new Chess();
  room.status = 'playing';
  room.result = null;
  room.clock = { w: GAME_TIME_MS, b: GAME_TIME_MS, turnStartedAt: null };
  room.drawOffer = null;
  room.rematch = { w: false, b: false };
  clearTimeout(room.flagTimer);
  room.flagTimer = null;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const SQUARE_RE = /^[a-h][1-8]$/;
const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const SIGNAL_TYPES = new Set(['invite', 'accept', 'decline', 'end', 'description', 'candidate']);

function cleanName(name) {
  const n = typeof name === 'string' ? name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20) : '';
  return n || 'Player';
}

function cleanCode(code) {
  return typeof code === 'string' ? code.toUpperCase().replace(/[^A-Z]/g, '').slice(0, CODE_LENGTH) : '';
}

function reply(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

/** The room and colour for this socket, or null if it is not seated anywhere. */
function membership(socket) {
  const room = rooms.get(socket.data.code);
  if (!room) return null;
  const color = socket.data.color;
  const seat = room.seats[color];
  if (!seat || seat.socketId !== socket.id) return null;
  return { room, color };
}

function opponentSocket(room, color) {
  const seat = room.seats[other(color)];
  return seat && seat.socketId ? io.sockets.sockets.get(seat.socketId) : null;
}

function leaveCurrentRoom(socket) {
  const m = membership(socket);
  if (!m) return;
  const { room, color } = m;
  socket.leave(room.code);
  room.seats[color].socketId = null;
  socket.data.code = null;
  socket.data.color = null;
  if (room.status === 'waiting' && !room.seats[other(color)]) {
    rooms.delete(room.code);
    return;
  }
  const opp = opponentSocket(room, color);
  if (opp) opp.emit('rtc', { type: 'end' });
  broadcast(room);
}

function seatSocket(socket, room, color) {
  leaveCurrentRoom(socket);
  room.seats[color].socketId = socket.id;
  socket.data.code = room.code;
  socket.data.color = color;
  socket.join(room.code);
}

// ---------------------------------------------------------------------------
// Socket events
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.data.code = null;
  socket.data.color = null;

  // Simple flood guard: drop events beyond EVENTS_PER_SECOND.
  let windowStart = Date.now();
  let count = 0;
  let lastChatAt = 0;
  socket.use((_packet, next) => {
    const now = Date.now();
    if (now - windowStart > 1000) {
      windowStart = now;
      count = 0;
    }
    if (++count > EVENTS_PER_SECOND) return;
    next();
  });

  socket.on('create', (data, ack) => {
    const token = data && data.token;
    if (!TOKEN_RE.test(token || '')) return reply(ack, { ok: false, error: 'Bad player id. Reload the page.' });
    const room = createRoom();
    const color = crypto.randomInt(2) === 0 ? 'w' : 'b';
    room.seats[color] = { token, name: cleanName(data.name), socketId: null };
    seatSocket(socket, room, color);
    reply(ack, { ok: true, code: room.code, color });
    broadcast(room);
    console.log(`[room ${room.code}] created`);
  });

  socket.on('join', (data, ack) => {
    const code = cleanCode(data && data.code);
    const token = data && data.token;
    if (!TOKEN_RE.test(token || '')) return reply(ack, { ok: false, error: 'Bad player id. Reload the page.' });
    const room = rooms.get(code);
    if (!room) return reply(ack, { ok: false, error: 'No room with that code. Check the letters and try again.' });

    // Returning player (refresh, dropped signal): take the same seat back.
    const existing = ['w', 'b'].find((c) => room.seats[c] && room.seats[c].token === token);
    if (existing) {
      const prev = room.seats[existing].socketId;
      if (prev && prev !== socket.id) {
        const old = io.sockets.sockets.get(prev);
        if (old) {
          old.emit('replaced');
          old.leave(room.code);
          old.data.code = null;
        }
      }
      seatSocket(socket, room, existing);
      reply(ack, { ok: true, code: room.code, color: existing, chat: room.chat });
      broadcast(room);
      return;
    }

    const free = ['w', 'b'].find((c) => !room.seats[c]);
    if (!free) return reply(ack, { ok: false, error: 'That room already has two players.' });
    room.seats[free] = { token, name: cleanName(data.name), socketId: null };
    seatSocket(socket, room, free);
    startNewGame(room);
    reply(ack, { ok: true, code: room.code, color: free, chat: room.chat });
    broadcast(room);
    console.log(`[room ${room.code}] game started`);
  });

  socket.on('leave', () => leaveCurrentRoom(socket));

  socket.on('move', (data, ack) => {
    const m = membership(socket);
    if (!m) return reply(ack, { ok: false, error: 'You are not in a game.' });
    const { room, color } = m;
    if (room.status !== 'playing') return reply(ack, { ok: false, error: 'The game is not in progress.' });
    if (room.chess.turn() !== color) return reply(ack, { ok: false, error: 'Not your turn.' });
    const from = data && data.from;
    const to = data && data.to;
    const promotion = data && data.promotion;
    if (!SQUARE_RE.test(from || '') || !SQUARE_RE.test(to || '')) return reply(ack, { ok: false, error: 'Bad move.' });
    if (promotion !== undefined && !['q', 'r', 'b', 'n'].includes(promotion)) return reply(ack, { ok: false, error: 'Bad move.' });

    // Charge the mover's clock before accepting the move.
    const now = Date.now();
    if (room.clock.turnStartedAt !== null) {
      const left = room.clock[color] - (now - room.clock.turnStartedAt);
      if (left <= 0) {
        room.clock[color] = 0;
        if (onlyKing(room.chess, other(color))) endGame(room, null, 'timeout vs insufficient material');
        else endGame(room, other(color), 'timeout');
        broadcast(room);
        return reply(ack, { ok: false, error: 'Your time ran out.' });
      }
      room.clock[color] = left;
    }

    const move = room.chess.move({ from, to, promotion: promotion || 'q' });
    if (!move) return reply(ack, { ok: false, error: 'Illegal move.' });

    room.drawOffer = null;
    // Clocks start once White has made the first move.
    room.clock.turnStartedAt = now;

    const chess = room.chess;
    if (chess.in_checkmate()) endGame(room, color, 'checkmate');
    else if (chess.in_stalemate()) endGame(room, null, 'stalemate');
    else if (chess.insufficient_material()) endGame(room, null, 'insufficient material');
    else if (chess.in_threefold_repetition()) endGame(room, null, 'threefold repetition');
    else if (chess.in_draw()) endGame(room, null, '50-move rule');
    else scheduleFlag(room);

    reply(ack, { ok: true });
    broadcast(room);
  });

  socket.on('resign', () => {
    const m = membership(socket);
    if (!m || m.room.status !== 'playing') return;
    endGame(m.room, other(m.color), 'resignation');
    broadcast(m.room);
  });

  socket.on('draw-offer', () => {
    const m = membership(socket);
    if (!m || m.room.status !== 'playing' || m.room.drawOffer) return;
    m.room.drawOffer = m.color;
    broadcast(m.room);
  });

  socket.on('draw-answer', (data) => {
    const m = membership(socket);
    if (!m || m.room.status !== 'playing' || m.room.drawOffer !== other(m.color)) return;
    if (data && data.accept === true) endGame(m.room, null, 'agreement');
    else m.room.drawOffer = null;
    broadcast(m.room);
  });

  socket.on('rematch', () => {
    const m = membership(socket);
    if (!m || m.room.status !== 'over') return;
    const { room, color } = m;
    room.rematch[color] = !room.rematch[color];
    if (room.rematch.w && room.rematch.b) {
      // Swap colours for the next game.
      const { w, b } = room.seats;
      room.seats = { w: b, b: w };
      for (const c of ['w', 'b']) {
        const s = room.seats[c] && room.seats[c].socketId && io.sockets.sockets.get(room.seats[c].socketId);
        if (s) {
          s.data.color = c;
          s.emit('seat', { color: c });
        }
      }
      room.gameNumber += 1;
      startNewGame(room);
    }
    broadcast(room);
  });

  socket.on('chat', (data) => {
    const m = membership(socket);
    if (!m) return;
    const now = Date.now();
    if (now - lastChatAt < 400) return;
    lastChatAt = now;
    const text = typeof (data && data.text) === 'string' ? data.text.trim().slice(0, MAX_CHAT_LENGTH) : '';
    if (!text) return;
    const msg = { id: crypto.randomUUID(), color: m.color, name: m.room.seats[m.color].name, text, at: now };
    m.room.chat.push(msg);
    if (m.room.chat.length > CHAT_HISTORY) m.room.chat.shift();
    m.room.lastActivity = now;
    io.to(m.room.code).emit('chat', msg);
  });

  // ICE servers for calls. Relay credentials only go to seated players.
  socket.on('ice', async (_data, ack) => {
    if (!membership(socket)) return reply(ack, { ok: false, iceServers: STUN_SERVERS });
    reply(ack, { ok: true, iceServers: await iceServersFor() });
  });

  // WebRTC signalling: relay only, to the other player in the room.
  socket.on('rtc', (data) => {
    const m = membership(socket);
    if (!m || !data || !SIGNAL_TYPES.has(data.type)) return;
    let size = 0;
    try {
      size = JSON.stringify(data).length;
    } catch (_) {
      return;
    }
    if (size > MAX_SIGNAL_BYTES) return;
    const opp = opponentSocket(m.room, m.color);
    if (opp) opp.emit('rtc', { type: data.type, payload: data.payload, video: !!data.video });
    else if (data.type === 'invite') socket.emit('rtc', { type: 'unavailable' });
  });

  // Puzzle sync between partners in the same room.
  socket.on('puzzle', (data) => {
    const m = membership(socket);
    if (!m || !data) return;
    const action = data.action;
    const id = typeof data.id === 'string' ? data.id.slice(0, 12) : '';
    if (!['open', 'move', 'reset'].includes(action) || !/^[A-Za-z0-9]+$/.test(id)) return;
    if (action === 'move' && !UCI_RE.test(data.uci || '')) return;
    const opp = opponentSocket(m.room, m.color);
    if (opp) opp.emit('puzzle', { action, id, uci: action === 'move' ? data.uci : undefined, name: m.room.seats[m.color].name });
  });

  socket.on('disconnect', () => {
    const m = membership(socket);
    if (!m) return;
    m.room.seats[m.color].socketId = null;
    const opp = opponentSocket(m.room, m.color);
    if (opp) opp.emit('rtc', { type: 'end' });
    broadcast(m.room);
  });
});

// Sweep abandoned rooms.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const anyone = ['w', 'b'].some((c) => room.seats[c] && room.seats[c].socketId);
    const idle = now - room.lastActivity;
    if ((!anyone && idle > EMPTY_ROOM_TTL_MS) || (room.status === 'waiting' && idle > WAITING_ROOM_TTL_MS)) {
      clearTimeout(room.flagTimer);
      rooms.delete(code);
    }
  }
}, 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Chess Together running on http://localhost:${PORT}`);
});

module.exports = { server, rooms };
