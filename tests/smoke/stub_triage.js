// v3.23 — STUB TRIAGE
// 220 個 STUB 之中，邊啲而家用現有 op set 就寫得？邊啲要新 op？
// 唔估，逐張分類。
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = '/opt/data/mhr-battle-sim';
const ctx = { window: {}, console, setTimeout, clearTimeout };
ctx.global = ctx.window;
vm.createContext(ctx);
function load(f) { vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f }); }
load('js/cards.js'); load('js/mhr-decks.js'); load('js/data.js');
load('js/effects-data.js'); load('js/effects-data-void.js'); load('js/effects-data-batch1.js');
load('js/engine.js'); load('js/effects.js'); load('js/ai.js');
const D = ctx.window.MHR_DATA, E = ctx.window.MHR_ENGINE;

const haveDsl = new Set(Object.keys(ctx.window.MHR_EFFECTS_DATA || {}));

// 現有 op 真正實作咗嘅機制（對應 neededMechanisms 嘅名字）
const MECH_IMPLEMENTED = new Set([
  'discard', 'prune', 'draw', 'zone_transfer', 'void_return', 'to_retreat', 'to_void',
  'deck_top', 'you_may', 'if_you_do', 'choose_one', 'stat_mod', 'reveal',
  'attack_bonus', 'capability_only',
  // 'protection' / 'unique_cap' 係常駐規則，engine 未 enforce，但唔阻塞 descriptor
  'protection', 'unique_cap', 'detach',
]);
// 真正缺 op 嘅（寫入 descriptor 會 log 未實裝）
const OPS_STILL_STUB = new Set(['move', 'attach', 'face_down', 'show', 'return_to_hand', 'rush_point', 'swap', 'stat_exact', 'grant_ability']);

