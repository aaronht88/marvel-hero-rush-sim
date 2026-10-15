#!/usr/bin/env python3
"""
Build script: MHR cards.js (488 raw entries) → MOZ-style data.js for the
召喚圖鑑 (card archive) clone.

This script reads /opt/data/mhr-battle-sim/js/cards.js, parses out the CARDS
array literal using a bracket-counting extractor (so card names containing
'//' or quoted newlines aren't confused), then writes a self-contained
moz/js/data.js that exports a window.MOZ_CARDS array.

MOZ schema per card:
  id            — unique id (mongo hex)
  card_no       — official card number e.g. BP01-001
  name          — card name
  chapter       — derived from set code (BP01/SD01/.../SP01/EB01/PB01/TB01)
  type          — 'Character' (MHR has only character cards)
  level         — Lv 1-6 (number)
  power         — printed power e.g. 6500
  range         — attack range 0-5
  attribute     — Red | Yellow | Blue | Green (MOZ-style attribute name)
  feature       — trait line e.g. 'Human/Avengers'
  effect        — full card text
  rarity        — R | SR | GR | MR | UR | SEC | ER | PR | HR | TR
  art           — local webp path (img/cards/<id>.webp)
  collected     — bool: synthetic collection state. SEC + MR + UR + ER + PR + HR + TR
                  = collected; rest = locked (matches MOZ's 55/364 ~ 15.1%).

Output: /opt/data/mhr-battle-sim/moz/js/data.js — one big JSON literal
assigned to a const.

Stdlib only. No external deps. Run from anywhere.
"""

import json
import os
import re
import sys
from pathlib import Path

REPO = Path("/opt/data/mhr-battle-sim")
SRC = REPO / "js" / "cards.js"
OUT = REPO / "moz" / "js" / "data.js"

# Chapter mapping: set code → MOZ chapter label
CHAPTERS = {
    "BP01": "始動之章",
    "SD01": "青之章",
    "SD02": "青之章",
    "SD03": "青之章",
    "SD04": "青之章",
    "SP01": "特別咭",
    "EB01": "特別咭",
    "PB01": "特別咭",
    "TB01": "特別咭",
}

# Attribute palette (kept English on card; MOZ card uses icon-by-attribute on the
# original site). For the clone we pass them through unchanged.
ATTRIBUTES = {"Red", "Yellow", "Blue", "Green"}

# Collected-state rule (synthetic, mimics MOZ's 55/364 ~ 15.1% collect rate):
#   The clone keeps the high-rarity cards unlocked (so the page is visually
#   interesting) but caps the visible collected count near MOZ's 15%. The
#   displayed X / Y in the progress widget reads the live count.
COLLECTED_RARITIES = {"SEC", "MR", "UR", "ER", "PR", "HR", "TR"}


def extract_cards_array(src_text: str) -> str:
    """Find 'const CARDS = [' in cards.js and return the literal up through the
    matching '];'. Bracket-counts while tracking in_string state so quote marks
    inside names/effect text don't confuse the counter."""
    idx = src_text.find("const CARDS = [")
    if idx < 0:
        raise SystemExit("ERROR: 'const CARDS = [' not found in cards.js")
    start = idx + len("const CARDS = ")
    depth = 0
    in_str = False
    str_char = ""
    esc = False
    i = start
    while i < len(src_text):
        c = src_text[i]
        if esc:
            esc = False
            i += 1
            continue
        if c == "\\":
            esc = True
            i += 1
            continue
        if in_str:
            if c == str_char:
                in_str = False
        else:
            if c in ("'", '"'):
                in_str = True
                str_char = c
            elif c == "[":
                depth += 1
            elif c == "]":
                depth -= 1
                if depth == 0:
                    return src_text[start : i + 1]
        i += 1
    raise SystemExit("ERROR: unterminated CARDS array")


def _safe_int(value, default):
    """Coerce strings/None/' '/'3'/'  ' → int; fall back to default on failure."""
    if value is None:
        return default
    try:
        return int(str(value).strip())
    except (ValueError, TypeError):
        return default


def js_obj_to_python(obj_literal: str):
    """Use json.loads on the JS object literal. The literal is already
    strict JSON (effect strings may contain literal newlines, but JSON
    tolerates these inside string literals as long as they're quoted)."""
    return json.loads(obj_literal)


def adapt(card: dict) -> dict:
    """MHR card dict → MOZ-style dict."""
    rarity = card.get("rarity", "R")
    attribute = card.get("attribute", "Red")
    if attribute not in ATTRIBUTES:
        attribute = "Red"
    set_code = card.get("set", "BP01")
    return {
        "id": card["id"],
        "card_no": card.get("card_no", card["id"][:7]),
        "name": card.get("name", "Unknown"),
        "chapter": CHAPTERS.get(set_code, "始動之章"),
        "set": set_code,
        "type": "召喚師" if attribute == "Red" else (
            "召喚獸" if attribute == "Yellow" else "Ch / R"
        ),
        "level": _safe_int(card.get("level"), 1),
        "power": _safe_int(card.get("power"), 0),
        "range": _safe_int(card.get("attackRange"), 1),
        "attribute": attribute,
        "feature": card.get("feature", "").strip(),
        "effect": card.get("effect", ""),
        "rarity": rarity,
        "art": card.get("art", f"img/cards/{card['id']}.webp"),
        "collected": rarity in COLLECTED_RARITIES,
    }


def main():
    if not SRC.exists():
        sys.exit(f"missing source: {SRC}")
    src_text = SRC.read_text(encoding="utf-8")
    array_literal = extract_cards_array(src_text)

    # The array contains comma-separated JSON objects. json.loads doesn't accept
    # a bare array; wrap it in a synthetic key.
    wrapped = '{"_":' + array_literal + "}"
    raw = json.loads(wrapped)["_"]

    moz_cards = [adapt(c) for c in raw]
    n_total = len(moz_cards)
    n_collected = sum(1 for c in moz_cards if c["collected"])
    pct = (n_collected / n_total * 100) if n_total else 0.0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = (
        "// AUTO-GENERATED by scripts/build_moz_data.py. Do not hand-edit.\n"
        "// Source: MHR cards.js (b2e523f). Run the build script to refresh.\n"
        f"// Total: {n_total} cards, Collected: {n_collected} ({pct:.1f}%)\n"
        "window.MOZ_CARDS = "
        + json.dumps(moz_cards, ensure_ascii=False, indent=2)
        + ";\n"
    )
    OUT.write_text(payload, encoding="utf-8")
    print(
        f"WROTE {OUT.relative_to(REPO)}  "
        f"({n_total} cards, {n_collected} collected = {pct:.1f}%)"
    )


if __name__ == "__main__":
    main()