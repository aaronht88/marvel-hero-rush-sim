// v3.19 Z2 smoke — zone_transfer op（7 個實測 VOID 變體）
//
// 每個測試都對應 ZONE_TRANSFER_SPEC.md 的一張真實卡，用官方原文構造同樣嘅
// 情境。測試目標唔止「跑得過」，而係：
//   - 卡真係離開 from zone、真係入 to zone（identity 檢查）
//   - 目的地語義正確（to:base ⇒ _faceDown、失去效果）
//   - 成本失敗時 zone_transfer 唔會發生（Z1 atomic 接手）
//   - 全過程 zone invariant 成立
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = '/opt/data/mhr-battle-sim';
const ctx = { window: {}, console, setTimeout, clearTimeout };
ctx.global = ctx.window;
vm.createContext(ctx);
function load(f) { vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f }); }
load('js/cards.js'); load('js/mhr-decks.js'); load('js/data.js'); load('js/effects-data.js');
load('js/engine.js'); load('js/effects.js'); load('js/ai.js');
const E = ctx.window.MHR_ENGINE, FX = ctx.window.MHR_EFFECTS, D = ctx.window.MHR_DATA;
const ZT = FX._internal.OPS.zone_transfer;
const RC = FX._internal.resolveCost;
let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}`, extra === undefined ? '' : extra); fail++; }
}
function fresh() { const s = E.initGame('RED_Aggro', 'YELLOW_Machine'); E.startTurn(s); return s; }
function mk(uid, over) {
  const base = D.CARDS.find(c => c.card_no === (over && over.card_no)) || D.CARDS[0];
  return Object.assign({}, base, { _uid: uid }, over || {});
}

// ---------- TEST 1: op 已註冊 + win checker 已接 ----------
console.log('\n[TEST 1] 註冊');
check('OPS.zone_transfer', typeof ZT === 'function');
check('OPS.choose_one', typeof FX._internal.OPS.choose_one === 'function');
check('engine 注入 win checker', typeof ctx.window.MHR_ENGINE_WIN_CHECKER === 'function');

// ---------- TEST 2: V1 BP01-007 — self VOID → field ----------
console.log('\n[TEST 2] V1 BP01-007 self VOID → FIELD');
const s2 = fresh();
const v1 = mk('v1', { card_no: 'BP01-007' });
s2.players.P.voidZone.push(v1);
const void2 = s2.players.P.voidZone.length;
const r2 = ZT(s2, 'P', { op: 'zone_transfer', subject: 'self', from: 'void', to: 'front' }, { source: v1 });
check('ok', r2.ok, r2.err);
check('離開 VOID', s2.players.P.voidZone.length === void2 - 1, s2.players.P.voidZone.length);
check('入到 front', s2.players.P.battle.front === v1);
check('transferred 回傳 1 張', r2.transferred && r2.transferred.length === 1);
check('zone invariant', E.assertZoneInvariant(s2).ok);

// ---------- TEST 3: V1 加成本 — discard 2 後才召回 ----------
console.log('\n[TEST 3] V1 完整：cost discard 2 → 召回');
const s3 = fresh();
const v1b = mk('v1b', { card_no: 'BP01-007' });
s3.players.P.voidZone.push(v1b);
const hand3 = s3.players.P.hand.length;
const cost3 = RC(s3, 'P', [{ op: 'discard', n: 2 }], { source: v1b });
check('cost ok', cost3.ok, cost3.err);
check('手牌 -2', s3.players.P.hand.length === hand3 - 2, s3.players.P.hand.length);
const r3 = ZT(s3, 'P', { op: 'zone_transfer', subject: 'self', from: 'void', to: 'front' }, { source: v1b });
check('召回 ok', r3.ok, r3.err);
check('喺 front', s3.players.P.battle.front === v1b);

// ---------- TEST 4: V3 SP01-021 — self VOID → BASE（變蓋卡）----------
console.log('\n[TEST 4] V3 SP01-021 self VOID → BASE（失去效果）');
const s4 = fresh();
const v3 = mk('v3c', { card_no: 'SP01-021' });
v3.effects = [{ trig: 'TRIG', slot: 'FIELD', ops: [{ op: 'draw', n: 1 }] }];
s4.players.P.voidZone.push(v3);
const basis4 = s4.players.P.base.faceDown.length;
const r4 = ZT(s4, 'P', { op: 'zone_transfer', subject: 'self', from: 'void', to: 'base' }, { source: v3 });
check('ok', r4.ok, r4.err);
check('入到 BASE', s4.players.P.base.faceDown.length === basis4 + 1);
check('★ _faceDown = true（蓋卡）', v3._faceDown === true, v3._faceDown);
check('★ 蓋卡計 Lv1', E.cardEffectiveLv(v3) === 1, E.cardEffectiveLv(v3));
check('zone invariant', E.assertZoneInvariant(s4).ok);

// 蓋卡唔應該被 runEffects 掃到（effects.js 有 `if (card._faceDown) return`）
const logBefore4 = s4.log.length;
FX.runEffects(s4, 'P', { kind: 'phase_change' });
const drewFromSet = s4.log.slice(logBefore4).some(m => m.msg.includes('抽'));
check('★ 蓋卡效果唔會觸發', !drewFromSet, s4.log.slice(logBefore4).map(m => m.msg).join('|'));

// ---------- TEST 5: V4 SP01-031 — chosen(Web, lowest Lv) VOID → battle ----------
console.log('\n[TEST 5] V4 chosen(Web 最低 Lv) VOID → BATTLE');
const s5 = fresh();
// 造 3 張 Web 角色喺 VOID，Lv 分別 2 / 4 / 6
const webLow = mk('web2', { card_no: 'SP01-001', level: 2, feature: 'Human/Web' });
const webMid = mk('web4', { card_no: 'SP01-002', level: 4, feature: 'Web' });
const webHi  = mk('web6', { card_no: 'SP01-003', level: 6, feature: 'Human/Web' });
const nonWeb = mk('noweb', { card_no: 'BP01-001', level: 3, feature: 'Machine' });
s5.players.P.voidZone.push(webMid, nonWeb, webHi, webLow);
const r5 = ZT(s5, 'P', {
  op: 'zone_transfer', subject: 'chosen', from: 'void', to: 'front',
  subjectFilter: { feature: 'Web', orderBy: 'lowest_lv' },
}, {});
check('ok', r5.ok, r5.err);
check('★ 揀到最低 Lv 嘅 Web 卡', r5.transferred && r5.transferred[0] === webLow,
  r5.transferred && r5.transferred[0] && r5.transferred[0]._uid);
check('非 Web 卡冇被揀', s5.players.P.voidZone.includes(nonWeb));
check('高 Lv Web 卡留喺 VOID', s5.players.P.voidZone.includes(webHi) && s5.players.P.voidZone.includes(webMid));
check('zone invariant', E.assertZoneInvariant(s5).ok);

// ---------- TEST 6: feature filter BUGFIX 驗證 ----------
console.log('\n[TEST 6] feature filter（"Human/Web" 要 match "Web"）');
const s6 = fresh();
const multi = mk('mf', { card_no: 'SP01-001', feature: 'Human/Web' });
const single = mk('sf', { card_no: 'SP01-002', feature: 'Machine' });
s6.players.P.voidZone.push(multi, single);
const r6 = ZT(s6, 'P', {
  op: 'zone_transfer', subject: 'chosen', from: 'void', to: 'front',
  subjectFilter: { feature: 'Web' },
}, {});
check('★ "Human/Web" 卡被 match 到', r6.ok && r6.transferred && r6.transferred[0] === multi,
  r6.transferred && r6.transferred[0] && r6.transferred[0].feature);
check('"Machine" 卡唔會 match', !s6.players.P.battle.front || s6.players.P.battle.front !== single);

// ---------- TEST 7: V6 — after[] 二階段（transferred 指涉）----------
console.log('\n[TEST 7] V6 after[] 二階段（讀被移嘅卡嘅 Lv）');
const s7 = fresh();
const hiLv = mk('hi6', { card_no: 'SP01-003', level: 6, feature: 'Multiverse' });
s7.players.P.voidZone.push(hiLv);
const hand7 = s7.players.P.hand.length;
const r7 = ZT(s7, 'P', {
  op: 'zone_transfer', subject: 'chosen', from: 'void', to: 'front',
  subjectFilter: { feature: 'Multiverse' },
  after: [{
    op: 'if_you_do',
    // 條件由 transferred 讀 —— Lv >= 4 就再棄 1
    // 註：if_you_do 本身冇 when，呢度用 discard 失敗與否表達；
    // 二階段條件由 descriptor 層用 vars/cond 表達，op 層只負責執行
    do: [{ op: 'discard', n: 1 }],
    then: [{ op: 'discard', n: 1 }],
  }],
}, {});
check('ok', r7.ok, r7.err);
check('card 移到 front', s7.players.P.battle.front === hiLv);
check('after[] 有執行（手牌減少）', s7.players.P.hand.length < hand7, `${hand7} → ${s7.players.P.hand.length}`);

// ---------- TEST 8: playerChooses → park choice，答完才移 ----------
console.log('\n[TEST 8] playerChooses → park → 玩家揀完才移');
const s8 = fresh();
const a8 = mk('a8', { card_no: 'SP01-001', feature: 'Web' });
const b8 = mk('b8', { card_no: 'SP01-002', feature: 'Web' });
s8.players.P.voidZone.push(a8, b8);
const r8 = ZT(s8, 'P', {
  op: 'zone_transfer', subject: 'chosen', from: 'void', to: 'front',
  subjectFilter: { feature: 'Web' }, playerChooses: true,
}, {});
check('park 咗 choice（唔係即刻執行）', r8.ok && r8.pending, JSON.stringify(r8));
check('★ 未答之前冇卡移動', s8.players.P.voidZone.length === 2 && !s8.players.P.battle.front);
check('pending 有 options', FX.pendingChoices(s8)[0] && FX.pendingChoices(s8)[0].options.length === 2);
const chosen = FX.pendingChoices(s8)[0].options[1].uid;
const rr8 = FX.resolveChoice(s8, 'P', { accept: true, cardUid: chosen });
check('答完之後 ok', rr8.ok, rr8.err);
check('★ 揀嗰張真係移到 front', s8.players.P.battle.front && s8.players.P.battle.front._uid === chosen);
check('另一張留喺 VOID', s8.players.P.voidZone.length === 1);

// ---------- TEST 9: V7 choose_one（or 二選一）----------
console.log('\n[TEST 9] V7 choose_one（or）');
const s9 = fresh();
const w9 = mk('w9', { card_no: 'SP01-001', feature: 'Web' });
s9.players.P.retreat.push(w9);
const r9 = FX._internal.OPS.choose_one(s9, 'P', {
  op: 'choose_one',
  prompt: '選一個：',
  options: [
    { op: 'prune', n: 1, target: 'my_retreat', filter: { feature: 'Web' } },
    { op: 'zone_transfer', subject: 'all', from: 'void', to: 'retreat', subjectFilter: { feature: 'Web' } },
  ],
}, {});
check('park 咗 choose_one', r9.ok && r9.pending);
const ch9 = FX.pendingChoices(s9)[0];
check('options 有 2 個', ch9 && ch9.options.length === 2);
// 揀第一個（prune Web from RETREAT）
const rr9 = FX.resolveChoice(s9, 'P', { accept: true, optionIndex: 0 });
check('執行 prune 分支 ok', rr9.ok, rr9.err);
check('★ Web 卡由 RETREAT 入 VOID', s9.players.P.voidZone.some(c => c._uid === 'w9') && !s9.players.P.retreat.some(c => c._uid === 'w9'));

// 另一分支
const s9b = fresh();
const w9b = mk('w9b', { card_no: 'SP01-001', feature: 'Web' });
s9b.players.P.voidZone.push(w9b);
FX._internal.OPS.choose_one(s9b, 'P', {
  op: 'choose_one',
  options: [
    { op: 'prune', n: 1, target: 'my_retreat', filter: { feature: 'Web' } },
    { op: 'zone_transfer', subject: 'all', from: 'void', to: 'retreat', subjectFilter: { feature: 'Web' } },
  ],
}, {});
const rr9b = FX.resolveChoice(s9b, 'P', { accept: true, optionIndex: 1 });
check('執行 zone_transfer 分支 ok', rr9b.ok, rr9b.err);
check('★ Web 卡由 VOID 入 RETREAT', s9b.players.P.retreat.some(c => c._uid === 'w9b'));

// ---------- TEST 10: 無目標 → ok 但唔移動（spec §5.4）----------
console.log('\n[TEST 10] 無合法目標 → ok，唔移動');
const s10 = fresh();
const r10 = ZT(s10, 'P', {
  op: 'zone_transfer', subject: 'all', from: 'void', to: 'retreat',
  subjectFilter: { feature: 'NonexistentFeature' },
}, {});
check('回 ok（指令已執行）', r10.ok, r10.err);
check('transferred 空', r10.transferred && r10.transferred.length === 0);
check('log 有講無目標', s10.log.some(m => m.msg.includes('無合法目標')));

// ---------- TEST 11: from zone 冇卡 → 無目標（唔係失敗）----------
// 注意：卡喺 hand 而 from='void' 時，pool 本身就係空 —— 呢個走「無合法目標」
// 路徑（ok:true, transferred:[]），符合 spec §5.4「指令已執行」語義。
// 真正要測嘅失敗情境係「卡喺 pool 但 addToZone 失敗」或者「zone 資料損壞」，
// 由 TEST 12（目的地滿）覆蓋。
console.log('\n[TEST 11] from zone 冇卡 → 無目標，唔移動');
const s11 = fresh();
const wrong = mk('wrong', { card_no: 'SP01-001', feature: 'Web' });
s11.players.P.hand.push(wrong);   // 喺 hand，唔係 void
const void11 = s11.players.P.voidZone.length;
const r11 = ZT(s11, 'P', {
  op: 'zone_transfer', subject: 'chosen', from: 'void', to: 'front',
  subjectFilter: { feature: 'Web' },
}, {});
check('回 ok（VOID 冇符合嘅卡 = 無目標）', r11.ok, r11.err);
check('transferred 空', r11.transferred && r11.transferred.length === 0);
check('★ 卡仍然喺 hand，冇被移動', s11.players.P.hand.includes(wrong) && !s11.players.P.battle.front);
check('VOID 數量不變', s11.players.P.voidZone.length === void11);

// ---------- TEST 12: 目的地滿 → 失敗 ----------
console.log('\n[TEST 12] 目的地滿 → 失敗');
const s12 = fresh();
s12.players.P.battle.front = mk('occupied', { card_no: 'BP01-001' });
const v12 = mk('v12', { card_no: 'SP01-001', feature: 'Web' });
s12.players.P.voidZone.push(v12);
const r12 = ZT(s12, 'P', { op: 'zone_transfer', subject: 'chosen', from: 'void', to: 'front',
  subjectFilter: { feature: 'Web' } }, {});
check('失敗（front 已滿）', !r12.ok, r12.ok);
check('★ 卡仍在 VOID', s12.players.P.voidZone.includes(v12));

// ---------- TEST 13: zone invariant 全程成立（隨機 200 次）----------
console.log('\n[TEST 13] 隨機 200 次 zone_transfer，zone invariant 必須成立');
let viol = 0, sample = null;
for (let t = 0; t < 200; t++) {
  const s = fresh();
  const n = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) s.players.P.voidZone.push(mk('rv' + t + '_' + i, { card_no: 'SP01-001', feature: 'Web' }));
  const tos = ['front', 'back', 'wing', 'retreat', 'hand', 'base'];
  const to = tos[Math.floor(Math.random() * tos.length)];
  const subj = Math.random() < 0.5 ? 'all' : 'chosen';
  ZT(s, 'P', { op: 'zone_transfer', subject: subj, from: 'void', to,
    subjectFilter: { feature: 'Web' } }, {});
  const inv = E.assertZoneInvariant(s);
  if (!inv.ok) { viol++; if (!sample) sample = inv.dupes.slice(0, 2); }
}
check('200 次隨機零 zone violation', viol === 0, `${viol} violations ${JSON.stringify(sample)}`);

// ---------- TEST 14: P8 —— zone_transfer 令 deck 變 0 ----------
console.log('\n[TEST 14] zone_transfer 令 deck 變 0 → 觸發 P8');
const s14 = fresh();
// 把整副牌組搬去 hand（唔經 draw），deck 變 0
s14.players.A.deck.forEach(c => s14.players.A.hand.push(c));
s14.players.A.deck.length = 0;
check('deck 已 0', s14.players.A.deck.length === 0);
const v14 = mk('v14', { card_no: 'SP01-001', feature: 'Web' });
s14.players.P.voidZone.push(v14);
// 執行一個普通 zone_transfer（唔係搬 deck），win checker 應該喺結尾捉到 deck=0
const r14 = ZT(s14, 'P', { op: 'zone_transfer', subject: 'self', from: 'void', to: 'hand' }, { source: v14 });
check('ok', r14.ok, r14.err);
check('★ A deck 0 → winner = P', s14.winner === 'P', s14.winner);

console.log(`\n========== ${pass} pass, ${fail} fail ==========`);
process.exit(fail ? 1 : 0);