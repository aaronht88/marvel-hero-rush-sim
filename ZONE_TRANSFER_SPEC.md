# ZONE_TRANSFER — MHR 區域轉移模組規格

> 版本：v1.0（2026-10-21）
> 對齊來源：官方《漫威对战卡牌-超英击战》規則書 P6 / P14 / P15（`/tmp/mhr_rules.pdf`）
> 數據來源：實測 448 張卡（`tests/smoke/void_survey.js` → `void-survey.json`）
> 前置：`EFFECTS_DESCRIPTOR.md`（DSL 總規格）、`v3.17` choice primitive

---

## 0. 為何要有獨立 spec（唔可以當普通 op）

原本計劃將 `prune` / `move` / `place from VOID` 當成三個獨立 op。實測之後發現咁樣係錯：

- 7 張 VOID 卡，**7 個都唔同**（主體／目的地／成本／條件組合全不一樣）
- 目的地有 4 種，**每種語義唔同**（尤其 `BASE` = 蓋卡 = 失去效果）
- 成本有 4 種，全部要 **atomic**（失敗要完整還原）
- 有卡需要 **二階段條件**（依賴轉移結果）
- 有卡係 **`or` 二選一**，唔係 yes/no

所以 `zone_transfer` 係一個**機制模組**，包含 op + 成本驗證 + 條件鏈 + 選擇模式 + 結果依賴。

---

## 1. 規則書原文對齊

### 1.1 Zone 定義（P6）

| Zone | 規則書原文 | 容量 | 公開性 |
|---|---|---|---|
| 先鋒區 FRONT | 玩家放置角色卡的区域，也称为战区，上限 1 张 | 1 | 公開 |
| 側翼區 WING | 玩家放置角色卡的 2 个区域，也称为战区，各上限 1 张 | 2 | 公開 |
| 後衛區 BACK | 玩家放置角色卡的区域，也称为战区，上限 1 张 | 1 | 公開 |
| 基地區 BASE | 玩家放置角色卡和盖卡的的区域，上限 6 张 | 6 | **蓋卡非公開** |
| 撤退區 RETREAT | 玩家放置被撤退和被舍弃卡牌的区域，无上限 | ∞ | 公開 |
| 虛空區 VOID | 玩家放置被裁剪卡牌的区域，无上限 | ∞ | 公開 |
| 時間線 TIMELINE | 玩家放置冲击卡的区域，无上限 | ∞ | 公開 |
| 卡組 DECK | 玩家盖放卡组的区域 | — | 非公開 |
| 衝擊卡組 RUSH DECK | 玩家盖放冲击卡组的区域 | — | 非公開 |

> **「场」= 战区 + 基地区**（P6 註）。所以 filter 寫 `in the field` 係指 5 個角色槽（FRONT/WING×2/BACK）**加** BASE 6 格。

### 1.2 名詞定義（P14 / P15）

| 名詞 | 原文 | 本 spec 對應 |
|---|---|---|
| **5、捨棄** | 把手牌或卡组的卡牌放置进**撤退区** | `discard` → `to: retreat` |
| **6、撤退** | 把**场上**卡牌放置进**撤退区**；若角色战力为 0 则撤退该角色 | `retreat` → `to: retreat`（from: field）|
| **7、裁剪** | 把卡牌放置进**虚空区** | `prune` → `to: void` |
| **8、結附** | 角色卡会因效果放置进场或效果移动，**叠放在角色卡下**……结附卡处于其被结附卡所处区域，但**不占用该区域上限** | 獨立模組（見 §8）|
| **9、解除** | 结附卡会因效果不再叠放在角色卡下，**移动至场上指定区域**，结附卡**变更回角色卡** | 獨立模組（見 §8）|
| **3、蓋卡** | 盖卡**失去其效果**，视为处于**非公开区域**；双方只能查看各自的盖卡；可作为 Lv1 支付 Lv4+ 号召成本 | `to: base` 的語義 |

### 1.3 關鍵推論

`捨棄`（手牌/卡組 → RETREAT）同 `撤退`（場上 → RETREAT）**目的地相同但來源不同**，成本驗證亦不同（捨棄唔需要場上存在，撤退需要）。spec 必須用 `from` 區分，唔可以合併。

