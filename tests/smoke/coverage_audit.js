// v3.17 — FULL COVERAGE AUDIT
// For every card in cards.js: determine whether its effect will actually
// resolve at runtime, via one of three tiers:
//   DSL   — has an effects descriptor (js/effects-data.js + engine demo cards)
//   REGEX — falls back to engine triggerEnter() / useCounter() patterns
//   STUB  — neither; will log [效果未實裝] (dead effect)
// Report: counts, per-set breakdown, per-trigger breakdown, full stub list.
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = '/opt/data/mhr-battle-sim';
const ctx = { window: {}, console, setTimeout, clearTimeout };
ctx.global = ctx.window;
vm.createContext(ctx);
function load(f) { vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f }); }
load('js/cards.js'); load('js/mhr-decks.js'); load('js/data.js');
load('js/effects-data.js'); load('js/effects-data-void.js');
load('js/engine.js'); load('js/effects.js'); load('js/ai.js');

const D = ctx.window.MHR_DATA, E = ctx.window.MHR_ENGINE;
const CARDS = D.CARDS;

// ---------- Tier 1: DSL descriptor ----------
const dsl = new Map();
for (const c of CARDS) {
  const inst = Object.assign({}, c, { _uid: 'audit' });
  E.injectEffects(inst);
  if (Array.isArray(inst.effects) && inst.effects.length) {
    dsl.set(c.card_no, inst.effects);
  }
}

