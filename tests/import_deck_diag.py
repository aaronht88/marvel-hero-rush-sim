"""Diagnose the MHR battle-sim 'Import Deck' button.

Symptoms: pressing the '📥 匯入 Deck' button does nothing
(or the overlay doesn't open / paste-and-load fails).

Run:

  tests/.venv/bin/python tests/import_deck_diag.py

The script:
1) Boots a local http.server on port 8124 serving the repo root
2) Connects with Playwright + chromium (PLAYWRIGHT_BROWSERS_PATH=/opt/data/.pw)
3) Opens the page, monitors console / pageerror
4) Clicks btn-import, observes whether #import-overlay appears
5) If visible: types a known-valid share code, clicks import-load
6) Reports result with full console + error capture
"""

from __future__ import annotations

import http.server
import os
import socket
import socketserver
import subprocess
import sys
import threading
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))


def find_free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def serve(port, base_dir):
    os.chdir(base_dir)
    httpd = socketserver.TCPServer(("127.0.0.1", port), QuietHandler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd


# A share code that we know decodes successfully.
# Generate one with the deckbuilder app's DATA.DECKS[e.g. shared deck].
# Easier: copy a known-good compact v2 code from MHR_SIM tests.
# Use the existing MHR_SIM known-good share code from DATA.DECKS:
# 'BP01 sample' etc. We hard-code one by hand:
# Build it via the deck text "1|Pure test|"
# + entries: pick 50 from BP01 (cards 1..20 × qty in {2,3}; reality check below).
#
# Easier: pull a real share code from the existing DATA.DECKS["BP01_test"]:
# We can't get one without running setup, so use a valid legacy base64:
# (Card1×4, Card2×4, ... Card50×1) decoded from DATA.CARDS via card_no.
#
# Simplest path: import via UI on github pages to get a code, paste that.
# For the diagnosis, an INVALID code is also useful — it surfaces what
# the user sees when they accidentally break a code.

INVALID_CODE = "INVALID-CODE-WONT-DECODE"
# A valid v2 example: "1|Test|APM0014BP01-0023CP01-0013..."
# We can build it dynamically by walking DATA.DECKS["BP01_test"] if it's a thing.
# We'll keep the test honest by also probing with the text from a
# valid sample if available.


def run():
    port = find_free_port()
    httpd = serve(port, REPO)
    print(f"[boot] served {REPO} at http://127.0.0.1:{port}/")

    from playwright.sync_api import sync_playwright

    console_lines = []
    page_errors = []
    network_failures = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()

        def on_console(msg):
            console_lines.append(f"[{msg.type}] {msg.text}")

        def on_pageerror(err):
            page_errors.append(str(err))

        def on_requestfailed(req):
            network_failures.append(f"{req.method} {req.url} -- {req.failure}")

        page.on("console", on_console)
        page.on("pageerror", on_pageerror)
        page.on("requestfailed", on_requestfailed)

        # Force-bust cache
        url = f"http://127.0.0.1:{port}/index.html?cb={int(time.time())}"
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_timeout(800)

        # Sanity — is the button there?
        btn_count = page.locator("#btn-import").count()
        print(f"[diag] #btn-import count: {btn_count}")

        if btn_count == 0:
            print("[FAIL] button is not present in the DOM")
            print("first 200 chars of HTML around 'import':")
            html = page.content()
            ix = html.find("Import")
            print(html[max(0, ix - 200) : ix + 400] if ix != -1 else "(no match)")
            print("\n=== last 30 console lines ===")
            print("\n".join(console_lines[-30:]))
            return 1

        # Try to click
        print("[diag] clicking #btn-import…")
        try:
            page.click("#btn-import", timeout=3000)
        except Exception as e:
            print(f"[FAIL] click errored: {e}")

        page.wait_for_timeout(400)

        # Is overlay now visible?
        hidden = page.locator("#import-overlay").get_attribute("class") or ""
        print(f"[diag] #import-overlay class: {hidden!r}")
        is_visible = "hidden" not in hidden.split()
        print(f"[diag] overlay visible? {is_visible}")

        # Snapshot
        page.screenshot(path=str(REPO / "tests" / "diag_open.png"))

        if is_visible:
            page.fill("#import-code", INVALID_CODE)
            page.click("#import-load")
            page.wait_for_timeout(400)
            status = page.locator("#import-status").inner_text()
            print(f"[diag] status text after invalid code: {status!r}")
            page.screenshot(path=str(REPO / "tests" / "diag_loaded_invalid.png"))

            # Now produce a real code by reading the page's DATA.DECKS and
            # encoding one as legacy base64.
            print("[diag] constructing a real share code from DATA.DECKS...")
            share = page.evaluate(
                """() => {
                  const src = (typeof window.MHR_DATA !== 'undefined' ? window.MHR_DATA : null)
                       || (typeof DATA !== 'undefined' ? DATA : null);
                  if (!src) return { error: 'no DATA' };
                  // Pick a deck; fall back to first one.
                  const names = Object.keys(src.DECKS || {});
                  if (!names.length) return { error: 'no decks' };
                  // Find pairs from the deck
                  const deckName = names[0];
                  const deck = src.DECKS[deckName];
                  if (!Array.isArray(deck)) return { error: 'deck not array' };
                  // Compress to pairs [[card_no, qty]] by name
                  const counts = {};
                  deck.forEach(c => { counts[c.card_no] = (counts[c.card_no]||0) + 1; });
                  const pairs = Object.entries(counts).map(([cn,q]) => [cn, q]);
                  // Legacy base64(JSON)
                  const json = JSON.stringify(pairs);
                  const b64 = btoa(unescape(encodeURIComponent(json)));
                  return { deckName, pairs: pairs.length, b64 };
                }"""
            )
            print(f"[diag] share construct: {share}")
            if "b64" in share:
                page.fill("#import-code", share["b64"])
                page.click("#import-load")
                page.wait_for_timeout(800)
                status = page.locator("#import-status").inner_text()
                print(f"[diag] status after VALID code: {status!r}")
                # Was a new deck registered?
                has = page.evaluate(
                    """(name) => {
                       const src = (typeof window.MHR_DATA !== 'undefined' ? window.MHR_DATA : null)
                            || (typeof DATA !== 'undefined' ? DATA : null);
                       return Object.keys(src.DECKS || {});
                    }""",
                    share["deckName"],
                )
                print(f"[diag] DECKS keys after import: {has}")

        page.wait_for_timeout(300)

        # Final dump
        print("\n=== Console (last 60) ===")
        for line in console_lines[-60:]:
            print(line)
        print("\n=== Page errors ===")
        for e in page_errors:
            print(e)
        print("\n=== Network failures ===")
        for n in network_failures:
            print(n)

        browser.close()
    httpd.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(run())