`裁剪` 只講「放置进虚空区」，**冇講來源**。所以 `prune` 可以 prune 手牌、牌組頂、場上、撤退區、甚至自己。

---

## 2. 實測變體清單（7 張 VOID 卡，全部原文）

### V1 — BP01-007「Void Reforge」Vision（Lv6，BOTH 方向）

```
TRIG【VOID】:When this card enters VOID from RETREAT, you may discard 2 cards
in HAND. If you do, you place this card from VOID into your field, and your
opponent's character in FRONT gets Power-1000 in this turn.
```

- 觸發：自己進入 VOID（**來源必須係 RETREAT**，唔係從場上直接裁剪）
- 主體：`self`
- 成本：`discard 2 from HAND`（可選 → `you may`）
- 目的：`field`
- 後續：另一張卡 -Power（**複合效果**，唔止 zone transfer）

```js
{ trig:"TRIG", slot:"VOID",
  cond:[{ if:"by_entering_void", from:"RETREAT" }],
  ops:[{ op:"optional", prompt:"棄 2 張手牌，把自己召回場上？",
         then:[{ op:"zone_transfer", cost:[{op:"discard", n:2, from:"hand"}],
                                      subject:"self", from:"void", to:"field" },
               { op:"stat_opp", target:"opp_front", power:-1000, duration:"this_turn" }] }] }
```

### V2 — PB01-011「Astral Visitor」Doctor Strange（Lv3，BOTH）

```
ACTI【VOID/ONCE PER TURN】:You prune 1 of your characters with Lv4 or above in
RETREAT. If you do, you place this card from VOID into your field.
```

- 觸發：主動（ACTI），位置 = VOID
- 主體：`self`
- 成本：`prune 1 own char (Lv>=4) in RETREAT` ← **成本本身係 prune**，而且 filter 指定 Lv
- 目的：`field`
- 條件：`If you do`（成本失敗則唔召回）+ once/turn

```js
{ trig:"ACTI", slot:"VOID", once:true,
  cost:[{ op:"prune", n:1, target:"my_retreat", filter:{ lv:">=", n:4 } }],
  ops:[{ op:"zone_transfer", subject:"self", from:"void", to:"field" }] }
```

> **注意**：呢張卡嘅成本係「裁剪自己另一張卡」。裁剪本身係「進 VOID」，即係**成本會產生新嘅 VOID 觸發**（例如 V1 嘅卡如果喺 RETREAT 被 prune 就會觸發）。interpreter 要處理連鎖。

### V3 — SP01-021「The Web of Destiny」Spider-Man（Lv3，BOTH）

```
UNIQUE TRIG【BASE/ONCE PER TURN】:When your card with 【Web】 in its feature
enters the field, you may attach 1 of your characters with 【Web】 in their
features from HAND to 1 of the characters on the field.

TRIG【VOID】:When this card enters VOID by your effect, you may place this
card from VOID into your BASE.
```

- 兩個獨立效果 block
- Block 2：主體 `self`，目的 **`BASE`**，成本 **無**，`you may`
- `enters VOID by your effect` ← **來源必須係自家效果**（唔係對手 prune）

```js
{ trig:"TRIG", slot:"VOID",
  cond:[{ if:"by_entering_void", by:"own_effect" }],
  ops:[{ op:"optional", prompt:"把自己蓋放到基地？",
         then:[{ op:"zone_transfer", subject:"self", from:"void", to:"base" }] }] }
```

> **`to: "base"` 語義**：進 BASE 即係變**蓋卡** → 失去所有效果 + 非公開。玩家係用「卡變廢」換「離開 VOID + 佔基地一格」。UI 要清楚提示。

### V4 — SP01-031「Straight and Narrow」Uncle Ben（Lv2，BOTH）

```
UNIQUE BLOCK TRIG【RETREAT】:When this card enters RETREAT from BATTLE by
losing the fight, you prune the top 3 cards of your deck. If you do, you place
1 of your characters with the lowest Lv and 【Web】 in their features from VOID
onto your BATTLE.
```

