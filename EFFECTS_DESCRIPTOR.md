# EFFECTS_DESCRIPTOR — MHR 效果系統 DSL 規格（供 engine interpreter 對接）

> 目標：將官方 267 張卡（233 角色 + 34 衝擊）嘅效果由 hardcoded regex 改為 **declarative descriptor**，
> 由一個 interpreter 統一結算（effects-as-data pattern）。
> 分類統計基於官方 API 2026-08-27 全量資料（分析 script: `/opt/data/cache/mhr_effect_classify.py`，
> 資料: `/opt/data/cache/mhr_all_cards.json`）。
> 對應 RULES_AUDIT gap #5（優先度最高）。

## 1. 統計摘要（DSL 規模證據）

| 維度 | 數字 | 對 DSL 意義 |
|---|---|---|
| Trigger 類型 | TRIG 135 / AUTO 89 / COUNTER 27 / ACTI 25 / COUNTER·ACTI 23 | 5 個 trigger 關鍵字，同官方規則書一致 |
| Trigger 位置 | FIELD 86 / HAND 44 / BATTLE 44 / RETREAT 25 / WING 7 / BASE 5 / BACK 4 / FRONT 3 / VOID 2（+ /ONCE PER TURN 51 個組合） | 全部係 engine 現有 zone/位置子集，唔使新 zone |
| 核心 op | **14 個**（下表） | 唔使 per-card code；「one function per card」係反模式 |
| `if` 條件 | 142 張（61%） | 需要 cond DSL |
| `you may` 可選 | 67 張 | 需要 player-choice 流程（pending prompt） |
| `ONCE PER TURN` | 50 張 | engine 已有 `turnFlags.oncePerTurnUids` |
| `X` 動態變數 | 34 張 | 需要 variable resolution；唔值得為佢整完整表達式引擎 → escape hatch |
| 多效果塊（\n） | 38 張 | descriptor 係 array，天然支援 |
| 無效果文本 | 8 角色 + 34 衝擊 | 衝擊卡係 token（時間線計數用），角色 vanilla 唔使 descriptor |

## 2. 資料模型

每張卡加 `effects` 欄位（array of effect blocks）：

```js
{
  id: "BP01-001",
  // ...原有欄位（level/power/attackRange/...）,
  effects: [
    {
      trig: "TRIG",                  // TRIG | AUTO | ACTI | COUNTER | COUNTER_ACTI
      slot: "FIELD",                 // 觸發/使用位置：FIELD|HAND|BATTLE|RETREAT|WING|BASE|BACK|FRONT|VOID
      once: true,                    // ONCE PER TURN（TRIG/ACTI 限定；AUTO 無）
      cond: [ { if: "by_calling" } ],// 條件（全部成立先執行）
      cost: [ { op: "retreat", lvSum: "=X" } ],   // 費用（可選；失敗即唔執行）
      ops:  [ { op: "prune", target: "opp_field", filter: { lv: "<=", var: "X" } } ]
    }
  ]
}
```

### 真實例子（直接由官方文本轉譯）

**BP01-001 Iron Man** — `TRIG【FIELD】：When this card enters the field by calling, you prune 1 of your opponent's characters with LvX or below in the field. X is the number of the cards you retreat by calling this card.`
```js
{ trig: "TRIG", slot: "FIELD", once: false,
  cond: [ { if: "by_calling" } ],
  cost: [ /* calling 已 implicit 處理 retreat cost；X 由 calling 時記錄 */ ],
  ops:  [ { op: "prune", target: "opp_field", filter: { lv: "<=", var: "X" } } ],
  vars: { X: "retreated_by_this_call" } }
```

**BP01-002 Black Widow** — `COUNTER·ACTI【HAND】:You discard this card in HAND. If you do, 1 of your opponent's characters in BATTLE gets Power-2000 in this turn.`
```js
{ trig: "COUNTER_ACTI", slot: "HAND",
  cost: [ { op: "discard_self_from_hand" } ],
  ops:  [ { op: "power_mod", target: "opp_battle", amount: -2000, duration: "this_turn" } ] }
```

**BP01-004 Hulk** — `AUTO【FIELD】:If you have only red characters in the field, this card gets Lv+X and Power+X000. X is the number of your opponent's characters in BATTLE.`
```js
{ trig: "AUTO", slot: "FIELD",
  cond: [ { if: "all_my_field_attr", attr: "Red" } ],
  ops:  [ { op: "lv_mod", amount: { var: "X" } },
          { op: "power_mod", target: "self", amount: { var: "X", scale: 1000 } } ],
  vars: { X: "count_opp_battle" } }
```

**BP01-011 Thor** — `TRIG【FIELD】:When this card enters the field by calling, you draw 1 card. If you do, this card gets the second chance to attack character only in this turn.`
```js
{ trig: "TRIG", slot: "FIELD", cond: [ { if: "by_calling" } ],
  ops:  [ { op: "draw", n: 1 },
          { op: "second_chance_attack", target: "self", duration: "this_turn" } ] }
```

## 3. 操作詞彙表（14 core ops）

