// =============================================================
// Marvel Hero Rush TCG — App v3.2
//   - full-bleed card art, AI face-down backs (★), RP burst
//   - phase label flash, audio.js cues
//   - v3.2: drag-drop hand→zone, card-detail modal on click,
//           deck import via base64 share code, fly-card animation,
//           action counters in HUD phase help
// =============================================================
(function () {
  "use strict";

  const E = window.MHR_ENGINE;
  const AI = window.MHR_AI;
  const DATA = window.MHR_DATA;
  const SFX = window.MHR_AUDIO;

  let state = null;
  let view = {
    selectedHandIdx: null,
    pendingCall: null,      // { handIdx, retreatUids:Set }
    pendingSetDeploy: null, // { handIdx }
    attackerUid: null,
    moveFromUid: null,      // when in move mode
    pendingCounter: null,   // { attackerUid }
    aiTimer: null,
    _chosenRush: null,      // v3.4: 玩家自選衝擊卡組（9 張 card objects；null = 自動）
    _mulliganSelected: new Set(),  // v3.4: mulligan 已選手牌 index
  };

  // ---- Setup ----
  function renderDeckPicker() {
    const root = document.getElementById("deck-picker");
    root.innerHTML = "";
    const decks = Object.keys(DATA.DECKS);
    const colorLabels = { Red: "紅", Yellow: "黃", Blue: "藍", Green: "綠" };
    decks.forEach((dk, i) => {
      const arr = DATA.DECKS[dk];
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

    state = E.initGame(deck, aiDeck, view._chosenRush, null);
    // initGame 設 phase=MULLIGAN → 玩家調整起始手牌 → AI 調整 → startTurn（第 1 回合）
    view.selectedHandIdx = null;
    view.attackerUid = null;
    view.pendingCall = null;
    view.pendingSetDeploy = null;
    view.moveFromUid = null;
    view.pendingCounter = null;
    view._mulliganSelected = new Set();
    _lastPhase = null;
    _lastWinner = null;
    _lastRpCount = { P: 0, A: 0 };

    document.getElementById("setup-screen").classList.remove("visible");
    document.getElementById("battle-screen").classList.add("visible");

    render();
    beginMulligan();
  }
  document.getElementById("btn-start").addEventListener("click", startBattle);

  // ---- v3.4: Mulligan（調整起始手牌，官方 P9） ----
  function beginMulligan() {
    if (!state || state.phase !== "MULLIGAN" || state.mulliganDone.P) return;
    SFX && SFX.play("draw");
    renderMulliganOverlay();
  }

  function renderMulliganOverlay() {
    const p = state.players.P;
    const root = document.getElementById("mulligan-hand");
    root.innerHTML = "";
    view._mulliganSelected = new Set();
    p.hand.forEach((c, i) => {
      const card = document.createElement("div");
      card.className = "m-card";
      card.dataset.idx = i;
      const art = document.createElement("div");
      art.className = "m-card-art";
      art.style.backgroundImage = `url("${DATA.artPath(c)}")`;
      const name = document.createElement("div");
      name.className = "m-card-name";
      name.textContent = `Lv${c.level || "-"} · ${E.shortName(c)}`;
      card.appendChild(art);
      card.appendChild(name);
      card.addEventListener("click", () => {
        if (view._mulliganSelected.has(i)) view._mulliganSelected.delete(i);
        else view._mulliganSelected.add(i);
        card.classList.toggle("selected", view._mulliganSelected.has(i));
        updateMulliganStatus();
      });
      root.appendChild(card);
    });
    updateMulliganStatus();
    document.getElementById("mulligan-overlay").classList.remove("hidden");
  }

  function updateMulliganStatus() {
    const n = view._mulliganSelected.size;
    document.getElementById("mulligan-status").textContent = `已選 ${n} 張（放回底 → 抽 ${n} → 洗牌）`;
    document.getElementById("mulligan-confirm").disabled = n === 0;
  }

  function finishPlayerMulligan() {
    const r = E.mulligan(state, "P", [...view._mulliganSelected]);
    if (!r.ok) console.warn("mulligan failed:", r.err);
    document.getElementById("mulligan-overlay").classList.add("hidden");
    // AI 後決定（簡化：自動 heuristic）
    const aiIdxs = AI.aiMulligan(state);
    E.mulligan(state, "A", aiIdxs);
    // 雙方調整完成 → 正式開始第 1 回合
    E.startTurn(state);
    render();
  }
  document.getElementById("mulligan-keep").addEventListener("click", () => {
    view._mulliganSelected = new Set();
    finishPlayerMulligan();
  });
  document.getElementById("mulligan-confirm").addEventListener("click", finishPlayerMulligan);

  // ---- v3.4: 衝擊卡組自選（官方 P7：玩家自選 9 款衝擊卡） ----
  function renderRushPicker() {
    const root = document.getElementById("rush-grid");
    root.innerHTML = "";
    const rp = (DATA.CARDS || []).filter(c => c.type === "impact");
    const selected = new Set((view._chosenRush || []).map(c => c.card_no));
    rp.forEach(c => {
      const card = document.createElement("div");
      card.className = "r-card" + (selected.has(c.card_no) ? " selected" : "");
      card.dataset.no = c.card_no;
      const art = document.createElement("div");
      art.className = "r-card-art";
      art.style.backgroundImage = `url("${DATA.artPath(c)}")`;
      card.appendChild(art);
      card.addEventListener("click", () => {
        const cur = (view._chosenRush || []).slice();
        const i = cur.findIndex(x => x.card_no === c.card_no);
        if (i >= 0) cur.splice(i, 1);
        else if (cur.length < 9) cur.push(c);
        view._chosenRush = cur;
        renderRushPicker();
        updateRushStatus();
      });
      root.appendChild(card);
    });
    updateRushStatus();
  }

  function updateRushStatus() {
    const n = (view._chosenRush || []).length;
    document.getElementById("rush-status").textContent = `已選 ${n} / 9` + (n === 9 ? " ✓（可以開始）" : "（或按「自動」）");
    document.getElementById("rush-confirm").disabled = n !== 9;
  }

  function openRushPicker() {
    renderRushPicker();
    document.getElementById("rush-overlay").classList.remove("hidden");
  }
  document.getElementById("btn-rush-picker").addEventListener("click", openRushPicker);
  document.getElementById("rush-auto").addEventListener("click", () => {
    view._chosenRush = null;   // null = engine 自動（跟主牌組 dominant set）
    document.getElementById("rush-overlay").classList.add("hidden");
  });
  document.getElementById("rush-confirm").addEventListener("click", () => {
    document.getElementById("rush-overlay").classList.add("hidden");
  });

  // ---- Top bar HUD ----
  function renderHud() {
    const p = state.players.P, a = state.players.A;
    document.getElementById("rp-fill-p").style.width = (p.timeline.length / E.RUSH_TO_WIN * 100) + "%";
    document.getElementById("rp-fill-a").style.width = (a.timeline.length / E.RUSH_TO_WIN * 100) + "%";
    document.getElementById("rp-text-p").textContent = `${p.timeline.length} / ${E.RUSH_TO_WIN}`;
    document.getElementById("rp-text-a").textContent = `${a.timeline.length} / ${E.RUSH_TO_WIN}`;
    document.getElementById("turn-num").textContent = `回合 ${state.turn}`;
    document.getElementById("phase-label").textContent = state.phase;
    document.getElementById("phase-pill").textContent = state.phase;
    document.getElementById("active-side").textContent =
      state.activeSide === "P" ? "Player 行動" : "AI 思考中…";
    const tb = document.querySelector(".battle-topbar");
    tb.classList.toggle("ai-turn", state.activeSide === "A");
    tb.classList.toggle("player-turn", state.activeSide === "P");
    document.getElementById("hud-meta-p").innerHTML = `<span class="meta-chip">🎴 ${p.deckLabel}</span>`;
    document.getElementById("hud-meta-a").innerHTML = `<span class="meta-chip">🎴 ${a.deckLabel}</span>`;

    // phase help + v3.2 action counters
    const ph = document.getElementById("phase-help");
    if (state.phase === "MULLIGAN") ph.textContent = "調整起始手牌：點擊選擇放回嘅手牌（先攻先決定）";
    else if (state.phase === "DRAW") ph.textContent = "抽 2 張（自動）";
    else if (state.phase === "ACTION") {
      const f = state.turnFlags.P || {};
      const maxCall = E.maxCallCount(state, "P");
      const usedSet = !!f.setDeployUsed;
      ph.innerHTML = `<span class="action-counter">
        <span class="pill ${usedSet ? 'flash' : ''}">基地部署 ${usedSet ? '1/1' : '0/1'}</span>
        <span class="pill">號召 ${f.callCount}/${maxCall}</span>
      </span>`;
    }
    else if (state.phase === "BATTLE") ph.textContent = "戰鬥階段：調整 → 攻擊（按先鋒→側翼→後衛順序）";
    else if (state.phase === "RESPOND") ph.textContent = "應對階段：輪流選擇 應對號召 / COUNTER / 不行動";
    else if (state.phase === "END") ph.textContent = "回合結束：手牌 >9 棄至 9";
  }

  // ---- Counters & zones ----
  function renderCounters() {
    const p = state.players.P, a = state.players.A;
    document.getElementById("deck-cnt-p").textContent = p.deck.length;
    document.getElementById("deck-cnt-a").textContent = a.deck.length;
    document.getElementById("retreat-cnt-p").textContent = p.retreat.length;
    document.getElementById("retreat-cnt-a").textContent = a.retreat.length;
    document.getElementById("void-cnt-p").textContent = p.voidZone.length;
    document.getElementById("void-cnt-a").textContent = a.voidZone.length;
    document.getElementById("hand-cnt-p").textContent = p.hand.length;
    document.getElementById("hand-cnt-a").textContent = a.hand.length;
    document.getElementById("rushdeck-cnt-p").textContent = p.rushDeck.length;
    document.getElementById("rushdeck-cnt-a").textContent = a.rushDeck.length;
  }

  function renderTimelines() {
    for (const side of ["P", "A"]) {
      const root = document.getElementById("timeline-" + side);
      root.innerHTML = "";
      for (let i = 0; i < E.RUSH_TO_WIN; i++) {
        const cell = document.createElement("div");
        cell.className = "timeline-cell";
        if (state.players[side].timeline[i]) {
          cell.classList.add("filled");
          const rp = state.players[side].timeline[i];
          if (rp && rp.art) {
            cell.classList.add("filled", "has-art");
            cell.textContent = "";
            const img = document.createElement("img");
            img.src = rp.art;
            img.alt = "RUSH POINT";
            img.className = "timeline-art";
            cell.appendChild(img);
          } else {
            cell.classList.add("filled");
            cell.textContent = "★";
          }
        }
        root.appendChild(cell);
      }
    }
  }

  function renderBattleZones() {
    for (const side of ["P", "A"]) {
      const player = state.players[side];
      const slots = [
        { slot: "front", card: player.battle.front },
        { slot: "wing1", card: player.battle.wing[0] },
        { slot: "wing2", card: player.battle.wing[1] },
        { slot: "back", card: player.battle.back },
      ];
      slots.forEach(({ slot, card }) => {
        const zoneEl = document.querySelector(`.mat-${side === "A" ? "ai" : "p"} [data-slot="${slot}"]`);
        if (!zoneEl) return;
        // wipe children
        [...zoneEl.querySelectorAll(".mini-card")].forEach(n => n.remove());
        zoneEl.classList.remove("has-card", "is-source", "is-target", "is-weakness");
        zoneEl.onclick = null;      // clear any leftover weakness handler
        zoneEl.style.cursor = "";
        // v3.2: drag-drop handlers (own side, ACTION phase, empty slot → call target)
        zoneEl.ondragover = (e) => {
          if (state.activeSide !== "P" || state.phase !== "ACTION" || side !== "P" || card) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          zoneEl.classList.add("drag-target");
        };
        zoneEl.ondragleave = () => zoneEl.classList.remove("drag-target");
        zoneEl.ondrop = (e) => {
          e.preventDefault();
          zoneEl.classList.remove("drag-target");
          if (state.activeSide !== "P" || state.phase !== "ACTION" || side !== "P" || card) return;
          const handIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
          if (isNaN(handIdx)) return;
          onHandCallDirect(handIdx);
        };
        if (card) {
          zoneEl.classList.add("has-card");
          zoneEl.appendChild(buildMiniCard(card, side, slot));
          if (side === state.activeSide && view.attackerUid === card._uid) zoneEl.classList.add("is-source");
        } else {
          // Weakness highlight when in attack mode
          if (side !== state.activeSide && view.attackerUid) {
            const targets = E.attackableTargets(state, state.activeSide, view.attackerUid);
            if (targets.some(t => t.kind === "weakness" && t.slot === slot)) {
              zoneEl.classList.add("is-weakness");
              if (state.activeSide === "P") zoneEl.classList.add("is-target");
              zoneEl.style.cursor = "pointer";
              zoneEl.onclick = (e) => {
                e.stopPropagation();
                if (state.activeSide !== "P" || state.phase !== "BATTLE" || !view.attackerUid) return;
                const t = E.attackableTargets(state, "P", view.attackerUid)
                  .find(x => x.kind === "weakness" && x.slot === slot);
                if (!t) return;
                // Animate: fly attack from attacker to target
                const atkEl = document.querySelector(`.mat-p .mini-card[data-uid="${view.attackerUid}"]`);
                if (atkEl) flyCard(atkEl, zoneEl);
                setTimeout(() => {
                  const r = E.attack(state, "P", view.attackerUid, t);
                  if (!r.ok) console.warn(r.err);
                  SFX && SFX.play("attack");
                  view.attackerUid = null;
                  render();
                }, 280);
              };
            }
          }
        }
      });
    }
  }

  function renderBase() {
    for (const side of ["P", "A"]) {
      const root = document.getElementById("base-" + side);
      root.innerHTML = "";
      const base = state.players[side].base.faceDown;
      // 6 slots; fill with set cards
      for (let i = 0; i < E.BASE_SIZE_MAX; i++) {
        const slot = document.createElement("div");
        slot.className = "set-card";
        slot.style.flex = "1";
        if (base[i]) {
          slot.textContent = "蓋";
          slot.title = E.shortName(base[i]) + "（蓋卡）";
          if (state.activeSide === side) {
            slot.addEventListener("click", () => onSetCardClick(side, base[i]));
          }
        } else {
          slot.style.opacity = "0.25";
          slot.style.cursor = "default";
        }
        root.appendChild(slot);
      }
    }
  }

  function onSetCardClick(side, card) {
    if (state.activeSide !== side || state.phase !== "ACTION") return;
    if (view.moveFromUid === card._uid) {
      view.moveFromUid = null;
      render();
      return;
    }
    view.moveFromUid = card._uid;
    render();
  }

  function buildMiniCard(card, side, slot) {
    const div = document.createElement("div");
    div.className = "mini-card";
    div.dataset.uid = card._uid;
    div.dataset.attr = card.attribute;
    const pow = E.cardEffectivePower(state, side, card);
    if (!isEffectImplemented(card)) div.classList.add("unimplemented");

    // Face-down for AI side
    if (side === "A") {
      div.classList.add("face-down");
    } else {
      const art = document.createElement("div");
      art.className = "mc-art";
      const artUrl = DATA.artPath(card);
      art.style.backgroundImage = `url("${artUrl}")`;
      div.appendChild(art);

      const statsOverlay = document.createElement("div");
      statsOverlay.className = "mc-stats-overlay";
      statsOverlay.innerHTML =
        `<span class="mc-stat lv">Lv${card.level}</span>` +
        `<span class="mc-stat pw">P${pow}</span>` +
        `<span class="mc-stat rg">R${DATA.numRange(card.attackRange)}</span>`;
      div.appendChild(statsOverlay);

      const info = document.createElement("div");
      info.className = "mc-info";
      const name = document.createElement("div");
      name.className = "mc-name";
      name.textContent = E.shortName(card);
      info.appendChild(name);
      div.appendChild(info);
    }

    div.addEventListener("click", (e) => {
      e.stopPropagation();
      onZoneCardClick(side, slot, card);
    });
    return div;
  }

  // ---- Rush Point burst ----
  let _lastRpCount = { P: 0, A: 0 };
  function checkRushPointBurst(side) {
    const tl = state.players[side].timeline.length;
    if (tl > _lastRpCount[side]) {
      // Burst at the timeline cell
      const timelineEl = document.getElementById("timeline-" + side);
      if (timelineEl) {
        const cell = timelineEl.children[tl - 1];
        if (cell) {
          const rect = cell.getBoundingClientRect();
          burstAt(rect.left + rect.width / 2, rect.top + rect.height / 2,
                  side === "P" ? "+1 RUSH POINT" : "AI +1 RP",
                  side === "P" ? "#fbbf24" : "#ff8a8a");
        }
      }
      SFX && SFX.play("weakness");
    }
    _lastRpCount[side] = tl;
  }
  function burstAt(x, y, text, color) {
    const el = document.createElement("div");
    el.className = "rp-burst";
    el.textContent = text;
    if (color) el.style.color = color;
    el.style.left = (x - 60) + "px";
    el.style.top = (y - 30) + "px";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  // ---- v3.2: Fly card animation (from source el to target el) ----
  function flyCard(fromEl, toEl) {
    if (!fromEl || !toEl) return;
    const fr = fromEl.getBoundingClientRect();
    const tr = toEl.getBoundingClientRect();
    const ghost = document.createElement("div");
    ghost.className = "fly-card";
    ghost.style.left = fr.left + "px";
    ghost.style.top = fr.top + "px";
    ghost.style.width = fr.width + "px";
    ghost.style.height = fr.height + "px";
    ghost.style.backgroundImage = window.getComputedStyle(fromEl.querySelector(".mc-art, .hc-art") || fromEl).backgroundImage;
    ghost.style.backgroundSize = "100% 100%";
    document.body.appendChild(ghost);
    // Force reflow then animate via CSS (animation-name fly-to-target)
    void ghost.offsetWidth;
    ghost.style.left = (tr.left + tr.width / 2 - fr.width / 2) + "px";
    ghost.style.top = (tr.top + tr.height / 2 - fr.height / 2) + "px";
    setTimeout(() => ghost.remove(), 420);
  }

  // ---- v3.2: Card detail modal ----
  function showCardDetail(card, handIdx) {
    const modal = document.getElementById("card-detail");
    modal.dataset.cardUid = card._uid;
    modal.dataset.handIdx = handIdx != null ? String(handIdx) : "";
    document.getElementById("detail-art").style.backgroundImage = `url("${DATA.artPath(card)}")`;
    document.getElementById("detail-name").textContent = card.name || E.shortName(card);
    const stats = document.getElementById("detail-stats");
    const lv = card.level;
    const pw = E.cardEffectivePower ? E.cardEffectivePower(state, "P", card) : DATA.numPower(card.power);
    stats.innerHTML =
      `<span class="detail-stat lv">Lv${lv}</span>` +
      `<span class="detail-stat pw">P${pw}</span>` +
      `<span class="detail-stat rg">R${DATA.numRange(card.attackRange)}</span>` +
      `<span class="detail-stat attr-${card.attribute}">${card.attribute}</span>` +
      `<span class="detail-stat">${card.rarity || "—"}</span>` +
      `<span class="detail-stat">${card.feature || "—"}</span>`;
    document.getElementById("detail-effect").textContent = card.effect || "";
    // Hide action buttons when viewing non-hand cards
    const callBtn = document.getElementById("detail-call");
    const deployBtn = document.getElementById("detail-base-deploy");
    if (handIdx != null) {
      callBtn.style.display = "";
      deployBtn.style.display = "";
      const f = state.turnFlags.P || {};
      const canCall = f.callCount < E.maxCallCount(state, "P");
      callBtn.disabled = !canCall || state.phase !== "ACTION";
      deployBtn.disabled = !canCall || state.phase !== "ACTION" || !!f.setDeployUsed;
    } else {
      callBtn.style.display = "none";
      deployBtn.style.display = "none";
    }
    const moveBtn = document.getElementById("detail-battle-move");
    moveBtn.style.display = "none"; // future: implement move picker from detail modal
    modal.classList.remove("hidden");
  }
  function hideCardDetail() {
    document.getElementById("card-detail").classList.add("hidden");
  }
  document.getElementById("detail-close").addEventListener("click", hideCardDetail);
  document.getElementById("detail-ok").addEventListener("click", hideCardDetail);
  document.getElementById("detail-call").addEventListener("click", () => {
    const idx = parseInt(document.getElementById("card-detail").dataset.handIdx || "-1", 10);
    if (idx < 0) return;
    hideCardDetail();
    onHandCallDirect(idx);
  });
  document.getElementById("detail-base-deploy").addEventListener("click", () => {
    const idx = parseInt(document.getElementById("card-detail").dataset.handIdx || "-1", 10);
    if (idx < 0) return;
    hideCardDetail();
    // Animate then call setDeploy
    const handEl = document.querySelector(`.hand-card[data-uid="${state.players.P.hand[idx]?._uid}"]`);
    const baseZone = document.querySelector('.mat-p .zone-base');
    if (handEl && baseZone) flyCard(handEl, baseZone);
    setTimeout(() => {
      const r = E.setDeploy(state, "P", idx);
      if (!r.ok) console.warn(r.err);
      SFX && SFX.play("deploy");
      render();
    }, 320);
  });

  // ---- v3.2: Deck import via base64 share code ----
  function showImportOverlay() {
    document.getElementById("import-code").value = "";
    document.getElementById("import-status").textContent = "";
    document.getElementById("import-status").className = "import-status";
    document.getElementById("import-overlay").classList.remove("hidden");
  }
  function hideImportOverlay() {
    document.getElementById("import-overlay").classList.add("hidden");
  }
  // ---- v3.4 (M3): share code 解碼 — v2 compact + legacy base64 ----
  // v2: "1|<name>|" + (系列字母 + 3位編號 + [vN] + qty base36)*
  // legacy: base64(JSON [[card_no, qty], ...])
  const SERIES_LETTER = { A: "BP01", B: "SD01", C: "SD02", D: "SD03", E: "SD04" };
  function decodeShareCode(code) {
    const s = (code || "").trim();
    if (!s) return null;
    let cardsPart = s;
    let deckName = null;
    if (s.startsWith("1|")) {
      const idx = s.indexOf("|", 2);
      if (idx === -1) return null;
      deckName = s.slice(2, idx);
      try { deckName = decodeURIComponent(deckName); } catch (e) { deckName = null; }
      cardsPart = s.slice(idx + 1);
    }
    if (/^[A-E]/.test(cardsPart)) {
      // v2 compact
      const pairs = [];
      let i = 0;
      while (i < cardsPart.length) {
        const letter = cardsPart[i++];
        const num = cardsPart.substr(i, 3); i += 3;
        if (!SERIES_LETTER[letter] || !/^\d{3}$/.test(num)) return null;
        let no = SERIES_LETTER[letter] + "-" + num;
        if (cardsPart[i] === "v") {
          i++;
          let v = "";
          while (i < cardsPart.length && /\d/.test(cardsPart[i])) v += cardsPart[i++];
          if (!v) return null;
          no += "-V" + v;   // variant 保留；loadImportedDeck normalize 去 card_no
        }
        if (i >= cardsPart.length) return null;
        const qty = parseInt(cardsPart[i++], 36);
        if (qty > 0) pairs.push([no, qty]);
      }
      return { pairs, name: deckName };
    }
    // legacy base64 JSON
    try {
      const json = decodeURIComponent(escape(atob(cardsPart)));
      const arr = JSON.parse(json);
      if (!Array.isArray(arr)) return null;
      return { pairs: arr, name: deckName };
    } catch (e) { return null; }
  }

  function loadImportedDeck(code) {
    const decoded = decodeShareCode(code);
    if (!decoded) {
      const status = document.getElementById("import-status");
      status.textContent = "❌ 解碼失敗：share code 格式無效";
      status.className = "import-status bad";
      return false;
    }
    try {
      const pairs = decoded.pairs;
      // Validate shape [[card_no, qty], ...]
      let total = 0;
      const cardList = pairs.map(([cn, q]) => {
        if (typeof cn !== "string" || typeof q !== "number") throw new Error("card entry 格式錯誤");
        total += q;
        return DATA.CARDS_BY_NO[cn] || DATA.CARDS_BY_NO[cn.replace(/-V\d+$/, "")];
      });
      // Check all resolved
      const missing = pairs.filter(([cn], i) => !cardList[i]);
      if (missing.length > 0) {
        const status = document.getElementById("import-status");
        status.textContent = `❌ 找不到咗 ${missing.length} 張卡：${missing.slice(0, 5).map(([cn]) => cn).join(", ")}${missing.length > 5 ? "..." : ""}`;
        status.className = "import-status bad";
        return false;
      }
      // Validate rules (50 cards, max 3 same name)
      if (total !== 50) {
        const status = document.getElementById("import-status");
        status.textContent = `❌ Deck 大小不正確：${total} 張（需要 50 張）`;
        status.className = "import-status bad";
        return false;
      }
      // Register as deck
      const deckName = decoded.name && decoded.name.trim() ? "Shared_" + decoded.name.trim().slice(0, 30) : "Imported_" + Date.now().toString(36);
      DATA.DECKS[deckName] = pairs.map(([cn, q]) => [cn.replace(/-V\d+$/, ""), q]);
      // Build deck label
      const colorSet = new Set();
      pairs.forEach(([cn]) => {
        const c = DATA.CARDS_BY_NO[cn.replace(/-V\d+$/, "")];
        if (c) colorSet.add(c.attribute);
      });
      const colorLabels = { Red: "紅", Yellow: "黃", Blue: "藍", Green: "綠" };
      const colStr = [...colorSet].map(c => `<span class="color-chip ${c}">${colorLabels[c] || c}</span>`).join("");
      const status = document.getElementById("import-status");
      status.innerHTML = `✅ 匯入成功！${total} 張卡 · ${colStr} · 對戰開始！`;
      status.className = "import-status ok";
      // Auto-start with imported deck
      setTimeout(() => {
        hideImportOverlay();
        view._chosenDeck = deckName;
        startBattle();
      }, 1200);
      return true;
    } catch (e) {
      const status = document.getElementById("import-status");
      status.textContent = `❌ 解碼失敗：${e.message}`;
      status.className = "import-status bad";
      return false;
    }
  }
  document.getElementById("btn-import").addEventListener("click", showImportOverlay);
  document.getElementById("import-cancel").addEventListener("click", hideImportOverlay);
  document.getElementById("import-load").addEventListener("click", () => {
    const code = document.getElementById("import-code").value;
    if (!code.trim()) {
      const status = document.getElementById("import-status");
      status.textContent = "請貼上 share code";
      status.className = "import-status bad";
      return;
    }
    loadImportedDeck(code);
  });

  // ---- Hand render (v3.2: draggable + click for detail) ----
  function renderHand() {
    const root = document.getElementById("hand-list");
    root.innerHTML = "";
    const p = state.players.P;
    p.hand.forEach((c, i) => {
      const div = document.createElement("div");
      div.className = "hand-card";
      div.dataset.uid = c._uid;
      div.dataset.attr = c.attribute;
      div.draggable = true;  // v3.2: enable HTML5 drag-drop
      const f = state.turnFlags.P || {};
      const canCall = f.callCount < E.maxCallCount(state, "P");
      if (!canCall) div.classList.add("unplayable");
      if (view.selectedHandIdx === i) div.classList.add("selected");
      if (!isEffectImplemented(c)) div.classList.add("unimplemented");

      const art = document.createElement("div");
      art.className = "hc-art";
      art.style.backgroundImage = `url("${DATA.artPath(c)}")`;
      div.appendChild(art);

      const statsOverlay = document.createElement("div");
      statsOverlay.className = "hc-stats-overlay";
      statsOverlay.innerHTML =
        `<span class="mc-stat lv">Lv${c.level}</span>` +
        `<span class="mc-stat pw">P${DATA.numPower(c.power)}</span>`;
      div.appendChild(statsOverlay);

      const name = document.createElement("div");
      name.className = "hc-name";
      name.textContent = E.shortName(c);
      div.appendChild(name);

      // v3.2: drag/drop
      div.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", String(i));
        e.dataTransfer.effectAllowed = "move";
        div.classList.add("dragging");
        SFX && SFX.play("click");
      });
      div.addEventListener("dragend", () => {
        div.classList.remove("dragging");
        document.querySelectorAll(".zone.drag-target").forEach(z => z.classList.remove("drag-target"));
      });

      // v3.2: click → open card detail modal (single click only when turn active)
      div.addEventListener("click", () => {
        if (state.activeSide !== "P") return;
        if (state.phase === "ACTION" && canCall) {
          // ACTION phase: single click opens detail (use double-click or detail modal button to actually call)
          showCardDetail(c, i);
        } else {
          showCardDetail(c, i);
        }
      });

      // v3.2: double-click on hand card → directly call (Lv1-3) or open retreat modal (Lv4+)
      div.addEventListener("dblclick", (e) => {
        e.preventDefault();
        if (state.activeSide !== "P" || state.phase !== "ACTION" || !canCall) return;
        onHandCallDirect(i);
      });

      root.appendChild(div);
    });
  }

  // v3.2: direct call from hand (used by double-click + detail modal button)
  function onHandCallDirect(idx) {
    const handCard = state.players.P.hand[idx];
    if (!handCard) return;
    if (handCard.level >= 4) {
      showRetreatModal(idx, handCard);
    } else {
      // Animate: fly card from hand position to target zone
      const handEl = document.querySelector(`.hand-card[data-uid="${handCard._uid}"]`);
      const targetZone = document.querySelector('.mat-p [data-slot="front"]');
      if (handEl && targetZone) flyCard(handEl, targetZone);
      const r = E.callCard(state, "P", idx, []);
      if (!r.ok) console.warn(r.err);
      SFX && SFX.play("call", handCard.level);
      view.selectedHandIdx = null;
      render();
    }
  }

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
      /BATTLE Move/i, /attach/i, /cover/i,
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

  // ---- Action buttons state ----
  function renderActions() {
    const setBtn = document.getElementById("btn-set-deploy");
    const moveBtn = document.getElementById("btn-battle-move");
    const atkBtn = document.getElementById("btn-attack");
    const endBtn = document.getElementById("btn-end-turn");
    const hint = document.getElementById("action-hint");
    if (state.winner) {
      [setBtn, moveBtn, atkBtn, endBtn].forEach(b => b.disabled = true);
      hint.textContent = "遊戲結束";
      showWinOverlay();
      return;
    }
    if (state.activeSide !== "P") {
      [setBtn, moveBtn, atkBtn, endBtn].forEach(b => b.disabled = true);
      hint.textContent = "等緊 AI 行動…";
      return;
    }
    if (state.phase === "BATTLE") {
      // Action buttons off; only attack + end enabled
      setBtn.disabled = true; moveBtn.disabled = true;
      const f = state.turnFlags.P || {};
      const anyUnattacked = E.battleChars(state.players.P).some(({ card }) => !f.attackedUids[card._uid]);
      atkBtn.disabled = !anyUnattacked;
      endBtn.disabled = false;
      if (view.attackerUid) hint.textContent = "揀攻擊目標（角色 / 破綻），或再撳自己取消";
      else hint.textContent = "戰鬥階段：撳 ⚔ 進入攻擊模式，撳先鋒/側翼/後衛揀攻擊者";
      return;
    }
    if (state.phase !== "ACTION") {
      // respond / end — just let end be active
      setBtn.disabled = true; moveBtn.disabled = true;
      atkBtn.disabled = true;
      endBtn.disabled = false;
      hint.textContent = "撳 結束回合";
      return;
    }
    // ACTION phase
    const f = state.turnFlags.P || {};
    setBtn.disabled = !!f.setDeployUsed;
    const canCall = f.callCount < E.maxCallCount(state, "P");
    // SetDeploy needs hand card
    setBtn.disabled = !!f.setDeployUsed || state.players.P.hand.length === 0 || state.players.P.base.faceDown.length >= E.BASE_SIZE_MAX;
    moveBtn.disabled = !canMoveAnyone();
    atkBtn.disabled = true; // not in battle phase
    endBtn.disabled = false;
    if (view.moveFromUid) {
      hint.textContent = "戰基移動已揀角色，撳先鋒或基地以完成";
    } else if (view.selectedHandIdx !== null) {
      hint.textContent = "已揀手牌：撳手牌再次取消 / 等彈 modal";
    } else {
      hint.textContent = `行動：撳手牌叫出 / 撳 基地部署 蓋 1 張 / 撳 ↔ 戰基移動 / 撳 結束回合 → 戰鬥`;
    }
  }

  function canMoveAnyone() {
    const p = state.players.P;
    const f = state.turnFlags.P || {};
    // Base → front
    if (!p.battle.front && p.base.faceDown.length > 0) return true;
    // Front/base → other: any character in battle not placed this turn
    const placed = p._placedThisTurn || {};
    for (const { card } of E.battleChars(p)) {
      if (!placed[card._uid] && !f.movedUids[card._uid] && p.base.faceDown.length < E.BASE_SIZE_MAX) {
        return true;
      }
    }
    return false;
  }

  // ---- Button handlers ----
  document.getElementById("btn-set-deploy").addEventListener("click", () => {
    if (state.activeSide !== "P" || state.phase !== "ACTION") return;
    SFX && SFX.play("click");
    showSetDeployPicker();
  });
  document.getElementById("btn-battle-move").addEventListener("click", () => {
    if (state.activeSide !== "P" || state.phase !== "ACTION") return;
    if (view.moveFromUid) { view.moveFromUid = null; render(); return; }
    showMovePicker();
  });
  document.getElementById("btn-attack").addEventListener("click", () => {
    if (state.activeSide !== "P" || state.phase !== "BATTLE") return;
    if (view.attackerUid) { view.attackerUid = null; render(); return; }
    showAttackerPicker();
  });
  document.getElementById("btn-end-turn").addEventListener("click", () => {
    if (state.activeSide !== "P") return;
    // Skip BATTLE if first turn first player
    if (state.phase === "ACTION") {
      if (E.isFirstTurnBattleSkipped(state, "P")) {
        // Skip directly to respond
        state.phase = "RESPOND";
        render();
        return;
      }
      state.phase = "BATTLE";
      view.attackerUid = null;
      render();
      return;
    }
    if (state.phase === "BATTLE") {
      state.phase = "RESPOND";
      view.attackerUid = null;
      render();
      return;
    }
    if (state.phase === "RESPOND") {
      // End of player's turn
      view.attackerUid = null;
      view.moveFromUid = null;
      view.selectedHandIdx = null;
      E.endTurn(state);
      render();
      if (state.activeSide === "A" && !state.winner) scheduleAI();
      return;
    }
  });

  // ---- Modal: set deploy ----
  function showSetDeployPicker() {
    const p = state.players.P;
    const modal = document.getElementById("modal");
    document.getElementById("modal-title").textContent = "基地部署（蓋 1 張手牌進基地 → 抽 1 張）";
    const body = document.getElementById("modal-body");
    body.innerHTML = `<p>揀 1 張手牌蓋入基地（最多 6 張）：</p>`;
    p.hand.forEach((c, i) => {
      const opt = document.createElement("label");
      opt.className = "retreat-option";
      opt.innerHTML = `<input type="radio" name="set" value="${i}"> Lv${c.level} ${E.shortName(c)}`;
      opt.querySelector("input").addEventListener("change", () => {
        view.pendingSetDeploy = { handIdx: parseInt(opt.querySelector("input").value, 10) };
        document.getElementById("modal-confirm").disabled = false;
      });
      body.appendChild(opt);
    });
    document.getElementById("modal-confirm").disabled = true;
    document.getElementById("modal-confirm").textContent = "蓋放";
    document.getElementById("modal").classList.remove("hidden");
  }

  // ---- Modal: move picker ----
  function showMovePicker() {
    const p = state.players.P;
    const modal = document.getElementById("modal");
    document.getElementById("modal-title").textContent = "戰基移動（戰區 ↔ 基地，每角色 1 次/回合）";
    const body = document.getElementById("modal-body");
    body.innerHTML = `<p>揀 1 個角色：</p>`;
    const placed = p._placedThisTurn || {};
    const flags = state.turnFlags.P || {};
    // battle → base
    for (const { card, slot } of E.battleChars(p)) {
      if (placed[card._uid]) continue;
      if (flags.movedUids[card._uid]) continue;
      if (p.base.faceDown.length >= E.BASE_SIZE_MAX) continue;
      const opt = document.createElement("label");
      opt.className = "retreat-option";
      opt.innerHTML = `<input type="radio" name="mv" value="toBase:${card._uid}"> ${slot} → 基地：Lv${card.level} ${E.shortName(card)}`;
      opt.querySelector("input").addEventListener("change", () => {
        view.moveFromUid = card._uid;
        view._moveToBase = true;
        document.getElementById("modal-confirm").disabled = false;
      });
      body.appendChild(opt);
    }
    // base → battle
    if (!p.battle.front) {
      for (const c of p.base.faceDown) {
        if (flags.movedUids[c._uid]) continue;
        const opt = document.createElement("label");
        opt.className = "retreat-option";
        opt.innerHTML = `<input type="radio" name="mv" value="toBattle:${c._uid}"> 基地 → 先鋒：${E.shortName(c)}（蓋卡）`;
        opt.querySelector("input").addEventListener("change", () => {
          view.moveFromUid = c._uid;
          view._moveToBase = false;
          document.getElementById("modal-confirm").disabled = false;
        });
        body.appendChild(opt);
      }
    }
    document.getElementById("modal-confirm").disabled = true;
    document.getElementById("modal-confirm").textContent = "確認";
    document.getElementById("modal").classList.remove("hidden");
  }

  // ---- Modal: attacker picker (battle phase) ----
  function showAttackerPicker() {
    const p = state.players.P;
    const modal = document.getElementById("modal");
    document.getElementById("modal-title").textContent = "戰鬥：揀 1 個戰區角色作攻擊者";
    const body = document.getElementById("modal-body");
    body.innerHTML = `<p>順序：先鋒 → 側翼 → 後衛。每角色每回合 1 次攻擊。</p>`;
    const f = state.turnFlags.P || {};
    const order = ["front", "wing1", "wing2", "back"];
    for (const slot of order) {
      const c = p.battle[slot] || (slot === "wing1" ? p.battle.wing[0] : slot === "wing2" ? p.battle.wing[1] : null);
      if (!c) continue;
      if (f.attackedUids[c._uid] && !f.doubleAttackUids[c._uid]) continue;
      const opt = document.createElement("label");
      opt.className = "retreat-option";
      const range = DATA.numRange(c.attackRange);
      opt.innerHTML = `<input type="radio" name="atk" value="${c._uid}"> ${slot}：Lv${c.level} R${range} ${E.shortName(c)}`;
      opt.querySelector("input").addEventListener("change", () => {
        view.attackerUid = c._uid;
        document.getElementById("modal-confirm").disabled = false;
      });
      body.appendChild(opt);
    }
    document.getElementById("modal-confirm").disabled = true;
    document.getElementById("modal-confirm").textContent = "揀攻擊者";
    document.getElementById("modal").classList.remove("hidden");
  }

  document.getElementById("modal-cancel").addEventListener("click", () => {
    document.getElementById("modal").classList.add("hidden");
    view.pendingCall = null;
    view.pendingSetDeploy = null;
    view.moveFromUid = null;
    view._moveToBase = null;
    view.attackerUid = null;
  });

  document.getElementById("modal-confirm").addEventListener("click", () => {
    const modal = document.getElementById("modal");
    if (view.pendingCall) {
      const { handIdx, retreatUids } = view.pendingCall;
      const handCard = state.players.P.hand[handIdx];
      const lv = handCard ? handCard.level : 1;
      const r = E.callCard(state, "P", handIdx, retreatUids);
      if (!r.ok) console.warn(r.err);
      SFX && SFX.play("call", lv);
      modal.classList.add("hidden");
      view.pendingCall = null;
      view.selectedHandIdx = null;
      render();
      return;
    }
    if (view.pendingSetDeploy) {
      const r = E.setDeploy(state, "P", view.pendingSetDeploy.handIdx);
      if (!r.ok) console.warn(r.err);
      SFX && SFX.play("deploy");
      modal.classList.add("hidden");
      view.pendingSetDeploy = null;
      render();
      return;
    }
    if (view.moveFromUid) {
      const r = E.battleBaseMove(state, "P", view.moveFromUid, !!view._moveToBase);
      if (!r.ok) console.warn(r.err);
      SFX && SFX.play("click");
      modal.classList.add("hidden");
      view.moveFromUid = null;
      view._moveToBase = null;
      render();
      return;
    }
    if (view.attackerUid && state.phase === "BATTLE") {
      SFX && SFX.play("click");
      modal.classList.add("hidden");
      render();
      return;
    }
  });

  // ---- Hand click ----
  function onHandClick(idx) {
    if (state.activeSide !== "P" || state.phase !== "ACTION") return;
    const handCard = state.players.P.hand[idx];
    if (!handCard) return;
    if (view.selectedHandIdx === idx) {
      // cancel
      view.selectedHandIdx = null;
      render();
      return;
    }
    view.selectedHandIdx = idx;
    if (handCard.level >= 4) {
      showRetreatModal(idx, handCard);
    } else {
      // direct call (Lv1-3)
      const r = E.callCard(state, "P", idx, []);
      if (!r.ok) console.warn(r.err);
      SFX && SFX.play("call", handCard.level); // v3.0
      view.selectedHandIdx = null;
      render();
    }
  }

  // ---- Zone card click (during action or battle) ----
  function onZoneCardClick(side, slot, card) {
    if (state.activeSide !== "P" || state.winner) return;

    // Attack mode: clicked target
    if (state.phase === "BATTLE" && view.attackerUid && side !== "P") {
      // Defender: offer COUNTER first
      offerCounterThenResolve(side, card);
      return;
    }

    // Cancel attack by clicking own
    if (state.phase === "BATTLE" && view.attackerUid && side === "P") {
      if (card._uid === view.attackerUid) {
        view.attackerUid = null;
        render();
      }
      return;
    }

    // Move mode: clicked own battle slot to move to base
    if (state.phase === "ACTION" && view.moveFromUid && side === "P") {
      // already handled in onSetCardClick (from base) — clicking a battle card here just cancels
      if (isInBattleSlot(state.players.P, view.moveFromUid)) {
        // came from battle, send to base
        const r = E.battleBaseMove(state, "P", view.moveFromUid, true);
        if (!r.ok) console.warn(r.err);
      }
      view.moveFromUid = null;
      view._moveToBase = null;
      render();
    }
  }

  function isInBattleSlot(p, uid) {
    return E.isInBattle(p, { _uid: uid });
  }

  // Defender offers COUNTER step then resolves attack
  function offerCounterThenResolve(targetSide, targetCard) {
    // targetSide is the defender; for P-attacks-A, defender is A (AI)
    // For now: AI always auto-resolves; human defender would prompt here
    if (targetSide === "A") {
      // Already auto-handled inside attack() for AI
    }
    // Find target descriptor
    const defP = state.players[targetSide];
    const targets = E.attackableTargets(state, state.activeSide, view.attackerUid);
    const t = targets.find(x => (x.kind === "card" && x.card._uid === targetCard._uid) || (x.kind === "weakness" && x.slot === slotOf(defP, targetCard)));
    if (!t) return;
    // COUNTER for human defender
    if (targetSide === "P") {
      // offer to use a COUNTER·ACTI from hand
      offerCounterPrompt(view.attackerUid, t);
    } else {
      E.attack(state, state.activeSide, view.attackerUid, t);
      // v3.0: attack SFX
      if (t.kind === "weakness") {
        SFX && SFX.play("attack"); // RP burst sound triggers separately via checkRushPointBurst
      } else {
        SFX && SFX.play("hit");
      }
      view.attackerUid = null;
      render();
    }
  }

  function slotOf(p, card) {
    if (p.battle.front === card) return "front";
    if (p.battle.back === card) return "back";
    if (p.battle.wing[0] === card) return "wing1";
    if (p.battle.wing[1] === card) return "wing2";
    return null;
  }

  function offerCounterPrompt(attackerUid, target) {
    const p = state.players.P;
    const counters = p.hand.map((c, i) => ({ c, i })).filter(x => /COUNTER·ACTI/i.test(x.c.effect || ""));
    if (counters.length === 0) {
      E.attack(state, "P", attackerUid, target);
      view.attackerUid = null;
      render();
      return;
    }
    const modal = document.getElementById("modal");
    document.getElementById("modal-title").textContent = "應對步驟：用 COUNTER·ACTI 牌？";
    const body = document.getElementById("modal-body");
    body.innerHTML = `<p>對手攻擊中，你有以下 COUNTER·ACTI 手牌（棄牌 → 減攻擊者 Power）。可以選擇不行動：</p>`;
    counters.forEach(({ c, i }) => {
      const opt = document.createElement("label");
      opt.className = "retreat-option";
      const m = c.effect.match(/Power-(\d+)/);
      const amt = m ? m[1] : "?";
      opt.innerHTML = `<input type="radio" name="cnt" value="${i}"> Lv${c.level} ${E.shortName(c)}（-${amt}）`;
      opt.querySelector("input").addEventListener("change", () => {
        view.pendingCounter = { attackerUid, target, handIdx: i };
        document.getElementById("modal-confirm").disabled = false;
      });
      body.appendChild(opt);
    });
    const skip = document.createElement("label");
    skip.className = "retreat-option";
    skip.innerHTML = `<input type="radio" name="cnt" value="-1" checked> 不行動 → 進入結算`;
    body.appendChild(skip);
    document.getElementById("modal-confirm").disabled = false;
    document.getElementById("modal-confirm").textContent = "確認";
    modal.classList.remove("hidden");
    // hijack confirm to handle counter
    view._counterMode = true;
  }

  // ---- Retreat modal (for Lv4+ call) ----
  function showRetreatModal(handIdx, handCard) {
    const p = state.players.P;
    const modal = document.getElementById("modal");
    document.getElementById("modal-title").textContent = `號召 Lv${handCard.level} ${E.shortName(handCard)} — 揀 retreat 角色（合計 Lv = ${handCard.level}，蓋卡當 Lv1）`;
    const body = document.getElementById("modal-body");
    body.innerHTML = `<p>揀要 retreat 嘅場上角色（或基地蓋卡）。</p>`;
    const sources = [...E.battleChars(p).map(({ card, slot }) => ({ card, slot, lv: card.level })),
                     ...p.base.faceDown.map(c => ({ card: c, slot: "基地", lv: 1 }))];
    sources.forEach(({ card, slot, lv }) => {
      const opt = document.createElement("label");
      opt.className = "retreat-option";
      opt.innerHTML = `<input type="checkbox" value="${card._uid}"> ${slot} Lv${lv} ${E.shortName(card)}`;
      opt.querySelector("input").addEventListener("change", updateSum);
      body.appendChild(opt);
    });
    const sumLabel = document.createElement("div");
    sumLabel.id = "retreat-sum";
    sumLabel.style.marginTop = "8px";
    sumLabel.style.color = "var(--muted)";
    body.appendChild(sumLabel);
    function updateSum() {
      const checked = [...body.querySelectorAll("input:checked")].map(i => i.value);
      const sum = checked.reduce((s, uid) => {
        const c = sources.find(x => x.card._uid === uid);
        return s + (c ? c.lv : 0);
      }, 0);
      sumLabel.textContent = `合計 Lv=${sum} / 需要 ${handCard.level}` + (sum === handCard.level ? " ✓" : "");
      document.getElementById("modal-confirm").disabled = sum !== handCard.level;
      view.pendingCall = { handIdx, retreatUids: checked };
    }
    updateSum();
    document.getElementById("modal-confirm").textContent = "確認";
    modal.classList.remove("hidden");
  }

  // ---- Win overlay ----
  function showWinOverlay() {
    const ov = document.getElementById("win-overlay");
    const title = document.getElementById("win-title");
    const detail = document.getElementById("win-detail");
    if (state.winner === "P") {
      title.textContent = "VICTORY";
      title.style.color = "var(--cyan)";
      detail.textContent = `時間線滿 ${E.RUSH_TO_WIN} 張衝擊卡（or 對方牌組耗盡）`;
    } else if (state.winner === "A") {
      title.textContent = "DEFEAT";
      title.style.color = "var(--marvel-red)";
      detail.textContent = `AI 時間線滿 ${E.RUSH_TO_WIN}`;
    } else {
      title.textContent = "DRAW";
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
      while (state.activeSide === "A" && !state.winner) {
        // v3.0: opening-draw sound when AI's turn starts (state.phase becomes DRAW at start)
        const prevPhase = state.phase;
        AI.aiTurn(state);
        render();
        if (state.winner) break;
      }
    }, 600);
  }

  // ---- Log ----
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
      if (entry.msg.includes("攻") || entry.msg.includes("號召") || entry.msg.includes("戰基")) div.classList.add("log-battle");
      if (entry.msg.includes("Rush Point") || entry.msg.includes("時間線")) div.classList.add("log-rp");
      div.textContent = entry.msg;
      root.appendChild(div);
    });
    root.scrollTop = root.scrollHeight;
  }

  function render() {
    renderHud();
    renderCounters();
    renderTimelines();
    renderBase();
    renderBattleZones();
    renderHand();
    renderActions();
    renderLog();
    // v3.0: side-effects
    if (state) {
      checkRushPointBurst("P");
      checkRushPointBurst("A");
      checkPhaseFlash();
      checkWinLossAudio();
    }
  }

  // ---- Phase label flash on phase change ----
  let _lastPhase = null;
  function checkPhaseFlash() {
    if (!state || _lastPhase === state.phase) return;
    const el = document.getElementById("phase-label");
    if (el && _lastPhase !== null) {
      el.classList.remove("flash");
      void el.offsetWidth; // reflow to restart animation
      el.classList.add("flash");
      SFX && SFX.play("click");
    }
    _lastPhase = state.phase;
  }

  // ---- Win/loss audio ----
  let _lastWinner = null;
  function checkWinLossAudio() {
    if (!state) return;
    if (state.winner && state.winner !== _lastWinner) {
      SFX && SFX.play(state.winner === "P" ? "win" : "lose");
      _lastWinner = state.winner;
    } else if (!state.winner) {
      _lastWinner = null;
    }
  }

  // ---- Bootstrap ----
  renderDeckPicker();

  // ---- v3.4 (M3): ?deck=<share code> URL param 自動載入（deckbuilder「試玩對戰」入口） ----
  (function autoLoadSharedDeck() {
    const code = new URLSearchParams(location.search).get("deck");
    if (!code) return;
    const decoded = decodeShareCode(code);
    if (!decoded) return;
    const pairs = decoded.pairs;
    let total = 0;
    const ok = pairs.every(([cn, q]) => {
      if (typeof cn !== "string" || typeof q !== "number") return false;
      total += q;
      return DATA.CARDS_BY_NO[cn] || DATA.CARDS_BY_NO[cn.replace(/-V\d+$/, "")];
    });
    if (!ok || total !== 50) {
      console.warn("?deck= 參數無效（需要 50 張合法卡）");
      return;
    }
    const deckName = (decoded.name && decoded.name.trim() ? "Shared_" + decoded.name.trim() : "Shared_" + Date.now().toString(36)).slice(0, 40);
    DATA.DECKS[deckName] = pairs.map(([cn, q]) => [cn.replace(/-V\d+$/, ""), q]);
    view._chosenDeck = deckName;
    startBattle();
  })();
})();
