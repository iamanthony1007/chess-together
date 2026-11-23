/* Lessons: guided positions where the player makes the move being taught. */
(function () {
  'use strict';

  const CT = window.CT;
  const { $, store, sound, kingSquare, playUci, destsFor } = CT.ui;
  const LESSONS = CT.LESSONS;
  const ICONS = { pieces: 'wN', checkmate: 'bK', special: 'wR', forks: 'wN', pins: 'wB', opening: 'wP', endgame: 'wR', sacrifice: 'wQ' };

  const els = {
    list: $('#learn-list'),
    groups: $('#lesson-groups'),
    detail: $('#lesson-detail'),
    back: $('#lesson-back'),
    title: $('#lesson-title'),
    count: $('#lesson-step-count'),
    progress: $('#lesson-progress'),
    text: $('#lesson-text'),
    task: $('#lesson-task'),
    feedback: $('#lesson-feedback'),
    prev: $('#lesson-prev'),
    reset: $('#lesson-reset'),
    next: $('#lesson-next'),
  };

  const done = store.get('lessons', {}); // lessonId -> highest step completed (count)

  const ls = {
    board: null,
    game: new Chess(),
    lesson: null,
    step: 0,
    solved: false,
    busy: false,
    positions: [], // fen at the start of each step, so Previous/Reset work on follow-on steps
  };

  // ---------------------------------------------------------------- list

  function renderList() {
    const levels = ['Beginner', 'Intermediate', 'Advanced'];
    els.groups.textContent = '';
    for (const level of levels) {
      const items = LESSONS.filter((l) => l.level === level);
      if (!items.length) continue;
      const group = document.createElement('section');
      group.className = 'lesson-group';
      group.innerHTML = `<h2>${level}</h2>`;
      const ul = document.createElement('ul');
      ul.className = 'lesson-rows';
      for (const l of items) {
        const taskCount = l.steps.length;
        const reached = Math.min(done[l.id] || 0, taskCount);
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lesson-row';
        btn.innerHTML = `
          <img src="/pieces/${ICONS[l.id] || 'wP'}.svg" alt="">
          <span><span class="lesson-row-title"></span><span class="lesson-row-sub"></span></span>
          <span class="lesson-row-state"></span>`;
        btn.querySelector('.lesson-row-title').textContent = l.title;
        btn.querySelector('.lesson-row-sub').textContent = l.summary;
        const state = btn.querySelector('.lesson-row-state');
        state.textContent = reached >= taskCount ? 'Done' : reached > 0 ? `${reached} of ${taskCount}` : `${taskCount} steps`;
        state.dataset.done = String(reached >= taskCount);
        btn.addEventListener('click', () => open(l.id));
        li.appendChild(btn);
        ul.appendChild(li);
      }
      group.appendChild(ul);
      els.groups.appendChild(group);
    }
  }

  // ---------------------------------------------------------------- detail

  function ensureBoard() {
    if (ls.board) return;
    ls.board = new CT.Board($('#lesson-board'), {
      dests: (sq) => (ls.busy || ls.solved || !currentStep().task ? [] : destsFor(ls.game)(sq)),
      onMove: ({ from, to, promotion }) => attempt(from, to, promotion),
      label: 'Lesson board. Use arrow keys to move between squares and Enter to pick up or drop a piece.',
    });
  }

  const currentStep = () => ls.lesson.steps[ls.step];

  function open(id) {
    ls.lesson = LESSONS.find((l) => l.id === id);
    if (!ls.lesson) return;
    ls.positions = [];
    els.list.hidden = true;
    els.detail.hidden = false;
    els.title.textContent = ls.lesson.title;
    ensureBoard();
    // Resume where they left off, unless the lesson is finished.
    const reached = done[id] || 0;
    goTo(0);
    for (let i = 0; i < Math.min(reached, ls.lesson.steps.length - 1); i++) skipForward();
    window.scrollTo({ top: 0 });
  }

  /** Advance one step without the player solving it (used to resume). */
  function skipForward() {
    const s = currentStep();
    if (s.task) {
      const uci = s.accept ? s.accept[0] : firstMate();
      if (uci) playUci(ls.game, uci);
      if (s.reply) playUci(ls.game, s.reply);
    }
    goTo(ls.step + 1, ls.game.fen());
  }

  function firstMate() {
    const m = ls.game.moves({ verbose: true }).find((mv) => {
      ls.game.move(mv);
      const r = ls.game.in_checkmate();
      ls.game.undo();
      return r;
    });
    return m ? m.from + m.to + (m.promotion || '') : null;
  }

  function goTo(i, carryFen) {
    ls.step = i;
    const s = currentStep();
    const fen = s.fen || carryFen || ls.positions[i];
    ls.positions[i] = fen;
    ls.game.load(fen);
    ls.solved = !s.task;
    ls.busy = false;
    render(null);
  }

  function render(lastMove) {
    const s = currentStep();
    const total = ls.lesson.steps.length;
    els.count.textContent = `Step ${ls.step + 1} of ${total}`;
    els.progress.style.width = `${((ls.step + (ls.solved ? 1 : 0)) / total) * 100}%`;
    els.text.textContent = s.text;
    els.task.textContent = ls.solved ? '' : s.task || '';
    if (!lastMove) {
      els.feedback.textContent = '';
      els.feedback.dataset.tone = '';
    }
    const fen = ls.game.fen();
    ls.board.setPosition(fen, {
      lastMove,
      check: ls.game.in_check() ? kingSquare(fen, ls.game.turn()) : null,
    });
    ls.board.setMarks(lastMove ? [] : s.marks || []);
    ls.board.setArrows(lastMove ? [] : s.arrows || []);
    ls.board.setMovable(!ls.solved && !ls.busy && s.task ? ls.game.turn() : null);
    els.prev.disabled = ls.step === 0;
    els.next.disabled = !ls.solved || ls.busy;
    els.next.textContent = ls.step === total - 1 ? 'Finish lesson' : 'Next';
  }

  function attempt(from, to, promotion) {
    const s = currentStep();
    if (ls.solved || ls.busy || !s.task) return;
    const move = ls.game.move({ from, to, promotion: promotion || 'q' });
    if (!move) return;
    const uci = from + to;
    const ok = (s.accept && s.accept.some((a) => a.slice(0, 4) === uci)) || (s.goal === 'mate' && ls.game.in_checkmate());
    if (!ok) {
      ls.busy = true;
      render({ from, to });
      sound.bad();
      ls.board.flashWrong(to);
      els.feedback.textContent = `${move.san} is legal, but not what this step is about. Try again.`;
      els.feedback.dataset.tone = 'bad';
      setTimeout(() => {
        ls.game.undo();
        ls.busy = false;
        render({ from: '', to: '' });
        ls.board.setMarks(s.marks || []);
        ls.board.setArrows(s.arrows || []);
      }, 800);
      return;
    }

    sound.forSan(move.san);
    ls.solved = true;
    els.feedback.textContent = ls.game.in_checkmate() ? `${move.san}. Checkmate.` : `${move.san}. Correct.`;
    els.feedback.dataset.tone = 'good';
    markReached(ls.step + 1);
    render({ from, to });

    if (s.reply) {
      ls.busy = true;
      render({ from, to });
      const lesson = ls.lesson;
      const stepIdx = ls.step;
      setTimeout(() => {
        if (ls.lesson !== lesson || ls.step !== stepIdx) return;
        ls.busy = false;
        const r = playUci(ls.game, s.reply);
        if (r) {
          sound.forSan(r.san);
          render({ from: r.from, to: r.to });
        }
      }, 600);
    }
  }

  function markReached(n) {
    if ((done[ls.lesson.id] || 0) < n) {
      done[ls.lesson.id] = n;
      store.set('lessons', done);
    }
  }

  function close() {
    els.detail.hidden = true;
    els.list.hidden = false;
    renderList();
  }

  els.back.addEventListener('click', close);
  els.prev.addEventListener('click', () => ls.step > 0 && goTo(ls.step - 1));
  els.reset.addEventListener('click', () => goTo(ls.step));
  els.next.addEventListener('click', () => {
    if (!ls.solved || ls.busy) return;
    const s = currentStep();
    if (!s.task) markReached(ls.step + 1);
    if (ls.step < ls.lesson.steps.length - 1) {
      goTo(ls.step + 1, ls.game.fen());
    } else {
      sound.good();
      CT.ui.toast(`Lesson complete: ${ls.lesson.title}.`);
      close();
    }
  });

  CT.lessons = {
    onShow() {
      if (els.detail.hidden) renderList();
    },
  };
})();
