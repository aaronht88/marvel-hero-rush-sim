// M4 smoke — counter frame (DSL both directions, no double-fire) + batch full-game harness
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
  else { console.log(`  ✗ ${name}`, extra || ''); fail++; }
}
function initAFlags(s) { s.turnFlags["A"] = { setDeployUsed: false, callCount: 0, movedUids: {}, attackedUids: {}, counterStepUsed: false, doubleAttackUids: {}, oncePerTurnUids: {} }; }
function injectHand(state, side, cardNo) {
  const def = ctx.window.MHR_DATA.CARDS.find(c => c.card_no === cardNo);
  if (!def) return -1;
  const card = Object.assign({}, def, { _uid: 't' + Math.random().toString(36).slice(2, 8) });
  E.injectEffects(card);   // M4: 手動行 engine 嘅 descriptor 注入（等於 initGame 路徑）
  state.players[side].hand.push(card);
  return state.players[side].hand.length - 1;
}
function callLow(state, side, forced) {
  initAFlags(state);
  const p = state.players[side];
  const card = forced || p.deck.find(c => (c.level || 0) <= 3);
  if (!card) return null;
  const idx = p.hand.findIndex(c => c === card);
  if (idx < 0) { p.hand.push(card); p.deck.splice(p.deck.indexOf(card), 1); }
  const i = p.hand.indexOf(card);
  return E.callCard(state, side, i);
}

// ----- TEST 1: DSL counter — A 攻擊 P，P 手牌有 BP01-002（descriptor）-----
console.log('\n[TEST 1] DSL counter: BP01-002 vs AI attack');
// NOTE (card-game skill pitfall: assertion isolation): 53 of the 448 cards carry
// the COUNTER ability (engine `hasAbility(card,'COUNTER')` = effect text contains
// the keyword). A single attack can legally chain several COUNTERs
// (-2000 then +1000 → net -1000), so an ABSOLUTE _powerMod assertion is inherently
// flaky — it breaks whenever the randomly-dealt hand happens to hold another
// counter card. Isolate: strip every counter-capable card from the defender's
// hand, then inject exactly the one card under test.
function stripCounters(state, side, keepCard) {
  const p = state.players[side];
  p.hand = p.hand.filter(c => !E.hasAbility(c, 'COUNTER') || c === keepCard);
}
function counterCount(state, side) {
  return state.players[side].hand.filter(c => E.hasAbility(c, 'COUNTER')).length;
}
const s1 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s1);
// P 場上放一張攻擊目標
callLow(s1, 'P');
// P 手牌注入 BP01-002（engine injectEffects 有 descriptor）
const i2 = injectHand(s1, 'P', 'BP01-002');
check('BP01-002 注入', i2 >= 0);
const b2 = s1.players.P.hand[i2];
check('BP01-002 有 descriptor', Array.isArray(b2.effects) && b2.effects.length > 0, b2.effects);
stripCounters(s1, 'P', b2);   // keep ONLY our injected BP01-002
check('隔離後守方只剩 1 張 COUNTER 卡', counterCount(s1, 'P') === 1, counterCount(s1, 'P'));
// A 場上放一張低費卡，攻擊 P front
callLow(s1, 'A');
const aAtk = s1.players.A.battle.front;
const pDef = s1.players.P.battle.front;
check('雙方場上有卡', !!aAtk && !!pDef);
const targets = E.attackableTargets(s1, 'A', aAtk._uid);
const tgt = targets.find(t => t.kind === 'card' && t.card === pDef);
check('A 有攻擊目標', !!tgt);
if (tgt) {
  const bpCountBefore = s1.players.P.hand.filter(c => c.card_no === 'BP01-002').length;
  // count-based + delta-based assertions (card-game skill pitfall: attacker
  // may carry its own enter-effect _powerMod → assert the DELTA, not the abs)
  const powerBefore = aAtk._powerMod || 0;
  E.attack(s1, 'A', aAtk._uid, tgt);
  const log1 = s1.log.slice(-8).map(e => e.msg);
  const powerDelta = (aAtk._powerMod || 0) - powerBefore;
  check('BP01-002 由 DSL 棄牌（手牌少 1 張）', s1.players.P.hand.filter(c => c.card_no === 'BP01-002').length === bpCountBefore - 1, `before ${bpCountBefore}`);
  check('attacker Power delta -2000（DSL counter）', powerDelta === -2000, `delta=${powerDelta} before=${powerBefore} after=${aAtk._powerMod}`);
  check('log 有 [效果] counter', log1.some(m => m.includes('[效果]') && m.includes('Power -2000')));
}

