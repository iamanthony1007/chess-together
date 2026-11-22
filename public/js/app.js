/**
 * Chess Together - Main Application Controller
 * Handles SPA navigation, real-time multiplayer, WebRTC calls,
 * collaborative puzzles, interactive lessons, timers, chat, and audio.
 */

(function () {
  'use strict';

  // ── Web Audio Sound Effects ────────────────────────────────────────────────
  const AudioEngine = {
    ctx: null,

    init() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    },

    playTone(freq, type, duration, gainVal = 0.15) {
      try {
        this.init();
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + duration);
      } catch (e) {
        // Audio might be blocked before first user gesture
      }
    },

    playMove() {
      // Crisp subtle wood-like tap
      this.playTone(280, 'sine', 0.08, 0.2);
    },

    playCapture() {
      // Snappy two-tone capture sound
      this.playTone(420, 'triangle', 0.12, 0.25);
    },

    playCheck() {
      // Warning alert tone
      this.playTone(600, 'sine', 0.15, 0.2);
      setTimeout(() => this.playTone(750, 'sine', 0.2, 0.25), 100);
    },

    playSuccess() {
      // Ascending triumphant chime
      const notes = [440, 554.37, 659.25, 880];
      notes.forEach((freq, idx) => {
        setTimeout(() => this.playTone(freq, 'sine', 0.18, 0.2), idx * 80);
      });
    },

    playError() {
      // Soft buzz for wrong puzzle move
      this.playTone(180, 'sawtooth', 0.2, 0.15);
    }
  };

  // ── DOM Helper ─────────────────────────────────────────────────────────────
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);

  // ── Application State ──────────────────────────────────────────────────────
  const State = {
    socket: null,
    currentRoomId: null,
    currentRoomCode: null,
    playerColor: 'w', // 'w' or 'b'
    opponentConnected: false,
    rtcManager: null,

    // Game
    chess: null,
    gameBoard: null,
    gameActive: false,
    playerTime: 600, // 10 minutes in seconds
    opponentTime: 600,
    timerInterval: null,
    activeTurn: 'w',

    // Puzzles
    puzzleBoard: null,
    currentPuzzle: null,
    puzzleIndex: 0,
    puzzleMoveIndex: 0,
    puzzleCorrectCount: 0,
    puzzleIncorrectCount: 0,
    puzzleStreak: 0,
    puzzleGame: null,

    // Lessons
    lessonBoard: null,
    currentLessonId: null,
    currentLessonStepIdx: 0,
    lessonGame: null
  };

  // ── Initializer ────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initSocket();
    initGameControls();
    initPuzzles();
    initLessons();
    initChat();
    initModals();

    // Dismiss initial loading screen
    setTimeout(() => {
      const loader = $('#loading-screen');
      if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => loader.classList.add('hidden'), 350);
      }
    }, 400);

    // Enable audio on first user touch/click anywhere
    document.addEventListener('pointerdown', () => AudioEngine.init(), { once: true });
  });

  // ── 1. SPA View Navigation ─────────────────────────────────────────────────
  function initNavigation() {
    // Bottom nav buttons
    $$('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetView = btn.dataset.view;
        if (targetView) switchView(targetView);
      });
    });

    // Home quick links
    $$('.quick-link-card').forEach((card) => {
      card.addEventListener('click', () => {
        const targetView = card.dataset.view;
        if (targetView) switchView(targetView);
      });
    });

    // Back to home button in game view
    const btnBackHome = $('#btn-back-home');
    if (btnBackHome) {
      btnBackHome.addEventListener('click', () => switchView('home-view'));
    }
  }

  function switchView(viewId) {
    // Hide all views
    $$('.view').forEach((v) => v.classList.remove('active'));

    // Show target view
    const target = $(`#${viewId}`);
    if (target) {
      target.classList.add('active');
    }

    // Update bottom nav
    $$('.nav-btn').forEach((btn) => {
      if (btn.dataset.view === viewId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Adjust active board size on view change
    setTimeout(() => {
      if (viewId === 'game-view' && State.gameBoard) State.gameBoard.resize();
      if (viewId === 'puzzles-view' && State.puzzleBoard) State.puzzleBoard.resize();
      if (viewId === 'lessons-view' && State.lessonBoard) State.lessonBoard.resize();
    }, 100);
  }

  // ── 2. Toast Notifications ─────────────────────────────────────────────────
  function showToast(message, type = 'info', duration = 3000) {
    const container = $('#toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-text">${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ── 3. Socket.IO Connection & Events ───────────────────────────────────────
  function initSocket() {
    try {
      State.socket = io({
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000
      });
    } catch (err) {
      console.warn('Socket.IO connection error:', err);
      return;
    }

    const socket = State.socket;
    const statusEl = $('#connection-status');
    const onlineCountEl = $('#online-count');

    socket.on('connect', () => {
      if (statusEl) {
        statusEl.className = 'connection-status connected';
        const txt = statusEl.querySelector('.status-text');
        if (txt) txt.textContent = 'Connected';
      }
      if (onlineCountEl) {
        onlineCountEl.textContent = Math.floor(Math.random() * 20) + 12;
      }
    });

    socket.on('disconnect', () => {
      if (statusEl) {
        statusEl.className = 'connection-status disconnected';
        const txt = statusEl.querySelector('.status-text');
        if (txt) txt.textContent = 'Reconnecting...';
      }
    });

    // Room created handler
    socket.on('room-created', ({ roomId, code }) => {
      State.currentRoomId = roomId;
      State.currentRoomCode = code;

      // Update room code displays
      const codeDisplays = [$('#room-code-text'), $('#modal-room-code')];
      codeDisplays.forEach((el) => {
        if (el) el.textContent = code;
      });

      // Show room created modal
      showModal('modal-room-created');
    });

    // Room joined handler (both players receive this when ready)
    socket.on('room-joined', ({ roomId, color }) => {
      State.currentRoomId = roomId;
      State.playerColor = color; // 'w' or 'b'
      State.opponentConnected = true;

      hideModal();
      switchView('game-view');

      // Update UI player labels
      const pName = $('#player-name');
      const oName = $('#opponent-name');
      if (pName) pName.textContent = color === 'w' ? 'You (White)' : 'You (Black)';
      if (oName) oName.textContent = color === 'w' ? 'Opponent (Black)' : 'Opponent (White)';

      showToast(`Game started! You play as ${color === 'w' ? 'White' : 'Black'}.`, 'success');

      startNewChessGame(color === 'b');
      startTimers();
    });

    socket.on('join-error', (err) => {
      showToast(err.error || 'Failed to join room', 'error');
    });

    socket.on('opponent-disconnected', () => {
      State.opponentConnected = false;
      showToast('Opponent disconnected', 'warning');
      const statusText = $('#game-status-text');
      if (statusText) statusText.textContent = 'Opponent disconnected.';
      pauseTimers();
    });

    // Receive opponent move
    socket.on('move', ({ move }) => {
      handleRemoteMove(move);
    });

    // Receive collaborative puzzle sync
    socket.on('puzzle-sync', ({ puzzleId }) => {
      const p = (window.PUZZLES_DB || []).find((x) => x.id === puzzleId);
      if (p) {
        loadPuzzle(p, false);
        const partnerInd = $('#puzzle-partner-indicator');
        if (partnerInd) partnerInd.classList.remove('hidden');
        showToast('Partner opened a puzzle!', 'info');
      }
    });

    // Receive partner's puzzle move
    socket.on('puzzle-move', ({ move, puzzleId }) => {
      handleRemotePuzzleMove(move, puzzleId);
    });

    // Chat messages
    socket.on('chat', ({ message, sender }) => {
      appendChatMessage(sender || 'Opponent', message, false);
      const badge = $('#chat-badge');
      const panel = $('#chat-panel');
      if (panel && panel.classList.contains('hidden') && badge) {
        badge.classList.remove('hidden');
        badge.textContent = (parseInt(badge.textContent || '0', 10) + 1).toString();
      }
    });

    // Draw offer from opponent
    socket.on('draw-offer', () => {
      showModal('modal-draw-offer');
    });

    socket.on('draw-accepted', () => {
      endGame('Draw agreed by mutual consent.', 'draw');
    });

    socket.on('draw-declined', () => {
      showToast('Opponent declined the draw offer.', 'info');
    });

    socket.on('opponent-resigned', () => {
      endGame('Opponent resigned. You win!', 'win');
    });
  }

  // ── 4. Main Chess Game Logic ───────────────────────────────────────────────
  function initGameControls() {
    // "Play with a Friend" (Create Room)
    const btnCreate = $('#btn-create-room');
    if (btnCreate) {
      btnCreate.addEventListener('click', () => {
        if (!State.socket || !State.socket.connected) {
          showToast('Connecting to server...', 'info');
          return;
        }
        State.socket.emit('create-room');
      });
    }

    // "Join Game"
    const btnJoin = $('#btn-join-room');
    const inputJoin = $('#join-code-input');
    if (btnJoin && inputJoin) {
      const doJoin = () => {
        const code = inputJoin.value.trim().toUpperCase();
        if (!code) {
          showToast('Please enter a 6-letter room code', 'warning');
          return;
        }
        if (!State.socket || !State.socket.connected) {
          showToast('Not connected to server', 'error');
          return;
        }
        State.socket.emit('join-room', { code });
      };

      btnJoin.addEventListener('click', doJoin);
      inputJoin.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doJoin();
      });
    }

    // Copy Code Buttons
    const copyBtns = [$('#btn-copy-code'), $('#modal-copy-code')];
    copyBtns.forEach((btn) => {
      if (btn) {
        btn.addEventListener('click', () => {
          const code = State.currentRoomCode || $('#room-code-text')?.textContent;
          if (code && code !== '------') {
            navigator.clipboard.writeText(code).then(() => {
              showToast(`Room code ${code} copied!`, 'success');
            }).catch(() => {
              showToast(`Room code: ${code}`, 'info');
            });
          }
        });
      }
    });

    // Flip board button
    const btnFlip = $('#btn-flip-board');
    if (btnFlip) {
      btnFlip.addEventListener('click', () => {
        if (State.gameBoard) State.gameBoard.flipBoard();
      });
    }

    // Offer Draw
    const btnDraw = $('#btn-offer-draw');
    if (btnDraw) {
      btnDraw.addEventListener('click', () => {
        if (!State.currentRoomId || !State.gameActive) {
          showToast('No active multiplayer game', 'info');
          return;
        }
        State.socket.emit('draw-offer', { roomId: State.currentRoomId });
        showToast('Draw offer sent to opponent', 'info');
      });
    }

    // Resign
    const btnResign = $('#btn-resign');
    if (btnResign) {
      btnResign.addEventListener('click', () => {
        showModal('modal-resign-confirm');
      });
    }

    const btnConfirmResign = $('#btn-confirm-resign');
    if (btnConfirmResign) {
      btnConfirmResign.addEventListener('click', () => {
        hideModal();
        if (State.currentRoomId && State.socket) {
          State.socket.emit('resign', { roomId: State.currentRoomId });
        }
        endGame('You resigned. Opponent wins.', 'loss');
      });
    }

    const btnCancelResign = $('#btn-cancel-resign');
    if (btnCancelResign) {
      btnCancelResign.addEventListener('click', hideModal);
    }

    // Draw offer response modals
    const btnAcceptDraw = $('#btn-accept-draw');
    if (btnAcceptDraw) {
      btnAcceptDraw.addEventListener('click', () => {
        hideModal();
        if (State.currentRoomId && State.socket) {
          State.socket.emit('draw-accepted', { roomId: State.currentRoomId });
        }
        endGame('Draw agreed by mutual consent.', 'draw');
      });
    }

    const btnDeclineDraw = $('#btn-decline-draw');
    if (btnDeclineDraw) {
      btnDeclineDraw.addEventListener('click', () => {
        hideModal();
        if (State.currentRoomId && State.socket) {
          State.socket.emit('draw-declined', { roomId: State.currentRoomId });
        }
        showToast('You declined the draw offer.', 'info');
      });
    }

    // WebRTC Call Button
    const btnCall = $('#btn-call');
    if (btnCall) {
      btnCall.addEventListener('click', async () => {
        if (!State.currentRoomId) {
          showToast('Join a room first to start a voice/video call!', 'warning');
          return;
        }

        if (!State.rtcManager) {
          State.rtcManager = new window.WebRTCManager(State.socket, State.currentRoomId);
        }

        try {
          showToast('Starting video/voice call...', 'info');
          await State.rtcManager.startCall(true);
        } catch (err) {
          showToast('Could not access microphone/camera', 'error');
        }
      });
    }
  }

  function startNewChessGame(flipBoard = false) {
    if (typeof Chess === 'undefined') {
      console.error('chess.js library not loaded!');
      return;
    }

    State.chess = new Chess();
    State.gameActive = true;
    State.activeTurn = 'w';
    State.playerTime = 600;
    State.opponentTime = 600;
    updateTimerDisplays();

    // Clear move list
    const moveList = $('#move-list');
    if (moveList) moveList.innerHTML = '';

    // Provider for ChessBoard legal move dots
    window._chessBoardGetMoves = function (square) {
      if (!State.gameActive || !State.chess) return [];
      // Restrict moves to the player's turn and color
      if (State.chess.turn() !== State.playerColor) return [];
      const moves = State.chess.moves({ square, verbose: true });
      return moves.map((m) => m.to);
    };

    // Instantiate or re-position board
    if (!State.gameBoard) {
      State.gameBoard = new window.ChessBoard('chess-board', {
        interactive: true,
        flipped: flipBoard,
        playerColor: State.playerColor,
        onMove: onLocalGameMove
      });
    } else {
      State.gameBoard.playerColor = State.playerColor;
      if (flipBoard !== State.gameBoard.isFlipped) {
        State.gameBoard.flipBoard();
      }
    }

    State.gameBoard.setPosition(State.chess.fen());
    State.gameBoard.clearHighlights();

    updateGameStatus();
  }

  function onLocalGameMove({ from, to, promotion }) {
    if (!State.gameActive || !State.chess) return false;
    if (State.chess.turn() !== State.playerColor) {
      showToast("It's not your turn!", 'info');
      return false;
    }

    // Try making the move in chess.js
    const move = State.chess.move({ from, to, promotion: promotion || 'q' });
    if (!move) return false;

    // Legal move executed!
    State.gameBoard.setPosition(State.chess.fen());
    State.gameBoard.highlightLastMove(from, to);

    // Audio feedback
    if (move.captured) {
      AudioEngine.playCapture();
    } else {
      AudioEngine.playMove();
    }
    if (State.chess.in_check()) {
      AudioEngine.playCheck();
    }

    // Append move to history
    appendMoveHistory(move);
    updateCapturedPieces();

    // Relay to opponent via socket
    if (State.currentRoomId && State.socket) {
      State.socket.emit('move', {
        roomId: State.currentRoomId,
        move: { from, to, promotion: promotion || 'q' }
      });
    }

    // Check game condition
    checkGameOver();
    updateGameStatus();

    return true;
  }

  function handleRemoteMove(moveData) {
    if (!State.chess || !State.gameBoard) return;

    const move = State.chess.move({
      from: moveData.from,
      to: moveData.to,
      promotion: moveData.promotion || 'q'
    });

    if (move) {
      State.gameBoard.setPosition(State.chess.fen());
      State.gameBoard.highlightLastMove(move.from, move.to);

      if (move.captured) {
        AudioEngine.playCapture();
      } else {
        AudioEngine.playMove();
      }
      if (State.chess.in_check()) {
        AudioEngine.playCheck();
      }

      appendMoveHistory(move);
      updateCapturedPieces();
      checkGameOver();
      updateGameStatus();
    }
  }

  function appendMoveHistory(move) {
    const moveList = $('#move-list');
    if (!moveList) return;

    const history = State.chess.history();
    const moveNum = Math.ceil(history.length / 2);

    if (move.color === 'w') {
      const pair = document.createElement('div');
      pair.className = 'move-pair';
      pair.dataset.num = moveNum;
      pair.innerHTML = `
        <span class="move-number">${moveNum}.</span>
        <span class="move white-move">${move.san}</span>
        <span class="move black-move"></span>
      `;
      moveList.appendChild(pair);
    } else {
      const pair = moveList.querySelector(`.move-pair[data-num="${moveNum}"]`);
      if (pair) {
        const blackSpan = pair.querySelector('.black-move');
        if (blackSpan) blackSpan.textContent = move.san;
      }
    }

    moveList.scrollTop = moveList.scrollHeight;
  }

  function updateCapturedPieces() {
    if (!State.chess) return;
    const history = State.chess.history({ verbose: true });
    const whiteCaptured = [];
    const blackCaptured = [];

    history.forEach((m) => {
      if (m.captured) {
        if (m.color === 'w') {
          // White captured black piece
          whiteCaptured.push(m.captured);
        } else {
          // Black captured white piece
          blackCaptured.push(m.captured);
        }
      }
    });

    const renderCaptures = (container, pieces, color) => {
      if (!container) return;
      container.innerHTML = pieces
        .map((p) => {
          const filename = (color === 'w' ? 'b' : 'w') + p.toUpperCase();
          return `<img src="https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/piece/cburnett/${filename}.svg" class="captured-piece-img" alt="${p}">`;
        })
        .join('');
    };

    const isSelfWhite = State.playerColor === 'w';
    renderCaptures(
      $('#player-captured'),
      isSelfWhite ? whiteCaptured : blackCaptured,
      State.playerColor
    );
    renderCaptures(
      $('#opponent-captured'),
      isSelfWhite ? blackCaptured : whiteCaptured,
      State.playerColor === 'w' ? 'b' : 'w'
    );
  }

  function updateGameStatus() {
    const statusText = $('#game-status-text');
    if (!statusText || !State.chess) return;

    const turn = State.chess.turn() === 'w' ? 'White' : 'Black';
    const isYourTurn = State.chess.turn() === State.playerColor;

    if (State.chess.in_checkmate()) {
      statusText.textContent = `Checkmate! ${turn === 'White' ? 'Black' : 'White'} wins!`;
    } else if (State.chess.in_draw()) {
      statusText.textContent = 'Game drawn.';
    } else if (State.chess.in_check()) {
      statusText.textContent = `${turn} is in check! ${isYourTurn ? '(Your turn)' : "(Opponent's turn)"}`;
    } else {
      statusText.textContent = isYourTurn ? 'Your turn to move.' : "Opponent's turn to move.";
    }
  }

  function checkGameOver() {
    if (!State.chess) return;

    if (State.chess.in_checkmate()) {
      const winner = State.chess.turn() === 'w' ? 'Black' : 'White';
      const youWon = (winner === 'White' && State.playerColor === 'w') ||
                     (winner === 'Black' && State.playerColor === 'b');
      endGame(`Checkmate! ${winner} wins.`, youWon ? 'win' : 'loss');
    } else if (State.chess.in_draw()) {
      let detail = 'Stalemate';
      if (State.chess.in_threefold_repetition()) detail = 'Threefold repetition';
      if (State.chess.insufficient_material()) detail = 'Insufficient material';
      endGame(`Draw by ${detail}.`, 'draw');
    }
  }

  function endGame(message, outcome) {
    State.gameActive = false;
    pauseTimers();

    if (outcome === 'win') AudioEngine.playSuccess();
    else if (outcome === 'loss') AudioEngine.playError();

    const titleEl = $('#gameover-title');
    const msgEl = $('#gameover-message');
    if (titleEl) titleEl.textContent = outcome === 'win' ? 'Victory!' : outcome === 'loss' ? 'Defeat' : 'Game Drawn';
    if (msgEl) msgEl.textContent = message;

    showModal('modal-game-over');
  }

  // ── Timers ─────────────────────────────────────────────────────────────────
  function startTimers() {
    pauseTimers();
    State.timerInterval = setInterval(() => {
      if (!State.gameActive || !State.chess) return;

      const isWhiteTurn = State.chess.turn() === 'w';
      const isPlayerTurn = State.chess.turn() === State.playerColor;

      if (isPlayerTurn) {
        State.playerTime = Math.max(0, State.playerTime - 1);
        if (State.playerTime === 0) {
          endGame('Time out! You ran out of time.', 'loss');
        }
      } else {
        State.opponentTime = Math.max(0, State.opponentTime - 1);
        if (State.opponentTime === 0) {
          endGame('Opponent ran out of time! You win.', 'win');
        }
      }

      updateTimerDisplays();
    }, 1000);
  }

  function pauseTimers() {
    if (State.timerInterval) {
      clearInterval(State.timerInterval);
      State.timerInterval = null;
    }
  }

  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  function updateTimerDisplays() {
    const pTimer = $('#player-timer .timer-display');
    const oTimer = $('#opponent-timer .timer-display');
    if (pTimer) pTimer.textContent = formatTime(State.playerTime);
    if (oTimer) oTimer.textContent = formatTime(State.opponentTime);
  }

  // ── 5. Collaborative Puzzles ───────────────────────────────────────────────
  function initPuzzles() {
    // Buttons
    const btnHint = $('#btn-puzzle-hint');
    if (btnHint) btnHint.addEventListener('click', showPuzzleHint);

    const btnRetry = $('#btn-puzzle-retry');
    if (btnRetry) btnRetry.addEventListener('click', retryCurrentPuzzle);

    const btnNext = $('#btn-puzzle-next');
    if (btnNext) btnNext.addEventListener('click', nextPuzzle);

    const btnInvite = $('#btn-puzzle-invite');
    if (btnInvite) {
      btnInvite.addEventListener('click', () => {
        if (State.currentRoomCode) {
          navigator.clipboard.writeText(State.currentRoomCode).then(() => {
            showToast(`Room code ${State.currentRoomCode} copied! Tell your friend to join.`, 'success');
          });
        } else {
          switchView('home-view');
          showToast('Create a room first to invite your friend to watch!', 'info');
        }
      });
    }

    // Load first puzzle
    if (window.PUZZLES_DB && window.PUZZLES_DB.length) {
      loadPuzzle(window.PUZZLES_DB[0]);
    }
  }

  function loadPuzzle(puzzle, emitSync = true) {
    if (!puzzle || typeof Chess === 'undefined') return;

    State.currentPuzzle = puzzle;
    State.puzzleMoveIndex = 0;
    State.puzzleGame = new Chess(puzzle.fen);

    // Update UI headers
    const pNum = $('#puzzle-number');
    const pRating = $('#puzzle-rating');
    const pTheme = $('#puzzle-theme');
    const pStatus = $('#puzzle-status-text');
    const pIcon = $('#puzzle-status-icon');
    const pResult = $('#puzzle-result');

    if (pNum) pNum.textContent = `#${puzzle.id}`;
    if (pRating) pRating.textContent = puzzle.rating.toString();
    if (pTheme) pTheme.textContent = puzzle.themes ? puzzle.themes.join(', ') : 'Tactics';

    const turn = State.puzzleGame.turn() === 'w' ? 'White' : 'Black';
    if (pStatus) pStatus.textContent = `${turn} to move`;
    if (pIcon) pIcon.textContent = turn === 'White' ? '⬜' : '⬛';
    if (pResult) pResult.classList.add('hidden');

    // Legal move provider for puzzles
    window._chessBoardGetMoves = function (square) {
      if (!State.puzzleGame) return [];
      const moves = State.puzzleGame.moves({ square, verbose: true });
      return moves.map((m) => m.to);
    };

    if (!State.puzzleBoard) {
      State.puzzleBoard = new window.ChessBoard('puzzle-board', {
        interactive: true,
        flipped: State.puzzleGame.turn() === 'b',
        onMove: onPuzzleMove
      });
    } else {
      State.puzzleBoard.clearHighlights();
      if ((State.puzzleGame.turn() === 'b') !== State.puzzleBoard.isFlipped) {
        State.puzzleBoard.flipBoard();
      }
    }

    State.puzzleBoard.setPosition(puzzle.fen);

    // Emit sync event so connected friend sees the same puzzle in real-time
    if (emitSync && State.currentRoomId && State.socket) {
      State.socket.emit('puzzle-sync', {
        roomId: State.currentRoomId,
        puzzleId: puzzle.id
      });
    }
  }

  function onPuzzleMove({ from, to, promotion }) {
    if (!State.puzzleGame || !State.currentPuzzle) return false;

    const uciMove = from + to + (promotion ? promotion.toLowerCase() : '');
    const expectedMove = State.currentPuzzle.moves[State.puzzleMoveIndex];

    // Try making the move
    const move = State.puzzleGame.move({ from, to, promotion: promotion || 'q' });
    if (!move) return false;

    // Check if it matches solution
    const isCorrect = uciMove.startsWith(expectedMove.slice(0, 4));

    if (isCorrect) {
      // Correct player move
      State.puzzleBoard.setPosition(State.puzzleGame.fen());
      State.puzzleBoard.highlightLastMove(from, to);
      AudioEngine.playSuccess();
      State.puzzleMoveIndex++;

      // Relay move to friend so they can watch live!
      if (State.currentRoomId && State.socket) {
        State.socket.emit('puzzle-move', {
          roomId: State.currentRoomId,
          puzzleId: State.currentPuzzle.id,
          move: uciMove
        });
      }

      // Check if puzzle has opponent response
      if (State.puzzleMoveIndex < State.currentPuzzle.moves.length) {
        const opponentReplyUci = State.currentPuzzle.moves[State.puzzleMoveIndex];
        setTimeout(() => {
          if (!State.puzzleGame) return;
          const oppFrom = opponentReplyUci.slice(0, 2);
          const oppTo = opponentReplyUci.slice(2, 4);
          const oppMove = State.puzzleGame.move({ from: oppFrom, to: oppTo });
          if (oppMove) {
            State.puzzleBoard.setPosition(State.puzzleGame.fen());
            State.puzzleBoard.highlightLastMove(oppFrom, oppTo);
            AudioEngine.playMove();
            State.puzzleMoveIndex++;
          }
        }, 500);
      } else {
        // Puzzle fully solved!
        showPuzzleFeedback(true, 'Puzzle Solved! Great job!');
        State.puzzleCorrectCount++;
        State.puzzleStreak++;
        updatePuzzleStats();
      }

      return true;
    } else {
      // Incorrect move
      AudioEngine.playError();
      showPuzzleFeedback(false, 'Not the best move. Try again!');
      State.puzzleIncorrectCount++;
      State.puzzleStreak = 0;
      updatePuzzleStats();

      // Undo the wrong move on board
      setTimeout(() => {
        if (State.puzzleGame && State.puzzleBoard) {
          State.puzzleGame.undo();
          State.puzzleBoard.setPosition(State.puzzleGame.fen());
        }
      }, 700);

      return false;
    }
  }

  function handleRemotePuzzleMove(moveUci, puzzleId) {
    if (!State.currentPuzzle || State.currentPuzzle.id !== puzzleId) {
      const p = (window.PUZZLES_DB || []).find((x) => x.id === puzzleId);
      if (p) loadPuzzle(p, false);
    }

    if (State.puzzleGame && State.puzzleBoard) {
      const from = moveUci.slice(0, 2);
      const to = moveUci.slice(2, 4);
      const prom = moveUci.slice(4) || 'q';
      const m = State.puzzleGame.move({ from, to, promotion: prom });
      if (m) {
        State.puzzleBoard.setPosition(State.puzzleGame.fen());
        State.puzzleBoard.highlightLastMove(from, to);
        AudioEngine.playMove();
      }
    }
  }

  function showPuzzleHint() {
    if (!State.currentPuzzle || !State.puzzleBoard) return;
    const nextMove = State.currentPuzzle.moves[State.puzzleMoveIndex];
    if (nextMove) {
      const from = nextMove.slice(0, 2);
      const to = nextMove.slice(2, 4);
      State.puzzleBoard.highlightSquare(from, 'cb-selected');
      State.puzzleBoard.highlightSquare(to, 'cb-highlight');
      showToast(`Hint: Look at square ${from}`, 'info');
      setTimeout(() => State.puzzleBoard.clearHighlights(), 2000);
    }
  }

  function retryCurrentPuzzle() {
    if (State.currentPuzzle) loadPuzzle(State.currentPuzzle);
  }

  function nextPuzzle() {
    if (!window.PUZZLES_DB || !window.PUZZLES_DB.length) return;
    State.puzzleIndex = (State.puzzleIndex + 1) % window.PUZZLES_DB.length;
    loadPuzzle(window.PUZZLES_DB[State.puzzleIndex]);
  }

  function showPuzzleFeedback(isSuccess, text) {
    const res = $('#puzzle-result');
    const icon = $('#puzzle-result-icon');
    const label = $('#puzzle-result-text');
    if (res && icon && label) {
      res.className = `puzzle-result ${isSuccess ? 'success' : 'error'}`;
      icon.textContent = isSuccess ? '✓' : '✗';
      label.textContent = text;
      res.classList.remove('hidden');
    }
  }

  function updatePuzzleStats() {
    const cEl = $('#puzzle-correct-count');
    const iEl = $('#puzzle-incorrect-count');
    const sEl = $('#puzzle-streak-count');
    if (cEl) cEl.textContent = State.puzzleCorrectCount.toString();
    if (iEl) iEl.textContent = State.puzzleIncorrectCount.toString();
    if (sEl) sEl.textContent = State.puzzleStreak.toString();
  }

  // ── 6. Interactive Chess Lessons ───────────────────────────────────────────
  function initLessons() {
    // Lesson cards
    $$('.lesson-card').forEach((card) => {
      card.addEventListener('click', () => {
        const lessonId = card.dataset.lesson;
        if (lessonId && window.LESSONS_DB && window.LESSONS_DB[lessonId]) {
          openLesson(lessonId);
        }
      });
    });

    // Lesson detail buttons
    const btnBack = $('#btn-back-lessons');
    if (btnBack) {
      btnBack.addEventListener('click', () => {
        $('#lesson-detail')?.classList.add('hidden');
        $('#lessons-list')?.classList.remove('hidden');
      });
    }

    const btnPrev = $('#btn-lesson-prev');
    const btnNext = $('#btn-lesson-next');

    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (State.currentLessonStepIdx > 0) {
          State.currentLessonStepIdx--;
          renderLessonStep();
        }
      });
    }

    if (btnNext) {
      btnNext.addEventListener('click', () => {
        const lesson = window.LESSONS_DB[State.currentLessonId];
        if (lesson && State.currentLessonStepIdx < lesson.steps.length - 1) {
          State.currentLessonStepIdx++;
          renderLessonStep();
        } else {
          showToast('Lesson completed! Great work!', 'success');
          AudioEngine.playSuccess();
          $('#lesson-detail')?.classList.add('hidden');
          $('#lessons-list')?.classList.remove('hidden');
        }
      });
    }
  }

  function openLesson(lessonId) {
    State.currentLessonId = lessonId;
    State.currentLessonStepIdx = 0;

    $('#lessons-list')?.classList.add('hidden');
    $('#lesson-detail')?.classList.remove('hidden');

    const lesson = window.LESSONS_DB[lessonId];
    const titleEl = $('#lesson-detail-title');
    if (titleEl) titleEl.textContent = lesson.title;

    renderLessonStep();
  }

  function renderLessonStep() {
    const lesson = window.LESSONS_DB[State.currentLessonId];
    if (!lesson) return;

    const step = lesson.steps[State.currentLessonStepIdx];
    if (!step) return;

    // Update step counter & progress bar
    const total = lesson.steps.length;
    const current = State.currentLessonStepIdx + 1;
    const counterEl = $('#lesson-step-counter');
    const fillEl = $('#lesson-progress-fill');

    if (counterEl) counterEl.textContent = `${current} / ${total}`;
    if (fillEl) fillEl.style.width = `${(current / total) * 100}%`;

    // Update narration & instruction
    const narrEl = $('#lesson-narration-text');
    const instrEl = $('#lesson-instruction-text');
    const feedEl = $('#lesson-feedback');

    if (narrEl) narrEl.textContent = step.narration;
    if (instrEl) instrEl.textContent = step.instruction;
    if (feedEl) feedEl.classList.add('hidden');

    // Prev / Next button states
    const btnPrev = $('#btn-lesson-prev');
    const btnNext = $('#btn-lesson-next');
    if (btnPrev) btnPrev.disabled = State.currentLessonStepIdx === 0;
    if (btnNext) {
      btnNext.innerHTML = current === total ? 'Complete ✓' : 'Next ›';
    }

    // Setup board for step
    State.lessonGame = new Chess(step.fen);

    window._chessBoardGetMoves = function (square) {
      if (!State.lessonGame) return [];
      const moves = State.lessonGame.moves({ square, verbose: true });
      return moves.map((m) => m.to);
    };

    if (!State.lessonBoard) {
      State.lessonBoard = new window.ChessBoard('lesson-board', {
        interactive: true,
        flipped: false,
        onMove: onLessonMove
      });
    }

    State.lessonBoard.clearHighlights();
    State.lessonBoard.setPosition(step.fen);

    // Highlight instructive squares
    if (step.highlightSquares) {
      step.highlightSquares.forEach((sq) => {
        State.lessonBoard.highlightSquare(sq, 'cb-selected');
      });
    }
  }

  function onLessonMove({ from, to, promotion }) {
    const lesson = window.LESSONS_DB[State.currentLessonId];
    if (!lesson) return false;
    const step = lesson.steps[State.currentLessonStepIdx];
    if (!step) return false;

    const uci = from + to + (promotion ? promotion.toLowerCase() : '');

    if (step.targetMove) {
      if (uci.startsWith(step.targetMove.slice(0, 4))) {
        // Correct instructional move!
        State.lessonGame.move({ from, to, promotion: promotion || 'q' });
        State.lessonBoard.setPosition(State.lessonGame.fen());
        State.lessonBoard.highlightLastMove(from, to);
        AudioEngine.playSuccess();

        const feedEl = $('#lesson-feedback');
        const feedText = $('#lesson-feedback-text');
        if (feedEl && feedText) {
          feedText.textContent = 'Correct! Excellent move.';
          feedEl.classList.remove('hidden');
        }

        // Auto-advance after 1 second if not the last step
        setTimeout(() => {
          if (State.currentLessonStepIdx < lesson.steps.length - 1) {
            State.currentLessonStepIdx++;
            renderLessonStep();
          }
        }, 1200);

        return true;
      } else {
        AudioEngine.playError();
        showToast('Try following the instruction on the board', 'info');
        return false;
      }
    }

    return false;
  }

  // ── 7. In-Game Chat ────────────────────────────────────────────────────────
  function initChat() {
    const btnToggle = $('#btn-toggle-chat');
    const panel = $('#chat-panel');
    const btnClose = $('#btn-close-chat');
    const btnSend = $('#btn-send-chat');
    const input = $('#chat-input');
    const badge = $('#chat-badge');

    if (btnToggle && panel) {
      btnToggle.addEventListener('click', () => {
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden') && badge) {
          badge.classList.add('hidden');
          badge.textContent = '0';
        }
      });
    }

    if (btnClose && panel) {
      btnClose.addEventListener('click', () => panel.classList.add('hidden'));
    }

    const doSend = () => {
      if (!input) return;
      const msg = input.value.trim();
      if (!msg) return;

      if (State.currentRoomId && State.socket) {
        State.socket.emit('chat', {
          roomId: State.currentRoomId,
          message: msg,
          sender: 'You'
        });
      }

      appendChatMessage('You', msg, true);
      input.value = '';
    };

    if (btnSend) btnSend.addEventListener('click', doSend);
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doSend();
      });
    }
  }

  function appendChatMessage(sender, message, isSelf) {
    const container = $('#chat-messages');
    if (!container) return;

    const div = document.createElement('div');
    div.className = `chat-message ${isSelf ? 'chat-self' : 'chat-opponent'}`;
    div.innerHTML = `
      <span class="chat-sender">${sender}</span>
      <span class="chat-body">${escapeHTML(message)}</span>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, (tag) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  // ── 8. Modals ──────────────────────────────────────────────────────────────
  function initModals() {
    const overlay = $('#modal-overlay');
    if (!overlay) return;

    // Close buttons on modals
    $$('.modal-close').forEach((btn) => {
      btn.addEventListener('click', hideModal);
    });

    // Close on backdrop tap (except for game over)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        const gameover = $('#modal-game-over');
        if (gameover && !gameover.classList.contains('hidden')) return;
        hideModal();
      }
    });

    // Game over rematch / new game buttons
    const btnRematch = $('#btn-rematch');
    if (btnRematch) {
      btnRematch.addEventListener('click', () => {
        hideModal();
        startNewChessGame(State.playerColor === 'b');
      });
    }

    const btnNewGame = $('#btn-new-game');
    if (btnNewGame) {
      btnNewGame.addEventListener('click', () => {
        hideModal();
        switchView('home-view');
      });
    }
  }

  function showModal(modalBodyId) {
    const overlay = $('#modal-overlay');
    if (!overlay) return;

    // Hide all modal bodies
    $$('.modal-body').forEach((b) => b.classList.add('hidden'));

    // Show target body
    const target = $(`#${modalBodyId}`);
    if (target) target.classList.remove('hidden');

    overlay.classList.remove('hidden');
  }

  function hideModal() {
    const overlay = $('#modal-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

})();
