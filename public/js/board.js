/**
 * ChessBoard - Chess board rendering and interaction module
 * Chess Together - Mobile-first multiplayer chess app
 *
 * Handles board rendering, piece display, tap-to-move, drag-and-drop,
 * legal move indicators, promotion dialogs, move animation, and board flipping.
 */

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────

  const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];

  const PIECE_CDN_BASE =
    'https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/piece/cburnett/';

  // Map FEN char → CDN filename component  (e.g. 'K' → 'wK', 'q' → 'bQ')
  function pieceToFilename(fenChar) {
    const color = fenChar === fenChar.toUpperCase() ? 'w' : 'b';
    return color + fenChar.toUpperCase();
  }

  const PROMOTION_PIECES = ['q', 'r', 'b', 'n'];

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Convert 0-based (file, rank) to algebraic ("a1"). */
  function indexToAlgebraic(fileIdx, rankIdx) {
    return FILES[fileIdx] + RANKS[rankIdx];
  }

  /** Convert algebraic square to { fileIdx, rankIdx }. */
  function algebraicToIndex(sq) {
    return {
      fileIdx: FILES.indexOf(sq[0]),
      rankIdx: RANKS.indexOf(sq[1]),
    };
  }

  /** Get the pointer position from a mouse or touch event. */
  function pointerPos(e) {
    if (e.touches && e.touches.length) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    if (e.changedTouches && e.changedTouches.length) {
      return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  // ── ChessBoard Class ──────────────────────────────────────────────────────

  class ChessBoard {
    /**
     * @param {string} containerId – id of the board wrapper div
     * @param {object} [options]
     * @param {boolean} [options.interactive=true]
     * @param {boolean} [options.flipped=false]
     * @param {Function} [options.onMove] – callback({from, to, promotion}) → boolean
     * @param {string}   [options.playerColor] – 'w' or 'b'; restricts which pieces the player may move
     */
    constructor(containerId, options = {}) {
      this.container = document.getElementById(containerId);
      if (!this.container) throw new Error(`Container #${containerId} not found`);

      this.interactive = options.interactive !== false;
      this.isFlipped = !!options.flipped;
      this.onMove = options.onMove || null;
      this.playerColor = options.playerColor || null; // null = both colours movable

      // State
      this._position = {}; // { 'e4': 'P', 'e5': 'p', … }
      this._selectedSquare = null;
      this._legalMoves = []; // list of algebraic destination squares for selected piece
      this._lastMoveFrom = null;
      this._lastMoveTo = null;

      // Drag state
      this._dragging = false;
      this._dragPieceEl = null;
      this._dragOriginSquare = null;
      this._dragGhost = null; // floating clone

      // DOM caches
      this._squareEls = {}; // algebraic → element
      this._boardEl = null;
      this._coordsFileEl = null;
      this._coordsRankEl = null;
      this._promotionOverlay = null;

      // Build
      this._injectStyles();
      this._buildBoard();
      if (this.interactive) this._bindEvents();

      // Responsive
      this._resizeObserver = new ResizeObserver(() => this.resize());
      this._resizeObserver.observe(this.container);
    }

    // ── Board construction ─────────────────────────────────────────────────

    _buildBoard() {
      this.container.classList.add('cb-container');
      this.container.innerHTML = '';

      // Wrapper (keeps board square)
      const wrapper = document.createElement('div');
      wrapper.className = 'cb-wrapper';
      this.container.appendChild(wrapper);

      // Board grid
      const board = document.createElement('div');
      board.className = 'cb-board';
      this._boardEl = board;
      wrapper.appendChild(board);

      // Create squares
      for (let r = 7; r >= 0; r--) {
        for (let f = 0; f < 8; f++) {
          const sq = indexToAlgebraic(f, r);
          const div = document.createElement('div');
          div.className = 'cb-square ' + ((f + r) % 2 === 0 ? 'cb-dark' : 'cb-light');
          div.dataset.square = sq;
          board.appendChild(div);
          this._squareEls[sq] = div;
        }
      }

      // Coordinates
      this._buildCoordinates(wrapper);

      // Apply orientation
      this._applyOrientation();
    }

    _buildCoordinates(wrapper) {
      // File labels (a-h along bottom)
      const fileBar = document.createElement('div');
      fileBar.className = 'cb-coords cb-coords-files';
      for (let f = 0; f < 8; f++) {
        const lbl = document.createElement('span');
        lbl.className = 'cb-coord';
        lbl.textContent = FILES[f];
        fileBar.appendChild(lbl);
      }
      this._coordsFileEl = fileBar;
      wrapper.appendChild(fileBar);

      // Rank labels (1-8 along left)
      const rankBar = document.createElement('div');
      rankBar.className = 'cb-coords cb-coords-ranks';
      for (let r = 7; r >= 0; r--) {
        const lbl = document.createElement('span');
        lbl.className = 'cb-coord';
        lbl.textContent = RANKS[r];
        rankBar.appendChild(lbl);
      }
      this._coordsRankEl = rankBar;
      wrapper.appendChild(rankBar);
    }

    _applyOrientation() {
      if (!this._boardEl) return;
      // Re-order squares inside the grid via CSS order
      for (let r = 7; r >= 0; r--) {
        for (let f = 0; f < 8; f++) {
          const sq = indexToAlgebraic(f, r);
          const el = this._squareEls[sq];
          let visualRow, visualCol;
          if (this.isFlipped) {
            visualRow = r;        // rank 1 at top
            visualCol = 7 - f;    // file h on left
          } else {
            visualRow = 7 - r;    // rank 8 at top
            visualCol = f;
          }
          el.style.order = visualRow * 8 + visualCol;
        }
      }

      // Update coordinate labels
      this._updateCoordLabels();
    }

    _updateCoordLabels() {
      // Files
      const fileLabels = this._coordsFileEl.querySelectorAll('.cb-coord');
      for (let i = 0; i < 8; i++) {
        fileLabels[i].textContent = this.isFlipped ? FILES[7 - i] : FILES[i];
      }
      // Ranks
      const rankLabels = this._coordsRankEl.querySelectorAll('.cb-coord');
      for (let i = 0; i < 8; i++) {
        const rankIdx = this.isFlipped ? i : 7 - i;
        rankLabels[i].textContent = RANKS[rankIdx];
      }
    }

    // ── Rendering ──────────────────────────────────────────────────────────

    /**
     * Parse a FEN string and render pieces on the board.
     */
    setPosition(fen) {
      this.clearBoard();
      const placement = fen.split(' ')[0];
      const rows = placement.split('/');
      for (let rowIdx = 0; rowIdx < 8; rowIdx++) {
        const rank = 7 - rowIdx; // FEN starts from rank 8
        let file = 0;
        for (const ch of rows[rowIdx]) {
          if (/\d/.test(ch)) {
            file += parseInt(ch, 10);
          } else {
            const sq = indexToAlgebraic(file, rank);
            this._position[sq] = ch;
            this._placePiece(sq, ch);
            file++;
          }
        }
      }
    }

    _placePiece(square, fenChar) {
      const el = this._squareEls[square];
      if (!el) return;
      // Remove existing piece img if any
      const existing = el.querySelector('.cb-piece');
      if (existing) existing.remove();

      const img = document.createElement('img');
      img.className = 'cb-piece';
      img.draggable = false; // we handle our own drag
      img.src = PIECE_CDN_BASE + pieceToFilename(fenChar) + '.svg';
      img.alt = fenChar;
      img.dataset.piece = fenChar;
      el.appendChild(img);
    }

    clearBoard() {
      this._position = {};
      for (const sq of Object.keys(this._squareEls)) {
        const piece = this._squareEls[sq].querySelector('.cb-piece');
        if (piece) piece.remove();
      }
    }

    // ── Highlights ─────────────────────────────────────────────────────────

    highlightSquare(square, className) {
      const el = this._squareEls[square];
      if (el) el.classList.add(className);
    }

    clearHighlights() {
      for (const sq of Object.keys(this._squareEls)) {
        const el = this._squareEls[sq];
        el.classList.remove(
          'cb-selected',
          'cb-last-move',
          'cb-highlight',
          'cb-check'
        );
        // Remove legal move indicators
        const dot = el.querySelector('.cb-legal-dot');
        if (dot) dot.remove();
        const ring = el.querySelector('.cb-legal-capture');
        if (ring) ring.remove();
      }
    }

    highlightLastMove(from, to) {
      // Clear previous last-move highlights only
      for (const sq of Object.keys(this._squareEls)) {
        this._squareEls[sq].classList.remove('cb-last-move');
      }
      this._lastMoveFrom = from;
      this._lastMoveTo = to;
      if (from) this.highlightSquare(from, 'cb-last-move');
      if (to) this.highlightSquare(to, 'cb-last-move');
    }

    _showLegalMoves(square, moves) {
      // `moves` is an array of algebraic destination squares
      for (const dest of moves) {
        const el = this._squareEls[dest];
        if (!el) continue;
        const isCapture = !!this._position[dest];
        if (isCapture) {
          const ring = document.createElement('div');
          ring.className = 'cb-legal-capture';
          el.appendChild(ring);
        } else {
          const dot = document.createElement('div');
          dot.className = 'cb-legal-dot';
          el.appendChild(dot);
        }
      }
    }

    _clearLegalMoveIndicators() {
      for (const sq of Object.keys(this._squareEls)) {
        const el = this._squareEls[sq];
        const dot = el.querySelector('.cb-legal-dot');
        if (dot) dot.remove();
        const ring = el.querySelector('.cb-legal-capture');
        if (ring) ring.remove();
      }
    }

    // ── Interaction ────────────────────────────────────────────────────────

    _bindEvents() {
      // We bind at the board level and delegate
      this._boardEl.addEventListener('mousedown', (e) => this._onPointerDown(e), false);
      this._boardEl.addEventListener('touchstart', (e) => this._onPointerDown(e), { passive: false });

      // Move & up on window so drag works outside the board
      window.addEventListener('mousemove', (e) => this._onPointerMove(e), false);
      window.addEventListener('touchmove', (e) => this._onPointerMove(e), { passive: false });

      window.addEventListener('mouseup', (e) => this._onPointerUp(e), false);
      window.addEventListener('touchend', (e) => this._onPointerUp(e), false);
      window.addEventListener('touchcancel', (e) => this._onPointerUp(e), false);
    }

    _onPointerDown(e) {
      if (!this.interactive) return;

      const squareEl = e.target.closest('.cb-square');
      if (!squareEl) return;

      const sq = squareEl.dataset.square;
      const piece = this._position[sq];

      // Prevent scroll on touch
      if (e.type === 'touchstart') e.preventDefault();

      // If a piece is already selected
      if (this._selectedSquare) {
        // Clicking a legal destination → move
        if (this._legalMoves.includes(sq)) {
          this._executeMove(this._selectedSquare, sq);
          return;
        }
        // Clicking another of your own pieces → re-select
        if (piece && this._isOwnPiece(piece)) {
          this._deselect();
          this._select(sq, piece, e);
          return;
        }
        // Otherwise deselect
        this._deselect();
        return;
      }

      // No selection yet – select if it's our piece
      if (piece && this._isOwnPiece(piece)) {
        this._select(sq, piece, e);
      }
    }

    _isOwnPiece(fenChar) {
      if (!this.playerColor) return true; // both sides movable
      const pieceColor = fenChar === fenChar.toUpperCase() ? 'w' : 'b';
      return pieceColor === this.playerColor;
    }

    _select(sq, piece, startEvent) {
      this._selectedSquare = sq;
      this._clearLegalMoveIndicators();
      this.highlightSquare(sq, 'cb-selected');

      // Get legal moves from chess.js via a temporary game
      this._legalMoves = this._getLegalMovesFor(sq);
      this._showLegalMoves(sq, this._legalMoves);

      // Begin drag
      if (startEvent) {
        this._startDrag(sq, startEvent);
      }
    }

    _deselect() {
      if (this._selectedSquare) {
        this._squareEls[this._selectedSquare].classList.remove('cb-selected');
      }
      this._selectedSquare = null;
      this._legalMoves = [];
      this._clearLegalMoveIndicators();
      this._cancelDrag();
    }

    _getLegalMovesFor(square) {
      // Use chess.js instance if available via global or build one from position
      // We look for window._chessBoardGetMoves which should be set by the game controller
      if (typeof window._chessBoardGetMoves === 'function') {
        return window._chessBoardGetMoves(square);
      }
      // Fallback: try to construct from Chess if available
      if (typeof Chess !== 'undefined') {
        try {
          const fen = this._buildFen();
          if (!fen) return [];
          const game = new Chess(fen);
          const moves = game.moves({ square, verbose: true });
          return moves.map((m) => m.to);
        } catch (e) {
          return [];
        }
      }
      return [];
    }

    /** Build a rough FEN from current _position – only placement, rest defaults. */
    _buildFen() {
      // This is a fallback; the game controller should set _chessBoardGetMoves
      let fen = '';
      for (let r = 7; r >= 0; r--) {
        let empty = 0;
        for (let f = 0; f < 8; f++) {
          const sq = indexToAlgebraic(f, r);
          const p = this._position[sq];
          if (p) {
            if (empty) { fen += empty; empty = 0; }
            fen += p;
          } else {
            empty++;
          }
        }
        if (empty) fen += empty;
        if (r > 0) fen += '/';
      }
      return fen + ' w KQkq - 0 1'; // assume white to move; fallback only
    }

    // ── Drag and Drop ──────────────────────────────────────────────────────

    _startDrag(sq, e) {
      const squareEl = this._squareEls[sq];
      const pieceEl = squareEl.querySelector('.cb-piece');
      if (!pieceEl) return;

      this._dragging = true;
      this._dragOriginSquare = sq;
      this._dragPieceEl = pieceEl;

      // Hide original piece
      pieceEl.style.opacity = '0';

      // Create ghost
      const ghost = pieceEl.cloneNode(true);
      ghost.className = 'cb-drag-ghost';
      ghost.style.opacity = '1';
      const rect = this._boardEl.getBoundingClientRect();
      const squareSize = rect.width / 8;
      ghost.style.width = squareSize + 'px';
      ghost.style.height = squareSize + 'px';
      document.body.appendChild(ghost);
      this._dragGhost = ghost;

      // Position ghost at pointer
      const pos = pointerPos(e);
      ghost.style.left = (pos.x - squareSize / 2) + 'px';
      ghost.style.top = (pos.y - squareSize / 2) + 'px';
    }

    _onPointerMove(e) {
      if (!this._dragging || !this._dragGhost) return;
      if (e.type === 'touchmove') e.preventDefault();

      const pos = pointerPos(e);
      const rect = this._boardEl.getBoundingClientRect();
      const squareSize = rect.width / 8;
      this._dragGhost.style.left = (pos.x - squareSize / 2) + 'px';
      this._dragGhost.style.top = (pos.y - squareSize / 2) + 'px';
    }

    _onPointerUp(e) {
      if (!this._dragging) return;

      const pos = pointerPos(e);
      const targetSq = this._squareFromPoint(pos.x, pos.y);

      // Snap back the original piece visibility
      if (this._dragPieceEl) {
        this._dragPieceEl.style.opacity = '1';
      }

      // Remove ghost
      if (this._dragGhost) {
        this._dragGhost.remove();
        this._dragGhost = null;
      }

      const origin = this._dragOriginSquare;
      this._dragging = false;
      this._dragPieceEl = null;
      this._dragOriginSquare = null;

      // If dropped on a valid legal square (and not same square), execute move
      if (targetSq && targetSq !== origin && this._legalMoves.includes(targetSq)) {
        this._executeMove(origin, targetSq);
      }
      // If dropped on same square or invalid, the tap-select state remains
    }

    _cancelDrag() {
      if (this._dragPieceEl) {
        this._dragPieceEl.style.opacity = '1';
      }
      if (this._dragGhost) {
        this._dragGhost.remove();
        this._dragGhost = null;
      }
      this._dragging = false;
      this._dragPieceEl = null;
      this._dragOriginSquare = null;
    }

    /** Determine which square is under a screen point. */
    _squareFromPoint(x, y) {
      const rect = this._boardEl.getBoundingClientRect();
      const relX = x - rect.left;
      const relY = y - rect.top;
      const squareSize = rect.width / 8;
      let col = Math.floor(relX / squareSize);
      let row = Math.floor(relY / squareSize);
      if (col < 0 || col > 7 || row < 0 || row > 7) return null;

      let fileIdx, rankIdx;
      if (this.isFlipped) {
        fileIdx = 7 - col;
        rankIdx = row;
      } else {
        fileIdx = col;
        rankIdx = 7 - row;
      }
      return indexToAlgebraic(fileIdx, rankIdx);
    }

    // ── Move execution ─────────────────────────────────────────────────────

    async _executeMove(from, to) {
      this._deselect();

      // Check promotion
      const piece = this._position[from];
      let promotion = undefined;
      if (piece && piece.toLowerCase() === 'p') {
        const destRank = to[1];
        if (destRank === '8' || destRank === '1') {
          const color = piece === piece.toUpperCase() ? 'w' : 'b';
          promotion = await this.showPromotionDialog(to, color);
          if (!promotion) return; // cancelled
        }
      }

      const moveData = { from, to };
      if (promotion) moveData.promotion = promotion;

      if (this.onMove) {
        const accepted = this.onMove(moveData);
        if (accepted === false) return; // illegal / rejected
      }

      // If accepted, the game controller will call setPosition with the new FEN
      // and highlightLastMove. We don't update position ourselves here.
    }

    // ── Move Animation ─────────────────────────────────────────────────────

    /**
     * Animate a piece sliding from one square to another.
     * Resolves once the animation is done.
     */
    animateMove(from, to) {
      return new Promise((resolve) => {
        const fromEl = this._squareEls[from];
        const toEl = this._squareEls[to];
        const pieceEl = fromEl ? fromEl.querySelector('.cb-piece') : null;

        if (!fromEl || !toEl || !pieceEl) {
          resolve();
          return;
        }

        const fromRect = fromEl.getBoundingClientRect();
        const toRect = toEl.getBoundingClientRect();

        const dx = toRect.left - fromRect.left;
        const dy = toRect.top - fromRect.top;

        pieceEl.style.transition = 'transform 150ms ease-in-out';
        pieceEl.style.transform = `translate(${dx}px, ${dy}px)`;
        pieceEl.style.zIndex = '100';

        const onEnd = () => {
          pieceEl.removeEventListener('transitionend', onEnd);
          pieceEl.style.transition = '';
          pieceEl.style.transform = '';
          pieceEl.style.zIndex = '';
          resolve();
        };
        pieceEl.addEventListener('transitionend', onEnd);

        // Safety fallback in case transitionend doesn't fire
        setTimeout(onEnd, 200);
      });
    }

    // ── Promotion Dialog ───────────────────────────────────────────────────

    /**
     * Show promotion piece selector above the promotion square.
     * @param {string} square – algebraic square where promotion happens
     * @param {string} color – 'w' or 'b'
     * @returns {Promise<string|null>} – chosen piece letter (q/r/b/n) or null if cancelled
     */
    showPromotionDialog(square, color) {
      return new Promise((resolve) => {
        // Remove any existing dialog
        this._removePromotionDialog();

        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'cb-promotion-overlay';
        this._promotionOverlay = overlay;

        // Click on overlay background → cancel
        overlay.addEventListener('mousedown', (e) => {
          if (e.target === overlay) {
            this._removePromotionDialog();
            resolve(null);
          }
        });

        // Build the picker column
        const picker = document.createElement('div');
        picker.className = 'cb-promotion-picker';

        // Position picker over the promotion square
        const squareEl = this._squareEls[square];
        if (squareEl) {
          const boardRect = this._boardEl.getBoundingClientRect();
          const sqRect = squareEl.getBoundingClientRect();
          const left = sqRect.left - boardRect.left;
          picker.style.left = left + 'px';
          // If white promotes (rank 8) picker drops down; if black promotes (rank 1) picker goes up
          if ((color === 'w' && !this.isFlipped) || (color === 'b' && this.isFlipped)) {
            picker.style.top = '0';
          } else {
            picker.style.bottom = '0';
          }
        }

        const pieces = PROMOTION_PIECES; // q, r, b, n
        for (const p of pieces) {
          const btn = document.createElement('div');
          btn.className = 'cb-promotion-piece';
          const fenChar = color === 'w' ? p.toUpperCase() : p.toLowerCase();
          const img = document.createElement('img');
          img.src = PIECE_CDN_BASE + pieceToFilename(fenChar) + '.svg';
          img.alt = p;
          img.draggable = false;
          btn.appendChild(img);
          btn.addEventListener('click', () => {
            this._removePromotionDialog();
            resolve(p);
          });
          picker.appendChild(btn);
        }

        overlay.appendChild(picker);
        this._boardEl.appendChild(overlay);
      });
    }

    _removePromotionDialog() {
      if (this._promotionOverlay) {
        this._promotionOverlay.remove();
        this._promotionOverlay = null;
      }
    }

    // ── Orientation ────────────────────────────────────────────────────────

    flipBoard() {
      this.isFlipped = !this.isFlipped;
      this._applyOrientation();
    }

    // ── Utility ────────────────────────────────────────────────────────────

    getSquareElement(square) {
      return this._squareEls[square] || null;
    }

    squareFromElement(el) {
      const sq = el.closest('.cb-square');
      return sq ? sq.dataset.square : null;
    }

    resize() {
      // The board is CSS-driven (aspect-ratio / vw), so we just
      // need to update the drag ghost size if mid-drag.
      // Also dispatch a custom event for external listeners.
      this.container.dispatchEvent(new CustomEvent('board-resize'));
    }

    destroy() {
      if (this._resizeObserver) this._resizeObserver.disconnect();
      this.container.innerHTML = '';
    }

    // ── Inject Scoped Styles ───────────────────────────────────────────────

    _injectStyles() {
      if (document.getElementById('cb-styles')) return;
      const style = document.createElement('style');
      style.id = 'cb-styles';
      style.textContent = `
/* ── Board Container ─────────────────────────────────── */
.cb-container {
  display: flex;
  justify-content: center;
  align-items: center;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}
.cb-wrapper {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: 1fr auto;
  width: 100%;
  max-width: min(90vw, 90vh, 560px);
}

/* ── Board Grid ──────────────────────────────────────── */
.cb-board {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  flex-wrap: wrap;
  position: relative;
  aspect-ratio: 1 / 1;
  width: 100%;
  border-radius: 3px;
  overflow: hidden;
}
.cb-square {
  width: 12.5%;
  height: 12.5%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  box-sizing: border-box;
}
.cb-light { background-color: #eeeed2; }
.cb-dark  { background-color: #769656; }

/* ── Pieces ──────────────────────────────────────────── */
.cb-piece {
  width: 90%;
  height: 90%;
  object-fit: contain;
  pointer-events: none;
  position: relative;
  z-index: 2;
  image-rendering: auto;
  /* Retina: SVGs scale cleanly by default */
}

/* ── Highlights ──────────────────────────────────────── */
.cb-selected {
  background-color: rgba(255, 255, 0, 0.5) !important;
}
.cb-last-move {
  background-color: rgba(255, 255, 0, 0.2) !important;
}
.cb-last-move.cb-selected {
  background-color: rgba(255, 255, 0, 0.5) !important;
}
.cb-check {
  background: radial-gradient(ellipse at center, rgba(255,0,0,0.6) 0%, rgba(255,0,0,0) 70%) !important;
}

/* ── Legal Move Indicators ───────────────────────────── */
.cb-legal-dot {
  position: absolute;
  width: 28%;
  height: 28%;
  border-radius: 50%;
  background-color: rgba(0, 0, 0, 0.12);
  z-index: 3;
  pointer-events: none;
}
.cb-legal-capture {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 6px solid rgba(0, 0, 0, 0.12);
  box-sizing: border-box;
  z-index: 3;
  pointer-events: none;
}

/* ── Coordinates ─────────────────────────────────────── */
.cb-coords {
  display: flex;
  pointer-events: none;
}
.cb-coords-files {
  grid-column: 2;
  grid-row: 2;
  flex-direction: row;
  padding-top: 2px;
}
.cb-coords-files .cb-coord {
  flex: 1;
  text-align: center;
}
.cb-coords-ranks {
  grid-column: 1;
  grid-row: 1;
  flex-direction: column;
  padding-right: 4px;
  align-items: flex-end;
  justify-content: space-around;
}
.cb-coord {
  font-size: 11px;
  font-family: system-ui, -apple-system, sans-serif;
  color: #bababa;
  line-height: 1;
}

/* ── Drag Ghost ──────────────────────────────────────── */
.cb-drag-ghost {
  position: fixed;
  pointer-events: none;
  z-index: 10000;
  object-fit: contain;
  opacity: 0.9;
  filter: drop-shadow(0 4px 8px rgba(0,0,0,0.4));
}

/* ── Promotion Dialog ────────────────────────────────── */
.cb-promotion-overlay {
  position: absolute;
  inset: 0;
  z-index: 500;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
}
.cb-promotion-picker {
  position: absolute;
  display: flex;
  flex-direction: column;
  width: 12.5%;
  z-index: 501;
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
  border-radius: 4px;
  overflow: hidden;
}
.cb-promotion-piece {
  width: 100%;
  aspect-ratio: 1 / 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f0f0f0;
  cursor: pointer;
  transition: background 0.15s;
}
.cb-promotion-piece:hover {
  background: #d4d4d4;
}
.cb-promotion-piece img {
  width: 85%;
  height: 85%;
  object-fit: contain;
  pointer-events: none;
}
`;
      document.head.appendChild(style);
    }
  }

  // Expose globally
  window.ChessBoard = ChessBoard;
})();
