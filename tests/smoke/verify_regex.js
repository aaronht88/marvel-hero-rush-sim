// Verify the coverage audit's REGEX tier actually FIRES at runtime.
// Method: for each card classified REGEX by static text match, build a game
// state where the card is the DEFENDER, force an attack, and check whether the
// engine produced an [效果] log entry (not [效果未實裝]).
// This proves/denies that the 126-card "REGEX" bucket is real.
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = '/opt/data/mhr-battle-sim';
const ctx = { window: {}, console, setTimeout, clearTimeout };
ctx.global = ctx.window;
vm.createContext(ctx);
function load(f) { vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f }); }
load('js/cards.js'); load('js/mhr-decks.js'); load('js/data.js'); load('js/effects-data.js');
load('js/engine.js'); load('js/effects.js'); load('js/ai.js');
const D = ctx.window.MHR_DATA, E = ctx.window.MHR_ENGINE;

// Reuse the classifier from coverage_audit.js
const audit = JSON.parse(fs.readFileSync('/opt/data/mhr-battle-sim/tests/smoke/coverage-audit.json', 'utf8'));
const stubNos = new Set(audit.stubList.map(s => s.card_no));

// Pick cards the audit says are REGEX-tier but which are NOT mere COUNTER kw
// (COUNTER is verified separately by m4_smoke). We want draw/prune/powmod.
const REGEX_TIERS = [
  { id: 'draw',        re: /you (?:may )?draw (\d+) cards?/i },
  { id: 'prune',       re: /you (?:may )?prune 1 of your opponent's characters?(?:\s+with\s+([^.]+))?/i },
  { id: 'powmod_foe',  re: /^(.{0,80})opponent'?s characters? in (FRONT|BATTLE) (?:in BATTLE )?gets Power([+\-][X\d]+(?:\d+)?)/i },
  { id: 'powmod_self', re: /(this card|1 of your (?:opponent's )?(?:characters?))\s+(?:gets|have)\s+(?:Lv\+[A-Z]\s+)?(?:and\s+)?Power([+\-][X\d]+(?:\d+)?)/i },
  { id: 'range_self',  re: /(this card|all your (?:red|yellow|blue|green)\s+characters?)\s+(?:gets|have)\s+(?:the ability )?R\+(\d+)/i },
  { id: 'deck_top',    re: /place (?:the )?top (\d+) cards? of your deck face down/i },
  { id: 'move_base',   re: /you (?:may )?move 1 of your opponent's characters? with Lv(\d+) or below from BATTLE to your opponent's BASE/i },
];
const dslNos = new Set(audit.totals ? [] : []);
function classifyText(c) {
  if (stubNos.has(c.card_no)) return null;
  const t = (c.effect || '').trim();
  if (!t) return null;
  for (const p of REGEX_TIERS) if (p.re.test(t)) return p.id;
  return null;
}

const targets = D.CARDS.filter(c => classifyText(c));
// dedupe by card_no (variants share text)
const seen = new Set();
const uniq = targets.filter(c => { if (seen.has(c.card_no)) return false; seen.add(c.card_no); return true; });
console.log(`REGEX-tier cards to probe (unique): ${uniq.length}`);

// PROBE: play each as defender, force a counter scenario.
function probe(cardNo) {
  const def = D.CARDS.find(c => c.card_no === cardNo);
  if (!def) return null;
  const s = E.initGame('RED_Aggro', 'YELLOW_Machine');
  E.startTurn(s);
  // strip counters so we don't confuse BP01-002
  ['P', 'A'].forEach(side => {
    s.players[side].hand = s.players[side].hand.filter(c => !E.hasAbility(c, 'COUNTER'));
  });
  // put the card under test in P's hand, P is the DEFENDER
  const inst = Object.assign({}, def, { _uid: 'probe1' });
  E.injectEffects(inst);
  s.players.P.hand.push(inst);
  // call it (P is active side after startTurn)
  const i = s.players.P.hand.indexOf(inst);
  const res = E.callCard(s, 'P', i);
  const logs = s.log.map(l => l.msg);
  return {
    card_no: cardNo,
    called: !!(res && res.ok),
    effectFired: logs.some(m => m.includes('[效果]')),
    unimplemented: logs.some(m => m.includes('[效果未實裝]')),
    logTail: logs.slice(-4)
  };
}

let fired = 0, unimplemented = 0, noCall = 0, mismatches = [];
for (const c of uniq) {
  const r = probe(c.card_no);
  if (!r) continue;
  if (!r.called) { noCall++; continue; }
  if (r.unimplemented && !r.effectFired) { unimplemented++; mismatches.push({ ...r, tier: classifyText(c) }); }
  else if (r.effectFired) fired++;
}
console.log(`\n  fired [效果]:        ${fired}`);
console.log(`  logged [效果未實裝]: ${unimplemented}`);
console.log(`  could not call card: ${noCall}`);
console.log(`\nREGEX-tier cards that text-matches but do NOT fire (false positives):`);
if (!mismatches.length) console.log('  (none — all probed cards fired or were correctly stubbed)');
mismatches.slice(0, 25).forEach(m => {
  console.log(`  ${m.card_no.padEnd(11)} tier=${(m.tier||'').padEnd(11)} ${JSON.stringify(m.logTail)}`);
});
console.log(`\nTotal false positives: ${mismatches.length} / ${uniq.length} probed`);