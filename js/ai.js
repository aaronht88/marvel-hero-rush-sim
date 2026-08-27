// =============================================================
// Marvel Hero Rush TCG — Heuristic AI v0.2
// Aligned with official 6-step turn flow. Runs inside the engine
// callbacks — no DOM access. Resolves engine.pending itself.
// =============================================================
(function (global) {
  "use strict";

  const E = global.MHR_ENGINE;

  function aiTurn(state) {
    return aiTurnFor(state, "A");
  }

  // M4: 參數化 side — 測試 harness 可以用同一套 AI 自動打雙方（P vs A 全自動對戰驗證）
  function aiTurnFor(state, side) {
    const me = state.players[side];
    const opp = state.players[side === "P" ? "A" : "P"];
    const flags = state.turnFlags[side];

    // (1) 基地部署 (1 次/回合) — 早期冇嘢做就用基地部署攤節奏
    if (!flags.setDeployUsed && me.hand.length >= 4 && me.base.faceDown.length < 6) {
      // 揀 Lv 最高嘅手牌蓋入基地（避免將高 Lv 牌浪費喺前線）
      let bestIdx = -1, bestLv = -1;
      for (let i = 0; i < me.hand.length; i++) {
        if (E.cardEffectiveLv(me.hand[i]) > bestLv) {
          bestLv = E.cardEffectiveLv(me.hand[i]);
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) E.setDeploy(state, side, bestIdx);
    }

    // (2) 行動號召 (上 3 次) — 優先叫 Lv1-3 直接上場，再 Lv4-6 計 retreat cost
    const callBudget = E.maxCallCount(state, side);
    while (flags.callCount < callBudget && !state.winner) {
      const pick = pickBestCall(state, side);
      if (!pick) break;
      const r = E.callCard(state, side, pick.handIdx, pick.retreatUids);
      if (!r.ok) { console.warn("ai call failed:", r.err); break; }
    }

    // (3) 戰基移動 — 嘗試把蓋卡 Lv 1 翻入先鋒（如果空置）
    if (!me.battle.front && me.base.faceDown.length > 0) {
      E.battleBaseMove(state, side, me.base.faceDown[0]._uid, false);
    }

    if (state.winner) return;

    // (4) 戰鬥階段 — 先攻首回合跳過
    if (!E.isFirstTurnBattleSkipped(state, side)) {
      aiBattlePhase(state, side);
    }

    // (5) 應對階段 — 簡化：暫時跳過（AI 唔主動 counter/應對號召）

    // (6) 回合結束
    E.endTurn(state);
  }

  // 揀最佳號召卡：先 Lv4+（攞高戰力），後 Lv1-3
  function pickBestCall(state, side) {
    const me = state.players[side];
    const candidates = me.hand.map((c, idx) => ({ c, idx }));
    // Lv 4+ 優先（依 Lv 降冪）
    const high = candidates.filter(x => x.c.level >= 4).sort((a, b) => b.c.level - a.c.level);
    for (const cand of high) {
      const uids = findRetreatCost(state, side, cand.c.level);
      if (uids) return { handIdx: cand.idx, retreatUids: uids };
    }
    // Lv 1-3 降冪
    const low = candidates.filter(x => x.c.level <= 3).sort((a, b) => b.c.level - a.c.level);
    if (low.length && !me.battle.front) return { handIdx: low[0].idx, retreatUids: [] };
    // Lv 1-3 but front occupied: skip
    return null;
  }

  // 計可唔可以 retreat total Lv = targetLv
  // 先試 battle chars；再試 base faceDown (each = 1)
  function findRetreatCost(state, side, targetLv) {
    const me = state.players[side];
    const sources = [];
    let sum = 0;
    // 戰區角色優先 (確切 Lv)
    const battles = E.battleChars(me).map(x => x.card);
    for (const c of battles) {
      if (sources.find(s => s._uid === c._uid)) continue;
      sources.push(c);
      sum += c.level;
      if (sum === targetLv) return sources.map(s => s._uid);
      if (sum > targetLv) { sources.pop(); sum -= c.level; }
    }
    // 蓋卡每張當 Lv 1
    for (const c of me.base.faceDown) {
      if (sum >= targetLv) break;
      if (sources.find(s => s._uid === c._uid)) continue;
      sources.push(c);
      sum += 1;
      if (sum === targetLv) return sources.map(s => s._uid);
    }
    return null;
  }

  function aiBattlePhase(state, side) {
    const me = state.players[side];
    const opp = state.players[side === "P" ? "A" : "P"];

    // 順序：先鋒 → 側翼 → 後衛
    const order = ["front", "wing1", "wing2", "back"];
    for (const slot of order) {
      const attacker = me.battle[slot] || (slot === "wing1" ? me.battle.wing[0] : slot === "wing2" ? me.battle.wing[1] : null);
      if (!attacker) continue;
      if (state.turnFlags[side].attackedUids[attacker._uid]) continue;
      // pick best target
      const targets = E.attackableTargets(state, side, attacker._uid);
      if (targets.length === 0) continue;
      const pick = chooseBestTarget(state, side, attacker, targets);
      if (!pick) continue;
      // M4: COUNTER 已由 attack() 內部處理（DSL + legacy），呢度唔再另行 call
      E.attack(state, side, attacker._uid, pick);
      if (state.winner) return;
    }
  }

  function chooseBestTarget(state, side, attacker, targets) {
    // 優先：破綻（保證 +1 RP）→ 打得贏 → 都要打
    const myAtk = E.cardEffectivePower(state, side, attacker);
    const weaknesses = targets.filter(t => t.kind === "weakness");
    if (weaknesses.length) return weaknesses[0];
    // 戰力上揀打得到的最低戰力目標
    const opp = side === "P" ? "A" : "P";
    const cards = targets.filter(t => t.kind === "card");
    const beaten = cards.find(t => E.cardEffectivePower(state, opp, t.card) < myAtk);
    if (beaten) return beaten;
    // 邊打都輸 — 都打一個（至少 try COUNTER window）
    return cards[0] || targets[0] || null;
  }

  // M1.5: AI 調整起始手牌 — 簡單 heuristic：Lv >= 5 嘅高費牌放返（最多 2 張），
  // 其餘保留（早期抽到高費牌會卡手，等於官方「調整」嘅合理用法）。
  function aiMulligan(state) {
    const me = state.players.A;
    const idxs = [];
    me.hand.forEach((c, i) => {
      if ((c.level || 0) >= 5 && idxs.length < 2) idxs.push(i);
    });
    return idxs;
  }

  global.MHR_AI = { aiTurn, aiTurnFor, aiMulligan };
})(window);
