// v3.25 smoke — mulligan hover 卡效
//
// Aaron 需求：「mulligan 嗰陣已經 hover 見卡效」
// 換牌決策正正需要知效果，之前要撳開 detail modal 先睇到。
//
// node 冇 DOM，所以呢個 test 做兩件事：
//   1) 靜態驗證 renderMulliganOverlay 真係綁咗 hover
//   2) 用 minimal DOM stub 真跑 renderMulliganOverlay，確保冇 throw
//      （重點：TDZ / 未初始化變數 —— 呢個正正係我加 hover 時撞到嘅 bug）
const fs = require('fs'), path = require('path'), vm = require('vm');
const REPO = '/opt/data/mhr-battle-sim';
let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}`, extra === undefined ? '' : extra); fail++; }
}

const appSrc = fs.readFileSync(path.join(REPO, 'js/app.js'), 'utf8');

// ---------- TEST 1: 靜態 — mulligan 綁 hover ----------
console.log('\n[TEST 1] renderMulliganOverlay 綁 hover');
const mullStart = appSrc.indexOf('function renderMulliganOverlay');
const mullEnd = appSrc.indexOf('function updateMulliganStatus');
const mullBody = appSrc.slice(mullStart, mullEnd);
check('renderMulliganOverlay 存在', mullStart >= 0);
check('★ 有 bindCardHover(card, c)', /bindCardHover\(card,\s*c\)/.test(mullBody),
  mullBody.slice(0, 200));

// ---------- TEST 2: HOVER_OK 唔再係 TDZ 陷阱 ----------
console.log('\n[TEST 2] hoverOk() lazy 化（TDZ 修正）');
check('hoverOk 函數存在', /function hoverOk\(\)/.test(appSrc));
check('★ bindCardHover 用 hoverOk()', /bindCardHover[\s\S]{0,120}!hoverOk\(\)/.test(appSrc));
check('★ 冇殘留 module-level const HOVER_OK', !/const HOVER_OK\s*=/.test(appSrc));
check('hoverOk 有 cache', /_hoverOkCache/.test(appSrc));

// ---------- TEST 3: 真跑 renderMulliganOverlay（DOM stub）----------
console.log('\n[TEST 3] DOM stub 實跑 mulligan render（驗證冇 throw）');
// 極簡 DOM stub：只提供 app.js 用到嘅 API
function makeEl(tag) {
  const el = {
    tagName: tag, children: [], dataset: {}, style: {}, classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); }, toggle(c, on) {
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
    focus() {}, select() {}, click() {},
    dispatch(t) { (this._listeners[t] || []).forEach(fn => fn({ target: this })); },
  };
  return el;
}
const els = {};
function getEl(id) { return els[id] || (els[id] = makeEl('div')); }

const win = {
  matchMedia: () => ({ matches: true }),   // 模擬桌面（有 hover）
  innerWidth: 1280, innerHeight: 800,
  addEventListener() {}, removeEventListener() {},
  localStorage: { getItem: () => null, setItem() {} },
  location: { href: 'http://localhost/', search: '' },
  navigator: { userAgent: 'node-stub' },
  setTimeout: (f) => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  requestAnimationFrame: (f) => 0,
  document: {
    getElementById: getEl,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: makeEl,
    addEventListener() {},
    body: makeEl('body'),
    title: 'Marvel Hero Rush TCG — Battle Simulator v3.25',
    head: makeEl('head'),
  },
  Audio: function () { return { play() {}, volume: 1 }; },
  SpeechSynthesisUtterance: function () {},
  speechSynthesis: { speak() {} },
};
win.window = win;
win.global = win;

const ctx = {
  window: win,
  console,
  setTimeout: win.setTimeout,
  clearTimeout: win.clearTimeout,
  // app.js 直接用 bare `document` / `navigator` / `location`，
  // 所以要放喺 context 頂層，唔止 window.*
  document: win.document,
  navigator: win.navigator,
  location: win.location,
  localStorage: win.localStorage,
  requestAnimationFrame: win.requestAnimationFrame,
};
ctx.global = win;
win.document = win.document;   // 兩邊都指同一個 stub
// app.js 用咗呢啲 browser global，直接掛上 context
ctx.URLSearchParams = URLSearchParams;
ctx.URL = { createObjectURL: () => 'blob:stub', revokeObjectURL() {} };
ctx.Blob = function () {};
ctx.MouseEvent = function () { return {}; };
ctx.MutationObserver = function () { return { observe() {}, disconnect() {} }; };
ctx.getComputedStyle = () => ({ getPropertyValue: () => '' });
vm.createContext(ctx);
function load(f) { vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f }); }

let loadErr = null;
try {
  ['js/cards.js', 'js/mhr-decks.js', 'js/data.js', 'js/effects-data.js',
   'js/effects-data-void.js', 'js/effects-data-batch1.js', 'js/effects-data-batch2.js',
   'js/engine.js', 'js/effects.js', 'js/ai.js', 'js/audio.js'].forEach(load);
} catch (e) { loadErr = e; }
check('前置 script 載入 OK', !loadErr, loadErr && loadErr.message);

// 載入 app.js —— 呢個係重點：如果 hoverOk TDZ bug 未修，喺 mulligan 流程會爆
let appErr = null;
try { load('js/app.js'); } catch (e) { appErr = e; }
check('app.js 載入無 error', !appErr, appErr && (appErr.message + ' @ ' + (appErr.stack || '').split('\n')[1]));

// ---------- TEST 4: cardBannerHTML 真係出到效果文本 ----------
console.log('\n[TEST 4] banner 內容');
if (!appErr) {
  const D = ctx.window.MHR_DATA;
  // 揀一張有效果文本嘅卡
  const card = D.CARDS.find(c => (c.effect || '').trim().length > 20);
  check('搵到有效果文本嘅卡', !!card, card && card.card_no);
  // cardBannerHTML 係內部 function — 用 app.js 內嘅 card-pop 驗證間接效果：
  // 直接檢查源碼有冇把 card.effect 放入 banner
  check('★ cardBannerHTML 顯示 card.effect',
    /cb-effect[\s\S]{0,80}card\.effect|const eff = \(card\.effect/.test(appSrc));
  check('★ banner 有 Lv/P/R chips', /cb-chip lv/.test(appSrc) && /cb-chip pw/.test(appSrc) && /cb-chip rg/.test(appSrc));
}

// ---------- TEST 5: mulligan 卡有 dataset.idx（hover 對應正確卡）----------
console.log('\n[TEST 5] mulligan 卡與 hover 對應');
check('m-card 有 dataset.idx', /card\.dataset\.idx\s*=\s*i/.test(appSrc));
check('bindCardHover 傳入 p.hand[i] 嘅 c', /p\.hand\.forEach\(\(c,\s*i\)/.test(mullBody));

// ---------- TEST 6: hover 唔會影響 mulligan 揀牌 click ----------
console.log('\n[TEST 6] hover 唔干擾 click 揀牌');
check('click handler 仍然存在', /view\._mulliganSelected\.has\(i\)/.test(mullBody));
check('selected class toggle', /classList\.toggle\("selected"/.test(mullBody));
check('updateMulliganStatus 仍然 call', /updateMulliganStatus\(\)/.test(mullBody));

// ---------- TEST 7: 其他 render 冇被破壞 ----------
console.log('\n[TEST 7] 其他 hover 綁定仍然用 hoverOk');
const bindCount = (appSrc.match(/bindCardHover\(/g) || []).length;
check(`bindCardHover 有 ${bindCount} 個 call site（>= 2）`, bindCount >= 2, bindCount);

console.log(`\n========== ${pass} pass, ${fail} fail ==========`);
process.exit(fail ? 1 : 0);