- 觸發：自己**戰敗**進 RETREAT
- 成本：`prune top 3 of DECK` ← **牌組頂**，唔係指定卡
- 主體：`chosen`，filter = **最低 Lv** + `【Web】` feature
- 目的：`BATTLE`（`onto` 語法）

```js
{ trig:"TRIG", slot:"RETREAT",
  cond:[{ if:"entered_retreat_by", reason:"losing_fight", from:"BATTLE" }],
  cost:[{ op:"prune", n:3, target:"my_deck_top" }],
  ops:[{ op:"zone_transfer", subject:"chosen",
         subjectFilter:{ feature:"Web", orderBy:"lowest_lv" },
         from:"void", to:"battle" }] }
```

> **`orderBy: "lowest_lv"`** 係新概念：filter 唔止篩選，仲要**排序取第一**。如果多張同 Lv，需要 tie-break 規則（建議：由控制方揀）。

### V5 — SP01-035「Mirror Fate」Prowler（Lv3，BOTH）

```
TRIG【BATTLE】:When your character with 【Human】 in its feature enters
RETREAT from BATTLE by losing the fight, you may prune this card on BATTLE.
If you do, you place 1 of your characters with Lv3 and 【Spider-Man】 in their
names from VOID onto the field.
```

- 觸發：**另一個**角色（Human, 戰敗）進 RETREAT
- 成本：`prune SELF on BATTLE` ← **裁剪自己喺戰場上**
- 主體：`chosen`（Lv3 + name 含 Spider-Man）
- 目的：`field`

> **關鍵**：成本係「把自己從 BATTLE 裁剪」→ 產生 VOID 進入 → 可能觸發自己嘅 `TRIG【VOID】`（如果同時有）。**self-cost 會令自己離場**，所以 `place from VOID` 嘅主體唔可以係「呢張卡」（它自己已經喺 VOID，但佢嘅效果係召回**另一張**）。

### V6 — SP01-066「Restoration of Multiverse」Doctor Strange（Lv4，OUT）

```
UNIQUE ACTI【BATTLE/ONCE PER TURN】:You discard 1 of your cards in HAND.
If you do, you place 1 of your characters with 【Multiverse】 in their features
from VOID onto your BATTLE. If that character is with Lv4 or above, you
discard 1 of your cards in HAND extra.
```

- 成本：`discard 1 from HAND`
- 主體：`chosen`（Multiverse feature）
- 目的：`BATTLE`
- **二階段**：`If that character is with Lv4 or above` → 再棄 1 張

```js
{ trig:"ACTI", slot:"BATTLE", once:true,
  cost:[{ op:"discard", n:1, from:"hand" }],
  ops:[{ op:"zone_transfer", subject:"chosen", subjectFilter:{ feature:"Multiverse" },
         from:"void", to:"battle",
         // 結果依賴：轉移完成後，用「被轉移嘅卡」做條件
         after:[{ op:"if_you_do",
                  when:{ subject:"transferred", test:{ lv:">=", n:4 } },
                  then:[{ op:"discard", n:1, from:"hand" }] }] }] }
```

> **這是 v3.17 continuation 的實際需求場景**：`after[].when.subject = "transferred"` 要由 `zone_transfer` 回傳「邊張卡被移」。

### V7 — SP01-077「Reversal of Multiverse」Spider-Punk（Lv3，BOTH）

```
AUTO【FIELD】：The character this card is attached to can only attack your
opponent's FRONT or the character on FRONT.

COUNTER·ACTI【HAND】：You discard this card in HAND. If you do, you prune all
your characters with 【Web】 in their features in RETREAT **or** you place all
your characters with 【Web】 in their features from VOID into your RETREAT.
```

- Block 2 有 **`or` 二選一**（唔係 yes/no，唔係順序）
- 選項 A：`prune all (Web) in RETREAT` → 進 VOID
- 選項 B：`place all (Web) from VOID → RETREAT` → 反向
- 主體：`all_filtered`

```js
{ trig:"COUNTER_ACTI", slot:"HAND",
  cost:[{ op:"discard", self:true, from:"hand" }],
  ops:[{ op:"choose_one", prompt:"選一個：",
         options:[
           { op:"prune", subject:"all", subjectFilter:{ feature:"Web", zone:"retreat" } },
           { op:"zone_transfer", subject:"all", subjectFilter:{ feature:"Web" },
             from:"void", to:"retreat" } ] }] }
```

