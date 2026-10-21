// v3.18 Step 1 — CLAUSE ANALYSIS
// Goal: find the real reuse axis before designing any module.
// Instead of authoring 220 descriptors by hand, split every effect text into
// CLAUSES (the smallest self-contained instruction), then cluster them by
// normalised shape. Whatever shape repeats is a module; anything left over
// tells us how many bespoke modules we'd actually need.
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = '/opt/data/mhr-battle-sim';
const ctx = { window: {}, console, setTimeout, clearTimeout };
ctx.global = ctx.window;
vm.createContext(ctx);
function load(f) { vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f }); }
load('js/cards.js'); load('js/mhr-decks.js'); load('js/data.js');
const D = ctx.window.MHR_DATA;
const CARDS = D.CARDS;

// ---------- normalise ----------
// Collapse every literal number / variable to a placeholder so structurally
// identical clauses with different values collapse onto one shape.
function normalize(s) {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\b\d+\b/g, 'N')
    .replace(/Power\s*[+\-]\s*N?X?/gi, 'Power±N')
    .replace(/Lv\s*[+\-]\s*N?X?/gi, 'Lv±N')
    .replace(/\bR\s*\+\s*N/gi, 'R+N')
    .replace(/\bX\b/g, 'VAR')
    .trim();
}

// ---------- clause splitter ----------
// MHR effect text is sentence-like, separated by '.' and by keyword cues
// ("When ...", "If you do", "You may", "Then"). Split conservatively, then
// drop fragments that are pure bookkeeping.
//
// v3.18: three fragment classes leak through a naive split and would each look
// like a "new mechanism" when they are not:
//   - zone/trigger tags left attached      "【FIELD】:"   → strip
//   - X-definition sentences               "X is the number of your set cards"
//                                             → extract as a vars binding
//   - target/filter tails split off a verb "N of your characters in the field"
//                                             → re-attach to the preceding verb
const CUE = /\s+(?=(?:When|Whenever|At the (?:start|end)|If you do|Then|You may|This card gets|1 of your|Each time))\b/i;
const VAR_DEF = /^([A-Z])\s+is\s+the\s+(.+)$/i;   // X is <expression>

function splitClauses(t) {
  let s = (t || '').replace(/\r/g, '').trim();

  // 1) lift keyword-prefix lines (UNIQUE / BLOCK / AIR STRIKE / ...)
  const prefixes = [];
  s = s.replace(/^([A-Z][A-Z ]*(?:\([A-Z]+\))?)\s*\n?/g, (m, p) => { prefixes.push(p.trim()); return ''; });

  // 2) strip every 【TAG】: marker wherever it appears — it is metadata, not
  //    an instruction, and leaving it in makes 10 clauses look unclassifiable.
  s = s.replace(/[【]([^】]*)[】]\s*:?/g, ' ');

  // 3) pull out "X is the number of ..." definitions before splitting, so the
  //    definition doesn't survive as a fake clause.
  const varDefs = [];
  s = s.replace(new RegExp(VAR_DEF.source, 'gim'), (m, letter, body) => {
    // Guard against false positives: the left side must be a single capital
    // letter that appears as a placeholder elsewhere in the text, otherwise
    // "This card ..." / "When ..." would be swallowed as a definition.
    if (!/^[A-Z]$/.test(letter)) return m;
    varDefs.push({ var: letter.toUpperCase(), expr: body.trim().replace(/\s*\.\s*$/, '') });
    return ' ';
  });

  let parts = s.split(/\.\s+/)
    .flatMap(x => x.split(CUE))
    .map(x => x.replace(/\s+/g, ' ').trim())
    .filter(x => x.length > 6);

  // 4) re-attach orphan target/filter tails. A fragment that starts with a
  //    quantifier and names a zone ("N of your characters in the field") is not
  //    an instruction — it belongs to whatever verb preceded it.
  const ORPHAN = /^(?:\d+|one|two|three|all|any|VAR|N|1)\s+of\s+(?:your|the)\b/i;
  const merged = [];
  for (const part of parts) {
    if (merged.length && ORPHAN.test(part)) {
      merged[merged.length - 1] += ', ' + part;
      continue;
    }
    merged.push(part);
  }

  return { prefixes, varDefs, clauses: merged };
}