// ----- TEST 2: 雙向 — P 攻擊 A，A 用自己嘅 counter 卡 -----
console.log('\n[TEST 2] defender A counters P attack');
const s2 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s2);
callLow(s2, 'P');
callLow(s2, 'A');
const iA = injectHand(s2, 'A', 'BP01-002');
check('A 注入 BP01-002', iA >= 0);
const aCounterCard = s2.players.A.hand[iA];
stripCounters(s2, 'A', aCounterCard);   // keep ONLY our injected BP01-002
check('隔離後 A 只剩 1 張 COUNTER 卡', counterCount(s2, 'A') === 1, counterCount(s2, 'A'));
const pAtk = s2.players.P.battle.front;
const aDef = s2.players.A.battle.front;
const t2 = E.attackableTargets(s2, 'P', pAtk._uid).find(t => t.kind === 'card' && t.card === aDef);
check('P 有攻擊目標', !!t2);
if (t2) {
  const powerBefore2 = pAtk._powerMod || 0;
  E.attack(s2, 'P', pAtk._uid, t2);
  const powerDelta2 = (pAtk._powerMod || 0) - powerBefore2;
  check('A 用 DSL counter → P attacker Power delta -2000', powerDelta2 === -2000, `delta=${powerDelta2}`);
}

// ----- TEST 3: 無雙重觸發（legacy useCounter 跳過 descriptor 卡）-----
// NOTE (card-game skill pitfall: 斷言要 count-based + 唔好依賴 random position):
// 原斷言 `(a3._powerMod || 0) === -2000` 係 instance-based + 依賴 callLow
// random 揀到邊張 Lv≤3 卡做 attacker（該卡自己嘅入場效果會令基線 _powerMod
// 唔同）→ 5 跑 3 fail flaky。改用 log count-based：BP01-002 counter 應該
// 恰好觸發 1 次（Power -2000 條數 == 1），唔理邊張卡做 attacker。
console.log('\n[TEST 3] no double-fire');
const s3 = E.initGame('RED_Aggro', 'YELLOW_Machine');
E.startTurn(s3);
callLow(s3, 'P');
callLow(s3, 'A');
injectHand(s3, 'P', 'BP01-002');
const pCounter3 = s3.players.P.hand[s3.players.P.hand.length - 1];
stripCounters(s3, 'P', pCounter3);   // keep ONLY our injected BP01-002
const a3 = s3.players.A.battle.front;
const t3 = E.attackableTargets(s3, 'A', a3._uid).find(t => t.kind === 'card');
E.attack(s3, 'A', a3._uid, t3);
const counterLogs3 = s3.log.filter(m => m.msg.includes('Power -2000'));
check('counter 效果恰好觸發 1 次（冇 double-fire）', counterLogs3.length === 1, `count=${counterLogs3.length}`);

// ----- TEST 4: batch full-game harness（4 副 deck 對打，AI 打雙方）-----
console.log('\n[TEST 4] batch full games');
function playGame(pDeck, aDeck, maxTurns = 80) {
  const s = E.initGame(pDeck, aDeck);
  E.mulligan(s, 'P', []);
  E.mulligan(s, 'A', AI.aiMulligan(s));
  E.startTurn(s);
  let turns = 0;
  while (!s.winner && turns < maxTurns) {
    AI.aiTurnFor(s, s.activeSide);
    turns++;
  }
  return s;
}
const decks = Object.keys(ctx.window.MHR_DATA.DECKS);
let games = 0, completed = 0, dslGames = 0, effectLogs = 0, errors = 0;
for (let i = 0; i < decks.length; i++) {
  for (let j = 0; j < decks.length; j++) {
    if (i === j) continue;
    try {
      const s = playGame(decks[i], decks[j]);
      games++;
      if (s.winner) completed++;
      const dsl = s.log.some(e => e.msg.includes('[DSL]'));
      if (dsl) dslGames++;
      effectLogs += s.log.filter(e => e.msg.startsWith('[效果]')).length;
      // zone invariant post-game
      const all = [].concat(s.players.P.deck, s.players.P.hand, s.players.P.retreat, s.players.P.voidZone, s.players.P.base.faceDown, s.players.P.timeline,
        s.players.A.deck, s.players.A.hand, s.players.A.retreat, s.players.A.voidZone, s.players.A.base.faceDown, s.players.A.timeline);
      const dup = all.filter((c, idx) => all.indexOf(c) !== idx);
      if (dup.length) { console.log(`  ✗ zone dup in ${decks[i]} vs ${decks[j]}`); errors++; }
    } catch (e) {
      errors++;
      console.log(`  ✗ ${decks[i]} vs ${decks[j]} threw: ${e.message}`);
    }
  }
}
check(`全自動對戰 ${games} 局無 exception`, errors === 0, `${errors} errors`);
check(`對局全部完成（有 winner）`, completed === games, `${completed}/${games}`);
check(`DSL effect 喺 ${dslGames} 局有觸發（≥1 即 pipeline 有行）`, dslGames >= 1, dslGames);
console.log(`  （[效果] log 總數：${effectLogs} 條）`);

console.log(`\n========== ${pass} pass, ${fail} fail ==========`);
process.exit(fail === 0 ? 0 : 1);
