# Chess Together

Play chess with a friend in real time, from any phone or computer. Video and voice calls, chat, shared puzzles and hands-on lessons. No account needed.

## What it does

- **Rooms with a 6-letter code or an invite link.** Open the link and you are in the game.
- **Fair games.** The server checks every move, runs both clocks (10 minutes each) and decides the result: checkmate, resignation, time, stalemate, repetition, 50-move rule, insufficient material, or agreed draw.
- **Reconnect.** Refresh the page or lose signal, open the link again, and you get the same seat back with the chat history.
- **Video and voice calls** between the two players, peer to peer.
- **Chat**, kept for the room.
- **Draw offers, resign, rematch** (colours swap each rematch).
- **73 puzzles** from the Lichess puzzle database, rated about 800 to 2150, with Easy, Medium and Hard filters, hints, solutions and streaks. Two players in a room can solve on the same board.
- **8 lessons** (pieces, checkmate, special moves, forks, pins, openings, endgame mates, sacrifices). Every position and answer was checked with chess.js and Stockfish.
- Works on phones and desktop, can be added to the home screen, keyboard playable.

## Run it on your computer

Needs Node.js 18 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. To test two players on one computer, open a second window in incognito.

Run the server tests with `npm test`.

## Calls need HTTPS

Browsers only allow the camera and microphone on `https://` addresses or on `localhost`. On your phone over Wi-Fi (`http://192.168...`) moves and chat work, but calls will not. Deploy it (below) to get an HTTPS link.

Calls use free STUN servers, which work on most home Wi-Fi. Phones on mobile data often need a relay (TURN) server. To add one, set these environment variables:

| Variable | Example |
| --- | --- |
| `TURN_URL` | `turn:relay.example.com:3478` (comma-separate several) |
| `TURN_USERNAME` | your TURN username |
| `TURN_CREDENTIAL` | your TURN password |

## Deploy on Render (free)

1. Push this folder to GitHub.
2. On render.com: New, Web Service, connect the repo.
3. Build command `npm install`, start command `npm start`, instance type Free.
4. Render gives you an `https://...onrender.com` link. Share it.

The free plan sleeps after 15 minutes without visitors, so the first visit can take up to a minute to wake. Games live in server memory, so a restart or redeploy ends open games.

## How it is built

```
server.js              Express + Socket.IO. Rooms, move checking (chess.js), clocks,
                       results, chat, call signalling relay, puzzle sync.
public/index.html      One page, four views: lobby, game, puzzles, lessons.
public/css/style.css   Design tokens and all styles.
public/js/
  ui.js                Toasts, dialogs, sounds, storage, small chess helpers
  board.js             The board: drawing, tap, drag, keyboard, promotion, arrows
  net.js               Socket connection, player id, current room
  call.js              WebRTC calls
  game.js              Online game screen and chat
  puzzles.js           Puzzle trainer
  lessons.js           Lessons
  app.js               Routing, lobby, sharing
  puzzles-data.js      Puzzle set
  lessons-data.js      Lesson content
public/pieces/         Piece images, served locally
test/server.test.js    Two-player integration test
```

## Credits

- Puzzles: [Lichess puzzle database](https://database.lichess.org/#puzzles), CC0.
- Pieces: cburnett set by Colin M.L. Burnett, via Wikimedia Commons (GPL / BSD / GFDL).
- Rules: [chess.js](https://github.com/jhlywa/chess.js) 0.12.1, BSD-2.
- Heading font: Spectral, SIL Open Font License.