// ---------- classify a clause into a candidate module ----------
// Ordered most-specific → least. This is the reuse axis we're measuring.
const CLAUSE_MODULES = [
  // --- resource / draw ---
  { mod: 'draw',            re: /\b(?:you (?:may )?)?draw (\d+|\bVAR\b) cards?\b/i },
  { mod: 'draw_each_opp',   re: /each opponent draws? (\d+|\bVAR\b)/i },
  // --- stats ---
  { mod: 'stat_self',       re: /this card gets (?:Lv|Power|R)\b/i },
  { mod: 'stat_self_combo', re: /this card gets [^.]*\b(?:and|,)\b[^.]*(?:Lv|Power|R)\b/i },
  { mod: 'stat_exact',      re: /The (?:R|Power|Lv) of your character in [A-Z]+ changes to/i },
  { mod: 'effect_persistent', re: /This effect can ?not be lost/i },
  { mod: 'immune_low_lv',   re: /cannot be affected by the effect of the characters with Lv/i },
  { mod: 'feature_filter',  re: /with 【[^】]+】 in (?:their|its) features/i },
  { mod: 'stat_my_chars',   re: /all? of your (?:characters?|red|yellow|blue|green)[^.]*gets? (?:Lv|Power|R)/i },
  { mod: 'stat_opp_chars',  re: /opponent'?s characters?[^.]*gets? (?:Lv|Power|R)/i },
  { mod: 'stat_when_attach', re: /gets? Power[^\n]*when (?:you )?attach/i },
  { mod: 'while_in_play',   re: /while this card is on the field/i },
  { mod: 'ability_gain',    re: /gains? the ability/i },
  { mod: 'ability_named',   re: /the ability 【[^】]+】/i },
  { mod: 'move_grant',      re: /takes? [A-Z]+-BASE Move|gets? [A-Z]+-[A-Z]+ Move/i },
  { mod: 'cannot_same_name', re: /can ?not have another character with the same name/i },
  { mod: 'set_card',        re: /set cards?|cards? in BASE|into (?:your|opponent'?s) BASE/i },
  { mod: 'ability_lose',    re: /loses? (?:all )?(?:its |their )?abilities/i },
  // --- zone movement ---
  { mod: 'prune',           re: /\bprune\b/i },
  { mod: 'move_to_base',    re: /move [^.]*to (?:your |opponent'?s )?BASE/i },
  { mod: 'move_to_battle',  re: /move [^.]*(?:to|from) BATTLE/i },
  { mod: 'retreat_own',     re: /\bretreat\b/i },
  { mod: 'to_retreat_zone', re: /enters? RETREAT/i },
  { mod: 'to_void',         re: /enters? VOID/i },
  { mod: 'attach',          re: /\battach(?:ed|ing)?\b/i },
  { mod: 'discard',         re: /\bdiscards?\b/i },
  { mod: 'return_to_hand',  re: /return[s]? to your hand|back to your hand/i },
  { mod: 'reveal',          re: /\breveals?\b/i },
  { mod: 'look_at',         re: /\blook(?:s)? at\b/i },
  { mod: 'put_top_deck',    re: /place[s]? .*top of your deck/i },
  { mod: 'swap',            re: /\bswaps?\b/i },
  { mod: 'swap_field',      re: /\bswap\b[^.]*(?:field|BATTLE)/i },
  // --- combat ---
  { mod: 'can_attack_again', re: /(?:second chance|another chance|once more) to attack|can attack/i },
  { mod: 'attack_again',     re: /attack(?:es)? (?:again|once more)/i },
  { mod: 'cannot_be_attacked', re: /can(?:no|')t be attacked|cannot be attacked/i },
  { mod: 'must_attack',     re: /must attack/i },
  // --- resource counters ---
  { mod: 'rush_point',      re: /rush point|time ?line|時間線/i },
  { mod: 'power_counter',   re: /counter|counters?\b/i },
  // --- choice / condition wrappers (structural, handled by interpreter) ---
  { mod: 'if_you_do',      re: /\bif you do\b/i },
  { mod: 'you_may',        re: /\byou may\b/i },
  { mod: 'instead',        re: /\binstead\b/i },
  { mod: 'when_condition', re: /\bwhen\b|\bwhenever\b|\bat the (?:start|end)\b|\beach time\b|\bif\b/i },
  { mod: 'this_turn_only', re: /in this turn|this turn only/i },
  { mod: 'per_turn_once',  re: /once per turn/i },
  // --- uniqueness / capability keywords ---
  { mod: 'unique_cap',     re: /^UNIQUE\b/i },
  { mod: 'air_strike',     re: /^AIR STRIKE\b/i },
  { mod: 'block_cap',      re: /^BLOCK\b/i },
];

function classifyClause(c) {
  for (const m of CLAUSE_MODULES) if (m.re.test(c)) return m.mod;
  return null;
}

// ---------- run ----------
const rows = [];
for (const card of CARDS) {
  const t = (card.effect || '').trim();
  if (!t) continue;
  const { prefixes, clauses, varDefs } = splitClauses(t);
  for (const c of clauses) {
    rows.push({
      card_no: card.card_no, set: card.set,
      prefixes, varDefs,
      clause: c, shape: normalize(c), mod: classifyClause(c),
    });
  }
}

const total = rows.length;
const classified = rows.filter(r => r.mod);
const unclassified = rows.filter(r => !r.mod);

console.log('='.repeat(72));
console.log('CLAUSE ANALYSIS — finding the reuse axis');
console.log('='.repeat(72));
console.log(`cards with effect text : ${CARDS.filter(c => (c.effect || '').trim()).length}`);
console.log(`total clauses split    : ${total}`);
console.log(`classified to a module : ${classified.length} (${(classified.length / total * 100).toFixed(1)}%)`);
console.log(`UNCLASSIFIED           : ${unclassified.length} (${(unclassified.length / total * 100).toFixed(1)}%)`);

const byMod = {};
classified.forEach(r => { byMod[r.mod] = (byMod[r.mod] || 0) + 1; });
console.log('\n' + '-'.repeat(72));
console.log('MODULE FREQUENCY (this is the reuse axis)');
console.log('-'.repeat(72));
Object.entries(byMod).sort((a, b) => b[1] - a[1]).forEach(([m, n]) => {
  const bar = '#'.repeat(Math.min(40, Math.round(n / total * 200)));
  console.log(`  ${m.padEnd(20)} ${String(n).padStart(4)}  ${bar}`);
});

// distinct NORMALISED shapes per module = how many parameter variants exist
const shapeCount = {};
classified.forEach(r => { shapeCount[r.mod] = shapeCount[r.mod] || new Set(); shapeCount[r.mod].add(r.shape); });
console.log('\n' + '-'.repeat(72));
console.log('DISTINCT SHAPES PER MODULE (parameter variants — the real cost)');
console.log('-'.repeat(72));
console.log('  module               clauses  shapes  ratio');
Object.entries(shapeCount).sort((a, b) => b[1].size - a[1].size).forEach(([m, s]) => {
  console.log(`  ${m.padEnd(20)} ${String(byMod[m]).padStart(7)} ${String(s.size).padStart(6)}  ${(byMod[m] / s.size).toFixed(2)}`);
});

// unclassified sample — these are what bespoke code would be needed for
console.log('\n' + '-'.repeat(72));
console.log(`UNCLASSIFIED CLAUSES (${unclassified.length}) — first 40, grouped by shape`);
console.log('-'.repeat(72));
const uByShape = {};
unclassified.forEach(r => { (uByShape[r.shape] = uByShape[r.shape] || []).push(r); });
const uSorted = Object.entries(uByShape).sort((a, b) => b[1].length - a[1].length);
console.log(`  distinct unclassified shapes: ${uSorted.length}`);
uSorted.slice(0, 40).forEach(([shape, list]) => {
  console.log(`\n  [${list.length}×] ${shape.slice(0, 100)}`);
  console.log(`        e.g. ${list[0].card_no} (${list[0].set})`);
});

fs.writeFileSync('/opt/data/mhr-battle-sim/tests/smoke/clause-analysis.json', JSON.stringify({
  totals: { cards: CARDS.filter(c => (c.effect || '').trim()).length, clauses: total, classified: classified.length, unclassified: unclassified.length },
  byMod, shapes: Object.fromEntries(Object.entries(shapeCount).map(([k, v]) => [k, v.size])),
  unclassifiedShapes: uSorted.map(([s, l]) => ({ shape: s, n: l.length, examples: l.slice(0, 3).map(x => x.card_no) })),
}, null, 2));
console.log('\n\n→ wrote tests/smoke/clause-analysis.json');