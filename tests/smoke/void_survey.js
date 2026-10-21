// v3.18 Step 3 — VOID ZONE-TRANSFER VARIANT SURVEY
//
// Before writing any zone_transfer spec we need to know how many distinct
// shapes actually exist. "place X from VOID into your field" looks like one
// mechanism, but MHR cards vary the COST, the CONDITION, the TARGET and the
// SIDE. This enumerates every card whose effect moves a card out of VOID (or
// moves a card INTO VOID) and buckets them by normalised shape, so the spec
// covers real variants instead of the one we happened to remember.
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = '/opt/data/mhr-battle-sim';
const ctx = { window: {}, console, setTimeout, clearTimeout };
ctx.global = ctx.window;
vm.createContext(ctx);
function load(f) { vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f }); }
load('js/cards.js'); load('js/mhr-decks.js'); load('js/data.js');
const CARDS = ctx.window.MHR_DATA.CARDS;

// ---------- identify VOID-moving cards ----------
// Direction matters: OUT of VOID (召喚回場) vs INTO VOID (裁剪) are different
// mechanisms even though both mention the zone.
const OUT = [
  /place (?:this card|it|that card|1 of your[^.]*?) from VOID/i,
  /place (?:this card|it|that card|1 of your[^.]*?) into (?:your|his|her|their) field/i,
  /from VOID into/i,
  /\bVOID\b[^.]*?into (?:your )?field/i,
];
const INTO = [
  /\bprune\b/i,
  /enters? VOID/i,
  /into (?:your |his |her |their )?VOID/i,
];

function directionOf(t) {
  const out = OUT.some(r => r.test(t));
  const into = INTO.some(r => r.test(t));
  if (out && into) return 'BOTH';
  if (out) return 'OUT_OF_VOID';
  if (into) return 'INTO_VOID';
  return null;
}

const rows = [];
for (const c of CARDS) {
  const t = (c.effect || '').replace(/\s+/g, ' ').trim();
  if (!t) continue;
  if (!/VOID|裁剪/i.test(t)) continue;
  const dir = directionOf(t);
  if (!dir) continue;
  rows.push({ card_no: c.card_no, set: c.set, name: c.name, level: c.level, dir, text: t });
}

// dedupe by card_no (variant prints duplicate)
const seen = new Set();
const uniq = rows.filter(r => { if (seen.has(r.card_no)) return false; seen.add(r.card_no); return true; });

console.log('='.repeat(78));
console.log('VOID ZONE-TRANSFER SURVEY');
console.log('='.repeat(78));
console.log(`cards mentioning VOID/裁剪 : ${CARDS.filter(c => /VOID|裁剪/.test(c.effect || '')).length}`);
console.log(`cards that actually MOVE via VOID : ${uniq.length}`);
const byDir = {};
uniq.forEach(r => byDir[r.dir] = (byDir[r.dir] || 0) + 1);
console.log('  direction:', JSON.stringify(byDir));

