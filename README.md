# Chess Together ♟️📱

A modern, mobile-first multiplayer chess application inspired by Chess.com. Play real-time chess games with friends, talk and see each other via peer-to-peer WebRTC voice/video, solve interactive tactical puzzles together, and learn through guided lessons.

**100% Free Build • No Paid Services Required • Peer-to-Peer Video/Voice**

---

## ✨ Features

- **📱 Mobile-First UI**: Designed specifically for smartphones with touch-friendly tap-to-move, drag-and-drop, and Chess.com-style aesthetic.
- **⚡ Real-Time Multiplayer**: Instant move synchronization using WebSockets and 6-letter room join codes.
- **📹 Peer-to-Peer Voice & Video**: WebRTC integration powered by free Google STUN servers. Hear your friend's voice or see them while playing without any paid subscription or API key.
- **🧩 Collaborative Puzzles**: 35+ tactical chess positions (rated 800 to 1800+). Your partner can watch you solve puzzles in real-time and coach you over voice!
- **📖 Interactive Chess Lessons**: Step-by-step interactive courses covering basic piece movement, checkmate patterns, castling, en passant, forks, pins, skewers, opening principles, and sacrifices.
- **⏱️ Chess Clocks & Timers**: 10-minute rapid game timer per player with automatic turn switching.
- **🔊 Built-in Sound Synthesizer**: Uses Web Audio API to create authentic wood taps, capture clicks, check warnings, and victory chimes without external audio assets.
- **📲 Progressive Web App (PWA)**: Install directly to iOS Safari ("Add to Home Screen") or Android Chrome.

---

## 🚀 How to Run Locally

### Option A: Using Node.js

1. Make sure Node.js (v18+) is installed.
2. Open a terminal in this directory:
   ```bash
   npm install
   npm start
   ```
3. Open your browser or phone browser at:
   ```
   http://localhost:3000
   ```
4. If testing with a phone on the same Wi-Fi network, access `http://<YOUR_COMPUTER_IP>:3000`.

---

## 🌐 How to Deploy for 100% FREE

You can host this app online for free so you and your friends can access it anywhere from your phones.

### Deploy to Render.com (Recommended - 100% Free)

1. Create a free account at [render.com](https://render.com).
2. Push this folder to a GitHub repository.
3. Click **New +** > **Web Service**.
4. Connect your GitHub repository.
5. Set:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: `Free`
6. Click **Deploy Web Service**. Render will give you a public `https://your-app.onrender.com` URL that works on any phone!

*(Note: WebRTC voice and video requires HTTPS on mobile browsers, which Render provides automatically for free!)*

### Alternative Free Hosts:
- **Glitch.com**: Import repository, instant hosting.
- **Railway.app**: Free trial tier.
- **Koyeb.com**: Free serverless web app hosting.

---

## 🛠️ Tech Stack

- **Frontend**: Vanilla HTML5, CSS3, JavaScript (Single Page Application architecture)
- **Chess Engine**: `chess.js` (rule validation, check/stalemate detection)
- **Piece Sets**: Lichess open-source cburnett SVG vectors via jsDelivr CDN
- **WebRTC**: Browser native `RTCPeerConnection` + Google STUN servers
- **Backend**: Node.js + Express + Socket.IO (room routing & WebRTC signaling)

---

## 📱 How to Play on Mobile

1. Open the app link on your phone.
2. Tap **Play with a Friend** to generate a 6-letter room code (e.g., `KTWXYZ`).
3. Send the code or link to your friend.
4. Your friend taps **Join a Game**, enters the code, and taps **Join**.
5. The game begins immediately! Tap the **Camera / Call button** at the top right to start your voice or video call.
6. Want to solve puzzles together? Switch to the **Puzzles** tab; both of you can watch each other's moves live on the board!
