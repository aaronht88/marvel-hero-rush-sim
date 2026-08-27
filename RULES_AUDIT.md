# RULES_AUDIT — Marvel Hero Rush Sim vs 官方規則書

> 來源：官方《漫威对战卡牌-超英击战》快速入门规则 PDF（17 頁，Aaron 提供）
> 日期：2026-08-15（2026-08-27 更新：效果系統分類完成，見 EFFECTS_DESCRIPTOR.md）
> 對比基準：sim v3.3 + deckbuilder repo（268 張卡圖）

## ✅ 已對齊

| 規則 | 官方定義 | sim 實況 |
|---|---|---|
| 卡組構築 | 50 張、≤2 色、同名 ≤3 | ✅ 4 副預設 deck 全合法 |
| 衝擊卡組 | 9 張自選衝擊卡 | ⚠️ 見 gap #2 |
| 起始手牌 | 6 張 | ✅ |
| 抽卡 | 每回合抽 2 | ✅ |
| 手牌上限 | 9（回合結束棄至 9） | ✅ |
| 回合流程 | 6 步：開始→抽卡→行動→戰鬥→應對→結束 | ✅（應對階段簡化，見 gap #3） |
| 基地部署 | 行動階段 1 次：手牌蓋放基地→抽 1 | ✅ |
| 行動號召 | 每回合 3 次；先攻首回合 1 次 | ✅ |
| 號召 Lv 規則 | Lv≤3 直接放；Lv≥4 撤退合計 Lv 相等（蓋卡當 Lv1） | ✅ |
| 戰基移動 | 戰區↔基地，每角色 1 次；當回合放置嘅唔郁得 | ✅ |
| 破綻 | 空戰區＝破綻；攻破綻成功 +1 RP | ✅ |
| 勝利條件 | 時間線 9 張 / 對方 deck 0 | ✅ |
| 戰力結算 | 大勝小敗、相等相殺 | ✅ |
| 攻擊順序 | 先鋒→側翼→後衛 | ✅ |
| 攔截 / 強襲 / 連擊 | 能力 keyword | ⚠️ 有基本實裝，要 audit 完整性 |
| 蓋卡 | 失去效果、非公開、雙方只能睇自己 | ✅（要確認） |

## ❌ Gap List（未實裝 / 有差距）

### #1 調整起始手牌（Mulligan）— 官方 P9
先攻玩家先決定：把要調整嘅手牌蓋放回卡組底 → 從卡組頂抽等量 → 洗混卡組。後攻再決定。
**Sim：完全冇呢步。**
優先度：高（setup 規則，容易做）
**✅ DONE 2026-08-27（v3.4）：** engine `mulligan()` + UI overlay（點卡選擇／全部保留）+ AI heuristic（Lv≥5 最多 2 張）。

### #2 衝擊卡組實卡化 — 官方 P7
官方：玩家自選 **9 款衝擊卡** 組成衝擊卡組；時間線放嘅係實卡。
Deckbuilder 已有 34 張 RP 卡資料（BP01-121~150 + SDxx-019），圖鑑 tab 已上線。
**Sim：只係純計數（星爆 9 格），冇真正衝擊卡 deck。**
優先度：高（deck builder 已 support，sim 要對接）
**✅ DONE 2026-08-27（v3.4）：** setup screen 加自選衝擊卡組（34 張揀 9，揀滿先解鎖）；唔揀就自動（dominant set，v3.3 邏輯）；時間線已顯示實卡 art（v3.3）。

### #3 完整應對階段 — 官方 P14
官方：雙方**輪流**選擇 1 個行動（應對號召 / 應對·起動 / 不行動），連續選擇直至雙方連續「不行動」。
- 應對號召：每回合此階段雙方各自最多 1 次
- 應對·起動：卡牌能力
**Sim：RESPOND phase 存在但簡化（engine.js 只有 comment）。**
優先度：高

### #4 行動階段「起動效果」— 官方 P11
官方行動階段有 4 種行動（我哋得 3 種）：基地部署 / 行動號召 / 戰基移動 / **起動效果**。
**Sim：ACTI 卡大部分係 stub，冇起動效果 UI。**
優先度：高（連住 effect framework）

