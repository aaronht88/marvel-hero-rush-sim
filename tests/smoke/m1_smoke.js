// M1 smoke test — load engine.js + effects.js with a minimal `window` shim
// and verify BP01-011 Thor (Lv3, RED_Aggro deck) actually triggers:
//   1) draw 1
//   2) +1 second-chance attack flag
//   3) regress existing flow (draw 6, draw 2, call, attack, +1 RP, win)

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
load('js/engine.js');
load('js/effects.js');

const E = ctx.window.MHR_ENGINE;
const FX = ctx.window.MHR_EFFECTS;

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else    { console.log(`  ✗ ${name}`, extra || ''); fail++; }
}

// ----- TEST 1: Thor descriptor 注入 + DSL 觸發 -----
console.log('\n[TEST 1] BP01-011 Thor — DSL path');
const state = E.initGame('RED_Aggro', 'RED_Aggro');
E.startTurn(state);

// 確保 Thor 入 hand（inject from deck if not already）
let thorIdx = state.players.P.hand.findIndex(c => c.card_no === 'BP01-011');
if (thorIdx < 0) {
  // 從 deck 揾 Thor 嚟 inject（單 Thor instance 避免 multi-descriptor 重複）
  const deckIdx = state.players.P.deck.findIndex(c => c.card_no === 'BP01-011');
  if (deckIdx >= 0) {
    const t = state.players.P.deck.splice(deckIdx, 1)[0];
    state.players.P.hand.push(t);
    thorIdx = state.players.P.hand.length - 1;
  }
}
check('Thor 喺手牌（1 instance）', thorIdx >= 0);
if (thorIdx < 0) process.exit(1);

// runEffects fires EVERY descriptor on the board, not just the called card. A
// randomly-dealt RED_Aggro hand can therefore contribute its own draws and make
// a single-card hand-count assertion read as off-by-one (~1/12 runs). Strip the
// other cards' effects first so this test isolates Thor. (Same technique as
// tests/smoke/v317_smoke.js isolateBoard.)
function isolateBoard(st, keepUid) {
  ['P', 'A'].forEach(side => {
    const p = st.players[side];
    [].concat(p.hand, p.deck, p.retreat, p.voidZone, p.base.faceDown).forEach(c => {
      if (c && c._uid !== keepUid) c.effects = [];
    });
    const b = p.battle;
    [b.front, b.back].concat(b.wing || []).forEach(c => {
      if (c && c._uid !== keepUid) c.effects = [];
    });
  });
}

const handBefore = state.players.P.hand.length;
const deckBefore = state.players.P.deck.length;
const thorInst = state.players.P.hand[thorIdx];
isolateBoard(state, thorInst && thorInst._uid);   // 只留 Thor 自己嘅 descriptor
const r = E.callCard(state, 'P', thorIdx);
check('call Thor 成功', r.ok === true, r);

const logAfter = state.log.slice(-10).map(e => e.msg);
const hasDslLog = logAfter.some(m => m.includes('[DSL]'));
const hasDrawLog = logAfter.some(m => m.includes('[效果]') && m.includes('抽 1'));
const hasBonusLog = logAfter.some(m => m.includes('可攻擊 2 次'));
check('[DSL] log 觸發', hasDslLog);
check('[效果] 抽 1 log', hasDrawLog);
check('可攻擊 2 次 log', hasBonusLog);

// draw 純增量：call splice Thor = hand -1；draw 1 = hand +1 → net 0
// 但 deck 必須 -1
const handAfter = state.players.P.hand.length;
const deckAfter = state.players.P.deck.length;
check(`手牌淨 0（call -1 + draw +1 = 0，${handBefore} → ${handAfter}）`, handAfter === handBefore);
check(`deck -1（${deckBefore} → ${deckAfter}）`, deckAfter === deckBefore - 1);

const thorOnField = state.players.P.battle.front;
const bonusFlag = state.turnFlags.P.doubleAttackUids[thorOnField && thorOnField._uid];
check('doubleAttackUids flag set on Thor uid', !!bonusFlag);

