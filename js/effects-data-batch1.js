/* v3.23 — BATCH 1: simple stat_mod descriptors (11 cards)
 *
 * 揀選標準（由 tests/smoke/stub_triage.js 分級）：
 *   - 單一 effect block
 *   - 只有 stat_mod（Power/Lv/R 加減）
 *   - 冇 X 變數、冇 If 條件、冇 you may / if you do
 * 即係「讀一次文本就可以逐字翻譯」嘅級別。目的唔係覆蓋率，而係驗證
 * descriptor pipeline 喺真實卡上面行得通，之後先放大到複雜批次。
 *
 * 每張都逐字引用官方卡文本。
 */
(function (global) {
  var B = {

    // ── BP01-033 「Assembled」Iron Man ──────────────────────────────
    // TRIG【BACK】:When your character with 【Avengers】 in its feature attacks,
    //   1 of your opponent's characters in BATTLE gets Power-500 in this turn.
    'BP01-033': [{
      trig: 'TRIG', slot: 'BACK',
      condText: ['When your character with 【Avengers】 in its feature attacks'],
      cond: [{ if: 'my_feature_char_attacks', feature: 'Avengers' }],
      ops: [{ op: 'power_mod', target: 'opp_battle', amount: -500, duration: 'this_turn' }],
    }],

    // ── BP01-055 ────────────────────────────────────────────────────
    // AUTO【BATTLE】:For every 3000 Power your opponent's character in FRONT has,
    //   this card gets R+1.
    // 注意：每 3000 Power → R+1，即 R+X where X = floor(oppFrontPower / 3000)。
    // 呢個係 X 變數嘅簡化版，用 vars 表達。
    'BP01-055': [{
      trig: 'AUTO', slot: 'BATTLE',
      vars: { X: 'opp_front_power' },
      ops: [{ op: 'r_mod', target: 'self', amount: { var: 'X', scale: 1, divisor: 3000 } }],
    }],

    // ── BP01-075 ────────────────────────────────────────────────────
    // AUTO【FIELD】:All your characters with 【Fantastic Four】 in their features
    //   in HAND get Lv-1.
    'BP01-075': [{
      trig: 'AUTO', slot: 'FIELD',
      ops: [{ op: 'lv_mod', target: 'my_hand', filter: { feature: 'Fantastic Four' }, amount: -1 }],
    }],

    // ── BP01-082 ────────────────────────────────────────────────────
    // AUTO【BATTLE】:Your opponent's character with 【Human】 in its feature in
    //   FRONT gets Power-500.
    'BP01-082': [{
      trig: 'AUTO', slot: 'BATTLE',
      ops: [{ op: 'power_mod', target: 'opp_front', filter: { feature: 'Human' }, amount: -500 }],
    }],

    // ── BP01-086 ────────────────────────────────────────────────────
    // AUTO【FIELD】: Your character with 【Human】 in its feature in FRONT gets
    //   Power+500.
    'BP01-086': [{
      trig: 'AUTO', slot: 'FIELD',
      ops: [{ op: 'power_mod', target: 'my_front', filter: { feature: 'Human' }, amount: 500 }],
    }],

    // ── BP01-115 ────────────────────────────────────────────────────
    // AUTO【FIELD】:Your opponent's character in BACK gets Lv-2.
    'BP01-115': [{
      trig: 'AUTO', slot: 'FIELD',
      ops: [{ op: 'lv_mod', target: 'opp_back', amount: -2 }],
    }],

    // ── EB01-006 ────────────────────────────────────────────────────
    // TRIG【BATTLE】:When your opponent's character with Lv6 enters the field,
    //   both of this card and that character get Power-1000 in this turn.
    'EB01-006': [{
      trig: 'TRIG', slot: 'BATTLE',
      condText: ["When your opponent's character with Lv6 enters the field"],
      cond: [{ if: 'opp_char_enters_field', lv: 6 }],
      ops: [
        { op: 'power_mod', target: 'self', amount: -1000, duration: 'this_turn' },
        { op: 'power_mod', target: 'event_card', amount: -1000, duration: 'this_turn' },
      ],
    }],

    // ── PB01-001 ────────────────────────────────────────────────────
    // TRIG【BATTLE】:When this card wins the fight, all your characters with
    //   【GOTG】 in their features in BATTLE except this card get R+1 in this turn.
    'PB01-001': [{
      trig: 'TRIG', slot: 'BATTLE',
      condText: ['When this card wins the fight'],
      cond: [{ if: 'this_wins_fight' }],
      ops: [{ op: 'r_mod', target: 'my_battle', filter: { feature: 'GOTG' }, excludeSelf: true, amount: 1, duration: 'this_turn' }],
    }],

    // ── SD01-003 ────────────────────────────────────────────────────
    // TRIG【BATTLE/ONCE PER TURN】: When the R or the Power of your character
    //   increase, 1 of your opponent's characters in BATTLE gets Power-1000 in
    //   this turn.
    'SD01-003': [{
      trig: 'TRIG', slot: 'BATTLE', once: true,
      condText: ['When the R or the Power of your character increase'],
      cond: [{ if: 'my_stat_increased' }],
      ops: [{ op: 'power_mod', target: 'opp_battle', amount: -1000, duration: 'this_turn' }],
    }],

    // ── SD04-016 ────────────────────────────────────────────────────
    // AUTO【FIELD】:Your opponent's character in BACK gets Lv-2.
    'SD04-016': [{
      trig: 'AUTO', slot: 'FIELD',
      ops: [{ op: 'lv_mod', target: 'opp_back', amount: -2 }],
    }],

    // ── SP01-016 ────────────────────────────────────────────────────
    // TRIG【BATTLE/ONCE PER TURN】:When the number of your cards in BASE
    //   increases, this card gets R+1 this turn and 1 of your opponent's
    //   characters on the field gets Power-500 this turn.
    'SP01-016': [{
      trig: 'TRIG', slot: 'BATTLE', once: true,
      condText: ['When the number of your cards in BASE increases'],
      cond: [{ if: 'my_base_count_increased' }],
      ops: [
        { op: 'r_mod', target: 'self', amount: 1, duration: 'this_turn' },
        { op: 'power_mod', target: 'opp_field', amount: -500, duration: 'this_turn' },
      ],
    }],

  };

  global.MHR_EFFECTS_DATA = global.MHR_EFFECTS_DATA || {};
  Object.keys(B).forEach(function (k) { global.MHR_EFFECTS_DATA[k] = B[k]; });
  global.MHR_EFFECTS_DATA_BATCH1 = B;

})(typeof window !== 'undefined' ? window : global);
