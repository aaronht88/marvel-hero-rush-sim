/* =============================================================
   Landing page logic for /moz/index.html.
   - Click "01" → open starter-deck modal with 5 random MR+UR characters.
   - Click "02" → no-op (locked).
   - Click "03" → route to hub.html.
   - Click "04" → route to archive.html.
   ============================================================= */
(function () {
  "use strict";

  const cards = window.MOZ_CARDS || [];
  const collected = cards.filter((c) => c.collected);

  const audioBtn = document.getElementById("audioBtn");
  audioBtn.addEventListener("click", () => {
    audioBtn.classList.toggle("active");
    audioBtn.textContent = audioBtn.classList.contains("active") ? "♪ 音效 ON" : "♪ 音效";
  });

  // -------- Menu routing --------
  document.querySelectorAll(".menu-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      const action = btn.dataset.action;
      if (action === "new") return openStarterModal();
      if (action === "hub") return (location.href = "hub.html");
      if (action === "archive") return (location.href = "archive.html");
    });
  });

  // -------- Starter modal: 5 random MR/UR characters from collected set --------
  const backdrop = document.getElementById("starterBackdrop");
  const starterGrid = document.getElementById("starterGrid");
  const beginBtn = document.getElementById("beginBtn");

  function openStarterModal() {
    const pool = collected.length >= 5
      ? collected
      : cards.slice(0, Math.max(5, collected.length));
    const pick = shuffle(pool).slice(0, 5);
    starterGrid.innerHTML = pick
      .map(
        (c) => `
        <div class="starter-card" title="${escapeHtml(c.name)}">
          <div class="art" style="background-image:url('../${escapeAttr(c.art)}')"></div>
          <div class="name">${escapeHtml(stripBrackets(c.name))}</div>
          <div class="stats">
            <span>LV ${c.level}</span>
            <span>${c.rarity}</span>
            <span>${c.attribute}</span>
          </div>
        </div>`
      )
      .join("");
    backdrop.hidden = false;
  }

  beginBtn.addEventListener("click", () => (location.href = "hub.html"));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.hidden = true;
  });

  // -------- Helpers --------
  function shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function stripBrackets(s) {
    // 「Antimatter」Iron Man → Iron Man
    return s.replace(/^「[^」]*」/, "").trim();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  // Bump version stamp once per day.
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
  document.getElementById("versionLabel").textContent = "V" + today;
})();