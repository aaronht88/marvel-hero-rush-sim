// =============================================================
// MHR Online Room Broker (v3.15)
// Pure-relay WebSocket server. Holds rooms map + 4-char codes.
// Does NOT run the engine — every client runs engine.js locally
// and broadcasts action events. Server just forwards.
//
// Deploy: any Node 18+ host. Free-tier friendly (Render / Railway /
// Fly.io / Zeabur). Single process, in-memory rooms, no DB.
//
// Usage:
//   PORT=8787 node broker.js
//   ws://HOST:8787
//
// Protocol (v3.15):
//   client → server:
//     { kind: "create_room",  client_id: "abc" }                   → 4-char code
//     { kind: "join_room",    code: "K7MX", client_id: "..." }      → room meta
//     { kind: "leave_room",   code: "..." }                        → close
//     { kind: "ready",        code: "...", deck: { ... } }         → ack match_start
//     { kind: "action",       code: "...", payload: { ... } }      → relay to other
//
//   server → client:
//     { kind: "created",  code: "K7MX" }
//     { kind: "joined",   code: "K7MX", side: "P" | "A", peer_connected: bool }
//     { kind: "peer_joined",   side: "P"|"A" }
//     { kind: "peer_left",     side: "P"|"A" }
//     { kind: "match_start",   first_side: "P"|"A", peer_deck: {...} }
//     { kind: "action",        from: "P"|"A", payload: {...} }     // relayed
//     { kind: "error",         msg: "..." }
// =============================================================

import { WebSocketServer } from "ws";
import http from "node:http";
import { randomBytes } from "node:crypto";

const PORT = parseInt(process.env.PORT || "8787", 10);
const HOST = process.env.HOST || "0.0.0.0";
// CORS_ORIGINS: comma-separated list, e.g. "https://aaronht88.github.io,http://localhost:8080"
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// --- Rooms ---
// room: { code, host: ws, guest?: ws, side: {ws: 'P'|'A'}, created: ts, lastActivity: ts }
const rooms = new Map();
const wsToRoom = new WeakMap();   // ws → room
const wsToSide = new WeakMap();   // ws → 'P' | 'A' | null

// 4-char room code, unambiguous chars (no 0/O/1/I)
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode() {
  let c;
  for (let i = 0; i < 8; i++) {
    c = "";
    for (let j = 0; j < 4; j++) {
      c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    if (!rooms.has(c)) return c;
  }
  return c;  // collision-after-8-attempts is astronomically unlikely
}

// --- HTTP server with health check + CORS handshake ---
const httpServer = http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin && (CORS_ORIGINS.length === 0 || CORS_ORIGINS.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      rooms: rooms.size,
      uptime: process.uptime(),
      version: "3.15.0",
    }));
    return;
  }
  if (req.url === "/rooms") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      active: Array.from(rooms.keys()),
      count: rooms.size,
    }));
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("MHR broker — use WebSocket\n");
});

// --- WebSocket server ---
const wss = new WebSocketServer({ server: httpServer, perMessageDeflate: false });

wss.on("connection", (ws, req) => {
  // Per-connection metadata
  ws._id = randomBytes(4).toString("hex");
  ws._room = null;
  ws._side = null;
  ws._alive = true;

  ws.on("pong", () => { ws._alive = true; });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return sendError(ws, "invalid JSON"); }

    if (!msg || typeof msg.kind !== "string") return sendError(ws, "missing kind");

    switch (msg.kind) {
      case "ping":       send(ws, { kind: "pong", t: Date.now() }); break;
      case "create_room": return onCreateRoom(ws, msg);
      case "join_room":   return onJoinRoom(ws, msg);
      case "leave_room":  return onLeaveRoom(ws, msg);
      case "ready":       return onReady(ws, msg);
      case "action":      return onAction(ws, msg);
      case "chat":        return onChat(ws, msg);
      default: sendError(ws, `unknown kind: ${msg.kind}`);
    }
  });

  ws.on("close", () => onClose(ws));
  ws.on("error", () => onClose(ws));
});

function onCreateRoom(ws, msg) {
  if (ws._room) return sendError(ws, "already in a room");
  const code = genCode();
  const room = {
    code,
    host: ws,
    guest: null,
    side: new Map([[ws, "P"]]),  // host is side P by convention
    ready: new Set(),
    decks: new Map(),
    created: Date.now(),
    lastActivity: Date.now(),
  };
  rooms.set(code, room);
  wsToRoom.set(ws, room);
  ws._room = room;
  ws._side = "P";
  send(ws, { kind: "created", code });
  console.log(`[${code}] created (host=P)`);
}

