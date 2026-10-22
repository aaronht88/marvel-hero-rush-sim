// v3.25.1 smoke — mulligan 卡效【真流程驗證】
//
// v3.25 只做靜態檢查 + 假設 hover 會 work，結果用戶實測「都係冇」。
// 呢個 test 改為用 DOM stub 真跑完整流程：
//   renderDeckPicker → 撳 deck → 撳 start → startBattle → beginMulligan
//   → renderMulliganOverlay → 檢查真實 DOM 樹
// 確保：(1) mulligan-hand 真係有卡 (2) 每張卡有效果文字節點
//      (3) hover listener 真係綁咗 (4) 模擬 mouseenter 後 #card-pop 有內容
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = '/opt/data/mhr-battle-sim';
let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}`, extra === undefined ? '' : extra); fail++; }
}

function makeEl(tag) {
  const el = {
    tagName: tag, children: [], dataset: {}, style: {}, hidden: false, disabled: false,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) {
        if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
        else if (on) this._s.add(c); else this._s.delete(c);
      },
    },
    _listeners: {},
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 140, bottom: 140, right: 100 }; },
    set innerHTML(v) { this._html = v; this.children = []; },
    get innerHTML() { return this._html || ''; },
    set textContent(v) { this._text = v; },
    get textContent() { return this._text || ''; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {}, select() {}, click() {}, remove() {},
    dispatch(t, ev) { (this._listeners[t] || []).forEach(fn => fn(ev || { target: this })); },
  };
  return el;
}
const els = {};
const getEl = id => els[id] || (els[id] = makeEl('div'));

const win = {
  matchMedia: () => ({ matches: true }),
  innerWidth: 1280, innerHeight: 800,
  addEventListener() {}, removeEventListener() {},
  localStorage: { getItem: () => null, setItem() {} },
  location: { href: 'http://localhost/', search: '' },
  navigator: { userAgent: 'stub' },
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: () => 0,
  document: {
    getElementById: getEl,
    // renderHud 用 querySelector(".battle-topbar") —— 真 browser 一定有
    querySelector: (sel) => getEl('sel:' + sel),
    querySelectorAll: () => [],
    createElement: makeEl, addEventListener() {},
    body: makeEl('body'), title: 'v3.25.1', head: makeEl('head'),
  },
  Audio: function () { return { play() {}, volume: 1 }; },
  speechSynthesis: { speak() {}, cancel() {} },
};
win.window = win; win.global = win;

const ctx = {
  window: win, console,
  setTimeout: () => 0, clearTimeout() {},
  document: win.document, navigator: win.navigator, location: win.location,
  localStorage: win.localStorage,
  URLSearchParams, URL: { createObjectURL: () => '', revokeObjectURL() {} },
  Blob: function () {}, MouseEvent: function () { return {}; },
  MutationObserver: function () { return { observe() {}, disconnect() {} }; },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  Audio: win.Audio, speechSynthesis: win.speechSynthesis,
};
ctx.global = win;
vm.createContext(ctx);
const load = f => vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f });

let loadErr = null;
try {
  ['js/cards.js', 'js/mhr-decks.js', 'js/data.js', 'js/effects-data.js',
   'js/effects-data-void.js', 'js/effects-data-batch1.js', 'js/effects-data-batch2.js',
   'js/engine.js', 'js/effects.js', 'js/ai.js', 'js/audio.js', 'js/app.js'].forEach(load);
} catch (e) { loadErr = e; }

// ---------- TEST 1: app.js 載入 ----------
console.log('\n[TEST 1] app.js 載入（TDZ 檢查）');
check('全部 script 載入無 error', !loadErr, loadErr && loadErr.message);

// ---------- TEST 2: 真跑 mulligan 流程 ----------
console.log('\n[TEST 2] ★ 真流程：揀 deck → start → mulligan render');
const dp = getEl('deck-picker');
check('deck-picker 有 4 副 deck', dp.children.length === 4, dp.children.length);
if (dp.children.length) dp.children[0].dispatch('click');
const btnStart = getEl('btn-start');
let startErr = null;
try { btnStart.dispatch('click'); } catch (e) { startErr = e; }
check('startBattle 冇 throw', !startErr, startErr && startErr.message);

const hand = getEl('mulligan-hand');
const ov = getEl('mulligan-overlay');
check('mulligan overlay 顯示（冇 hidden）', !ov.classList.contains('hidden'));
check('★ mulligan-hand 有 6 張卡', hand.children.length === 6, hand.children.length);

// ---------- TEST 3: 每張卡有效果文字節點 ----------
console.log('\n[TEST 3] ★ 每張 mulligan 卡有效果文字');
if (hand.children.length) {
  let withEff = 0, withTitle = 0, withHover = 0;
  hand.children.forEach(card => {
    const eff = card.children.find(ch => ch.className === 'm-card-effect');
    if (eff && eff.textContent && eff.textContent.length > 3) withEff++;
    if (card.title && card.title.length > 3) withTitle++;
    const hs = card._listeners || {};
    if (hs.mouseenter && hs.mouseenter.length) withHover++;
  });
  const n = hand.children.length;
  check(`★ ${withEff}/${n} 有 m-card-effect 文字`, withEff === n, withEff);
  check(`★ ${withTitle}/${n} 有 title（native tooltip）`, withTitle === n, withTitle);
  check(`★ ${withHover}/${n} 綁咗 mouseenter`, withHover === n, withHover);
}

// ---------- TEST 4: 模擬 hover → #card-pop 有內容 ----------
console.log('\n[TEST 4] ★ 模擬 mouseenter → banner 出內容');
if (hand.children.length) {
  const pop = getEl('card-pop');
  const c0 = hand.children[0];
  c0.dispatch('mouseenter', { target: c0 });
  check('#card-pop 唔再 hidden', pop.hidden === false, pop.hidden);
  check('★ #card-pop 有內容（>100 字元）', (pop.innerHTML || '').length > 100,
    (pop.innerHTML || '').length);
  check('★ banner 含 cb-effect（效果區）', /cb-effect/.test(pop.innerHTML || ''));
  check('banner 含 Lv/P/R chips',
    /cb-chip lv/.test(pop.innerHTML) && /cb-chip pw/.test(pop.innerHTML) && /cb-chip rg/.test(pop.innerHTML));
  // mouseleave 要收返
  c0.dispatch('mouseleave', { target: c0 });
  check('mouseleave 後 banner 收起', pop.hidden === true, pop.hidden);
}

// ---------- TEST 5: pointerdown 保底（touch / hover:none）----------
console.log('\n[TEST 5] pointerdown 保底');
if (hand.children.length) {
  const c1 = hand.children[1];
  check('有 pointerdown listener', !!(c1._listeners.pointerdown && c1._listeners.pointerdown.length));
}

// ---------- TEST 6: click 揀牌仍然 work ----------
console.log('\n[TEST 6] click 揀牌未受影響');
if (hand.children.length) {
  const c2 = hand.children[2];
  const before = c2.classList.contains('selected');
  c2.dispatch('click', { target: c2 });
  const after = c2.classList.contains('selected');
  check(`click 切換 selected（${before} → ${after}）`, before !== after);
  c2.dispatch('click', { target: c2 });   // 取消
  check('再 click 取消', c2.classList.contains('selected') === before);
}

// ---------- TEST 7: CSS 有 m-card-effect 樣式 ----------
console.log('\n[TEST 7] CSS 樣式');
const css = fs.readFileSync(path.join(REPO, 'css/styles.css'), 'utf8');
check('.m-card-effect 有樣式', /\.m-card-effect\s*\{/.test(css));
check('★ @media (hover:none) 唔再 display:none 蓋 banner',
  !/@media \(hover: none\)\s*\{\s*#card-pop\s*\{\s*display:\s*none\s*!important/.test(css));

console.log(`\n========== ${pass} pass, ${fail} fail ==========`);
process.exit(fail ? 1 : 0);
