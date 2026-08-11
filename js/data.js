// =============================================================
// Marvel Hero Rush TCG — Battle Simulator
// Data module: loads card list + preset decks, exposes lookup
// helpers. Pure data, no UI.
// =============================================================
// Card images live in the deck-builder repo; we reference them
// by relative path so the sim stays zero-dependency.
//   ../marvel-hero-rush-deckbuilder/img/cards/<id>.webp
// =============================================================

(function (global) {
  "use strict";

  // The deck builder's cards.js exposes window.MHR_DATA = {
  // CARDS, CARD_SETS, RARITIES, ATTRIBUTES }. Pull from there.
  const SRC = (global.MHR_DATA && global.MHR_DATA.CARDS) || global.CARDS || [];
  const DECK_SRC = global.MHR_DECKS || {};

  // Normalise: keep first variant per card_no as canonical (V2/V3
  // are alternate arts only — same game stats).
  const byNo = Object.create(null);
  SRC.forEach(c => {
    if (!byNo[c.card_no]) byNo[c.card_no] = c;
  });

  // Build name → card_no map (so decks can reference either)
  const byName = Object.create(null);
  Object.values(byNo).forEach(c => { byName[c.name] = c.card_no; });

  function getCard(noOrName) {
    if (byNo[noOrName]) return byNo[noOrName];
    if (byName[noOrName]) return byNo[byName[noOrName]];
    return null;
  }

  function numPower(p) {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  }
  function numRange(r) {
    const n = parseInt(r, 10);
    return Number.isFinite(n) ? n : 0;
  }

  // Expand [[card_no, qty], ...] into a 50-card deck array
  // (array of card objects). Throws on missing.
  function expandDeck(deckList, label = "?") {
    const out = [];
    deckList.forEach(([no, qty]) => {
      const c = byNo[no];
      if (!c) throw new Error(`Deck "${label}" references unknown card ${no}`);
      for (let i = 0; i < qty; i++) out.push(c);
    });
    if (out.length !== 50) {
      console.warn(`Deck "${label}" has ${out.length} cards (expected 50)`);
    }
    return out;
  }

  const DECKS = {
    RED_Aggro: expandDeck(DECK_SRC.RED_Aggro || [], "RED_Aggro"),
    YELLOW_Machine: expandDeck(DECK_SRC.YELLOW_Machine || [], "YELLOW_Machine"),
    BLUE_Control: expandDeck(DECK_SRC.BLUE_Control || [], "BLUE_Control"),
    GREEN_Tempo: expandDeck(DECK_SRC.GREEN_Tempo || [], "GREEN_Tempo"),
  };

  // Image path helper — used by UI to render thumbnails.
  // Local images are committed into THIS repo (img/cards/) so the
  // site works under GitHub Pages subpath (/marvel-hero-rush-sim/)
  // without depending on the deck-builder repo's absolute path.
  // NOTE: card.art is already "img/cards/<id>.webp" (relative) —
  // return it as-is; do NOT strip+re-prefix or the path doubles up.
  function artPath(card) {
    if (!card || !card.art) return "";
    return card.art;
  }

  // Merge our sim helpers into the existing MHR_DATA object
  // (preserving deck-builder fields like CARD_SETS / RARITIES)
  // rather than overwriting.
  global.MHR_DATA = Object.assign(global.MHR_DATA || {}, {
    CARDS: SRC,
    CARDS_BY_NO: byNo,
    DECKS,
    getCard,
    numPower,
    numRange,
    artPath,
  });
})(window);
