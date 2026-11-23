/* Shared UI helpers: toasts, dialogs, sounds, storage, small chess utilities. */
(function () {
  'use strict';

  const CT = (window.CT = window.CT || {});
  const $ = (sel, root = document) => root.querySelector(sel);

  // ---------------------------------------------------------------- storage
  // localStorage can be missing or throw (private mode, embedded views).
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('ct:' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (_) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('ct:' + key, JSON.stringify(value));
      } catch (_) {
        /* ignore */
      }
    },
    remove(key) {
      try {
        localStorage.removeItem('ct:' + key);
      } catch (_) {
        /* ignore */
      }
    },
  };

  // ---------------------------------------------------------------- toasts
  function toast(message, { tone = 'info', ms = 3200 } = {}) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.dataset.tone = tone;
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 250);
    }, ms);
  }

  // ---------------------------------------------------------------- dialog
  /**
   * Show a modal dialog. Resolves with the value of the button pressed, or null.
   * @param {{title:string, body?:string, actions:Array<{label:string, value:string, kind?:string}>}} opts
   */
  function dialog({ title, body = '', actions }) {
    const dlg = $('#dialog');
    if (dlg.open) dlg.close('replaced');
    $('#dialog-title').textContent = title;
    $('#dialog-body').textContent = body;
    const bar = $('#dialog-actions');
    bar.textContent = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = `btn btn-${a.kind || 'secondary'}`;
      b.value = a.value;
      b.textContent = a.label;
      bar.appendChild(b);
    }
    return new Promise((resolve) => {
      const onClose = () => {
        dlg.removeEventListener('close', onClose);
        const v = dlg.returnValue;
        resolve(v && v !== 'replaced' ? v : null);
      };
      dlg.returnValue = '';
      dlg.addEventListener('close', onClose);
      dlg.showModal();
      const primary = bar.querySelector('.btn-primary, .btn-danger') || bar.querySelector('button');
      if (primary) primary.focus();
    });
  }

  function closeDialog() {
    const dlg = $('#dialog');
    if (dlg.open) dlg.close('replaced');
  }

  // ---------------------------------------------------------------- sound
  const sound = {
    ctx: null,
    on: store.get('sound', true),
    tone(freq, dur, type = 'sine', gain = 0.12, delay = 0) {
      if (!this.on) return;
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          this.ctx = new AC();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const t0 = this.ctx.currentTime + delay;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        g.gain.setValueAtTime(gain, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g).connect(this.ctx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      } catch (_) {
        /* audio blocked until first gesture */
      }
    },
    move() {
      this.tone(330, 0.07, 'triangle', 0.14);
    },
    capture() {
      this.tone(220, 0.09, 'triangle', 0.18);
      this.tone(440, 0.05, 'triangle', 0.08, 0.02);
    },
    check() {
      this.tone(660, 0.1, 'sine', 0.12);
      this.tone(880, 0.12, 'sine', 0.1, 0.09);
    },
    good() {
      [523, 659, 784].forEach((f, i) => this.tone(f, 0.14, 'sine', 0.1, i * 0.07));
    },
    bad() {
      this.tone(196, 0.18, 'square', 0.05);
    },
    ring() {
      this.tone(784, 0.18, 'sine', 0.1);
      this.tone(659, 0.18, 'sine', 0.1, 0.22);
    },
    forSan(san) {
      if (!san) return;
      if (san.includes('#') || san.includes('+')) this.check();
      else if (san.includes('x')) this.capture();
      else this.move();
    },
  };

  // ---------------------------------------------------------------- chess utils
  /** Square of the king of `color` in a FEN. */
  function kingSquare(fen, color) {
    const map = CT.parseFen(fen);
    for (const sq in map) if (map[sq].type === 'k' && map[sq].color === color) return sq;
    return null;
  }

  const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const START = { p: 8, n: 2, b: 2, r: 2, q: 1 };

  /** Pieces each side has captured, and the material balance. */
  function material(fen) {
    const map = CT.parseFen(fen);
    const count = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
    for (const sq in map) {
      const p = map[sq];
      if (p.type !== 'k') count[p.color][p.type] += 1;
    }
    const captured = { w: [], b: [] }; // pieces captured BY that colour
    let score = 0;
    for (const t of ['q', 'r', 'b', 'n', 'p']) {
      for (let i = count.b[t]; i < START[t]; i++) captured.w.push('b' + t);
      for (let i = count.w[t]; i < START[t]; i++) captured.b.push('w' + t);
      score += (count.w[t] - count.b[t]) * VALUES[t];
    }
    return { captured, score };
  }

  function formatClock(ms) {
    const total = Math.max(0, ms);
    if (total < 10000) {
      const s = Math.floor(total / 1000);
      const tenths = Math.floor((total % 1000) / 100);
      return `0:0${s}.${tenths}`;
    }
    const secs = Math.ceil(total / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  /** Make a uci move against a chess.js game; returns the move or null. */
  function playUci(game, uci) {
    return game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
  }

  function destsFor(game) {
    return (sq) => game.moves({ square: sq, verbose: true }).map((m) => m.to);
  }

  CT.ui = { $, store, toast, dialog, closeDialog, sound, kingSquare, material, formatClock, playUci, destsFor };
})();