| op | 參數 | 語義 | 對應 engine |
|---|---|---|---|
| `power_mod` | target, amount, duration | Power±（this_turn 或常駐） | `cardEffectivePower` + `_powerMod` |
| `retreat` | target, to | 移去 RETREAT（角色+其 attached） | `retreatCard` |
| `move` | target, from, to | zone 移動（field/base/hand/void/retreat） | `battleBaseMove` 等 |
| `discard` | n / self | 手牌棄置 | `discardDownTo` / hand splice |
| `prune` | target, filter | 移去 VOID（裁剪，非 retreat） | `pruneCard` |
| `attach` | target_host, filter | 結附（疊放，唔佔位） | `attached[uid]` |
| `r_mod` | target, amount, duration | R±（射程） | `cardEffectiveRange` + `_rMod` |
| `draw` | n | 抽牌（deck-out → 輸） | `drawN` |
| `face_down` | target, to_base | 蓋放 BASE | `setDeploy` |
| `attack_bonus` | target | 額外攻擊（second chance / double attack） | `doubleAttackUids` |
| `show` | target | 公開基地蓋卡（唔移動） | UI prompt |
| `lv_mod` | target, amount | Lv±（call cost 計算用） | `cardEffectiveLv` + `_lvMod` |
| `return_to_hand` | target | 返手牌 | hand push |
| `rush_point` | n | +RP（時間線） | `gainRushPoint` |

Target 語法：`self` | `opp_field` | `opp_battle` | `my_battle` | `my_base` | `any_field` | `chosen`（pending prompt）。
Filter 語法：`{ lv:"<=", var:"X" }` / `{ power:"<=", n:2000 }` / `{ feature:"Machine" }` / `{ attr:"Red" }`。

## 4. Trigger 矩陣 → event hook

| trig | 觸發時機 | engine hook |
|---|---|---|
| TRIG【FIELD】 | 入場（call / 其他方式） | `triggerEnter`（現有） |
| TRIG【RETREAT】 | 進入撤退區 | `retreatCard` 內加 hook |
| TRIG【HAND】 | 手牌條件/時機（如我方紅色攻擊時） | `attack()` 內加 hook |
| TRIG【BATTLE】 | 戰鬥階段事件 | `attack()` / 回合結束 |
| TRIG【WING】 | 回合結束（側翼） | `endTurn` 內加 hook |
| TRIG【VOID】 | 進入 VOID | `pruneCard` 內加 hook |
| AUTO【FIELD/BATTLE】 | 常駐效果：每次相關狀態變化後 refresh | 結算後統一 `refreshAutos(side)` |
| ACTI【HAND/BATTLE/BACK】 | 玩家主動起動（行動階段） | 新 action 按鈕（pending prompt） |
| COUNTER·ACTI【HAND】 | 應對階段/應對步驟 | `useCounter`（現有，改為讀 descriptor） |
| COUNTER【HAND】 | 應對能力（反擊標記） | `useCounter` 分支 |

## 5. Interpreter contract（結算次序）

```
event fired → collect matching effects (trig×slot) →
  排序：active player 先，再按 timestamp（決定 simultaneity）
  for each: eval cond → resolve cost（失敗：唔執行，zone 不變）→
    執行 ops（**atomic batch**：validate 目標合法 → 一次 commit）→
    產生嘅新 event 入 queue（FIFO）／stack（LIFO，應對鏈）→ 繼續直至空
```

硬性規則（由 card-game skill pitfalls 提煉）：
1. **Zone invariant**：每張實體卡（`_uid`）恰喺一個 zone；move = remove-then-add；
   duplicate 檢查用 **identity 唔用 `==`**（實測 pitfall，2026-08-27）。
2. **Atomic play**：validate cost + 目標 → 先 commit；取消/非法 play 必須完整還原（call 失敗還原手牌，engine 已有先例）。
3. **Deck-out**：抽牌時 deck 空 → 即輸（官方規則，無 reshuffle）。
4. **ONCE PER TURN**：`turnFlags.oncePerTurnUids[uid]` 記錄；回合結束 reset（現有機制）。
5. **AUTO 刷新時機**：任何 Power/Lv/R 依賴狀態改變後統一 refresh（避免逐張 hardcode）。
6. **Duration**：`this_turn` 效果回合結束清除（`endTurn` 已有 `_powerMod=0` 重置）。

## 6. X 變數（34 張）處理策略

唔整完整表達式引擎。做法：
- descriptor 加 `vars: { X: "<source>" }`，source 係**有限集合**：
  `retreated_by_this_call` | `count_opp_battle` | `count_my_field` | `this_power` | `cards_retreated_this_turn` | `count_my_hand` …
- interpreter 內建 resolution map（~10 個 source 已覆蓋全部 34 張，要 audit 確認）
- 例外：真係要自訂邏輯先 fallback `raw: fn(state, ctx)` escape hatch（Senku 設計保留）

## 7. 遷移計劃

| 階段 | 內容 | 負責 |
|---|---|---|
| S1 | 本規格定稿 + AUTO refresh 機制設計 | JARVIS ✅（本文件） |
| S2 | interpreter 核心（event → match → cond → cost → ops → stack）+ 5 個 sample op | Senku（M1） |
| S3 | js/effects.js 生成：簡單卡（無 X、單效果塊）自動 parse，~60% 覆蓋；X 卡 + 多行卡 manual | JARVIS+Senku |
| S4 | 全量對齊：逐張驗證 descriptor ↔ 官方文本（diff 工具） | 共同（M4） |
| S5 | useCounter / triggerEnter 舊 regex 路徑刪除 | Senku |

## 8. 參考

- card-game skill（gamedev-skills）：effects-as-data + interpreter、queue/stack、atomic play、zone invariant
- 官方規則書 17 頁（/tmp/mhr_rules.pdf，簡中《超英击战》）P11/P14/P15
- 分析數據：/opt/data/cache/mhr_all_cards.json（267 卡，官方 API 2026-08-27）
- 分類 script：/opt/data/cache/mhr_effect_classify.py