// ---------- bucket OUT_OF_VOID by cost clause ----------
// The interesting axis is: what must the player pay before the card comes back?
function extractCost(t) {
  const cands = [];
  if ((m = t.match(/you (?:may )?discard (\d+) (?:cards? )?in HAND/i))) cands.push(`discard ${m[1]} in HAND`);
  if ((m = t.match(/you (?:may )?discard (?:this card|it) in HAND/i))) cands.push('discard self in HAND');
  if (/you discard/i.test(t) && !cands.length) cands.push('discard (unspecified)');
  if ((m = t.match(/you (?:may )?prune (\d+) of your/i))) cands.push(`prune ${m[1]} of yours`);
  if (/you prune this card/i.test(t)) cands.push('prune self');
  if (/reveal/i.test(t)) cands.push('reveal (as part of cost)');
  return cands.length ? cands.join(' + ') : '(none — unconditional)';
}
function extractCond(t) {
  const out = [];
  if (/if you do/i.test(t)) out.push('if_you_do');
  if (/you may/i.test(t)) out.push('you_may');
  if (/once per turn/i.test(t)) out.push('once_per_turn');
  return out.length ? out.join(', ') : '—';
}
function extractTarget(t) {
  if (/place this card from VOID into your field/i.test(t)) return 'self';
  if (/place this card from VOID into (?:his|her|their|opponent)/i.test(t)) return "self → opponent's field (gifting)";
  if (/place 1 of your characters? from VOID/i.test(t)) return 'chosen_own';
  if (/place 1 of your opponent's characters? from VOID/i.test(t)) return "chosen_opp (steal)";
  if (/from VOID into your field/i.test(t)) return 'unspecified';
  return '?';
}
function extractCost2(t) {
  if (/in this turn/i.test(t)) return 'this_turn';
  if (/only in this turn/i.test(t)) return 'this_turn';
  return 'permanent';
}

const OUTS = uniq.filter(r => r.dir === 'OUT_OF_VOID' || r.dir === 'BOTH');
console.log(`\nOUT-OF-VOID cards (召喚回場): ${OUTS.length}`);
console.log('-'.repeat(78));
const buckets = {};
OUTS.forEach(r => {
  const key = `${extractTarget(r.text)} | cost=${extractCost(r.text)} | cond=${extractCond(r.text)}`;
  (buckets[key] = buckets[key] || []).push(r);
});
Object.entries(buckets).sort((a, b) => b[1].length - a[1].length).forEach(([k, list]) => {
  console.log(`\n[${list.length}×] ${k}`);
  list.forEach(r => console.log(`     ${r.card_no.padEnd(11)} Lv${String(r.level).padEnd(2)} ${String(r.name).slice(0, 30).padEnd(30)}`));
  console.log(`     e.g. ${list[0].text.slice(0, 150)}`);
});

// distinct VARIANTS = distinct (target, cost, cond) triples
const variants = Object.keys(buckets);
console.log(`\n${'='.repeat(78)}`);
console.log(`DISTINCT OUT-OF-VOID VARIANTS: ${variants.length}`);
console.log(`${'='.repeat(78)}`);
variants.forEach((v, i) => console.log(`  ${i + 1}. ${v}`));

// ---------- INTO_VOID (裁剪) side ----------
const INTOS = uniq.filter(r => r.dir === 'INTO_VOID' || r.dir === 'BOTH');
console.log(`\n\nINTO-VOID (裁剪) cards: ${INTOS.length}`);
const iBuckets = {};
INTOS.forEach(r => {
  const t = r.text;
  let k;
  if (/prune this card in RETREAT/i.test(t)) k = 'prune self from RETREAT';
  else if (/enters? VOID from RETREAT/i.test(t)) k = 'VOID entry trigger (card pruned)';
  else if (/prune \d+ of your opponent/i.test(t)) k = 'prune opponent N';
  else if (/prune \d+ of your (?!opponent)/i.test(t)) k = 'prune own N (as a COST for something else)';
  else if (/place .* into .*VOID/i.test(t)) k = 'place into VOID (other source)';
  else k = 'other';
  (iBuckets[k] = iBuckets[k] || []).push(r);
});
Object.entries(iBuckets).sort((a, b) => b[1].length - a[1].length).forEach(([k, list]) => {
  console.log(`\n[${list.length}×] ${k}`);
  list.slice(0, 8).forEach(r => console.log(`     ${r.card_no.padEnd(11)} ${String(r.name).slice(0, 32)}`));
  if (list.length > 8) console.log(`     … +${list.length - 8} more`);
});
console.log(`\n  distinct INTO-VOID shapes: ${Object.keys(iBuckets).length}`);

fs.writeFileSync(path.join(REPO, 'tests/smoke/void-survey.json'), JSON.stringify({
  outOfVoid: OUTS.length, intoVoid: INTOS.length,
  outVariants: variants, buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.map(r => r.card_no)])),
  intoBuckets: Object.fromEntries(Object.entries(iBuckets).map(([k, v]) => [k, v.map(r => r.card_no)])),
  cards: uniq,
}, null, 2));
console.log('\n→ wrote tests/smoke/void-survey.json');