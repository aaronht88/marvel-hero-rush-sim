/* =============================================================
   Hub page logic for /moz/hub.html.
   - Renders player-progress widget from MOZ_CARDS.
   - Routes to archive / etc. for the menu buttons.
   ============================================================= */
(function () {
  "use strict";

  const cards = window.MOZ_CARDS || [];
  const total = cards.length;
  const collectedCount = cards.filter((c) => c.collected).length;
  const pct = total ? Math.round((collectedCount / total) * 1000) / 10 : 0;

  document.getElementById("archiveVal").textContent =
    `${collectedCount} / ${total}`;
  document.getElementById("archiveBar").style.width = pct + "%";

  const audioBtn = document.getElementById("audioBtn");
  audioBtn.addEventListener("click", () => {
    audioBtn.classList.toggle("active");
    audioBtn.textContent = audioBtn.classList.contains("active") ? "♪ 音效 ON" : "♪ 音效";
  });

  // Stub routes for unimplemented sections
  const STUBS = {
    chronicle: "故事模式尚未啟用 — 請前往「召喚圖鑑」瀏覽卡組。",
    shop:      "貝獸卡店尚未啟用 — 請前往「召喚圖鑑」瀏覽卡組。",
    deck:      "編成卡組尚未啟用 — 請前往「召喚圖鑑」瀏覽卡組。",
    settings:  "設定頁尚未啟用。",
  };

  document.querySelectorAll(".menu-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      const action = btn.dataset.action;
      if (action === "archive") return (location.href = "archive.html");
      alert(STUBS[action] || "未啟用");
    });
  });

  // Version stamp
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
  document.getElementById("versionLabel").textContent = "V" + today;
})();