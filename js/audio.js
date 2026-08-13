/* =============================================================
   Marvel Hero Rush TCG — Audio engine v1.0
   WebAudio synth cues (no asset deps). Cues:
     - draw        (short card flick, ascending tick)
     - deploy      (low thunk + lid snap)
     - call        (rising chord for Lv1-3, deeper rise for Lv4+)
     - attack      (whoosh + impact thud)
     - hit         (impact thud only, used for char-vs-char power compare)
     - weakness    (ascending star chord — Rush Point gained)
     - retreat     (descending drop)
     - win         (3-note major triad fanfare)
     - lose        (3-note minor descent)
     - click       (UI button confirm, very short)
   - toggleAudio() toggles muted state, persists to localStorage
   - All cues no-op if AudioContext blocked until first user gesture
   ============================================================= */
(function () {
  "use strict";

  const LS_KEY = "mhr_sim_audio_v1";
  let ctx = null;
  let masterGain = null;
  let muted = false;

  // Load persisted mute state (default = unmuted but won't auto-play until gesture)
  try {
    muted = localStorage.getItem(LS_KEY) === "mute";
  } catch (e) { /* ignore */ }

  function ensureCtx() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : 0.45;
      masterGain.connect(ctx.destination);
    } catch (e) { return null; }
    return ctx;
  }

  // Resume on first user gesture (Chrome autoplay policy)
  function resumeOnGesture() {
    const c = ensureCtx();
    if (!c) return;
    if (c.state === "suspended") c.resume().catch(() => {});
  }
  ["click", "keydown", "touchstart", "pointerdown"].forEach(ev => {
    document.addEventListener(ev, resumeOnGesture, { once: false, passive: true });
  });

  function tone(freq, startOffset, duration, type, gainEnd) {
    const c = ensureCtx();
    if (!c) return;
    const t0 = c.currentTime + startOffset;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type || "triangle";
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainEnd || 0.001), t0 + duration);
    osc.connect(g).connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  function noiseHit(startOffset, duration, gain) {
    const c = ensureCtx();
    if (!c) return;
    const t0 = c.currentTime + startOffset;
    const dur = duration || 0.15;
    const bufferSize = Math.floor(c.sampleRate * dur);
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      // fast-decay white noise
      const t = i / bufferSize;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 8);
    }
    const src = c.createBufferSource();
    src.buffer = buffer;
    const g = c.createGain();
    g.gain.value = gain || 0.3;
    const bp = c.createBiquadFilter();
    bp.type = "lowpass";
    bp.frequency.value = 1200;
    src.connect(bp).connect(g).connect(masterGain);
    src.start(t0);
  }

  // ---- Cue library ----
  const CUES = {
    draw() {
      // ascending tick tick (card slip)
      tone(660, 0.00, 0.06, "square", 0.001);
      tone(880, 0.05, 0.06, "square", 0.001);
    },
    deploy() {
      // low thunk + paper snap
      tone(140, 0.00, 0.12, "sine", 0.001);
      noiseHit(0.02, 0.08, 0.15);
    },
    call(level) {
      // rising chord, deeper for Lv4+
      const lv = level || 1;
      const base = lv >= 4 ? 220 : 440;
      const root = base;
      const third = base * 1.25;
      const fifth = base * 1.5;
      tone(root,  0.00, 0.18, "sawtooth", 0.05);
      tone(third, 0.04, 0.18, "sawtooth", 0.05);
      tone(fifth, 0.08, 0.20, "triangle", 0.001);
    },
    attack() {
      // whoosh + impact
      noiseHit(0.00, 0.25, 0.4);
      noiseHit(0.18, 0.12, 0.5);
      tone(80, 0.20, 0.12, "sine", 0.001);
    },
    hit() {
      // just the impact thud
      noiseHit(0.00, 0.18, 0.45);
      tone(120, 0.00, 0.15, "sine", 0.001);
    },
    weakness() {
      // Rush Point gain — ascending major triad arpeggio + shimmer
      tone(523, 0.00, 0.12, "triangle", 0.001); // C5
      tone(659, 0.10, 0.12, "triangle", 0.001); // E5
      tone(784, 0.20, 0.12, "triangle", 0.001); // G5
      tone(1047, 0.30, 0.25, "triangle", 0.001); // C6
      // shimmer
      for (let i = 0; i < 4; i++) {
        tone(1568 + i * 80, 0.32 + i * 0.05, 0.18, "sine", 0.001);
      }
    },
    retreat() {
      // descending drop
      tone(440, 0.00, 0.10, "sawtooth", 0.001);
      tone(220, 0.08, 0.16, "sawtooth", 0.001);
      noiseHit(0.12, 0.10, 0.2);
    },
    win() {
      // major triad fanfare
      tone(523, 0.00, 0.20, "triangle", 0.001); // C5
      tone(659, 0.15, 0.20, "triangle", 0.001); // E5
      tone(784, 0.30, 0.20, "triangle", 0.001); // G5
      tone(1047, 0.45, 0.40, "triangle", 0.001); // C6
    },
    lose() {
      // minor descent
      tone(392, 0.00, 0.20, "sawtooth", 0.001); // G4
      tone(349, 0.18, 0.22, "sawtooth", 0.001); // F4
      tone(294, 0.38, 0.40, "sawtooth", 0.001); // D4
    },
    click() {
      tone(1200, 0.00, 0.04, "square", 0.001);
    },
  };

  function play(name, arg) {
    if (muted) return;
    const fn = CUES[name];
    if (!fn) return;
    try { fn(arg); } catch (e) { /* audio failure shouldn't break game */ }
  }

  function setMuted(v) {
    muted = !!v;
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.45;
    try { localStorage.setItem(LS_KEY, muted ? "mute" : "on"); } catch (e) {}
  }
  function isMuted() { return muted; }
  function toggle() {
    setMuted(!muted);
    if (!muted) play("click"); // audible confirmation when unmuting
    return !muted;
  }

  // Public API
  window.MHR_AUDIO = {
    play,
    toggle,
    isMuted,
    setMuted,
    // Refresh toggle button label if present
    refreshToggleUI() {
      const btn = document.getElementById("btn-sound-toggle");
      if (!btn) return;
      btn.classList.toggle("muted", muted);
      btn.title = muted ? "音效已靜音 — 點擊開啟" : "音效開啟 — 點擊靜音";
    },
  };
})();