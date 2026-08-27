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
  function resolveTarget(state, ownerSide, targetKey) {
    const me = state.players[ownerSide];
    const opp = state.players[ownerSide === "P" ? "A" : "P"];
    switch (targetKey) {
      case "self":        return []; // 需 effect.source，由 caller 注入
      case "my_field":    return battleAll(me);
      case "opp_field":   return battleAll(opp);
      case "my_battle":   return battleChars(me);
      case "opp_battle":  return battleChars(opp);
      case "my_base":     return me.base.faceDown.slice();
      case "my_hand":     return me.hand.slice();
      case "opp_hand":    return opp.hand.slice();
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
  // 簡單 field-value filter：{ lv:"<=", n:3 } / { power:">", var:"X" }
  function passFilter(card, filter, ctx, state, side) {
    if (!filter) return true;
    for (const k of Object.keys(filter)) {
      const spec = filter[k];
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
      case "lv":    return card.level + (card._lvMod || 0);
      case "power": return (card.power && parseInt(card.power, 10)) || 0;
      case "attr":  return card.attribute;
      case "feature": return card.feature;
      default:      return null;
    }
  }

  function compareOp(op, a, b) {
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
  function evalCond(state, side, condArr, ctx) {
    if (!condArr || !condArr.length) return true;
    for (const c of condArr) {
      const k = c.if;
      const p = state.players[side];
      if (k === "by_calling") {
        if (!ctx || !ctx.byCalling) return false;
      } else if (k === "all_my_field_attr") {
        const chars = battleChars(p);
        if (!chars.length) return false;
        if (!chars.every(x => x.attribute === c.attr)) return false;
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

  // ---- stub ops（other 9 from §3 vocabulary）----
  function opStub(state, side, opDef, ctx) {
    emitLog(state, `[效果未實裝] op:${opDef.op}（M2+ 補齊）`, side);
    return { ok: false, stub: true };
  }
  const OPS = {
    draw: opDraw,
    power_mod: opPowerMod,
    retreat: opRetreat,
    prune: opPrune,
    attack_bonus: opAttackBonus,
    // stubs
    move: opStub,
    discard: opStub,
    attach: opStub,
    r_mod: opStub,
    face_down: opStub,
    show: opStub,
    lv_mod: opStub,
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
    return resolveTarget(state, side, targetKey);
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

    // 收集候選 effects：場上/手上所有 descriptor blocks (skip 蓋卡)
    const candidates = [];
    const allCards = [].concat(
      battleAll(p),
      p.hand.slice()
    );
    allCards.forEach(card => {
      if (!card) return; // 防止 splice/shift 留低 undefined entry
      if (card._faceDown) return;
      const effects = card.effects;
      if (!Array.isArray(effects)) return;
      effects.forEach((eff, idx) => {
        if (!matchTrigger(eff, event)) return;
        // ONCE PER TURN gate
        if (eff.once && flags.oncePerTurnUids[card._uid + "::" + idx]) return;
        candidates.push({ card, idx, eff });
      });
    });

    if (!candidates.length) return;

    // 排序 — active player first (caller 已是 active)，再按 timestamp（M1：hand 順序）
    // （多卡同時觸發排序留 M2）

    for (const { card, idx, eff } of candidates) {
      // once-per-turn gate 二次檢查（apply 過程可能再次入 queue）
      if (eff.once && flags.oncePerTurnUids[card._uid + "::" + idx]) continue;

      // 1) cond
      const ctx = {
        source: card,
        byCalling: !!(event && event.kind === "enter_field" && event.byCalling),
        retreatCount: event && event.retreatCount != null ? event.retreatCount : 0,
      };
      if (!evalCond(state, side, eff.cond, ctx)) continue;

      // 2) cost — M1: 簡單 discard_self_from_hand（BP01-002 用）
      const costOk = resolveCost(state, side, eff.cost, ctx);
      if (!costOk.ok) continue;

      // 3) ops (atomic batch)
      let allOk = true;
      for (const opDef of eff.ops) {
        opDef._sourceName = shortName(card);
        opDef._ctx = ctx;
        const fn = OPS[opDef.op];
        if (!fn) { allOk = false; break; }
        const r = fn(state, side, opDef, ctx);
        if (!r.ok) { allOk = false; break; }
      }
      if (!allOk) continue;

      // 4) once-per-turn
      if (eff.once) flags.oncePerTurnUids[card._uid + "::" + idx] = true;
    }

    // 5) AUTO refresh — 若事件改變場上 power/lv/r 狀態，統一 recompute
    refreshAutos(state);
  }

  function matchTrigger(eff, event) {
    if (!event || !event.kind) return false;
    const trig = eff.trig;
    const slot = eff.slot;

    // TRIG【FIELD】 by enter_field
    if (trig === "TRIG" && slot === "FIELD" && event.kind === "enter_field") return true;
    // AUTO【FIELD】 by phase/field events
    if (trig === "AUTO" && slot === "FIELD" && (event.kind === "phase_change" || event.kind === "state_change")) return true;
    // COUNTER_ACTI【HAND】 by counter
    if (trig === "COUNTER_ACTI" && slot === "HAND" && event.kind === "counter") return true;

    return false;
  }

  function resolveCost(state, side, costArr, ctx) {
    if (!costArr || !costArr.length) return { ok: true };
    for (const cost of costArr) {
      if (cost.op === "discard_self_from_hand") {
        const p = state.players[side];
        const hi = p.hand.indexOf(ctx.source);
        if (hi < 0) return { ok: false, err: "手牌冇 source" };
        const c = p.hand.splice(hi, 1)[0];
        p.retreat.push(c);
        emitLog(state, `${p.name} 捨棄 ${shortName(c)} → RETREAT（cost）`, side);
      } else {
        return { ok: false, err: "cost 不支援: " + cost.op };
      }
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
  global.MHR_EFFECTS = {
    runEffects,
    refreshAutos,
    // exported for test
    _internal: { resolveVar, evalCond, matchTrigger, OPS, collectTargets },
  };
})(window);