// 確認 effect descriptor 確實 inject 入 card object
check('Thor.effects 已 inject', Array.isArray(thorOnField && thorOnField.effects));
check('Thor.effects[0].ops.length === 2', thorOnField && thorOnField.effects[0].ops.length === 2);

// ----- TEST 2: regression — 起局抽 6、回合抽 2 -----
console.log('\n[TEST 2] regression — init + draw');
const s2 = E.initGame('RED_Aggro', 'YELLOW_Machine');
check('起局 P.hand === 6', s2.players.P.hand.length === 6);
check('起局 A.hand === 6', s2.players.A.hand.length === 6);
E.startTurn(s2);
check('回合抽 2，P.hand === 8', s2.players.P.hand.length === 8);

// ----- TEST 3: call Lv 3 直接放場上 -----
console.log('\n[TEST 3] Lv 3 call 不需 retreat');
const s3 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s3);
const idx = s3.players.P.hand.findIndex(c => c.level && c.level <= 3);
check('手牌有 Lv≤3 卡', idx >= 0);
if (idx >= 0) {
  const r3 = E.callCard(s3, 'P', idx);
  check('Lv 3 call 成功無 retreat', r3.ok === true);
  check('場上 front 有人', s3.players.P.battle.front != null);
}

// ----- TEST 4: Lv 4+ call 需要 retreat cost -----
console.log('\n[TEST 4] Lv 4+ call needs retreat');
const s4 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s4);
// 注入 Lv 4 卡到 P 手牌（Iron Man BP01-001 = Lv 6）
const iron = { ...s4.players.P.deck[0] };
iron.level = 6; iron.card_no = 'TEST-LV6'; iron.effects = undefined;
s4.players.P.hand.push(iron);
const hi = s4.players.P.hand.length - 1;
const r4 = E.callCard(s4, 'P', hi, []); // 唔指定 retreat → sumLv=0 !== 6
check('Lv6 call 冇 retreat 失敗', r4.ok === false);
check('錯誤訊息包含 "號召 Lv6"', (r4.err || '').includes('Lv6'));

// ----- TEST 5: 攻擊破綻 +1 RP -----
console.log('\n[TEST 5] attack weakness → +1 RP');
const s5 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s5);
// 直接 inject 一張 Lv 1 卡落 P.hand 同 call 去 front
const dummy = { ...s5.players.P.deck[0] };
dummy.level = 1; dummy.power = '1000'; dummy.attackRange = '3'; dummy.effects = undefined;
s5.players.P.hand.push(dummy);
const r5 = E.callCard(s5, 'P', s5.players.P.hand.length - 1);
check('inject card call 成功', r5.ok === true);
const rp0 = s5.players.P.rushPoints;
// 揀 R 內最遠 target：A 場上無卡 → 全部破綻
const targets = E.attackableTargets(s5, 'P', s5.players.P.battle.front._uid);
check('有 attackable targets', targets.length > 0);
const atk = E.attack(s5, 'P', s5.players.P.battle.front._uid, targets[0]);
check('attack 成功', atk.ok === true);
check('RP +1', s5.players.P.rushPoints === rp0 + 1);

// ----- TEST 6: endTurn 重置 doubleAttackUids（this_turn duration）-----
console.log('\n[TEST 6] endTurn resets per-turn flags');
// endTurn 邏輯：先切 activeSide；若 activeSide === 'P'，turn++
// 所以第一次 endTurn → activeSide=A，turn 仍 1；第二次 endTurn → P, turn=2
const turnBefore = s5.turn;
E.endTurn(s5); // P → A
check('activeSide=A', s5.activeSide === 'A');
check('第一次 endTurn turn 不變', s5.turn === turnBefore);
check('A.hand 起局 6 + 抽 2 = 8', s5.players.A.hand.length === 8);
const newFlags = s5.turnFlags.A;
check('A.flags init', !!newFlags);
check('A.doubleAttackUids 空（reset）', Object.keys(newFlags.doubleAttackUids).length === 0);
E.endTurn(s5); // A → P
check('第二次 endTurn turn++', s5.turn === turnBefore + 1);
check('activeSide=P', s5.activeSide === 'P');
const pFlags = s5.turnFlags.P;
check('P.flags reset', !!pFlags);
check('P.doubleAttackUids 空', Object.keys(pFlags.doubleAttackUids).length === 0);
check('P._powerMod reset on battle chars', E.battleChars(s5.players.P).every(({ card }) => (card._powerMod || 0) === 0));

