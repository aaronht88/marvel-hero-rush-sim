// v3.18 smoke — 官方勝利條件（規則書 P8）
//
// P8 原文：「若我方滿足以下其中一個條件，則我方獲得遊戲勝利，此時遊戲結束。
//           ◆我方時間線存在 9 張衝擊卡。
//           ◆敵方卡組為 0 張。」
//
// 關鍵：第二個條件係「敵方卡組為 0」，唔係「抽唔到牌」。
// 所以無論係抽牌、prune top N、定係任何其他令 deck 變 0 嘅操作，
// 都要即刻觸發，唔可以只在 drawN 內部順手設 winner。
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = '/opt/data/mhr-battle-sim';
const ctx = { window: {}, console, setTimeout, clearTimeout };
ctx.global = ctx.window;
vm.createContext(ctx);
function load(f) { vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f }); }
load('js/cards.js'); load('js/mhr-decks.js'); load('js/data.js'); load('js/effects-data.js');
load('js/engine.js'); load('js/effects.js'); load('js/ai.js');
const E = ctx.window.MHR_ENGINE;
let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}`, extra === undefined ? '' : extra); fail++; }
}

// ---------- TEST 1: 時間線 9 張 → 贏 ----------
console.log('\n[TEST 1] P8 條件1：時間線 9 張衝擊卡');
const s1 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s1);
s1.players.P.timeline = Array.from({ length: 9 }, (_, i) => ({ _uid: 'tl' + i }));
E.checkWin(s1);
check('P 時間線 9 張 → winner = P', s1.winner === 'P', s1.winner);
check('log 有官方措辭「時間線存在 9 張」', s1.log.some(l => l.msg.includes('時間線存在 9 張')));

const s1b = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s1b);
s1b.players.A.timeline = Array.from({ length: 9 }, (_, i) => ({ _uid: 'ta' + i }));
E.checkWin(s1b);
check('A 時間線 9 張 → winner = A', s1b.winner === 'A', s1b.winner);

// ---------- TEST 2: 敵方卡組為 0 → 我贏 ----------
console.log('\n[TEST 2] P8 條件2：敵方卡組為 0 張');
const s2 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s2);
s2.players.A.deck.length = 0;
E.checkWin(s2);
check('A 卡組 0 張 → winner = P（敵方卡組為0）', s2.winner === 'P', s2.winner);
check('log 有「AI 卡組為 0 張 → Player 獲勝」', s2.log.some(l => l.msg.includes('卡組為 0 張') && l.msg.includes('Player 獲勝')));

const s2b = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s2b);
s2b.players.P.deck.length = 0;
E.checkWin(s2b);
check('P 卡組 0 張 → winner = A', s2b.winner === 'A', s2b.winner);

// ---------- TEST 3: 抽最後一張 → 即刻觸發 ----------
console.log('\n[TEST 3] 抽出最後一張 → 即刻觸發（唔係「抽唔到」才觸發）');
const s3 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s3);
s3.players.A.deck = [s3.players.A.deck[0]];   // 剩 1 張
const aHandBefore = s3.players.A.hand.length;
E.drawN(s3, 'A', 2);                          // 要求抽 2，但只有 1
check('抽完最後一張 → deck = 0', s3.players.A.deck.length === 0, s3.players.A.deck.length);
check('P 即刻贏（敵方卡組為0）', s3.winner === 'P', s3.winner);
check('A 仍然抽到嗰 1 張（唔係抽 0 張）', s3.players.A.hand.length === aHandBefore + 1, s3.players.A.hand.length);

// ---------- TEST 4: 卡組本來就空，抽牌唔會 crash ----------
console.log('\n[TEST 4] 卡組本來就空 → 抽牌安全');
const s4 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s4);
s4.players.P.deck.length = 0;
let crashed = false;
try { E.drawN(s4, 'P', 1); } catch (e) { crashed = true; }
check('空卡組抽牌唔會 crash', !crashed);
check('空卡組 → winner = A', s4.winner === 'A', s4.winner);

// ---------- TEST 5: deck 因非抽牌原因歸零 → 一樣觸發 ----------
// 呢個係 v3.18 修嘅重點：舊 code 只在 drawN 內部設 winner，
// 所以 prune-top-of-deck 之類令 deck 變 0 完全唔會觸發勝利。
console.log('\n[TEST 5] 非抽牌原因令 deck 歸零 → checkWin 一樣捉到');
const s5 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s5);
s5.players.A.deck.length = 3;
s5.players.A.deck.splice(0, 3);     // 模擬 prune top 3，冇經 drawN
check('splice 之後 deck = 0', s5.players.A.deck.length === 0);
check('未呼叫 checkWin 時 winner 仍然 null', s5.winner === null, s5.winner);
E.checkWin(s5);
check('呼叫 checkWin 後 → winner = P', s5.winner === 'P', s5.winner);

// ---------- TEST 6: 唔會覆寫已有 winner ----------
console.log('\n[TEST 6] 已有 winner 唔會被覆寫');
const s6 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s6);
s6.winner = 'P';
s6.players.A.deck.length = 0;   // A 卡組空，本應 P 贏（已經係 P）
const logLen = s6.log.length;
E.checkWin(s6);
check('winner 保持 P', s6.winner === 'P', s6.winner);
check('唔會重複 log 勝利訊息', s6.log.length === logLen, `${logLen} → ${s6.log.length}`);

// ---------- TEST 7: 完整對局仍然正常結束 ----------
console.log('\n[TEST 7] 8 局全自動對戰仍然正常結束');
const AI = ctx.window.MHR_AI;
let complete = 0, crashes = 0;
for (let g = 0; g < 8; g++) {
  E.setSeed(5000 + g);
  const decks = ['RED_Aggro', 'YELLOW_Machine', 'BLUE_Control', 'GREEN_Tempo'];
  const s = E.initGame(decks[g % 4], decks[(g + 1) % 4]);
  E.mulligan(s, 'P', []); E.mulligan(s, 'A', AI.aiMulligan(s));
  E.startTurn(s);
  try {
    let t = 0;
    while (!s.winner && t < 80) { AI.aiTurnFor(s, s.activeSide); t++; }
    if (s.winner) complete++;
  } catch (e) { crashes++; console.log('    crash:', e.message); }
}
E.setSeed(null);
check('8 局全部有 winner', complete === 8, `${complete}/8`);
check('零 crash', crashes === 0, crashes);

// ---------- TEST 8: 兩個條件都唔滿足 → 遊戲繼續 ----------
console.log('\n[TEST 8] 兩個條件都唔滿足 → 遊戲繼續');
const s8 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s8);
E.checkWin(s8);
check('winner 仍然 null', s8.winner === null, s8.winner);
check('雙方 deck 都 > 0', s8.players.P.deck.length > 0 && s8.players.A.deck.length > 0);

// ---------- TEST 9: 蓋卡當回合可作 Lv1 cost（P14 名詞 3）----------
// 原文：「若玩家進行Lv4或以上角色的號召，則該玩家可以撤退1張或以上蓋卡來
// 滿足該角色的所有或部分號召需求，此時每張蓋卡作為1張Lv1的卡牌。」
// 冇任何時機限制 → 當回合蓋放即刻可以用。
console.log('\n[TEST 9] 蓋卡當回合已可作 Lv1 cost（P14 名詞 3）');
const s9 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s9);
// 開局手牌隨機 — 直接注入一張 Lv4 卡，唔好靠抽
const lv4Src = ctx.window.MHR_DATA.CARDS.find(c => (c.level || 0) === 4 && !c._faceDown);
check('cards.js 有 Lv4 卡', !!lv4Src);
if (lv4Src) {
  const lv4 = Object.assign({}, lv4Src, { _uid: 'lv4test' });
  E.injectEffects(lv4);
  s9.players.P.hand.push(lv4);
  // 建立 4 張「本回合蓋放」嘅蓋卡
  for (let i = 0; i < 4; i++) {
    const src = s9.players.P.deck.pop();
    s9.players.P.base.faceDown.push(Object.assign({}, src, {
      _faceDown: true, _origUid: src._uid, _uid: 'fd' + i,
    }));
  }
  const fd = s9.players.P.base.faceDown.filter(c => c._faceDown);
  const i9 = s9.players.P.hand.indexOf(lv4);
  const r9 = E.callCard(s9, 'P', i9, fd.slice(0, 4).map(c => c._uid));
  check('4 張當回合蓋卡可付 Lv4 號召成本', r9.ok, r9.err);
}

// ---------- TEST 10: 蓋卡 Lv1 唔受「幾時蓋」影響 ----------
console.log('\n[TEST 10] 蓋卡計價一律 Lv1（不論原卡 Lv）');
const s10 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s10);
const hi = s10.players.P.deck.find(c => (c.level || 0) >= 5);
if (hi) {
  const set = Object.assign({}, hi, { _faceDown: true, _origUid: hi._uid, _uid: 'fdhi' });
  s10.players.P.base.faceDown.push(set);
  // 用 cardEffectiveLv 檢查：蓋卡應該係 1，唔係原卡 Lv
  const effective = E.cardEffectiveLv(set);
  check(`原 Lv${hi.level} 嘅蓋卡計作 Lv1`, effective === 1, effective);
} else {
  check('跳過（deck 冇 Lv5+）', true);
}

console.log(`\n========== ${pass} pass, ${fail} fail ==========`);
process.exit(fail ? 1 : 0);