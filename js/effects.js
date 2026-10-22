// =============================================================
// Marvel Hero Rush TCG — Effects DSL Engine v3.4 (M1)
// Declarative descriptor interpreter — see EFFECTS_DESCRIPTOR.md
//
// 5 sample ops implemented in M1:
//   draw, power_mod, retreat, prune, attack_bonus
// 其餘 ops (move/discard/attach/r_mod/face_down/show/lv_mod/
// return_to_hand/rush_point) 留 stub — S3/S4 補齊。
//
// Public entry: MHR_EFFECTS.runEffects(state, side, event)
// Public entry: MHR_EFFECTS.refreshAutos(state)
// Engine contract:
//   event → match trig×slot → cond → cost → ops (atomic) → enqueue
// Zone invariant: 移動用 object reference remove-then-add，identity ===
// Atomic: validate → commit；失敗唔執行（手牌 etc. 由 caller 還原）
// =============================================================

(function (global) {
  "use strict";

  // ---- target resolvers ----
  // 統一由 state + side + 對象 side 取出實際 cards。
  function resolveTarget(state, ownerSide, targetKey, ctx) {
    const me = state.players[ownerSide];
    const opp = state.players[ownerSide === "P" ? "A" : "P"];
    switch (targetKey) {
      case "self":        return []; // 需 effect.source，由 caller 注入
      case "attacker":    // M4: counter 目標 = 攻擊者（ctx.attackerUid）
        if (ctx && ctx.attackerUid) {
          const atk = opp.battle.front && opp.battle.front._uid === ctx.attackerUid ? opp.battle.front
            : opp.battle.back && opp.battle.back._uid === ctx.attackerUid ? opp.battle.back
            : opp.battle.wing.find(c => c && c._uid === ctx.attackerUid);
          return atk ? [atk] : [];
        }
        return [];
      case "my_field":    return battleAll(me);
      case "opp_field":   return battleAll(opp);
      case "my_battle":   return battleChars(me);
      case "opp_battle":  return battleChars(opp);
      case "my_front":    return me.battle.front ? [me.battle.front] : [];
      case "opp_front":   return opp.battle.front ? [opp.battle.front] : [];
      case "my_back":     return me.battle.back ? [me.battle.back] : [];
      case "opp_back":    return opp.battle.back ? [opp.battle.back] : [];
      case "my_wing":     return me.battle.wing.filter(Boolean);
      case "opp_wing":    return opp.battle.wing.filter(Boolean);
      case "my_base":     return me.base.faceDown.slice();
      case "opp_base":    return opp.base.faceDown.slice();
      case "my_hand":     return me.hand.slice();
      case "opp_hand":    return opp.hand.slice();
      case "my_retreat":  return me.retreat.slice();
      case "opp_retreat": return opp.retreat.slice();
      case "my_void":     return me.voidZone.slice();
      case "opp_void":    return opp.voidZone.slice();
      case "my_deck_top": return me.deck.slice(0, 1);
      case "chosen":      return []; // 需 UI pending prompt（M2+）
      default:            return [];
    }
  }

  function battleAll(p) {
    return battleChars(p);
  }

  function battleChars(p) {
    const out = [];
    if (p.battle.front) out.push(p.battle.front);
    if (p.battle.back) out.push(p.battle.back);
    p.battle.wing.forEach(c => { if (c) out.push(c); });
    return out;
  }

  // ---- filter ----
  // 兩種 shape 都接受：
  //   nested: { lv: { op:"<=", n:3 } }              ← effects.js 原生
  //   flat:   { lv: ">=", n: 4, feature: "Web" }    ← 更易讀，Z1/Z2 descriptor 用
  // flat 形式嘅語義：`n` 係「跟住比較符嗰個數值」，`op`（或 <key>Op）係比較符。
  function passFilter(card, filter, ctx, state, side) {
    if (!filter) return true;

    // ---- flat 形式 ----
    if (typeof filter.n !== "undefined") {
      const cmp = filter.op || "==";
      // 數值 key：lv / power / r（用 filter.n 比較）
      const NUMKEYS = ["lv", "power", "r"];
      for (const k of NUMKEYS) {
        if (typeof filter[k] !== "undefined" && typeof filter[k] !== "object") {
          // filter[k] 可能係比較符（{lv:'>=',n:4}）或者直接係數值（{lv:4}）
          const isOp = typeof filter[k] === "string" && /^[<>=!]/.test(filter[k]);
          const op = isOp ? filter[k] : cmp;
          const want = isOp ? filter.n : filter[k];
          if (!compareOp(op, readField(card, k), want)) return false;
        }
      }
      if (filter.feature && !splitFeatures(card).includes(filter.feature)) return false;
      if (filter.name && String(card.name || "").indexOf(filter.name) < 0) return false;
      return true;
    }

    // ---- nested 形式 ----
    for (const k of Object.keys(filter)) {
      const spec = filter[k];
      if (k === "feature") { if (!splitFeatures(card).includes(spec)) return false; continue; }
      if (k === "name") { if (String(card.name || "").indexOf(spec) < 0) return false; continue; }
      if (k === "zone" || k === "orderBy") continue;
      const op = typeof spec === "object" && spec !== null ? spec.op || spec[0] : null;
      const val = typeof spec === "object" && spec !== null
        ? (spec.var ? resolveVar(state, side, spec.var, ctx) : spec.n)
        : spec;
      const cardVal = readField(card, k);
      if (!compareOp(op, cardVal, val)) return false;
    }
    return true;
  }

  function readField(card, k) {
    if (!card) return 0;
    switch (k) {
      // v3.19: 蓋卡一律 Lv1（官方 P14 名詞 3）——同 engine.cardEffectiveLv 一致
      case "lv":    return card._faceDown ? 1 : (card.level + (card._lvMod || 0));
      case "power": return (card.power && parseInt(card.power, 10)) || 0;
      case "attr":  return card.attribute;
      // v3.19 BUGFIX: MHR 嘅 feature 係 '/' 分隔字串（例如 "Human/Web"），
      // 唔係 array。舊版直接回傳整個字串，所以 filter { feature:"Web" } 對
      // 一張 "Human/Web" 嘅卡永遠唔會 match —— 所有 【Web】/【Machine】 類
      // filter（SP01 一大票）靜靜哋篩錯卡。呢度回傳 array 畀 compareOp 處理。
      case "feature": return splitFeatures(card);
      default:      return null;
    }
  }

  // "Human/Web" → ["Human","Web"]；"Machine" → ["Machine"]
  function splitFeatures(card) {
    if (!card) return [];
    const f = card.feature;
    if (!f) return [];
    if (Array.isArray(f)) return f.map(x => String(x).trim()).filter(Boolean);
    return String(f).split("/").map(x => x.trim()).filter(Boolean);
  }

  function compareOp(op, a, b) {
    // v3.19: feature 讀出嚟係 array（"Human/Web" → ["Human","Web"]）。
    // filter { feature:"Web" } 嘅語義係「包含」，唔係等於，所以一律用
    // includes。舊版因為 readField 回傳字串而令呢個 filter 永遠唔中。
    if (Array.isArray(a)) {
      const needle = Array.isArray(b) ? b : [b];
      const has = needle.every(n => a.includes(n));
      if (op === "==" || op === undefined || op === null) return has;
      if (op === "!=") return !has;
      return false;
    }
    switch (op) {
      case "<=": return a <= b;
      case "<":  return a <  b;
      case ">=": return a >= b;
      case ">":  return a >  b;
      case "==": return a === b;
      case "!=": return a !== b;
      default:   return false;
    }
  }

  // ---- X vars resolution (M1 stub — Thor demo 唔需要，保留 hook) ----
  function resolveVar(state, side, varName, ctx) {
    // descriptor vars 已由 runEffects 解入 ctx（如 ctx.X = count_opp_battle）→ 優先
    if (ctx && ctx[varName] != null) return ctx[varName];
    switch (varName) {
      case "count_opp_battle":   return battleChars(state.players[side === "P" ? "A" : "P"]).length;
      case "count_my_field":     return battleChars(state.players[side]).length;
      case "count_my_hand":      return state.players[side].hand.length;
      case "this_power":         return ctx && ctx.source ? readField(ctx.source, "power") : 0;
      case "retreated_by_this_call":
        return ctx && ctx.retreatCount != null ? ctx.retreatCount : 0;
      default:                   return 0;
    }
  }

  // ---- condition evaluators ----
  // 讀卡 R（printed attackRange）
  function readRange(card) {
    if (!card) return 0;
    return (card.attackRange && parseInt(card.attackRange, 10)) || 0;
  }

  function evalCond(state, side, condArr, ctx) {
    if (!condArr || !condArr.length) return true;
    const p = state.players[side];
    const opp = state.players[side === "P" ? "A" : "P"];
    for (const c of condArr) {
      const k = c.if;
      if (k === "by_calling") {
        if (!ctx || !ctx.byCalling) return false;
      } else if (k === "all_my_field_attr") {
        const chars = battleChars(p);
        if (!chars.length) return false;
        if (!chars.every(x => x.attribute === c.attr)) return false;
      } else if (k === "my_hand_odd") {
        if (p.hand.length % 2 !== 1) return false;
      } else if (k === "my_hand_even") {
        if (p.hand.length % 2 !== 0) return false;
      } else if (k === "opp_front_r_is") {
        const f = opp.battle.front;
        if (!f) return false;
        if (readRange(f) !== (c.n || 0)) return false;
      } else if (k === "opp_battle_total_r_ge") {
        const total = battleChars(opp).reduce((s, x) => s + readRange(x), 0);
        if (total < (c.n || 0)) return false;
      } else if (k === "opp_battle_has_power_ge") {
        if (!battleChars(opp).some(x => readField(x, "power") >= (c.n || 0))) return false;
      } else if (k === "my_battle_has_attr_except_self") {
        const others = battleChars(p).filter(x => x !== (ctx && ctx.source));
        if (!others.some(x => x.attribute === c.attr)) return false;
      } else if (k === "both_field_no_lv4") {
        const all = battleChars(p).concat(battleChars(opp));
        if (all.some(x => readField(x, "lv") >= (c.n || 4))) return false;
      } else if (k === "my_base_empty") {
        if (p.base.faceDown.length > 0) return false;
      } else if (k === "true") {
        // no-op
      } else {
        // unknown cond → fail safe (唔觸發)
        return false;
      }
    }
    return true;
  }

  // ---- log helper (讀 engine.log 結構) ----
  function emitLog(state, msg, side) {
    state.log.push({ side: side || null, msg });
  }

  function shortName(c) {
    if (!c) return "?";
    return (c.name || "").replace(/^「.*」/, "").trim() || c.name;
  }

  // =============================================================
  // OP IMPLEMENTATIONS (5 sample + stubs)
  // =============================================================
  // 每個 op 接收 (state, side, opDef, ctx)：
  //   - commit 後改 state
  //   - 返回 { ok, consumed? } (consumed 用於指示卡自身消耗)
  // ctx = { source, byCalling, retreatCount }

  function opDraw(state, side, opDef) {
    const n = opDef.n || 0;
    if (!n) return { ok: false };
    let drew = 0;
    const p = state.players[side];
    for (let i = 0; i < n; i++) {
      if (p.deck.length === 0) {
        // deck-out handled by drawN
        if (!state.winner) {
          const opp = side === "P" ? "A" : "P";
          emitLog(state, `${p.name} 牌組耗盡！${state.players[opp].name} 獲勝（deck-out）`, opp);
          state.winner = opp;
        }
        break;
      }
      p.hand.push(p.deck.shift());
      drew++;
    }
    if (drew > 0) emitLog(state, `[效果] ${opDef._sourceName || "?"} 抽 ${drew}`, side);
    return { ok: true, drew };
  }

  function opPowerMod(state, side, opDef, ctx) {
    let amt = 0;
    if (typeof opDef.amount === "number") {
      amt = opDef.amount;
    } else if (opDef.amount && opDef.amount.var) {
      const base = resolveVar(state, side, opDef.amount.var, ctx);
      const scale = opDef.amount.scale || 1;
      amt = base * scale;
    }
    const targets = collectTargets(state, side, opDef.target, ctx);
    if (!targets.length) return { ok: false };
    targets.forEach(card => {
      card._powerMod = (card._powerMod || 0) + amt;
      emitLog(state, `[效果] ${shortName(card)} Power ${amt >= 0 ? "+" : ""}${amt}`, side);
    });
    return { ok: true };
  }

  function opRetreat(state, side, opDef) {
    const targets = collectTargets(state, side, opDef.target, opDef._ctx || {});
    if (!targets.length) return { ok: false };
    targets.forEach(card => doRetreat(state, side, card, "效果"));
    return { ok: true };
  }

  function opPrune(state, side, opDef, ctx) {
    const all = collectTargets(state, side, opDef.target, ctx);
    const filtered = all.filter(card => passFilter(card, opDef.filter, ctx, state, side));
    if (!filtered.length) {
      emitLog(state, `[效果] 無合法目標除外`, side);
      return { ok: false };
    }
    // M1 簡單實裝 — first-match（filter + 任選 1 張）；full chosen prompt 留 M2
    const card = filtered[0];
    doPrune(state, side, card);
    return { ok: true };
  }

  function opAttackBonus(state, side, opDef, ctx) {
    // 對 self 加 second-chance-to-attack（already 對應 turnFlags.doubleAttackUids）
    // Thor 入場 → 自己本回合可攻 2 次
    if (opDef.target === "self" && ctx && ctx.source) {
      const uid = ctx.source._uid;
      if (!state.turnFlags[side].doubleAttackUids[uid]) {
        state.turnFlags[side].doubleAttackUids[uid] = true;
        emitLog(state, `[效果] ${shortName(ctx.source)} 本回合可攻擊 2 次`, side);
        return { ok: true };
      }
    }
    return { ok: false };
  }

  // R±（S3: AUTO 卡如 BP01-071 WING / SD03-004 BACK）
  function opRMod(state, side, opDef, ctx) {
    let amt = 0;
    if (typeof opDef.amount === "number") amt = opDef.amount;
    else if (opDef.amount && opDef.amount.var) {
      const base = resolveVar(state, side, opDef.amount.var, ctx);
      amt = base * (opDef.amount.scale || 1);
    }
    const targets = collectTargets(state, side, opDef.target, ctx);
    if (!targets.length) return { ok: false };
    targets.forEach(card => {
      card._rMod = (card._rMod || 0) + amt;
      emitLog(state, `[效果] ${shortName(card)} R ${amt >= 0 ? "+" : ""}${amt}`, side);
    });
    return { ok: true };
  }

  // Lv±（S3: BP01-004 Hulk / SD03-004 BASE）
  function opLvMod(state, side, opDef, ctx) {
    let amt = 0;
    if (typeof opDef.amount === "number") amt = opDef.amount;
    else if (opDef.amount && opDef.amount.var) {
      const base = resolveVar(state, side, opDef.amount.var, ctx);
      amt = base * (opDef.amount.scale || 1);
    }
    const targets = collectTargets(state, side, opDef.target, ctx);
    if (!targets.length) return { ok: false };
    targets.forEach(card => {
      card._lvMod = (card._lvMod || 0) + amt;
      emitLog(state, `[效果] ${shortName(card)} Lv ${amt >= 0 ? "+" : ""}${amt}`, side);
    });
    return { ok: true };
  }

  // 蓋卡（S3b: ACTI:BASE "cover this card" → 卡變 face-down set card）
  function opCoverSelf(state, side, opDef, ctx) {
    if (!ctx || !ctx.source) return { ok: false };
    const card = ctx.source;
    if (card._faceDown) return { ok: false };
    card._faceDown = true;
    emitLog(state, `[效果] ${shortName(card)} 蓋卡（cover）`, side);
    return { ok: true };
  }

  // ---- stub ops（other 9 from §3 vocabulary）----
  function opStub(state, side, opDef, ctx) {
    emitLog(state, `[效果未實裝] op:${opDef.op}（M2+ 補齊）`, side);
    return { ok: false, stub: true };
  }

  // =============================================================
  // v3.19 Z2 — discard / prune 由 stub 升做真 op
  //
  // 呢兩個之前係 opStub，所以任何 descriptor 用佢哋都會 log「未實裝」。
  // zone_transfer 嘅 after[] 同 choose_one 分支都要用，所以必須實作。
  // 重用 Z1 嘅 COST_VALIDATORS/APPLIERS，確保同一套語義（atomic 檢查）。
  // =============================================================

  // op: { op:"discard", n, self?, from? }
  function opDiscard(state, side, opDef, ctx) {
    const cost = { op: 'discard', n: opDef.n, self: opDef.self };
    const v = COST_VALIDATORS.discard(state, side, cost, ctx);
    if (!v.ok) {
      emitLog(state, `[效果] ${opDef._sourceName || ""}：無法捨棄（${v.err}）`, side);
      return { ok: false, err: v.err };
    }
    COST_APPLIERS.discard(state, side, cost, ctx, v.plan);
    return { ok: true };
  }

  // op: { op:"prune", n, target?, filter? }
  // 注意 prune 做「效果」（唔係 cost）時，log 措辭應該係「裁剪」而唔係「cost」。
  function opPruneEffect(state, side, opDef, ctx) {
    const p = state.players[side];
    const opp = state.players[side === "P" ? "A" : "P"];

    // 對自己場上（多數 prune 效果係 prune 對手，但 V2 類會 prune 自己）
    if (opDef.target === "self_on_field" || opDef.target === "my_field") {
      const pool = battleAll(p).filter(c => !opDef.filter || passFilter(c, opDef.filter, ctx, state, side));
      if (!pool.length) { emitLog(state, `[效果] ${opDef._sourceName || ""}：無合法目標`, side); return { ok: true }; }
      doPrune(state, side, pool[0]);
      return { ok: true };
    }
    // 自己撤退區
    if (opDef.target === "my_retreat") {
      const pool = p.retreat.filter(c => !opDef.filter || passFilter(c, opDef.filter, ctx, state, side));
      if (!pool.length) { emitLog(state, `[效果] ${opDef._sourceName || ""}：撤退區無合法目標`, side); return { ok: true }; }
      const t = pool[0];
      const i = p.retreat.indexOf(t);
      p.retreat.splice(i, 1);
      p.voidZone.push(t);
      emitLog(state, `${p.name} ${shortName(t)} → VOID（裁剪）`, side);
      return { ok: true };
    }
    // 牌組頂
    if (opDef.target === "my_deck_top") {
      const n = opDef.n == null ? 1 : opDef.n;
      const k = Math.min(n, p.deck.length);
      for (let i = 0; i < k; i++) p.voidZone.push(p.deck.shift());
      if (k) emitLog(state, `${p.name} 裁剪牌組頂 ${k} 張 → VOID`, side);
      if (checkWinAfterEffect) checkWinAfterEffect(state);
      return { ok: true };
    }
    // 預設：對手戰場
    const pool = battleChars(opp).filter(c => !opDef.filter || passFilter(c, opDef.filter, ctx, state, side));
    if (!pool.length) { emitLog(state, `[效果] ${opDef._sourceName || ""}：對手場上無合法目標`, side); return { ok: true }; }
    doPrune(state, side === "P" ? "A" : "P", pool[0]);
    return { ok: true };
  }
  // =============================================================
  // v3.17 — CHOICE / CONDITIONAL-CHAIN primitives
  //
  // Audit (2026-10-21) found the two dominant blockers preventing effect
  // coverage from scaling past the 15 hand-written descriptors:
  //   "you may"     — 123 of 448 cards. Was silently swallowed by
  //                    /(?:may )?/ in the legacy regex path: the engine
  //                    ALWAYS executed the effect, so the player never got
  //                    a choice. resolveOptionalEffect() was referenced in a
  //                    comment but never implemented, and "OPTIONAL" was
  //                    never logged anywhere.
  //   "If you do"   — 180 of 448 cards. Conditional chains: the effect only
  //                    proceeds if the PREVIOUS clause succeeded. A flat op
  //                    list cannot express this.
  //
  // Both are now first-class descriptor primitives.
  // =============================================================

  // --- pending-choice plumbing -------------------------------------
  // Effects that need a player decision are NOT executed inside runEffects
  // (the engine is synchronous and the UI is not). Instead we park a
  // "pending choice" on the state and let app.js render a prompt. Resolving
  // it calls back into resumeChoice() with the player's answer.
  function parkChoice(state, side, payload) {
    if (!state.pendingChoices) state.pendingChoices = [];
    state.pendingChoices.push(Object.assign({ side }, payload));
    emitLog(state, `［選擇］${payload.prompt}`, side);
    return { ok: true, pending: true };
  }
  function hasPending(state, side) {
    return !!(state.pendingChoices && state.pendingChoices.some(c => c.side === side));
  }

  // op: { op:"optional", prompt, then:[...] }
  // Asks the player whether to take the optional effect. When `auto` is set
  // in the descriptor (used by AI / headless sim) it resolves immediately to
  // auto rather than parking a prompt.
  function opOptional(state, side, opDef, ctx) {
    const inner = opDef.then || [];
    // `auto` present → headless resolution (AI / batch sim): true = take it,
    // false = decline it. Must be checked with `!== undefined` because
    // `false` is a meaningful value, not "unset".
    if (opDef.auto !== undefined) {
      if (!opDef.auto) {
        emitLog(state, `${ctx.source ? shortName(ctx.source) : ""}：放棄可選效果`, side);
        return { ok: true, declined: true };
      }
      return runOpList(state, side, inner, ctx, opDef);
    }
    return parkChoice(state, side, {
      kind: "optional",
      prompt: opDef.prompt || "是否發動此效果？",
      cardUid: ctx.source && ctx.source._uid,
      cardName: ctx.source ? shortName(ctx.source) : "",
      then: inner,
      ctxSnapshot: snapshotCtx(ctx),
    });
  }

  // op: { op:"if_you_do", do:[...], else:[...] }
  // Runs `do`; if every op in it succeeds, `then` (or `do`'s own continuation)
  // proceeds. `else` fires when the do-block fails.
  function opIfYouDo(state, side, opDef, ctx) {
    const r = runOpList(state, side, opDef.do || [], ctx, opDef);
    if (r.ok) {
      if (opDef.then) return runOpList(state, side, opDef.then, ctx, opDef);
      return r;
    }
    if (opDef.else) return runOpList(state, side, opDef.else, ctx, opDef);
    return { ok: false, err: r.err };
  }

  // Run a list of ops as an atomic-ish batch. Returns {ok, err}.
  function runOpList(state, side, list, ctx, ownerOp) {
    for (const o of list || []) {
      const def = Object.assign({}, o);
      def._sourceName = (ctx.source && shortName(ctx.source)) || "";
      def._ctx = ctx;
      const fn = OPS[def.op];
      if (!fn) return { ok: false, err: `unknown op ${def.op}` };
      const r = fn(state, side, def, ctx);
      if (!r.ok) return r;
      if (r.pending) return r;   // choice parked — stop the chain
    }
    return { ok: true };
  }

  // ctx contains card references; we cannot serialise them into a parked
  // choice safely, so we store the source uid + minimal scalar fields.
  function snapshotCtx(ctx) {
    const out = {};
    Object.keys(ctx).forEach(k => {
      const v = ctx[k];
      if (v == null) return;
      const t = typeof v;
      if (t === "number" || t === "boolean" || t === "string") out[k] = v;
      else if (k === "source") out.sourceUid = v._uid;
    });
    return out;
  }

  // Called by app.js when the player answers a parked choice.
  function resolveChoice(state, side, answer) {
    if (!state.pendingChoices) return { ok: false, err: "no pending choice" };
    const idx = state.pendingChoices.findIndex(c => c.side === side);
    if (idx < 0) return { ok: false, err: "no pending choice for side " + side };
    const ch = state.pendingChoices[idx];
    state.pendingChoices.splice(idx, 1);

    // v3.19: choose_one 用 optionIndex（唔係 yes/no）
    if (ch.isChooseOne) {
      const ctx = Object.assign({}, ch.ctxSnapshot || {});
      if (ch.cardUid) ctx.source = findCardByUid(state, side, ch.cardUid) || null;
      const optIdx = answer && answer.optionIndex != null ? answer.optionIndex : -1;
      if (optIdx < 0 || !ch.then || !ch.then[optIdx]) {
        emitLog(state, `${ch.cardName || ""}：放棄二選一`, side);
        return { ok: true, declined: true };
      }
      const r = runOpList(state, side, [ch.then[optIdx]], ctx, { op: "choose_one" });
      refreshAutos(state);
      return r;
    }

    if (!answer.accept) {
      emitLog(state, `${ch.cardName || ""}：放棄可選效果`, side);
      return { ok: true, declined: true };
    }

    // v3.19: pick_card（zone_transfer 嘅 playerChooses）—— 用答案覆寫目標
    if (ch.kind === "pick_card") {
      const ctx = Object.assign({}, ch.ctxSnapshot || {});
      if (ch.cardUid) ctx.source = findCardByUid(state, side, ch.cardUid) || null;
      const chosenUid = answer.cardUid;
      if (!chosenUid || !ch.opDefSnapshot) return { ok: false, err: "pick_card 答案缺 cardUid" };
      const chosen = findCardByUid(state, side, chosenUid);
      if (!chosen) return { ok: false, err: "揀嘅卡已唔存在" };
      const opDef = ch.opDefSnapshot;
      delete opDef.playerChooses;                 // 已由玩家揀，唔再 park
      opDef.subject = "self";
      const ctx2 = Object.assign({}, ctx, { source: chosen });
      const r = opZoneTransfer(state, side, opDef, ctx2);
      refreshAutos(state);
      return r;
    }
    // rehydrate ctx
    const ctx = Object.assign({}, ch.ctxSnapshot || {});
    if (ch.cardUid) {
      const p = state.players[side];
      ctx.source = findCardByUid(state, side, ch.cardUid) || null;
    }
    const r = runOpList(state, side, ch.then || [], ctx, { op: "optional" });
    refreshAutos(state);
    return r;
  }

  function findCardByUid(state, side, uid) {
    const p = state.players[side];
    const scan = [].concat(
      battleAll(p), p.hand.slice(), p.deck.slice(), p.retreat.slice(),
      p.voidZone.slice(), p.base.faceDown.slice(), p.rushDeck.slice()
    );
    for (const c of scan) if (c && c._uid === uid) return c;
    return null;
  }

  const OPS = {
    draw: opDraw,
    power_mod: opPowerMod,
    retreat: opRetreat,
    prune: opPrune,
    attack_bonus: opAttackBonus,
    r_mod: opRMod,
    lv_mod: opLvMod,
    cover_self: opCoverSelf,
    // v3.17 choice / conditional-chain
    optional: opOptional,
    if_you_do: opIfYouDo,
    // v3.19 Z2 zone transfer
    zone_transfer: opZoneTransfer,
    // v3.19 Z2 zone transfer modes
    choose_one: opChooseOne,
    // v3.19 Z2 — 由 stub 升做真 op
    discard: opDiscard,
    prune: opPruneEffect,
    // stubs (declared so descriptors stay honest — they log, don't silently pass)
    move: opStub,
    attach: opStub,
    face_down: opStub,
    show: opStub,
    return_to_hand: opStub,
    rush_point: opStub,
  };

  // =============================================================
  // 內部 helper — 用 identity (`===`) 而非 `==`
  // =============================================================
  function removeFromZone(p, card) {
    // 場上：front / wing / back（identity 用 ===）
    if (p.battle.front === card) { p.battle.front = null; return true; }
    if (p.battle.back  === card) { p.battle.back  = null; return true; }
    const wi = p.battle.wing.indexOf(card);
    if (wi >= 0) { p.battle.wing[wi] = null; return true; }
    // 基地（identity）
    const bi = p.base.faceDown.indexOf(card);
    if (bi >= 0) { p.base.faceDown.splice(bi, 1); return true; }
    return false;
  }

  function doRetreat(state, side, card, why) {
    const p = state.players[side];
    if (!removeFromZone(p, card)) return false;
    const att = p.attached[card._uid] || [];
    delete p.attached[card._uid];
    p.retreat.push(card, ...att);
    emitLog(state, `${p.name} ${shortName(card)} → RETREAT（${why || "效果"}）`, side);
    return true;
  }

  function doPrune(state, side, card) {
    const p = state.players[side];
    if (!removeFromZone(p, card)) return false;
    const att = p.attached[card._uid] || [];
    delete p.attached[card._uid];
    p.voidZone.push(card, ...att);
    emitLog(state, `${p.name} ${shortName(card)} → VOID（裁剪）`, side);
    return true;
  }

  // 收集 op 嘅 target list — self 走 ctx.source，其他走 resolveTarget
  function collectTargets(state, side, targetKey, ctx) {
    if (targetKey === "self") {
      return ctx && ctx.source ? [ctx.source] : [];
    }
    if (!targetKey) return [];
    return resolveTarget(state, side, targetKey, ctx);
  }

  // =============================================================
  // INTERPRETER — engine contract
  // =============================================================
  // runEffects(state, side, event) — 入口
  // event = { kind: "enter_field"|"phase_start"|..., source?, byCalling?, retreatCount? }

  function runEffects(state, side, event) {
    const p = state.players[side];
    const flags = state.turnFlags[side];
    if (!flags) return; // 唔識 call — 防呆

    // 收集候選 effects：場上/手上/撤退/虛空 所有 descriptor blocks (skip 蓋卡)
    // v3.20 Z6: 之前只掃 battleAll(p) + hand，所以 TRIG【VOID】/【RETREAT】 呢類
    // 「卡喺 VOID/RETREAT 區時觸發」嘅效果永遠唔會被掃到 —— 即使 event 排咗隊。
    // 規則書 P15 效果類型：「若卡牌處於對應區域，則滿足條件時觸發」，所以
    // 候選池一定要包埋 RETREAT 同 VOID。
    const candidates = [];
    const allCards = [].concat(
      battleAll(p),
      p.hand.slice(),
      p.retreat.slice(),
      p.voidZone.slice(),
      p.base.faceDown.slice()
    );
    allCards.forEach(card => {
      if (!card) return; // 防止 splice/shift 留低 undefined entry
      if (card._faceDown) return;
      const effects = card.effects;
      if (!Array.isArray(effects)) return;
      effects.forEach((eff, idx) => {
        if (!matchTrigger(eff, event, card, p)) return;
        // ONCE PER TURN gate
        if (eff.once && flags.oncePerTurnUids[card._uid + "::" + idx]) return;
        candidates.push({ card, idx, eff });
      });
    });

    if (!candidates.length) return;

    // AUTO refresh（S3）：phase_change 時先清空 mods 再重算，避免跨回合累積
    if (event.kind === "phase_change") {
      battleChars(p).forEach(card => {
        card._powerMod = 0; card._rMod = 0; card._lvMod = 0;
      });
    }

    // 排序 — active player first (caller 已是 active)，再按 timestamp（M1：hand 順序）
    // （多卡同時觸發排序留 M2）
    // v3.17: once a choice is parked we must STOP firing further effects for this
    // side — official rules resolve one decision at a time, and letting other
    // effects resolve while a prompt is open would reorder the game log.
    let pendingSeen = false;

    for (const { card, idx, eff } of candidates) {
      if (pendingSeen) break;
      // once-per-turn gate 二次檢查（apply 過程可能再次入 queue）
      if (eff.once && flags.oncePerTurnUids[card._uid + "::" + idx]) continue;

      // 1) cond
      const ctx = {
        source: card,
        byCalling: !!(event && event.kind === "enter_field" && event.byCalling),
        retreatCount: event && event.retreatCount != null ? event.retreatCount : 0,
        attackerUid: event && event.attackerUid != null ? event.attackerUid : null, // M4: counter 事件
      };
      // S3: 解析 descriptor 級 vars（{X: "count_opp_battle"} → ctx.X = N）供 ops/filters 用
      if (eff.vars) {
        for (const vk of Object.keys(eff.vars)) {
          ctx[vk] = resolveVar(state, side, eff.vars[vk], ctx);
        }
      }
      if (!evalCond(state, side, eff.cond, ctx)) continue;

      // 2) cost — M1: 簡單 discard_self_from_hand（BP01-002 用）
      const costOk = resolveCost(state, side, eff.cost, ctx);
      if (!costOk.ok) continue;

      // 3) ops (atomic batch) — v3.17 routes through runOpList so that nested
      // optional/if_you_do blocks share exactly one execution path (and so a
      // parked choice short-circuits the rest of the list).
      const opRes = runOpList(state, side, eff.ops, ctx, { op: "root" });
      if (!opRes.ok) continue;
      // a pending choice means the rest of this effect waits for the player
      if (opRes.pending) {
        if (eff.once) flags.oncePerTurnUids[card._uid + "::" + idx] = true;
        pendingSeen = true;
        break;
      }

      // 4) once-per-turn
      if (eff.once) flags.oncePerTurnUids[card._uid + "::" + idx] = true;

      // M4: 應對步驟（counter 事件）每次只用 1 張 counter 卡（官方規則）
      if (event.kind === "counter") break;
    }

    // 5) AUTO refresh — 若事件改變場上 power/lv/r 狀態，統一 recompute
    refreshAutos(state);

    // 6) v3.20 Z6 — flush any events this resolution generated
    if (!pendingSeen) flushPendingEvents(state, side);
  }

  // =============================================================
  // v3.20 Z6 — EVENT QUEUE (cascading triggers)
  //
  // 問題：效果執行中途產生嘅 zone 變動本身會觸發其他效果。實例：
  //   V2 PB01-011 成本 = prune 自己一張 Lv4+ 卡（喺 RETREAT）
  //   → 該卡「進入 VOID」→ 可能觸發 TRIG【VOID】（例如 V1/V3）
  // 之前完全冇 queue，所以呢類連鎖永遠唔會 fire。
  //
  // 但亦唔可以喺 op 執行中途遞歸 —— 會令 Z1 atomic 失效（validate 通過但
  // apply 期間爆第二個效果，state 半途中間壞）。
  //
  // 做法：op 產生嘅事件推入 state.pendingEvents，等當前 runEffects 完成
  // 所有 candidate 之後，統一 flush。用 depth guard 防止無限連鎖。
  // =============================================================
  const MAX_EVENT_DEPTH = 8;

  function enqueueEvent(state, side, event) {
    if (!state.pendingEvents) state.pendingEvents = [];
    if (state.pendingEvents.length > 200) return;   // 安全上限
    state.pendingEvents.push({ side, event });
  }

  function flushPendingEvents(state, side) {
    if (!state.pendingEvents || !state.pendingEvents.length) return 0;
    const depth = state._eventDepth || 0;
    if (depth >= MAX_EVENT_DEPTH) {
      emitLog(state, `[警告] 效果連鎖超過 ${MAX_EVENT_DEPTH} 層，停止`, side);
      state.pendingEvents.length = 0;
      return 0;
    }
    state._eventDepth = depth + 1;
    let n = 0;
    // 逐層處理：每輪只處理當前 snapshot，令連鎖有明確次序
    let guard = 0;
    while (state.pendingEvents.length && guard++ < 50) {
      const batch = state.pendingEvents.splice(0, state.pendingEvents.length);
      for (const { side: evSide, event } of batch) {
        runEffects(state, evSide, event);
        n++;
        if (state.winner) break;
      }
      if (state.winner) break;
    }
    state._eventDepth = depth;
    return n;
  }

  // zone 變動時嘅 helper：某張卡由 from 入 to，會產生咩事件
  // 由 engine.js（pruneCard / doRetreat / callCard）同 effects.js 共用。
  function notifyZoneChange(state, side, card, from, to) {
    if (!card) return;
    // 進入 VOID → TRIG【VOID】
    if (to === "void") {
      const src = (card.effect || "").indexOf("RETREAT") >= 0 ? "RETREAT" : from;
      enqueueEvent(state, side, { kind: "enter_void", card, from, source: card });
    }
    // 進入 RETREAT → TRIG【RETREAT】
    if (to === "retreat") {
      enqueueEvent(state, side, { kind: "enter_retreat", card, from, source: card });
    }
    // 進入場 → TRIG【FIELD】（非 by_calling，避免同 callCard 重複）
    if (to === "front" || to === "back" || to === "wing") {
      enqueueEvent(state, side, { kind: "enter_field", card, byCalling: false, source: card });
    }
  }

  // 每個 slot 對應「卡要喺邊個 zone 才算處於該位置」（TRIG/ACTI 需要）
  // 規則書 P6：戰區 = FRONT/WING/BACK；場 = 戰區 + BASE
  function slotZoneMatches(card, slot, p, state) {
    if (!card || !slot) return true;          // 冇 slot 限制
    const S = String(slot).toUpperCase();
    const zones = [];
    if (p.battle.front && p.battle.front._uid === card._uid) zones.push("FRONT");
    if (p.battle.back && p.battle.back._uid === card._uid) zones.push("BACK");
    if (p.battle.wing.some(c => c && c._uid === card._uid)) zones.push("WING");
    if ((p.base.faceDown || []).some(c => c && c._uid === card._uid)) zones.push("BASE");
    if ((p.hand || []).some(c => c && c._uid === card._uid)) zones.push("HAND");
    if ((p.retreat || []).some(c => c && c._uid === card._uid)) zones.push("RETREAT");
    if ((p.voidZone || []).some(c => c && c._uid === card._uid)) zones.push("VOID");
    if ((p.deck || []).some(c => c && c._uid === card._uid)) zones.push("DECK");
    if (!zones.length) return false;          // 卡唔在任何 zone

    if (S === "FIELD") return zones.some(z => z === "FRONT" || z === "BACK" || z === "WING" || z === "BASE");
    if (S === "BATTLE") return zones.some(z => z === "FRONT" || z === "BACK" || z === "WING");
    return zones.indexOf(S) >= 0;
  }

  function matchTrigger(eff, event, card, p) {
    if (!event || !event.kind) return false;
    const trig = eff.trig;
    const slot = eff.slot;
    const evCard = event.card || event.source;

    // v3.20 Z6 — 自我觸發守衛：enter_void / enter_retreat / enter_field 只應該
    // 觸發「該張卡自己」嘅效果，唔係場上所有同 slot 嘅卡。
    // 例外：TRIG【FIELD】監視「其他卡入場」嘅效果（例如 SP01-021 Web）需要
    // 見到 event.card 唔同自己，所以下面分開處理。
    const isSelfEvent = evCard && card && evCard._uid === card._uid;

    switch (event.kind) {
      case "enter_field":
        if (trig === "TRIG" && slot === "FIELD") {
          // 自己入場（callCard 路徑）或睇住其他卡入場
          if (isSelfEvent) {
            // by_calling 由 cond 判（eff.cond 有 if:by_calling）
            return true;
          }
          return true;   // 監視型；cond 會再篩
        }
        if (trig === "TRIG" && slot === "BATTLE") return isSelfEvent;
        return false;

      case "enter_void":
        if (trig === "TRIG" && slot === "VOID") {
          if (!isSelfEvent) return false;
          return slotZoneMatches(card, "VOID", p);
        }
        if (trig === "TRIG" && slot === "FIELD") return false;
        return false;

      case "enter_retreat":
        if (trig === "TRIG" && slot === "RETREAT") {
          if (!isSelfEvent) return false;
          return slotZoneMatches(card, "RETREAT", p);
        }
        if (trig === "TRIG" && slot === "BATTLE") return isSelfEvent;
        return false;

      case "phase_change":
      case "state_change":
        if (trig === "AUTO") return cardOccupies(p, card, slot);
        return false;

      case "counter":
        if (trig === "COUNTER_ACTI" && slot === "HAND") return true;
        if (trig === "COUNTER") return true;
        return false;

      default:
        return false;
    }
  }

  // AUTO slot 佔位檢查：卡要實際喺該位置先至生效（FRONT/WING/BACK/BASE/HAND...）
  function cardOccupies(p, card, slot) {
    if (!card) return false;
    switch (slot) {
      case "FIELD":
      case "BATTLE": return battleChars(p).includes(card);
      case "FRONT":  return p.battle.front === card;
      case "BACK":   return p.battle.back === card;
      case "WING":   return p.battle.wing.includes(card);
      case "BASE":   return p.base.faceDown.includes(card);
      case "HAND":   return p.hand.includes(card);
      case "RETREAT": return p.retreat.includes(card);
      case "VOID":   return p.voidZone.includes(card);
      default:       return true;
    }
  }

  // =============================================================
  // v3.19 Z2 — zone_transfer op
  //
  // 規格見 ZONE_TRANSFER_SPEC.md。官方規則書依據：
  //   P14 名詞 5/6/7 — 捨棄(手牌/牌組→撤退) / 撤退(場上→撤退) / 裁剪(任何→虛空)
  //                    目的地相同但來源唔同，所以 from 必須係 model 一部分
  //   P14 名詞 3    — BASE 嘅卡 = 蓋卡：失去效果 + 非公開 + 可當 Lv1 付費
  //   P15 名詞 8/9  — 結附卡跟主體（attach/detach 唔在本 op 範圍）
  //
  // 實測 7 個 VOID 變體（tests/smoke/void-survey.json）全部要呢個 op：
  //   V1 self→field (cost discard 2)  V2 self→field (cost prune own)
  //   V3 self→base  (免費)             V4 chosen→battle (cost prune deck top 3)
  //   V5 chosen→field (cost prune self) V6 chosen→battle (二階段)
  //   V7 all→retreat (or 二選一)
  // =============================================================

  // 由 zone key 攞玩家身上對應嘅陣列 + 位置（單槽 zone 要特殊處理）
  const SINGLE_SLOTS = { front: "front", back: "back" };
  function zoneList(p, zone) {
    switch (zone) {
      case "deck": return p.deck;
      case "hand": return p.hand;
      case "retreat": return p.retreat;
      case "voidZone": case "void": return p.voidZone;
      case "base": return p.base.faceDown;
      case "wing": return p.battle.wing;
      default: return null;
    }
  }

  // 由某個 zone 移除一張卡（identity `_uid`，唔用 `==`）
  function removeFromZoneById(p, zone, card) {
    if (zone === "front") {
      if (p.battle.front && p.battle.front._uid === card._uid) { p.battle.front = null; return true; }
      return false;
    }
    if (zone === "back") {
      if (p.battle.back && p.battle.back._uid === card._uid) { p.battle.back = null; return true; }
      return false;
    }
    if (zone === "wing") {
      const i = p.battle.wing.findIndex(c => c && c._uid === card._uid);
      if (i >= 0) { p.battle.wing[i] = null; return true; }
      return false;
    }
    const list = zoneList(p, zone);
    if (!list) return false;
    const i = list.findIndex(c => c && c._uid === card._uid);
    if (i >= 0) { list.splice(i, 1); return true; }
    return false;
  }

  // 卡而家實際喺邊個 zone（用 identity 掃）
  function findZoneOf(p, card) {
    if (!card) return null;
    if (p.battle.front && p.battle.front._uid === card._uid) return "front";
    if (p.battle.back && p.battle.back._uid === card._uid) return "back";
    if (p.battle.wing.some(c => c && c._uid === card._uid)) return "wing";
    const zones = [["deck", p.deck], ["hand", p.hand], ["retreat", p.retreat],
                   ["void", p.voidZone], ["base", p.base.faceDown]];
    for (const [name, list] of zones) {
      if ((list || []).some(c => c && c._uid === card._uid)) return name;
    }
    return null;
  }

  // 加去某個 zone。戰場 zone 滿咗要返回 false（validate 階段就要知）
  function zoneHasRoom(p, zone, state) {
    if (zone === "front") return !p.battle.front;
    if (zone === "back") return !p.battle.back;
    if (zone === "wing") return p.battle.wing.some(c => !c);
    if (zone === "base") {
      // 規則書 P6：基地區上限 6 張
      return p.base.faceDown.length < (state && state.baseLimit ? state.baseLimit : 6);
    }
    return true;   // deck/hand/retreat/void 無上限
  }

  function addToZone(p, zone, card) {
    if (zone === "front") { p.battle.front = card; return true; }
    if (zone === "back") { p.battle.back = card; return true; }
    if (zone === "wing") {
      const i = p.battle.wing.findIndex(c => !c);
      if (i < 0) return false;
      p.battle.wing[i] = card;
      return true;
    }
    const list = zoneList(p, zone);
    if (!list) return false;
    list.push(card);
    return true;
  }

  // 由 subjectFilter 揀目標。排序（orderBy）同最終選擇（playerChooses）
  // 按 Aaron 2026-10-21 決定：卡效冇特別講就預設由控制方揀。
  function collectZoneTransferTargets(state, side, opDef, ctx) {
    const p = state.players[side];
    const opp = state.players[side === "P" ? "A" : "P"];
    const subject = opDef.subject || "self";
    const fromOwner = opDef.fromOwner === "opp" ? opp : p;

    let pool = [];
    if (subject === "self") {
      // 「此卡」—— 可能喺場上，亦可能喺 VOID（V1/V2/V3 就係自己喺 VOID）
      const src = ctx && ctx.source;
      if (!src) return [];
      pool = [src];
    } else if (subject === "all") {
      pool = zoneList(fromOwner, opDef.from) ? zoneList(fromOwner, opDef.from).slice() : [];
    } else {
      // chosen / chosen_filtered：由 from zone 攞全部再篩
      pool = zoneList(fromOwner, opDef.from) ? zoneList(fromOwner, opDef.from).slice() : [];
    }

    // filter
    if (opDef.subjectFilter) {
      const f = opDef.subjectFilter;
      pool = pool.filter(c => {
        if (!c) return false;
        if (f.feature && !splitFeatures(c).includes(f.feature)) return false;
        if (f.name && String(c.name || "").indexOf(f.name) < 0) return false;
        if (f.lv) {
          const cl = c._faceDown ? 1 : (c.level + (c._lvMod || 0));
          if (f.lv.op === "lowest") { /* 排序用，唔篩 */ }
          else if (!compareOp(f.lv.op, cl, f.lv.n)) return false;
        }
        if (f.power && !compareOp(f.power.op, parseInt(c.power, 10) || 0, f.power.n)) return false;
        if (f.zone && findZoneOf(fromOwner, c) !== f.zone) return false;
        return true;
      });
    }

    // orderBy
    const orderBy = opDef.subjectFilter && opDef.subjectFilter.orderBy;
    if (orderBy === "lowest_lv") {
      pool.sort((a, b) => (a.level + (a._lvMod || 0)) - (b.level + (b._lvMod || 0)));
    } else if (orderBy === "highest_power") {
      pool.sort((a, b) => (parseInt(b.power, 10) || 0) - (parseInt(a.power, 10) || 0));
    }

    // count（"all" 就係全部；否則預設 1）
    // NOTE: playerChooses 要在 SLICE 之前判斷 —— 否則 count 已經截到 1 張，
    // pool.length > 1 永遠唔成立，玩家永遠冇得揀（實測 bug）。
    const wantAll = subject === "all";
    const count = wantAll ? pool.length : (opDef.count == null ? 1 : opDef.count);

    // playerChooses：多過一個候選 + 冇 orderBy 明確決定 → park choice
    if (opDef.playerChooses && !wantAll && !orderBy && pool.length > 1) {
      return { needsChoice: true, pool: pool.slice(0, Math.max(count, pool.length)) };
    }
    pool = pool.slice(0, count);
    return pool;
  }

  function opZoneTransfer(state, side, opDef, ctx) {
    const p = state.players[side];
    const from = opDef.from;
    const to = opDef.to;

    if (!from || !to) return { ok: false, err: "zone_transfer 需要 from 同 to" };

    // 1) 揀目標
    const picked = collectZoneTransferTargets(state, side, opDef, ctx);
    if (picked && picked.needsChoice) {
      return parkChoice(state, side, {
        kind: "pick_card",
        prompt: opDef.prompt || "揀 1 張卡",
        cardUid: ctx.source && ctx.source._uid,
        cardName: ctx.source ? shortName(ctx.source) : "",
        options: picked.pool.map(c => ({ uid: c._uid, name: c.name, card_no: c.card_no })),
        opDefSnapshot: JSON.parse(JSON.stringify(opDef)),
        ctxSnapshot: snapshotCtx(ctx),
      });
    }
    const targets = picked || [];
    if (!targets.length) {
      // 冇目標：按 spec §5.4 建議，指令已執行 = 成立（不失敗）
      emitLog(state, `${ctx.source ? shortName(ctx.source) : "效果"}：zone_transfer 無合法目標`, side);
      return { ok: true, transferred: [] };
    }

    // 2) validate —— 目的地有位，而且每張卡真係喺 from zone
    const fromOwner = opDef.fromOwner === "opp" ? state.players[side === "P" ? "A" : "P"] : p;
    const toOwner  = opDef.toOwner === "opp" ? state.players[side === "P" ? "A" : "P"] : p;
    for (const c of targets) {
      const realZone = findZoneOf(fromOwner, c);
      if (!realZone) return { ok: false, err: `目標卡 ${shortName(c)} 唔在任何 zone` };
      if (realZone !== from && !(from === "wing" && realZone === "wing")) {
        return { ok: false, err: `目標卡 ${shortName(c)} 喺 ${realZone}，唔係 ${from}` };
      }
      if (!zoneHasRoom(toOwner, to, state)) {
        return { ok: false, err: `目的地 ${to} 已滿` };
      }
    }

    // 3) apply —— remove-then-add，identity 檢查
    const moved = [];
    for (const c of targets) {
      const realZone = findZoneOf(fromOwner, c);
      if (!realZone) continue;
      if (!removeFromZoneById(fromOwner, realZone, c)) continue;
      if (!addToZone(toOwner, to, c)) {
        // 加唔到就放返原處（理論上 validate 過咗唔會發生）
        addToZone(fromOwner, realZone, c);
        return { ok: false, err: `加去 ${to} 失敗` };
      }
      // to === base 即係變蓋卡（P14 名詞 3）：失去效果 + 非公開
      if (to === "base") {
        c._faceDown = true;
        c._origUid = c._origUid || c._uid;
      } else if (c._faceDown && to !== "base") {
        // 由基地移出去 → 解除蓋伏
        c._faceDown = false;
      }
      moved.push(c);
      const toLabel = { front: "先鋒", back: "後衛", wing: "側翼", base: "基地",
                        retreat: "撤退區", void: "虛空區", hand: "手牌", deck: "牌組" }[to] || to;
      emitLog(state, `${p.name} ${shortName(c)} ${from} → ${toLabel}`, side);
      // v3.20 Z6: 轉移本身亦會產生連鎖觸發（例如 V2 成本 prune → 卡入 VOID
      // → 觸發該卡 TRIG【VOID】）
      var _notifyOwner = (toOwner === p) ? side : (side === "P" ? "A" : "P");
      notifyZoneChange(state, _notifyOwner, c, realZone, to);
    }

    // 4) after[] ── v3.19：回傳 transferred 供二階段條件用（V6）
    if (opDef.after && moved.length) {
      const afterCtx = Object.assign({}, ctx, { transferred: moved, transferredUids: moved.map(c => c._uid) });
      const r = runOpList(state, side, opDef.after, afterCtx, opDef);
      if (!r.ok) return { ok: false, err: r.err };
    }

    // 5) deck 可能因為 zone_transfer 而變 0 → P8 勝利條件
    if (typeof checkWinAfterEffect === "function") checkWinAfterEffect(state);

    return { ok: true, transferred: moved };
  }

  // v3.19 Z2 — 「or」二選一（SP01-077 V7）
  // 同 optional 唔同：optional 係 yes/no，choose_one 係從 N 個 ops 揀一個執行。
  // 選擇本身要玩家答，所以一樣 park choice；resolveChoice 會用 optionIndex。
  function opChooseOne(state, side, opDef, ctx) {
    const opts = opDef.options || [];
    if (!opts.length) return { ok: false, err: "choose_one 冇 options" };
    if (opDef.auto !== undefined) {
      const choice = opDef.auto === true ? 0 : opDef.auto;
      if (typeof choice === "number" && opts[choice]) {
        return runOpList(state, side, [opts[choice]], ctx, opDef);
      }
      return { ok: true, declined: true };
    }
    return parkChoice(state, side, {
      kind: "choose_one",
      prompt: opDef.prompt || "選一個：",
      cardUid: ctx.source && ctx.source._uid,
      cardName: ctx.source ? shortName(ctx.source) : "",
      options: opts.map((o, i) => ({ index: i, op: o.op, label: opDef.optionLabels ? opDef.optionLabels[i] : describeOp(o) })),
      then: opts,
      ctxSnapshot: snapshotCtx(ctx),
      isChooseOne: true,
    });
  }

  function describeOp(o) {
    if (!o || !o.op) return "?";
    const t = { prune: "裁剪", zone_transfer: "移動", draw: "抽牌", discard: "捨棄",
                stat_opp: "對手戰力", stat_self: "自身戰力", retreat: "撤退" }[o.op] || o.op;
    return t;
  }

  // v3.19 Z2 — zone_transfer 可能令 deck 變 0；但 effects.js 唔應該直接依賴
  // engine.js 內部函數。由 engine 喺 load 時注入一個 hook。
  let checkWinAfterEffect = null;
  function setWinChecker(fn) { checkWinAfterEffect = fn; }

  // =============================================================
  // v3.21 Z4 — ACTI（起動效果）
  //
  // 規則書 P15：「起動 區域/要求 若卡牌處於對應區域，則該卡牌控制方在其回合
  //   行動階段可以起動的效果」
  // 同 TRIG 唔同：TRIG 由 event 驅動，ACTI 由玩家主動按。
  // 所以需要 (1) 列出當前可起動嘅效果 (2) 起動指定一個。
  // =============================================================
  function collectActivatable(state, side) {
    const p = state.players[side];
    const flags = state.turnFlags[side];
    if (!flags) return [];
    const out = [];
    const zones = [].concat(
      battleAll(p), p.hand.slice(), p.retreat.slice(), p.voidZone.slice(),
      p.base.faceDown.slice()
    );
    zones.forEach(card => {
      if (!card || card._faceDown) return;
      if (!Array.isArray(card.effects)) return;
      card.effects.forEach((eff, idx) => {
        if (eff.trig !== "ACTI" && eff.trig !== "COUNTER_ACTI") return;
        // COUNTER_ACTI 只喺應對步驟可以用，唔喺 ACTI 清單
        if (eff.trig === "COUNTER_ACTI") return;
        if (eff.once && flags.oncePerTurnUids[card._uid + "::" + idx]) return;
        if (!slotZoneMatches(card, eff.slot, p, state)) return;
        out.push({ card, idx, eff, label: `${shortName(card)}（${eff.slot}）` });
      });
    });
    return out;
  }

  // 起動指定效果。validate → apply（成本用 Z1 atomic path）
  function activateEffect(state, side, cardUid, effectIdx) {
    const p = state.players[side];
    const flags = state.turnFlags[side];
    if (!flags) return { ok: false, err: "冇 turnFlags" };
    const card = findCardByUid(state, side, cardUid);
    if (!card) return { ok: false, err: "搵唔到卡" };
    if (card._faceDown) return { ok: false, err: "蓋卡冇效果" };
    const eff = card.effects && card.effects[effectIdx];
    if (!eff) return { ok: false, err: "搵唔到效果" };
    if (eff.trig !== "ACTI") return { ok: false, err: "唔係起動效果" };
    if (eff.once && flags.oncePerTurnUids[card._uid + "::" + effectIdx]) {
      return { ok: false, err: "本回合已用過" };
    }
    if (!slotZoneMatches(card, eff.slot, p, state)) {
      return { ok: false, err: `卡唔喺 ${eff.slot}` };
    }

    const ctx = { source: card, byCalling: false, retreatCount: 0, attackerUid: null };
    if (eff.vars) {
      for (const vk of Object.keys(eff.vars)) ctx[vk] = resolveVar(state, side, eff.vars[vk], ctx);
    }
    // 1) cond
    if (!evalCond(state, side, eff.cond, ctx)) {
      emitLog(state, `[起動] ${shortName(card)}：條件不符`, side);
      return { ok: false, err: "條件不符" };
    }
    // 2) cost（atomic：失敗則 state 完全不變）
    const costRes = resolveCost(state, side, eff.cost, ctx);
    if (!costRes.ok) {
      emitLog(state, `[起動] ${shortName(card)}：成本不足（${costRes.err}）`, side);
      return { ok: false, err: costRes.err };
    }
    // 3) ops
    emitLog(state, `[起動] ${shortName(card)} 效果`, side);
    const r = runOpList(state, side, eff.ops, ctx, { op: "acti" });
    if (eff.once) flags.oncePerTurnUids[card._uid + "::" + effectIdx] = true;
    refreshAutos(state);
    if (!r.pending) flushPendingEvents(state, side);
    return r;
  }

  const OPS_EXTRA = { zone_transfer: opZoneTransfer };

  // =============================================================
  // v3.18 Z1 — ATOMIC COST RESOLUTION
  //
  // 舊版 resolveCost() 邊檢查邊改 state：
  //     const c = p.hand.splice(hi, 1)[0];   // ← 已經改咗 state
  //     p.retreat.push(c);
  //     ...
  // 如果 cost 陣列有第二項而佢失敗，第一項嘅卡已經離開手牌 —— 玩家付咗費
  // 但效果冇發生，而且 zone 內容靜靜哋壞咗（卡喺 RETREAT 但效果當冇發生）。
  //
  // EFFECTS_DESCRIPTOR.md §5 硬性規則 2 要求：
  //   「validate cost + 目標 → 先 commit；取消/非法 play 必須完整還原」
  //
  // 所以拆成兩個 pass：
  //   COST_VALIDATORS[op](state, side, cost, ctx) → { ok, err?, plan }
  //   COST_APPLIERS[op](state, side, cost, ctx, plan) → void
  // 任何一項 validate 失敗 → 直接 return，state 完全未動過。
  // =============================================================

  // ---- validators (pure: must not mutate state) ----
  const COST_VALIDATORS = {
    // cost: { op:"discard_self_from_hand" }  — 棄效果來源卡本身（BP01-002）
    discard_self_from_hand(state, side, cost, ctx) {
      const p = state.players[side];
      if (!ctx || !ctx.source) return { ok: false, err: "冇 source 卡" };
      const hi = p.hand.indexOf(ctx.source);
      if (hi < 0) return { ok: false, err: "手牌冇 source" };
      return { ok: true, plan: { handIdx: hi } };
    },

    // cost: { op:"discard", n?, self?, from? } — 棄 N 張手牌
    discard(state, side, cost, ctx) {
      const p = state.players[side];
      if (cost.self) {
        if (!ctx || !ctx.source) return { ok: false, err: "冇 source 卡" };
        const hi = p.hand.indexOf(ctx.source);
        if (hi < 0) return { ok: false, err: "手牌冇 source" };
        return { ok: true, plan: { cards: [ctx.source], handIdx: hi } };
      }
      const n = cost.n == null ? 1 : cost.n;
      if (p.hand.length < n) {
        return { ok: false, err: `手牌不足（需 ${n}，有 ${p.hand.length}）` };
      }
      // 由控制方揀要棄邊張：呢度先取最後 N 張，如果 descriptor 要指定目標，
      // 交畀 zone_transfer 嘅 playerChooses 先 park choice 再傳入 plan。
      return { ok: true, plan: { cards: p.hand.slice(-n) } };
    },

    // cost: { op:"prune", n?, target?, filter? }
    prune(state, side, cost, ctx) {
      const p = state.players[side];
      const opp = state.players[side === "P" ? "A" : "P"];
      const n = cost.n == null ? 1 : cost.n;

      // prune 自己場上（V5 Prowler：prune this card on BATTLE）
      if (cost.target === "self_on_field") {
        if (!ctx || !ctx.source) return { ok: false, err: "冇 source 卡" };
        const onField = battleAll(p).some(c => c && c._uid === ctx.source._uid);
        if (!onField) return { ok: false, err: "source 唔喺場上" };
        return { ok: true, plan: { cards: [ctx.source], from: "field" } };
      }

      // prune 牌組頂 N 張（V4 Uncle Ben）
      if (cost.target === "my_deck_top") {
        const k = Math.min(n, p.deck.length);
        if (k === 0) return { ok: false, err: "牌組已空" };
        return { ok: true, plan: { cards: p.deck.slice(0, k), from: "deck", short: k < n } };
      }

      // prune 自己撤退區嘅卡（V2 Doctor Strange），可帶 filter
      if (cost.target === "my_retreat" || (!cost.target && cost.filter)) {
        const pool = p.retreat.filter(c => !cost.filter || passFilter(c, cost.filter, ctx, state, side));
        if (pool.length < n) {
          return { ok: false, err: `撤退區符合條件嘅卡不足（需 ${n}，有 ${pool.length}）` };
        }
        return { ok: true, plan: { cards: pool.slice(0, n), from: "retreat" } };
      }

      // prune 對手場上（一般 prune 效果）
      if (cost.target === "opp_battle" || cost.target === "opp_field") {
        const pool = battleAll(opp).filter(c => !cost.filter || passFilter(c, cost.filter, ctx, state, side));
        if (pool.length < n) {
          return { ok: false, err: `對手場上符合條件嘅卡不足（需 ${n}，有 ${pool.length}）` };
        }
        return { ok: true, plan: { cards: pool.slice(0, n), from: "opp_field" } };
      }

      return { ok: false, err: "prune cost 唔知 target: " + cost.target };
    },

    // cost: { op:"retreat_self" } — 撤退效果來源卡（自付）
    retreat_self(state, side, cost, ctx) {
      const p = state.players[side];
      if (!ctx || !ctx.source) return { ok: false, err: "冇 source 卡" };
      const onField = battleAll(p).some(c => c && c._uid === ctx.source._uid);
      if (!onField) return { ok: false, err: "source 唔喺場上" };
      return { ok: true, plan: { card: ctx.source } };
    },

    // cost: { op:"lv_pay", lv } — 用撤退區合計 Lv 支付（號召規則）
    lv_pay(state, side, cost, ctx) {
      const p = state.players[side];
      const need = cost.lv;
      const uids = (ctx && ctx.retreatUids) || [];
      let sum = 0;
      const picked = [];
      for (const uid of uids) {
        const c = p.retreat.find(x => x && x._uid === uid);
        if (!c) return { ok: false, err: `撤退區冇卡 ${uid}` };
        sum += c._faceDown ? 1 : (c.level + (c._lvMod || 0));
        picked.push(c);
      }
      if (sum !== need) return { ok: false, err: `Lv 合計不符（需 ${need}，有 ${sum}）` };
      return { ok: true, plan: { cards: picked } };
    },
  };

  // ---- appliers (mutating: only run after ALL validators passed) ----
  const COST_APPLIERS = {
    discard_self_from_hand(state, side, cost, ctx, plan) {
      const p = state.players[side];
      // 重新定位（validator 之後 state 未變，但 index 可能因其他 op 而移位）
      const hi = p.hand.indexOf(plan.cards ? plan.cards[0] : ctx.source);
      const idx = hi >= 0 ? hi : plan.handIdx;
      const c = p.hand.splice(idx, 1)[0];
      if (!c) return;
      p.retreat.push(c);
      emitLog(state, `${p.name} 捨棄 ${shortName(c)} → RETREAT（cost）`, side);
    },

    discard(state, side, cost, ctx, plan) {
      const p = state.players[side];
      for (const target of plan.cards) {
        const i = p.hand.indexOf(target);
        if (i < 0) continue;
        const c = p.hand.splice(i, 1)[0];
        p.retreat.push(c);
        emitLog(state, `${p.name} 捨棄 ${shortName(c)} → RETREAT（cost）`, side);
      }
    },

    prune(state, side, cost, ctx, plan) {
      const p = state.players[side];
      if (plan.from === "deck") {
        for (const target of plan.cards) {
          const i = p.deck.indexOf(target);
          if (i < 0) continue;
          p.deck.splice(i, 1);
          p.voidZone.push(target);
          emitLog(state, `${p.name} 裁剪牌組頂 ${shortName(target)} → VOID（cost）`, side);
        }
        return;
      }
      if (plan.from === "retreat") {
        for (const target of plan.cards) {
          const i = p.retreat.indexOf(target);
          if (i < 0) continue;
          p.retreat.splice(i, 1);
          // 結附卡跟主體走（規則書 P15 名詞 8）
          const att = p.attached[target._uid] || [];
          delete p.attached[target._uid];
          p.voidZone.push(target, ...att);
          emitLog(state, `${p.name} ${shortName(target)} → VOID（裁剪 cost）`, side);
        }
        return;
      }
      if (plan.from === "opp_field") {
        const oppSide = side === "P" ? "A" : "P";
        for (const target of plan.cards) doPrune(state, oppSide, target);
        return;
      }
      // field（self）
      for (const target of plan.cards) doPrune(state, side, target);
    },

    retreat_self(state, side, cost, ctx, plan) {
      doRetreat(state, side, plan.card, "cost");
    },

    lv_pay(state, side, cost, ctx, plan) {
      const p = state.players[side];
      for (const target of plan.cards) {
        const i = p.retreat.indexOf(target);
        if (i >= 0) p.retreat.splice(i, 1);
        p.voidZone.push(target);   // 號召付出嘅撤退區卡去 VOID
      }
    },
  };

  // 兩個 pass。第二個 pass 只會喺第一個 pass 全部成功之後執行。
  function resolveCost(state, side, costArr, ctx) {
    if (!costArr || !costArr.length) return { ok: true };

    // ---- PASS 1: validate (NO mutation) ----
    const plans = [];
    for (const cost of costArr) {
      const op = cost.op;
      // 向後兼容：舊 descriptor 用 discard_self_from_hand
      const v = COST_VALIDATORS[op] || COST_VALIDATORS[op === "discard_self" ? "discard_self_from_hand" : op];
      if (!v) return { ok: false, err: "cost 不支援: " + op };
      const r = v(state, side, cost, ctx);
      if (!r.ok) return { ok: false, err: r.err };
      plans.push({ cost, plan: r.plan });
    }

    // ---- PASS 2: apply (mutation) ----
    for (const { cost, plan } of plans) {
      const op = cost.op;
      const a = COST_APPLIERS[op] || COST_APPLIERS[op === "discard_self" ? "discard_self_from_hand" : op];
      if (!a) return { ok: false, err: "cost applier 不存在: " + op };
      a(state, side, cost, ctx, plan);
    }

    return { ok: true };
  }

  // =============================================================
  // AUTO refresh hook
  // =============================================================
  // 規則 5：狀態改變後統一 refresh（唔逐張 hardcode）
  // M1: power_mod 已 commit 即時生效，無需 recompute cache。
  //     呢個 hook 為 S3 AUTO descriptors 鋪路（重算 lv_mod 等）。
  function refreshAutos(state) {
    // M1：暫無需要 rebuild — power_mod 即時寫入 _powerMod 已被 cardEffectivePower
    // 讀取。lv_mod 同樣即時寫入 _lvMod 已被 cardEffectiveLv 讀取。
    // 留 hook 為 S3 auto descriptors (BP01-004 Hulk 等) 預備：
    //   1) 掃描所有 AUTO【FIELD/BATTLE】 effects
    //   2) eval cond 改變 → apply / clear ops
    //   M2 實裝。
    return;
  }

  // =============================================================
  // PUBLIC API
  // =============================================================
  // v3.19: engine.js 先 load，所以佢將 checkWin 掛喺 global（見 engine.js）。
  // effects.js load 完成時自己接返，之後 zone_transfer 就可以即時檢查 P8 勝利。
  if (typeof global.MHR_ENGINE_WIN_CHECKER === "function") {
    setWinChecker(global.MHR_ENGINE_WIN_CHECKER);
  }

  global.MHR_EFFECTS = {
    runEffects,
    refreshAutos,
    // v3.19: engine 注入 P8 勝利檢查器（effects.js 唔直接依賴 engine 內部）
    setWinChecker,
    // v3.20 Z6: engine 嘅 pruneCard/retreatCard 轉發 zone 變動嚟呢度，
    // 排入 pendingEvents，令 TRIG【VOID】/【RETREAT】/【FIELD】 可以連鎖觸發
    notifyZoneChange,
    flushPendingEvents,
    // v3.21 Z4: ACTI 起動效果（玩家主動按）
    collectActivatable,
    activateEffect,
    // v3.17 — choice / conditional-chain API (app.js renders the prompt,
    // then calls resolveChoice(state, side, {accept:bool}))
    hasPendingChoice: hasPending,
    resolveChoice,
    pendingChoices: state => (state && state.pendingChoices) || [],
    // exported for test
    _internal: { resolveVar, evalCond, matchTrigger, OPS, collectTargets, runOpList, snapshotCtx, findCardByUid,
                 resolveCost, COST_VALIDATORS, COST_APPLIERS,
                 passFilter, readField, compareOp, splitFeatures, slotZoneMatches,
                 enqueueEvent, flushPendingEvents, notifyZoneChange },
  };
})(window);