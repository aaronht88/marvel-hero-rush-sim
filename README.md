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
   - **行動階段**：基地部署（每回合 1 次：蓋 1 張手牌入基地 → 抽 1）、行動號召（每回合 3 次，先攻首回合 1 次）、戰基移動（戰區 ↔ 基地，每角色 1 次）
   - **叫卡**：點擊手牌 Lv1-3 直接放進空置戰區（先鋒→側翼→後衛自動搵位）；Lv4+ 彈 retreat modal（要退場上角色，合計 Lv = 叫出卡 Lv；蓋卡當 Lv1）
   - **攻擊**：戰鬥階段撳 ⚔ → 揀攻擊者 → 揀目標（敵方角色或破綻＝空戰區）；順序先鋒→側翼→後衛
   - **破綻攻擊成功 = +1 Rush Point**（衝擊卡組頂 1 張放時間線）
   - **Counter**：對方攻擊時有 COUNTER·ACTI 手牌會問你使唔使（棄牌減對方 Power）
   - **回合結束**：手牌 >9 棄至 9
4. 勝利條件：時間線 9 張衝擊卡，或者對方 deck 抽乾

## 技術

- 零依賴 static web app：HTML + CSS + vanilla JS，無 build step
- `js/cards.js` — 233 張實卡資料（來自官方 cardlist，2026-08-10 抓取）
- `js/engine.js` — 遊戲引擎（區域狀態、基地部署、號召/retreat、攻擊/破綻、Rush Point、回合流程、效果系統）
- `js/ai.js` — AI heuristic（基地部署、號召 Lv1-4、攻擊破綻優先、基本 counter）
- `js/app.js` — UI 綁定、玩家操作、battle log
- `img/cards/` — 4 副預設 deck 用嘅 101 張卡圖（由 deck builder repo 複製）

## 實裝狀態

### 已實裝（對齊官方規則書 v0.2）
- ✅ **官方 battle mat 版面**：先鋒①→側翼②×2→後衛③→基地區④（垂直）；撤退區⑤→虛空區⑥→時間線⑦→卡組⑧→衝擊卡組⑨（外圍）
- ✅ 完整回合流程（官方 6 步）：回合開始 → 抽 2 → 行動 → 戰鬥 → 應對 → 結束
- ✅ 起始手牌 6；每回合抽 2；手牌上限 9（回合結束棄至 9）
- ✅ 基地部署：手牌蓋放進基地 → 抽 1（每回合 1 次；蓋卡失去效果）
- ✅ 行動號召：每回合 3 次（先攻首回合 1 次）；Lv1-3 免費、Lv4+ 要 retreat 合計 Lv 相等（蓋卡當 Lv1）
- ✅ 戰基移動：戰區 ↔ 基地（當回合放置嘅角色不能移動）
- ✅ 戰鬥階段：先攻首回合跳過；調整戰區位置；按先鋒→側翼→後衛順序攻擊；R 值內選目標
- ✅ 破綻（空戰區）攻擊成功 → +1 Rush Point（時間線）
- ✅ 攻擊結算：戰力大勝小敗、相等相殺（Both Lose）；COUNTER·ACTI 應對
- ✅ 部分卡效果：入場 draw、入場減對方 Power、TRIG【WING】未攻擊減攻、COUNTER 減攻、AUTO Power buff 基礎版
- ✅ 4 副預設 deck（50 張、≤2 色、同名 ≤3，全部合法）

### 未實裝（stub，log 會標「效果未實裝」）
- ❌ 大部分卡效果（~180 張卡得 log 一句）— 只有 ~15 張真係 trigger
- ❌ 完整應對階段（有 RESPOND phase 但行動選項簡化；AI 唔會主動應對號召）
- ❌ attach（結附）、cover、AIR STRIKE（空襲）、Double Attack（連擊）等 keyword 未完整實裝
- ❌ 戰鬥階段「調整 1 次最多 4 張角色位置」未實裝

## 規則假設（簡化位，未完全跟官方）

| 項目 | 現狀 |
|---|---|
| 應對階段 | RESPOND phase 存在但選項簡化（COUNTER 自動/跳過），冇完整輪流應對 |
| 距離 / Range | attackableTargets 有 R 值限制，但距離計法係簡化版（先鋒=0、側翼=1、後衛=2 索引差） |
| 結附（attach） | 引擎有 attached 結構 + 少量 Power bonus，但冇 UI 流程 |
| 破綻攻擊 | 有 R 值限制（官方 R 值圖喺規則書 P12） |

官方完整流程以規則書 PDF 為準；模擬器係「可玩版本」方便試 deck，唔係 tournament 級規則引擎。

## 來源

- 卡牌資料：官方 cardlist（https://www.marvelherorush.com/en/cards），2026-08-10 抓取
- 規則：官方快速入門規則書 PDF（2026-08-11 由用戶提供，17 頁）
- 預設 deck：aaronht88 同助手設計嘅 4 套戰術 deck（詳見 `/opt/data/mhr-decks.json`）
- 非官方 fan project，與發行商無關

## Changelog

- **v0.2 (2026-08-11)** — 對齊官方規則書：battle mat 版面（先鋒/側翼/後衛/基地 + 時間線/撤退/虛空/卡組/衝擊卡組）、起始手牌 6、抽 2、手牌上限 9、基地部署、號召 3 次（先攻首回合 1 次）、戰基移動、破綻攻擊 +1 RP、攻擊順序先鋒→側翼→後衛、蓋卡當 Lv1
- **v0.1 (2026-08-11)** — 初版：完整回合流程、call/retreat、攻擊結算、COUNTER、Rush Point 勝利、4 副預設 deck、~10-15 張卡效果實裝
