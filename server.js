const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

// ---------------------------------------------------------------------------
// App & Server
// ---------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingInterval: 25000,
  pingTimeout: 60000,
});

// ---------------------------------------------------------------------------
// Static files & health check
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    rooms: rooms.size,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Room storage
// ---------------------------------------------------------------------------
/** @type {Map<string, Room>} */
const rooms = new Map();

/** @type {Map<string, string>} code -> roomId */
const codeToRoom = new Map();

/**
 * @typedef {Object} Room
 * @property {string}   id
 * @property {string}   code
 * @property {Player[]} players
 * @property {string}   gameState   – "waiting" | "playing" | "finished"
 * @property {string|null} currentPuzzleId
 */

/**
 * @typedef {Object} Player
 * @property {string} socketId
 * @property {string} color – "w" | "b"
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const CODE_LENGTH = 6;
const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Generate a unique 6-character uppercase join code. */
function generateCode() {
  let code;
  do {
    code = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
    }
  } while (codeToRoom.has(code));
  return code;
}

/** Return the other player's socketId in a room, if any. */
function getOpponentId(room, socketId) {
  const opponent = room.players.find((p) => p.socketId !== socketId);
  return opponent ? opponent.socketId : null;
}

/** Remove a player from a room and clean up if empty. */
function removePlayerFromRoom(room, socketId) {
  room.players = room.players.filter((p) => p.socketId !== socketId);

  if (room.players.length === 0) {
    codeToRoom.delete(room.code);
    rooms.delete(room.id);
    console.log(`[room] Deleted room ${room.id} (${room.code}) – empty`);
  } else {
    // Notify remaining player that opponent disconnected
    const remaining = room.players[0];
    io.to(remaining.socketId).emit("opponent-disconnected");
    room.gameState = "finished";
  }
}