### #5 效果系統 — 官方 P15
官方 4 種效果類型：觸發 / 常駐 / 起動 / 應對·起動。
**Sim：只有 ~16 hardcoded trigger；~180 張卡 stub（log「效果未實裝」）。**
優先度：最高（最大工程）
**2026-08-27 進展：** 全量 267 卡效果文本分類完成（TRIG 135 / AUTO 89 / COUNTER 27 / ACTI 25 / COUNTER·ACTI 23；~14 core ops 覆蓋全部；34 張 X 變數卡），
DSL descriptor 規格見 **`EFFECTS_DESCRIPTOR.md`**（interpreter 對接文件）。
**S3 v1（同日）：** `js/effects-data.js` 自動生成 6 卡號（BP01-001/004/060/071 + SD02-017/SD03-004）+ M1 demo Thor = 7 張行 DSL；r_mod/lv_mod op 實裝；AUTO phase_change refresh（防累積）；X vars 解析；node 17/17 + 瀏覽器零錯誤。剩餘 ~216 張 manual 卡 reason 分類喺 `/opt/data/cache/effects_data.json`（S3b 逐 reason 擴充）。

### #6 能力 keyword 完整化 — 官方 P15
官方 5 個能力：應對 / 攔截 / 連擊 / 強襲 / 空襲 / 唯一。
**Sim：攔截/強襲/連擊有基本版；空襲、唯一要確認。**
優先度：中（跟 #5 一齊做）

### #7 結附 / 解除系統 — 官方 P14（名詞 8、9）
角色卡可結附（疊放）喺角色卡下，唔佔區域上限；解除＝變回角色卡移動到指定區域。
**Sim：engine 有 attached 結構，UI 流程缺。**
優先度：中

### #8 調整戰區位置 — 官方 P12
戰鬥階段 1：我方可以調整 1 次，最多 4 張角色嘅戰區位置（先鋒↔側翼↔後衛）。
**Sim：未實裝。**
優先度：中

### #9 空襲（AIR STRIKE）— 官方 P15
即使敵方戰區有角色，此卡可以攻擊該戰區嘅破綻。
**Sim：未實裝。**
優先度：中

### #10 Range 計算對齊官方 — 官方 P12 圖
官方 R 值表（R-1/R-2/R-3 對應目標位置）。
**Sim：簡化版，要對齊官方距離表。**
優先度：中

## 🧬 Effect Framework 設計（草案）

見 Senku 出嘅 Hybrid DSL 設計：trigger × slot × condition × action ops（~30 primitives）+ 能力 keyword 表 + escape hatch（raw fn 處理 edge case）。

要點：
- Declarative descriptor，唔好逐張 hardcode
- Interpreter：event hook → match trigger → check slot → eval condition → resolve cost → execute ops（atomic batch + log）→ enqueue follow-up
- 5 個能力 keyword：COUNTER / INTERCEPT / DOUBLE_ATTACK / ASSAULT / UNIQUE

## 📋 Roadmap

| # | Deliverable | 負責 | 狀態 |
|---|---|---|---|
| M0 | Art sync（101→268 圖） | JARVIS | ✅ DONE 2026-08-15 |
| M1 | DSL engine core + interpreter + 5 sample ops + demo card | Senku | ✅ DONE 2026-08-27（effects.js：draw/power_mod/retreat/prune/attack_bonus + Thor BP01-011 demo；node smoke 36 pass） |
| M1.2 | 效果分類統計 + DSL descriptor 規格（EFFECTS_DESCRIPTOR.md） | JARVIS | ✅ DONE 2026-08-27 |
| M1.5 | Mulligan + 衝擊卡組實卡化 | JARVIS | ✅ DONE 2026-08-27（v3.4，瀏覽器實測） |
| M2 | 180 張 stub effects declarative 化 + Range 對齊 | Senku | ⏳（以 EFFECTS_DESCRIPTOR.md 為對接基準；S3 auto-parse 由 JARVIS+Senku 共同） |
| M3 | Play mat 視覺對齊官方（CSS-only）+ deckbuilder 對接 | JARVIS | ✅ DONE 2026-08-27（mat tint/zone 名 v3.3 已對齊；deckbuilder 對接：v2 share code 直通 + sim `?deck=` 參數自動載入 + 「試玩對戰」按鈕，round-trip 實測） |
| M4 | Test deck + counter frame + verify + deploy | 共同 | ⏳ |

## 參考

- 官方規則 PDF：`/tmp/mhr_rules.pdf`（17 頁，簡中《超英击战》）
- 官方 mat 版面圖：media.clawling.chat/media/01M0317QW3YZV7EHNKNEF1DJ9R.png
- Deckbuilder repo：/opt/data/marvel-hero-rush-deckbuilder（268 圖 + 34 RP 卡資料）