function onJoinRoom(ws, msg) {
  if (!msg.code || typeof msg.code !== "string") return sendError(ws, "missing code");
  const code = msg.code.toUpperCase();
  const room = rooms.get(code);
  if (!room) return sendError(ws, `room ${code} not found`);
  if (room.guest) return sendError(ws, "room full");
  room.guest = ws;
  room.side.set(ws, "A");  // joiner is side A
  wsToRoom.set(ws, room);
  ws._room = room;
  ws._side = "A";
  room.lastActivity = Date.now();
  send(ws, { kind: "joined", code, side: "A", peer_connected: !!room.host });
  // Tell host that guest joined
  if (room.host.readyState === 1) {
    send(room.host, { kind: "peer_joined", side: "A" });
  }
  console.log(`[${code}] joined (side=A)`);
}

function onLeaveRoom(ws, msg) {
  const room = ws._room;
  if (!room) return;
  detachFromRoom(ws, room, "leave");
}

function onReady(ws, msg) {
  const room = ws._room;
  if (!room) return sendError(ws, "not in a room");
  if (!msg.deck) return sendError(ws, "missing deck");
  room.decks.set(ws, msg.deck);
  room.ready.add(ws);
  room.lastActivity = Date.now();
  const bothReady = room.host && room.guest &&
                    room.ready.has(room.host) && room.ready.has(room.guest);
  if (bothReady) {
    // Determine first side (host = P, guest = A; first mover alternates;
    // for simplicity: host (P) always goes first if v3.15 spec).
    const firstSide = "P";
    const hostDeck   = room.decks.get(room.host);
    const guestDeck  = room.decks.get(room.guest);
    send(room.host,  { kind: "match_start", first_side: firstSide, self_side: "P", peer_deck: guestDeck });
    send(room.guest, { kind: "match_start", first_side: firstSide, self_side: "A", peer_deck: hostDeck });
    console.log(`[${room.code}] match_start (first=${firstSide})`);
  } else {
    send(ws, { kind: "ready_ack", waiting_for_peer: true });
  }
}

function onAction(ws, msg) {
  const room = ws._room;
  if (!room) return sendError(ws, "not in a room");
  if (!msg.payload) return sendError(ws, "missing payload");
  const from = ws._side;  // 'P' or 'A'
  const peer = from === "P" ? room.guest : room.host;
  if (peer && peer.readyState === 1) {
    send(peer, { kind: "action", from, payload: msg.payload });
  }
  room.lastActivity = Date.now();
}

function onChat(ws, msg) {
  const room = ws._room;
  if (!room) return;
  const text = String(msg.text || "").slice(0, 280);
  if (!text.trim()) return;
  const from = ws._side;
  const peer = from === "P" ? room.guest : room.host;
  if (peer && peer.readyState === 1) {
    send(peer, { kind: "chat", from, text });
  }
}

function detachFromRoom(ws, room, why) {
  const wasHost = room.host === ws;
  if (wasHost) {
    room.host = null;
    ws._side = null;
  } else {
    room.guest = null;
    ws._side = null;
  }
  ws._room = null;
  const peer = wasHost ? room.guest : room.host;
  if (peer && peer.readyState === 1) {
    send(peer, { kind: "peer_left", side: wasHost ? "P" : "A", reason: why });
  }
  if (!room.host && !room.guest) {
    rooms.delete(room.code);
    console.log(`[${room.code}] closed (empty)`);
  } else {
    console.log(`[${room.code}] ${wasHost ? "P" : "A"} left (${why})`);
  }
}

function onClose(ws) {
  const room = ws._room;
  if (room) detachFromRoom(ws, room, "disconnect");
}

function send(ws, obj) {
  if (ws.readyState !== 1) return;
  try { ws.send(JSON.stringify(obj)); } catch {}
}

function sendError(ws, msg) {
  send(ws, { kind: "error", msg });
}

// --- Heartbeat (drop dead connections) ---
const HEARTBEAT_MS = 30_000;
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws._alive) {
      try { ws.terminate(); } catch {}
      return;
    }
    ws._alive = false;
    try { ws.ping(); } catch {}
  });
}, HEARTBEAT_MS);

// --- Garbage collection for empty rooms (>10 min idle) ---
const ROOM_TTL_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > ROOM_TTL_MS) {
      if (room.host)  try { room.host.close();  } catch {}
      if (room.guest) try { room.guest.close(); } catch {}
      rooms.delete(code);
      console.log(`[${code}] GC'd (idle ${Math.round((now - room.lastActivity)/1000)}s)`);
    }
  }
}, 60_000);

httpServer.listen(PORT, HOST, () => {
  console.log(`MHR broker v3.15 listening on ws://${HOST}:${PORT}`);
  console.log(`Health:  http://${HOST}:${PORT}/health`);
  console.log(`Rooms:   http://${HOST}:${PORT}/rooms`);
  if (CORS_ORIGINS.length) console.log(`CORS:    ${CORS_ORIGINS.join(", ")}`);
});