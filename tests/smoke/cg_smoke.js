// v3.16 smoke — card-game skill integration
//   1. Seedable RNG (deterministic shuffle / replay)
//   2. Zone invariant assert by identity (duplicate-card_no safe)
//   3. Deck-out = lose (official rules, NO reshuffle)
//   4. Hand limit / discard-down
//   5. Zone invariant holds across a full AI-vs-AI batch
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = '/opt/data/mhr-battle-sim';
const ctx = { window: {}, console, setTimeout, clearTimeout };
ctx.global = ctx.window;
vm.createContext(ctx);
function load(f) { vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f }); }
load('js/cards.js'); load('js/mhr-decks.js'); load('js/data.js'); load('js/effects-data.js');
load('js/engine.js'); load('js/effects.js'); load('js/ai.js');

const E = ctx.window.MHR_ENGINE;
const AI = ctx.window.MHR_AI;
let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}`, extra === undefined ? '' : extra); fail++; }
}

// ----- TEST 1: seeded RNG determinism -----
console.log('\n[TEST 1] seeded RNG → deterministic shuffle');
// compare by card_no sequence, NOT _uid (module-level uid counter is monotonic
// and never resets, so _uid differs across every initGame by design)
function deckOrderWithSeed(seed) {
  E.setSeed(seed);
  const s = E.initGame('RED_Aggro', 'YELLOW_Machine');
  return s.players.P.deck.map(c => c.card_no).join(',');
}
const runA1 = deckOrderWithSeed(12345);
const runA2 = deckOrderWithSeed(12345);
check('同一 seed 兩次 initGame → 相同 deck 順序', runA1 === runA2, `A1=${runA1.slice(0,60)} A2=${runA2.slice(0,60)}`);
const runB = deckOrderWithSeed(999);
check('唔同 seed → 不同 deck 順序', runA1 !== runB);
const runC1 = deckOrderWithSeed(null), runC2 = deckOrderWithSeed(null);
check('setSeed(null) 回到 unseeded（應該唔同）', runC1 !== runC2);

// full-game determinism: same seed → same winner + same turn count
function playSeeded(seed) {
  E.setSeed(seed);
  const s = E.initGame('RED_Aggro', 'YELLOW_Machine');
  E.mulligan(s, 'P', []); E.mulligan(s, 'A', AI.aiMulligan(s));
  E.startTurn(s);
  let t = 0;
  while (!s.winner && t < 80) { AI.aiTurnFor(s, s.activeSide); t++; }
  return `${s.winner}@${t}`;
}
const g1 = playSeeded(4242), g2 = playSeeded(4242);
check('同一 seed 完整對局 → 同 winner + 同 turn 數', g1 === g2, `${g1} vs ${g2}`);
E.setSeed(null);

// ----- TEST 2: zone invariant by identity, NOT == -----
console.log('\n[TEST 2] zone invariant assert (identity-based)');
const s2 = E.initGame('RED_Aggro', 'YELLOW_Machine');
const inv0 = E.assertZoneInvariant(s2);
check('init 後 zone invariant OK', inv0.ok, JSON.stringify(inv0.dupes.slice(0, 3)));
check('init 有 collect 到卡', inv0.total > 40, inv0.total);

// 注入一張 duplicate card_no 嘅卡到兩個 zone → 應該 detect（唔係 false-positive）
const dupCard = { card_no: 'BP01-002', _uid: 'DUP-TEST-1', name: 'dup', level: 2, power: 1000 };
const dupCard2 = { card_no: 'BP01-002', _uid: 'DUP-TEST-1', name: 'dup', level: 2, power: 1000 };
s2.players.P.deck.push(dupCard);
s2.players.P.hand.push(dupCard2);   // same _uid, different object → should be flagged
const invDup = E.assertZoneInvariant(s2);
check('同一 _uid 喺 2 個 zone → detected', !invDup.ok && invDup.dupes.length >= 1, JSON.stringify(invDup.dupes));

// 反例：同 card_no 但唔同 _uid → 應該 OK（唔會 false-positive）
s2.players.P.deck.pop(); s2.players.P.hand.pop();
s2.players.P.deck.push({ card_no: 'BP01-002', _uid: 'AAA', name: 'x' });
s2.players.P.hand.push({ card_no: 'BP01-002', _uid: 'BBB', name: 'x' });
const invSame = E.assertZoneInvariant(s2);
check('同 card_no 唔同 _uid → 唔會 false-positive', invSame.ok, JSON.stringify(invSame.dupes));

// ----- TEST 3: deck-out = opponent wins (official rule, NO reshuffle) -----
console.log('\n[TEST 3] deck-out 即輸（官方規則，唔 reshuffle）');
const s3 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s3);
s3.players.P.deck.length = 0;
const beforeD3 = s3.players.P.deck.length;
E.drawN(s3, 'P', 1);
check('deck 空 → draw 唔會 crash', true);
check('deck 空 → winner = 對方', s3.winner === 'A', s3.winner);
check('deck-out 唔會自動 reshuffle', s3.players.P.deck.length === beforeD3, s3.players.P.deck.length);

// ----- TEST 4: hand limit discard-down -----
console.log('\n[TEST 4] 手牌上限 discard-down');
const s4 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s4);
// push hand OVER the limit: init gives 6, limit is 9 → add 5 to force discard-down
for (let i = 0; i < 5; i++) {
  s4.players.P.hand.push({ card_no: 'ZZZ', _uid: 'over' + i, name: 'over' + i, level: 1, power: 0 });
}
const handBefore = s4.players.P.hand.length;
const retreatBefore = s4.players.P.retreat.length;
check('setup 令手牌超過上限', handBefore > E.HAND_SIZE_MAX, `${handBefore} > ${E.HAND_SIZE_MAX}`);
E.discardDownTo(s4, 'P', E.HAND_SIZE_MAX);
check(`hand 過上限 → discard 落 ${E.HAND_SIZE_MAX}`, s4.players.P.hand.length === E.HAND_SIZE_MAX, s4.players.P.hand.length);
check('棄咗嘅卡入 retreat zone', s4.players.P.retreat.length > retreatBefore, `+${s4.players.P.retreat.length - retreatBefore}`);
const inv4 = E.assertZoneInvariant(s4);
check('discard 後 zone invariant OK', inv4.ok, JSON.stringify(inv4.dupes.slice(0, 3)));

// ----- TEST 5: zone invariant holds across full AI games -----
console.log('\n[TEST 5] 12 局全自動對戰 + zone invariant 每回合檢查');
let viol = 0, dupSamples = [];
for (let g = 0; g < 12; g++) {
  E.setSeed(1000 + g);
  const decks = ['RED_Aggro', 'YELLOW_Machine', 'BLUE_Control', 'GREEN_Tempo'];
  const s = E.initGame(decks[g % decks.length], decks[(g + 1) % decks.length]);
  E.mulligan(s, 'P', []); E.mulligan(s, 'A', AI.aiMulligan(s));
  E.startTurn(s);
  let t = 0;
  while (!s.winner && t < 80) {
    AI.aiTurnFor(s, s.activeSide);
    const inv = E.assertZoneInvariant(s);
    if (!inv.ok) { viol++; dupSamples.push(inv.dupes.slice(0, 2)); }
    t++;
  }
  const fin = E.assertZoneInvariant(s);
  if (!fin.ok) { viol++; dupSamples.push(fin.dupes.slice(0, 2)); }
}
E.setSeed(null);
check('12 局全部冇 zone invariant violation', viol === 0, `${viol} violations, sample=${JSON.stringify(dupSamples.slice(0,2))}`);

console.log(`\n========== ${pass} pass, ${fail} fail ==========`);
process.exit(fail ? 1 : 0);