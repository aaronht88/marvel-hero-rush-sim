/* =============================================================
   Card archive (召喚圖鑑) — /moz/archive.html
   Filter sidebar, 12-col matrix grid, side detail panel.
   ============================================================= */
(function () {
  "use strict";

  const cards = window.MOZ_CARDS || [];
  const total = cards.length;
  const collectedCount = cards.filter((c) => c.collected).length;

  // ---------- Filter state ----------
  const state = {
    chapter:    "",
    type:       "",
    attribute:  "",
    record:     "",   // "" | "collected" | "locked"
    sort:       "card_no",
  };

  // ---------- Progress widget ----------
  document.getElementById("archiveNum").textContent = collectedCount;
  document.getElementById("archiveTotal").textContent = total;
  const pct = total ? Math.round((collectedCount / total) * 1000) / 10 : 0;
  document.getElementById("archiveBar").style.width = pct + "%";
  document.getElementById("archivePct").textContent = pct.toFixed(1);
  document.getElementById("archiveRemain").textContent = (total - collectedCount);

  document.getElementById("matrixTotal").textContent = total;

  // ---------- Filter pill binding ----------
  document.querySelectorAll(".pill-row").forEach((row) => {
    const filterKey = row.dataset.filter;
    row.querySelectorAll(".pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        row.querySelectorAll(".pill").forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
        const value = pill.dataset.value;
        if (filterKey === "sort") state.sort = value;
        else state[filterKey] = value;
        render();
      });
    });
  });

  // ---------- Audio toggle ----------
  const audioBtn = document.getElementById("audioBtn");
  audioBtn.addEventListener("click", () => {
    audioBtn.classList.toggle("active");
    audioBtn.textContent = audioBtn.classList.contains("active") ? "♪ ON" : "♪ 音效";
  });

  // ---------- Filter logic ----------
  function filtered() {
    const list = cards.filter((c) => {
      if (state.chapter && c.chapter !== state.chapter) return false;
      if (state.type && c.type !== state.type) return false;
      if (state.attribute && c.attribute !== state.attribute) return false;
      if (state.record === "collected" && !c.collected) return false;
      if (state.record === "locked" && c.collected) return false;
      return true;
    });

    const RARITY_ORDER = ["SEC","MR","UR","GR","SR","R","ER","PR","HR","TR"];
    const cmp = {
      card_no: (a, b) => a.card_no.localeCompare(b.card_no),
      level:   (a, b) => b.level - a.level,
      power:   (a, b) => b.power - a.power,
      rarity:  (a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity),
    }[state.sort] || ((a, b) => 0);

    return list.sort(cmp);
  }

  // ---------- Render matrix ----------
  const matrixEl = document.getElementById("matrix");
  let selectedId = null;

  function render() {
    const list = filtered();
    document.getElementById("visibleCount").textContent = list.length;

    matrixEl.innerHTML = list
      .map((c) => {
        const isSel = c.id === selectedId;
        const lockedCls = c.collected ? "" : "locked";
        const artStyle = c.collected
          ? `style="background-image:url('../${escapeAttr(c.art)}')"`
          : "";
        return `
        <button class="card-thumb ${lockedCls} ${isSel ? "selected" : ""}"
                data-id="${escapeAttr(c.id)}"
                aria-label="${escapeAttr(c.name)}">
          <div class="art" ${artStyle}></div>
          ${c.collected ? "" : '<div class="lock">？？？</div>'}
          <div class="meta">
            <span class="name">${escapeHtml(stripBrackets(c.collected ? c.name : "？？？"))}</span>
            <span>${escapeHtml(c.rarity)}</span>
          </div>
        </button>`;
      })
      .join("");

    matrixEl.querySelectorAll(".card-thumb").forEach((el) => {
      el.addEventListener("click", () => {
        selectedId = el.dataset.id;
        const card = cards.find((c) => c.id === selectedId);
        if (card) showDetail(card);
        render();   // re-render so selected highlight updates
      });
    });
  }

  // ---------- Detail panel ----------
  function showDetail(c) {
    document.getElementById("detailLabel").textContent =
      `${c.type} · ${c.card_no} · ${c.chapter}`;
    document.getElementById("renderCardNo").textContent = c.card_no;
    document.getElementById("renderAttribute").textContent = c.attribute;
    document.getElementById("renderArt").style.backgroundImage =
      c.collected ? `url('../${c.art}')` : "none";
    document.getElementById("renderName").textContent = stripBrackets(c.name);
    document.getElementById("renderClass").textContent = c.feature || c.type;
    document.getElementById("renderLevel").textContent = c.level;
    document.getElementById("renderPower").textContent = c.power.toLocaleString();
    document.getElementById("renderRange").textContent = c.range;
    document.getElementById("renderEffect").textContent =
      c.effect || "（無效果描述）";
    const ownEl = document.getElementById("renderOwn");
    if (c.collected) {
      ownEl.hidden = false;
      ownEl.textContent = `OWN ×1`;
    } else {
      ownEl.hidden = true;
    }
  }

  // ---------- Helpers ----------
  function stripBrackets(s) {
    return String(s).replace(/^「[^」]*」/, "").trim();
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

  // Initial render + auto-select first collected card so the detail panel
  // is not empty on first paint.
  const firstCollected = cards.find((c) => c.collected);
  if (firstCollected) {
    selectedId = firstCollected.id;
    showDetail(firstCollected);
  }
  render();
})();