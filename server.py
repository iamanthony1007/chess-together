import os
import random
import string
import uuid
import socketio
import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse

# -----------------------------------------------------------------------------
# Setup Socket.IO & FastAPI App
# -----------------------------------------------------------------------------
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
app = FastAPI()

# -----------------------------------------------------------------------------
# State Storage
# -----------------------------------------------------------------------------
rooms = {}  # roomId -> { "id": str, "code": str, "players": [{"socketId": str, "color": str}], "gameState": str }
code_to_room = {}  # code -> roomId

CODE_CHARS = string.ascii_uppercase
CODE_LENGTH = 6

def generate_code():
    while True:
        code = "".join(random.choices(CODE_CHARS, k=CODE_LENGTH))
        if code not in code_to_room:
            return code

def get_opponent_id(room, socket_id):
    for p in room.get("players", []):
        if p["socketId"] != socket_id:
            return p["socketId"]
    return None

def find_room_by_socket(socket_id):
    for room in rooms.values():
        if any(p["socketId"] == socket_id for p in room.get("players", [])):
            return room
    return None

def remove_player_from_room(room, socket_id):
    room["players"] = [p for p in room.get("players", []) if p["socketId"] != socket_id]
    if len(room["players"]) == 0:
        code_to_room.pop(room["code"], None)
        rooms.pop(room["id"], None)
        print(f"[room] Deleted room {room['id']} ({room['code']}) - empty")
    else:
        remaining = room["players"][0]
        room["gameState"] = "finished"
        return remaining["socketId"]
    return None

# -----------------------------------------------------------------------------
# Socket.IO Event Handlers
# -----------------------------------------------------------------------------
@sio.event
async def connect(sid, environ):
    print(f"[ws] Connected: {sid}")

@sio.event
async def disconnect(sid):
    print(f"[ws] Disconnected: {sid}")
    room = find_room_by_socket(sid)
    if room:
        remaining_sid = remove_player_from_room(room, sid)
        if remaining_sid:
            await sio.emit("opponent-disconnected", room=remaining_sid)

@sio.on("create-room")
async def handle_create_room(sid, data=None):
    room_id = str(uuid.uuid4())
    code = generate_code()

    room = {
        "id": room_id,
        "code": code,
        "players": [{"socketId": sid, "color": None}],
        "gameState": "waiting",
        "currentPuzzleId": None
    }
    rooms[room_id] = room
    code_to_room[code] = room_id

    await sio.enter_room(sid, room_id)
    print(f"[room] Created {room_id} with code {code}")

    payload = {"roomId": room_id, "code": code}
    await sio.emit("room-created", payload, room=sid)
    return payload

@sio.on("join-room")
async def handle_join_room(sid, data=None):
    raw_code = data.get("code", data) if isinstance(data, dict) else data
    code = str(raw_code).strip().upper() if raw_code else ""
    room_id = code_to_room.get(code)

    if not room_id or room_id not in rooms:
        err = {"error": "Room not found"}
        await sio.emit("join-error", err, room=sid)
        return err

    room = rooms[room_id]

    if len(room["players"]) >= 2:
        err = {"error": "Room is full"}
        await sio.emit("join-error", err, room=sid)
        return err

    if any(p["socketId"] == sid for p in room["players"]):
        err = {"error": "Already in this room"}
        await sio.emit("join-error", err, room=sid)
        return err

    colors = ["w", "b"] if random.random() < 0.5 else ["b", "w"]
    room["players"][0]["color"] = colors[0]
    room["players"].append({"socketId": sid, "color": colors[1]})
    room["gameState"] = "playing"

    await sio.enter_room(sid, room_id)

    for p in room["players"]:
        await sio.emit("room-joined", {
            "roomId": room_id,
            "color": p["color"]
        }, room=p["socketId"])

    print(f"[room] {sid} joined room {room_id} ({code})")
    return {"roomId": room_id, "color": colors[1]}

@sio.on("move")
async def handle_move(sid, data):
    if not data or "roomId" not in data:
        return
    room = rooms.get(data["roomId"])
    if not room:
        return
    opp_id = get_opponent_id(room, sid)
    if opp_id:
        await sio.emit("move", {"move": data.get("move")}, room=opp_id)

