(() => {
  const logoColors = [
    "red",
    "blue",
    "green",
    "navy",
    "purple",
    "orange",
    "teal",
  ];
  const elements = {
    breadcrumb: document.querySelector("#breadcrumb-model"),
    vendor: document.querySelector("#model-vendor"),
    title: document.querySelector("#model-title"),
    description: document.querySelector("#model-description"),
    select: document.querySelector("#page-model-select"),
    summaryProviders: document.querySelector("#summary-providers"),
    summarySamples: document.querySelector("#summary-samples"),
    summaryBest: document.querySelector("#summary-best"),
    sponsoredSection: document.querySelector("#model-sponsored-section"),
    sponsoredList: document.querySelector("#model-sponsored-list"),
    rankingTitle: document.querySelector("#ranking-title"),
    rankingList: document.querySelector("#model-ranking-list"),
    observingSection: document.querySelector("#model-observing-section"),
    observingList: document.querySelector("#model-observing-list"),
    empty: document.querySelector("#model-empty"),
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function scoreText(value) {
    return value === null || value === undefined
      ? "--"
      : `${(value / 100).toFixed(2)}%`;
  }

  function gradeForBps(value) {
    if (value === null || value === undefined) return null;
    if (value >= 9800) return "S";
    if (value >= 9500) return "A";
    if (value >= 9000) return "B";
    if (value >= 8000) return "C";
    return "D";
  }

  function statusText(status) {
    return (
      {
        normal: "当前正常",
        degraded: "近期波动",
        down: "当前不可用",
        configuration_error: "配置待修复",
        stale: "数据待更新",
        unknown: "数据积累中",
      }[status] || "状态未知"
    );
  }

  function tone(status) {
    if (status === "normal") return "is-green";
    if (status === "degraded") return "is-amber";
    if (status === "down") return "is-red";
    return "is-muted";
  }

  function relativeTime(value) {
    if (!value) return "暂无更新";
    const minutes = Math.max(
      0,
      Math.round((Date.now() - new Date(value).getTime()) / 60000),
    );
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    return `${Math.floor(hours / 24)} 天前`;
  }

  function logoColor(slug) {
    const seed = [...String(slug)].reduce(
      (total, char) => total + char.charCodeAt(0),
      0,
    );
    return logoColors[seed % logoColors.length];
  }

  function providerIdentity(row, rank, observing = false, subtitle = null) {
    const rankMarkup = observing
      ? '<span class="observation-rank">观察</span>'
      : `<span class="rank-number">${String(rank).padStart(2, "0")}</span>`;
    const name = row.provider.name || row.provider.slug;
    const mark = [...name.trim()][0]?.toUpperCase() || "L";
    const providerUrl = `./provider.html?slug=${encodeURIComponent(row.provider.slug)}`;
    const nameMarkup = `<a class="provider-name-link" href="${providerUrl}" title="查看 ${escapeHtml(name)} 的模型观测">${escapeHtml(name)}</a>`;
    return `<div class="provider-identity">
      ${rankMarkup}
      <span class="provider-logo logo-${logoColor(row.provider.slug)}">${escapeHtml(mark)}</span>
      <div class="provider-name">${nameMarkup}<span>${escapeHtml(subtitle || row.providerModelName)}</span></div>
    </div>`;
  }

  function trendTone(bucket) {
    if (bucket.availabilityBps === null || bucket.sampleCount === 0) return 0;
    if (bucket.availabilityBps >= 9800) return 1;
    if (bucket.availabilityBps >= 9000) return 2;
    if (bucket.availabilityBps >= 7500) return 3;
    if (bucket.availabilityBps >= 5000) return 4;
    return 5;
  }

  function bucketTitle(bucket) {
    const start = new Date(bucket.startsAt);
    const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
    const formatter = new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Shanghai",
    });
    const score =
      bucket.availabilityBps === null
        ? "暂无数据"
        : `可用率 ${scoreText(bucket.availabilityBps)}`;
    return `${formatter.format(start)} - ${formatter.format(end)} · ${score} · ${bucket.sampleCount} 次样本`;
  }

  function trendStrip(row, model) {
    const trend = Array.isArray(row.trend) ? row.trend : [];
    const bars = Array.from({ length: 56 }, (_, index) => {
      const bucket = trend[index];
      return bucket
        ? `<i class="trend-cell trend-${trendTone(bucket)}" title="${escapeHtml(bucketTitle(bucket))}"></i>`
        : '<i class="trend-cell trend-0" title="暂无数据"></i>';
    }).join("");
    return `<div class="ranking-trend"><span class="trend-strip" aria-label="${escapeHtml(model.displayName)} 近 7 日趋势">${bars}</span><small>近 7 日 · 3 小时/格</small></div>`;
  }

  function rowAction(row) {
    return `<a class="row-action" href="https://llm-hub.store/${encodeURIComponent(row.provider.slug)}" target="_blank" rel="noopener">公开状态页 <span aria-hidden="true">→</span></a>`;
  }

  function scoredRow(row, model, sponsored = false) {
    const grade = row.grade || gradeForBps(row.availabilityBps);
    return `<article class="${sponsored ? "model-sponsored-row" : "model-ranking-row"} model-data-row">
      ${providerIdentity(row, row.naturalRank || row.slot)}
      <div class="ranking-score"><strong>${scoreText(row.availabilityBps)}</strong><span class="grade grade-${String(grade).toLowerCase()}">${escapeHtml(grade)}</span></div>
      ${trendStrip(row, model)}
      <div class="ranking-fact"><strong>${row.sampleCount} 次</strong><span>更新于 ${relativeTime(row.lastCheckAt)}</span></div>
      <div class="ranking-fact"><strong>${scoreText(row.coverageBps)}</strong><span>${row.validBucketCount}/56 有效时段</span></div>
      <span class="status-line ${tone(row.currentStatus)}"><i></i>${statusText(row.currentStatus)}</span>
      ${rowAction(row)}
    </article>`;
  }

  function eligibilityText(row) {
    if (row.currentStatus === "configuration_error") return "配置待修复";
    if (row.currentStatus === "stale") return "数据待更新";
    if (row.currentStatus === "down") return "当前不可用";
    const reasons = {
      no_scoreable_samples: "暂无有效样本",
      insufficient_samples: `有效样本 ${row.sampleCount}/4`,
    };
    return reasons[row.eligibilityReason] || "数据积累中";
  }

  function observingRow(row, model) {
    return `<article class="model-ranking-row model-data-row">
      ${providerIdentity(row, 0, true, eligibilityText(row))}
      <div class="ranking-score"><strong>${scoreText(row.availabilityBps)}</strong></div>
      ${trendStrip(row, model)}
      <div class="ranking-fact"><strong>${row.sampleCount} 次</strong><span>更新于 ${relativeTime(row.lastCheckAt)}</span></div>
      <div class="ranking-fact"><strong>${scoreText(row.coverageBps)}</strong><span>${row.validBucketCount}/56 有效时段</span></div>
      <span class="status-line ${tone(row.currentStatus)}"><i></i>${statusText(row.currentStatus)}</span>
      ${rowAction(row)}
    </article>`;
  }

  function renderCatalog(models, selectedSlug) {
    elements.select.innerHTML = models
      .map(
        (item) =>
          `<option value="${escapeHtml(item.slug)}"${item.slug === selectedSlug ? " selected" : ""}>${escapeHtml(item.displayName)}</option>`,
      )
      .join("");
  }

  function renderBoard(board, catalog) {
    const { model } = board;
    const ranking = board.ranking || [];
    const sponsored = board.sponsored || [];
    const observing = board.observing || [];
    const uniqueRows = new Map();
    for (const row of [...sponsored, ...ranking, ...observing]) {
      uniqueRows.set(row.providerModelId, row);
    }
    const visible = [...uniqueRows.values()];
    const totalSamples = visible.reduce(
      (total, row) => total + row.sampleCount,
      0,
    );
    const scores = visible
      .map((row) => row.availabilityBps)
      .filter((value) => value !== null);
    const best = scores.length ? Math.max(...scores) : null;

    document.title = `${model.displayName} 中转站榜单 | LLMHub`;
    elements.breadcrumb.textContent = model.displayName;
    elements.vendor.textContent = `${model.vendor.toUpperCase()} · MODEL RANKING`;
    elements.title.textContent = `${model.displayName} 中转站榜单`;
    elements.description.textContent = model.description;
    elements.rankingTitle.textContent = `${model.displayName} Top 10 自然排名`;
    elements.summaryProviders.textContent = `${new Set(visible.map((row) => row.provider.slug)).size} 家`;
    elements.summarySamples.textContent = `${totalSamples} 次`;
    elements.summaryBest.textContent = scoreText(best);
    renderCatalog(catalog, model.slug);

    elements.sponsoredSection.hidden = !sponsored.length;
    elements.sponsoredList.innerHTML = sponsored
      .map((row) => scoredRow(row, model, true))
      .join("");
    elements.rankingList.innerHTML = ranking
      .map((row) => scoredRow(row, model))
      .join("");
    elements.empty.textContent = observing.length
      ? "暂无更多满足入榜门槛的服务商，以下服务商仍在积累观测数据。"
      : "该模型暂时没有可展示的观测数据。";
    elements.empty.hidden = Boolean(ranking.length);
    elements.observingSection.hidden = !observing.length;
    elements.observingList.innerHTML = observing
      .map((row) => observingRow(row, model))
      .join("");
  }

  function showError(message) {
    elements.title.textContent = "榜单暂时无法载入";
    elements.description.textContent = message;
    elements.rankingList.innerHTML = "";
    elements.empty.textContent = "观测数据没有被样例内容替代，请稍后刷新重试。";
    elements.empty.hidden = false;
    elements.observingSection.hidden = true;
    elements.sponsoredSection.hidden = true;
  }

  async function load() {
    const isLocal = ["localhost", "127.0.0.1"].includes(
      window.location.hostname,
    );
    const apiBase =
      window.LLMHUB_MARKETPLACE_API_URL ??
      (isLocal ? "http://127.0.0.1:3010" : "");
    const catalogResponse = await fetch(`${apiBase}/v1/models`, {
      headers: { accept: "application/json" },
    });
    if (!catalogResponse.ok)
      throw new Error(`模型目录请求失败（HTTP ${catalogResponse.status}）`);
    const catalogPayload = await catalogResponse.json();
    const catalog = catalogPayload.data || [];
    const requested = new URLSearchParams(window.location.search).get("model");
    const selected =
      catalog.find((item) => item.slug === requested) || catalog[0];
    if (!selected) throw new Error("当前没有可展示的模型");

    const boardResponse = await fetch(
      `${apiBase}/v1/models/${encodeURIComponent(selected.slug)}/leaderboard`,
      { headers: { accept: "application/json" } },
    );
    if (!boardResponse.ok)
      throw new Error(`模型榜单请求失败（HTTP ${boardResponse.status}）`);
    const boardPayload = await boardResponse.json();
    renderBoard(boardPayload.data, catalog);
  }

  elements.select.addEventListener("change", (event) => {
    window.location.href = `./model.html?model=${encodeURIComponent(event.target.value)}`;
  });

  load().catch((error) => {
    console.error(error);
    showError(error.message || "请稍后重试");
  });
})();
