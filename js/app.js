(() => {
  "use strict";

  const STORAGE_KEY = "pachi-recommender-v1";
  const MATCH_SOURCE_OPTIONS = ["データスコープ(LINE)", "アナスロ", "target-eye", "手入力(その他)"];
  const REVIEW_SOURCE_OPTIONS = ["5ch", "みんパチ", "Googleマップ", "知人からの話", "その他"];
  const REVIEW_TAG_OPTIONS = ["設定良さそう", "設定辛そう", "接客が良い", "接客が悪い", "新台入替あり", "混雑している", "閉店セール"];

  const GOOD_MACHINE_DIFF = 500; // この差枚以上なら「設定良さそうな台」候補
  const BAD_MACHINE_DIFF = -500;
  const GOOD_SHOP_AVG_DIFF = 200; // 店舗平均がこれ以上なら実戦データ◎
  const BAD_SHOP_AVG_DIFF = -300; // これ以下なら実戦データ▼

  let state = loadState();
  let freshnessDays = 7;

  // ---------- state ----------

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn("failed to load saved data, falling back to seed", e);
    }
    return {
      shops: SEED_SHOPS.map((s) => ({ id: genId(), ...s, memo: "" })),
      matchRecords: [],
      reviews: [],
    };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function genId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // ---------- date helpers ----------

  function daysAgo(dateStr) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return Infinity;
    const diffMs = Date.now() - d.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  // ---------- scoring ----------

  function computeMatchStats(shopId) {
    const records = state.matchRecords
      .filter((r) => r.shopId === shopId)
      .filter((r) => daysAgo(r.date) <= freshnessDays)
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    if (records.length === 0) {
      return { status: "unknown", records: [], topMachines: [], latestDaysAgo: null };
    }

    const byMachine = new Map();
    for (const r of records) {
      const key = r.machineName + (r.unitNumber ? `#${r.unitNumber}` : "");
      if (!byMachine.has(key)) byMachine.set(key, []);
      byMachine.get(key).push(r);
    }

    const machineSummaries = [...byMachine.entries()].map(([key, recs]) => {
      const avgDiff = recs.reduce((sum, r) => sum + (Number(r.medalDiff) || 0), 0) / recs.length;
      const totalBBRB = recs.reduce((sum, r) => sum + (Number(r.bb) || 0) + (Number(r.rb) || 0), 0);
      const totalGames = recs.reduce((sum, r) => sum + (Number(r.gameCount) || 0), 0);
      const synthRate = totalBBRB > 0 ? Math.round(totalGames / totalBBRB) : null;
      return {
        key,
        machineName: recs[0].machineName,
        unitNumber: recs[0].unitNumber,
        avgDiff: Math.round(avgDiff),
        synthRate,
        count: recs.length,
      };
    });

    machineSummaries.sort((a, b) => b.avgDiff - a.avgDiff);
    const topMachines = machineSummaries.filter((m) => m.avgDiff >= GOOD_MACHINE_DIFF).slice(0, 3);

    const overallAvgDiff =
      records.reduce((sum, r) => sum + (Number(r.medalDiff) || 0), 0) / records.length;

    let status = "neutral";
    if (overallAvgDiff >= GOOD_SHOP_AVG_DIFF) status = "good";
    else if (overallAvgDiff <= BAD_SHOP_AVG_DIFF) status = "bad";

    return {
      status,
      records,
      machineSummaries,
      topMachines,
      overallAvgDiff: Math.round(overallAvgDiff),
      latestDaysAgo: daysAgo(records[0].date),
    };
  }

  function computeReviewStats(shopId) {
    const reviews = state.reviews
      .filter((r) => r.shopId === shopId)
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    if (reviews.length === 0) {
      return { status: "unknown", reviews: [], latestDaysAgo: null };
    }

    const good = reviews.filter((r) => r.rating === "good").length;
    const bad = reviews.filter((r) => r.rating === "bad").length;
    const goodRatio = good / reviews.length;
    const badRatio = bad / reviews.length;

    let status = "neutral";
    if (reviews.length >= 2 && goodRatio >= 0.6) status = "good";
    else if (reviews.length >= 2 && badRatio >= 0.6) status = "bad";
    else if (reviews.length < 2) status = "sparse";

    return {
      status,
      reviews,
      good,
      bad,
      neutral: reviews.length - good - bad,
      latestDaysAgo: daysAgo(reviews[0].date),
    };
  }

  function computeOverall(matchStats, reviewStats) {
    const hasMatch = matchStats.status !== "unknown";
    const hasReview = reviewStats.status !== "unknown";

    if (!hasMatch && !hasReview) return "unknown";

    const bad = matchStats.status === "bad" || reviewStats.status === "bad";
    if (bad) return "caution";

    const good = matchStats.status === "good" || reviewStats.status === "good";
    if (good) return "recommend";

    return "neutral";
  }

  const OVERALL_LABEL = {
    recommend: "🌟 おすすめ候補",
    neutral: "△ 参考程度",
    caution: "▼ 要注意",
    unknown: "‐ 情報不足",
  };

  const MATCH_BADGE_LABEL = {
    good: "◎ 好データあり",
    neutral: "△ データあり(可もなく不可もなく)",
    bad: "▼ 厳しいデータ",
    unknown: "‐ データなし",
  };

  const REVIEW_BADGE_LABEL = {
    good: "◎ 評判良好",
    neutral: "△ 賛否あり",
    bad: "▼ 評判があまり良くない",
    sparse: "△ 口コミ少なめ",
    unknown: "‐ 口コミなし",
  };

  // ---------- rendering ----------

  function render() {
    const listEl = document.getElementById("shop-list");
    listEl.innerHTML = "";

    const area = document.getElementById("filter-area").value;
    const sortKey = document.getElementById("sort-key").value;
    const nameFilter = document.getElementById("search-name").value.trim().toLowerCase();

    let shops = state.shops.filter((s) => {
      if (area !== "all" && s.area !== area) return false;
      if (nameFilter && !s.name.toLowerCase().includes(nameFilter)) return false;
      return true;
    });

    const enriched = shops.map((shop) => {
      const matchStats = computeMatchStats(shop.id);
      const reviewStats = computeReviewStats(shop.id);
      const overall = computeOverall(matchStats, reviewStats);
      return { shop, matchStats, reviewStats, overall };
    });

    const overallRank = { recommend: 0, neutral: 1, caution: 2, unknown: 3 };
    enriched.sort((a, b) => {
      if (sortKey === "overall") return overallRank[a.overall] - overallRank[b.overall];
      if (sortKey === "match") return (b.matchStats.overallAvgDiff || -Infinity) - (a.matchStats.overallAvgDiff || -Infinity);
      if (sortKey === "review") return (b.reviewStats.good || 0) - (a.reviewStats.good || 0);
      return a.shop.name.localeCompare(b.shop.name, "ja");
    });

    if (enriched.length === 0) {
      listEl.innerHTML = `<div class="empty-state">条件に一致する店舗がありません。「店舗を追加」から登録してください。</div>`;
      return;
    }

    for (const item of enriched) {
      listEl.appendChild(renderShopCard(item));
    }
  }

  function renderShopCard({ shop, matchStats, reviewStats, overall }) {
    const card = document.createElement("article");
    card.className = "shop-card";
    card.dataset.overall = overall;

    const areaLabel = shop.area === "osaka" ? "大阪" : "奈良";

    const matchFreshness =
      matchStats.latestDaysAgo === null
        ? ""
        : `<span class="freshness ${matchStats.latestDaysAgo > freshnessDays ? "stale" : ""}">(${matchStats.latestDaysAgo}日前)</span>`;

    const reviewFreshness =
      reviewStats.latestDaysAgo === null
        ? ""
        : `<span class="freshness">(${reviewStats.latestDaysAgo}日前)</span>`;

    const topMachinesHtml =
      matchStats.topMachines && matchStats.topMachines.length
        ? `<ul class="mini-list">${matchStats.topMachines
            .map(
              (m) =>
                `<li class="top-pick">${escapeHtml(m.machineName)}${m.unitNumber ? ` #${escapeHtml(m.unitNumber)}` : ""}: 平均差枚 ${m.avgDiff >= 0 ? "+" : ""}${m.avgDiff}枚${m.synthRate ? `(合成${m.synthRate}G/BB+RB)` : ""}</li>`
            )
            .join("")}</ul>`
        : matchStats.status !== "unknown"
        ? `<p class="review-text">目立って良い台は見つかりませんでした。</p>`
        : "";

    const reviewSnippetsHtml =
      reviewStats.reviews && reviewStats.reviews.length
        ? `<ul class="mini-list">${reviewStats.reviews
            .slice(0, 3)
            .map(
              (r) =>
                `<li>${ratingIcon(r.rating)} ${escapeHtml(r.source)}${r.text ? `: <span class="review-text">${escapeHtml(truncate(r.text, 40))}</span>` : ""}</li>`
            )
            .join("")}</ul>`
        : "";

    card.innerHTML = `
      <div class="shop-card-header">
        <div>
          <h3>${escapeHtml(shop.name)}</h3>
          <span class="area-badge">${areaLabel}${shop.city ? " ・ " + escapeHtml(shop.city) : ""}</span>
        </div>
        <span class="overall-badge ${overall}">${OVERALL_LABEL[overall]}</span>
      </div>
      <div class="shop-card-body">
        <section class="data-section">
          <h4>実戦データ ${matchFreshness}</h4>
          <span class="badge-pill ${matchStats.status}">${MATCH_BADGE_LABEL[matchStats.status]}</span>
          ${topMachinesHtml}
          <div class="section-actions">
            <button class="btn btn-add-match" data-shop-id="${shop.id}">実戦データを追加</button>
          </div>
        </section>
        <section class="data-section">
          <h4>口コミ ${reviewFreshness}</h4>
          <span class="badge-pill ${reviewStats.status}">${REVIEW_BADGE_LABEL[reviewStats.status]}</span>
          ${reviewSnippetsHtml}
          <div class="section-actions">
            <button class="btn btn-add-review" data-shop-id="${shop.id}">口コミを追加</button>
          </div>
        </section>
      </div>
      <div class="shop-card-footer">
        <button class="btn btn-edit-shop" data-shop-id="${shop.id}">編集</button>
        <button class="btn btn-danger btn-delete-shop" data-shop-id="${shop.id}">削除</button>
      </div>
    `;

    card.querySelector(".btn-add-match").addEventListener("click", () => openMatchForm(shop.id));
    card.querySelector(".btn-add-review").addEventListener("click", () => openReviewForm(shop.id));
    card.querySelector(".btn-edit-shop").addEventListener("click", () => openShopForm(shop.id));
    card.querySelector(".btn-delete-shop").addEventListener("click", () => deleteShop(shop.id));

    return card;
  }

  function ratingIcon(rating) {
    if (rating === "good") return "◎";
    if (rating === "bad") return "▼";
    return "△";
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function truncate(str, len) {
    return str.length > len ? str.slice(0, len) + "…" : str;
  }

  // ---------- modal / forms ----------

  const modalRoot = document.getElementById("modal-root");

  function closeModal() {
    modalRoot.hidden = true;
    modalRoot.innerHTML = "";
  }

  function openModal(html) {
    modalRoot.innerHTML = `<div class="modal">${html}</div>`;
    modalRoot.hidden = false;
    modalRoot.onclick = (e) => {
      if (e.target === modalRoot) closeModal();
    };
  }

  function openShopForm(shopId) {
    const shop = shopId ? state.shops.find((s) => s.id === shopId) : null;
    openModal(`
      <h2>${shop ? "店舗を編集" : "店舗を追加"}</h2>
      <form id="shop-form">
        <label>店名
          <input type="text" name="name" required value="${shop ? escapeHtml(shop.name) : ""}">
        </label>
        <label>エリア
          <select name="area">
            <option value="osaka" ${shop && shop.area === "osaka" ? "selected" : ""}>大阪</option>
            <option value="nara" ${shop && shop.area === "nara" ? "selected" : ""}>奈良</option>
          </select>
        </label>
        <label>所在地・メモ(任意)
          <input type="text" name="city" value="${shop ? escapeHtml(shop.city || "") : ""}">
        </label>
        <div class="form-actions">
          <button type="button" class="btn" id="cancel-btn">キャンセル</button>
          <button type="submit" class="btn btn-primary">保存</button>
        </div>
      </form>
    `);
    document.getElementById("cancel-btn").addEventListener("click", closeModal);
    document.getElementById("shop-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      if (shop) {
        shop.name = fd.get("name").trim();
        shop.area = fd.get("area");
        shop.city = fd.get("city").trim();
      } else {
        state.shops.push({
          id: genId(),
          name: fd.get("name").trim(),
          area: fd.get("area"),
          city: fd.get("city").trim(),
          memo: "",
        });
      }
      saveState();
      closeModal();
      render();
    });
  }

  function deleteShop(shopId) {
    const shop = state.shops.find((s) => s.id === shopId);
    if (!shop) return;
    if (!confirm(`「${shop.name}」を削除します。関連する実戦データ・口コミも削除されます。よろしいですか?`)) return;
    state.shops = state.shops.filter((s) => s.id !== shopId);
    state.matchRecords = state.matchRecords.filter((r) => r.shopId !== shopId);
    state.reviews = state.reviews.filter((r) => r.shopId !== shopId);
    saveState();
    render();
  }

  function parsePastedMatchText(text) {
    const result = {};
    const diffMatch = text.match(/差[枚数]?\s*[:：]?\s*([+\-−]?[\d,]+)/);
    if (diffMatch) result.medalDiff = normalizeNumber(diffMatch[1]);

    const gameMatch = text.match(/(?:総回転数?|回転数?|G数)\s*[:：]?\s*([\d,]+)\s*G?/);
    if (gameMatch) result.gameCount = normalizeNumber(gameMatch[1]);

    const bbMatch = text.match(/(?:BB|BIG)(?:回数)?\s*[:：]?\s*([\d,]+)/i);
    if (bbMatch) result.bb = normalizeNumber(bbMatch[1]);

    const rbMatch = text.match(/(?:RB|REG)(?:回数)?\s*[:：]?\s*([\d,]+)/i);
    if (rbMatch) result.rb = normalizeNumber(rbMatch[1]);

    const unitMatch = text.match(/(?:台番号?|No\.?)\s*[:：]?\s*([\d,]+)/i);
    if (unitMatch) result.unitNumber = normalizeNumber(unitMatch[1]);

    return result;
  }

  function normalizeNumber(str) {
    return String(str).replace(/,/g, "").replace(/−/g, "-").replace(/^\+/, "");
  }

  function openMatchForm(shopId) {
    const shop = state.shops.find((s) => s.id === shopId);
    openModal(`
      <h2>実戦データを追加 - ${escapeHtml(shop.name)}</h2>
      <form id="match-form">
        <label>LINE通知等の本文を貼り付け(任意・自動で下の項目に反映を試みます)
          <textarea name="pasteText" placeholder="例: 台番号:123 差枚:+1500 G数:5800G BB:18 RB:12"></textarea>
        </label>
        <p class="paste-hint">パース精度は完全ではありません。貼り付け後は必ず下の項目を確認・修正してください。</p>
        <div class="row">
          <label>日付
            <input type="date" name="date" required value="${todayStr()}">
          </label>
          <label>情報源
            <select name="source">
              ${MATCH_SOURCE_OPTIONS.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="row">
          <label>機種名
            <input type="text" name="machineName" required placeholder="例: ジャグラーガールズSS">
          </label>
          <label>台番号(任意)
            <input type="text" name="unitNumber">
          </label>
        </div>
        <div class="row">
          <label>差枚
            <input type="number" name="medalDiff" required placeholder="例: 1500 / -800">
          </label>
          <label>G数
            <input type="number" name="gameCount" min="0">
          </label>
        </div>
        <div class="row">
          <label>BB回数
            <input type="number" name="bb" min="0">
          </label>
          <label>RB回数
            <input type="number" name="rb" min="0">
          </label>
        </div>
        <label>メモ(任意)
          <input type="text" name="memo">
        </label>
        <div class="form-actions">
          <button type="button" class="btn" id="cancel-btn">キャンセル</button>
          <button type="submit" class="btn btn-primary">保存</button>
        </div>
      </form>
    `);

    const form = document.getElementById("match-form");
    form.querySelector('[name="pasteText"]').addEventListener("input", (e) => {
      const parsed = parsePastedMatchText(e.target.value);
      for (const [key, value] of Object.entries(parsed)) {
        const field = form.querySelector(`[name="${key}"]`);
        if (field) field.value = value;
      }
    });

    document.getElementById("cancel-btn").addEventListener("click", closeModal);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      state.matchRecords.push({
        id: genId(),
        shopId,
        date: fd.get("date"),
        source: fd.get("source"),
        machineName: fd.get("machineName").trim(),
        unitNumber: fd.get("unitNumber").trim(),
        medalDiff: Number(fd.get("medalDiff")) || 0,
        gameCount: Number(fd.get("gameCount")) || 0,
        bb: Number(fd.get("bb")) || 0,
        rb: Number(fd.get("rb")) || 0,
        memo: fd.get("memo").trim(),
        createdAt: Date.now(),
      });
      saveState();
      closeModal();
      render();
    });
  }

  function openReviewForm(shopId) {
    const shop = state.shops.find((s) => s.id === shopId);
    openModal(`
      <h2>口コミを追加 - ${escapeHtml(shop.name)}</h2>
      <form id="review-form">
        <div class="row">
          <label>日付
            <input type="date" name="date" required value="${todayStr()}">
          </label>
          <label>情報源
            <select name="source">
              ${REVIEW_SOURCE_OPTIONS.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
            </select>
          </label>
        </div>
        <label>評価
          <select name="rating">
            <option value="good">良い</option>
            <option value="neutral" selected>普通</option>
            <option value="bad">悪い</option>
          </select>
        </label>
        <label>タグ(複数選択可)
          <div class="tag-checks">
            ${REVIEW_TAG_OPTIONS.map(
              (t) => `<label><input type="checkbox" name="tags" value="${escapeHtml(t)}"> ${escapeHtml(t)}</label>`
            ).join("")}
          </div>
        </label>
        <label>口コミ本文の要点(任意・コピペ可)
          <textarea name="text" placeholder="見かけた口コミの要点を貼り付け/要約してください"></textarea>
        </label>
        <div class="form-actions">
          <button type="button" class="btn" id="cancel-btn">キャンセル</button>
          <button type="submit" class="btn btn-primary">保存</button>
        </div>
      </form>
    `);

    document.getElementById("cancel-btn").addEventListener("click", closeModal);
    document.getElementById("review-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const tags = fd.getAll("tags");
      state.reviews.push({
        id: genId(),
        shopId,
        date: fd.get("date"),
        source: fd.get("source"),
        rating: fd.get("rating"),
        tags,
        text: fd.get("text").trim(),
        createdAt: Date.now(),
      });
      saveState();
      closeModal();
      render();
    });
  }

  // ---------- export / import ----------

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pachi-recommender-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.shops || !parsed.matchRecords || !parsed.reviews) {
          throw new Error("形式が正しくありません");
        }
        if (!confirm("現在のデータを上書きしてインポートします。よろしいですか?")) return;
        state = parsed;
        saveState();
        render();
      } catch (err) {
        alert("インポートに失敗しました: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  // ---------- init ----------

  function init() {
    document.getElementById("filter-area").addEventListener("change", render);
    document.getElementById("sort-key").addEventListener("change", render);
    document.getElementById("search-name").addEventListener("input", render);
    document.getElementById("freshness-days").addEventListener("input", (e) => {
      freshnessDays = Number(e.target.value) || 7;
      document.getElementById("fresh-days-label").textContent = freshnessDays;
      render();
    });
    document.getElementById("btn-add-shop").addEventListener("click", () => openShopForm(null));
    document.getElementById("btn-export").addEventListener("click", exportData);
    document.getElementById("input-import").addEventListener("change", (e) => {
      if (e.target.files[0]) importData(e.target.files[0]);
      e.target.value = "";
    });

    saveState();
    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
