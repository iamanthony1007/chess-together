/* Lessons. Each step either explains a position (no task) or asks for a move.
 *   fen      starting position for the step; omit to continue from the previous step's board
 *   accept   UCI moves that count as correct (promotion letter optional)
 *   goal     'mate' accepts any move that gives checkmate
 *   reply    opponent move played automatically after a correct answer
 *   arrows   [from, to] pairs drawn on the board
 *   marks    squares to highlight
 */
window.CT = window.CT || {};
window.CT.LESSONS = [
  {
    id: 'pieces',
    title: 'How the pieces move',
    level: 'Beginner',
    summary: 'Rook, bishop, queen, knight, pawn and king, one at a time.',
    steps: [
      {
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        text: 'Each side starts with 16 pieces. White always moves first. The light square sits in the bottom-right corner for both players.'
      },
      {
        fen: '7k/8/8/8/3R4/8/8/K7 w - - 0 1',
        text: 'The rook moves in straight lines along ranks and files, as far as it likes.',
        task: 'Move the rook to the top of the board, d8.',
        accept: ['d4d8'],
        marks: ['d8']
      },
      {
        fen: '8/8/8/8/8/8/8/K1B4k w - - 0 1',
        text: 'The bishop moves diagonally and always stays on squares of one colour.',
        task: 'Slide the bishop to h6.',
        accept: ['c1h6'],
        marks: ['h6']
      },
      {
        fen: '7k/8/8/8/8/8/8/K2Q4 w - - 0 1',
        text: 'The queen combines the rook and the bishop. Straight or diagonal, any distance.',
        task: 'Move the queen diagonally to h5.',
        accept: ['d1h5'],
        marks: ['h5']
      },
      {
        fen: '7k/8/8/8/8/8/8/KN6 w - - 0 1',
        text: 'The knight jumps in an L: two squares one way, then one square to the side. It is the only piece that can jump over others.',
        task: 'Make any knight jump.',
        accept: ['b1a3', 'b1c3', 'b1d2']
      },
      {
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        text: 'Pawns move straight forward one square, or two squares on their first move. They capture diagonally.',
        task: 'Push the e-pawn forward.',
        accept: ['e2e3', 'e2e4']
      },
      {
        fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
        text: 'The king moves one square in any direction. It can never move onto a square that is attacked.',
        task: 'Move the king one square.',
        accept: ['e1d1', 'e1d2', 'e1e2', 'e1f2', 'e1f1']
      }
    ]
  },
  {
    id: 'checkmate',
    title: 'Check, checkmate and stalemate',
    level: 'Beginner',
    summary: 'How games are won, and the draw that catches beginners out.',
    steps: [
      {
        fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1',
        text: 'A king is in check when it is attacked. The player in check must deal with it straight away.',
        task: 'Give check with the rook.',
        accept: ['a1a8'],
        marks: ['a8']
      },
      {
        fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
        text: 'Checkmate is check with no way out. Here the black king is boxed in by its own pawns.',
        task: 'Deliver checkmate.',
        goal: 'mate'
      },
      {
        fen: '7k/8/6K1/8/8/8/8/Q7 w - - 0 1',
        text: 'Your king can help. It already covers g7 and h7, so the queen only has to cover the last rank.',
        task: 'Find checkmate.',
        goal: 'mate'
      },
      {
        fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
        text: 'Careful. Black is not in check but has no legal move. That is stalemate, and the game is a draw. Always leave the losing king a square until you can mate.',
        marks: ['h8']
      }
    ]
  },
  {
    id: 'special',
    title: 'Special moves',
    level: 'Beginner',
    summary: 'Castling, en passant and promotion.',
    steps: [
      {
        fen: 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1',
        text: 'Castling moves the king two squares toward a rook, and the rook jumps over. It tucks the king away and brings the rook into play.',
        task: 'Castle on the king side: move the king to g1.',
        accept: ['e1g1'],
        arrows: [['e1', 'g1']]
      },
      {
        fen: 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1',
        text: 'You can also castle on the queen side, toward the a-rook.',
        task: 'Move the king to c1.',
        accept: ['e1c1'],
        arrows: [['e1', 'c1']]
      },
      {
        fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
        text: 'Black just pushed d7 to d5, jumping past your pawn. For one move only, you can capture it as if it had moved one square. That is en passant.',
        task: 'Capture en passant.',
        accept: ['e5d6'],
        arrows: [['e5', 'd6']]
      },
      {
        fen: '8/4P3/8/8/8/2k5/8/4K3 w - - 0 1',
        text: 'A pawn that reaches the far side becomes a queen, rook, bishop or knight. Almost always a queen.',
        task: 'Promote the pawn.',
        accept: ['e7e8']
      }
    ]
  },
  {
    id: 'forks',
    title: 'Forks',
    level: 'Intermediate',
    summary: 'Attack two things at once and win one of them.',
    steps: [
      {
        fen: 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1',
        text: 'A fork is one piece attacking two targets. Knights are the best forkers because their attack is hard to see coming.',
        task: 'Fork the king and the rook.',
        accept: ['b5c7'],
        reply: 'e8d7'
      },
      {
        text: 'The king had to step away. The rook is now undefended.',
        task: 'Collect the rook.',
        accept: ['c7a8']
      },
      {
        fen: '4k3/8/8/8/7r/8/8/3QK3 w - - 0 1',
        text: 'Queens fork too. Look for a check that also hits a loose piece.',
        task: 'Check the king and attack the rook in one move.',
        accept: ['d1a4']
      }
    ]
  },
  {
    id: 'pins',
    title: 'Pins and skewers',
    level: 'Intermediate',
    summary: 'Line attacks with rooks, bishops and queens.',
    steps: [
      {
        fen: '4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1',
        text: 'A pin attacks a piece that cannot move without exposing something more valuable behind it.',
        task: 'Pin the knight to the king.',
        accept: ['f1b5'],
        arrows: [['f1', 'b5']]
      },
      {
        text: 'The knight on c6 is frozen. If it moves, the king would be in check, which is illegal.',
        arrows: [['b5', 'e8']]
      },
      {
        fen: '3q4/8/8/3k4/8/8/8/K6R w - - 0 1',
        text: 'A skewer is a pin in reverse: attack the valuable piece first, and when it moves, take what was behind it.',
        task: 'Check the king along the d-file.',
        accept: ['h1d1'],
        reply: 'd5c4'
      },
      {
        text: 'The king stepped aside. Now the queen behind it is exposed.',
        task: 'Win the queen.',
        accept: ['d1d8']
      }
    ]
  },
  {
    id: 'opening',
    title: 'Opening principles',
    level: 'Intermediate',
    summary: 'Centre, development, king safety.',
    steps: [
      {
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        text: 'Rule one: claim the centre. Pawns on e4 and d4 control the squares your pieces want.',
        task: 'Put a pawn in the centre.',
        accept: ['e2e4', 'd2d4'],
        marks: ['d4', 'e4', 'd5', 'e5']
      },
      {
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
        text: 'Rule two: develop knights before bishops, toward the centre.',
        task: 'Develop a knight.',
        accept: ['g1f3', 'b1c3']
      },
      {
        fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
        text: 'Now the bishop. Aim it at the centre or at the weak f7 square.',
        task: 'Develop the light-squared bishop.',
        accept: ['f1c4', 'f1b5']
      },
      {
        fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
        text: 'Rule three: castle early. A king in the middle is a target.',
        task: 'Castle.',
        accept: ['e1g1']
      }
    ]
  },
  {
    id: 'endgame',
    title: 'Endgame mates',
    level: 'Advanced',
    summary: 'The rook ladder, so a winning position stays winning.',
    steps: [
      {
        fen: '4k3/8/8/8/8/8/R7/1R2K3 w - - 0 1',
        text: 'Two rooks mate by taking turns: one cuts the king off, the other gives check. People call it the ladder.',
        task: 'Cut the king off on the 7th rank.',
        accept: ['a2a7', 'b1b7'],
        reply: 'e8d8'
      },
      {
        text: 'The king is stuck on the back rank. The rook on a7 guards the whole 7th rank.',
        task: 'Finish with checkmate.',
        goal: 'mate'
      }
    ]
  },
  {
    id: 'sacrifice',
    title: 'Sacrifices',
    level: 'Advanced',
    summary: 'Give up material when it forces mate.',
    steps: [
      {
        fen: '5r1k/6pp/7N/8/8/1Q6/8/6K1 w - - 0 1',
        text: 'This is the smothered mate. The black king is walled in by its own pieces. Your knight guards g8, so a queen check there cannot be met by the king.',
        task: 'Sacrifice the queen with check.',
        accept: ['b3g8'],
        reply: 'f8g8'
      },
      {
        text: 'Black had to take. Now the king is completely surrounded by its own pieces.',
        task: 'Smother it with the knight.',
        goal: 'mate'
      }
    ]
  }
];
