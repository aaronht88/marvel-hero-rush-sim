# Marvel Hero Rush TCG — Battle Simulator

Marvel Hero Rush TCG 模擬對戰遊戲（可玩網頁版）。喺瀏覽器入面揀一副 50 張 deck，對住 AI 打，打到分出勝負（9 個 Rush Point 或對方牌庫耗盡）。

## 點樣玩

1. 開 `index.html`（double-click 就得）或者起個 static server：
   ```bash
   cd mhr-battle-sim && python3 -m http.server 8899
   # 開 http://localhost:8899/
   ```
2. 揀一副主牌組（RED_Aggro / YELLOW_Machine / BLUE_Control / GREEN_Tempo），AI 會用下一副
3. 開始對戰：
   - **叫卡**：點擊手牌嘅 Lv1-3 卡直接叫出 FRONT；Lv4+ 會彈 retreat modal（要退場上角色，合計 Lv = 叫出卡 Lv）
   - **攻擊**：點「攻擊」再點 AI 場上角色
   - **Counter**：AI 攻擊時有 COUNTER·ACTI 手牌會問你使唔使（棄牌減對方 Power）
   - **結束回合**：AI 行動
4. 勝利條件：9 個 Rush Point（對方角色戰敗 +1），或者對方 deck 抽乾

## 技術

- 零依賴 static web app：HTML + CSS + vanilla JS，無 build step
- `js/cards.js` — 233 張實卡資料（來自官方 cardlist，2026-08-10 抓取）
- `js/engine.js` — 遊戲引擎（區域狀態、call/retreat、戰鬥結算、Rush Point、回合流程、效果系統）
- `js/ai.js` — AI heuristic（叫 Lv1-3 + 攻擊贏到嘅目標 + 基本 counter）
- `js/app.js` — UI 綁定、玩家操作、battle log
- `img/cards/` — 4 副預設 deck 用嘅 101 張卡圖（由 deck builder repo 複製）

## 實裝狀態

### 已實裝
- ✅ 完整回合流程：Draw → Call → Battle → End，Player / AI 輪流
- ✅ 叫卡規則：Lv1-3 免費，Lv4+ 要 retreat 合計 Lv 相等嘅場上角色（retreat modal）
- ✅ 攻擊結算：比較 Power，敗方入 RETREAT；tie = Both Lose
- ✅ COUNTER·ACTI：手牌棄卡減對方 Power（BP01-002 等）
- ✅ Rush Point：對方角色戰敗 +1；勝利判斷（9 RP / deck-out）
- ✅ 部分卡效果：入場 draw、入場減對方 Power、prune（除外）、TRIG【WING】未攻擊減攻、AUTO Power buff 基礎版
- ✅ 4 副預設 deck（50 張、≤2 色、同名 ≤3，全部合法）

### 未實裝（stub，log 會標「效果未實裝」）
- ❌ BASE 區 set card 流程（zone 有但無牌可放）→ 黃色 deck 嘅 BASE 引擎未發揮
- ❌ 大部分卡效果（~180 張卡得 log 一句）— 只有 ~10-15 張真係 trigger
- ❌ AI 唔識 call Lv4+（retreat 邏輯）、唔識主動 prune
- ❌ attach（貼卡）、cover（翻面）、weakness attack、AIR STRIKE、Double Attack 等 keyword

## 規則假設（未經官方 rulebook 確認）

| 項目 | 假設 |
|---|---|
| Rush Point 獲得 | 對手角色 retreat（戰敗/被除外）= 我方 +1 RP；自家 retreat 做 cost 唔加 |
| 攻擊 tie | Both Lose（雙方入 retreat，雙方 +1 RP） |
| Deck-out | 即時敗北（官方 rulebook 確認） |
| 先手 | 第 1 回合冇 Battle Phase（一般 TCG convention） |
| 「this turn」效果 | 回合開始重置（簡化） |
| 附着卡 | host retreat 時一齊入 RETREAT |
| 距離 / Range | attackRange 有記錄但攻擊目標選擇簡化為「場上任何角色」 |

官方完整流程以 rulebook PDF 為準；模擬器係「合理版本」方便試玩，唔係 tournament 級規則引擎。

## 來源

- 卡牌資料：官方 cardlist（https://www.marvelherorush.com/en/cards），2026-08-10 抓取
- 預設 deck：aaronht88 同助手設計嘅 4 套戰術 deck（詳見 `/opt/data/mhr-decks.json`）
- 非官方 fan project，與發行商無關

## Changelog

- **v0.1 (2026-08-11)** — 初版：完整回合流程、call/retreat、攻擊結算、COUNTER、Rush Point 勝利、4 副預設 deck、~10-15 張卡效果實裝
