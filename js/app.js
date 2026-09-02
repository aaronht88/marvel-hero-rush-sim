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
    autoPlay: false,        // v3.5: 觀戰模式（AI 打雙方）
    autoPlayPaused: false,  // v3.7: 觀戰暫停
    aiDelay: 1000,          // v3.7: 觀戰每回合間隔 ms（慢 1800 / 正常 1000 / 快 450）
    _compareMode: false,    // v3.5: 對比模式（揀 2+ deck 一齊模擬）
    _compareSel: new Set(), // v3.5: 對比模式已選 deck
    _chosenRush: null,      // v3.4: 玩家自選衝擊卡組（9 張 card objects；null = 自動）
    _mulliganSelected: new Set(),  // v3.4: mulligan 已選手牌 index
    _aStep: 0,              // v3.9 手動模式：AI 回合分步狀態（0=未開始 / 1=行動 / 2=戰鬥）
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
        if (view._compareMode) {
          // v3.5 對比模式：多選
          if (view._compareSel.has(dk)) view._compareSel.delete(dk);
          else view._compareSel.add(dk);
          card.classList.toggle("compare-selected", view._compareSel.has(dk));
          const n = view._compareSel.size;
          document.getElementById("btn-autosim").disabled = n < 2;
          document.getElementById("btn-autosim").textContent = n >= 2 ? `🤖 模擬對比（${n} 副）` : "🤖 自動模擬對戰";
          return;
        }
        document.querySelectorAll(".deck-card").forEach(c => c.classList.remove("selected"));
        card.classList.add("selected");
        document.getElementById("btn-start").disabled = false;
        document.getElementById("btn-autosim").disabled = false;   // v3.5
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
    state.pendingHuman = true;              // v3.9.1: 手動模式 — 真人守方應對要 pause 等揀
    // initGame 設 phase=MULLIGAN → 玩家調整起始手牌 → AI 調整 → startTurn（第 1 回合）
    view._aStep = 0;
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

  // ---- v3.5: 自動模擬對戰（AI 打 AI，勝率戰報） ----
  let _autosimOpponent = null;   // 觀戰第一局用
  let _compareResults = null;    // 對比模式結果
  function openAutoSim() {
    const perOpp = parseInt((document.getElementById("sim-games") || {}).value, 10) || 3;
    const btn = document.getElementById("btn-autosim");
    const running = (label) => { btn.disabled = true; btn.textContent = label; };
    const done = () => { btn.disabled = false; btn.textContent = "🤖 自動模擬對戰"; };

    // 對比模式：揀 2+ 副 deck 一齊跑
    if (view._compareMode && view._compareSel.size >= 2) {
      const decks = [...view._compareSel];
      running(`🤖 模擬對比中（${decks.length} 副）…`);
      setTimeout(() => {
        let results = [];
        try { results = decks.map(d => ({ deck: d, games: AI.runAutoSim(d, { perOpp, maxTurns: 80 }) })); }
        catch (e) { console.error("compare sim failed:", e); }
        done();
        if (!results.length) return;
        _compareResults = results;
        _autosimOpponent = results[0].games[0] && results[0].games[0].opponent;
        renderCompareResults(results);
        document.getElementById("autosim-overlay").classList.remove("hidden");
      }, 30);
      return;
    }

    const deck = view._chosenDeck;
    if (!deck) return;
    running("🤖 模擬中…");
    setTimeout(() => {
      let results = [];
      try { results = AI.runAutoSim(deck, { perOpp, maxTurns: 80 }); }
      catch (e) { console.error("autosim failed:", e); }
      done();
      if (!results.length) return;
      _autosimOpponent = results[0].opponent;
      renderAutoSimResults(results);
      document.getElementById("autosim-overlay").classList.remove("hidden");
    }, 30);
  }

  function renderAutoSimResults(results) {
    const wins = results.filter(r => r.winner === "P").length;
    const total = results.length;
    const rate = total ? Math.round(wins / total * 100) : 0;
    document.getElementById("autosim-summary").innerHTML =
      `<div class="autosim-rate">勝率 <b>${rate}%</b> <span class="autosim-sub">${wins} 勝 / ${total - wins} 負（${total} 局）</span></div>`;
    const byOpp = {};
    results.forEach(r => { (byOpp[r.opponent] = byOpp[r.opponent] || []).push(r); });
    const rows = Object.keys(byOpp).map(opp => {
      const g = byOpp[opp];
      const w = g.filter(r => r.winner === "P").length;
      const avgT = Math.round(g.reduce((s, r) => s + r.turns, 0) / g.length);
      const avgRp = Math.round(g.reduce((s, r) => s + r.rpP, 0) / g.length);
      return `<tr><td>${opp}</td><td>${w}/${g.length}</td><td>${Math.round(w / g.length * 100)}%</td><td>${avgT}</td><td>${avgRp}</td></tr>`;
    }).join("");
    document.getElementById("autosim-table").innerHTML =
      `<table><thead><tr><th>對手</th><th>戰績</th><th>勝率</th><th>平均回合</th><th>平均 RP</th></tr></thead><tbody>${rows}</tbody></table>`;
    const first = results[0];
    document.getElementById("autosim-log").innerHTML = first
      ? first.log.map(m => `<div class="autosim-line${m.startsWith("[效果]") ? " fx" : ""}${m.startsWith("[效果未實裝]") ? " stub" : ""}">${m}</div>`).join("")
      : "";
    document.getElementById("autosim-watch").disabled = false;
    document.getElementById("autosim-watch").textContent = "▶ 觀戰第一局（AI 打 AI）";
  }

  // v3.5: 對比模式矩陣（deck × 對手勝率）
  function renderCompareResults(results) {
    const opps = [];
    results.forEach(r => r.games.forEach(g => { if (!opps.includes(g.opponent)) opps.push(g.opponent); }));
    let summaryWins = 0, summaryTotal = 0;
    const deckRows = results.map(r => {
      const wins = r.games.filter(g => g.winner === "P").length;
      summaryWins += wins; summaryTotal += r.games.length;
      const cells = opps.map(opp => {
        const g = r.games.filter(x => x.opponent === opp);
        if (!g.length) return `<td class="cmp-na">—</td>`;   // 鏡像對局（vs 自己）冇數據
        const w = g.filter(x => x.winner === "P").length;
        return `<td>${Math.round(w / g.length * 100)}%<span class="autosim-sub">${w}/${g.length}</span></td>`;
      }).join("");
      return `<tr><td>${r.deck}</td>${cells}<td class="cmp-total">${Math.round(wins / r.games.length * 100)}%<span class="autosim-sub">${wins}/${r.games.length}</span></td></tr>`;
    }).join("");
    const rate = summaryTotal ? Math.round(summaryWins / summaryTotal * 100) : 0;
    document.getElementById("autosim-summary").innerHTML =
      `<div class="autosim-rate">整體平均勝率 <b>${rate}%</b> <span class="autosim-sub">${summaryWins} 勝 / ${summaryTotal} 負（${summaryTotal} 局，${results.length} 副）</span></div>`;
    document.getElementById("autosim-table").innerHTML =
      `<table><thead><tr><th>Deck</th>${opps.map(o => `<th>vs ${o}</th>`).join("")}<th>總計</th></tr></thead><tbody>${deckRows}</tbody></table>`;
    document.getElementById("autosim-log-head").textContent = "第一局戰報（第一副 deck，可捲動）";
    const first = results[0].games[0];
    document.getElementById("autosim-log").innerHTML = first
      ? first.log.map(m => `<div class="autosim-line${m.startsWith("[效果]") ? " fx" : ""}${m.startsWith("[效果未實裝]") ? " stub" : ""}">${m}</div>`).join("")
      : "";
    document.getElementById("autosim-watch").disabled = false;
    document.getElementById("autosim-watch").textContent = `▶ 觀戰第一局（${results[0].deck} vs ${first.opponent}）`;
  }

  // 觀戰模式：AI 打雙方（可中途「✋ 接管」）
  function startAutoPlay(opponentDeck) {
    let deck = view._chosenDeck;
    if (!deck && _compareResults && _compareResults.length) deck = _compareResults[0].deck;   // v3.5 對比模式
    if (!deck) deck = "RED_Aggro";
    state = E.initGame(deck, opponentDeck || _autosimOpponent || "YELLOW_Machine", view._chosenRush, null);
    state.pendingHuman = false;             // v3.9.1: 觀戰/自動 — AI 打 AI 照舊全自動
    view.autoPlay = true;
    view.autoPlayPaused = false;
    view.aiDelay = parseInt((document.getElementById("watch-speed") || {}).value, 10) || 1000;
    view.selectedHandIdx = null; view.attackerUid = null; view.pendingCall = null;
    view.pendingSetDeploy = null; view.moveFromUid = null; view.pendingCounter = null;
    _lastPhase = null; _lastWinner = null; _lastRpCount = { P: 0, A: 0 };
    // 雙方自動 mulligan
    E.mulligan(state, "P", AI.aiMulligan(state, "P"));
    E.mulligan(state, "A", AI.aiMulligan(state, "A"));
    E.startTurn(state);
    document.getElementById("autosim-overlay").classList.add("hidden");
    document.getElementById("setup-screen").classList.remove("visible");
    document.getElementById("battle-screen").classList.add("visible");
    showWatchControls(true);
    render();
    scheduleAI();
  }

  document.getElementById("btn-autosim").addEventListener("click", openAutoSim);
  document.getElementById("autosim-close").addEventListener("click", () => {
    document.getElementById("autosim-overlay").classList.add("hidden");
  });
  document.getElementById("autosim-watch").addEventListener("click", () => startAutoPlay(_autosimOpponent));
  document.getElementById("btn-takeover").addEventListener("click", () => {
    view.autoPlay = false;
    view.autoPlayPaused = false;
    showWatchControls(false);
    // v3.9：若果喺 AI 分步回合中途接管，繼續行埋 AI 嗰段
    if (state && state.activeSide === "A" && !state.winner) scheduleAI();
  });

  // v3.7: 觀戰播放控制
  document.getElementById("btn-watch-pause").addEventListener("click", () => {
    if (!view.autoPlay) return;
    view.autoPlayPaused = !view.autoPlayPaused;
    showWatchControls(true);
    if (view.autoPlayPaused) {
      clearTimeout(view.aiTimer);
    } else {
      scheduleAI();
    }
  });
  document.getElementById("watch-speed").addEventListener("change", (e) => {
    view.aiDelay = parseInt(e.target.value, 10) || 1000;
  });
  document.getElementById("btn-watch-skip").addEventListener("click", () => {
    if (!view.autoPlay || view.autoPlayPaused) return;
    clearTimeout(view.aiTimer);
    view.aiDelay = 1;   // 快進：極速逐回合跑完
    scheduleAI();
  });

  // v3.5: 對比模式 toggle
  document.getElementById("btn-compare").addEventListener("click", () => {
    view._compareMode = !view._compareMode;
    view._compareSel.clear();
    document.querySelectorAll(".deck-card").forEach(c => c.classList.remove("compare-selected"));
    document.getElementById("btn-compare").classList.toggle("compare-on", view._compareMode);
    document.getElementById("btn-autosim").textContent = "🤖 自動模擬對戰";
    document.getElementById("btn-autosim").disabled = view._compareMode ? true : !view._chosenDeck;
    document.getElementById("btn-start").disabled = view._compareMode ? true : !view._chosenDeck;
    const hint = document.getElementById("deck-picker-hint");
    if (hint) hint.textContent = view._compareMode
      ? "⚖️ 對比模式：揀 2+ 副 deck（再撳一次「⚖️ 對比模式」離開）"
      : "";
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
    // v3.9.1: 階段色（data-phase → CSS 每階段唔同 accent）
    document.querySelectorAll("#phase-pill, #phase-label").forEach(el => el.dataset.phase = state.phase);
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
        zoneEl.classList.remove("has-card", "is-source", "is-target", "is-weakness", "is-selectable-atk", "has-attacked");
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
          // v3.9 手動對戰：P 方 BATTLE 階段 — 未攻擊嘅角色標示可揀做攻擊者 / 已攻擊嘅變灰
          if (side === "P" && state.activeSide === "P" && state.phase === "BATTLE" && !state.winner) {
            const f = state.turnFlags.P || {};
            const doubleOk = (f.doubleAttackUids || {})[card._uid];
            if ((f.attackedUids || {})[card._uid] && !doubleOk) {
              zoneEl.classList.add("has-attacked");
            } else if (view.attackerUid !== card._uid) {
              zoneEl.classList.add("is-selectable-atk");
            }
          }
          // v3.9：有攻擊者被揀咗 → AI 場上嘅合法角色目標加紅框
          if (side === "A" && state.activeSide === "P" && state.phase === "BATTLE" && view.attackerUid) {
            const targets = E.attackableTargets(state, "P", view.attackerUid);
            if (targets.some(t => t.kind === "card" && t.card._uid === card._uid)) {
              zoneEl.classList.add("is-target");
            }
          }
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
          // v3.9.4: 空基地格都接受拖曳 — 手牌拖落嚟 = 基地部署
          if (side === "P") {
            slot.addEventListener("dragover", (e) => {
              if (!canSetDeployNow()) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              slot.classList.add("drag-target");
            });
            slot.addEventListener("dragleave", () => slot.classList.remove("drag-target"));
            slot.addEventListener("drop", (e) => {
              e.preventDefault();
              slot.classList.remove("drag-target");
              if (!canSetDeployNow()) return;
              const handIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
              if (isNaN(handIdx)) return;
              onHandDeployDrop(handIdx);
            });
          }
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

  // ===== v3.9.4: 基地拖曳部署 helpers =====
  function canSetDeployNow() {
    if (!state || state.activeSide !== "P" || state.phase !== "ACTION" || state.winner) return false;
    const p = state.players.P;
    if ((state.turnFlags.P || {}).setDeployUsed) return false;
    if (p.base.faceDown.length >= E.BASE_SIZE_MAX) return false;
    return p.hand.length > 0;
  }
  function onHandDeployDrop(handIdx) {
    const p = state.players.P;
    const handCard = p.hand[handIdx];
    if (!handCard) return;
    const handEl = document.querySelector(`.hand-card[data-uid="${handCard._uid}"]`);
    const baseZone = document.querySelector(".mat-p .zone-base");
    if (handEl && baseZone) flyCard(handEl, baseZone);
    const r = E.setDeploy(state, "P", handIdx);
    if (r && !r.ok) console.warn(r.err);
    SFX && SFX.play("deploy");
    view.selectedHandIdx = null;
    render();
  }

  function buildMiniCard(card, side, slot) {
    const div = document.createElement("div");
    div.className = "mini-card";
    div.dataset.uid = card._uid;
    div.dataset.attr = card.attribute;
    const pow = E.cardEffectivePower(state, side, card);
    if (!isEffectImplemented(card)) div.classList.add("unimplemented");

    // v3.9.2: AI 戰區卡都係公開資訊 — 同自己一樣顯示 art + 參數（唔再面朝下）
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
    name.textContent = (side === "A" ? "AI · " : "") + E.shortName(card);
    info.appendChild(name);
    div.appendChild(info);

    div.addEventListener("click", (e) => {
      e.stopPropagation();
      onZoneCardClick(side, slot, card);
    });
    // v3.9.2: 場上所有卡（含 AI 公開卡）hover 出資料 banner
    bindCardHover(div, card);
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

  // ===== v3.9.1: 真人守方 COUNTER 應對 modal =====
  function openCounterModal() {
    const pend = state.pending;
    if (!pend || pend.kind !== "counter") return;
    view._counterOpen = true;
    view._counterIdx = null;
    const modal = document.getElementById("modal");
    document.getElementById("modal-title").textContent = pend.title || "應對步驟（COUNTER）";
    const body = document.getElementById("modal-body");
    const atk = pend.attackerUid ? E.findAnywhereOnField(state.players[pend.attackerSide], pend.attackerUid) : null;
    const atkName = atk ? `${E.shortName(atk)}（P${E.cardEffectivePower(state, pend.attackerSide, atk)}）` : "";
    body.innerHTML = `<p style="margin-top:0">${atkName ? "⚠️ " + atkName + " 正在攻擊你" : "AI 攻擊你"} — 應對步驟：揀 1 張 COUNTER 卡（棄置 → 攻擊者本回合 -Power），或直接承受攻擊。</p>`;
    pend.opts.forEach(o => {
      const opt = document.createElement("label");
      opt.className = "retreat-option counter-option";
      opt.innerHTML = `<input type="radio" name="counter" value="${o.idx}"><span class="co-name">${o.name}</span><span class="co-power">Power -${o.power}</span>`;
      opt.querySelector("input").addEventListener("change", () => {
        view._counterIdx = o.idx;
        document.getElementById("modal-confirm").disabled = false;
      });
      body.appendChild(opt);
    });
    const skip = document.createElement("label");
    skip.className = "retreat-option counter-option skip";
    skip.innerHTML = `<input type="radio" name="counter" value="skip"><span class="co-name">唔用 COUNTER</span><span class="co-sub">直接承受攻擊</span>`;
    skip.querySelector("input").addEventListener("change", () => {
      view._counterIdx = -1;
      document.getElementById("modal-confirm").disabled = false;
    });
    body.appendChild(skip);
    document.getElementById("modal-confirm").disabled = true;
    document.getElementById("modal-confirm").textContent = "應對";
    modal.classList.remove("hidden");
  }
  function closeCounterModal() {
    view._counterOpen = false;
    view._counterIdx = null;
    document.getElementById("modal").classList.add("hidden");
  }
  function afterCounterResolved() {
    // 真人應對完 → 如果仲係 AI 回合（分步），繼續行埋 AI
    if (state && !state.winner && state.activeSide === "A" && !view.autoPlay) scheduleAI();
  }

  // ===== v3.9.2: 卡資料 hover banner（duels.ink 式：參數 chips + 效果說明，唔帶 art） =====
  const HOVER_OK = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(hover: hover)").matches;
  function cardBannerHTML(card) {
    const lv = card.level != null ? card.level : "—";
    const pw = DATA.numPower ? DATA.numPower(card.power) : (card.power || 0);
    const rg = DATA.numRange ? DATA.numRange(card.attackRange) : card.attackRange;
    const eff = (card.effect || "").trim();
    const attrs = `<span class="cb-chip lv">Lv${lv}</span><span class="cb-chip pw">P${pw}</span><span class="cb-chip rg">R${rg}</span>` +
      (card.attribute ? `<span class="cb-chip attr-${card.attribute}">${card.attribute}</span>` : "") +
      (card.feature ? `<span class="cb-chip feat">${card.feature}</span>` : "") +
      (card.rarity ? `<span class="cb-chip rarity">${card.rarity}</span>` : "");
    return `<div class="cb-name">${(card.name || "").replace(/^「.*」/, "") || E.shortName(card)}</div>` +
      `<div class="cb-stats">${attrs}</div>` +
      `<div class="cb-effect">${eff || "—（無效果文本）"}</div>`;
  }
  function showCardPop(card, anchorEl) {
    const pop = document.getElementById("card-pop");
    if (!pop || !card) return;
    pop.innerHTML = cardBannerHTML(card);
    pop.hidden = false;
    const r = anchorEl.getBoundingClientRect();
    const pw = pop.offsetWidth || 300;
    const ph = pop.offsetHeight || 140;
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    let top = r.top - ph - 10;
    if (top < 8) top = r.bottom + 10;
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }
  function hideCardPop() {
    const pop = document.getElementById("card-pop");
    if (pop) pop.hidden = true;
  }
  function bindCardHover(el, card) {
    if (!el || !card || !HOVER_OK) return;
    el.addEventListener("mouseenter", () => showCardPop(card, el));
    el.addEventListener("mouseleave", hideCardPop);
  }
  // 任何 render 之後有新 card 都自動重新綁 hover（renderHand / buildMiniCard 各自 call）
  function hidePopOnScroll() { window.addEventListener("scroll", hideCardPop, true); }
  hidePopOnScroll();

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
      const handCard = state.players.P.hand[handIdx];
      const callable = !!handCard && isHandCardCallable(handCard);
      const lv = handCard ? (E.cardEffectiveLv ? E.cardEffectiveLv(handCard) : handCard.level) : 1;
      callBtn.disabled = !callable;
      callBtn.textContent = lv >= 4 ? `號召到場（撤退合計 Lv${lv}）` : "號召到場（上前線）";
      callBtn.title = callable ? "" : handCallBlockReason(handCard);
      const canDeploy = state.activeSide === "P" && state.phase === "ACTION" &&
        !f.setDeployUsed && state.players.P.base.faceDown.length < E.BASE_SIZE_MAX;
      deployBtn.disabled = !canDeploy;
      deployBtn.title = canDeploy ? "" : (f.setDeployUsed ? "基地部署用咗（1 次/回合）" : "唔係行動階段");
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
      // Register as deck（v3.5 bugfix：expandDeck 展開 raw pairs → 50 卡 array，engine 先食得）
      const deckName = decoded.name && decoded.name.trim() ? "Shared_" + decoded.name.trim().slice(0, 30) : "Imported_" + Date.now().toString(36);
      DATA.DECKS[deckName] = DATA.expandDeck(pairs.map(([cn, q]) => [cn.replace(/-V\d+$/, ""), q]), deckName);
      // Build deck label
      const colorSet = new Set();
      pairs.forEach(([cn]) => {
        const c = DATA.CARDS_BY_NO[cn.replace(/-V\d+$/, "")];
        if (c) colorSet.add(c.attribute);
      });
      const colorLabels = { Red: "紅", Yellow: "黃", Blue: "藍", Green: "綠" };
      const colStr = [...colorSet].map(c => `<span class="color-chip ${c}">${colorLabels[c] || c}</span>`).join("");
      const status = document.getElementById("import-status");
      status.innerHTML = `✅ 匯入成功！${total} 張卡 · ${colStr} · 自動模擬對戰中…`;
      status.className = "import-status ok";
      // v3.5: 匯入後唔自動開戰 — 揀返 deck + 自動跑模擬（「系統自行模擬對戰」）
      setTimeout(() => {
        hideImportOverlay();
        selectDeckInPicker(deckName);
        openAutoSim();
      }, 900);
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

  // v3.5: 匯入後喺 picker 揀返該 deck（重新 render 包含新 deck）
  function selectDeckInPicker(name) {
    renderDeckPicker();
    const card = document.querySelector('.deck-card[data-deck="' + window.CSS.escape(name) + '"]');
    if (card) card.click();
    else {
      view._chosenDeck = name;
      document.getElementById("btn-start").disabled = false;
      document.getElementById("btn-autosim").disabled = false;
    }
  }
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
  // ===== v3.9 手動對戰：合法動作檢查 helpers =====
  function battleHasEmptySlot(p) {
    return !p.battle.front || !p.battle.wing[0] || !p.battle.wing[1] || !p.battle.back;
  }
  function canPayRetreat(lv) {
    // subset-sum：係咪有組 retreat source 合計 Lv 啱啱好 = lv（戰區角色照 Lv，蓋卡每張 1）
    const p = state.players.P;
    const vals = [];
    E.battleChars(p).forEach(({ card }) => vals.push((card._faceDown ? 1 : (E.cardEffectiveLv ? E.cardEffectiveLv(card) : card.level)) || 1));
    p.base.faceDown.forEach(() => vals.push(1));
    const reach = new Array(lv + 1).fill(false);
    reach[0] = true;
    for (const v of vals) {
      for (let s = lv - v; s >= 0; s--) if (reach[s]) reach[s + v] = true;
    }
    return !!reach[lv];
  }
  function isHandCardCallable(c) {
    if (state.activeSide !== "P" || state.phase !== "ACTION" || state.winner) return false;
    const f = state.turnFlags.P || {};
    if (f.callCount >= E.maxCallCount(state, "P")) return false;
    if (!battleHasEmptySlot(state.players.P)) return false;
    const lv = E.cardEffectiveLv ? E.cardEffectiveLv(c) : (c.level || 1);
    if (lv <= 3) return true;
    return canPayRetreat(lv);
  }
  function handCallBlockReason(c) {
    if (state.activeSide !== "P") return "未到你嘅回合";
    if (state.phase !== "ACTION") return "淨係行動階段先可以號召";
    const f = state.turnFlags.P || {};
    if (f.callCount >= E.maxCallCount(state, "P")) return `號召次數已用完（${E.maxCallCount(state, "P")} 次/回合）`;
    if (!battleHasEmptySlot(state.players.P)) return "戰區已滿（先鋒/側翼×2/後衛）";
    const lv = E.cardEffectiveLv ? E.cardEffectiveLv(c) : (c.level || 1);
    if (lv > 3 && !canPayRetreat(lv)) return `撤退合計唔夠 Lv${lv}（撤退戰區角色或蓋卡嚟補）`;
    return "";
  }

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
      const callable = isHandCardCallable(c);
      if (!callable) { div.classList.add("unplayable"); div.title = handCallBlockReason(c); }
      else div.classList.add("hand-callable");
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

      // v3.9: click 開動作 modal 加 260ms debounce — 快速雙撳 = 號召時唔會俾 modal 遮住
      let _hcTimer = null;
      div.addEventListener("click", () => {
        if (state.activeSide !== "P") return;
        if (_hcTimer) clearTimeout(_hcTimer);
        _hcTimer = setTimeout(() => {
          _hcTimer = null;
          if (state.activeSide !== "P" || state.winner) return;
          showCardDetail(c, i);
        }, 260);
      });

      // double-click → 快速號召（Lv1-3 直接，Lv4+ retreat modal）；同時取消開 modal
      div.addEventListener("dblclick", (e) => {
        e.preventDefault();
        if (_hcTimer) { clearTimeout(_hcTimer); _hcTimer = null; }
        if (!callable) return;
        onHandCallDirect(i);
      });
      bindCardHover(div, c);   // v3.9.2: 手牌 hover 出資料 banner

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
      if (view.attackerUid) hint.textContent = "揀攻擊目標（AI 場上紅框角色 / 破綻空格），或撳自己角色取消";
      else hint.textContent = "戰鬥階段：直接撳自己未攻擊嘅角色（青框）揀攻擊者，或用 ⚔ 揀；打完撳 結束回合";
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
      hint.textContent = `行動階段：單撳手牌開動作 · 雙撳快速號召 · 拖去戰區都得 · 撳 結束回合 入戰鬥`;
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
      const f = state.turnFlags.P || {};
      const canAtk = E.battleChars(state.players.P).some(({ card }) =>
        !(f.attackedUids || {})[card._uid] || (f.doubleAttackUids || {})[card._uid]);
      state.phase = canAtk ? "BATTLE" : "RESPOND";
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
    if (view._counterOpen) {
      // v3.9.1: 取消 = 唔用 COUNTER 應對
      E.resolveCounter(state, { use: false });
      closeCounterModal();
      render();
      afterCounterResolved();
      return;
    }
    document.getElementById("modal").classList.add("hidden");
    view.pendingCall = null;
    view.pendingSetDeploy = null;
    view.moveFromUid = null;
    view._moveToBase = null;
    view.attackerUid = null;
  });

  document.getElementById("modal-confirm").addEventListener("click", () => {
    const modal = document.getElementById("modal");
    if (view._counterOpen) {
      // v3.9.1: 揀咗 COUNTER 卡 → resolveCounter；-1 = 唔用
      const idx = view._counterIdx;
      if (idx == null) return;
      E.resolveCounter(state, idx >= 0 ? { use: true, idx } : { use: false });
      closeCounterModal();
      render();
      afterCounterResolved();
      return;
    }
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
    if (state.winner) return;

    // v3.5: 觀戰模式（autoPlay）— 撳任何 mat 卡睇資訊（唔理邊方回合）
    if (view.autoPlay) {
      showCardDetail(card);
      return;
    }

    if (state.activeSide !== "P") return;

    // Attack mode: clicked target
    if (state.phase === "BATTLE" && view.attackerUid && side !== "P") {
      // Defender: offer COUNTER first
      offerCounterThenResolve(side, card);
      return;
    }

    // v3.9 手動對戰：BATTLE 階段撳自己嘅角色 = 揀做攻擊者（再撳取消）；已攻擊過嘅先開 detail
    if (state.phase === "BATTLE" && side === "P" && state.activeSide === "P") {
      const f = state.turnFlags.P || {};
      const doubleOk = (f.doubleAttackUids || {})[card._uid];
      const spent = (f.attackedUids || {})[card._uid] && !doubleOk;
      if (spent) {
        showCardDetail(card);
        return;
      }
      view.attackerUid = view.attackerUid === card._uid ? null : card._uid;
      SFX && SFX.play("click");
      render();
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
      return;
    }

    // v3.5: 冇任何 action mode 進行中 → 撳 mat 卡睇資訊（正常/觀戰通用）
    showCardDetail(card);
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
    clearTimeout(view.aiTimer);
    view.autoPlay = false;          // v3.7: 離開觀戰模式（避免同正常模式溝埋）
    view.autoPlayPaused = false;
    showWatchControls(false);
    view._compareSel.clear();
    document.querySelectorAll(".deck-card").forEach(c => c.classList.remove("compare-selected"));
    renderDeckPicker();
  });

  // ---- AI turn ----
  // v3.7: turn-by-turn — 每個 tick 只行一回合（觀戰可以逐回合睇）
  function scheduleAI() {
    clearTimeout(view.aiTimer);
    view.aiTimer = setTimeout(() => {
      if (state.winner) {
        showWatchControls(false);
        return;
      }
      if (!view.autoPlay) {
        // v3.9 手動模式：AI 回合分步（行動 → 戰鬥 → 結束回合），每步 render 畀玩家睇
        if (state.activeSide !== "A") return;
        if (state.winner) return;
        if (!view._aStep) {
          view._aStep = 1;
          AI.aiActions(state, "A");          // 基地部署 / 號召 / 戰基移動
        } else if (view._aStep === 1) {
          if (!E.isFirstTurnBattleSkipped(state, "A")) AI.aiBattlePhase(state, "A");
          if (E.isPaused(state)) {           // v3.9.1: 真人守方應對 — 開 modal 等揀，唔好跳 step
            view._aStep = 1;
            render();
            openCounterModal();
            return;
          }
          view._aStep = 2;
        } else {
          view._aStep = 0;
          E.endTurn(state);                  // 結束 → engine 自動開始 P 回合
        }
        render();
        if (state.winner) return;
        if (view._aStep) scheduleAI();       // 未完 → 排下一段
        return;
      }
      // 觀戰模式：AI 打雙方，每 tick 一回合
      if (view.autoPlayPaused) return;   // 暫停中：唔再排期，等 resume
      AI.aiTurnFor(state, state.activeSide);
      render();
      if (state.winner) {
        showWatchControls(false);
        return;
      }
      scheduleAI();   // 排下一回合
    }, view.aiDelay == null ? 1000 : view.aiDelay);
  }

  // v3.7: 觀戰控制 bar 顯示/隱藏
  function showWatchControls(show) {
    const bar = document.getElementById("watch-controls");
    if (bar) bar.hidden = !show;
    const pauseBtn = document.getElementById("btn-watch-pause");
    if (pauseBtn) pauseBtn.textContent = view.autoPlayPaused ? "▶ 繼續" : "⏸ 暫停";
  }

  // ---- Log ----
  // v3.9.1: 圖形化 — icon + 分類色條 + turn divider，唔再係 raw text console
  function renderLog() {
    const root = document.getElementById("log-list");
    root.innerHTML = "";
    state.log.forEach(entry => {
      const div = document.createElement("div");
      div.className = "log-line";
      if (entry.side === "P") div.classList.add("side-P");
      if (entry.side === "A") div.classList.add("side-A");

      let msg = entry.msg;
      let icon = "·";
      if (entry.msg.startsWith("===")) {
        div.classList.add("log-system", "log-divider");
        msg = entry.msg.replace(/\s*={2,}\s*/g, " · ").replace(/^[·\s]+|[·\s]+$/g, "") || "—";
        icon = "🛡";
      } else if (/^第 \d+ 回合/.test(entry.msg)) {
        div.classList.add("log-turn");
        icon = "🌀";
      } else if (entry.msg.includes("遊戲結束") || entry.msg.includes("獲勝")) {
        div.classList.add("log-system", "log-result");
        icon = "🏁";
      } else if (/Rush Point/.test(entry.msg)) {
        div.classList.add("log-rp");
        icon = "⭐";
      } else if (entry.msg.startsWith("[COUNTER]")) {
        div.classList.add("log-counter");
        msg = entry.msg.replace(/^\[COUNTER\]\s*/, "");
        icon = "🛡";
      } else if (entry.msg.includes("攻") || entry.msg.includes("破綻")) {
        div.classList.add("log-battle");
        icon = "⚔";
      } else if (/號召|基地部署|戰基移動|捨棄/.test(entry.msg)) {
        div.classList.add("log-action");
        icon = "🃏";
      } else if (entry.msg.startsWith("[效果未實裝]")) {
        div.classList.add("log-stub");
        msg = entry.msg.replace(/^\[效果未實裝\]\s*/, "");
        icon = "⚠";
      } else if (entry.msg.startsWith("[效果]") || entry.msg.startsWith("[DSL]")) {
        div.classList.add("log-effect");
        msg = entry.msg.replace(/^\[(效果|DSL)\]\s*/, "");
        icon = "✨";
      } else if (/應對|COUNTER/.test(entry.msg)) {
        div.classList.add("log-counter");
        icon = "🛡";
      }

      const ic = document.createElement("span");
      ic.className = "log-ico";
      ic.textContent = icon;
      const tx = document.createElement("span");
      tx.className = "log-txt";
      tx.textContent = msg;
      div.appendChild(ic);
      div.appendChild(tx);
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
    DATA.DECKS[deckName] = DATA.expandDeck(pairs.map(([cn, q]) => [cn.replace(/-V\d+$/, ""), q]), deckName);   // v3.5 bugfix
    view._chosenDeck = deckName;
    startBattle();
  })();
})();