// 由 effect 文本推斷需要邊啲「機制」
function neededMechanisms(t) {
  const need = [];
  // 純能力宣告行（COUNTER(AUTO【HAND】: This card may be called in COUNTER PHASE…)
  // 唔需要任何 op —— 佢只係標記「呢張卡可以喺應對階段號召」
  const isPureCapability = /^\s*(?:UNIQUE\s*)?\(?\s*COUNTER\s*\(?\s*AUTO【HAND】\s*[:：]\s*This card may be called in COUNTER/i.test(t);
  if (isPureCapability) return ['capability_only'];

  if (/\battach\b/i.test(t)) need.push('attach');
  if (/\bdetach|解除/i.test(t)) need.push('detach');
  if (/\bdiscard/i.test(t)) need.push('discard');
  if (/\bprune/i.test(t)) need.push('prune');
  if (/\bdraw /i.test(t)) need.push('draw');
  if (/place .* from VOID|from VOID/i.test(t)) need.push('void_return');
  // zone_transfer：任何 "place X from A into/onto B"
  if (/place[s]? .{0,80}from (?:HAND|RETREAT|VOID|BATTLE|BASE|DECK)/i.test(t)) need.push('zone_transfer');
  if (/place[s]? .{0,60}(?:into|onto) (?:your |the )?(?:BATTLE|BASE|field|RETREAT)/i.test(t)) need.push('zone_transfer');
  if (/enters? RETREAT|move .* RETREAT|→ RETREAT/i.test(t)) need.push('to_retreat');
  if (/enters? VOID/i.test(t)) need.push('to_void');
  if (/\bmove\b/i.test(t)) need.push('move');
  if (/\bswap\b/i.test(t)) need.push('swap');
  if (/top \d+ cards? of your deck|top of your deck/i.test(t)) need.push('deck_top');
  if (/face down/i.test(t)) need.push('face_down');
  if (/\breveals?\b/i.test(t)) need.push('reveal');
  // 數值：+/- 同 "change(s) to N" 都要
  if (/(?:Power|Lv|R)\s*[+\-]\s*\d|(?:Power|Lv|R)\s*[+\-]\s*X/i.test(t)) need.push('stat_mod');
  if (/(?:Power|Lv|R)\s+(?:of[^.]{0,60})?changes? to \d/i.test(t)) need.push('stat_exact');
  if (/gets? the ability|gains? the ability/i.test(t)) need.push('grant_ability');
  if (/second chance|attack again|can attack/i.test(t)) need.push('attack_bonus');
  if (/\bYou may\b/i.test(t)) need.push('you_may');
  if (/\bIf you do\b/i.test(t)) need.push('if_you_do');
  if (/\bor\b/i.test(t) && /\byou (?:may )?(?:prune|discard|place)/i.test(t)) need.push('choose_one');
  if (/cannot be affected|can ?not be attacked/i.test(t)) need.push('protection');
  if (/same name/i.test(t)) need.push('unique_cap');
  if (/rush point|time ?line/i.test(t)) need.push('rush_point');
  return [...new Set(need)];
}

// 由文本抽 trig/slot
function trigSlot(t) {
  const m = t.match(/(TRIG|ACTI|AUTO|COUNTER[·\s]*ACTI|COUNTER)\s*【\s*([^】]+?)\s*】/);
  if (!m) return { trig: null, slot: null };
  let trig = m[1].toUpperCase().replace(/[·\s]+/g, '_');
  let slot = m[2].split('/')[0].trim().toUpperCase();
  const once = /ONCE PER TURN|ONCR PER TURN/i.test(m[2]);
  return { trig, slot, once };
}

const stubs = [];
for (const c of D.CARDS) {
  const t = (c.effect || '').trim();
  if (!t) continue;
  if (haveDsl.has(c.card_no)) continue;
  stubs.push({ card_no: c.card_no, set: c.set, level: c.level, name: c.name, text: t });
}

// dedupe by card_no
const seen = new Set();
const uniq = stubs.filter(s => { if (seen.has(s.card_no)) return false; seen.add(s.card_no); return true; });

// 分類
const buckets = { ready: [], needsOp: [], needsNew: [], unparseable: [] };
for (const s of uniq) {
  const ts = trigSlot(s.text);
  const mech = neededMechanisms(s.text);
  if (!ts.trig || !ts.slot) { buckets.unparseable.push({ ...s, mech }); continue; }
  const missingOps = mech.filter(m => OPS_STILL_STUB.has(m));
  const unknownMech = mech.filter(m => !MECH_IMPLEMENTED.has(m) && !OPS_STILL_STUB.has(m));
  if (missingOps.length === 0 && unknownMech.length === 0) buckets.ready.push({ ...s, ts, mech });
  else if (missingOps.length <= 1 && unknownMech.length === 0) buckets.needsOp.push({ ...s, ts, mech, missingOps });
  else buckets.needsNew.push({ ...s, ts, mech, missingOps, unknownMech });
}

console.log('='.repeat(74));
console.log('STUB TRIAGE — 邊啲而家寫得');
console.log('='.repeat(74));
console.log(`unique stub cards : ${uniq.length}`);
console.log(`  ✓ READY（現有 op 夠用）      : ${buckets.ready.length}`);
console.log(`  △ NEEDS 1 OP（要補一個 op）   : ${buckets.needsOp.length}`);
console.log(`  ✗ NEEDS NEW MECHANISM        : ${buckets.needsNew.length}`);
console.log(`  ? no trig/slot tag           : ${buckets.unparseable.length}`);

const bySet = {};
uniq.forEach(s => { bySet[s.set] = bySet[s.set] || { total: 0 }; bySet[s.set].total++; });
buckets.ready.forEach(s => { bySet[s.set].ready = (bySet[s.set].ready || 0) + 1; });
console.log('\n' + '-'.repeat(74));
console.log('READY per set');
console.log('-'.repeat(74));
console.log('set       stubs  ready');
Object.entries(bySet).sort((a, b) => b[1].total - a[1].total).forEach(([k, v]) => {
  console.log(k.padEnd(10), String(v.total).padStart(5), String(v.ready || 0).padStart(6));
});

// READY 的機制分佈（決定實作次序）
const mechCount = {};
buckets.ready.forEach(s => s.mech.forEach(m => { mechCount[m] = (mechCount[m] || 0) + 1; }));
console.log('\n' + '-'.repeat(74));
console.log('READY 需要嘅機制（出現次數）');
console.log('-'.repeat(74));
Object.entries(mechCount).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(16)} ${v}`));

// trig×slot 分佈
const tsCount = {};
buckets.ready.forEach(s => { const k = `${s.ts.trig}【${s.ts.slot}】`; tsCount[k] = (tsCount[k] || 0) + 1; });
console.log('\n' + '-'.repeat(74));
console.log('READY by trigger×slot');
console.log('-'.repeat(74));
Object.entries(tsCount).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(26)} ${v}`));

console.log('\n' + '-'.repeat(74));
console.log(`NEEDS 1 OP（${buckets.needsOp.length}）— 補咗呢啲 op 就多幾多張`);
console.log('-'.repeat(74));
const opNeed = {};
buckets.needsOp.forEach(s => s.missingOps.forEach(o => { opNeed[o] = (opNeed[o] || 0) + 1; }));
Object.entries(opNeed).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(16)} ${v}`));

console.log('\n' + '-'.repeat(74));
console.log('SAMPLE READY cards (first 25)');
console.log('-'.repeat(74));
buckets.ready.slice(0, 25).forEach(s =>
  console.log(`  ${s.card_no.padEnd(11)} ${s.set.padEnd(6)} ${String(s.ts.trig + '【' + s.ts.slot + '】').padEnd(22)} ${s.text.slice(0, 62)}`));

fs.writeFileSync(path.join(REPO, 'tests/smoke/stub-triage.json'), JSON.stringify({
  totals: {
    unique: uniq.length, ready: buckets.ready.length,
    needsOp: buckets.needsOp.length, needsNew: buckets.needsNew.length,
    unparseable: buckets.unparseable.length,
  },
  bySet, mechCount, tsCount, opNeed,
  ready: buckets.ready.map(s => ({ card_no: s.card_no, set: s.set, trig: s.ts.trig, slot: s.ts.slot, mech: s.mech, text: s.text })),
  needsOp: buckets.needsOp.map(s => ({ card_no: s.card_no, set: s.set, missingOps: s.missingOps, text: s.text })),
}, null, 2));
console.log('\n→ tests/smoke/stub-triage.json');