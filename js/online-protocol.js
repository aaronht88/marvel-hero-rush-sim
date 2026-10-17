/* =============================================================
   online-protocol.js — message kinds shared between client
   (js/online.js) and server (server/broker.js). Pure constants.
   ============================================================= */
(function (root) {
  "use strict";
  root.MHR_ONLINE = {
    // client → server
    CREATE_ROOM: "create_room",
    JOIN_ROOM:   "join_room",
    LEAVE_ROOM:  "leave_room",
    READY:       "ready",
    ACTION:      "action",
    CHAT:        "chat",
    PING:        "ping",
    // server → client
    CREATED:        "created",
    JOINED:         "joined",
    PEER_JOINED:    "peer_joined",
    PEER_LEFT:      "peer_left",
    READY_ACK:      "ready_ack",
    MATCH_START:    "match_start",
    ACTION_RELAY:   "action",
    CHAT_RELAY:     "chat",
    PONG:           "pong",
    ERROR:          "error",
  };
})(window);