@sio.on("puzzle-move")
async def handle_puzzle_move(sid, data):
    if not data or "roomId" not in data:
        return
    room = rooms.get(data["roomId"])
    if not room:
        return
    opp_id = get_opponent_id(room, sid)
    if opp_id:
        await sio.emit("puzzle-move", {
            "move": data.get("move"),
            "puzzleId": data.get("puzzleId")
        }, room=opp_id)

@sio.on("puzzle-sync")
async def handle_puzzle_sync(sid, data):
    if not data or "roomId" not in data:
        return
    room = rooms.get(data["roomId"])
    if not room:
        return
    opp_id = get_opponent_id(room, sid)
    if opp_id:
        await sio.emit("puzzle-sync", {"puzzleId": data.get("puzzleId")}, room=opp_id)

# WebRTC Signaling Relay
@sio.on("offer")
async def handle_offer(sid, data):
    if not data or "roomId" not in data:
        return
    room = rooms.get(data["roomId"])
    if not room:
        return
    opp_id = get_opponent_id(room, sid)
    if opp_id:
        await sio.emit("offer", {"sdp": data.get("sdp")}, room=opp_id)

@sio.on("answer")
async def handle_answer(sid, data):
    if not data or "roomId" not in data:
        return
    room = rooms.get(data["roomId"])
    if not room:
        return
    opp_id = get_opponent_id(room, sid)
    if opp_id:
        await sio.emit("answer", {"sdp": data.get("sdp")}, room=opp_id)

@sio.on("ice-candidate")
async def handle_ice_candidate(sid, data):
    if not data or "roomId" not in data:
        return
    room = rooms.get(data["roomId"])
    if not room:
        return
    opp_id = get_opponent_id(room, sid)
    if opp_id:
        await sio.emit("ice-candidate", {"candidate": data.get("candidate")}, room=opp_id)

@sio.on("chat")
async def handle_chat(sid, data):
    if not data or "roomId" not in data:
        return
    room = rooms.get(data["roomId"])
    if not room:
        return
    opp_id = get_opponent_id(room, sid)
    if opp_id:
        await sio.emit("chat", {
            "message": data.get("message"),
            "sender": data.get("sender", "Opponent")
        }, room=opp_id)

@sio.on("resign")
async def handle_resign(sid, data):
    if not data or "roomId" not in data:
        return
    room = rooms.get(data["roomId"])
    if not room:
        return
    room["gameState"] = "finished"
    opp_id = get_opponent_id(room, sid)
    if opp_id:
        await sio.emit("opponent-resigned", room=opp_id)

@sio.on("offer-draw")
@sio.on("draw-offer")
async def handle_draw_offer(sid, data):
    if not data or "roomId" not in data:
        return
    room = rooms.get(data["roomId"])
    if not room:
        return
    opp_id = get_opponent_id(room, sid)
    if opp_id:
        await sio.emit("draw-offered", room=opp_id)
        await sio.emit("draw-offer", room=opp_id)

@sio.on("accept-draw")
@sio.on("draw-accepted")
async def handle_draw_accepted(sid, data):
    if not data or "roomId" not in data:
        return
    room = rooms.get(data["roomId"])
    if not room:
        return
    room["gameState"] = "finished"
    await sio.emit("draw-accepted", room=data["roomId"])

@sio.on("decline-draw")
@sio.on("draw-declined")
async def handle_draw_declined(sid, data):
    if not data or "roomId" not in data:
        return
    room = rooms.get(data["roomId"])
    if not room:
        return
    opp_id = get_opponent_id(room, sid)
    if opp_id:
        await sio.emit("draw-declined", room=opp_id)

# -----------------------------------------------------------------------------
# HTTP Endpoints & Static Files
# -----------------------------------------------------------------------------
@app.get("/health")
def health():
    return JSONResponse({
        "status": "ok",
        "rooms": len(rooms)
    })

# Mount Socket.IO to FastAPI ASGI application
app_combined = socketio.ASGIApp(sio, other_asgi_app=app)

# Mount static files directory
public_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
app.mount("/", StaticFiles(directory=public_dir, html=True), name="public")

# -----------------------------------------------------------------------------
# Main Runner
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3000))
    print(f"\n=======================================================")
    print(f"  Chess Together server running!")
    print(f"  URL: http://localhost:{port}")
    print(f"=======================================================\n")
    uvicorn.run(app_combined, host="0.0.0.0", port=port, log_level="info")
