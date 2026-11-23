'use strict';
// Integration test: two socket clients play through the main flows against a real server.
process.env.PORT = process.env.PORT || '3999';
const assert = require('assert');
const { io } = require('socket.io-client');
const { server } = require('../server');

const URL = `http://localhost:${process.env.PORT}`;
const token = (n) => `test-token-${n}-${'x'.repeat(12)}`;
const connect = () => io(URL, { transports: ['websocket'], forceNew: true });
const emit = (s, ev, data) => new Promise((r) => s.emit(ev, data, r));
const next = (s, ev, pred = () => true) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for ' + ev)), 3000);
    const h = (d) => { if (pred(d)) { clearTimeout(t); s.off(ev, h); resolve(d); } };
    s.on(ev, h);
  });

(async () => {
  const a = connect();
  const b = connect();
  await Promise.all([next(a, 'connect'), next(b, 'connect')]);

  const created = await emit(a, 'create', { token: token('a'), name: 'Ada' });
  assert.ok(created.ok && /^[A-Z]{6}$/.test(created.code), 'room created');

  const bad = await emit(b, 'join', { code: 'ZZZZZZ', token: token('b') });
  assert.strictEqual(bad.ok, false, 'unknown room rejected');

  const joined = await emit(b, 'join', { code: created.code.toLowerCase(), token: token('b'), name: 'Bo' });
  assert.ok(joined.ok, 'join works, code case-insensitive');
  assert.notStrictEqual(joined.color, created.color, 'players get opposite colours');

  const white = created.color === 'w' ? a : b;
  const black = white === a ? b : a;

  let r = await emit(black, 'move', { from: 'e7', to: 'e5' });
  assert.strictEqual(r.ok, false, 'black cannot move first');
  r = await emit(white, 'move', { from: 'e2', to: 'e5' });
  assert.strictEqual(r.ok, false, 'illegal move rejected');
  r = await emit(white, 'move', { from: 'e2', to: 'e4' });
  assert.ok(r.ok, 'legal move accepted');
  const st = await next(black, 'state', (s) => s.moves.length === 1);
  assert.deepStrictEqual(st.moves, ['e4']);
  assert.ok(st.clock.running, 'clock runs after first move');

  // Scholar's mate line.
  for (const [s, f, t] of [[black, 'e7', 'e5'], [white, 'f1', 'c4'], [black, 'b8', 'c6'], [white, 'd1', 'h5'], [black, 'g8', 'f6']]) {
    assert.ok((await emit(s, 'move', { from: f, to: t })).ok, `${f}${t}`);
  }

  // Chat
  const chatP = next(black, 'chat');
  white.emit('chat', { text: '  good luck <b>  ' });
  const msg = await chatP;
  assert.strictEqual(msg.text, 'good luck <b>', 'chat trimmed and relayed as text');

  // ICE servers: seated players get a list, outsiders only STUN
  const ice = await emit(white, 'ice');
  assert.ok(ice.ok && ice.iceServers.length >= 1, 'seated player gets ICE servers');
  const outsider = connect();
  await next(outsider, 'connect');
  const iceOut = await emit(outsider, 'ice');
  assert.strictEqual(iceOut.ok, false, 'outsider gets no relay credentials');
  outsider.close();

  // Signalling relay
  const sigP = next(black, 'rtc', (d) => d.type === 'invite');
  white.emit('rtc', { type: 'invite', video: true });
  assert.ok((await sigP).video, 'call invite relayed');

  // Reconnect: black refreshes and takes the same seat back
  black.disconnect();
  await next(white, 'state', (s) => !s.players.b.connected);
  const black2 = connect();
  await next(black2, 'connect');
  const back = await emit(black2, 'join', { code: created.code, token: black === a ? token('a') : token('b') });
  assert.ok(back.ok && back.color === 'b', 'returning player gets the same seat');
  assert.ok(back.chat.length === 1, 'chat history restored');

  // Mate
  const overP = next(black2, 'state', (s) => s.status === 'over');
  assert.ok((await emit(white, 'move', { from: 'h5', to: 'f7' })).ok);
  const over = await overP;
  assert.deepStrictEqual(over.result, { winner: 'w', reason: 'checkmate' }, 'checkmate detected by server');

  r = await emit(black2, 'move', { from: 'a7', to: 'a6' });
  assert.strictEqual(r.ok, false, 'no moves after game over');

  // Rematch swaps colours
  const seatP = next(white, 'seat');
  white.emit('rematch');
  black2.emit('rematch');
  assert.strictEqual((await seatP).color, 'b', 'colours swap on rematch');
  const fresh = await next(black2, 'state', (s) => s.status === 'playing' && s.gameNumber === 2);
  assert.strictEqual(fresh.moves.length, 0);

  // Resign
  const resP = next(white, 'state', (s) => s.status === 'over');
  black2.emit('resign');
  assert.deepStrictEqual((await resP).result, { winner: 'b', reason: 'resignation' });

  // Third player cannot join a full room
  const c = connect();
  await next(c, 'connect');
  const full = await emit(c, 'join', { code: created.code, token: token('c') });
  assert.strictEqual(full.ok, false, 'full room rejected');

  console.log('All server tests passed');
  [a, b, black2, c].forEach((s) => s.close());
  server.close();
  process.exit(0);
})().catch((e) => {
  console.error('TEST FAILED:', e.message);
  process.exit(1);
});
