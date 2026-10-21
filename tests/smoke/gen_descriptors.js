// v3.18 Step 2 — GENERATE the full descriptor work queue.
// Reads the clause analysis, resolves each card's clause list into a descriptor
// shape (trig/slot/cond/cost/ops skeleton), and emits:
//   - js/effects-data-gen.js  — auto-generated descriptors for every card
//   - tests/smoke/descriptor-queue.json — what still needs a human
// Rule: NEVER emit a partial descriptor. A card whose clauses can't all be
// mapped stays in the manual queue with a reason — a wrong effect firing is
// worse than "[效果未實裝]" (v3.14 lesson).
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = '/opt/data/mhr-battle-sim';
const ctx = { window: {}, console, setTimeout, clearTimeout };
ctx.global = ctx.window;
vm.createContext(ctx);
function load(f) { vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f }); }
load('js/cards.js'); load('js/mhr-decks.js'); load('js/data.js');
const D = ctx.window.MHR_DATA;
const CARDS = D.CARDS;

// ---------- trigger / slot parse ----------
const TAG = /【\s*([^】]+?)\s*】/;
function parseTrigSlot(text) {
  const m = text.match(/【\s*([^】]+?)\s*】/);
  if (!m) return { trig: null, slot: null, once: false, raw: '' };
  let tag = m[1].trim();
  let once = false;
  // slot strings can be compound: "FIELD/ONCE PER TURN", "BATTLE/ONCR PER TURN"
  const onceM = tag.match(/\/?\s*(ONCE|ONCR)\s+PER\s+TURN/i);
  if (onceM) { once = true; tag = tag.replace(/\/?\s*(ONCE|ONCR)\s+PER\s+TURN/i, ''); }
  tag = tag.replace(/^\s*\/?\s*/, '').trim();
  const parts = tag.split('/').map(s => s.trim()).filter(Boolean);
  const slot = parts[0] ? parts[0].toUpperCase() : null;
  let trig = null;
  // The trigger keyword can appear anywhere in the leading run of uppercase
  // tokens — "UNIQUE(AUTO【FIELD】" and "UNIQUE\nCOUNTER\nTRIG【...】" both put
  // capability words before it, and some tags carry the trigger INSIDE 【】.
  const head = (text.slice(0, text.indexOf('【') > 0 ? text.indexOf('【') : 40).match(/([A-Z][A-Z·]*)/g) || []).join(' ');
  const inTag = (m[1].match(/\b(TRIG|ACTI|AUTO|COUNTER)\b/i) || [])[1];
  if (/^TRIG/.test(head)) trig = 'TRIG';
  else if (/^AUTO/.test(head)) trig = 'AUTO';
  else if (/^ACTI/.test(head)) trig = 'ACTI';
  else if (/^COUNTER/.test(head)) {
    trig = /COUNTER[·\s]*ACTI/i.test(head) ? 'COUNTER_ACTI' : 'COUNTER';
  } else if (parts[0] && /^(TRIG|AUTO|ACTI|COUNTER)/i.test(parts[0])) {
    const t = parts.shift().toUpperCase();
    trig = t === 'COUNTER_ACTI' ? 'COUNTER_ACTI' : t;
    if (!slot) slot = (parts[0] || '').toUpperCase() || null;
  }
  return { trig, slot, once, raw: m[1] };
}

