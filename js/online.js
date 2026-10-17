/* =============================================================
   online.js — client-side WebSocket module for MHR online rooms.
   v3.15. Talks to server/broker.js via WebSocket. Pure relay
   protocol: the broker forwards action events; this module
   applies the peer's action to the local engine and dispatches
   UI updates.

   Usage:
     const online = MHR_ONLINE.connect('wss://your-broker.example.com');
     online.createRoom();           // → { code } on 'created'
     online.joinRoom('K7MX');       // → { side } on 'joined'
     online.sendReady({...deck});   // when local player has picked
     online.sendAction({kind: 'endTurn'});
     online.sendAction({kind: 'call', handIdx: 3, retreatUids: [...]});

   Events (subscribe via on()):
     'created'        (code)
     'joined'         ({code, side, peer_connected})
     'peer_joined'    ({side})
     'peer_left'      ({side, reason})
     'match_start'    ({first_side, self_side, peer_deck})
     'action'         ({from, payload})     // relayed from peer
     'chat'           ({from, text})
     'error'          ({msg})
     'state'          ('connecting'|'open'|'closed')
   ============================================================= */
(function (root) {
  "use strict";

  const P = root.MHR_ONLINE;
  if (!P) { console.error("MHR_ONLINE protocol not loaded"); return; }

  function connect(url) {
    const sock = new WebSocket(url);
    const listeners = {};
    const queue = [];
    let state = "connecting";

    function emit(name, payload) {
      (listeners[name] || []).forEach((cb) => {
        try { cb(payload); } catch (e) { console.warn("online listener err", e); }
      });
    }

    function send(obj) {
      if (state === "open") {
        sock.send(JSON.stringify(obj));
      } else {
        queue.push(obj);
      }
    }

    sock.addEventListener("open", () => {
      state = "open";
      emit("state", "open");
      while (queue.length) sock.send(JSON.stringify(queue.shift()));
    });

    sock.addEventListener("close", () => {
      state = "closed";
      emit("state", "closed");
    });

    sock.addEventListener("error", (e) => {
      emit("error", { msg: e.message || "WS error" });
    });

    sock.addEventListener("message", (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (!m || typeof m.kind !== "string") return;
      switch (m.kind) {
        case P.CREATED:      emit("created", m.code); break;
        case P.JOINED:       emit("joined", m); break;
        case P.PEER_JOINED:  emit("peer_joined", m); break;
        case P.PEER_LEFT:    emit("peer_left", m); break;
        case P.READY_ACK:    emit("ready_ack", m); break;
        case P.MATCH_START:  emit("match_start", m); break;
        case P.ACTION_RELAY: emit("action", m); break;
        case P.CHAT_RELAY:   emit("chat", m); break;
        case P.PONG:         emit("pong", m); break;
        case P.ERROR:        emit("error", m); break;
        default: /* unknown */ break;
      }
    });

    return {
      on(name, cb) {
        (listeners[name] = listeners[name] || []).push(cb);
      },
      off(name, cb) {
        const arr = listeners[name] || [];
        const i = arr.indexOf(cb);
        if (i >= 0) arr.splice(i, 1);
      },
      createRoom()  { send({ kind: P.CREATE_ROOM }); },
      joinRoom(code) { send({ kind: P.JOIN_ROOM, code: String(code).toUpperCase() }); },
      leaveRoom()   { send({ kind: P.LEAVE_ROOM }); },
      sendReady(deck) { send({ kind: P.READY, deck }); },
      sendAction(payload) { send({ kind: P.ACTION, payload }); },
      sendChat(text) { send({ kind: P.CHAT, text: String(text).slice(0, 280) }); },
      sendPing() { send({ kind: P.PING }); },
      get state() { return state; },
      close() { try { sock.close(); } catch {} },
    };
  }

  // ---- Action dispatcher ----
  // Apply a peer's relayed action to the local engine. The action
  // payload's `kind` matches one of the engine's public functions.
  function applyPeerAction(eng, state, fromSide, payload) {
    if (!eng || !state || !payload || !payload.kind) return { ok: false, err: "bad payload" };
    // For now: peer actions always come from the OPPOSITE side. The caller
    // is responsible for ensuring the side parameter is correct.
    // (Engine actions do not know about online mode; we just call them.)
    switch (payload.kind) {
      case "mulligan":       return eng.mulligan(state, fromSide, payload.handIndices);
      case "setDeploy":      return eng.setDeploy(state, fromSide, payload.handIdx);
      case "call":           return eng.callCard(state, fromSide, payload.handIdx, payload.retreatUids || []);
      case "battleBaseMove": return eng.battleBaseMove(state, fromSide, payload.uid, payload.toBase);
      case "endTurn":        eng.endTurn(state); return { ok: true };
      case "resolveCounter": return eng.resolveCounter(state, payload.decision);
      // For complex flows (mulligan pick, retreat picker, COUNTER pick), the
      // peer broadcasts a 'modal_response' kind carrying the UI-side decision
      // payload verbatim; the host engine dispatches it as appropriate.
      case "modal_response":
        return applyModalResponse(eng, state, fromSide, payload);
      default:
        return { ok: false, err: `unknown action kind: ${payload.kind}` };
    }
  }

  function applyModalResponse(eng, state, fromSide, payload) {
    // payload.modalKind ∈ { "mulligan", "retreat", "counter" }
    if (!payload.modalKind) return { ok: false, err: "missing modalKind" };
    if (payload.modalKind === "mulligan") {
      return eng.mulligan(state, fromSide, payload.handIndices);
    }
    if (payload.modalKind === "retreat") {
      // retreat-cost picker for a Lv4+ call
      return eng.callCard(state, fromSide, payload.handIdx, payload.retreatUids || []);
    }
    if (payload.modalKind === "counter") {
      return eng.resolveCounter(state, payload.decision);
    }
    return { ok: false, err: "unknown modalKind" };
  }

  root.MHR_ONLINE_CLIENT = { connect, applyPeerAction };
})(window);