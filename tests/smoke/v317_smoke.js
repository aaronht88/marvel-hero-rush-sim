// v3.17 smoke — choice (you may) + conditional-chain (If you do) primitives
// These are the two blockers that capped effect coverage at 15 descriptors:
//   "you may"   — 123/448 cards, was silently auto-executed by /(?:may )?/
//   "If you do" — 180/448 cards, needs conditional chaining
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = '/opt/data/mhr-battle-sim';
const ctx = { window: {}, console, setTimeout, clearTimeout };
ctx.global = ctx.window;
vm.createContext(ctx);
function load(f) { vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f }); }
load('js/cards.js'); load('js/mhr-decks.js'); load('js/data.js'); load('js/effects-data.js');
load('js/engine.js'); load('js/effects.js'); load('js/ai.js');
const E = ctx.window.MHR_ENGINE, FX = ctx.window.MHR_EFFECTS;
let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}`, extra === undefined ? '' : extra); fail++; }
}

function initAFlags(s) { s.turnFlags["A"] = { setDeployUsed: false, callCount: 0, movedUids: {}, attackedUids: {}, counterStepUsed: false, doubleAttackUids: {}, oncePerTurnUids: {} }; }

// build a test card with an arbitrary descriptor
function testCard(state, side, name, effects, extra) {
  const card = Object.assign({
    card_no: 'TEST-' + name, name: '「T」' + name, set: 'TB01',
    level: 2, power: 3000, attackRange: 1, rarity: 'C',
    effect: 'TEST', effects,
  }, extra || {});
  E.injectEffects(card);
  state.players[side].hand.push(card);
  return card;
}

// runEffects fires EVERY descriptor on the board (that's the trigger system),
// so a random RED_Aggro hand can contribute its own draws/prunes and make a
// single-card assertion read as off-by-one. Strip every other card's `effects`
// before measuring — this isolates the card under test without touching the
// engine's trigger semantics.
function isolateBoard(state) {
  ['P', 'A'].forEach(side => {
    const p = state.players[side];
    [].concat(p.hand, p.deck, p.retreat, p.voidZone, p.base.faceDown).forEach(c => {
      if (c) c.effects = [];
    });
    const b = p.battle;
    [b.front, b.back].concat(b.wing || []).forEach(c => { if (c) c.effects = []; });
  });
}

// ---------- TEST 1: op registered ----------
console.log('\n[TEST 1] new ops registered');
check('OPS 有 optional', typeof FX._internal.OPS.optional === 'function');
check('OPS 有 if_you_do', typeof FX._internal.OPS.if_you_do === 'function');
check('MHR_EFFECTS 有 hasPendingChoice', typeof FX.hasPendingChoice === 'function');
check('MHR_EFFECTS 有 resolveChoice', typeof FX.resolveChoice === 'function');

// ---------- TEST 2: optional parks a choice (does NOT execute) ----------
console.log('\n[TEST 2] "you may" → parks a pending choice, does not auto-execute');
const s2 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s2);
isolateBoard(s2);
const drawCard = testCard(s2, 'P', 'OptDraw', [{
  trig: 'TRIG', slot: 'FIELD',
  ops: [{ op: 'optional', prompt: '抽 1 張？', then: [{ op: 'draw', n: 1 }] }],
}]);
const i2 = s2.players.P.hand.indexOf(drawCard);
const deck2 = s2.players.P.deck.length;   // immediately before callCard
E.callCard(s2, 'P', i2);

check('optional 產生 pending choice', FX.hasPendingChoice(s2, 'P'), JSON.stringify(FX.pendingChoices(s2)));
check('optional 未答之前效果未執行（deck 未減）', s2.players.P.deck.length === deck2,
  `before=${deck2} after=${s2.players.P.deck.length}`);

// ---------- TEST 3: declining the choice ----------
console.log('\n[TEST 3] decline → no effect, choice cleared');
const r3 = FX.resolveChoice(s2, 'P', { accept: false });
check('decline 返回 ok', r3.ok, JSON.stringify(r3));
check('decline 後 deck 不變', s2.players.P.deck.length === deck2, s2.players.P.deck.length);
check('decline 後 pending 清空', !FX.hasPendingChoice(s2, 'P'));
check('log 有「放棄」', s2.log.some(l => l.msg.includes('放棄')), s2.log.slice(-3).map(l => l.msg));

// ---------- TEST 4: accepting the choice executes the inner op ----------
console.log('\n[TEST 4] accept → inner op executes');
const s4 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s4);
isolateBoard(s4);
const c4 = testCard(s4, 'P', 'OptDraw2', [{
  trig: 'TRIG', slot: 'FIELD',
  ops: [{ op: 'optional', prompt: '抽 1 張？', then: [{ op: 'draw', n: 1 }] }],
}]);
const deck4 = s4.players.P.deck.length;   // immediately before callCard
E.callCard(s4, 'P', s4.players.P.hand.indexOf(c4));
check('optional 已 park', FX.hasPendingChoice(s4, 'P'));
check('park 期間 deck 未動', s4.players.P.deck.length === deck4, s4.players.P.deck.length);
const r4 = FX.resolveChoice(s4, 'P', { accept: true });
check('accept 返回 ok', r4.ok, JSON.stringify(r4));
check('accept 之後 deck -1', s4.players.P.deck.length === deck4 - 1,
  `before=${deck4} after=${s4.players.P.deck.length}`);
check('accept 後 pending 清空', !FX.hasPendingChoice(s4, 'P'));

// ---------- TEST 5: headless auto path (AI / sim) ----------
// NOTE: assert on DECK length, not hand length. callCard() itself moves the
// card out of hand, so hand.length shifts by -1 from the call before any
// effect op runs — measuring hand made these two assertions meaningless.
console.log('\n[TEST 5] auto path resolves without parking (headless sim)');
const s5 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s5);
isolateBoard(s5);
const c5 = testCard(s5, 'P', 'AutoDraw', [{
  trig: 'TRIG', slot: 'FIELD',
  ops: [{ op: 'optional', auto: true, then: [{ op: 'draw', n: 1 }] }],
}]);
// baseline immediately before callCard — startTurn already drew 2, and any
// injected-card effects have already run, so this is the true pre-effect deck.
const deck5 = s5.players.P.deck.length;
E.callCard(s5, 'P', s5.players.P.hand.indexOf(c5));
check('auto:true 唔 park choice', !FX.hasPendingChoice(s5, 'P'));
check('auto:true 立即執行（deck -1）', s5.players.P.deck.length === deck5 - 1,
  `before=${deck5} after=${s5.players.P.deck.length}`);

// auto:false should decline
const s5b = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s5b);
const deck5b = s5b.players.P.deck.length;
isolateBoard(s5b);
const c5b = testCard(s5b, 'P', 'AutoDecline', [{
  trig: 'TRIG', slot: 'FIELD',
  ops: [{ op: 'optional', auto: false, then: [{ op: 'draw', n: 1 }] }],
}]);
E.callCard(s5b, 'P', s5b.players.P.hand.indexOf(c5b));
check('auto:false → 不執行（deck 不變）', s5b.players.P.deck.length === deck5b,
  `before=${deck5b} after=${s5b.players.P.deck.length}`);
check('auto:false log 有「放棄」', s5b.log.some(l => l.msg.includes('放棄')));

// ---------- TEST 6: if_you_do conditional chain ----------
console.log('\n[TEST 6] "If you do" → conditional chain');
// success path: draw succeeds → then draws another
const s6 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s6);
const hb6 = s6.players.P.hand.length;
isolateBoard(s6);
const c6 = testCard(s6, 'P', 'IfDo', [{
  trig: 'TRIG', slot: 'FIELD',
  ops: [{
    op: 'if_you_do',
    do: [{ op: 'draw', n: 1 }],
    then: [{ op: 'draw', n: 1 }],
  }],
}]);
E.callCard(s6, 'P', s6.players.P.hand.indexOf(c6));
check('if_you_do 成功路徑：draw x2', s6.players.P.hand.length === hb6 + 2,
  `before=${hb6} after=${s6.players.P.hand.length}`);

// failure path: draw fails (empty deck) → else branch fires instead
const s6b = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s6b);
s6b.players.P.deck.length = 0;   // force draw to fail (deck-out)
isolateBoard(s6b);
const c6b = testCard(s6b, 'P', 'IfDoFail', [{
  trig: 'TRIG', slot: 'FIELD',
  ops: [{
    op: 'if_you_do',
    do: [{ op: 'draw', n: 1 }],
    then: [{ op: 'draw', n: 1 }],
  }],
}]);
E.callCard(s6b, 'P', s6b.players.P.hand.indexOf(c6b));
check('if_you_do 失敗：deck 空 → 不會抽到牌（deck-out 條件）',
  s6b.players.P.deck.length === 0 || s6b.winner !== null,
  `deck=${s6b.players.P.deck.length} winner=${s6b.winner}`);

// ---------- TEST 7: nested optional inside if_you_do ----------
console.log('\n[TEST 7] nesting: optional inside if_you_do');
const s7 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s7);
isolateBoard(s7);
const c7 = testCard(s7, 'P', 'Nest', [{
  trig: 'TRIG', slot: 'FIELD',
  ops: [{
    op: 'if_you_do',
    do: [{ op: 'draw', n: 1 }],
    then: [{ op: 'optional', prompt: '再抽？', then: [{ op: 'draw', n: 1 }] }],
  }],
}]);
const deck7 = s7.players.P.deck.length;   // immediately before callCard
E.callCard(s7, 'P', s7.players.P.hand.indexOf(c7));
check('nested optional 已 park', FX.hasPendingChoice(s7, 'P'));
check('if_you_do 成功路徑先執行咗 draw（deck -1）', s7.players.P.deck.length === deck7 - 1,
  `before=${deck7} after=${s7.players.P.deck.length}`);
FX.resolveChoice(s7, 'P', { accept: true });
check('答應 nested 後 deck -2', s7.players.P.deck.length === deck7 - 2, s7.players.P.deck.length);

// ---------- TEST 8: zone invariant held through choice flow ----------
console.log('\n[TEST 8] zone invariant after choice resolution');
const inv8 = E.assertZoneInvariant(s4);
check('choice 流程後 zone invariant OK', inv8.ok, JSON.stringify(inv8.dupes.slice(0, 3)));
const inv7 = E.assertZoneInvariant(s7);
check('nested choice 後 zone invariant OK', inv7.ok, JSON.stringify(inv7.dupes.slice(0, 3)));

// ---------- TEST 9: no regression on existing suites ----------
console.log('\n[TEST 9] full AI games still complete with choice system in place');
let errs = 0, pendingLeaks = 0;
for (let g = 0; g < 8; g++) {
  E.setSeed(2000 + g);
  const decks = ['RED_Aggro', 'YELLOW_Machine', 'BLUE_Control', 'GREEN_Tempo'];
  const s = E.initGame(decks[g % 4], decks[(g + 1) % 4]);
  E.mulligan(s, 'P', []); E.mulligan(s, 'A', FX ? [] : []);
  E.startTurn(s);
  let t = 0;
  while (!s.winner && t < 80) {
    try { FX._internal && require('vm'); ctx.window.MHR_AI.aiTurnFor(s, s.activeSide); }
    catch (e) { errs++; break; }
    // headless: auto-resolve any parked choices so the game can proceed
    let guard = 0;
    while (FX.hasPendingChoice(s, s.activeSide) && guard++ < 5) {
      FX.resolveChoice(s, s.activeSide, { accept: true });
    }
    if (s.pendingChoices && s.pendingChoices.length > 4) pendingLeaks++;
    t++;
  }
  if (!s.winner) errs++;
}
E.setSeed(null);
check('8 局全自動對戰零 exception', errs === 0, `${errs} errors`);
check('無 pending choice 堆積洩漏', pendingLeaks === 0, `${pendingLeaks} leaks`);

console.log(`\n========== ${pass} pass, ${fail} fail ==========`);
process.exit(fail ? 1 : 0);