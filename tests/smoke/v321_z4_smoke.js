// v3.21 Z4 smoke — ACTI 起動效果 + UI choice 三模式
//
// ACTI 規則書依據 P15：「起動 區域/要求 若卡牌處於對應區域，則該卡牌控制方
// 在其回合行動階段可以起動的效果」
//
// 測 engine 側：collectActivatable / activateEffect（成本 atomic、once per turn、
// slot 檢查）。UI 側用 console 驗證 modal 三模式（node 冇 DOM，所以 UI 部分
// 只測 engine contract；DOM 由 browser 實測）。
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
function mk(uid, cardNo, over) {
  const base = D.CARDS.find(c => c.card_no === cardNo) || D.CARDS[0];
  return Object.assign({}, base, { _uid: uid }, over || {});
}

// ---------- TEST 1: API 存在 ----------
console.log('\n[TEST 1] Z4 API');
check('collectActivatable', typeof FX.collectActivatable === 'function');
check('activateEffect', typeof FX.activateEffect === 'function');

// ---------- TEST 2: collectActivatable 只搵 ACTI ----------
console.log('\n[TEST 2] collectActivatable 篩選');
const s2 = fresh();
const actiCard = mk('acti1', 'BP01-001', { level: 2 });
actiCard.effects = [{ trig: 'ACTI', slot: 'BATTLE', once: false, ops: [{ op: 'draw', n: 1 }] }];
const trigCard = mk('trig1', 'BP01-002', { level: 2 });
trigCard.effects = [{ trig: 'TRIG', slot: 'FIELD', ops: [{ op: 'draw', n: 1 }] }];
s2.players.P.battle.front = actiCard;
s2.players.P.battle.back = trigCard;
const list2 = FX.collectActivatable(s2, 'P');
check('搵到 1 個 ACTI', list2.length === 1, list2.length);
check('係 acti1', list2[0] && list2[0].card._uid === 'acti1');

// ---------- TEST 3: slot 唔對 → 唔會列出 ----------
console.log('\n[TEST 3] slot 檢查');
const s3 = fresh();
const wrongSlot = mk('ws', 'BP01-001', { level: 2 });
wrongSlot.effects = [{ trig: 'ACTI', slot: 'HAND', once: false, ops: [{ op: 'draw', n: 1 }] }];
s3.players.P.battle.front = wrongSlot;   // 喺 BATTLE，但效果要 HAND
const list3 = FX.collectActivatable(s3, 'P');
check('★ slot 唔對唔會列出', !list3.some(a => a.card._uid === 'ws'), list3.length);

// 放去 HAND 就應該搵到
s3.players.P.battle.front = null;
s3.players.P.hand.push(wrongSlot);
const list3b = FX.collectActivatable(s3, 'P');
check('★ 移去 HAND 後搵到', list3b.some(a => a.card._uid === 'ws'), list3b.map(a => a.card._uid));

// ---------- TEST 4: activateEffect 成功執行 ----------
console.log('\n[TEST 4] activateEffect 執行');
const s4 = fresh();
const drawCard = mk('dr4', 'BP01-001', { level: 2 });
drawCard.effects = [{ trig: 'ACTI', slot: 'BATTLE', once: false, ops: [{ op: 'draw', n: 2 }] }];
s4.players.P.battle.front = drawCard;
const deck4 = s4.players.P.deck.length;
const r4 = FX.activateEffect(s4, 'P', 'dr4', 0);
check('ok', r4.ok, r4.err);
check('★ 抽 2 張（deck -2）', s4.players.P.deck.length === deck4 - 2, `${deck4} → ${s4.players.P.deck.length}`);
check('log 有 [起動]', s4.log.some(m => m.msg.includes('[起動]')));

// ---------- TEST 5: once per turn ----------
console.log('\n[TEST 5] once per turn');
const s5 = fresh();
const onceCard = mk('on5', 'BP01-001', { level: 2 });
onceCard.effects = [{ trig: 'ACTI', slot: 'BATTLE', once: true, ops: [{ op: 'draw', n: 1 }] }];
s5.players.P.battle.front = onceCard;
const r5a = FX.activateEffect(s5, 'P', 'on5', 0);
check('第一次 ok', r5a.ok, r5a.err);
const r5b = FX.activateEffect(s5, 'P', 'on5', 0);
check('★ 第二次拒絕', !r5b.ok && /已用過/.test(r5b.err || ''), r5b.err);
check('collectActivatable 唔會再列出', !FX.collectActivatable(s5, 'P').some(a => a.card._uid === 'on5'));

// ---------- TEST 6: 成本失敗 → state 完全不變（Z1 atomic）----------
console.log('\n[TEST 6] 成本失敗 → state 完全不變');
const s6 = fresh();
const costCard = mk('co6', 'BP01-001', { level: 2 });
costCard.effects = [{
  trig: 'ACTI', slot: 'BATTLE', once: false,
  cost: [{ op: 'discard', n: 99 }],          // 手牌一定唔夠
  ops: [{ op: 'draw', n: 1 }],
}];
s6.players.P.battle.front = costCard;
const hand6 = s6.players.P.hand.length;
const deck6 = s6.players.P.deck.length;
const r6 = FX.activateEffect(s6, 'P', 'co6', 0);
check('拒絕', !r6.ok, r6.ok);
check('★ 手牌不變', s6.players.P.hand.length === hand6, s6.players.P.hand.length);
check('★ deck 不變（效果冇執行）', s6.players.P.deck.length === deck6, s6.players.P.deck.length);

