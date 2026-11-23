/* Board: renders a position and turns taps, drags and keys into move requests.
 * It knows nothing about the rules; the owner supplies legal destinations via
 * `dests(square)` and receives `onMove({ from, to, promotion })`.
 */
(function () {
  'use strict';

  const FILES = 'abcdefgh';
  const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  const PROMOTION = ['q', 'r', 'b', 'n'];
  const DRAG_THRESHOLD = 5;

  function parseFen(fen) {
    const map = {};
    const rows = fen.split(' ')[0].split('/');
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) {
          f += Number(ch);
        } else {
          map[FILES[f] + (8 - r)] = { color: ch === ch.toUpperCase() ? 'w' : 'b', type: ch.toLowerCase() };
          f += 1;
        }
      }
    }
    return map;
  }

  const pieceSrc = (p) => `/pieces/${p.color}${p.type.toUpperCase()}.svg`;
  const describe = (p) => (p ? `${p.color === 'w' ? 'white' : 'black'} ${NAMES[p.type]}` : 'empty');

  class Board {
    /**
     * @param {HTMLElement} host
     * @param {{orientation?: 'w'|'b', dests?: (sq:string)=>string[], onMove?: Function, label?: string}} opts
     */
    constructor(host, opts = {}) {
      this.host = host;
      this.orientation = opts.orientation || 'w';
      this.dests = opts.dests || (() => []);
      this.onMove = opts.onMove || null;
      this.movable = null; // 'w' | 'b' | 'both' | null
      this.pieces = {};
      this.lastMove = null;
      this.checkSq = null;
      this.marks = [];
      this.arrows = [];
      this.selected = null;
      this.destList = [];
      this.cursor = null;
      this.track = null;
      this.promoOpen = false;

      this.el = document.createElement('div');
      this.el.className = 'board';
      this.el.tabIndex = 0;
      this.el.setAttribute('role', 'application');
      this.el.setAttribute('aria-label', opts.label || 'Chess board. Use arrow keys to move between squares and Enter to pick up or drop a piece.');
      this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.svg.setAttribute('class', 'arrows');
      this.svg.setAttribute('viewBox', '0 0 8 8');
      this.svg.setAttribute('aria-hidden', 'true');
      host.innerHTML = '';
      host.appendChild(this.el);
      host.appendChild(this.svg);

      this._build();
      this._bind();
    }

    // ---------------------------------------------------------------- layout

    _squareAt(row, col) {
      const f = this.orientation === 'w' ? col : 7 - col;
      const r = this.orientation === 'w' ? 8 - row : row + 1;
      return FILES[f] + r;
    }

    _rowCol(sq) {
      const f = FILES.indexOf(sq[0]);
      const r = Number(sq[1]);
      return this.orientation === 'w' ? { row: 8 - r, col: f } : { row: r - 1, col: 7 - f };
    }

    _build() {
      this.el.textContent = '';
      this.sqEls = {};
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const sq = this._squareAt(row, col);
          const el = document.createElement('div');
          const dark = (FILES.indexOf(sq[0]) + Number(sq[1])) % 2 === 1;
          el.className = 'sq ' + (dark ? 'dark' : 'light');
          el.dataset.sq = sq;
          if (col === 0) el.insertAdjacentHTML('beforeend', `<span class="coord rank">${sq[1]}</span>`);
          if (row === 7) el.insertAdjacentHTML('beforeend', `<span class="coord file">${sq[0]}</span>`);
          this.el.appendChild(el);
          this.sqEls[sq] = el;
        }
      }
      this._renderAll();
    }

    setOrientation(color) {
      if (color === this.orientation) return;
      this.orientation = color;
      this._build();
    }

    flip() {
      this.setOrientation(this.orientation === 'w' ? 'b' : 'w');
    }

    // ---------------------------------------------------------------- state

    setPosition(fen, { lastMove = null, check = null, animate = true } = {}) {
      const prev = this.pieces;
      this.pieces = parseFen(fen);
      this.lastMove = lastMove;
      this.checkSq = check;
      this._closePromo();
      this._deselect(false);
      this._renderAll();
      if (animate && lastMove && prev[lastMove.from] && !this.pieces[lastMove.from]) {
        this._slide(lastMove.from, lastMove.to);
        // Castling: slide the rook too.
        const p = this.pieces[lastMove.to];
        if (p && p.type === 'k' && Math.abs(FILES.indexOf(lastMove.from[0]) - FILES.indexOf(lastMove.to[0])) === 2) {
          const rank = lastMove.to[1];
          const kingSide = lastMove.to[0] === 'g';
          this._slide((kingSide ? 'h' : 'a') + rank, (kingSide ? 'f' : 'd') + rank);
        }
      }
    }

    setMovable(color) {
      this.movable = color;
      if (!color) this._deselect();
      this.el.classList.toggle('movable', !!color);
      this._renderAll();
    }

    setMarks(squares) {
      this.marks = squares || [];
      this._renderAll();
    }

    setArrows(pairs) {
      this.arrows = pairs || [];
      this._renderArrows();
    }

    flashWrong(sq) {
      const el = this.sqEls[sq];
      if (!el) return;
      el.classList.add('wrong');
      this.el.classList.remove('shake');
      void this.el.offsetWidth;
      this.el.classList.add('shake');
      setTimeout(() => el.classList.remove('wrong'), 600);
    }

    _canMove(p) {
      return !!p && !!this.movable && (this.movable === 'both' || this.movable === p.color);
    }

    // ---------------------------------------------------------------- render

    _renderAll() {
      for (const sq in this.sqEls) this._renderSquare(sq);
      this._renderArrows();
    }

    _renderSquare(sq) {
      const el = this.sqEls[sq];
      const p = this.pieces[sq];
      let img = el.querySelector('.piece');
      if (p) {
        const src = pieceSrc(p);
        if (!img) {
          img = document.createElement('img');
          img.className = 'piece';
          img.alt = '';
          img.draggable = false;
          el.appendChild(img);
        }
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        img.classList.remove('dragging');
      } else if (img) {
        img.remove();
      }
      const lm = this.lastMove;
      el.classList.toggle('last', !!lm && (lm.from === sq || lm.to === sq));
      el.classList.toggle('check', this.checkSq === sq);
      el.classList.toggle('marked', this.marks.includes(sq));
      el.classList.toggle('selected', this.selected === sq);
      const isDest = this.destList.includes(sq);
      el.classList.toggle('dest', isDest);
      el.classList.toggle('capture', isDest && !!p);
      el.classList.toggle('own', this._canMove(p));
      el.classList.toggle('cursor', this.cursor === sq && this.el === document.activeElement && this._keyboardMode);
    }

    _renderArrows() {
      const ns = 'http://www.w3.org/2000/svg';
      this.svg.textContent = '';
      if (!this.arrows.length) return;
      const defs = document.createElementNS(ns, 'defs');
      defs.innerHTML = '<marker id="ah-' + this._uid() + '" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3" orient="auto"><path d="M0 0 10 5 0 10z" fill="rgba(217,171,78,0.92)"/></marker>';
      this.svg.appendChild(defs);
      const markerId = defs.firstChild.id;
      for (const [from, to] of this.arrows) {
        const a = this._rowCol(from);
        const b = this._rowCol(to);
        const x1 = a.col + 0.5;
        const y1 = a.row + 0.5;
        let x2 = b.col + 0.5;
        let y2 = b.row + 0.5;
        const len = Math.hypot(x2 - x1, y2 - y1);
        x2 -= ((x2 - x1) / len) * 0.3;
        y2 -= ((y2 - y1) / len) * 0.3;
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', 'rgba(217,171,78,0.92)');
        line.setAttribute('stroke-width', '0.17');
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('marker-end', `url(#${markerId})`);
        this.svg.appendChild(line);
      }
    }

    _uid() {
      Board._n = (Board._n || 0) + 1;
      return Board._n;
    }

    _slide(from, to) {
      const img = this.sqEls[to] && this.sqEls[to].querySelector('.piece');
      if (!img || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const a = this.sqEls[from].getBoundingClientRect();
      const b = this.sqEls[to].getBoundingClientRect();
      img.animate(
        [{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 160, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' }
      );
    }

    // ---------------------------------------------------------------- input

    _bind() {
      this.el.addEventListener('pointerdown', (e) => this._down(e));
      this.el.addEventListener('pointermove', (e) => this._move(e));
      this.el.addEventListener('pointerup', (e) => this._up(e));
      this.el.addEventListener('pointercancel', () => this._cancelDrag());
      this.el.addEventListener('contextmenu', (e) => e.preventDefault());
      this.el.addEventListener('keydown', (e) => this._key(e));
      this.el.addEventListener('focus', () => this._renderAll());
      this.el.addEventListener('blur', () => {
        this._keyboardMode = false;
        this._renderAll();
      });
    }

    _sqFromPoint(x, y) {
      const r = this.el.getBoundingClientRect();
      const col = Math.floor(((x - r.left) / r.width) * 8);
      const row = Math.floor(((y - r.top) / r.height) * 8);
      if (col < 0 || col > 7 || row < 0 || row > 7) return null;
      return this._squareAt(row, col);
    }

    _select(sq) {
      this.selected = sq;
      this.destList = this.dests(sq) || [];
      this._renderAll();
    }

    _deselect(render = true) {
      this.selected = null;
      this.destList = [];
      if (render) this._renderAll();
    }

    _down(e) {
      if (e.button > 0 || this.promoOpen) return;
      this._keyboardMode = false;
      const sq = this._sqFromPoint(e.clientX, e.clientY);
      if (!sq) return;
      const p = this.pieces[sq];

      if (this.selected && this.destList.includes(sq)) {
        this._request(this.selected, sq);
        return;
      }
      if (this._canMove(p)) {
        const wasSelected = this.selected === sq;
        this._select(sq);
        this.track = { sq, x: e.clientX, y: e.clientY, id: e.pointerId, dragging: false, wasSelected };
        try {
          this.el.setPointerCapture(e.pointerId);
        } catch (_) {
          /* not supported */
        }
        e.preventDefault();
        return;
      }
      this._deselect();
    }

    _move(e) {
      const t = this.track;
      if (!t || t.id !== e.pointerId) return;
      if (!t.dragging) {
        if (Math.hypot(e.clientX - t.x, e.clientY - t.y) < DRAG_THRESHOLD) return;
        t.dragging = true;
        const img = this.sqEls[t.sq].querySelector('.piece');
        if (!img) return;
        const size = this.el.getBoundingClientRect().width / 8;
        const ghost = img.cloneNode();
        ghost.className = 'drag-ghost';
        ghost.style.width = ghost.style.height = size + 'px';
        document.body.appendChild(ghost);
        t.ghost = ghost;
        t.size = size;
        img.classList.add('dragging');
      }
      if (t.ghost) {
        t.ghost.style.left = e.clientX - t.size / 2 + 'px';
        t.ghost.style.top = e.clientY - t.size / 2 + 'px';
      }
    }

    _up(e) {
      const t = this.track;
      if (!t || t.id !== e.pointerId) return;
      this.track = null;
      if (t.ghost) t.ghost.remove();
      const img = this.sqEls[t.sq] && this.sqEls[t.sq].querySelector('.piece');
      if (img) img.classList.remove('dragging');
      if (!t.dragging) {
        // Second tap on the same piece puts it down again.
        if (t.wasSelected) this._deselect();
        return;
      }
      const target = this._sqFromPoint(e.clientX, e.clientY);
      if (target && target !== t.sq && this.destList.includes(target)) this._request(t.sq, target);
    }

    _cancelDrag() {
      const t = this.track;
      this.track = null;
      if (t && t.ghost) t.ghost.remove();
      this._renderAll();
    }

    _key(e) {
      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape'];
      if (!keys.includes(e.key) || this.promoOpen) return;
      e.preventDefault();
      this._keyboardMode = true;
      if (!this.cursor) this.cursor = this.orientation === 'w' ? 'e2' : 'e7';
      const { row, col } = this._rowCol(this.cursor);
      if (e.key === 'ArrowUp') this.cursor = this._squareAt(Math.max(0, row - 1), col);
      if (e.key === 'ArrowDown') this.cursor = this._squareAt(Math.min(7, row + 1), col);
      if (e.key === 'ArrowLeft') this.cursor = this._squareAt(row, Math.max(0, col - 1));
      if (e.key === 'ArrowRight') this.cursor = this._squareAt(row, Math.min(7, col + 1));
      if (e.key === 'Escape') this._deselect(false);
      if (e.key === 'Enter' || e.key === ' ') {
        const sq = this.cursor;
        if (this.selected && this.destList.includes(sq)) {
          this._request(this.selected, sq);
          return;
        }
        if (this._canMove(this.pieces[sq]) && this.selected !== sq) this._select(sq);
        else this._deselect(false);
      }
      this.el.setAttribute('aria-label', `${this.cursor}, ${describe(this.pieces[this.cursor])}${this.selected ? `. Holding ${describe(this.pieces[this.selected])} from ${this.selected}` : ''}`);
      this._renderAll();
    }

    async _request(from, to) {
      const p = this.pieces[from];
      this._deselect();
      let promotion;
      if (p && p.type === 'p' && (to[1] === '8' || to[1] === '1')) {
        promotion = await this._pickPromotion(p.color);
        if (!promotion) return;
      }
      if (this.onMove) this.onMove({ from, to, promotion });
    }

    _pickPromotion(color) {
      return new Promise((resolve) => {
        this._closePromo();
        this.promoOpen = true;
        const wrap = document.createElement('div');
        wrap.className = 'promo';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-label', 'Choose a piece to promote to');
        const pick = document.createElement('div');
        pick.className = 'promo-pick';
        for (const t of PROMOTION) {
          const b = document.createElement('button');
          b.type = 'button';
          b.setAttribute('aria-label', NAMES[t]);
          b.innerHTML = `<img src="${pieceSrc({ color, type: t })}" alt="">`;
          b.addEventListener('click', () => finish(t));
          pick.appendChild(b);
        }
        wrap.appendChild(pick);
        const finish = (t) => {
          this._closePromo();
          this.el.focus({ preventScroll: true });
          resolve(t);
        };
        wrap.addEventListener('pointerdown', (e) => {
          if (e.target === wrap) finish(null);
        });
        wrap.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') finish(null);
        });
        this._promoResolve = () => resolve(null);
        this.host.appendChild(wrap);
        this._promoEl = wrap;
        pick.querySelector('button').focus({ preventScroll: true });
      });
    }

    _closePromo() {
      if (this._promoEl) {
        this._promoEl.remove();
        this._promoEl = null;
      }
      this.promoOpen = false;
    }
  }

  window.CT = window.CT || {};
  window.CT.Board = Board;
  window.CT.parseFen = parseFen;
})();
