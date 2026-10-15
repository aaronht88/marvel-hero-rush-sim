/* =============================================================
   effect-parser.js — Marvel Hero Rush card-effect tokenizer.

   Parses raw effect text into structured tokens matching the
   declarative DSL in /opt/data/mhr-battle-sim/EFFECTS_DESCRIPTOR.md.

   Trigger types (5): TRIG, AUTO, ACTI, COUNTER, COUNTER·ACTI
   Slots (9):         FIELD, HAND, BATTLE, RETREAT, WING, BASE,
                      BACK, FRONT, VOID
   Once-per-turn:     ONCE PER TURN (italicize)
   Dynamic variable:  X (highlight, italic)
   Attribute refs:    Red/Yellow/Blue/Green → colored

   This is display-only: a pretty-printer for the archive detail
   panel and the matrix tooltips. The real rules engine lives in
   /js/effects.js (declarative interpreter); this module does not
   change game state.
   ============================================================= */
(function (root) {
  "use strict";

  // ---- Icon map (font glyphs only; no external font required) ----
  const TRIG_ICON = {
    "TRIG": "⚡",
    "AUTO": "⚙",
    "ACTI": "▶",
    "COUNTER": "🛡",
    "COUNTER·ACTI": "🛡▶",
  };

  const SLOT_ICON = {
    "FIELD":   "▣",
    "HAND":    "✋",
    "BATTLE":  "⚔",
    "RETREAT": "↩",
    "WING":    "◈",
    "BASE":    "◰",
    "BACK":    "◐",
    "FRONT":   "◉",
    "VOID":    "✕",
  };

  // ---- Verb list (action keywords we render as bold accent) ----
  const VERBS = new Set([
    "prune", "prunes", "pruned",
    "draw", "draws", "drew",
    "discard", "discards", "discarded",
    "retreat", "retreats", "retreated",
    "attach", "attaches", "attached",
    "show", "shows", "showed",
    "swap", "swaps", "swapped",
    "place", "places", "placed",
    "move", "moves", "moved",
    "cover", "covers", "covered",
    "call", "calls", "called",
    "gets", "give", "gives", "given",
    "add", "adds", "added",
    "return", "returns", "returned",
    "remove", "removes", "removed",
    "play", "plays", "played",
    "attack", "attacks", "attacked",
    "may",
  ]);

  // ---- Parse one effect block ----
  function parse(rawEffect) {
    if (!rawEffect) return [];
    const blocks = rawEffect.split(/\n+/).map((b) => b.trim()).filter(Boolean);
    return blocks.map(parseBlock);
  }

  function parseBlock(block) {
    const headerRe =
      /^(TRIG|AUTO|ACTI|COUNTER·ACTI|COUNTER)\s*【([^】]+)】\s*:?\s*/i;
    const m = block.match(headerRe);

    const tokens = [];
    if (m) {
      tokens.push({ kind: "trigger", value: m[1].toUpperCase() });
      const slotParts = m[2].split("/").map((s) => s.trim());
      slotParts.forEach((slot, idx) => {
        if (slot === "ONCE PER TURN") {
          tokens.push({ kind: "once" });
        } else {
          tokens.push({ kind: "slot", value: slot.toUpperCase() });
        }
        if (idx < slotParts.length - 1) tokens.push({ kind: "punct", value: "/" });
      });
      tokens.push({ kind: "punct", value: ":" });
      tokens.push({ kind: "ws", value: " " });
    }

    const rest = m ? block.slice(m[0].length) : block;
    const parts2 = rest.split(/(\s+|[,.;:\uFF1A\u3002\uFF0C\uFF1B]|「[^」]*」|Lv\d+|\bX\b|\bONCE PER TURN\b|\[.+?\]|R\+\d+)/g);
    parts2.forEach((part) => {
      if (!part) return;
      if (/^\s+$/.test(part)) {
        tokens.push({ kind: "ws", value: part });
        return;
      }
      if (/^[,.;:\uFF1A\u3002\uFF0C\uFF1B]$/.test(part)) {
        tokens.push({ kind: "punct", value: part });
        return;
      }
      if (/^「[^」]*」$/.test(part)) {
        tokens.push({ kind: "title", value: part });
        return;
      }
      if (/^Lv\d+$/.test(part)) {
        tokens.push({ kind: "lv", value: part });
        return;
      }
      if (/^R\+\d+$/.test(part)) {
        tokens.push({ kind: "rank", value: part });
        return;
      }
      if (/^\bX\b$/.test(part)) {
        tokens.push({ kind: "var", value: part });
        return;
      }
      if (/^ONCE PER TURN$/.test(part)) {
        tokens.push({ kind: "once" });
        return;
      }
      if (/^\[.+\]$/.test(part)) {
        tokens.push({ kind: "bracket", value: part.slice(1, -1) });
        return;
      }
      if (VERBS.has(part.toLowerCase())) {
        tokens.push({ kind: "verb", value: part });
        return;
      }
      if (/^(red|yellow|blue|green)$/i.test(part)) {
        tokens.push({ kind: "attribute", value: part.toUpperCase() });
        return;
      }
      tokens.push({ kind: "text", value: part });
    });

    return tokens;
  }

  // ---- Renderer: tokens → safe HTML ----
  function render(tokens) {
    return tokens
      .map((t) => {
        switch (t.kind) {
          case "trigger":
            return `<span class="efx-trigger efx-trig-${escapeAttr(t.value)}">` +
                   `<span class="efx-icon">${TRIG_ICON[t.value] || ""}</span>` +
                   `<span class="efx-label">${escapeHtml(t.value)}</span></span>`;
          case "slot":
            return `<span class="efx-slot">` +
                   `<span class="efx-icon">${SLOT_ICON[t.value] || "·"}</span>` +
                   `<span class="efx-label">${escapeHtml(t.value)}</span></span>`;
          case "once":
            return `<span class="efx-once">ONCE PER TURN</span>`;
          case "var":
            return `<span class="efx-var">X</span>`;
          case "lv":
            return `<span class="efx-lv">${escapeHtml(t.value)}</span>`;
          case "rank":
            return `<span class="efx-rank">${escapeHtml(t.value)}</span>`;
          case "verb":
            return `<span class="efx-verb">${escapeHtml(t.value)}</span>`;
          case "attribute":
            return `<span class="efx-attr efx-attr-${escapeAttr(t.value)}">${escapeHtml(t.value)}</span>`;
          case "title":
            return `<span class="efx-title">${escapeHtml(t.value)}</span>`;
          case "bracket":
            return `<span class="efx-bracket">[${escapeHtml(t.value)}]</span>`;
          case "punct":
            return `<span class="efx-punct">${escapeHtml(t.value)}</span>`;
          case "ws":
            return " ";
          case "text":
          default:
            return `<span class="efx-text">${escapeHtml(t.value)}</span>`;
        }
      })
      .join("");
  }

  // ---- Helpers ----
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;")
                     .replace(/</g, "&lt;")
                     .replace(/>/g, "&gt;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  // Public API
  root.MHR_EFX = {
    parse,
    render,
    TRIG_ICON,
    SLOT_ICON,
  };
})(window);