// =============================================================
// Marvel Hero Rush TCG — Engine
// Pure game logic. No DOM access. Emits events via a callback
// so the UI layer (app.js) can react.
// =============================================================
// State shape:
//   {
//     players: { P: playerState, A: aiState },
//     activeSide: "P" | "A",
//     turn: int,
//     phase: "DRAW" | "CALL" | "BATTLE" | "END",
//     log: [{ side, msg }],
//     winner: null | "P" | "A" | "DRAW",
//     deckNames: { P, A },
//   }
//
// playerState = {
//   name, deck[], hand[], retreat[], void[],
//   battle: { front, back, wing: [w1,w2] },
//   base: { faceDown: [] },          // face-down set cards
//   rushPoints,
//   attached: {},                     // cardInstanceId -> [card, ...]
// }
// Card instances are full objects; identity preserved across
// hand → field → retreat so effect source tracking works.
// =============================================================

(function (global) {
  "use strict";

  const DATA = global.MHR_DATA;
  const DECKS = DATA.DECKS;

  // ---- Constants ----
  const RUSH_TO_WIN = 9;
  const HAND_SIZE_START = 7;
  const HAND_SIZE_MAX = 9;          // soft cap shown in UI
  const BATTLE_SIZE = 4;            // front + back + 2 wing slots

  // ---- Event bus ----
  // engine emits structured events so UI can stay dumb.
  const EVT = {
    LOG: "log",          // (entry) — appended log line
    STATE: "state",      // ()     — re-render
    PROMPT: "prompt",    // (q)    — ask UI for player choice
    PHASE: "phase",      // (phase)
    TURN: "turn",        // (side, turn)
    WIN: "win",          // (winner, reason)
  };

  // ---- helpers ----
  const uid = (() => {
    let n = 1;
    return () => "c" + (n++);
  })();

  function cloneCard(c) {
    // Shallow clone; effect fields unchanged, uid added.
    return Object.assign({}, c, { _uid: uid() });
  }

  function deepClone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function log(state, msg, side) {
    state.log.push({ side: side || null, msg });
  }

  // =============================================================
  // 0. SETUP
  // =============================================================
  function newPlayer(name, deckArr, deckLabel) {
    const deck = deckArr.map(cloneCard);
    // Shuffle (Fisher-Yates)
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return {
      name,
      deckLabel,
      deck,
      hand: [],
      retreat: [],
      voidZone: [],
      battle: { front: null, back: null, wing: [null, null] },
      base: { faceDown: [] },
      rushPoints: 0,
      attached: {}, // uid -> [card, ...]
      _actedThisTurn: {}, // uid -> true (for ONCE PER TURN effects)
      _attackedThisTurn: {}, // uid -> true
    };
  }

  function initGame(deckNameP, deckNameA, rngSeed) {
    const dp = DECKS[deckNameP];
    const da = DECKS[deckNameA];
    if (!dp || !da) throw new Error("Unknown deck: " + (deckNameP || deckNameA));

    const state = {
      players: {
        P: newPlayer("Player", dp, deckNameP),
        A: newPlayer("AI", da, deckNameA),
      },
      activeSide: "P",        // player goes first
      turn: 1,
      phase: "DRAW",
      log: [],
      winner: null,
      deckNames: { P: deckNameP, A: deckNameA },
    };

    // Both players draw opening hand of 7
    drawTo(state, "P", HAND_SIZE_START);
    drawTo(state, "A", HAND_SIZE_START);

    log(state, `=== Game Start ===  Player:${deckNameP} vs AI:${deckNameA}`);
    log(state, `第 1 回合開始（Player 先手）`);

    // First turn skip battle phase (assumption, common TCG convention)
    state._firstTurn = true;
    return state;
  }

  function drawTo(state, side, n) {
    const p = state.players[side];
    while (p.hand.length < n) {
      if (p.deck.length === 0) {
        // Deck-out: the OPPONENT wins
        const opp = side === "P" ? "A" : "P";
        log(state, `${p.name} 牌庫耗盡！${state.players[opp].name} 獲勝（deck-out）`, opp);
        state.winner = opp;
        return;
      }
      p.hand.push(p.deck.shift());
    }
  }

  // =============================================================
  // 1. PHASE FLOW
  // =============================================================
  // Returns: a list of pending "prompt" requests the UI must resolve
  // before the engine can continue. For AI side, the AI module
  // resolves them itself.
  function startTurn(state) {
    const side = state.activeSide;
    const p = state.players[side];
    p._actedThisTurn = {};
    p._attackedThisTurn = {};

    if (state.turn > 1 || !state._firstTurn || side === "A") {
      // Draw phase: +1 card
      drawTo(state, side, p.hand.length + 1);
      log(state, `${p.name} 抽 1 張牌（手牌 ${p.hand.length}）`, side);
    }

    // AUTO effects: refresh stat recalc at turn start (e.g. Lv
    // changes from hand-size, etc.). Hook runs each turn-start.
    state.phase = "CALL";
    autoRefreshBuffs(state, side, "turnStart");

    // AI on its turn decides everything end-to-end via ai.js
    // For human, we just expose actions.
  }

  function endTurn(state) {
    const side = state.activeSide;
    const p = state.players[side];
    // turn-end TRIGs (e.g. Thor 「Thunder Ally」 did-not-attack)
    autoRefreshBuffs(state, side, "turnEnd");

    // Switch side
    state.activeSide = side === "P" ? "A" : "P";
    if (state.activeSide === "P") state.turn++;
    state.phase = "DRAW";

    if (state.winner) {
      log(state, `遊戲結束！贏家：${state.players[state.winner].name}`);
      return;
    }
    log(state, `第 ${state.turn} 回合，${state.players[state.activeSide].name} 行動`);
    startTurn(state);
  }

  // =============================================================
  // 2. ZONES — query helpers
  // =============================================================
  function battleChars(p) {
    const out = [];
    if (p.battle.front) out.push({ card: p.battle.front, slot: "front" });
    if (p.battle.back) out.push({ card: p.battle.back, slot: "back" });
    p.battle.wing.forEach((c, i) => {
      if (c) out.push({ card: c, slot: "wing" + (i + 1) });
    });
    return out;
  }

  function isInBattle(p, card) {
    if (!card) return null;
    if (p.battle.front === card) return "front";
    if (p.battle.back === card) return "back";
    const wi = p.battle.wing.indexOf(card);
    if (wi >= 0) return "wing" + (wi + 1);
    return null;
  }

  function cardEffectivePower(state, side, card) {
    if (!card) return 0;
    let base = DATA.numPower(card.power);
    // Attached cards can add Power (BP01-023 AUTO【FIELD】+1000)
    const att = state.players[side].attached[card._uid] || [];
    for (const a of att) {
      base += attachBonusPower(a, card);
    }
    // Per-turn Power modifiers (Power+2000 etc.) stored on card
    if (card._powerMod) base += card._powerMod;
    return base;
  }

  function attachBonusPower(attCard /* attached card */, host /* host card */) {
    // Hard-coded bonuses for implemented attach effects.
    const t = attCard.effect || "";
    if (t.includes("Power+1000")) return 1000;
    return 0;
  }

  // =============================================================
  // 3. CALL / RETREAT
  // =============================================================
  // Call a card from hand to BATTLE (front) by paying retreat
  // cost: combined Lv of selected retreating cards must equal
  // the called card's Lv (Lv1-3 need NO retreat cost).
  function callCard(state, side, handIdx, retreatUids) {
    const p = state.players[side];
    const card = p.hand[handIdx];
    if (!card) return { ok: false, err: "手牌索引無效" };
    if (p.battle.front) return { ok: false, err: "FRONT 位已被佔用（要先 retreat）" };

    const lv = card.level;
    if (lv >= 4) {
      // Need retreat: combine Lv of selected cards = lv
      const sources = [];
      const sumLv = retreatUids.reduce((s, uid) => {
        const c = findCardOnField(p, uid);
        if (!c) return s;
        sources.push(c);
        return s + c.level;
      }, 0);
      if (sumLv !== lv) {
        return { ok: false, err: `叫 Lv${lv} 需要 retreat 總 Lv=${lv}（目前 ${sumLv}）` };
      }
      sources.forEach(c => retreatCard(state, side, c, "call-cost"));
    }

    // Remove from hand, place in front
    p.hand.splice(handIdx, 1);
    p.battle.front = card;
    p._actedThisTurn[card._uid] = true;
    log(state, `${p.name} 叫出 ${shortName(card)} 到 FRONT（Lv${lv}）`, side);

    // Trigger on-call effects (TRIG【FIELD】 when enters field)
    triggerEnter(state, side, card);
    return { ok: true };
  }

  function findCardOnField(p, uid) {
    if (p.battle.front && p.battle.front._uid === uid) return p.battle.front;
    if (p.battle.back && p.battle.back._uid === uid) return p.battle.back;
    for (const w of p.battle.wing) {
      if (w && w._uid === uid) return w;
    }
    for (const c of p.base.faceDown) {
      if (c && c._uid === uid) return c;
    }
    return null;
  }

  function retreatCard(state, side, card, reason) {
    const p = state.players[side];
    // Remove from wherever it is
    if (p.battle.front === card) p.battle.front = null;
    else if (p.battle.back === card) p.battle.back = null;
    else {
      const wi = p.battle.wing.indexOf(card);
      if (wi >= 0) p.battle.wing[wi] = null;
    }
    // Attached cards go with it (assumed: attachments are cleared
    // when host retreats). Move them to retreat.
    const att = p.attached[card._uid] || [];
    delete p.attached[card._uid];
    p.retreat.push(card, ...att);
    log(state, `${p.name} ${shortName(card)} 進入 RETREAT (${reason || "retreat"})`, side);
  }

  // =============================================================
  // 4. BATTLE
  // =============================================================
  // Power-compare: lower Power retreats. Ties = Both Lose.
  // Rush Point: retreat caused by opponent's attack/ability = +1 RP
  // to the opponent. (Assumption — see README.)
  function attack(state, attackerSide, attackerUid, targetUid) {
    const atkP = state.players[attackerSide];
    const defP = state.players[attackerSide === "P" ? "A" : "P"];
    const atk = findCardOnField(atkP, attackerUid);
    const tgt = findCardOnField(defP, targetUid);
    if (!atk) return { ok: false, err: "找不到攻擊者" };
    if (!tgt) return { ok: false, err: "找不到目標" };
    if (atk._attackedThisTurn && atk._attackedThisTurn[atk._uid]) {
      // Allow only if has Double Attack — simplified: block re-attack
      return { ok: false, err: "本回合已攻擊過" };
    }
    atk._attackedThisTurn = atk._attackedThisTurn || {};
    atk._attackedThisTurn[atk._uid] = true;

    // COUNTER·ACTI window: defender may use counter from hand
    // (For human vs AI: AI decides here. UI prompts human only
    // when called from P side; we expose a hook.)
    const aPower = cardEffectivePower(state, attackerSide, atk);
    const tPower = cardEffectivePower(state, attackerSide === "P" ? "A" : "P", tgt);

    log(state, `${atkP.name} ${shortName(atk)} (P${aPower}) 攻擊 ${defP.name} ${shortName(tgt)} (P${tPower})`, attackerSide);

    // Compare
    let atkRetreat = false, tgtRetreat = false;
    if (aPower > tPower) { tgtRetreat = true; }
    else if (aPower < tPower) { atkRetreat = true; }
    else { atkRetreat = true; tgtRetreat = true; } // Both Lose

    if (tgtRetreat) {
      const wasFront = defP.battle.front === tgt;
      retreatCard(state, attackerSide === "P" ? "A" : "P", tgt, "戰敗");
      // Rush Point: opponent retreated your target → +1 RP
      const opp = attackerSide;
      state.players[opp].rushPoints = Math.min(RUSH_TO_WIN, state.players[opp].rushPoints + 1);
      log(state, `${state.players[opp].name} +1 Rush Point（${shortName(tgt)} 戰敗）`, opp);
      checkWin(state);
      // If FRONT was the target and lost, opponent may be eligible
      // for Rush Point gain (already handled above). Empty FRONT
      // for next round — caller must re-call to fill.
    }
    if (atkRetreat) {
      retreatCard(state, attackerSide, atk, "戰敗");
      const opp = attackerSide === "P" ? "A" : "P";
      state.players[opp].rushPoints = Math.min(RUSH_TO_WIN, state.players[opp].rushPoints + 1);
      log(state, `${state.players[opp].name} +1 Rush Point（${shortName(atk)} 戰敗）`, opp);
      checkWin(state);
    }
    return { ok: true };
  }

  // =============================================================
  // 5. RUSH POINT / WIN CHECK
  // =============================================================
  function checkWin(state) {
    if (state.winner) return;
    if (state.players.P.rushPoints >= RUSH_TO_WIN) {
      state.winner = "P";
      log(state, `Player 達到 ${RUSH_TO_WIN} Rush Point，獲勝！`);
    } else if (state.players.A.rushPoints >= RUSH_TO_WIN) {
      state.winner = "A";
      log(state, `AI 達到 ${RUSH_TO_WIN} Rush Point，獲勝！`);
    }
  }

  // =============================================================
  // 6. EFFECT IMPLEMENTATIONS
  // =============================================================
  // Only the most common patterns from the 4 preset decks are
  // implemented. Unimplemented cards still go on the field but
  // their effects are stubbed with a "未實裝" log line.
  //
  // The implemented subset focuses on:
  //   - draw N cards
  //   - +Power / -Power (one turn)
  //   - prune (= remove from field → VOID) a single character
  //   - place card from RETREAT back to field
  //   - COUNTER·ACTI from HAND (BP01-002 type)
  //   - move BATTLE↔BASE
  //   - gain Rush Point from effects
  // =============================================================

  function triggerEnter(state, side, card) {
    // Fire TRIG【FIELD】 / TRIG【BATTLE】 effects when card enters
    // battle. We try a small set of patterns; fall through to
    // a stub log otherwise.
    const t = card.effect || "";
    if (!t.trim()) {
      log(state, `[效果未實裝] ${shortName(card)} 入場效果`, side);
      return;
    }

    // Pattern: "you draw 1 card"
    if (/you draw (\d+) card/i.test(t)) {
      const m = t.match(/you draw (\d+) card/i);
      const n = parseInt(m[1], 10);
      drawTo(state, side, state.players[side].hand.length + n);
      log(state, `[效果] ${shortName(card)} 入場：抽 ${n} 張`, side);
      // BP01-011 also gets "second chance to attack"
      if (/second chance to attack/i.test(t)) {
        card._doubleAttack = true;
        log(state, `[效果] ${shortName(card)} 本回合可攻擊 2 次`, side);
      }
      return;
    }

    // Pattern: "you prune 1 of your opponent's characters with LvX or below"
    if (/you prune 1 of your opponent's character/i.test(t)) {
      // Simplified: prune weakest opposing battle char matching filter.
      const opp = side === "P" ? "A" : "P";
      const oppBattle = battleChars(state.players[opp]);
      const lvMatch = t.match(/Lv(\d+) or below/i);
      const maxLv = lvMatch ? parseInt(lvMatch[1], 10) : 99;
      const powMatch = t.match(/Power (\d+) or lower/i);
      const maxPow = powMatch ? parseInt(powMatch[1], 10) : 99999;
      const target = oppBattle.find(x => x.card.level <= maxLv && cardEffectivePower(state, opp, x.card) <= maxPow);
      if (target) {
        pruneCard(state, opp, target.card);
        log(state, `[效果] ${shortName(card)} 入場：除外 ${shortName(target.card)}`, side);
        gainRushPoint(state, side, "除外效果");
      } else {
        log(state, `[效果] ${shortName(card)} 入場：沒有合法目標除外`, side);
      }
      return;
    }

    // Pattern: "opponent's character in FRONT gets Power-X000"  (BP01-007 type)
    if (/opponent's character in FRONT gets Power-/i.test(t)) {
      const opp = side === "P" ? "A" : "P";
      const target = state.players[opp].battle.front;
      if (target) {
        const m = t.match(/Power-(\d+)/);
        const amt = m ? parseInt(m[1], 10) : 0;
        target._powerMod = (target._powerMod || 0) - amt;
        log(state, `[效果] ${shortName(card)}：${shortName(target)} 本回合 -${amt} Power`, side);
      }
      return;
    }

    // Pattern: TRIG【HAND】when "your red character attacks, you may discard this card in HAND. ... gets Power+3000"
    // (BP01-005 / BP01-002 style) — these are HAND-side triggers,
    // handled via canUseCounter() below rather than triggerEnter.

    // Fall-through
    log(state, `[效果未實裝] ${shortName(card)}：${truncate(t, 60)}`, side);
  }

  function pruneCard(state, side, card) {
    const p = state.players[side];
    if (p.battle.front === card) p.battle.front = null;
    else if (p.battle.back === card) p.battle.back = null;
    else {
      const wi = p.battle.wing.indexOf(card);
      if (wi >= 0) p.battle.wing[wi] = null;
    }
    const att = p.attached[card._uid] || [];
    delete p.attached[card._uid];
    p.voidZone.push(card, ...att);
  }

  function gainRushPoint(state, side, why) {
    state.players[side].rushPoints = Math.min(RUSH_TO_WIN, state.players[side].rushPoints + 1);
    log(state, `${state.players[side].name} +1 Rush Point（${why}）`, side);
    checkWin(state);
  }

  // Refresh Power/R buffs at turn start/end. Many AUTO effects
  // are turn-conditional (e.g. BP01-004 "Lv+X if only red"). For
  // v1 we recompute per-character mods at boundaries; complex
  // AUTO effects stay stubbed.
  function autoRefreshBuffs(state, side, when) {
    const p = state.players[side];
    battleChars(p).forEach(({ card }) => {
      if (when === "turnStart") {
        // Reset per-turn Power mod from previous turn
        // (mods set during THIS turn are kept; only clear on new turn)
        // For now: keep _powerMod across turns but reset at start
        // — most "in this turn" effects expire at end.
        // (Proper implementation: track per-turn expiry.)
        card._powerMod = 0;
      }
      if (when === "turnEnd") {
        // TRIG【WING】: did not attack → opponent char -Power X
        // (BP01-003 「Thunder Ally」Thor)
        if (card.effect && /TRIG【WING】/.test(card.effect)) {
          const attacked = p._attackedThisTurn[card._uid];
          if (!attacked) {
            const opp = side === "P" ? "A" : "P";
            const t = card.effect;
            const m = t.match(/Power-X in this turn/);
            if (m) {
              const amt = DATA.numPower(card.power);
              // Apply to opp's front
              const tgt = state.players[opp].battle.front;
              if (tgt) {
                tgt._powerMod = (tgt._powerMod || 0) - amt;
                log(state, `[效果] ${shortName(card)} 未攻擊：${shortName(tgt)} -${amt} Power`, side);
              }
            }
          }
        }
        card._powerMod = 0;
      }
    });
  }

  // COUNTER·ACTI window for defender. Returns true if a counter
  // was found and used. The engine caller (AI or human prompt)
  // decides.
  function useCounter(state, defenderSide, attackerUid) {
    // For each hand card matching COUNTER·ACTI, ask the player to
    // decide. We auto-pick first valid counter (heuristic).
    const p = state.players[defenderSide];
    for (let i = 0; i < p.hand.length; i++) {
      const c = p.hand[i];
      if (!c.effect) continue;
      if (!/COUNTER·ACTI【HAND】/.test(c.effect)) continue;
      if (/Power-(\d+)/.test(c.effect)) {
        const m = c.effect.match(/Power-(\d+)/);
        const amt = parseInt(m[1], 10);
        // Discard card
        p.hand.splice(i, 1);
        p.retreat.push(c);
        // Apply to attacker's effective power (negative mod)
        const atkP = state.players[defenderSide === "P" ? "A" : "P"];
        const atk = findCardOnField(atkP, attackerUid);
        if (atk) {
          atk._powerMod = (atk._powerMod || 0) - amt;
          log(state, `[COUNTER] ${p.name} 從手牌棄 ${shortName(c)}：${shortName(atk)} -${amt} Power`, defenderSide);
        }
        return true;
      }
    }
    return false;
  }

  // =============================================================
  // 7. UTILITIES EXPORTED FOR UI
  // =============================================================
  function shortName(c) {
    if (!c) return "?";
    // Trim 「Japanese brackets」 for display
    return c.name.replace(/^「.*」/, "").trim() || c.name;
  }

  function truncate(s, n) {
    if (!s) return "";
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  // ---- Public API ----
  global.MHR_ENGINE = {
    initGame,
    startTurn,
    endTurn,
    callCard,
    retreatCard,
    attack,
    useCounter,
    cardEffectivePower,
    battleChars,
    findCardOnField,
    isInBattle,
    shortName,
    drawTo,
    EVT,
    RUSH_TO_WIN,
    HAND_SIZE_MAX,
  };
})(window);