/** Find the room a socket belongs to. */
function findRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.socketId === socketId)) {
      return room;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------
io.on("connection", (socket) => {
  console.log(`[ws] Connected: ${socket.id}`);

  // ---- Create Room --------------------------------------------------------
  socket.on("create-room", (callback) => {
    const roomId = uuidv4();
    const code = generateCode();

    /** @type {Room} */
    const room = {
      id: roomId,
      code,
      players: [{ socketId: socket.id, color: null }], // color assigned on join
      gameState: "waiting",
      currentPuzzleId: null,
    };

    rooms.set(roomId, room);
    codeToRoom.set(code, roomId);
    socket.join(roomId);

    console.log(`[room] Created ${roomId} with code ${code}`);

    const payload = { roomId, code };
    socket.emit("room-created", payload);
    if (typeof callback === "function") callback(payload);
  });

  // ---- Join Room ----------------------------------------------------------
  socket.on("join-room", (data, callback) => {
    const code = (data && (data.code || data)).toString().toUpperCase().trim();
    const roomId = codeToRoom.get(code);

    if (!roomId || !rooms.has(roomId)) {
      const err = { error: "Room not found" };
      socket.emit("join-error", err);
      if (typeof callback === "function") callback(err);
      return;
    }

    const room = rooms.get(roomId);

    if (room.players.length >= 2) {
      const err = { error: "Room is full" };
      socket.emit("join-error", err);
      if (typeof callback === "function") callback(err);
      return;
    }

    // Prevent the same socket from joining twice
    if (room.players.some((p) => p.socketId === socket.id)) {
      const err = { error: "Already in this room" };
      socket.emit("join-error", err);
      if (typeof callback === "function") callback(err);
      return;
    }

    // Randomly assign colours
    const colors = Math.random() < 0.5 ? ["w", "b"] : ["b", "w"];
    room.players[0].color = colors[0];
    room.players.push({ socketId: socket.id, color: colors[1] });
    room.gameState = "playing";

    socket.join(roomId);

    // Notify both players
    room.players.forEach((p) => {
      io.to(p.socketId).emit("room-joined", {
        roomId,
        color: p.color,
      });
    });

    console.log(`[room] ${socket.id} joined room ${roomId} (${code})`);

    if (typeof callback === "function") callback({ roomId, color: colors[1] });
  });

  // ---- Move ---------------------------------------------------------------
  socket.on("move", (data) => {
    if (!data || !data.roomId) return;
    const room = rooms.get(data.roomId);
    if (!room) return;

    const opponentId = getOpponentId(room, socket.id);
    if (opponentId) {
      io.to(opponentId).emit("move", { move: data.move });
    }
  });

  // ---- Puzzle Move --------------------------------------------------------
  socket.on("puzzle-move", (data) => {
    if (!data || !data.roomId) return;
    const room = rooms.get(data.roomId);
    if (!room) return;

    const opponentId = getOpponentId(room, socket.id);
    if (opponentId) {
      io.to(opponentId).emit("puzzle-move", {
        move: data.move,
        puzzleId: data.puzzleId,
      });
    }
  });

  // ---- Puzzle Sync --------------------------------------------------------
  socket.on("puzzle-sync", (data) => {
    if (!data || !data.roomId) return;
    const room = rooms.get(data.roomId);
    if (!room) return;

    room.currentPuzzleId = data.puzzleId;

    const opponentId = getOpponentId(room, socket.id);
    if (opponentId) {
      io.to(opponentId).emit("puzzle-sync", { puzzleId: data.puzzleId });
    }
  });

  // ---- WebRTC Signaling ---------------------------------------------------
  socket.on("offer", (data) => {
    if (!data || !data.roomId) return;
    const room = rooms.get(data.roomId);
    if (!room) return;

    const opponentId = getOpponentId(room, socket.id);
    if (opponentId) {
      io.to(opponentId).emit("offer", { sdp: data.sdp });
    }
  });

  socket.on("answer", (data) => {
    if (!data || !data.roomId) return;
    const room = rooms.get(data.roomId);
    if (!room) return;

    const opponentId = getOpponentId(room, socket.id);
    if (opponentId) {
      io.to(opponentId).emit("answer", { sdp: data.sdp });
    }
  });

  socket.on("ice-candidate", (data) => {
    if (!data || !data.roomId) return;
    const room = rooms.get(data.roomId);
    if (!room) return;

    const opponentId = getOpponentId(room, socket.id);
    if (opponentId) {
      io.to(opponentId).emit("ice-candidate", { candidate: data.candidate });
    }
  });

  // ---- Chat ---------------------------------------------------------------
  socket.on("chat", (data) => {
    if (!data || !data.roomId) return;
    const room = rooms.get(data.roomId);
    if (!room) return;

    const opponentId = getOpponentId(room, socket.id);
    if (opponentId) {
      io.to(opponentId).emit("chat", {
        message: data.message,
        from: "opponent",
        timestamp: Date.now(),
      });
    }
  });

  // ---- Resign / Draw offers -----------------------------------------------
  socket.on("resign", (data) => {
    if (!data || !data.roomId) return;
    const room = rooms.get(data.roomId);
    if (!room) return;

    room.gameState = "finished";
    const opponentId = getOpponentId(room, socket.id);
    if (opponentId) {
      io.to(opponentId).emit("opponent-resigned");
    }
    socket.emit("you-resigned");
  });

  const handleDrawOffer = (data) => {
    if (!data || !data.roomId) return;
    const room = rooms.get(data.roomId);
    if (!room) return;

    const opponentId = getOpponentId(room, socket.id);
    if (opponentId) {
      io.to(opponentId).emit("draw-offered");
      io.to(opponentId).emit("draw-offer");
    }
  };
  socket.on("offer-draw", handleDrawOffer);
  socket.on("draw-offer", handleDrawOffer);

  const handleDrawAccept = (data) => {
    if (!data || !data.roomId) return;
    const room = rooms.get(data.roomId);
    if (!room) return;

    room.gameState = "finished";
    io.to(data.roomId).emit("draw-accepted");
  };
  socket.on("accept-draw", handleDrawAccept);
  socket.on("draw-accepted", handleDrawAccept);

  const handleDrawDecline = (data) => {
    if (!data || !data.roomId) return;
    const room = rooms.get(data.roomId);
    if (!room) return;

    const opponentId = getOpponentId(room, socket.id);
    if (opponentId) {
      io.to(opponentId).emit("draw-declined");
    }
  };
  socket.on("decline-draw", handleDrawDecline);
  socket.on("draw-declined", handleDrawDecline);

  // ---- Disconnect ---------------------------------------------------------
  socket.on("disconnect", (reason) => {
    console.log(`[ws] Disconnected: ${socket.id} (${reason})`);

    const room = findRoomBySocket(socket.id);
    if (room) {
      removePlayerFromRoom(room, socket.id);
    }
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Chess Together server listening on http://localhost:${PORT}`);
});