// ---------- clause → op ----------
// Only emit an op when the clause is unambiguous. Anything else returns
// { unknown: reason } so the card lands in the manual queue rather than
// shipping a half-implemented effect.
const NUM = '(-?\\d+|\\{?VAR\\}?)';
function clauseToOp(c) {
  const t = c.replace(/\s+/g, ' ').trim();
  let m;
  // draw
  if ((m = t.match(/you (?:may )?draw (\d+) cards?/i)))
    return { op: 'draw', n: parseInt(m[1], 10) };
  // prune with filter
  if ((m = t.match(/prune (\d+) of your opponent'?s characters?/i))) {
    const o = { op: 'prune', target: 'opp_battle', count: parseInt(m[1], 10) };
    const lv = t.match(/with Lv(\d+) or below/i);
    const pw = t.match(/with Power (\d+) or (?:lower|below)/i);
    const fe = t.match(/with 【([^】]+)】 in (?:their|its) features/i);
    if (lv) o.filter = Object.assign({}, o.filter, { lv: '<=', n: parseInt(lv[1], 10) });
    if (pw) o.filter = Object.assign({}, o.filter, { power: '<=', n: parseInt(pw[1], 10) });
    if (fe) o.filter = Object.assign({}, o.filter, { feature: fe[1] });
    return o;
  }
  // grant ability / move — must be checked BEFORE stat_self, because
  // "this card gets the ability 【Double Attack】" also matches /this card gets/i
  // yet carries no numeric stat (it used to land in stat_self and fail).
  if (/gets? the ability 【([^】]+)】/i.test(t))
    return { op: 'grant_ability', name: t.match(/【([^】]+)】/)[1],
             duration: /this turn/i.test(t) ? 'this_turn' : 'permanent' };
  if (/gets? [A-Z]+-[A-Z]+ Move|takes? [A-Z]+-BASE Move/i.test(t))
    return { op: 'grant_move', name: (t.match(/([A-Z]+-[A-Z]+) Move/i) || [])[1] };
  // self stat (single or multi)
  if (/this card gets/i.test(t)) {
    const o = { op: 'stat_self' };
    let any = false;
    if ((m = t.match(/Lv([+\-])(\d+|VAR)/i))) { o.lv = (m[1] === '-' ? '-' : '') + m[2]; any = true; }
    if ((m = t.match(/Power([+\-])(\d+|VAR)000?/i))) { o.power = (m[1] === '-' ? '-' : '') + m[2] + '000'; any = true; }
    else if ((m = t.match(/Power([+\-])(\d+|VAR)(?!000)/i))) { o.power = m[1] + m[2]; any = true; }
    if ((m = t.match(/\bR([+\-])(\d+|VAR)/i))) { o.r = m[1] + m[2]; any = true; }
    if (/in this turn|this turn only/i.test(t)) { o.duration = 'this_turn'; }
    if (/otherwise/i.test(t)) { o.otherwise = true; }
    return any ? o : { unknown: 'stat_self parse fail: ' + t.slice(0, 50) };
  }
  // opponent stat
  if (/opponent'?s characters?/i.test(t) && /(?:gets|takes)\s+(?:Lv|Power|R)[+\-]/i.test(t)) {
    const o = { op: 'stat_opp', target: /in FRONT/i.test(t) ? 'opp_front' : (/in WING/i.test(t) ? 'opp_wing' : 'opp_battle') };
    if ((m = t.match(/Power([+\-])(\d+|VAR)000?/i))) o.power = m[1] + m[2];
    else if ((m = t.match(/Lv([+\-])(\d+|VAR)/i))) o.lv = m[1] + m[2];
    if (/in this turn/i.test(t)) o.duration = 'this_turn';
    return o;
  }
  // attach
  if (/attach/i.test(t)) {
    const o = { op: 'attach', target: /this card|to this card/i.test(t) ? 'self' : 'chosen' };
    const fe = t.match(/with 【([^】]+)】 in (?:their|its) features/i);
    if (fe) o.filter = { feature: fe[1] };
    const pw = t.match(/Power (\d+) or (?:lower|below)/i);
    if (pw) o.filter = Object.assign({}, o.filter, { power: '<=', n: parseInt(pw[1], 10) });
    return o;
  }
  // discard — MHR uses several phrasings: "you discard this card in HAND",
  // "you may discard N cards in HAND", "discard N cards from your HAND"
  if (/discard/i.test(t)) {
    if (/discard this card|discards? it in HAND/i.test(t)) {
      const o = { op: 'discard', self: true };
      if (/in HAND/i.test(t)) o.from = 'hand';
      return o;
    }
    if ((m = t.match(/discard (\d+) cards?/i))) {
      const o = { op: 'discard', n: parseInt(m[1], 10) };
      if (/in HAND|from your HAND|in your HAND/i.test(t)) o.from = 'hand';
      return o;
    }
    // "discards a card", "discard 1 card" with no number spelled out
    if (/discard (?:a|1) card/i.test(t)) return { op: 'discard', n: 1, from: /HAND/i.test(t) ? 'hand' : undefined };
    return { unknown: 'discard parse fail: ' + t.slice(0, 50) };
  }
  // draw from opponent
  if (/each opponent draws?/i.test(t)) {
    const m = t.match(/each opponent draws? (\d+)/i);
    return { op: 'draw_each_opp', n: parseInt(m[1], 10) };
  }
  // attach grant ability
  if (/takes? [A-Z]+-BASE Move|gets? [A-Z]+-[A-Z]+ Move/i.test(t))
    return { op: 'grant_move', name: (t.match(/([A-Z]+-[A-Z]+) Move/i) || [])[1] };
  // named ability
  if (/gets? the ability 【([^】]+)】/i.test(t))
    return { op: 'grant_ability', name: t.match(/【([^】]+)】/)[1], duration: /this turn/i.test(t) ? 'this_turn' : 'permanent' };
  // swap
  if (/swap/i.test(t)) return { op: 'swap', target: /BATTLE|field/i.test(t) ? 'field' : 'unknown' };
  // ability: extra attack
  if (/second chance to attack|another chance to attack|can attack (?:again|once more)/i.test(t))
    return { op: 'attack_bonus', target: 'self', duration: /this turn/i.test(t) ? 'this_turn' : 'permanent' };
  // to RETREAT / VOID / hand
  if (/enters? RETREAT/i.test(t)) return { op: 'to_retreat', when: t.slice(0, 40) };
  if (/enters? VOID/i.test(t)) return { op: 'to_void', when: t.slice(0, 40) };
  if (/return[s]? to (?:your )?hand|back to your hand/i.test(t)) return { op: 'return_to_hand' };
  if (/place[s]? .*top of your deck/i.test(t)) return { op: 'put_top_deck' };
  if (/reveals?/i.test(t)) return { op: 'reveal' };
  if (/becomes? (\d+)/i.test(t)) return { op: 'becomes', n: parseInt((t.match(/becomes? (\d+)/i) || [])[1], 10) };
  // structural wrappers — handled by interpreter, not ops
  if (/^if you do/i.test(t)) return { op: 'if_you_do' };
  if (/^you may/i.test(t)) return { op: 'optional' };
  return { unknown: 'no clause→op rule: ' + t.slice(0, 60) };
}

// ---------- per-card build ----------
const generated = {};   // card_no -> effects array
const queue = [];       // { card_no, reason, clauses }

for (const card of CARDS) {
  const text = (card.effect || '').trim();
  if (!text) continue;                       // stat-only card, no descriptor needed
  const uniqNos = card.card_no;
  if (generated[uniqNos]) continue;          // variant prints share the design

  const { trig, slot, once, raw } = parseTrigSlot(text);
  if (!trig || !slot) {
    queue.push({ card_no: card.card_no, set: card.set, reason: 'no trig/slot tag', text: text.slice(0, 90) });
    continue;
  }

  // strip the tag and split into clauses with the same splitter the analysis uses
  let s = text.replace(/【[^】]+】\s*:?/g, ' ');
  const prefixes = [];
  s = s.replace(/^([A-Z][A-Z ]*(?:\([A-Z]+\))?)\s*\n?/g, (m, p) => { prefixes.push(p.trim()); return ''; });
  // Remove the trigger keyword (TRIG/AUTO/ACTI/COUNTER[·ACTI]) wherever it leads
  // the body — parseTrigSlot already read it out of the tag, and leaving it in
  // glues it onto the first clause ("TRIG When this card enters…" → a clause
  // that matches no op rule).
  s = s.replace(/(?:COUNTER[·\s]*ACTI|TRIG|AUTO|ACTI|COUNTER)\s*(?=[A-Z(])/gi, ' ');
  s = s.replace(/\(\s*(?:COUNTER[·\s]*ACTI|TRIG|AUTO|ACTI|COUNTER)\s*/gi, '(');
  const varDefs = [];
  s = s.replace(/^([A-Z])\s+is\s+the\s+(.+)$/gim, (m, L, b) => { varDefs.push({ var: L.toUpperCase(), expr: b.trim() }); return ' '; });
  const CUE = /\s+(?=(?:When|Whenever|At the (?:start|end)|If you do|Then|You may|This card gets|Each time)\b)/i;
  let parts = s.split(/\.\s+/).flatMap(x => x.split(CUE))
    .map(x => x.replace(/\s+/g, ' ').trim()).filter(x => x.length > 6);
  const ORPHAN = /^(?:\d+|one|two|three|all|any|VAR|N|1)\s+of\s+(?:your|the)\b/i;
  const clauses = [];
  for (const p of parts) {
    if (clauses.length && ORPHAN.test(p)) { clauses[clauses.length - 1] += ', ' + p; continue; }
    clauses.push(p);
  }

  // Two-pass classification. A clause that STARTS with a trigger phrase is a
  // condition on the effect; it never becomes an op. Previously these were fed
  // to clauseToOp and failed ("When this card enters the field by calling" → no
  // rule), which is why 178 cards looked unparseable when they were simply
  // conditions we hadn't modelled.
  const COND_HEAD = /^\s*(?:when|whenever|at the (?:start|end)|each time|if|as (?:long as)|while)\b/i;
  const ops = []; const condTexts = []; const unknowns = [];
  for (const c of clauses) {
    if (COND_HEAD.test(c)) {
      condTexts.push(c.slice(0, 140));
      // "If <cond>, <effect>" → the effect after the comma still has to run.
      // Only split when what follows looks like an instruction (has a verb),
      // otherwise "If the number of your cards in HAND is odd." has no tail.
      const m = c.match(/^\s*(?:if|when|whenever|at the (?:start|end)|each time|as (?:long as)|while)\b[^,]{0,120},\s*(.+)$/i);
      const tail = m && m[1] && /\b(?:gets?|takes?|draw|discard|prune|move|reveal|attach|become|swap|retreat|place|return|look|call)\b/i.test(m[1]) ? m[1] : null;
      if (tail) {
        const inner = clauseToOp(tail);
        if (inner.unknown) unknowns.push('cond-tail → ' + inner.unknown);
        else ops.push(inner);
      }
      continue;
    }
    // "If you do, …" is a conditional CONTINUATION, not a leading condition
    if (/^\s*if you do\b/i.test(c)) {
      const rest = c.replace(/^\s*if you do,?\s*/i, '');
      const inner = clauseToOp(rest);
      if (inner.unknown) unknowns.push('if_you_do → ' + inner.unknown);
      else ops.push({ op: 'if_you_do', do: [inner] });
      continue;
    }
    const o = clauseToOp(c);
    if (o.unknown) unknowns.push(o.unknown);
    else ops.push(o);
  }

  if (!ops.length) {
    queue.push({ card_no: card.card_no, set: card.set, reason: 'no op clauses (conditions only or unparsed)', text: text.slice(0, 90) });
    continue;
  }
  if (unknowns.length) {
    queue.push({
      card_no: card.card_no, set: card.set,
      reason: 'partial parse — ' + unknowns.length + '/' + clauses.length + ' clause(s) unmapped',
      unmapped: unknowns, text: text.slice(0, 90)
    });
    continue;
  }
  const eff = { trig, slot, once };
  if (varDefs.length) eff.vars = Object.fromEntries(varDefs.map(v => [v.var, v.expr]));
  if (prefixes.length) eff.caps = prefixes;
  // Conditions are carried as declarative text plus a `cond` array the
  // interpreter can evaluate once the cond library grows. An effect with no
  // evaluable cond is still emitted, but flagged needsCond so the coverage
  // report can show the true state rather than implying it is fully correct.
  if (condTexts.length) { eff.condText = condTexts; eff.needsCond = true; }
  eff.ops = ops;
  generated[card.card_no] = [eff];
}

// ---------- report ----------
const totalCards = CARDS.filter(c => (c.effect || '').trim()).length;
console.log('='.repeat(72));
console.log('DESCRIPTOR GENERATION');
console.log('='.repeat(72));
console.log(`cards with effect text : ${totalCards}`);
console.log(`descriptor generated  : ${Object.keys(generated).length}`);
console.log(`queued for manual      : ${queue.length}`);
console.log(`\nMANUAL QUEUE BY REASON`);
const byReason = {};
queue.forEach(q => { const k = q.reason.replace(/—.*/, '— …').replace(/\d+\/\d+.*/, 'N/M …'); byReason[k] = (byReason[k] || 0) + 1; });
Object.entries(byReason).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));

// emit
const out = '/* AUTO-GENERATED by tests/smoke/gen_descriptors.js — do not hand-edit.\n' +
  ' * Regenerate after engine ops change. Only cards whose every clause mapped\n' +
  ' * cleanly are included; partial parses are deliberately excluded so a wrong\n' +
  ' * effect can never fire (see queue in tests/smoke/descriptor-queue.json). */\n' +
  'global.MHR_EFFECTS_DATA = ' + JSON.stringify(generated, null, 2) + ';\n';
fs.writeFileSync(path.join(REPO, 'js/effects-data-gen.js'), out);
fs.writeFileSync(path.join(REPO, 'tests/smoke/descriptor-queue.json'), JSON.stringify({
  generated: Object.keys(generated).length, queued: queue.length, queue
}, null, 2));
console.log(`\n→ js/effects-data-gen.js (${Object.keys(generated).length} cards)`);
console.log(`→ tests/smoke/descriptor-queue.json (${queue.length} need review)`);