> **`choose_one` 係新 primitive**，需要 card-picker UI（多選／二選一），唔係 v3.17 嘅 yes/no modal。

---

## 3. 資料模型

```ts
type ZoneTransfer = {
  op: "zone_transfer";

  // 主體：邊張卡要移動
  subject: "self" | "chosen" | "all" | "chosen_filtered";
  subjectFilter?: {
    feature?: string;      // 【Web】 / 【Machine】 / 【Multiverse】
    name?: string;         // name 包含
    lv?: { op: "<=" | ">=" | "=" | "lowest"; n?: number };
    power?: { op: "<=" | ">="; n: number };
    zone?: Zone;           // 主體而家喺邊
    orderBy?: "lowest_lv" | "highest_power";   // 多個合法目標時揀邊個
    playerChooses?: boolean;                    // true = 由控制方揀
  };

  // 來源 / 目的地
  from: Zone;
  to: Zone;

  // 成本（全部要 atomic：任何一項失敗 → 整個 op 失敗，state 完全不變）
  cost?: Op[];

  // 轉移後嘅後續（二階段條件，可用 transferred 指涉被移嘅卡）
  after?: Op[];
};

type Zone = "deck" | "hand" | "front" | "wing" | "back" | "base"
          | "retreat" | "void" | "timeline" | "rush_deck";
```

### 3.1 `to: "base"` 特殊語義

進 BASE **必然**變成蓋卡（規則書 P14 名詞 3）：

- `card._faceDown = true`
- 失去所有效果（`effects` 暫時失效，`runEffects` 要 skip `_faceDown`）
- 非公開（UI 只有控制方見到內容）
- 可作 Lv1 支付 Lv4+ 號召成本（`retreatUids` 計數）

**呢三樣唔關 zone_transfer 做，係 `base` zone 嘅固有語義**。但 zone_transfer 要負責設 `_faceDown` 旗標。

### 3.2 `from: "void"` 嘅自我指涉

如果 `subject: "self"` 而卡本身喺 VOID，`findCard` 要掃 `voidZone`（唔止場上）。現有 `effects.js:findCardByUid` 已經掃全部 zone，可以用。

---

## 4. 成本類型（實測 4 種）

| 成本 | 範例 | 驗證要求 |
|---|---|---|
| `discard N from hand` | V1 棄 2、V6 棄 1 | 手牌 ≥ N，否則失敗 |
| `discard self from hand` | V7 | 自己必須喺手牌 |
| `prune N own char (filter) in RETREAT` | V2 裁剪 Lv4+ | 撤退區有符合 filter 嘅卡 ≥ N |
| `prune top N of deck` | V4 頂 3 | 牌組 ≥ N（否則？→ 見 §5.3）|
| `prune self on BATTLE` | V5 | 自己必須喺戰場 |

### 4.1 atomic 要求

`EFFECTS_DESCRIPTOR.md` §5 硬性規則 2：「validate cost + 目標 → 先 commit；取消/非法 play 必須完整還原」。

實作：先 `validateCost()` 純檢查（唔改 state），全部 pass 之後才 `applyCost()`。**現有 `js/effects.js:resolveCost` 係邊檢查邊改 state，要重寫。**

### 4.2 連鎖觸發

V2 嘅成本係 prune → prune 會令卡進 VOID → 可能觸發「進 VOID」效果（V1 / V3）。

**處理**：成本結算後 push 新 event 去 queue，但**唔可以喺 op 執行中途遞歸**（會令 atomic 失效）。建議：成本產生嘅 event 排入 `pendingEvents`，op 完成後統一 flush。

---

## 5. 邊界情況（實測發現）

### 5.1 V5：成本令自己離場

`prune self on BATTLE` 之後，`self` 已經唔喺場。如果效果後續要參考「自己」，會搵唔到。

**規則**：`zone_transfer` 要喺 op 開始前 snapshot `sourceCard`，全程用 snapshot，唔好中途 re-lookup。

### 5.2 V4：`orderBy: lowest_lv` 有並列 → 預設控制方揀

