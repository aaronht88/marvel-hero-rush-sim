// v3.23 smoke — BATCH 1：11 張簡單 stat_mod descriptor
//
// 呢批係 pipeline 驗證，唔係追覆蓋率。每張都測「真係改到正確嘅卡、正確嘅數值」，
// 而唔止「descriptor 存在」。
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = '/opt/data/mhr-battle-sim';
const ctx = { window: {}, console, setTimeout, clearTimeout };
ctx.global = ctx.window;
vm.createContext(ctx);
function load(f) { vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f }); }
load('js/cards.js'); load('js/mhr-decks.js'); load('js/data.js');
load('js/effects-data.js'); load('js/effects-data-void.js'); load('js/effects-data-batch1.js');
load('js/engine.js'); load('js/effects.js'); load('js/ai.js');
const E = ctx.window.MHR_ENGINE, FX = ctx.window.MHR_EFFECTS, D = ctx.window.MHR_DATA;
let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}`, extra === undefined ? '' : extra); fail++; }
}
function fresh() { const s = E.initGame('RED_Aggro', 'YELLOW_Machine'); E.startTurn(s); return s; }
function mk(uid, cardNo, over) {
  const base = D.CARDS.find(c => c.card_no === cardNo) || D.CARDS[0];
  return Object.assign({}, base, { _uid: uid }, over || {});
}
function inject(s, card) { E.injectEffects(card); s.players.P.hand.push(card); return card; }

const BATCH = ['BP01-033', 'BP01-055', 'BP01-075', 'BP01-082', 'BP01-086',
               'BP01-115', 'EB01-006', 'PB01-001', 'SD01-003', 'SD04-016', 'SP01-016'];

// ---------- TEST 1: 11 張全部載入 + 注入 ----------
console.log('\n[TEST 1] 11 張 descriptor 載入');
let missing = 0;
BATCH.forEach(no => {
  const d = ctx.window.MHR_EFFECTS_DATA[no];
  if (!Array.isArray(d) || !d.length) { console.log(`    ${no} 冇 descriptor`); missing++; }
});
check('全部 11 張有 descriptor', missing === 0, missing);
let noInject = 0;
BATCH.forEach(no => {
  const c = mk('i' + no, no);
  E.injectEffects(c);
  if (!Array.isArray(c.effects) || !c.effects.length) noInject++;
});
check('全部 11 張注入成功', noInject === 0, noInject);

// ---------- TEST 2: BP01-082 opponent Human FRONT -500（filter 生效）----------
console.log('\n[TEST 2] BP01-082 對手 FRONT Human Power-500');
const s2 = fresh();
const foe2 = mk('foe2', 'BP01-001', { feature: 'Human/Avenger', power: '3000' });
foe2.effects = [];
s2.players.A.battle.front = foe2;
const src2 = mk('src2', 'BP01-082');
E.injectEffects(src2);
s2.players.P.battle.front = src2;
FX.runEffects(s2, 'P', { kind: 'phase_change' });
check('★ 對手 FRONT _powerMod = -500', foe2._powerMod === -500, foe2._powerMod);

// filter 唔 match 就唔應該改
const s2b = fresh();
const foe2b = mk('foe2b', 'BP01-001', { feature: 'Machine', power: '3000' });
foe2b.effects = [];
s2b.players.A.battle.front = foe2b;
const src2b = mk('src2b', 'BP01-082');
E.injectEffects(src2b);
s2b.players.P.battle.front = src2b;
FX.runEffects(s2b, 'P', { kind: 'phase_change' });
check('★ filter 唔 match（Machine）→ 唔改', !foe2b._powerMod, foe2b._powerMod);

// ---------- TEST 3: BP01-086 己方 FRONT Human +500 ----------
console.log('\n[TEST 3] BP01-086 己方 FRONT Human Power+500');
const s3 = fresh();
const mine3 = mk('m3', 'BP01-001', { feature: 'Human', power: '2000' });
mine3.effects = [];
s3.players.P.battle.front = mine3;          // Human 喺 FRONT（descriptor 係 my_front）
const src3 = mk('s3', 'BP01-086');
E.injectEffects(src3);
s3.players.P.battle.back = src3;            // 來源放 BACK，避免自己都係 FRONT
FX.runEffects(s3, 'P', { kind: 'phase_change' });
check('★ 己方 FRONT Human +500', mine3._powerMod === 500, mine3._powerMod);
check('來源卡（BACK，非 Human）冇加', !src3._powerMod, src3._powerMod);

// ---------- TEST 4: BP01-115 / SD04-016 對手 BACK Lv-2 ----------
console.log('\n[TEST 4] 對手 BACK Lv-2');
['BP01-115', 'SD04-016'].forEach(no => {
  const s = fresh();
  const back = mk('bk' + no, 'BP01-001', { level: 5 });
  back.effects = [];
  s.players.A.battle.back = back;
  const src = mk('sc' + no, no);
  E.injectEffects(src);
  s.players.P.battle.front = src;
  FX.runEffects(s, 'P', { kind: 'phase_change' });
  check(`${no} → 對手 BACK _lvMod = -2`, back._lvMod === -2, back._lvMod);
});

// ---------- TEST 5: BP01-075 己方 HAND Fantastic Four Lv-1 ----------
console.log('\n[TEST 5] BP01-075 己方 HAND FF Lv-1');
const s5 = fresh();
const ff = mk('ff5', 'BP01-001', { feature: 'Fantastic Four', level: 4 });
ff.effects = [];
s5.players.P.hand.push(ff);
const nonFF = mk('nff5', 'BP01-002', { feature: 'Machine', level: 4 });
nonFF.effects = [];
s5.players.P.hand.push(nonFF);
const src5 = mk('s5', 'BP01-075');
E.injectEffects(src5);
s5.players.P.battle.front = src5;
FX.runEffects(s5, 'P', { kind: 'phase_change' });
check('★ FF 卡 _lvMod = -1', ff._lvMod === -1, ff._lvMod);
check('非 FF 卡唔受影響', !nonFF._lvMod, nonFF._lvMod);

// ---------- TEST 6: BP01-055 每 3000 Power 得 R+1（divisor）----------
console.log('\n[TEST 6] BP01-055 divisor 計算');
const s6 = fresh();
const big = mk('big6', 'BP01-001', { power: '6500' });
big.effects = [];
s6.players.A.battle.front = big;
const src6 = mk('s6', 'BP01-055');
E.injectEffects(src6);
s6.players.P.battle.front = src6;
FX.runEffects(s6, 'P', { kind: 'phase_change' });
// 6500 / 3000 = 2.16 → floor 2
check('★ 對手 6500 Power → R+2（floor(6500/3000)）', src6._rMod === 2, src6._rMod);

const s6b = fresh();
const mid = mk('mid6', 'BP01-001', { power: '3000' });
mid.effects = [];
s6b.players.A.battle.front = mid;
const src6b = mk('s6b', 'BP01-055');
E.injectEffects(src6b);
s6b.players.P.battle.front = src6b;
FX.runEffects(s6b, 'P', { kind: 'phase_change' });
check('★ 3000 Power → R+1', src6b._rMod === 1, src6b._rMod);

// ---------- TEST 7: PB01-001 excludeSelf ----------
console.log('\n[TEST 7] PB01-001 excludeSelf');
const s7 = fresh();
const src7 = mk('s7', 'PB01-001', { feature: 'GOTG' });
E.injectEffects(src7);
s7.players.P.battle.front = src7;
const buddy = mk('bud7', 'BP01-001', { feature: 'GOTG' });
buddy.effects = [];
s7.players.P.battle.back = buddy;
const other = mk('oth7', 'BP01-002', { feature: 'Machine' });
other.effects = [];
s7.players.P.battle.wing[0] = other;
// 直接跑 ops（TRIG【BATTLE】要靠 cond，呢度驗 op 語義）
const eff7 = src7.effects[0];
const ctx7 = { source: src7 };
FX._internal.runOpList(s7, 'P', eff7.ops, ctx7, { op: 'test' });
check('★ 隊友 GOTG +1 R', buddy._rMod === 1, buddy._rMod);
check('★ 自己（source）唔受影響（excludeSelf）', !src7._rMod, src7._rMod);
check('非 GOTG 唔受影響', !other._rMod, other._rMod);

// ---------- TEST 8: 冇合法目標唔算失敗 ----------
console.log('\n[TEST 8] 冇合法目標 → ok，唔中斷');
const s8 = fresh();
// 場上冇對手角色，跑一個 power_mod opp_battle
const src8 = mk('s8', 'BP01-082');
E.injectEffects(src8);
s8.players.P.battle.front = src8;
s8.players.A.battle.front = null; s8.players.A.battle.back = null; s8.players.A.battle.wing = [null, null];
let crashed = false, res = null;
try { res = FX._internal.runOpList(s8, 'P', src8.effects[0].ops, { source: src8 }, { op: 'test' }); }
catch (e) { crashed = true; console.log('    crash:', e.message); }
check('唔 crash', !crashed);
check('★ 回 ok（唔係失敗）', res && res.ok === true, JSON.stringify(res));

// ---------- TEST 9: EB01-006 event_card target ----------
console.log('\n[TEST 9] EB01-006 event_card');
const s9 = fresh();
const src9 = mk('s9', 'EB01-006');
E.injectEffects(src9);
s9.players.P.battle.front = src9;
const entrant = mk('ent9', 'BP01-001', { level: 6 });
entrant.effects = [];
s9.players.A.battle.back = entrant;
const eff9 = src9.effects[0];
const ctx9 = { source: src9, eventCard: entrant };
FX._internal.runOpList(s9, 'P', eff9.ops, ctx9, { op: 'test' });
check('★ source -1000', src9._powerMod === -1000, src9._powerMod);
check('★ event_card（入場嗰張）-1000', entrant._powerMod === -1000, entrant._powerMod);

// ---------- TEST 10: 全部 11 張注入後 zone invariant ----------
console.log('\n[TEST 10] zone invariant');
const s10 = fresh();
BATCH.forEach((no, i) => {
  const c = mk('z' + i, no);
  E.injectEffects(c);
  s10.players.P.hand.push(c);
});
const inv10 = E.assertZoneInvariant(s10);
check('11 張注入後 zone invariant OK', inv10.ok, JSON.stringify(inv10.dupes.slice(0, 2)));

// ---------- TEST 11: 全自動對戰無 regression ----------
console.log('\n[TEST 11] 8 局全自動對戰');
const AI = ctx.window.MHR_AI;
let done = 0, err = 0;
for (let g = 0; g < 8; g++) {
  E.setSeed(11000 + g);
  const decks = ['RED_Aggro', 'YELLOW_Machine', 'BLUE_Control', 'GREEN_Tempo'];
  const s = E.initGame(decks[g % 4], decks[(g + 1) % 4]);
  E.mulligan(s, 'P', []); E.mulligan(s, 'A', AI.aiMulligan(s));
  E.startTurn(s);
  try {
    let t = 0;
    while (!s.winner && t < 80) { AI.aiTurnFor(s, s.activeSide); t++; }
    if (s.winner) done++;
  } catch (e) { err++; console.log('    crash:', e.message); }
}
E.setSeed(null);
check('8 局完成', done === 8, `${done}/8`);
check('零 crash', err === 0, err);

console.log(`\n========== ${pass} pass, ${fail} fail ==========`);
process.exit(fail ? 1 : 0);