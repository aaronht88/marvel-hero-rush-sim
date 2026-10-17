# MHR Online Room (v3.15)

Lightweight online room for the MHR battle simulator. Two players share a
4-character room code; an external WebSocket broker relays action events
between them. Each client runs the engine locally; the broker holds
**no game state** — it's a pure relay.

## Architecture

```
┌──────────────────┐                   ┌──────────────────┐
│ Client P1        │                   │ Client P2        │
│  engine.js (MHR) │                   │  engine.js (MHR) │
│  online.js ──────┼───── WS broker ──┼─ online.js       │
│  app.js (UI)     │   (relay only)    │  app.js (UI)     │
└──────────────────┘                   └──────────────────┘
```

Each client runs `engine.js` locally and broadcasts action events
(`call`, `attack`, `endTurn`, `setDeploy`, `battleBaseMove`, `mulligan`,
`modal_response`). The peer applies the action to its local engine via
`MHR_ONLINE_CLIENT.applyPeerAction()`. Both clients converge to the
same state.

## Deploy the broker

The broker is a Node 18+ WebSocket server. No DB, no game logic. ~250 LOC.

```bash
cd server
npm install
PORT=8787 node broker.js
```

Free-tier deploys that work:
- **Render**: create a Web Service, build = `npm install`, start = `node broker.js`
- **Railway**: one-click Node deploy
- **Fly.io**: `fly launch`, `fly deploy`
- **Zeabur**: link repo, set start command to `node server/broker.js`
- **VPS**: `node` daemon + nginx reverse proxy + Let's Encrypt

Env vars:
- `PORT` — listen port (default 8787)
- `HOST` — bind host (default 0.0.0.0)
- `CORS_ORIGINS` — comma-separated allow-list for browser clients
  (e.g. `https://aaronht88.github.io,http://localhost:8080`)

Health check: `GET /health` returns `{ok, rooms, uptime, version}`.
Room list: `GET /rooms` returns `{active, count}`.

## Run the client

The client (GitHub Pages) has no install step. The "🌐 線上對戰" section
on the setup screen takes a broker URL (`wss://...`) and a 4-char room
code. Two players connect to the same broker and share the code.

Flow:
1. P1 picks a deck in the deck-picker.
2. P1 types broker URL, clicks **連接伺服器**.
3. P1 clicks **🏠 建立房間** → server returns 4-char code (e.g. `K7MX`).
4. P1 shares `K7MX` with P2 (any channel — message, voice, etc.).
5. P2 picks a deck, connects, types `K7MX`, clicks **🚪 加入房間**.
6. Both click **✅ 準備好** → server sends `match_start` to both.
7. Each client's online module boots the engine with both decks and
   the assigned side (`P` host / `A` joiner). First mover is `P`.
8. Local actions route through `MHR_ONLINE_UI.localAction(payload)`;
   peer's relayed actions apply to the same engine.

## What's in v3.15

- ✅ `server/broker.js` — production-ready WS broker
- ✅ `server/package.json` — `ws` dep only
- ✅ `js/online-protocol.js` — message-kind constants
- ✅ `js/online.js` — client WS module
- ✅ `index.html` — "🌐 線上對戰" section + 4 buttons (connect, create, join, ready)
- ✅ `css/styles.css` — online room UI tokens
- ✅ `js/app.js` — Online module integration (lobby, room state, match_start boot)

## What's NOT in v3.15 (deferred to v3.16)

The mid-game action handlers (call / attack / setDeploy / battleBaseMove /
mulligan / counter pick) currently operate on the local-vs-AI `state`
closure. Wiring them through `Online.localAction()` requires refactoring
each handler to read state from a swappable variable. Shipped scope:
**lobby + room code + match-start protocol** end-to-end. v3.16 will wire
the action handlers so a complete match can be played.

## Protocol

Client → server (JSON over WS):
```json
{ "kind": "create_room" }
{ "kind": "join_room", "code": "K7MX" }
{ "kind": "leave_room" }
{ "kind": "ready", "deck": { "name": "RED_Aggro" } }
{ "kind": "action", "payload": { "kind": "endTurn" } }
{ "kind": "chat", "text": "..." }
```

Server → client:
```json
{ "kind": "created", "code": "K7MX" }
{ "kind": "joined",  "code": "K7MX", "side": "A", "peer_connected": true }
{ "kind": "peer_joined", "side": "A" }
{ "kind": "peer_left",   "side": "A", "reason": "disconnect" }
{ "kind": "ready_ack",   "waiting_for_peer": true }
{ "kind": "match_start", "first_side": "P", "self_side": "A", "peer_deck": {...} }
{ "kind": "action",      "from": "P", "payload": {...} }
{ "kind": "chat",        "from": "A", "text": "..." }
{ "kind": "error",       "msg": "..." }
```

## Local test (no broker deploy needed)

```bash
# Terminal 1: start broker on localhost
cd server && PORT=8787 node broker.js

# Browser 1: open http://localhost:8080/index.html
#  - pick a deck
#  - type ws://localhost:8787 in online URL
#  - click 建立房間 → note 4-char code

# Browser 2 (incognito): same
#  - pick a different deck
#  - same ws://localhost:8787 URL
#  - type the 4-char code → 加入房間
#  - both click ✅ 準備好
```

(For `ws://` to work, the broker must be served over HTTP at the same
origin as the page, OR the broker must set CORS headers; localhost
is fine. For production HTTPS, use `wss://` and set `CORS_ORIGINS`.)

## Costs

- Broker on free tier: $0 (Render / Railway / Fly.io)
- Static client on GitHub Pages: $0 (already deployed)
- No database, no S3, no server-side game logic

## Security notes

The broker holds zero game state. A malicious client can send fake
action events but the *receiver* applies them via the local engine, so
the only way to "cheat" is to send an action that the engine would
reject (engine returns `{ok:false, err}`). Future hardening: sign
actions with a per-room HMAC; reject actions that violate the
active-side rule (the engine's turn check still catches this).

## License

MIT (same as parent repo).
