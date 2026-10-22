// v3.20 Z6 smoke — EVENT QUEUE (cascading triggers) + 7 VOID descriptors
//
// Z6 嘅核心問題：效果執行途中嘅 zone 變動本身會觸發其他效果。
//   V2 成本 = prune 自己一張 Lv4+ 卡（喺 RETREAT）
//   → 該卡進入 VOID → 應該觸發佢自己嘅 TRIG【VOID】
// 但唔可以喺 op 中途遞歸（會毀 Z1 atomic），所以排入 pendingEvents，
// 當前 runEffects 完成後統一 flush。
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = '/opt/data/mhr-battle-sim';
const ctx = { window: {}, console, setTimeout, clearTimeout };
ctx.global = ctx.window;
vm.createContext(ctx);
function load(f) { vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f }); }
load('js/cards.js'); load('js/mhr-decks.js'); load('js/data.js');
load('js/effects-data.js'); load('js/effects-data-void.js');
load('js/engine.js'); load('js/effects.js'); load('js/ai.js');
const E = ctx.window.MHR_ENGINE, FX = ctx.window.MHR_EFFECTS, D = ctx.window.MHR_DATA;
let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}`, extra === undefined ? '' : extra); fail++; }
}
function fresh() { const s = E.initGame('RED_Aggro', 'YELLOW_Machine'); E.startTurn(s); return s; }

// ---------- TEST 1: descriptors 已載入 ----------
console.log('\n[TEST 1] 7 張 VOID descriptor 載入');
const VNOS = ['BP01-007', 'PB01-011', 'SP01-021', 'SP01-031', 'SP01-035', 'SP01-066', 'SP01-077'];
VNOS.forEach(no => {
  const d = ctx.window.MHR_EFFECTS_DATA[no];
  check(`${no} 有 descriptor`, Array.isArray(d) && d.length > 0);
});
check('MHR_EFFECTS_DATA_VOID 存在', !!ctx.window.MHR_EFFECTS_DATA_VOID);

// ---------- TEST 2: injectEffects 會注入 ----------
console.log('\n[TEST 2] injectEffects 由 MHR_EFFECTS_DATA 注入');
const c1 = Object.assign({}, D.CARDS.find(c => c.card_no === 'BP01-007'), { _uid: 't1' });
E.injectEffects(c1);
check('BP01-007 注入後有 effects', Array.isArray(c1.effects) && c1.effects.length === 1);
check('trig = TRIG / slot = VOID', c1.effects[0].trig === 'TRIG' && c1.effects[0].slot === 'VOID',
  c1.effects[0].trig + '/' + c1.effects[0].slot);

// ---------- TEST 3: pendingEvents queue 基本運作 ----------
console.log('\n[TEST 3] event queue enqueue / flush');
const s3 = fresh();
s3.pendingEvents = [];
FX.notifyZoneChange(s3, 'P', { _uid: 'x', card_no: 'Z' }, 'field', 'void');
check('enqueue 後有 1 個 event', s3.pendingEvents.length === 1, s3.pendingEvents.length);
check('kind = enter_void', s3.pendingEvents[0].event.kind === 'enter_void');

// ---------- TEST 4: Z6 核心 — prune 觸發 TRIG【VOID】 ----------
// V2 場景：成本 prune 自己一張 Lv4+ 卡（喺 RETREAT）→ 該卡入 VOID
// → 若該卡有 TRIG【VOID】就應該 fire
console.log('\n[TEST 4] ★ Z6 核心：prune 令卡入 VOID → TRIG【VOID】觸發');
const s4 = fresh();
// 造一張有 TRIG【VOID】效果嘅卡，放喺 RETREAT
const voidTrigCard = Object.assign({}, D.CARDS.find(c => c.card_no === 'BP01-007'), {
  _uid: 'vt4', level: 5,
});
voidTrigCard.effects = [{
  trig: 'TRIG', slot: 'VOID', once: false,
  condText: ['test'],
  ops: [{ op: 'draw', n: 1 }],
}];
s4.players.P.retreat.push(voidTrigCard);
const hand4 = s4.players.P.hand.length;
// prune 佢（會令佢入 VOID）
E.pruneCard(s4, 'P', voidTrigCard);
check('卡已入 VOID', s4.players.P.voidZone.some(c => c._uid === 'vt4'));
check('event 已排入 queue', s4.pendingEvents && s4.pendingEvents.length > 0,
  s4.pendingEvents && s4.pendingEvents.length);
// flush
const n4 = FX.flushPendingEvents(s4, 'P');
check('flush 處理咗 event', n4 > 0, n4);
check('★ TRIG【VOID】效果真係 fire（手牌增加）', s4.players.P.hand.length > hand4,
  `${hand4} → ${s4.players.P.hand.length}`);

// ---------- TEST 5: 唔會無限連鎖 ----------
console.log('\n[TEST 5] 自我觸發唔會無限連鎖（depth guard）');
const s5 = fresh();
// 造一張「入 VOID 就再 prune 自己」嘅卡 → 理論上無限
const loopy = Object.assign({}, D.CARDS.find(c => c.card_no === 'SP01-001'), { _uid: 'loop5' });
loopy.effects = [{
  trig: 'TRIG', slot: 'VOID', once: false,
  ops: [{ op: 'zone_transfer', subject: 'self', from: 'void', to: 'retreat' },
        { op: 'prune', n: 1, target: 'my_retreat' }],
}];
s5.players.P.voidZone.push(loopy);
let crashed = false, logs = 0;
try {
  FX.notifyZoneChange(s5, 'P', loopy, 'field', 'void');
  FX.flushPendingEvents(s5, 'P');
  logs = s5.log.length;
} catch (e) { crashed = true; console.log('    crash:', e.message); }
check('唔會 crash', !crashed);
check('有 depth guard warning 或正常結束', logs > 0, logs);
check('★ pendingEvents 已清空（唔會殘留）', !s5.pendingEvents || s5.pendingEvents.length === 0,
  s5.pendingEvents && s5.pendingEvents.length);

// ---------- TEST 6: V2 完整流程（成本 prune → 召回自己）----------
console.log('\n[TEST 6] V2 PB01-011 完整：cost prune own → 召回自己');
const s6 = fresh();
const strange = Object.assign({}, D.CARDS.find(c => c.card_no === 'PB01-011'), { _uid: 'ds6', level: 3 });
E.injectEffects(strange);
check('PB01-011 有 descriptor', Array.isArray(strange.effects) && strange.effects.length > 0);
// 自己喺 VOID；撤退區放一張 Lv4+ 作成本
s6.players.P.voidZone.push(strange);
const fuel = Object.assign({}, D.CARDS.find(c => c.card_no === 'BP01-001'), { _uid: 'fuel6', level: 5 });
fuel.effects = [];
s6.players.P.retreat.push(fuel);
// 直接跑 descriptor 的 cost + ops（模擬 ACTI 起動）
const desc = strange.effects[0];
const RC = FX._internal.resolveCost;
const costRes = RC(s6, 'P', desc.cost, { source: strange });
check('成本 ok（有 Lv5 燃料）', costRes.ok, costRes.err);
check('燃料已入 VOID', s6.players.P.voidZone.some(c => c._uid === 'fuel6'));
const ztRes = FX._internal.OPS.zone_transfer(s6, 'P', desc.ops[0], { source: strange });
check('召回 ok', ztRes.ok, ztRes.err);
check('★ 自己已喺場上', s6.players.P.battle.front && s6.players.P.battle.front._uid === 'ds6');
check('★ 已離開 VOID', !s6.players.P.voidZone.some(c => c._uid === 'ds6'));

// ---------- TEST 7: V3 SP01-021 → BASE 變蓋卡 ----------
console.log('\n[TEST 7] V3 SP01-021 → BASE（蓋卡失去效果）');
const s7 = fresh();
const spidey = Object.assign({}, D.CARDS.find(c => c.card_no === 'SP01-021'), { _uid: 'sp7' });
E.injectEffects(spidey);
s7.players.P.voidZone.push(spidey);
const ops3 = spidey.effects[0].ops[0].then[0];
const r7 = FX._internal.OPS.zone_transfer(s7, 'P', ops3, { source: spidey });
check('ok', r7.ok, r7.err);
check('★ 入 BASE', s7.players.P.base.faceDown.some(c => c._uid === 'sp7'));
check('★ _faceDown = true', spidey._faceDown === true);
check('★ 計 Lv1', E.cardEffectiveLv(spidey) === 1);

// ---------- TEST 8: V7 choose_one 描述正確 ----------
console.log('\n[TEST 8] V7 SP01-077 choose_one 結構');
const punk = ctx.window.MHR_EFFECTS_DATA['SP01-077'][0];
check('trig = COUNTER_ACTI / slot = HAND', punk.trig === 'COUNTER_ACTI' && punk.slot === 'HAND');
check('cost = discard self', punk.cost && punk.cost[0].op === 'discard' && punk.cost[0].self === true);
check('op = choose_one', punk.ops[0].op === 'choose_one');
check('★ 有 2 個 options（or）', punk.ops[0].options.length === 2, punk.ops[0].options.length);
check('option[0] = prune，option[1] = zone_transfer',
  punk.ops[0].options[0].op === 'prune' && punk.ops[0].options[1].op === 'zone_transfer');

// ---------- TEST 9: 7 張卡全部可以 injectEffects 而唔會 crash ----------
console.log('\n[TEST 9] 7 張卡注入唔會 crash');
let crashed9 = 0;
VNOS.forEach(no => {
  try {
    const c = Object.assign({}, D.CARDS.find(x => x.card_no === no), { _uid: 'i' + no });
    E.injectEffects(c);
    if (!Array.isArray(c.effects) || !c.effects.length) crashed9++;
  } catch (e) { crashed9++; console.log(`    ${no} crash:`, e.message); }
});
check('7 張全部注入成功', crashed9 === 0, crashed9);

// ---------- TEST 10: zone invariant 全程成立 ----------
console.log('\n[TEST 10] zone invariant');
[s4, s6, s7].forEach((s, i) => {
  const inv = E.assertZoneInvariant(s);
  check(`state${i} zone invariant OK`, inv.ok, JSON.stringify(inv.dupes.slice(0, 2)));
});

// ---------- TEST 11: 完整對局仍然正常（無 regression）----------
console.log('\n[TEST 11] 8 局全自動對戰仍然完成');
const AI = ctx.window.MHR_AI;
let done = 0, err = 0;
for (let g = 0; g < 8; g++) {
  E.setSeed(7000 + g);
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
check('8 局全部完成', done === 8, `${done}/8`);
check('零 crash', err === 0, err);

console.log(`\n========== ${pass} pass, ${fail} fail ==========`);
process.exit(fail ? 1 : 0);