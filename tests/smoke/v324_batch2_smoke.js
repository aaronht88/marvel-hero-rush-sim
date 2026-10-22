// v3.24 smoke — batch2（zone 移動 5 張）+ 虛擬 zone（field/battle）+ bug report 靜態檢查
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = '/opt/data/mhr-battle-sim';
const ctx = { window: {}, console, setTimeout, clearTimeout };
ctx.global = ctx.window;
vm.createContext(ctx);
function load(f) { vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f }); }
load('js/cards.js'); load('js/mhr-decks.js'); load('js/data.js');
load('js/effects-data.js'); load('js/effects-data-void.js');
load('js/effects-data-batch1.js'); load('js/effects-data-batch2.js');
load('js/engine.js'); load('js/effects.js'); load('js/ai.js');
const E = ctx.window.MHR_ENGINE, FX = ctx.window.MHR_EFFECTS, D = ctx.window.MHR_DATA;
let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}`, extra === undefined ? '' : extra); fail++; }
}
function fresh() { const s = E.initGame('RED_Aggro', 'YELLOW_Machine'); E.startTurn(s); return s; }
function mk(uid, no, over) {
  const b = D.CARDS.find(c => c.card_no === no) || D.CARDS[0];
  return Object.assign({}, b, { _uid: uid }, over || {});
}

const BATCH2 = ['BP01-016', 'EB01-010', 'BP01-103', 'SD03-005', 'SP01-056'];

// ---------- TEST 1: 5 張載入 + 注入 ----------
console.log('\n[TEST 1] batch2 載入');
let miss = 0;
BATCH2.forEach(no => {
  if (!Array.isArray(ctx.window.MHR_EFFECTS_DATA[no]) || !ctx.window.MHR_EFFECTS_DATA[no].length) {
    console.log(`    ${no} 冇 descriptor`); miss++;
  }
});
check('5 張全部有 descriptor', miss === 0, miss);
check('MHR_EFFECTS_DATA_BATCH2 存在', !!ctx.window.MHR_EFFECTS_DATA_BATCH2);

// ---------- TEST 2: 虛擬 zone 'field' 讀取 ----------
console.log('\n[TEST 2] 虛擬 zone field / battle');
const s2 = fresh();
const f2 = mk('f2', 'BP01-001'); f2.effects = [];
const w2 = mk('w2', 'BP01-002'); w2.effects = [];
const b2 = mk('b2', 'BP01-003'); b2.effects = [];
s2.players.P.battle.front = f2;
s2.players.P.battle.wing[0] = w2;
s2.players.P.battle.back = b2;
const ZT = FX._internal.OPS.zone_transfer;
// 用 subject:all from:'field' 一次過移三張去 RETREAT
const r2 = ZT(s2, 'P', { op: 'zone_transfer', subject: 'all', from: 'field', to: 'retreat' }, {});
check('from:field 讀到 3 張', r2.ok && r2.transferred.length === 3,
  r2.transferred && r2.transferred.length);
check('★ 三張都離開戰場', !s2.players.P.battle.front && !s2.players.P.battle.back
  && s2.players.P.battle.wing.every(c => !c));
check('★ 三張都喺 RETREAT', s2.players.P.retreat.length === 3, s2.players.P.retreat.length);

// ---------- TEST 3: to:'field' 自動揀空位 ----------
console.log('\n[TEST 3] to:field 自動揀空位');
const s3 = fresh();
const a3 = mk('a3', 'BP01-001'); a3.effects = [];
s3.players.P.retreat.push(a3);
const r3 = ZT(s3, 'P', { op: 'zone_transfer', subject: 'chosen', from: 'retreat', to: 'field' }, {});
check('ok', r3.ok, r3.err);
check('★ 入咗 FRONT（第一個空位）', s3.players.P.battle.front && s3.players.P.battle.front._uid === 'a3');

// ---------- TEST 4: to:'deck_bottom' ----------
console.log('\n[TEST 4] to:deck_bottom');
const s4 = fresh();
const d4 = mk('d4', 'BP01-001'); d4.effects = [];
s4.players.P.hand.push(d4);
const deck4 = s4.players.P.deck.length;
const bottomBefore = s4.players.P.deck[deck4 - 1] && s4.players.P.deck[deck4 - 1]._uid;
const r4 = ZT(s4, 'P', { op: 'zone_transfer', subject: 'chosen', from: 'hand', to: 'deck_bottom' }, { source: d4 });
check('ok', r4.ok, r4.err);
check('deck +1', s4.players.P.deck.length === deck4 + 1, s4.players.P.deck.length);
check('★ 卡喺 deck 最底', s4.players.P.deck[s4.players.P.deck.length - 1]._uid === 'd4',
  s4.players.P.deck[s4.players.P.deck.length - 1]._uid);

// deck_top
const s4b = fresh();
const t4 = mk('t4', 'BP01-001'); t4.effects = [];
s4b.players.P.hand.push(t4);
ZT(s4b, 'P', { op: 'zone_transfer', subject: 'chosen', from: 'hand', to: 'deck_top' }, { source: t4 });
check('★ deck_top 放最頂', s4b.players.P.deck[0]._uid === 't4', s4b.players.P.deck[0]._uid);

// ---------- TEST 5: BP01-103 對手 FRONT → 對手 BACK ----------
console.log('\n[TEST 5] BP01-103 對手 FRONT→BACK');
const s5 = fresh();
const of5 = mk('of5', 'BP01-001'); of5.effects = [];
s5.players.A.battle.front = of5;
const src5 = mk('s5', 'BP01-103'); E.injectEffects(src5);
s5.players.P.battle.front = src5;
const eff5 = src5.effects[0];
const inner5 = eff5.ops[0].then[0];
// 直接跑 inner op（cond 由引擎 event 判）
const r5 = FX._internal.OPS.zone_transfer(s5, 'P', { ...inner5, playerChooses: false }, { source: src5 });
check('ok', r5.ok, r5.err);
check('★ 對手卡已離開 FRONT', s5.players.A.battle.front === null);
check('★ 對手卡入咗 BACK', s5.players.A.battle.back && s5.players.A.battle.back._uid === 'of5');

// ---------- TEST 6: SD03-005 自己基地 → 手牌 ----------
console.log('\n[TEST 6] SD03-005 BASE→HAND');
const s6 = fresh();
const set6 = mk('set6', 'BP01-001', { _faceDown: true });
set6.effects = [];
s6.players.P.base.faceDown.push(set6);
const hand6 = s6.players.P.hand.length;
const inner6 = ctx.window.MHR_EFFECTS_DATA['SD03-005'][0].ops[0].then[0];
const r6 = FX._internal.OPS.zone_transfer(s6, 'P', { ...inner6, playerChooses: false }, {});
check('ok', r6.ok, r6.err);
check('★ 已離開 BASE', s6.players.P.base.faceDown.length === 0);
check('★ 入咗手牌', s6.players.P.hand.length === hand6 + 1, s6.players.P.hand.length);
check('★ 翻面（唔再係蓋卡）', s6.players.P.hand[s6.players.P.hand.length - 1]._faceDown === false,
  s6.players.P.hand[s6.players.P.hand.length - 1]._faceDown);

// ---------- TEST 7: SP01-056 對手基地 → 撤退區 ----------
console.log('\n[TEST 7] SP01-056 opp BASE→RETREAT');
const s7 = fresh();
const op7 = mk('op7', 'BP01-001', { _faceDown: true });
op7.effects = [];
s7.players.A.base.faceDown.push(op7);
const inner7 = ctx.window.MHR_EFFECTS_DATA['SP01-056'][0].ops[0];
const r7 = FX._internal.OPS.zone_transfer(s7, 'P', inner7, {});
check('ok', r7.ok, r7.err);
check('★ 對手 BASE 清空', s7.players.A.base.faceDown.length === 0);
check('★ 卡入對手 RETREAT', s7.players.A.retreat.some(c => c._uid === 'op7'));

// ---------- TEST 8: BP01-016 對手戰場 Lv3- → 對手基地 ----------
console.log('\n[TEST 8] BP01-016 opp field Lv<=3 → opp BASE');
const s8 = fresh();
const low8 = mk('low8', 'BP01-001', { level: 2 }); low8.effects = [];
const high8 = mk('high8', 'BP01-002', { level: 6 }); high8.effects = [];
s8.players.A.battle.front = low8;
s8.players.A.battle.back = high8;
const inner8 = ctx.window.MHR_EFFECTS_DATA['BP01-016'][0].ops[0].then[0];
const r8 = FX._internal.OPS.zone_transfer(s8, 'P', { ...inner8, playerChooses: false }, {});
check('ok', r8.ok, r8.err);
check('★ Lv2 卡已去對手基地', s8.players.A.base.faceDown.some(c => c._uid === 'low8'),
  s8.players.A.base.faceDown.map(c => c._uid));
check('★ Lv6 卡唔受影響', s8.players.A.battle.back && s8.players.A.battle.back._uid === 'high8');
check('★ 入基地變蓋卡', s8.players.A.base.faceDown.find(c => c._uid === 'low8')._faceDown === true);

// ---------- TEST 9: zone invariant ----------
console.log('\n[TEST 9] zone invariant');
[s2, s5, s6, s7, s8].forEach((s, i) => {
  const inv = E.assertZoneInvariant(s);
  check(`state${i} zone invariant OK`, inv.ok, JSON.stringify(inv.dupes.slice(0, 2)));
});

// ---------- TEST 10: bug report 靜態結構 ----------
console.log('\n[TEST 10] bug report UI 結構');
const appSrc = fs.readFileSync(path.join(REPO, 'js/app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
check('btn-bug 掣存在', /id="btn-bug"/.test(htmlSrc));
check('bug-modal 存在', /id="bug-modal"/.test(htmlSrc));
check('bug-desc textarea', /id="bug-desc"/.test(htmlSrc));
check('bug-copy / bug-save', /id="bug-copy"/.test(htmlSrc) && /id="bug-save"/.test(htmlSrc));
check('★ console.error hook', /origErr = console\.error/.test(appSrc));
check('★ window.onerror 捕捉', /addEventListener\("error"/.test(appSrc));
check('★ stateSnapshot 收集 zone', /function stateSnapshot\(\)/.test(appSrc) && /voidZone/.test(appSrc));
check('★ buildBugReport 含 log', /state\.log\.slice\(-80\)/.test(appSrc));
check('★ 版本自動偵測', /function gameVersion\(\)/.test(appSrc));
check('bug-modal body-level（唔喺 .screen 內）', (function () {
  // 可靠做法：搵冒 bug-modal 嘅 id 之前，最後一個 </section> 出現位置，
  // 同最後一個 <section class="screen"> 開位比對 —— 如果 close 位置 > open 位置
  // 而且 close 喺 bug-modal 之前，即係所有 screen 都已閉合。
  const idIdx = htmlSrc.indexOf('id="bug-modal"');
  if (idIdx < 0) return false;
  const before = htmlSrc.slice(0, idIdx);
  const lastScreenOpen = before.lastIndexOf('class="screen');
  const lastSectionClose = before.lastIndexOf('</section>');
  return lastSectionClose > lastScreenOpen;
})(), 'bug-modal 之前所有 .screen 應已閉合');

// ---------- TEST 11: 全自動對戰無 regression ----------
console.log('\n[TEST 11] 8 局全自動對戰');
const AI = ctx.window.MHR_AI;
let done = 0, err = 0;
for (let g = 0; g < 8; g++) {
  E.setSeed(13000 + g);
  const decks = ['RED_Aggro', 'YELLOW_Machine', 'BLUE_Control', 'GREEN_Tempo'];
  const s = E.initGame(decks[g % 4], decks[(g + 1) % 4]);
  E.mulligan(s, 'P', []); E.mulligan(s, 'A', AI.aiMulligan(s));
  E.startTurn(s);
  try {
    let t = 0;
    while (!s.winner && t < 80) { AI.aiTurnFor(s, s.activeSide); t++; }
    if (s.winner) done++;
  } catch (e) { err++; console.log('    crash:', e.message); }
}
E.setSeed(null);
check('8 局完成', done === 8, `${done}/8`);
check('零 crash', err === 0, err);

console.log(`\n========== ${pass} pass, ${fail} fail ==========`);
process.exit(fail ? 1 : 0);