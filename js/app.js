// =============================================================
// Marvel Hero Rush TCG — App (UI binding)
// Owns the DOM, delegates game logic to engine.js. Listens to
// engine.log/state events and re-renders.
// =============================================================

(function () {
  "use strict";

  const E = window.MHR_ENGINE;
  const AI = window.MHR_AI;
  const DATA = window.MHR_DATA;

  // ---- Global state ----
  let state = null;          // engine state
  let view = {
    selectedHandIdx: null,
    attackerUid: null,       // when in attack-mode
    pendingCall: null,       // { handIdx, retreatUids:Set }
    isPlayerTurn: true,
    aiTimer: null,
  };

  // ---- Setup screen ----
  function renderDeckPicker() {
    const root = document.getElementById("deck-picker");
    root.innerHTML = "";
    const decks = Object.keys(DATA.DECKS);
    const colorLabels = { Red: "紅", Yellow: "黃", Blue: "藍", Green: "綠" };
    decks.forEach((dk, i) => {
      const arr = DATA.DECKS[dk];
      // Determine colors used
      const cols = new Set(arr.map(c => c.attribute));
      const colStr = [...cols].map(c => `<span class="color-chip ${c}">${colorLabels[c] || c}</span>`).join("");
      const card = document.createElement("div");
      card.className = "deck-card";
      card.dataset.deck = dk;
      card.innerHTML = `
        <div class="deck-title">${dk.replace("_", " ")}</div>
        <div class="deck-meta">${arr.length} 張 · AI 用 ${decks[(i+1)%decks.length].replace("_"," ")}</div>
        <div class="deck-colors">${colStr}</div>
      `;
      card.addEventListener("click", () => {
        document.querySelectorAll(".deck-card").forEach(c => c.classList.remove("selected"));
        card.classList.add("selected");
        document.getElementById("btn-start").disabled = false;
        view._chosenDeck = dk;
      });
      root.appendChild(card);
    });
  }

  function startBattle() {
    const deck = view._chosenDeck || "RED_Aggro";
    const others = Object.keys(DATA.DECKS).filter(k => k !== deck);
    const aiDeck = others[Math.floor(Math.random() * others.length)];

    state = E.initGame(deck, aiDeck);
    view.selectedHandIdx = null;
    view.attackerUid = null;
    view.pendingCall = null;
    view.isPlayerTurn = true;

    document.getElementById("setup-screen").classList.remove("visible");
    document.getElementById("battle-screen").classList.add("visible");

    render();
    // engine already moved to PHASE CALL after setup
  }

  document.getElementById("btn-start").addEventListener("click", startBattle);

  // ---- Render: topbar HUD ----
  function renderHud() {
    const p = state.players.P;
    const a = state.players.A;
    document.getElementById("rp-fill-p").style.width = (p.rushPoints / E.RUSH_TO_WIN * 100) + "%";
    document.getElementById("rp-fill-a").style.width = (a.rushPoints / E.RUSH_TO_WIN * 100) + "%";
    document.getElementById("rp-text-p").textContent = `${p.rushPoints} / ${E.RUSH_TO_WIN}`;
    document.getElementById("rp-text-a").textContent = `${a.rushPoints} / ${E.RUSH_TO_WIN}`;
    document.getElementById("turn-num").textContent = `回合 ${state.turn}`;
    document.getElementById("phase-label").textContent = state.phase;
    document.getElementById("active-side").textContent =
      state.activeSide === "P" ? "Player 行動" : "AI 思考中…";

    const tb = document.querySelector(".battle-topbar");
    tb.classList.toggle("ai-turn", state.activeSide === "A");
    tb.classList.toggle("player-turn", state.activeSide === "P");

    document.getElementById("hud-meta-p").textContent = `🎴 ${p.deckLabel}`;
    document.getElementById("hud-meta-a").textContent = `🎴 ${a.deckLabel}`;
  }

  function renderBench() {
    const p = state.players.P;
    const a = state.players.A;
    document.getElementById("deck-cnt-p").textContent = p.deck.length;
    document.getElementById("deck-cnt-a").textContent = a.deck.length;
    document.getElementById("retreat-cnt-p").textContent = p.retreat.length;
    document.getElementById("retreat-cnt-a").textContent = a.retreat.length;
    document.getElementById("void-cnt-p").textContent = p.voidZone.length;
    document.getElementById("void-cnt-a").textContent = a.voidZone.length;
    document.getElementById("hand-cnt-p").textContent = p.hand.length;
    document.getElementById("hand-cnt-a").textContent = a.hand.length;
  }

  function renderField() {
    ["P", "A"].forEach(side => {
      const player = state.players[side];
      ["front", "back", "wing1", "wing2"].forEach(slot => {
        const zoneEl = document.querySelector(`.field-${side === "P" ? "p" : "ai"} [data-slot="${slot}"]`);
        if (!zoneEl) return;
        zoneEl.innerHTML = `<span class="zone-label">${slot.toUpperCase()}</span>`;
        let card = null;
        if (slot === "front") card = player.battle.front;
        else if (slot === "back") card = player.battle.back;
        else if (slot === "wing1") card = player.battle.wing[0];
        else if (slot === "wing2") card = player.battle.wing[1];
        if (card) {
          zoneEl.classList.add("has-card");
          zoneEl.appendChild(buildMiniCard(card, side, slot));
          // Highlight target zones when in attack mode
          if (side !== state.activeSide && view.attackerUid && isAttackable(state, side, slot, card)) {
            zoneEl.classList.add("is-target");
          }
          // Highlight source when chosen as attacker
          if (side === state.activeSide && view.attackerUid === card._uid) {
            zoneEl.classList.add("is-source");
          }
        } else {
          zoneEl.classList.remove("has-card", "is-target", "is-source");
        }
      });
    });
  }

  function buildMiniCard(card, side, slot) {
    const div = document.createElement("div");
    div.className = "mini-card";
    div.dataset.uid = card._uid;
    div.dataset.attr = card.attribute;
    const pow = E.cardEffectivePower(state, side, card);
    const implemented = isEffectImplemented(card);
    if (!implemented) div.classList.add("unimplemented");

    const img = document.createElement("img");
    img.src = DATA.artPath(card);
    img.alt = card.name;
    img.onerror = () => { img.style.background = "#222"; img.alt = "🎴"; };
    div.appendChild(img);

    const name = document.createElement("div");
    name.className = "mc-name";
    name.textContent = E.shortName(card);
    div.appendChild(name);

    const stats = document.createElement("div");
    stats.className = "mc-stats";
    stats.innerHTML = `<span class="lv">Lv${card.level}</span><span class="pw">P${pow}</span><span class="rg">R${DATA.numRange(card.attackRange)}</span>`;
    div.appendChild(stats);

    // Click handler
    div.addEventListener("click", (e) => {
      e.stopPropagation();
      onZoneCardClick(side, slot, card);
    });
    return div;
  }

  function isAttackable(state, defSide, slot, defCard) {
    // For simplicity: any opponent battle char is attackable if
    // their FRONT/BACK is set, and our FRONT is set.
    return state.activeSide !== defSide && state.players[state.activeSide].battle.front;
  }

  // ---- Hand render ----
  function renderHand() {
    const root = document.getElementById("hand-list");
    root.innerHTML = "";
    const p = state.players.P;
    p.hand.forEach((c, i) => {
      const div = document.createElement("div");
      div.className = "hand-card";
      div.dataset.uid = c._uid;
      div.dataset.attr = c.attribute;
      div.style.position = "relative";
      const canCall = !state.players.P.battle.front;
      if (!canCall) div.classList.add("unplayable");
      if (view.selectedHandIdx === i) div.classList.add("selected");

      const implemented = isEffectImplemented(c);
      if (!implemented) div.classList.add("unimplemented");

      const img = document.createElement("img");
      img.src = DATA.artPath(c);
      img.alt = c.name;
      img.onerror = () => { img.style.background = "#222"; img.alt = "🎴"; };
      div.appendChild(img);

      const name = document.createElement("div");
      name.className = "hc-name";
      name.textContent = E.shortName(c);
      div.appendChild(name);

      const stats = document.createElement("div");
      stats.className = "hc-stats";
      stats.innerHTML = `<span class="lv">Lv${c.level}</span><span class="pw">P${DATA.numPower(c.power)}</span>`;
      div.appendChild(stats);

      div.addEventListener("click", () => onHandClick(i));
      root.appendChild(div);
    });
  }

  // Track which card effects are at least partially implemented
  // (used to dim unhandled ones).
  const implementedCache = new WeakMap();
  function isEffectImplemented(card) {
    if (implementedCache.has(card)) return implementedCache.get(card);
    const t = card.effect || "";
    let ok = true;
    if (!t.trim()) ok = false;
    // Conservative: mark known unimplemented patterns
    const patterns = [
      /TRIG【VOID】/, /TRIG【RETREAT】/, /TRIG【HAND】:When your \w+ character is in Both Lose/,
      /UNIQUE\(/, /second chance to attack/i, /Double Attack/,
      /BATTLE Move/, /attach/i, /cover/i,
      /place .* face down/i, /place the top \d+ cards of your deck face down/,
      /swap .* and .*/, /move .* from BATTLE to .* BASE/, /move .* from .* BASE/,
      /acti.*BATTLE\/ONCE PER TURN/i, /acti.*HAND】:You prune/i,
      /acti.*HAND】:If you have 3 yellow/i, /acti.*HAND】:If your opponent has/i,
      /acti.*HAND】:You attach/i,
      /AUTO【FIELD】:If you have only/i, /AUTO【FIELD】:The character attached/i,
      /AUTO【FIELD】:The Lv of the character/i,
      /AUTO【BATTLE】:All your characters with/i, /AUTO【BATTLE】:All the R of your characters/i,
      /AUTO【BATTLE】:If the original Levels/i, /AUTO【BATTLE】:If you have only this card/i,
      /AUTO【BATTLE】：This card gets Power/,
    ];
    for (const p of patterns) if (p.test(t)) { ok = false; break; }
    implementedCache.set(card, ok);
    return ok;
  }

  // ---- Action buttons ----
  function renderActions() {
    const atk = document.getElementById("btn-attack");
    const end = document.getElementById("btn-end-turn");
    const hint = document.getElementById("action-hint");
    if (state.winner) {
      atk.disabled = true; end.disabled = true;
      hint.textContent = `遊戲結束`;
      showWinOverlay();
      return;
    }
    if (state.activeSide !== "P") {
      atk.disabled = true; end.disabled = true;
      hint.textContent = "等緊 AI 行動…";
      return;
    }
    // Player turn
    const hasFront = !!state.players.P.battle.front;
    const oppFront = !!state.players[state.activeSide === "P" ? "A" : "P"].battle.front;
    atk.disabled = !(hasFront && oppFront);
    end.disabled = false;
    if (view.attackerUid) {
      hint.textContent = "點擊對手場上角色作目標，或再點自己 FRONT 取消攻擊模式";
    } else if (view.selectedHandIdx !== null) {
      hint.textContent = "已選擇手牌，確認後叫出到 FRONT";
    } else if (!hasFront) {
      hint.textContent = "FRONT 位空置：選擇一張手牌叫出";
    } else {
      hint.textContent = "選擇動作：攻擊 / 結束回合";
    }
  }

  document.getElementById("btn-attack").addEventListener("click", () => {
    if (!state.players.P.battle.front) return;
    view.attackerUid = state.players.P.battle.front._uid;
    render();
  });
  document.getElementById("btn-end-turn").addEventListener("click", () => {
    if (state.activeSide !== "P") return;
    view.attackerUid = null;
    view.selectedHandIdx = null;
    E.endTurn(state);
    render();
    if (state.activeSide === "A" && !state.winner) scheduleAI();
  });

  // ---- Hand click ----
  function onHandClick(idx) {
    if (state.activeSide !== "P") return;
    const handCard = state.players.P.hand[idx];
    if (!handCard) return;
    if (handCard.level >= 4) {
      // Lv4+: show retreat cost modal FIRST (needs field cards as cost,
      // including the card currently in FRONT — so the empty-FRONT guard
      // must NOT block this path).
      view.selectedHandIdx = idx;
      showRetreatModal(idx, handCard);
      return;
    }
    if (state.players.P.battle.front) return; // Lv1-3: FRONT must be empty (simplified)
    // Lv1-3: call directly
    const r = E.callCard(state, "P", idx, []);
    if (!r.ok) console.warn(r.err);
    view.selectedHandIdx = null;
    render();
  }

  // ---- Zone card click ----
  function onZoneCardClick(side, slot, card) {
    if (state.activeSide !== "P") return;
    if (state.winner) return;

    // Attack mode: clicking target
    if (view.attackerUid && side !== "P") {
      const r = E.attack(state, "P", view.attackerUid, card._uid);
      if (!r.ok) console.warn(r.err);
      view.attackerUid = null;
      render();
      return;
    }

    // Cancel attack
    if (side === "P" && view.attackerUid === card._uid) {
      view.attackerUid = null;
      render();
    }
  }

  // ---- Retreat modal ----
  function showRetreatModal(handIdx, handCard) {
    const modal = document.getElementById("modal");
    const title = document.getElementById("modal-title");
    const body = document.getElementById("modal-body");
    title.textContent = `叫出 Lv${handCard.level} ${E.shortName(handCard)} — 需要 retreat 總 Lv = ${handCard.level}`;
    body.innerHTML = `<p>選擇要 retreat 嘅場上角色（合計 Lv = ${handCard.level}）：</p>`;
    const sources = E.battleChars(state.players.P);
    sources.forEach(({ card }) => {
      const opt = document.createElement("label");
      opt.className = "retreat-option";
      opt.innerHTML = `<input type="checkbox" value="${card._uid}"> Lv${card.level} ${E.shortName(card)}`;
      opt.querySelector("input").addEventListener("change", updateSum);
      body.appendChild(opt);
    });
    const sumLabel = document.createElement("div");
    sumLabel.id = "retreat-sum";
    sumLabel.style.marginTop = "8px";
    sumLabel.style.color = "var(--muted)";
    sumLabel.textContent = "已選 0 / 需要 " + handCard.level;
    body.appendChild(sumLabel);
    function updateSum() {
      // NOTE: _uid is a string ("c1","c2",...) — must NOT coerce with +,
      // that turns it into NaN and the lookup below never matches.
      const checked = [...body.querySelectorAll("input:checked")].map(i => i.value);
      const sum = checked.reduce((s, uid) => {
        const c = sources.find(x => x.card._uid === uid);
        return s + (c ? c.card.level : 0);
      }, 0);
      sumLabel.textContent = `已選合計 Lv=${sum} / 需要 ${handCard.level}` + (sum === handCard.level ? " ✓" : "");
      document.getElementById("modal-confirm").disabled = sum !== handCard.level;
      view.pendingCall = { handIdx, retreatUids: checked };
    }
    document.getElementById("modal-confirm").disabled = true;
    modal.classList.remove("hidden");
  }
  document.getElementById("modal-cancel").addEventListener("click", () => {
    document.getElementById("modal").classList.add("hidden");
    view.pendingCall = null;
  });
  document.getElementById("modal-confirm").addEventListener("click", () => {
    if (!view.pendingCall) return;
    const { handIdx, retreatUids } = view.pendingCall;
    const r = E.callCard(state, "P", handIdx, retreatUids);
    if (!r.ok) console.warn(r.err);
    document.getElementById("modal").classList.add("hidden");
    view.pendingCall = null;
    view.selectedHandIdx = null;
    render();
  });

  // ---- Win overlay ----
  function showWinOverlay() {
    const ov = document.getElementById("win-overlay");
    const title = document.getElementById("win-title");
    const detail = document.getElementById("win-detail");
    if (state.winner === "P") {
      title.textContent = "VICTORY";
      title.style.color = "var(--cyan)";
      detail.textContent = `Player 達到 9 Rush Point`;
    } else if (state.winner === "A") {
      title.textContent = "DEFEAT";
      title.style.color = "var(--marvel-red)";
      detail.textContent = `AI 達到 9 Rush Point`;
    } else {
      title.textContent = "DRAW";
      detail.textContent = "";
    }
    ov.classList.remove("hidden");
  }
  document.getElementById("btn-rematch").addEventListener("click", () => {
    document.getElementById("win-overlay").classList.add("hidden");
    document.getElementById("battle-screen").classList.remove("visible");
    document.getElementById("setup-screen").classList.add("visible");
    renderDeckPicker();
  });

  // ---- AI turn ----
  function scheduleAI() {
    view.aiTimer = setTimeout(() => {
      // Run one AI turn
      while (state.activeSide === "A" && !state.winner) {
        AI.aiTurn(state);
        render();
        if (state.winner) break;
      }
    }, 600);
  }

  // ---- Log render ----
  function renderLog() {
    const root = document.getElementById("log-list");
    root.innerHTML = "";
    state.log.forEach(entry => {
      const div = document.createElement("div");
      div.className = "log-line";
      if (entry.side === "P") div.classList.add("side-P");
      if (entry.side === "A") div.classList.add("side-A");
      if (entry.msg.startsWith("===") || entry.msg.includes("開始") || entry.msg.includes("結束")) div.classList.add("log-system");
      if (entry.msg.startsWith("[效果]")) div.classList.add("log-effect");
      if (entry.msg.startsWith("[效果未實裝]")) div.classList.add("log-stub");
      if (entry.msg.includes("攻擊")) div.classList.add("log-battle");
      if (entry.msg.includes("Rush Point")) div.classList.add("log-rp");
      div.textContent = entry.msg;
      root.appendChild(div);
    });
    root.scrollTop = root.scrollHeight;
  }

  // ---- Master render ----
  function render() {
    renderHud();
    renderBench();
    renderField();
    renderHand();
    renderActions();
    renderLog();
  }

  // ---- Bootstrap ----
  renderDeckPicker();
})();
