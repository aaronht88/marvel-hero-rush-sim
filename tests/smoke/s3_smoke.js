// S3 smoke test — effects-data.js generated descriptors + r_mod/lv_mod ops + AUTO refresh
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = '/opt/data/mhr-battle-sim';
const ctx = { window: {}, console, setTimeout, clearTimeout };
ctx.global = ctx.window;
vm.createContext(ctx);

function load(file) {
  const code = fs.readFileSync(path.join(REPO, file), 'utf8');
  vm.runInContext(code, ctx, { filename: file });
}
load('js/cards.js');
load('js/mhr-decks.js');
load('js/data.js');
load('js/effects-data.js');
load('js/engine.js');
load('js/effects.js');

const E = ctx.window.MHR_ENGINE;
const FX = ctx.window.MHR_EFFECTS;
let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}`, extra || ''); fail++; }
}

// 搵一副 deck 含有目標卡
function deckWith(cardNo) {
  const decks = Object.keys(ctx.window.MHR_DATA.DECKS);
  for (const d of decks) {
    if (ctx.window.MHR_DATA.DECKS[d].some(c => c.card_no === cardNo)) return d;
  }
  return null;
}
// 將目標卡由 deck 移入 P 手牌
function handIn(state, side, cardNo) {
  const p = state.players[side];
  let idx = p.hand.findIndex(c => c.card_no === cardNo);
  if (idx < 0) {
    const di = p.deck.findIndex(c => c.card_no === cardNo);
    if (di < 0) return -1;
    p.hand.push(p.deck.splice(di, 1)[0]);
    idx = p.hand.length - 1;
  }
  return idx;
}
function initAFlags(state) {
  state.turnFlags["A"] = { setDeployUsed: false, callCount: 0, movedUids: {}, attackedUids: {}, counterStepUsed: false, doubleAttackUids: {}, oncePerTurnUids: {} };
}

// ----- TEST 1: effects-data 載入 + 注入 -----
console.log('\n[TEST 1] effects-data + injection');
const data = ctx.window.MHR_EFFECTS_DATA || {};
check('MHR_EFFECTS_DATA 有 15 個 card_no', Object.keys(data).length === 15, Object.keys(data));
const s1 = E.initGame('RED_Aggro', 'YELLOW_Machine');
const expect = new Set(['BP01-011', ...Object.keys(data)]);
let checked = 0, injectedOk = true;
s1.players.P.deck.concat(s1.players.P.hand).forEach(c => {
  if (expect.has(c.card_no)) { checked++; if (!Array.isArray(c.effects)) injectedOk = false; }
});
check(`deck 內有 descriptor 嘅卡全部注入（檢查 ${checked} 張）`, checked > 0 && injectedOk);

// 直接由 MHR_DATA.CARDS 注入一張測試卡入 P 手牌（唔依賴預設 deck）
function injectTestCard(state, cardNo) {
  const def = ctx.window.MHR_DATA.CARDS.find(c => c.card_no === cardNo);
  if (!def) return -1;
  const card = Object.assign({}, def, { _uid: 't' + Math.random().toString(36).slice(2, 8) });
  const desc = ctx.window.MHR_EFFECTS_DATA[cardNo];
  if (desc) card.effects = desc;
  state.players.P.hand.push(card);
  return state.players.P.hand.length - 1;
}

// ----- TEST 2: TRIG【FIELD】by calling → opp front Power-1000 -----
console.log('\n[TEST 2] TRIG:FIELD by_calling power_mod');
const s2 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s2);
const idx2 = injectTestCard(s2, 'BP01-060');
check('注入 BP01-060', idx2 >= 0);
if (idx2 >= 0) {
  // A 先放一張卡落 front，令 power_mod 有目標
  s2.turnFlags["A"] = { setDeployUsed: false, callCount: 0, movedUids: {}, attackedUids: {}, counterStepUsed: false, doubleAttackUids: {}, oncePerTurnUids: {} };
  const dA = s2.players.A.deck.find(c => (c.level || 0) <= 3);
  if (dA) {
    s2.players.A.hand.push(dA);
    s2.players.A.deck.splice(s2.players.A.deck.indexOf(dA), 1);
    E.callCard(s2, "A", s2.players.A.hand.length - 1);
  }
  // NOTE (card-game skill pitfall: assertion isolation — same bug as m4 TEST 1):
  // A's front card may carry its OWN enter-effect _powerMod (observed 500 and
  // 1500), so an ABSOLUTE === -1000 assertion fails ~3/20 runs. Capture the
  // baseline and assert the DELTA produced by BP01-060.
  const af = s2.players.A.battle.front;
  const afBefore = (af && af._powerMod) || 0;
  const r = E.callCard(s2, "P", idx2);
  check('call 成功', r.ok === true, r);
  const log2 = s2.log.slice(-8).map(e => e.msg);
  check('[DSL] log 出現', log2.some(m => m.includes('[DSL]')));
  const afAfter = s2.players.A.battle.front;
  const afDelta = ((afAfter && afAfter._powerMod) || 0) - afBefore;
  check(`對手 front ${afAfter ? afAfter.card_no : '?'} _powerMod delta -1000`,
    afDelta === -1000, `delta=${afDelta} before=${afBefore} after=${afAfter && afAfter._powerMod}`);
}

// ----- TEST 3: AUTO【FRONT】Power+1000 phase_change 重算 + 防累積 -----
console.log('\n[TEST 3] AUTO phase_change + no accumulation');
const s3 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s3);
const idx3 = injectTestCard(s3, 'BP01-071');
check('注入 BP01-071', idx3 >= 0);
if (idx3 >= 0) {
  // Lv5 卡 call 要 retreat cost — 直接放上 FRONT 模擬已喺場，測 AUTO refresh
  const card = s3.players.P.hand.splice(idx3, 1)[0];
  s3.players.P.battle.front = card;
  check('卡喺 FRONT', s3.players.P.battle.front === card);
  FX.runEffects(s3, 'P', { kind: 'phase_change' });
  const after1 = card._powerMod;
  FX.runEffects(s3, 'P', { kind: 'phase_change' });
  const after2 = card._powerMod;
  check(`AUTO Power+1000 生效（${after1}）`, after1 === 1000, after1);
  check(`二次 refresh 冇累積（${after2}）`, after2 === 1000, after2);
}

// ----- TEST 4: BP01-004 Hulk AUTO【FIELD】all-red → Lv+X / Power+X000 -----
console.log('\n[TEST 4] Hulk AUTO:FIELD var mods');
if (deckWith('BP01-004')) {
  const s4 = E.initGame(deckWith('BP01-004'), 'YELLOW_Machine');
  E.startTurn(s4);
  const idx = handIn(s4, 'P', 'BP01-004');
  E.callCard(s4, 'P', idx);
  initAFlags(s4);
  const dA = s4.players.A.deck.find(c => (c.level || 0) <= 3);
  if (dA) {
    s4.players.A.hand.push(dA);
    s4.players.A.deck.splice(s4.players.A.deck.indexOf(dA), 1);
    E.callCard(s4, 'A', s4.players.A.hand.length - 1);
  }
  FX.runEffects(s4, 'P', { kind: 'phase_change' });
  const hulk = s4.players.P.battle.front;
  check(`Hulk _lvMod +1（X=1）`, hulk && hulk._lvMod === 1, hulk && hulk._lvMod);
  check(`Hulk _powerMod +1000（X×1000）`, hulk && hulk._powerMod === 1000, hulk && hulk._powerMod);
} else {
  check('deck 有 Hulk BP01-004', false);
}

// ----- TEST 5: regression — 回合流程 + fallback 路徑 -----
console.log('\n[TEST 5] regression');
const s5 = E.initGame('RED_Aggro', 'YELLOW_Machine');
check('起局手牌 6', s5.players.P.hand.length === 6 && s5.players.A.hand.length === 6);
E.startTurn(s5);
check('回合抽 2 → 8', s5.players.P.hand.length === 8);
E.endTurn(s5);
check('endTurn 切邊 A', s5.activeSide === 'A');
E.endTurn(s5);
check('第二次 endTurn turn=2', s5.turn === 2);
const nonDesc = s5.players.P.hand.find(c => !Array.isArray(c.effects) && (c.level || 0) <= 3);
if (nonDesc) {
  const r = E.callCard(s5, "P", s5.players.P.hand.indexOf(nonDesc));
  check('無 descriptor 卡 call 正常（fallback）', r.ok === true, r);
} else {
  check('手牌有無 descriptor 低費卡', false);
}

// ----- TEST 6: BP01-006 Black Panther odd/even 雙分支 -----
console.log('\n[TEST 6] odd/even branch (BP01-006)');
const s6 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s6);
const idx6 = injectTestCard(s6, 'BP01-006');
check('注入 BP01-006', idx6 >= 0);
if (idx6 >= 0) {
  const card = s6.players.P.hand.splice(idx6, 1)[0];
  s6.players.P.battle.front = card;
  // 注入令 hand=9，splice 後 8（even）→ 再移除一張變 7（odd）
  const spare = s6.players.P.hand.pop();
  check('hand odd (7)', s6.players.P.hand.length === 7, s6.players.P.hand.length);
  FX.runEffects(s6, 'P', { kind: 'phase_change' });
  check(`odd → R+2（${card._rMod}）`, card._rMod === 2, card._rMod);
  // 變返 even：放返一張 → 8 → Power+5500
  s6.players.P.hand.push(spare);
  FX.runEffects(s6, 'P', { kind: 'phase_change' });
  check(`even → Power+5500（${card._powerMod}）`, card._powerMod === 5500, card._powerMod);
  check(`even → R 重置（${card._rMod}）`, card._rMod === 0, card._rMod);
}

// ----- TEST 7: BP01-056 opp_front_r_is cond -----
console.log('\n[TEST 7] opp_front_r_is cond (BP01-056)');
const s7 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s7);
const idx7 = injectTestCard(s7, 'BP01-056');
check('注入 BP01-056', idx7 >= 0);
if (idx7 >= 0) {
  const card = s7.players.P.hand.splice(idx7, 1)[0];
  s7.players.P.battle.front = card;
  // 對手 front R=1 → cond true（揀 Lv≤3 卡強制 R1，避免 flaky）
  s7.turnFlags["A"] = { setDeployUsed: false, callCount: 0, movedUids: {}, attackedUids: {}, counterStepUsed: false, doubleAttackUids: {}, oncePerTurnUids: {} };
  const dA = Object.assign({}, s7.players.A.deck.find(c => (c.level || 0) <= 3), { attackRange: '1' });
  s7.players.A.hand.push(dA);
  s7.players.A.deck.splice(s7.players.A.deck.indexOf(s7.players.A.deck.find(c => (c.level || 0) <= 3)), 1);
  E.callCard(s7, "A", s7.players.A.hand.length - 1);
  check('對手 front 有 R1 卡', s7.players.A.battle.front && (s7.players.A.battle.front.attackRange === '1' || s7.players.A.battle.front.attackRange === 1));
  FX.runEffects(s7, 'P', { kind: 'phase_change' });
  check(`cond true → Power+1500（${card._powerMod}）`, card._powerMod === 1500, card._powerMod);
}

// ----- TEST 8: cover_self op 存在 + SD02-005 descriptor -----
console.log('\n[TEST 8] cover_self op + SD02-005');
check('OPS 有 cover_self', !!FX._internal.OPS.cover_self);
const sd5 = data['SD02-005'];
check('SD02-005 有 descriptor', !!sd5 && Array.isArray(sd5));
if (sd5) {
  const ops = sd5.flatMap(b => b.ops || []).map(o => o.op);
  check('SD02-005 ops = discard+draw+cover_self', ops.includes('discard') && ops.includes('draw') && ops.includes('cover_self'), ops);
}

console.log(`\n========== ${pass} pass, ${fail} fail ==========`);
process.exit(fail === 0 ? 0 : 1);