兩張都係最低 Lv 時，官方規則書**冇明文**。

**決定（Aaron 2026-10-21）：卡效冇特別講 → 預設由控制方揀。**

即係 `orderBy` 唔會自動 tie-break，而係當有多個合法目標（無論係 Lv 並列與否）就 `playerChooses: true`。呢個同規則書一貫做法一致 —— 效果文字冇指定嘅選擇權，歸控制方。

### 5.3 牌組不足 —— 規則書 P8 已答，唔再係開放問題

**P8 勝利條件原文：**

> 若我方滿足以下其中一個條件，則我方獲得遊戲勝利，此時遊戲結束。
> ◆我方時間線存在 9 張衝擊卡。
> ◆**敵方卡組為 0 張。**

所以 `prune top 3 of deck` 而牌組只剩 2 張：

1. prune 2 張（`min(N, deck.length)`）
2. deck 變 0
3. **即刻觸發「敵方卡組為 0」→ 對手獲勝**

即係 prune 唔會「失敗」，但會**直接令自己輸**。玩家要有心理準備：V4（Uncle Ben）呢個成本有可能自殺。

> **v3.18 code 修正**：舊 `checkWin()` 完全冇檢查卡組歸零，只在 `drawN`/`drawTo` 內部順手設 winner。已改成 `checkWin()` 統一檢查，並喺每次 `deck.shift()` 之後呼叫 —— 因為 deck 可以因為 prune 而歸零，唔止抽牌。

### 5.4 `prune all` 移 0 張 → `If you do` 算唔算成立？

**規則書冇明文覆蓋呢個情況。**

受影響卡：SP01-077「Reversal of Multiverse」Spider-Punk

```
you prune all your characters with 【Web】 in their features in RETREAT
or
you place all your characters with 【Web】 in their features from VOID into your RETREAT
```

如果 RETREAT 冇 Web 角色 → prune 0 張。

**兩個可能解讀：**

| 解讀 | 「If you do」判定 | 影響 |
|---|---|---|
| A. 指令已執行（即使 0 張）| 成立 | 另一邊 `or` 分支亦唔會觸發 |
| B. 冇實際動作 = 未做到 | 不成立 | 效果整體冇效 |

**建議取 A**（「指令已執行」語義）—— 因為 `prune all N` 係一個**完整的指令**，唔係「嘗試 prune 並需成功」。如果取 B，玩家會出現「明明寫 all 但因為冇目標而靜靜哋冇事發生」嘅怪異體驗。

> ⚠️ **仍需 Aaron 決定或查官方 FAQ**。console 實卡玩家如果有 FAQ 可以確認。

---

## 6. Interpreter 執行次序

```
1. snapshot sourceCard（避免成本令 source 消失後搵唔到）
2. 解 subjectFilter → collectCandidateTargets()
3. 若 playerChooses → park choice，等玩家揀（v3.17 已有機制）
4. validateCost() 純檢查（不改 state）→ 失敗則整個 op 失敗
5. validateTargets() → 每個目標嘅 from zone 正確、to zone 有位
6. applyCost()（改 state）
7. applyTransfer()（remove-from → add-to，用 identity `_uid` 檢查）
8. 若 to === "base" → set card._faceDown = true
9. 若 after[] → runOpList(after, ctx with transferred = [movedCards])
10. flush pendingEvents（成本/轉移產生嘅新觸發）
11. assertZoneInvariant()（debug 模式）
```

**Zone invariant**：每張卡（`_uid`）任何時刻只在一個 zone。V7 `all` 多卡移動要逐張 remove-then-add，唔可以批量覆寫陣列。

---

## 7. 與現有 engine 的差距

| 項目 | 現況 | 需要 |
|---|---|---|
| `pruneCard()` | 只支援場上 → VOID | 加 from zone 參數 |
| `resolveCost()` | 邊檢查邊改 state（非 atomic）| 重寫成 validate → apply |
| `runOpList()` continuation | v3.17 只回傳 `{ok}` | 要回傳 `{ok, transferred:[...]}` 供 `after` 用 |
| `choose_one` | 冇 | 新 primitive + card-picker UI |
| `base._faceDown` | 有旗標但 `to: base` 冇設 | zone_transfer 負責設 |
| `orderBy` filter | 冇 | 新 filter 維度 |

