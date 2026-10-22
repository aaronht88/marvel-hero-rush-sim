/* v3.24 — BATCH 2: zone-movement descriptors (5 cards)
 *
 * 呢批喺 triage 被標「缺 move op」，但睇真文本其實係 zone_transfer：
 *   - 「move X from FRONT to BACK」= 同一個玩家身上換位
 *   - 「move X from BATTLE to BASE」= 戰場→基地（變蓋卡）
 *   - 「move your set cards from BASE back to HAND」= 基地→手牌
 * 所以唔需要新 op，只係要 zone_transfer 支援 deck_top/deck_bottom 同
 * 同一玩家嘅 slot 換位（v3.24 已加）。
 *
 * 「takes BATTLE-BASE Move」係官方能力 keyword（戰基移動），engine 已有
 * battleBaseMove 處理，descriptor 唔需要重複實作 —— 只係 cond 判「本回合
 * 已做過戰基移動」。
 */
(function (global) {
  var B = {

    // ── BP01-016 / EB01-010（同一文本，兩張重印）────────────────────
    // TRIG【BATTLE/ONCE PER TURN】:When your character with Lv4 or above enters
    //   the field by calling, you may move 1 of your opponent's characters with
    //   Lv3 or below from BATTLE to your opponent's BASE.
    'BP01-016': [{
      trig: 'TRIG', slot: 'BATTLE', once: true,
      condText: ['When your character with Lv4 or above enters the field by calling'],
      cond: [{ if: 'my_char_enters_by_calling', lvMin: 4 }],
      ops: [{
        op: 'optional',
        prompt: '把對手 Lv3 以下角色由戰場移到對手基地？',
        then: [{
          op: 'zone_transfer',
          subject: 'chosen', from: 'field', to: 'base', fromOwner: 'opp', toOwner: 'opp',
          subjectFilter: { lv: { op: '<=', n: 3 } },
          playerChooses: true,
          prompt: '揀對手一個 Lv3 以下角色',
        }],
      }],
    }],

    'EB01-010': [{
      trig: 'TRIG', slot: 'BATTLE', once: true,
      condText: ['When your character with Lv4 or above enters the field by calling'],
      cond: [{ if: 'my_char_enters_by_calling', lvMin: 4 }],
      ops: [{
        op: 'optional',
        prompt: '把對手 Lv3 以下角色由戰場移到對手基地？',
        then: [{
          op: 'zone_transfer',
          subject: 'chosen', from: 'field', to: 'base', fromOwner: 'opp', toOwner: 'opp',
          subjectFilter: { lv: { op: '<=', n: 3 } },
          playerChooses: true,
          prompt: '揀對手一個 Lv3 以下角色',
        }],
      }],
    }],

    // ── BP01-103 ────────────────────────────────────────────────────
    // TRIG【FIELD】:When this card takes BATTLE-BASE Move, you may move your
    //   opponent's character from FRONT to your opponent's BACK.
    'BP01-103': [{
      trig: 'TRIG', slot: 'FIELD',
      condText: ['When this card takes BATTLE-BASE Move'],
      cond: [{ if: 'this_took_battle_base_move' }],
      ops: [{
        op: 'optional',
        prompt: "把對手 FRONT 角色移到對手 BACK？",
        then: [{
          op: 'zone_transfer',
          subject: 'chosen', from: 'front', to: 'back', fromOwner: 'opp', toOwner: 'opp',
          prompt: '揀對手 FRONT 角色',
        }],
      }],
    }],

    // ── SD03-005 ────────────────────────────────────────────────────
    // TRIG【FIELD/ONCE PER TURN】: When this card takes BATTLE-BASE Move, you may
    //   move 1 of your set cards from BASE back to your HAND.
    'SD03-005': [{
      trig: 'TRIG', slot: 'FIELD', once: true,
      condText: ['When this card takes BATTLE-BASE Move'],
      cond: [{ if: 'this_took_battle_base_move' }],
      ops: [{
        op: 'optional',
        prompt: '把自己基地一張蓋卡拿回手牌？',
        then: [{
          op: 'zone_transfer',
          subject: 'chosen', from: 'base', to: 'hand',
          playerChooses: true,
          prompt: '揀基地一張卡',
        }],
      }],
    }],

    // ── SP01-056 ────────────────────────────────────────────────────
    // TRIG【FIELD/ONCE PER TURN】:When this card takes BATTLE-BASE Move, you
    //   retreat 1 of your opponent's set cards in BASE randomly.
    // 注意：係 retreat（→ RETREAT 區）而唔係 prune（→ VOID）
    'SP01-056': [{
      trig: 'TRIG', slot: 'FIELD', once: true,
      condText: ['When this card takes BATTLE-BASE Move'],
      cond: [{ if: 'this_took_battle_base_move' }],
      ops: [{
        op: 'zone_transfer',
        subject: 'chosen', from: 'base', to: 'retreat', fromOwner: 'opp', toOwner: 'opp',
        prompt: '對手基地一張蓋卡（隨機）',
      }],
    }],

  };

  global.MHR_EFFECTS_DATA = global.MHR_EFFECTS_DATA || {};
  Object.keys(B).forEach(function (k) { global.MHR_EFFECTS_DATA[k] = B[k]; });
  global.MHR_EFFECTS_DATA_BATCH2 = B;

})(typeof window !== 'undefined' ? window : global);
