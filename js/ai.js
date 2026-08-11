// =============================================================
// Marvel Hero Rush TCG — Heuristic AI
// Simple but functional: priority is "advance board, swing with
// winning matchups, use counter when attacked". Runs entirely
// inside engine.execute() — no DOM access.
// =============================================================

(function (global) {
  "use strict";

  const E = global.MHR_ENGINE;
  const D = global.MHR_DATA;

  function aiTurn(state) {
    const me = state.players.A;
    const opp = state.players.P;

    // 1. Call phase: if FRONT is empty, try to fill it
    if (!me.battle.front && me.hand.length > 0) {
      // Pick cheapest Lv that needs no retreat (Lv 1-3) first,
      // or retreat-matchable if we have battle chars.
      const callPick = pickCallableCard(state, "A");
      if (callPick) {
        E.callCard(state, "A", callPick.handIdx, callPick.retreatUids);
      }
    }

    // 2. Battle phase: if FRONT ready and an opposing FRONT/BACK
    // is vulnerable, attack.
    if (me.battle.front && !state.winner) {
      const target = pickAttackTarget(state, "A");
      if (target) {
        // Counter window: defender may use counter first
        E.useCounter(state, "P", me.battle.front._uid);
        if (!state.winner) {
          E.attack(state, "A", me.battle.front._uid, target._uid);
        }
      }
    }

    // 3. End turn
    E.endTurn(state);
  }

  // Choose a card to call. Prefer highest Lv we can afford
  // (retreat cost from existing battle chars). If none affordable,
  // pick lowest Lv from hand.
  function pickCallableCard(state, side) {
    const p = state.players[side];
    // Collect candidates from hand, sorted by Lv desc
    const cands = p.hand
      .map((c, idx) => ({ c, idx }))
      .sort((a, b) => b.c.level - a.c.level);
    for (const cand of cands) {
      const lv = cand.c.level;
      if (lv <= 3) {
        // Free call (Lv 1-3 — but FRONT slot must be empty; callCard
        // will accept without retreat cost).
        return { handIdx: cand.idx, retreatUids: [] };
      }
      // Lv 4+: need to retreat exactly lv sum. Look at own FRONT
      // first (if a card is there).
      if (p.battle.front) {
        if (p.battle.front.level === lv) {
          return { handIdx: cand.idx, retreatUids: [p.battle.front._uid] };
        }
      }
      // Could not afford — skip
    }
    return null;
  }

  function pickAttackTarget(state, side) {
    const me = state.players[side];
    const opp = state.players[side === "P" ? "A" : "P"];
    const myPower = E.cardEffectivePower(state, side, me.battle.front);
    const targets = E.battleChars(opp);
    // Find a target we can beat
    const beaten = targets.find(t => E.cardEffectivePower(state, opp === state.players.P ? "P" : "A", t.card) < myPower);
    if (beaten) return beaten.card;
    // Otherwise swing at front anyway for chip damage
    return opp.battle.front || targets[0]?.card || null;
  }

  global.MHR_AI = { aiTurn };
})(window);
