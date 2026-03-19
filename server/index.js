/**
 * Play inSync — Signaling Server
 *
 * Lightweight WebSocket server that manages rooms and broadcasts
 * media sync events (play, pause, seek) to all peers in a room.
 */

"use strict";

const { WebSocketServer, WebSocket } = require("ws");
const crypto = require("crypto");

// ── Configuration ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const CODE_LENGTH = 6;

// ── Room store ───────────────────────────────────────────────────────
// Map<roomCode, Set<WebSocket>>
const rooms = new Map();

// Track which room each socket belongs to
// WeakMap<WebSocket, roomCode>
const socketRoom = new WeakMap();

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Generate a random room code (6 uppercase alphanumeric characters).
 * Re-generates if the code already exists (extremely unlikely).
 */
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion
  let code;
  do {
    code = "";
    const bytes = crypto.randomBytes(CODE_LENGTH);
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += chars[bytes[i] % chars.length];
    }
  } while (rooms.has(code));
  return code;
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(roomCode, data, excludeWs) {
  const peers = rooms.get(roomCode);
  if (!peers) return;
  const msg = JSON.stringify(data);
  for (const peer of peers) {
    if (peer !== excludeWs && peer.readyState === WebSocket.OPEN) {
      peer.send(msg);
    }
  }
}

function removeFromRoom(ws) {
  const code = socketRoom.get(ws);
  if (!code) return;

  const peers = rooms.get(code);
  if (peers) {
    peers.delete(ws);
    if (peers.size === 0) {
      rooms.delete(code);
    } else {
      broadcast(code, { type: "PEER_LEFT", peerCount: peers.size });
    }
  }

  socketRoom.delete(ws);
}

// ── Server setup ─────────────────────────────────────────────────────

function createServer(options = {}) {
  const port = options.port || PORT;
  const wss = new WebSocketServer({ port, ...options.wssOptions });

  console.log(`[inSync Server] Listening on ws://localhost:${port}`);

  // ── Heartbeat ────────────────────────────────────────────────────
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        removeFromRoom(ws);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL);

  wss.on("close", () => clearInterval(heartbeat));

  // ── Connection handler ───────────────────────────────────────────
  wss.on("connection", (ws) => {
    ws.isAlive = true;
    console.log(`[inSync Server] New connection (total clients: ${wss.clients.size})`);

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (raw) => {
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        send(ws, { type: "ERROR", message: "Invalid JSON" });
        return;
      }

      handleMessage(ws, data);
    });

    ws.on("close", () => {
      console.log(`[inSync Server] Client disconnected (remaining: ${wss.clients.size - 1})`);
      removeFromRoom(ws);
    });

    ws.on("error", () => {
      removeFromRoom(ws);
    });
  });

  return wss;
}

// ── Message handler ──────────────────────────────────────────────────

function handleMessage(ws, data) {
  switch (data.type) {
    case "CREATE_ROOM": {
      // Leave any existing room first
      removeFromRoom(ws);

      const code = generateRoomCode();
      rooms.set(code, new Set([ws]));
      socketRoom.set(ws, code);

      console.log(`[inSync Server] Room created: ${code}`);
      send(ws, { type: "ROOM_CREATED", code });
      break;
    }

    case "JOIN_ROOM": {
      const code = (data.code || "").toUpperCase().trim();
      const peers = rooms.get(code);

      if (!peers) {
        console.log(`[inSync Server] Join failed — room not found: ${code}`);
        send(ws, { type: "ERROR", message: "Room not found" });
        return;
      }

      // Leave any existing room first
      removeFromRoom(ws);

      peers.add(ws);
      socketRoom.set(ws, code);

      console.log(`[inSync Server] Client joined room ${code} (peers: ${peers.size})`);
      send(ws, { type: "ROOM_JOINED", code, peerCount: peers.size });
      broadcast(code, { type: "PEER_JOINED", peerCount: peers.size }, ws);
      break;
    }

    case "LEAVE_ROOM": {
      const code = socketRoom.get(ws);
      console.log(`[inSync Server] Client left room ${code || "(none)"}`);
      removeFromRoom(ws);
      send(ws, { type: "LEFT_ROOM" });
      break;
    }

    case "MEDIA_EVENT": {
      const code = socketRoom.get(ws);
      if (!code) {
        send(ws, { type: "ERROR", message: "Not in a room" });
        return;
      }

      // Validate event type
      const validEvents = ["play", "pause", "seek"];
      if (!validEvents.includes(data.event)) {
        send(ws, { type: "ERROR", message: "Invalid event type" });
        return;
      }

      const peers = rooms.get(code);
      const peerCount = peers ? peers.size - 1 : 0;
      console.log(`[inSync Server] Broadcasting ${data.event} @ ${data.time?.toFixed(2)}s to ${peerCount} peer(s) in room ${code}`);

      // Broadcast to all other peers in the room
      broadcast(
        code,
        {
          type: "MEDIA_EVENT",
          event: data.event,
          time: data.time,
        },
        ws
      );
      break;
    }

    case "PING": {
      send(ws, { type: "PONG" });
      break;
    }

    case "URL_CHANGE": {
      const code = socketRoom.get(ws);
      if (!code) {
        send(ws, { type: "ERROR", message: "Not in a room" });
        return;
      }

      const peers = rooms.get(code);
      const peerCount = peers ? peers.size - 1 : 0;
      console.log(`[inSync Server] Broadcasting URL change to ${peerCount} peer(s) in room ${code}: ${data.url}`);

      broadcast(
        code,
        {
          type: "URL_CHANGE",
          url: data.url,
        },
        ws
      );
      break;
    }

    default: {
      send(ws, { type: "ERROR", message: `Unknown message type: ${data.type}` });
    }
  }
}

// ── Exports (for testing) ────────────────────────────────────────────
module.exports = { createServer, rooms, socketRoom, generateRoomCode };

// ── Start server if run directly ─────────────────────────────────────
if (require.main === module) {
  createServer();
}
