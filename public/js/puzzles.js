/* Puzzles: solve real Lichess puzzles alone or on the same board as your friend. */
(function () {
  'use strict';

  const CT = window.CT;
  const { $, store, toast, sound, kingSquare, playUci, destsFor } = CT.ui;
  const net = CT.net;
  const ALL = CT.PUZZLES;

  const LEVELS = {
    all: () => true,
    easy: (p) => p.rating < 1350,
    medium: (p) => p.rating >= 1350 && p.rating < 1700,
    hard: (p) => p.rating >= 1700,
  };

  const els = {
    filter: $('#puzzle-filter'),
    turn: $('#puzzle-turn'),
    task: $('#puzzle-task'),
    feedback: $('#puzzle-feedback'),
    rating: $('#puzzle-rating'),
    theme: $('#puzzle-theme'),
    index: $('#puzzle-index'),
    hint: $('#puzzle-hint'),
    solution: $('#puzzle-solution'),
    retry: $('#puzzle-retry'),
    next: $('#puzzle-next'),
    solved: $('#puzzle-solved'),
    streak: $('#puzzle-streak'),
    best: $('#puzzle-best'),
    together: $('#puzzle-together'),
    togetherText: $('#together-text'),
    togetherBtn: $('#together-btn'),
    gameLink: $('#puzzle-game-link'),
  };

  const progress = store.get('puzzles', { solved: [], streak: 0, best: 0, level: 'all', index: {} });

  const pz = {
    board: null,
    game: new Chess(),
    puzzle: null,
    ply: 0, // index into puzzle.moves of the next expected move
    solver: 'w',
    failed: false,
    done: false,
    hints: 0,
    busy: false,
    together: false,
  };

  const list = () => ALL.filter(LEVELS[progress.level] || LEVELS.all);
  const save = () => store.set('puzzles', progress);

  function ensureBoard() {
    if (pz.board) return;
    pz.board = new CT.Board($('#puzzle-board'), {
      dests: (sq) => (pz.busy || pz.done ? [] : destsFor(pz.game)(sq)),
      onMove: ({ from, to, promotion }) => attempt(from + to + (promotion || ''), true),
      label: 'Puzzle board. Use arrow keys to move between squares and Enter to pick up or drop a piece.',
    });
  }

  function feedback(text, tone = 'info') {
    els.feedback.textContent = text;
    els.feedback.dataset.tone = tone;
  }

  function draw(lastMove, animate = true) {
    const fen = pz.game.fen();
    pz.board.setPosition(fen, {
      lastMove,
      check: pz.game.in_check() ? kingSquare(fen, pz.game.turn()) : null,
      animate,
    });
    pz.board.setMovable(pz.busy || pz.done ? null : pz.solver);
  }

  function renderStats() {
    els.solved.textContent = String(progress.solved.length);
    els.streak.textContent = String(progress.streak);
    els.best.textContent = String(progress.best);
  }

  function load(puzzle, { broadcast = true } = {}) {
    ensureBoard();
    pz.puzzle = puzzle;
    pz.game.load(puzzle.fen);
    pz.ply = 0;
    pz.failed = false;
    pz.done = false;
    pz.hints = 0;
    pz.busy = true;
    // The first move in the data is the opponent's; the solver is the other side.
    pz.solver = pz.game.turn() === 'w' ? 'b' : 'w';
    pz.board.setArrows([]);
    pz.board.setMarks([]);
    pz.board.setOrientation(pz.solver);
    draw(null, false);

    const items = list();
    const i = items.findIndex((p) => p.id === puzzle.id);
    els.index.textContent = i >= 0 ? `${i + 1} of ${items.length}` : '';
    els.rating.textContent = String(puzzle.rating);
    els.theme.textContent = puzzle.themes.join(', ');
    els.turn.dataset.color = pz.solver;
    els.task.textContent = `${pz.solver === 'w' ? 'White' : 'Black'} to move. Find the best move.`;
    els.gameLink.href = puzzle.url;
    feedback(progress.solved.includes(puzzle.id) ? 'You have solved this one before.' : '');
    els.next.textContent = 'Skip';

    progress.index[progress.level] = puzzle.id;
    save();

    if (broadcast && pz.together) net.send('puzzle', { action: 'open', id: puzzle.id });

    // Play the opponent's setup move after a short pause so the solver sees it.
    setTimeout(() => {
      if (pz.puzzle !== puzzle) return;
      const m = playUci(pz.game, puzzle.moves[0]);
      pz.ply = 1;
      pz.busy = false;
      if (m) sound.forSan(m.san);
      draw({ from: m.from, to: m.to });
    }, 600);
  }

  /** Try a move for the solver. `mine` is false when it came from the partner. */
  function attempt(uci, mine) {
    const p = pz.puzzle;
    if (!p || pz.done || pz.busy) return;
    const expected = p.moves[pz.ply];
    const move = playUci(pz.game, uci);
    if (!move) return;
    const isLast = pz.ply === p.moves.length - 1;
    const matches = move.from + move.to === expected.slice(0, 4) && (!expected[4] || (move.promotion || '') === expected[4]);
    // Any checkmate counts on the final move, as on Lichess.
    const correct = matches || (isLast && pz.game.in_checkmate());

    if (mine && pz.together) net.send('puzzle', { action: 'move', id: p.id, uci: move.from + move.to + (move.promotion || '') });

    if (!correct) {
      draw({ from: move.from, to: move.to }, false);
      pz.busy = true;
      sound.bad();
      pz.board.flashWrong(move.to);
      feedback(`${move.san} is not it. Try again.`, 'bad');
      if (!pz.failed && mine) {
        pz.failed = true;
        progress.streak = 0;
        save();
        renderStats();
      }
      setTimeout(() => {
        pz.game.undo();
        pz.busy = false;
        const h = pz.game.history({ verbose: true });
        const last = h[h.length - 1];
        draw(last ? { from: last.from, to: last.to } : null, false);
      }, 700);
      return;
    }

    sound.forSan(move.san);
    pz.board.setArrows([]);
    pz.board.setMarks([]);
    pz.ply += 1;

    if (pz.ply >= p.moves.length) return solved(move);

    feedback('Good move. Keep going.', 'good');
    pz.busy = true;
    draw({ from: move.from, to: move.to });
    setTimeout(() => {
      if (pz.puzzle !== p) return;
      const reply = playUci(pz.game, p.moves[pz.ply]);
      pz.ply += 1;
      pz.busy = false;
      if (reply) sound.forSan(reply.san);
      draw(reply ? { from: reply.from, to: reply.to } : null);
    }, 450);
  }

  function solved(move) {
    pz.done = true;
    draw({ from: move.from, to: move.to });
    sound.good();
    const first = !progress.solved.includes(pz.puzzle.id);
    if (!pz.failed && pz.hints === 0) {
      progress.streak += 1;
      progress.best = Math.max(progress.best, progress.streak);
      feedback('Solved. Nice.', 'good');
    } else {
      feedback(pz.hints ? 'Solved with a hint.' : 'Solved on a second try.', 'good');
    }
    if (first) progress.solved.push(pz.puzzle.id);
    save();
    renderStats();
    els.next.textContent = 'Next puzzle';
  }

  function showHint() {
    const p = pz.puzzle;
    if (!p || pz.done || pz.busy) return;
    const exp = p.moves[pz.ply];
    pz.hints += 1;
    if (progress.streak && pz.hints === 1) {
      progress.streak = 0;
      save();
      renderStats();
    }
    if (pz.hints === 1) {
      pz.board.setMarks([exp.slice(0, 2)]);
      feedback('Look at the highlighted piece.', 'info');
    } else {
      pz.board.setArrows([[exp.slice(0, 2), exp.slice(2, 4)]]);
      feedback('This is the move.', 'info');
    }
  }

  async function showSolution() {
    const p = pz.puzzle;
    if (!p || pz.done) return;
    pz.done = true;
    pz.failed = true;
    progress.streak = 0;
    save();
    renderStats();
    feedback('Here is the solution.', 'info');
    while (pz.ply < p.moves.length) {
      await new Promise((r) => setTimeout(r, 650));
      if (pz.puzzle !== p) return;
      const m = playUci(pz.game, p.moves[pz.ply]);
      pz.ply += 1;
      if (m) {
        sound.forSan(m.san);
        draw({ from: m.from, to: m.to });
      }
    }
    els.next.textContent = 'Next puzzle';
  }

  function next() {
    const items = list();
    if (!items.length) return;
    const i = items.findIndex((p) => p.id === (pz.puzzle && pz.puzzle.id));
    // Prefer the next unsolved puzzle; wrap around when all are solved.
    for (let k = 1; k <= items.length; k++) {
      const cand = items[(i + k) % items.length];
      if (!progress.solved.includes(cand.id) || k === items.length) return load(cand);
    }
  }

  function setLevel(level) {
    progress.level = LEVELS[level] ? level : 'all';
    for (const b of els.filter.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.level === progress.level));
    save();
    const items = list();
    const remembered = items.find((p) => p.id === progress.index[progress.level]);
    load(remembered || items.find((p) => !progress.solved.includes(p.id)) || items[0]);
  }

  // ---------------------------------------------------------------- together mode

  function renderTogether() {
    const inRoom = !!net.room;
    els.together.dataset.on = String(pz.together && inRoom);
    els.togetherBtn.hidden = !inRoom;
    if (!inRoom) {
      pz.together = false;
      els.togetherText.textContent = 'Playing a friend? Join a room and you can solve puzzles on the same board while you talk.';
    } else if (pz.together) {
      els.togetherText.textContent = 'Solving together. Your friend sees every move you make, and you see theirs.';
      els.togetherBtn.textContent = 'Stop solving together';
    } else {
      els.togetherText.textContent = 'Solve puzzles on the same board as your friend while you talk.';
      els.togetherBtn.textContent = 'Solve with my friend';
    }
  }

  els.togetherBtn.addEventListener('click', () => {
    pz.together = !pz.together;
    renderTogether();
    if (pz.together && pz.puzzle) net.send('puzzle', { action: 'open', id: pz.puzzle.id });
  });

  net.socket.on('puzzle', (msg) => {
    const p = ALL.find((x) => x.id === msg.id);
    if (!p) return;
    if (msg.action === 'open') {
      const wasOn = pz.together;
      pz.together = true;
      renderTogether();
      if (!pz.puzzle || pz.puzzle.id !== p.id) load(p, { broadcast: false });
      if (location.hash !== '#/puzzles') {
        toast(`${msg.name} opened a puzzle for you both. Open Puzzles to join in.`);
      } else if (!wasOn) {
        toast(`${msg.name} is solving with you.`);
      }
    } else if (msg.action === 'move' && pz.together && pz.puzzle && pz.puzzle.id === p.id) {
      attempt(msg.uci, false);
    }
  });

  net.bus.addEventListener('room', renderTogether);

  // ---------------------------------------------------------------- controls

  els.filter.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-level]');
    if (b) setLevel(b.dataset.level);
  });
  els.filter.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const btns = [...els.filter.querySelectorAll('button')];
    const i = btns.findIndex((b) => b.dataset.level === progress.level);
    const n = btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
    setLevel(n.dataset.level);
    n.focus();
  });
  els.hint.addEventListener('click', showHint);
  els.solution.addEventListener('click', showSolution);
  els.retry.addEventListener('click', () => pz.puzzle && load(pz.puzzle));
  els.next.addEventListener('click', next);

  let started = false;
  CT.puzzles = {
    onShow() {
      renderTogether();
      renderStats();
      if (!started) {
        started = true;
        // A partner may already have opened a puzzle for us.
        if (!pz.puzzle) setLevel(progress.level);
        else for (const b of els.filter.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.level === progress.level));
      }
    },
  };
})();