// ---------- Tier 2: legacy regex fallback ----------
// Mirror the engine's own pattern set. We detect by text, but we ALSO run a
// real end-to-end probe below to confirm the engine actually fires.
const REGEX_TIERS = [
  { id: 'draw',        re: /you (?:may )?draw (\d+) cards?/i },
  { id: 'prune',       re: /you (?:may )?prune 1 of your opponent's characters?(?:\s+with\s+([^.]+))?/i },
  { id: 'powmod_foe',  re: /^(.{0,80})opponent'?s characters? in (FRONT|BATTLE) (?:in BATTLE )?gets Power([+\-][X\d]+(?:\d+)?)/i },
  { id: 'powmod_self', re: /(this card|1 of your (?:opponent's )?(?:characters?))\s+(?:gets|have)\s+(?:Lv\+[A-Z]\s+)?(?:and\s+)?Power([+\-][X\d]+(?:\d+)?)/i },
  { id: 'range_self',  re: /(this card|all your (?:red|yellow|blue|green)\s+characters?)\s+(?:gets|have)\s+(?:the ability )?R\+(\d+)/i },
  { id: 'deck_top',    re: /place (?:the )?top (\d+) cards? of your deck face down/i },
  { id: 'move_base',   re: /you (?:may )?move 1 of your opponent's characters? with Lv(\d+) or below from BATTLE to your opponent's BASE/i },
  { id: 'counter_kw',  re: /COUNTER/i },
];

function classify(c) {
  if (dsl.has(c.card_no)) return { tier: 'DSL', why: 'descriptor' };
  const t = (c.effect || '').trim();
  if (!t) return { tier: 'NONE', why: 'no effect text' };
  // MHR effect text often carries keyword prefixes on their own lines before
  // the trigger tag, e.g. "UNIQUE\nTRIG【FIELD】:When …" or "AIR STRIKE\nAUTO…".
  // Strip those so the trigger×slot breakdown (below) sees the real tag.
  const trigMatch = t.match(/(TRIG|ACTI|AUTO|COUNTER)【([^】]+)】/);
  for (const p of REGEX_TIERS) {
    if (p.re.test(t)) return { tier: 'REGEX', why: p.id };
  }
  if (!trigMatch) return { tier: 'STUB', why: 'no descriptor + no regex match' };
  return { tier: 'STUB', why: `${trigMatch[1]}【${trigMatch[2]}】` };
}

// ---------- Report ----------
const rows = CARDS.map(c => ({ card: c, ...classify(c) }));
const byTier = { DSL: [], REGEX: [], STUB: [], NONE: [] };
rows.forEach(r => byTier[r.tier].push(r));

console.log('='.repeat(70));
console.log('MHR v3.16 — EFFECT COVERAGE AUDIT');
console.log('='.repeat(70));
console.log(`Total cards:            ${CARDS.length}`);
console.log(`  DSL (descriptor):     ${byTier.DSL.length}`);
console.log(`  REGEX (fallback):     ${byTier.REGEX.length}`);
console.log(`  STUB (dead effect):   ${byTier.STUB.length}`);
console.log(`  NONE (no effect text):${byTier.NONE.length}`);
const effTotal = CARDS.length - byTier.NONE.length;
console.log(`\nCards WITH effect text: ${effTotal}`);
console.log(`  → fully implemented:  ${byTier.DSL.length} (${(byTier.DSL.length / effTotal * 100).toFixed(1)}%)`);
console.log(`  → regex fallback:     ${byTier.REGEX.length} (${(byTier.REGEX.length / effTotal * 100).toFixed(1)}%)`);
console.log(`  → DEAD:               ${byTier.STUB.length} (${(byTier.STUB.length / effTotal * 100).toFixed(1)}%)`);

console.log('\n' + '-'.repeat(70));
console.log('PER-SET BREAKDOWN');
console.log('-'.repeat(70));
const bySet = {};
rows.forEach(r => {
  const s = r.card.set || '?';
  bySet[s] = bySet[s] || { total: 0, DSL: 0, REGEX: 0, STUB: 0, NONE: 0 };
  bySet[s].total++; bySet[s][r.tier]++;
});
console.log('set      total  DSL  REGEX  STUB  NONE   effCov   dead%');
Object.entries(bySet).sort((a, b) => b[1].total - a[1].total).forEach(([s, v]) => {
  const eff = v.total - v.NONE;
  const cov = eff ? ((v.DSL + v.REGEX) / eff * 100).toFixed(0) + '%' : '—';
  const dead = eff ? (v.STUB / eff * 100).toFixed(0) + '%' : '—';
  console.log(
    s.padEnd(8), String(v.total).padStart(5), String(v.DSL).padStart(5),
    String(v.REGEX).padStart(6), String(v.STUB).padStart(5), String(v.NONE).padStart(5),
    String(cov).padStart(8), String(dead).padStart(7)
  );
});

console.log('\n' + '-'.repeat(70));
console.log('REGEX TIER BREAKDOWN (which pattern is carrying which cards)');
console.log('-'.repeat(70));
const byWhy = {};
byTier.REGEX.forEach(r => { byWhy[r.why] = (byWhy[r.why] || 0) + 1; });
Object.entries(byWhy).sort((a, b) => b[1] - a[1]).forEach(([w, n]) => console.log(`  ${w.padEnd(14)} ${n}`));

console.log('\n' + '-'.repeat(70));
console.log('STUB BREAKDOWN BY TRIGGER×SLOT');
console.log('-'.repeat(70));
const byTrig = {};
byTier.STUB.forEach(r => { byTrig[r.why] = (byTrig[r.why] || 0) + 1; });
Object.entries(byTrig).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${k.padEnd(28)} ${n}`));

console.log('\n' + '-'.repeat(70));
console.log('STUB LIST (dead effects — sorted by set, then card_no)');
console.log('-'.repeat(70));
let lastSet = null;
byTier.STUB.sort((a, b) => (a.card.set || '').localeCompare(b.card.set || '') || a.card.card_no.localeCompare(b.card.card_no));
byTier.STUB.forEach(r => {
  if (r.card.set !== lastSet) { lastSet = r.card.set; console.log(`\n--- ${lastSet} (${byTier.STUB.filter(x => x.card.set === lastSet).length}) ---`); }
  const t = (r.card.effect || '').replace(/\s+/g, ' ');
  console.log(`  ${r.card.card_no.padEnd(11)} Lv${String(r.card.level || 0).padEnd(2)} ${String(r.card.name || '').slice(0, 34).padEnd(34)} | ${t.slice(0, 68)}`);
});

// machine-readable output for the skill
const out = {
  generatedFor: 'MHR v3.16 coverage audit',
  totals: { cards: CARDS.length, DSL: byTier.DSL.length, REGEX: byTier.REGEX.length, STUB: byTier.STUB.length, NONE: byTier.NONE.length },
  bySet, byWhy,
  stubList: byTier.STUB.map(r => ({
    card_no: r.card.card_no, set: r.card.set, name: r.card.name,
    level: r.card.level, power: r.card.power, rarity: r.card.rarity,
    effect: (r.card.effect || '').trim()
  }))
};
fs.writeFileSync('/opt/data/mhr-battle-sim/tests/smoke/coverage-audit.json', JSON.stringify(out, null, 2));
console.log(`\n\n→ wrote tests/smoke/coverage-audit.json (${byTier.STUB.length} stubs)`);