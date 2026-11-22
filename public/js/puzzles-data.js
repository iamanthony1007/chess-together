/**
 * Chess Together - Puzzles & Lessons Database
 */

(function () {
  'use strict';

  // ── PUZZLES DATABASE ────────────────────────────────────────────────────────
  // Standard format:
  // - fen: position after opponent's setup move is about to be played (or already set)
  // - moves: array of UCI moves [opponent_setup_move, player_move, opponent_reply, player_move...]
  // If player starts immediately, moves can be [player_move, opponent_reply, player_move...]
  // We'll define: fen is initial puzzle board position, first move in moves is player's required move,
  // or opponent move if setup. Let's make `moves` be: [player_move, opponent_reply, player_win_move].
  // All moves are UCI strings (e.g. 'e2e4', 'e7e8q').

  window.PUZZLES_DB = [
    // --- 800 - 1000: Beginner Tactics & Basic Mates ---
    {
      id: 1,
      title: "Back Rank Mate",
      fen: "6k1/5ppp/8/8/8/8/4R3/4K3 w - - 0 1",
      moves: ["e2e8"],
      rating: 850,
      themes: ["mate in 1", "back rank"],
      turn: "w",
      description: "White to move and deliver checkmate."
    },
    {
      id: 2,
      title: "Scholar's Mate Threat",
      fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
      moves: ["h5f7"],
      rating: 880,
      themes: ["mate in 1", "queen attack"],
      turn: "w",
      description: "Find the immediate checkmate!"
    },
    {
      id: 3,
      title: "Free Queen",
      fen: "r1b1k2r/pppp1ppp/8/4q3/1b6/2P5/PP1BPPPP/RN1QKB1R w KQkq - 0 8",
      moves: ["c3b4"],
      rating: 820,
      themes: ["hanging piece"],
      turn: "w",
      description: "Black left a bishop undefended on b4."
    },
    {
      id: 4,
      title: "Smothered Mate In One",
      fen: "6k1/5Npp/8/8/8/8/8/4K2R w - - 0 1",
      moves: ["f7h6"], // or fork
      rating: 920,
      themes: ["fork", "knight"],
      turn: "w",
      description: "Find the best knight jump."
    },
    {
      id: 5,
      title: "Simple Rook Fork",
      fen: "4k3/8/8/3r4/8/8/2K1R3/8 b - - 0 1",
      moves: ["e8d7"],
      rating: 860,
      themes: ["escape check"],
      turn: "b",
      description: "Respond to White's check."
    },
    {
      id: 6,
      title: "Royal Fork",
      fen: "r3k2r/ppp2ppp/8/4N3/1b6/8/PPP2PPP/R1B1K2R w KQkq - 0 1",
      moves: ["c1d2"],
      rating: 940,
      themes: ["defense", "pin"],
      turn: "w",
      description: "Block the bishop check cleanly."
    },
    {
      id: 7,
      title: "Capture the Loose Knight",
      fen: "r1bqk2r/pppp1ppp/2n5/4p3/1bB1P1n1/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 1 6",
      moves: ["c4f7", "e8f7", "f3g5"],
      rating: 990,
      themes: ["tactic", "sacrifice"],
      turn: "w",
      description: "Strike at f7 to regain material with advantage."
    },
    {
      id: 8,
      title: "Pawn Promotion",
      fen: "8/4P3/8/8/8/3k4/8/4K3 w - - 0 1",
      moves: ["e7e8q"],
      rating: 810,
      themes: ["endgame", "promotion"],
      turn: "w",
      description: "Promote your passed pawn to a Queen!"
    },
    {
      id: 9,
      title: "Anastasia's Mate Concept",
      fen: "5rk1/1p3ppp/8/3N4/8/8/5PPP/4R1K1 w - - 0 1",
      moves: ["d5e7", "g8h8"],
      rating: 950,
      themes: ["mate net", "knight"],
      turn: "w",
      description: "Cut off the enemy king."
    },
    {
      id: 10,
      title: "Queen & Helper Mate",
      fen: "r4rk1/ppp2ppp/8/8/1b1Q4/8/PPP1BPPP/R3K2R w KQ - 0 1",
      moves: ["c2c3"],
      rating: 900,
      themes: ["blocking check"],
      turn: "w",
      description: "Block the bishop check safely."
    },

    // --- 1000 - 1200: Forks, Pins, & Double Attacks ---
    {
      id: 11,
      title: "Knight Fork King and Queen",
      fen: "r1b1k2r/pp3ppp/2n5/3qp3/8/3B1N2/PPP2PPP/R2QK2R w KQkq - 0 10",
      moves: ["d3h7", "h8h7", "d1d5"],
      rating: 1050,
      themes: ["fork", "deflection"],
      turn: "w",
      description: "Deflect Black and win the Queen."
    },
    {
      id: 12,
      title: "Absolute Pin on the Queen",
      fen: "4k3/8/4q3/8/8/2B5/8/4K1R1 w - - 0 1",
      moves: ["c3e5"],
      rating: 1080,
      themes: ["pin", "blocking"],
      turn: "w",
      description: "Neutralize the check."
    },
    {
      id: 13,
      title: "Classic Knight Fork on c7",
      fen: "r1bqk2r/pppp1ppp/2n5/2b1p3/2B1n3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 6",
      moves: ["c3e4"],
      rating: 1020,
      themes: ["hanging piece"],
      turn: "w",
      description: "Capture the undefended attacker."
    },
    {
      id: 14,
      title: "Skewer on the Diagonal",
      fen: "4k3/8/8/8/8/2b5/1B6/4K2R w K - 0 1",
      moves: ["e1f1"],
      rating: 1010,
      themes: ["defense"],
      turn: "w",
      description: "Move king out of check."
    },
    {
      id: 15,
      title: "Double Attack on Queen and Rook",
      fen: "r3k2r/pppq1ppp/2n1b3/2b1p3/4N3/3P1N2/PPP2PPP/R1BQK2R w KQkq - 1 9",
      moves: ["e4c5", "d7e7", "c5e6"],
      rating: 1120,
      themes: ["fork", "outpost"],
      turn: "w",
      description: "Fork the Queen and Bishop on c5."
    },
    {
      id: 16,
      title: "Remove the Guard",
      fen: "r1b2rk1/pp3ppp/2n1pn2/q1bp4/2P5/2N1PN2/PP1BBPPP/R2QK2R w KQ - 0 9",
      moves: ["c3d5", "a5d8", "d5f6"],
      rating: 1150,
      themes: ["discovered attack", "deflection"],
      turn: "w",
      description: "Discover an attack on the black Queen while leaping into the center."
    },
    {
      id: 17,
      title: "Trapping the Bishop",
      fen: "r1bqk1nr/pppp1ppp/2n5/4p3/1b2P3/2N2N2/PPPP1PPP/R1BQKB1R w KQkq - 2 4",
      moves: ["c3d5"],
      rating: 1040,
      themes: ["initiative", "tempo"],
      turn: "w",
      description: "Attack the Black bishop and centralize your knight."
    },
    {
      id: 18,
      title: "Back Rank Combination",
      fen: "3r2k1/5ppp/8/8/8/8/3R4/3R2K1 w - - 0 1",
      moves: ["d2d8", "d8d8", "d1d8"],
      rating: 1090,
      themes: ["back rank", "exchange"],
      turn: "w",
      description: "Liquidate into checkmate on the 8th rank!"
    },
    {
      id: 19,
      title: "The Greek Gift Primer",
      fen: "r1bq1rk1/ppp2ppp/2n1pn2/3p4/2PP4/2NBPN2/PP3PPP/R1BQK2R w KQ - 0 7",
      moves: ["d3h7", "g8h7"],
      rating: 1180,
      themes: ["sacrifice", "attack"],
      turn: "w",
      description: "Shatter Black's king safety with a bishop sacrifice on h7."
    },
    {
      id: 20,
      title: "Discovered Check",
      fen: "r1b1k2r/pp3ppp/2n5/3p4/1b1N4/2N5/PPP2PPP/R1B1KB1R w KQkq - 0 10",
      moves: ["d4b5"],
      rating: 1160,
      themes: ["threat", "fork setup"],
      turn: "w",
      description: "Threaten a devastating fork on c7."
    },

    // --- 1200 - 1400: Intermediate Combinations ---
    {
      id: 21,
      title: "Deflection to Deliver Mate",
      fen: "5rk1/5ppp/8/8/8/8/1Q3PPP/4R1K1 w - - 0 1",
      moves: ["b2b7"],
      rating: 1220,
      themes: ["7th rank", "pressure"],
      turn: "w",
      description: "Invade the 7th rank with decisive pressure."
    },
    {
      id: 22,
      title: "Overworked Defender",
      fen: "r2q1rk1/1pp2ppp/p1n1pn2/3p4/3P4/2PBPN2/PP3PPP/R2Q1RK1 w - - 0 10",
      moves: ["f3e5"],
      rating: 1250,
      themes: ["outpost", "center"],
      turn: "w",
      description: "Anchor your knight on the critical central outpost."
    },
    {
      id: 23,
      title: "Clearance Sacrifice",
      fen: "r1b2rk1/pp1n1ppp/2p1pn2/q2p4/1bPP4/2N1PN2/PP1BBPPP/R2Q1RK1 w - - 4 9",
      moves: ["a2a3", "b4c3", "d2c3"],
      rating: 1280,
      themes: ["trapping", "pair of bishops"],
      turn: "w",
      description: "Put the question to Black's dark-squared bishop."
    },
    {
      id: 24,
      title: "Queen Decoy",
      fen: "6k1/5ppp/8/8/8/5q2/5PPP/4R1K1 w - - 0 1",
      moves: ["e1e8"],
      rating: 1210,
      themes: ["back rank", "in-between move"],
      turn: "w",
      description: "Black is threatening your Queen, but who mates first?"
    },
    {
      id: 25,
      title: "X-Ray Attack",
      fen: "r4rk1/pp1b1ppp/1q2pn2/3p4/8/1P1B4/P1QN1PPP/R3R1K1 w - - 0 15",
      moves: ["d3h7", "f6h7"],
      rating: 1310,
      themes: ["tactical blow"],
      turn: "w",
      description: "Snag a pawn and expose Black's king."
    },
    {
      id: 26,
      title: "Knight Outpost Dominance",
      fen: "r1bq1rk1/pp2bppp/2n1pn2/3p4/2PN4/1PN1P3/P3BPPP/R1BQK2R w KQ - 0 9",
      moves: ["c4d5", "e6d5", "e1g1"],
      rating: 1340,
      themes: ["pawn structure", "isolated queen pawn"],
      turn: "w",
      description: "Isolate Black's d-pawn to create a long-term target."
    },
    {
      id: 27,
      title: "Intermezzo (Zwischenzug)",
      fen: "r1bqk2r/pp2bppp/2n1pn2/2pp4/3P4/2PBPN2/PP3PPP/RNBQ1RK1 w kq - 2 7",
      moves: ["d4c5", "e7c5", "b2b4"],
      rating: 1370,
      themes: ["tempo", "queenside expansion"],
      turn: "w",
      description: "Win a tempo on the bishop and expand on the queenside."
    },
    {
      id: 28,
      title: "Smothered Mate in Two",
      fen: "6k1/5Npp/8/8/8/8/8/Q3K3 w - - 0 1",
      moves: ["a1a2", "g8f8", "f7d6"],
      rating: 1390,
      themes: ["discovered check", "mating net"],
      turn: "w",
      description: "Set up the battery with Queen and Knight."
    },

    // --- 1400 - 1600: Advanced Combinations & Sacrifices ---
    {
      id: 29,
      title: "Windmill Tactic Setup",
      fen: "4r1k1/5ppp/8/8/8/8/1R3PPP/4R1K1 w - - 0 1",
      moves: ["e1e8"],
      rating: 1420,
      themes: ["rook endgame", "back rank"],
      turn: "w",
      description: "Cash in on the open e-file with checkmate!"
    },
    {
      id: 30,
      title: "Queen Sacrifice for Mate",
      fen: "r1b2rk1/2p2ppp/p7/1p6/3P2nq/1BP2Q1P/PP3PPb/RNB1R1K1 w - - 1 16",
      moves: ["g1f1", "c8b7", "f3g4"],
      rating: 1540,
      themes: ["counterattack", "defense"],
      turn: "w",
      description: "Navigate the razor-sharp tactical storm."
    },
    {
      id: 31,
      title: "Zugzwang in Pawn Endgame",
      fen: "8/8/5k2/5p1p/5P1P/5K2/8/8 w - - 0 1",
      moves: ["f3e3", "f6e6", "e3d4"],
      rating: 1480,
      themes: ["endgame", "opposition"],
      turn: "w",
      description: "Outmaneuver the Black king to seize key squares."
    },
    {
      id: 32,
      title: "Boden's Mate Pattern",
      fen: "2kr3r/ppp2ppp/2n5/8/1b2B3/2P2N2/PP3PPP/R1B1K2R w KQ - 1 12",
      moves: ["c3b4", "h8e8", "e1g1"],
      rating: 1460,
      themes: ["piece coordination", "unpinning"],
      turn: "w",
      description: "Castling breaks the pin and saves your piece."
    },

    // --- 1600+: Expert Tactics & Endgame Mastery ---
    {
      id: 33,
      title: "Lucena Position Technique",
      fen: "1K1k4/1P6/8/8/8/8/5r2/2R5 w - - 0 1",
      moves: ["c1c4", "f2f1", "b8a7"],
      rating: 1650,
      themes: ["lucena", "building a bridge"],
      turn: "w",
      description: "Execute the famous bridge-building maneuver to promote."
    },
    {
      id: 34,
      title: "Philidor Defense Endgame",
      fen: "8/8/8/8/4k3/8/4K1r1/4R3 w - - 0 1",
      moves: ["e2f1", "e4f3", "e1e3"],
      rating: 1720,
      themes: ["drawing defense", "perpetual"],
      turn: "w",
      description: "Find the defensive resource to hold the draw."
    },
    {
      id: 35,
      title: "Mating Net with Minor Pieces",
      fen: "5rk1/5ppp/8/8/1B6/3B4/8/4K2R w K - 0 1",
      moves: ["d3h7", "g8h8", "h7e4"],
      rating: 1680,
      themes: ["discovered check", "windmill"],
      turn: "w",
      description: "The classic discovered check with bishop pair!"
    }
  ];

  // ── LESSONS DATABASE ────────────────────────────────────────────────────────
  // Matches the cards in index.html:
  // - pieces-movement
  // - checkmate-basics
  // - special-moves
  // - forks
  // - pins-skewers
  // - opening-principles
  // - endgame-basics
  // - sacrifices

  window.LESSONS_DB = {
    'pieces-movement': {
      title: "How Pieces Move",
      category: "Beginner",
      badgeClass: "beginner",
      description: "Learn how each piece moves across the board",
      steps: [
        {
          title: "The Pawn",
          fen: "8/8/8/8/8/4P3/8/8 w - - 0 1",
          narration: "Pawns move forward one square at a time. From their starting square, they can choose to jump two squares forward!",
          instruction: "Move the pawn forward two squares to e4.",
          targetMove: "e3e4",
          highlightSquares: ["e3", "e4"]
        },
        {
          title: "Pawn Captures",
          fen: "8/8/8/3p4/4P3/8/8/8 w - - 0 1",
          narration: "Pawns capture differently than they move! They capture diagonally forward one square.",
          instruction: "Capture the enemy pawn on d5.",
          targetMove: "e4d5",
          highlightSquares: ["e4", "d5"]
        },
        {
          title: "The Knight's Leap",
          fen: "8/8/8/8/4N3/8/8/8 w - - 0 1",
          narration: "The Knight moves in an 'L' shape: two squares in one direction, then one square perpendicular. It can jump over other pieces!",
          instruction: "Jump your knight to f6.",
          targetMove: "e4f6",
          highlightSquares: ["e4", "f6"]
        },
        {
          title: "The Bishop's Diagonals",
          fen: "8/8/8/8/3B4/8/8/8 w - - 0 1",
          narration: "The Bishop moves diagonally as far as it likes on squares of its own color. It can never switch square colors!",
          instruction: "Slide your bishop all the way to g7.",
          targetMove: "d4g7",
          highlightSquares: ["d4", "g7"]
        },
        {
          title: "The Rook's Ranks & Files",
          fen: "8/8/8/8/3R4/8/8/8 w - - 0 1",
          narration: "The Rook is a powerful heavy piece! It moves horizontally along ranks and vertically along files as far as it pleases.",
          instruction: "Move your rook to the open d8 square.",
          targetMove: "d4d8",
          highlightSquares: ["d4", "d8"]
        },
        {
          title: "The Mighty Queen",
          fen: "8/8/8/8/3Q4/8/8/8 w - - 0 1",
          narration: "The Queen combines the powers of the Rook and Bishop! She can move diagonally, horizontally, or vertically any distance.",
          instruction: "Sweep the queen across to h4.",
          targetMove: "d4h4",
          highlightSquares: ["d4", "h4"]
        },
        {
          title: "The King",
          fen: "8/8/8/8/4K3/8/8/8 w - - 0 1",
          narration: "The King is your most valuable piece. If he is trapped, you lose! He moves one square in any direction.",
          instruction: "Step your king forward to e5.",
          targetMove: "e4e5",
          highlightSquares: ["e4", "e5"]
        }
      ]
    },

    'checkmate-basics': {
      title: "Checkmate Basics",
      category: "Beginner",
      badgeClass: "beginner",
      description: "Understanding check, checkmate, and stalemate",
      steps: [
        {
          title: "What is Check?",
          fen: "4k3/8/8/8/8/8/4R3/4K3 w - - 0 1",
          narration: "Check occurs when a king is under direct attack. When in check, you MUST get out of check immediately!",
          instruction: "Notice Black's King is in check along the e-file.",
          targetMove: null,
          highlightSquares: ["e2", "e8"]
        },
        {
          title: "The 3 Ways Out: Escape",
          fen: "4k3/8/8/8/8/8/4R3/4K3 b - - 0 1",
          narration: "CPR: Capture the attacker, Protect with a block, or Run away with the King. Here the King can run!",
          instruction: "Step the Black king to d8 to escape the check.",
          targetMove: "e8d8",
          highlightSquares: ["e8", "d8"]
        },
        {
          title: "Back Rank Checkmate",
          fen: "6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1",
          narration: "When the enemy king is trapped behind his own pawns with no escape flight squares, a rook on the back rank delivers checkmate!",
          instruction: "Deliver back-rank checkmate by moving your rook to a8.",
          targetMove: "a1a8",
          highlightSquares: ["a1", "a8"]
        },
        {
          title: "Queen & Helper Checkmate",
          fen: "r1bqkb1r/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1",
          narration: "A Queen supported by another piece right in front of the enemy King cannot be captured because of the defender!",
          instruction: "Deliver checkmate with Qxf7#.",
          targetMove: "h5f7",
          highlightSquares: ["h5", "f7"]
        }
      ]
    },

    'special-moves': {
      title: "Special Moves",
      category: "Beginner",
      badgeClass: "beginner",
      description: "Castling, en passant, and pawn promotion",
      steps: [
        {
          title: "Kingside Castling",
          fen: "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
          narration: "Castling allows you to move your King two squares toward a rook and bring that rook to the other side of the king in ONE move!",
          instruction: "Castle kingside by moving your King to g1.",
          targetMove: "e1g1",
          highlightSquares: ["e1", "g1"]
        },
        {
          title: "Pawn Promotion",
          fen: "8/4P3/8/8/8/8/5k2/4K3 w - - 0 1",
          narration: "When a pawn reaches the opposite end of the board, it promotes into a Queen, Rook, Bishop, or Knight!",
          instruction: "Promote your pawn to a Queen on e8.",
          targetMove: "e7e8q",
          highlightSquares: ["e7", "e8"]
        },
        {
          title: "En Passant",
          fen: "rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3",
          narration: "If an enemy pawn moves two squares forward and lands right next to your pawn, you can capture it diagonally behind as if it only moved one square!",
          instruction: "Capture the f5 pawn en passant by playing exf6.",
          targetMove: "e5f6",
          highlightSquares: ["e5", "f6"]
        }
      ]
    },

    'forks': {
      title: "Forks & Double Attacks",
      category: "Intermediate",
      badgeClass: "intermediate",
      description: "Attack two pieces at once",
      steps: [
        {
          title: "The Knight Fork",
          fen: "r3k2r/ppp2ppp/8/3n4/8/2N5/PPP2PPP/R3K2R w KQkq - 0 1",
          narration: "Knights are famous for branching out in unexpected angles. When a piece attacks two enemy targets at once, it's called a fork!",
          instruction: "Fork the enemy king and rook by playing Nd5.",
          targetMove: "c3d5",
          highlightSquares: ["c3", "d5"]
        },
        {
          title: "Pawn Fork",
          fen: "r1bqk2r/pppp1ppp/8/4n3/1b2P3/2P5/PP1B1PPP/RN1QKB1R w KQkq - 0 8",
          narration: "Even lowly pawns can deliver devastating forks against valuable minor pieces!",
          instruction: "Push your pawn to c3 to attack the bishop.",
          targetMove: "c2c3",
          highlightSquares: ["c2", "c3"]
        }
      ]
    },

    'pins-skewers': {
      title: "Pins & Skewers",
      category: "Intermediate",
      badgeClass: "intermediate",
      description: "Use line attacks to win material",
      steps: [
        {
          title: "The Absolute Pin",
          fen: "4k3/8/4r3/8/8/8/4B3/4K2R w - - 0 1",
          narration: "A pin occurs when a piece cannot move because doing so would expose a more valuable piece behind it. An absolute pin shields the King!",
          instruction: "Notice the Black rook on e6 is pinned to the King on e8.",
          targetMove: null,
          highlightSquares: ["e2", "e6", "e8"]
        },
        {
          title: "The Deadly Skewer",
          fen: "4k2r/8/8/8/8/8/B7/4K3 w - - 0 1",
          narration: "A skewer is the reverse of a pin: the more valuable piece is in FRONT. When it moves out of danger, the piece behind is taken!",
          instruction: "Check the King with Bd5 to skewer the King and Rook.",
          targetMove: "a2d5",
          highlightSquares: ["a2", "d5"]
        }
      ]
    },

    'opening-principles': {
      title: "Opening Principles",
      category: "Intermediate",
      badgeClass: "intermediate",
      description: "Control the center and develop your pieces",
      steps: [
        {
          title: "1. Control the Center",
          fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
          narration: "The four central squares (e4, d4, e5, d5) are prime real estate. Controlling them gives your pieces room to operate.",
          instruction: "Stake your claim in the center with 1. e4!",
          targetMove: "e2e4",
          highlightSquares: ["e2", "e4", "e5", "d4", "d5"]
        },
        {
          title: "2. Develop Knights before Bishops",
          fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
          narration: "Knights usually have clear developing squares that attack the center immediately, like f3.",
          instruction: "Develop your knight with Nf3, putting pressure on e5.",
          targetMove: "g1f3",
          highlightSquares: ["g1", "f3"]
        },
        {
          title: "3. Develop Bishops with Purpose",
          fen: "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 1 3",
          narration: "Bring out your light-squared bishop to exert pressure toward the vulnerable f7 weakness.",
          instruction: "Play Bc4 to begin the Italian Game.",
          targetMove: "f1c4",
          highlightSquares: ["f1", "c4"]
        }
      ]
    },

    'endgame-basics': {
      title: "Endgame Essentials",
      category: "Advanced",
      badgeClass: "advanced",
      description: "King and pawn endings, opposition, and more",
      steps: [
        {
          title: "The Opposition",
          fen: "8/8/4k3/8/4K3/8/8/8 w - - 0 1",
          narration: "Opposition is when two kings face each other with only one square between them. The player who does NOT have to move holds the opposition!",
          instruction: "Step forward into the opposition with Kd4 or Ke3.",
          targetMove: "e4d4",
          highlightSquares: ["e4", "d4"]
        },
        {
          title: "Guiding the Passed Pawn",
          fen: "8/8/8/4k3/4P3/4K3/8/8 w - - 0 1",
          narration: "In king and pawn endgames, keeping your king in front of or shoulder-to-shoulder with your passed pawn is the key to winning.",
          instruction: "March your king forward to d3 or f3.",
          targetMove: "e3d3",
          highlightSquares: ["e3", "d3"]
        }
      ]
    },

    'sacrifices': {
      title: "Tactical Sacrifices",
      category: "Advanced",
      badgeClass: "advanced",
      description: "Give up material to gain a decisive advantage",
      steps: [
        {
          title: "The Greek Gift Sacrifice",
          fen: "r1bq1rk1/ppp2ppp/2n1pn2/3p4/2PP4/2NBPN2/PP3PPP/R1BQK2R w KQ - 0 7",
          narration: "Sacrificing the bishop on h7 tears open the enemy King's pawn shelter and invites your Queen and Knight into the attack!",
          instruction: "Smash through with Bxh7+!",
          targetMove: "d3h7",
          highlightSquares: ["d3", "h7"]
        }
      ]
    }
  };

})();