// ----- TEST 7: NON-descriptor card 仍走舊 regex 路徑（BP01-009 Lv3 ACTI，冇 descriptor）-----
console.log('\n[TEST 7] non-descriptor → fallback to triggerEnter');
const s7 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s7);
// 揾 BP01-009 入 hand（M4 後 BP01-002 已有 descriptor，改用 BP01-009 測 fallback）
let widowIdx = s7.players.P.hand.findIndex(c => c.card_no === 'BP01-009');
if (widowIdx < 0) {
  const wdi = s7.players.P.deck.findIndex(c => c.card_no === 'BP01-009');
  if (wdi >= 0) {
    s7.players.P.hand.push(s7.players.P.deck.splice(wdi, 1)[0]);
    widowIdx = s7.players.P.hand.length - 1;
  }
}
if (widowIdx >= 0) {
  s7.turnFlags["A"] = s7.turnFlags["A"] || { setDeployUsed:false, callCount:0, movedUids:{}, attackedUids:{}, counterStepUsed:false, doubleAttackUids:{}, oncePerTurnUids:{} };
  const oppDummy = { ...s7.players.A.deck[0] };
  oppDummy.level = 2; oppDummy.power = '1000'; oppDummy.attackRange = '1'; oppDummy.effects = undefined;
  s7.players.A.hand.push(oppDummy);
  E.callCard(s7, 'A', s7.players.A.hand.length - 1);
  const r7 = E.callCard(s7, 'P', widowIdx);
  check('BP01-009 call 成功', r7.ok === true, r7);
  // BP01-009 is ACTI【BATTLE/ONCE PER TURN】 — a manually-activated effect, NOT
  // an enter-the-field trigger. callCard() routes non-descriptor cards to
  // triggerEnter(), whose patterns all require an enter-field style phrase, so
  // an ACTI card correctly produces NO effect log at call time. The original
  // assertion looked for such a log and therefore failed ~50% of runs depending
  // on what else happened to be in the log window.
  // What we actually want to prove here: (a) no descriptor exists, so the card
  // takes the legacy path at all, and (b) the ACTI text is not mistakenly fired
  // as an on-enter effect.
  const allLog = s7.log.map(e => e.msg);
  const noDsl = !allLog.some(m => m.includes('[DSL]'));
  check('BP01-009 冇 [DSL] log（走舊路徑）', noDsl);
  const wronglyFired = allLog.some(m => m.includes('[效果]') && m.includes('Pulse Assembler'));
  check('ACTI 效果唔會被當成入場觸發誤觸發', !wronglyFired);
  // m1 does not load effects-data.js, so assert via the card instance instead:
  // a descriptor-carrying card gets an `effects` array injected by injectEffects.
  const widCard = s7.players.P.battle
    ? [s7.players.P.battle.front, s7.players.P.battle.back].concat(s7.players.P.battle.wing || []).find(c => c && c.card_no === 'BP01-009')
    : null;
  check('BP01-009 仍然冇 descriptor（走 legacy 路徑）',
    !(widCard && Array.isArray(widCard.effects) && widCard.effects.length));
} else {
  check('BP01-009 喺手牌', false);
}

// ----- TEST 8: deck-out 即輸 -----
console.log('\n[TEST 8] deck-out 即輸');
const s8 = E.initGame('RED_Aggro', 'YELLOW_Machine');
s8.players.P.deck.length = 0;
s8.players.P.hand.length = 0;
E.drawN(s8, 'P', 1);
check('P.deck 0 → drawN 觸發 winner', s8.winner === 'A');

console.log(`\n========== ${pass} pass, ${fail} fail ==========`);
process.exit(fail === 0 ? 0 : 1);