// ---------- TEST 7: 蓋卡唔可以起動 ----------
console.log('\n[TEST 7] 蓋卡冇效果');
const s7 = fresh();
const setCard = mk('set7', 'BP01-001', { level: 5 });
setCard._faceDown = true;
setCard.effects = [{ trig: 'ACTI', slot: 'BATTLE', once: false, ops: [{ op: 'draw', n: 1 }] }];
s7.players.P.base.faceDown.push(setCard);
const r7 = FX.activateEffect(s7, 'P', 'set7', 0);
check('拒絕', !r7.ok, r7.ok);
check('err 講蓋卡', /蓋卡/.test(r7.err || ''), r7.err);

// ---------- TEST 8: V2 PB01-011 完整流程（ACTI + 成本 prune + 召回）----------
console.log('\n[TEST 8] ★ V2 PB01-011 完整 ACTI 流程');
const s8 = fresh();
const strange = mk('ds8', 'PB01-011', { level: 3 });
E.injectEffects(strange);
s8.players.P.voidZone.push(strange);        // 自己喺 VOID
const fuel = mk('fuel8', 'BP01-001', { level: 5 });
fuel.effects = [];
s8.players.P.retreat.push(fuel);            // Lv4+ 燃料喺 RETREAT
const list8 = FX.collectActivatable(s8, 'P');
check('V2 出現喺可起動清單', list8.some(a => a.card._uid === 'ds8'),
  list8.map(a => a.card._uid).join(','));
const r8 = FX.activateEffect(s8, 'P', 'ds8', 0);
check('ok', r8.ok, r8.err);
check('★ 燃料已入 VOID', s8.players.P.voidZone.some(c => c._uid === 'fuel8'));
check('★ 自己已召回場上', s8.players.P.battle.front && s8.players.P.battle.front._uid === 'ds8');
check('★ 已離開 VOID', !s8.players.P.voidZone.some(c => c._uid === 'ds8'));
check('zone invariant', E.assertZoneInvariant(s8).ok);

// ---------- TEST 9: V7 choose_one 經 UI contract 走通 ----------
console.log('\n[TEST 9] V7 choose_one engine contract');
const s9 = fresh();
const punk = mk('punk9', 'SP01-077', { level: 3 });
E.injectEffects(punk);
s9.players.P.hand.push(punk);
const web9 = mk('w9z', 'SP01-001', { level: 2, feature: 'Human/Web' });
web9.effects = [];
s9.players.P.retreat.push(web9);
// V7 係 COUNTER_ACTI；直接跑 ops 驗證 choose_one park
const eff9 = punk.effects[0];
const costRes9 = FX._internal.resolveCost(s9, 'P', eff9.cost, { source: punk });
check('成本（棄自己）ok', costRes9.ok, costRes9.err);
const opsRes9 = FX._internal.OPS.choose_one(s9, 'P', eff9.ops[0], { source: punk });
check('park choose_one', opsRes9.ok && opsRes9.pending);
const pend9 = FX.pendingChoices(s9)[0];
check('★ pending 有 options + isChooseOne', pend9 && pend9.isChooseOne && pend9.options.length === 2);
// 揀第一項（prune Web from RETREAT）
const rr9 = FX.resolveChoice(s9, 'P', { accept: true, optionIndex: 0 });
check('執行 ok', rr9.ok, rr9.err);
check('★ Web 卡由 RETREAT 入 VOID', s9.players.P.voidZone.some(c => c._uid === 'w9z'));

// ---------- TEST 10: pick_card options 帶 lv（UI 顯示用）----------
console.log('\n[TEST 10] pick_card options 有 UI 需要嘅資料');
const s10 = fresh();
const a10 = mk('pa', 'SP01-001', { level: 2, feature: 'Web' });
const b10 = mk('pb', 'SP01-002', { level: 4, feature: 'Web' });
a10.effects = []; b10.effects = [];
s10.players.P.voidZone.push(a10, b10);
FX._internal.OPS.zone_transfer(s10, 'P', {
  op: 'zone_transfer', subject: 'chosen', from: 'void', to: 'front',
  subjectFilter: { feature: 'Web' }, playerChooses: true,
}, {});
const p10 = FX.pendingChoices(s10)[0];
check('kind = pick_card', p10 && p10.kind === 'pick_card');
check('options 有 uid', p10.options.every(o => typeof o.uid === 'string'));
check('options 有 name', p10.options.every(o => typeof o.name === 'string'));

// ---------- TEST 11: 連續多個 pending 會逐個處理 ----------
console.log('\n[TEST 11] 多個 pending 逐個 resolve');
const s11 = fresh();
const c11 = mk('c11', 'BP01-001', { level: 2 });
c11.effects = [{
  trig: 'ACTI', slot: 'BATTLE', once: false,
  ops: [{ op: 'optional', prompt: 'a?', then: [{ op: 'draw', n: 1 }] }],
}];
s11.players.P.battle.front = c11;
FX.activateEffect(s11, 'P', 'c11', 0);
check('park 咗 1 個', FX.hasPendingChoice(s11, 'P'));
const r11 = FX.resolveChoice(s11, 'P', { accept: false });
check('resolve ok', r11.ok, r11.err);
check('清空', !FX.hasPendingChoice(s11, 'P'));

// ---------- TEST 12: 全自動對戰無 regression ----------
console.log('\n[TEST 12] 8 局全自動對戰');
const AI = ctx.window.MHR_AI;
let done = 0, err = 0;
for (let g = 0; g < 8; g++) {
  E.setSeed(9000 + g);
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