---

## 8. Attach / Detach — 明確排除

**呢個 spec 唔包 attach/detach。** 原因：

attach/detach 唔止改 state，仲要改：

1. **Zone 模型**：結附卡唔佔區域上限、跟主體區域（規則書 P15 名詞 8）
2. **UI 結構**：卡要**疊喺**另一張卡下面（DOM 嵌套 + z-index），唔係並排 grid
3. **互動方式**：拖去主卡上面 = attach（`drop` target 係卡唔係槽）
4. **解除流程**：脫離時要揀「移去邊個指定區域」，需要 zone picker

呢四樣橫跨 engine + CSS + DOM + interaction，**應該獨立 track**（`ATTACH_DETACH_SPEC.md`）。

現有 `js/engine.js` 已有 `p.attached[uid]` 結構同「主卡撤退時帶走結附卡」（`push(card, ...att)`），但 UI 完全冇流程 → RULES_AUDIT gap #7 一直開住。

---

## 9. 實作次序（建議）

| # | 項目 | 依賴 | 產出 |
|---|---|---|---|
| Z1 | `resolveCost` 重寫成 atomic（validate → apply）| — | 單元測試 |
| Z2 | `zone_transfer` op 核心（self / chosen / all）| Z1 | 7 張卡中 V1,V2,V3 可通 |
| Z3 | `after[]` continuation + `transferred` 指涉 | Z2 + v3.17 | V6 可通 |
| Z4 | `choose_one` primitive + card-picker UI | Z2 | V7 可通 |
| Z5 | `orderBy` filter + `to: base` 蓋卡語義 | Z2 | V4, V5 可通 |
| Z6 | pendingEvents 連鎖 flush | Z2 | V2 成本連鎖正確 |

**每階段必須**：對官方原文逐字核對 + node 測試 + browser 實測 + zone invariant 斷言。

---

## 10. 待確認問題（2026-10-21 更新：由 4 條減到 1 條）

### 已解決（規則書有答案）

| # | 問題 | 答案 | 來源 |
|---|---|---|---|
| ~~1~~ | `prune top N` 牌組不足 | prune `min(N, deck.length)`；deck 變 0 → **對手即刻贏** | P8 |
| ~~3~~ | `orderBy` 並列邊個揀 | **預設控制方**（卡效冇講就歸控制方）| Aaron 指示 |
| ~~4~~ | 蓋卡當回合可否即用 Lv1 | **可以**，無時機限制 | P14 名詞 3 |

### 仍未解決（1 條）

**`prune all` 移 0 張時，`If you do` 算唔算成立？**

- 受影響：SP01-077（V7，`or` 二選一其中一邊）
- 規則書冇覆蓋「0 張」情況
- 建議取「指令已執行 = 成立」（解讀 A，見 §5.4）
- **需要 Aaron 決定，或查官方 FAQ / 實卡玩家**

### 補充：蓋卡 Lv1 cost 的原文依據

**P14 名詞 3：**

> ◆若玩家進行Lv4或以上角色的號召，則該玩家可以撤退1張或以上蓋卡來滿足該角色的所有或部分號召需求，此時**每張蓋卡作為1張Lv1的卡牌**。

原文**冇任何時機限制**（例如「上回合蓋放」），所以當回合蓋放嘅卡即刻可以當 Lv1 用。`retreatUids` 計數時每張 `_faceDown` 卡算 Lv1。

---

## 11. 參考

- 官方規則書：`/tmp/mhr_rules.pdf`（17 頁，簡中《超英击战》），已抽出文字 `/opt/data/cache/mhr_rules.txt`
- 實測工具：`tests/smoke/void_survey.js` → `tests/smoke/void-survey.json`
- DSL 總規格：`EFFECTS_DESCRIPTOR.md`
- Choice primitive：`js/effects.js` v3.17（`optional` / `if_you_do` / `parkChoice` / `resolveChoice`）
- Zone invariant：`js/engine.js` v3.16（`assertZoneInvariant`）
- card-game skill：effects-as-data + atomic play + zone invariant（identity，非 `==`）