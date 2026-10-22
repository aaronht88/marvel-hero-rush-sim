/* v3.20 — VOID zone-transfer descriptors (7 measured variants)
 *
 * 每一張都對應 ZONE_TRANSFER_SPEC.md §2 嘅原文。官方卡文本逐字照抄在註解，
 * descriptor 只係翻譯，唔可以自行加效果。
 *
 * 載入次序：js/effects-data.js（15 張手寫）→ js/effects-data-void.js（本檔）
 * initGame 時 injectEffects(c) 會由 MHR_EFFECTS_DATA 按 card_no 注入。
 */
(function (global) {
  var VOID = {

    // ── V1 BP01-007「Void Reforge」Vision ──────────────────────────
    // 原文：TRIG【VOID】:When this card enters VOID from RETREAT, you may discard
    //       2 cards in HAND. If you do, you place this card from VOID into your
    //       field, and your opponent's character in FRONT gets Power-1000 in this turn.
    'BP01-007': [{
      trig: 'TRIG', slot: 'VOID', once: false,
      condText: ['When this card enters VOID from RETREAT'],
      cond: [{ if: 'by_entering_void', from: 'RETREAT' }],
      ops: [{
        op: 'optional',
        prompt: '棄 2 張手牌，把自己召回場上？',
        then: [
          { op: 'discard', n: 2, from: 'hand' },
          { op: 'zone_transfer', subject: 'self', from: 'void', to: 'front' },
          { op: 'stat_opp', target: 'opp_front', power: -1000, duration: 'this_turn' },
        ],
      }],
    }],

    // ── V2 PB01-011「Astral Visitor」Doctor Strange ─────────────────
    // 原文：ACTI【VOID/ONCE PER TURN】:You prune 1 of your characters with Lv4 or
    //       above in RETREAT. If you do, you place this card from VOID into your field.
    'PB01-011': [{
      trig: 'ACTI', slot: 'VOID', once: true,
      // 成本由 Z1 處理：prune 自己撤退區一張 Lv4+
      cost: [{ op: 'prune', n: 1, target: 'my_retreat', filter: { lv: '>=', n: 4 } }],
      condText: ['If you do'],
      ops: [{ op: 'zone_transfer', subject: 'self', from: 'void', to: 'front' }],
    }],

    // ── V3 SP01-021「The Web of Destiny」Spider-Man（block 2）───────
    // 原文：TRIG【VOID】:When this card enters VOID by your effect, you may
    //       place this card from VOID into your BASE.
    // 注意：進 BASE = 變蓋卡 → 失去效果（官方 P14 名詞 3）
    'SP01-021': [{
      trig: 'TRIG', slot: 'VOID', once: false,
      condText: ['When this card enters VOID by your effect'],
      cond: [{ if: 'by_entering_void', by: 'own_effect' }],
      ops: [{
        op: 'optional',
        prompt: '把自己蓋放到基地？（會失去效果）',
        then: [{ op: 'zone_transfer', subject: 'self', from: 'void', to: 'base' }],
      }],
    }],

    // ── V4 SP01-031「Straight and Narrow」Uncle Ben ─────────────────
    // 原文：UNIQUE BLOCK TRIG【RETREAT】:When this card enters RETREAT from BATTLE
    //       by losing the fight, you prune the top 3 cards of your deck. If you do,
    //       you place 1 of your characters with the lowest Lv and 【Web】 in their
    //       features from VOID onto your BATTLE.
    // 注意：prune top 3 有可能令牌組歸零 → P8 對手即刻贏（spec §5.3）
    'SP01-031': [{
      trig: 'TRIG', slot: 'RETREAT', once: false, caps: ['UNIQUE', 'BLOCK'],
      condText: ['When this card enters RETREAT from BATTLE by losing the fight'],
      cond: [{ if: 'entered_retreat_by', reason: 'losing_fight', from: 'BATTLE' }],
      cost: [{ op: 'prune', n: 3, target: 'my_deck_top' }],
      ops: [{
        op: 'zone_transfer', subject: 'chosen', from: 'void', to: 'front',
        subjectFilter: { feature: 'Web', orderBy: 'lowest_lv' },
      }],
    }],

    // ── V5 SP01-035「Mirror Fate」Prowler ───────────────────────────
    // 原文：TRIG【BATTLE】:When your character with 【Human】 in its feature enters
    //       RETREAT from BATTLE by losing the fight, you may prune this card on
    //       BATTLE. If you do, you place 1 of your characters with Lv3 and
    //       【Spider-Man】 in their names from VOID onto the field.
    'SP01-035': [{
      trig: 'TRIG', slot: 'BATTLE', once: false,
      condText: ['When your character with 【Human】 enters RETREAT from BATTLE by losing the fight'],
      cond: [{ if: 'other_char_entered_retreat', feature: 'Human', reason: 'losing_fight' }],
      ops: [{
        op: 'optional',
        prompt: '裁剪自己（喺戰場），召回一張 Lv3 Spider-Man？',
        then: [
          { op: 'prune', n: 1, target: 'self_on_field' },
          {
            op: 'zone_transfer', subject: 'chosen', from: 'void', to: 'front',
            subjectFilter: { name: 'Spider-Man', lv: { op: '==', n: 3 } },
          },
        ],
      }],
    }],

    // ── V6 SP01-066「Restoration of Multiverse」Doctor Strange ──────
    // 原文：UNIQUE ACTI【BATTLE/ONCE PER TURN】:You discard 1 of your cards in HAND.
    //       If you do, you place 1 of your characters with 【Multiverse】 in their
    //       features from VOID onto your BATTLE. If that character is with Lv4 or
    //       above, you discard 1 of your cards in HAND extra.
    'SP01-066': [{
      trig: 'ACTI', slot: 'BATTLE', once: true, caps: ['UNIQUE'],
      cost: [{ op: 'discard', n: 1, from: 'hand' }],
      condText: ['If you do', 'If that character is with Lv4 or above'],
      ops: [{
        op: 'zone_transfer', subject: 'chosen', from: 'void', to: 'front',
        subjectFilter: { feature: 'Multiverse' },
        // after[] 收 ctx.transferred，二階段條件由 if_you_do 表達
        after: [{
          op: 'if_you_do',
          when: { subject: 'transferred', test: { lv: '>=', n: 4 } },
          do: [{ op: 'discard', n: 1, from: 'hand' }],
        }],
      }],
    }],

    // ── V7 SP01-077「Reversal of Multiverse」Spider-Punk（block 2）──
    // 原文：COUNTER·ACTI【HAND】：You discard this card in HAND. If you do,
    //       you prune all your characters with 【Web】 in their features in RETREAT
    //       or
    //       you place all your characters with 【Web】 in their features from VOID
    //       into your RETREAT.
    // 注意：`or` = 二選一，唔係順序 → choose_one
    'SP01-077': [{
      trig: 'COUNTER_ACTI', slot: 'HAND', once: false,
      cost: [{ op: 'discard', self: true, from: 'hand' }],
      condText: ['If you do'],
      ops: [{
        op: 'choose_one',
        prompt: '選一個：',
        optionLabels: [
          '裁剪自己撤退區全部 Web 角色 → 虛空',
          '把自己虛空區全部 Web 角色 → 撤退區',
        ],
        options: [
          { op: 'prune', n: 99, target: 'my_retreat', filter: { feature: 'Web' }, all: true },
          {
            op: 'zone_transfer', subject: 'all', from: 'void', to: 'retreat',
            subjectFilter: { feature: 'Web' },
          },
        ],
      }],
    }],

  };

  // 合併入現有 MHR_EFFECTS_DATA（effects-data.js 由 index.html 先載入）
  global.MHR_EFFECTS_DATA = global.MHR_EFFECTS_DATA || {};
  Object.keys(VOID).forEach(function (k) {
    global.MHR_EFFECTS_DATA[k] = VOID[k];
  });
  global.MHR_EFFECTS_DATA_VOID = VOID;

})(typeof window !== 'undefined' ? window : global);
