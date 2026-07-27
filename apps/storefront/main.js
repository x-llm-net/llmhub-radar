(() => {
  const preferredFamilyOrder = ["Claude", "GPT", "Gemini", "Grok"];
  const familyDetails = {
    Claude: {
      anchor: "claude-rankings",
      title: "Claude 模型",
      heading: "Claude 模型排行榜",
      vendor: "Anthropic",
      description:
        "分别查看 Sonnet、Opus 等具体模型的独立可用率、样本和近 7 日趋势。",
      evidence: "ANTHROPIC · 站长授权 API Key",
    },
    GPT: {
      anchor: "openai-rankings",
      title: "OpenAI 模型",
      heading: "OpenAI 模型排行榜",
      vendor: "OpenAI",
      description: "分别查看 GPT 与 Codex 路由的可用率、近期状态和观测样本。",
      evidence: "OPENAI · 站长授权 API Key",
    },
    Gemini: {
      anchor: "gemini-rankings",
      title: "Gemini 模型",
      heading: "Gemini 模型排行榜",
      vendor: "Google",
      description:
        "分别查看 Gemini Pro 与 Flash 路由的可用率、趋势和样本新鲜度。",
      evidence: "GOOGLE · 站长授权 API Key",
    },
    Grok: {
      anchor: "xai-rankings",
      title: "Grok 模型",
      heading: "Grok 模型排行榜",
      vendor: "xAI",
      description: "单独查看 Grok 路由的可用率、近期状态和观测样本。",
      evidence: "XAI · 站长授权 API Key",
    },
  };
  function familySlug(value) {
    return (
      String(value || "other")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "other"
    );
  }

  function getFamilyDetail(family, vendor = family) {
    return (
      familyDetails[family] || {
        anchor: `${familySlug(family)}-rankings`,
        title: `${family} 模型`,
        heading: `${family} 模型排行榜`,
        vendor,
        description: `查看 ${family} 具体模型的近 7 日可用率、样本和持续观测结果。`,
        evidence: `${String(vendor).toUpperCase()} · 站长授权 API Key`,
      }
    );
  }

  function getFamilyOrder(rankings) {
    const available = [
      ...new Set(
        rankings.map((ranking) => ranking.model.family).filter(Boolean),
      ),
    ];
    return [
      ...preferredFamilyOrder.filter((family) => available.includes(family)),
      ...available
        .filter((family) => !preferredFamilyOrder.includes(family))
        .sort(),
    ];
  }
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
    familyGrid: document.querySelector("#family-grid"),
    leaderboardStack: document.querySelector("#leaderboard-stack"),
    providerCount: document.querySelector("#provider-count"),
    rankingUpdate: document.querySelector("#ranking-update"),
    toast: document.querySelector("#toast"),
    backToTop: document.querySelector("#back-to-top"),
    contactDialog: document.querySelector("#contact-dialog"),
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function gradeForBps(value) {
    if (value === null || value === undefined) return null;
    if (value >= 9800) return "S";
    if (value >= 9500) return "A";
    if (value >= 9000) return "B";
    if (value >= 8000) return "C";
    return "D";
  }

  function scoreText(value) {
    return value === null || value === undefined
      ? "--"
      : `${(value / 100).toFixed(2)}%`;
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
    const deltaMinutes = Math.max(
      0,
      Math.round((Date.now() - new Date(value).getTime()) / 60000),
    );
    if (deltaMinutes < 1) return "刚刚";
    if (deltaMinutes < 60) return `${deltaMinutes} 分钟前`;
    const hours = Math.floor(deltaMinutes / 60);
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

  function providerIdentity(row, rank, observing = false) {
    const rankMarkup = observing
      ? '<span class="observation-rank">观察</span>'
      : `<span class="rank-number">${String(rank).padStart(2, "0")}</span>`;
    const name = row.provider.name || row.provider.slug;
    const mark = [...name.trim()][0]?.toUpperCase() || "L";
    return `<div class="provider-identity">
      ${rankMarkup}
      <span class="provider-logo logo-${logoColor(row.provider.slug)}">${escapeHtml(mark)}</span>
      <div class="provider-name"><a class="provider-name-link" href="./provider.html?slug=${encodeURIComponent(row.provider.slug)}">${escapeHtml(name)}</a><span>${escapeHtml(row.providerModelName)}</span></div>
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
    const bars = trend
      .map((bucket) => {
        const value = trendTone(bucket);
        return `<i class="trend-cell trend-${value}" title="${escapeHtml(bucketTitle(bucket))}"></i>`;
      })
      .join("");
    const emptyBars = trend.length
      ? ""
      : Array.from(
          { length: 56 },
          () => '<i class="trend-cell trend-0" title="暂无数据"></i>',
        ).join("");
    return `<div class="ranking-trend">
      <span class="trend-strip" aria-label="${escapeHtml(model.displayName)} 近 7 日趋势">${bars || emptyBars}</span>
      <small><span>近 7 日 · 3 小时/格</span><span>${row.sampleCount} 次样本 · 更新于 ${relativeTime(row.lastCheckAt)}</span></small>
    </div>`;
  }

  function rowAction(row) {
    const href = `https://llm-hub.store/${encodeURIComponent(row.provider.slug)}`;
    return `<a class="row-action" href="${href}" target="_blank" rel="noopener">公开状态页 <span aria-hidden="true">→</span></a>`;
  }

  function scoredRow(row, model, sponsored = false) {
    const grade = row.grade || gradeForBps(row.availabilityBps);
    const rank = sponsored ? row.naturalRank || row.slot : row.naturalRank;
    return `<article class="${sponsored ? "model-sponsored-row" : "model-ranking-row"} model-data-row">
      ${providerIdentity(row, rank)}
      <div class="ranking-score"><strong>${scoreText(row.availabilityBps)}</strong><span class="grade grade-${String(grade).toLowerCase()}">${escapeHtml(grade)}</span></div>
      ${trendStrip(row, model)}
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
    return `<article class="model-observing-row model-data-row">
      ${providerIdentity(row, 0, true)}
      <div class="ranking-score"><strong>${scoreText(row.availabilityBps)}</strong><span class="observation-badge">${escapeHtml(eligibilityText(row))}</span></div>
      ${trendStrip(row, model)}
      <span class="status-line ${tone(row.currentStatus)}"><i></i>${statusText(row.currentStatus)}</span>
      ${rowAction(row)}
    </article>`;
  }

  function renderFamilies(rankings, families) {
    elements.familyGrid.innerHTML = families
      .map((family) => {
        const familyRankings = rankings.filter(
          (ranking) => ranking.model.family === family,
        );
        const detail = getFamilyDetail(family, familyRankings[0]?.model.vendor);
        const count = familyRankings.length;
        return `<a class="protocol-link" href="#${detail.anchor}">
        <span class="protocol-tab-top"><small>${detail.vendor}</small><em>${count} 个模型</em></span>
        <strong>${detail.title}</strong>
        <span>${detail.description}</span>
        <b>查看对应排行榜 <span aria-hidden="true">→</span></b>
      </a>`;
      })
      .join("");
  }

  function leaderboard(board) {
    const model = board.model;
    const detail = getFamilyDetail(model.family, model.vendor);
    const ranked = board.ranking || [];
    const sponsored = board.sponsored || [];
    const observing = board.observing || [];
    const visibleRows = [...ranked, ...observing];
    const totalSamples = visibleRows.reduce(
      (total, row) => total + row.sampleCount,
      0,
    );
    const validScores = ranked
      .map((row) => row.availabilityBps)
      .filter((value) => value !== null);
    const best = validScores.length
      ? scoreText(Math.max(...validScores))
      : "--";
    const sponsorMarkup = sponsored.length
      ? sponsored.map((row) => scoredRow(row, model, true)).join("")
      : '<div class="leaderboard-no-sponsor">当前模型暂无赞助置顶。</div>';
    const rankingMarkup = ranked.length
      ? ranked.map((row) => scoredRow(row, model)).join("")
      : '<div class="empty-state">当前还没有达到 4 次有效探测的服务商。</div>';
    const observingMarkup = observing.length
      ? `<div class="leaderboard-observing-label"><strong>观察中</strong><span>达到 4 次有效探测后进入自然排名，低可用率也会按真实分数展示。</span></div>
         <div class="model-ranking-list leaderboard-observing">${observing.map((row) => observingRow(row, model)).join("")}</div>`
      : "";

    return `<section class="model-leaderboard" aria-labelledby="leaderboard-${escapeHtml(model.slug)}">
      <header class="leaderboard-header">
        <div>
          <p class="leaderboard-evidence">${detail.evidence}</p>
          <h3 id="leaderboard-${escapeHtml(model.slug)}">${escapeHtml(model.displayName)} 中转站榜</h3>
          <span>${escapeHtml(model.description || "")}</span>
        </div>
        <div class="leaderboard-summary"><span>${ranked.length} 家入榜</span><span>${observing.length} 家观察中</span><span>${totalSamples} 次样本</span><strong>最高 ${best}</strong></div>
        <a class="quiet-button" href="./model.html?model=${encodeURIComponent(model.slug)}">查看全部 <span aria-hidden="true">→</span></a>
      </header>
      <div class="leaderboard-columns" aria-hidden="true"><span>服务商</span><span>7 天可用率</span><span>近 7 日检测</span><span>当前状态</span><span></span></div>
      <div class="sponsor-rule-row"><strong>赞助置顶</strong><span>广告位，已通过基础质量门槛；付费不改检测分与自然排名。</span></div>
      <div class="leaderboard-sponsored">${sponsorMarkup}</div>
      <div class="leaderboard-natural-label"><strong>Top 10 自然排名</strong><span>赞助服务商仍按真实分数进入对应名次</span></div>
      <div class="model-ranking-list leaderboard-ranking">${rankingMarkup}</div>
      ${observingMarkup}
    </section>`;
  }

  function familyLeaderboards(family, rankings) {
    const familyRankings = rankings.filter(
      (ranking) => ranking.model.family === family,
    );
    const detail = getFamilyDetail(family, familyRankings[0]?.model.vendor);
    return `<section class="family-leaderboards" id="${detail.anchor}" aria-labelledby="${detail.anchor}-title">
      <header class="family-leaderboards-heading"><div><p class="section-kicker">${detail.vendor.toUpperCase()}</p><h3 id="${detail.anchor}-title">${detail.heading}</h3></div><span>${familyRankings.length} 个具体模型</span></header>
      <div class="family-board-list">${familyRankings.map(leaderboard).join("")}</div>
    </section>`;
  }

  function render(rankings, providerCount, latestStatsAt) {
    const families = getFamilyOrder(rankings);
    renderFamilies(rankings, families);
    elements.leaderboardStack.innerHTML = families
      .map((family) => familyLeaderboards(family, rankings))
      .join("");
    const visibleProviderSlugs = new Set();
    for (const board of rankings) {
      for (const row of [
        ...(board.ranking || []),
        ...(board.observing || []),
      ]) {
        visibleProviderSlugs.add(row.provider.slug);
      }
    }
    const coveredProviderCount = Number.isInteger(providerCount)
      ? providerCount
      : visibleProviderSlugs.size;
    if (elements.providerCount)
      elements.providerCount.textContent = `${coveredProviderCount} 家`;

    const generatedAt = rankings
      .map((board) => board.generatedAt)
      .filter(Boolean)
      .sort()
      .at(-1);
    if (elements.rankingUpdate && generatedAt) {
      elements.rankingUpdate.classList.remove("is-error");
      elements.rankingUpdate.innerHTML = `<i aria-hidden="true"></i> 数据更新于 ${relativeTime(generatedAt)}`;
    } else if (elements.rankingUpdate) {
      elements.rankingUpdate.classList.add("is-error");
      const delayText = latestStatsAt
        ? ` · 上次同步于 ${relativeTime(latestStatsAt)}`
        : "";
      elements.rankingUpdate.innerHTML = `<i aria-hidden="true"></i> 观测数据更新延迟${delayText}`;
    }
  }

  async function loadRankings() {
    const isLocal = ["localhost", "127.0.0.1"].includes(
      window.location.hostname,
    );
    const configuredBase = window.LLMHUB_MARKETPLACE_API_URL;
    const apiBase = configuredBase ?? (isLocal ? "http://127.0.0.1:3010" : "");
    const response = await fetch(`${apiBase}/v1/homepage`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok)
      throw new Error(`Marketplace API returned HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.data))
      throw new Error("Marketplace API returned invalid data");
    return {
      rankings: payload.data,
      providerCount: payload.meta?.providerCount,
      latestStatsAt: payload.meta?.latestStatsAt ?? null,
    };
  }

  let toastTimer;
  function showToast(message) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    toastTimer = setTimeout(
      () => elements.toast.classList.remove("is-visible"),
      2600,
    );
  }

  function updateBackToTop() {
    elements.backToTop?.classList.toggle("is-visible", window.scrollY > 520);
  }

  elements.backToTop?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  window.addEventListener("scroll", updateBackToTop, { passive: true });
  updateBackToTop();
  document.querySelectorAll('[href="#contact"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      elements.contactDialog?.showModal();
    });
  });
  elements.contactDialog?.addEventListener("click", (event) => {
    if (event.target === elements.contactDialog) elements.contactDialog.close();
  });
  document.querySelectorAll("[data-copy-contact]").forEach((button) => {
    button.addEventListener("click", async () => {
      const value = button.dataset.copyContact;
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        showToast("已复制：" + value);
      } catch {
        showToast("请手动复制：" + value);
      }
    });
  });

  elements.leaderboardStack.innerHTML =
    '<div class="leaderboard-loading">正在载入真实观测数据...</div>';
  loadRankings()
    .then(({ rankings, providerCount, latestStatsAt }) =>
      render(rankings, providerCount, latestStatsAt),
    )
    .catch((error) => {
      console.error(error);
      elements.familyGrid.innerHTML = "";
      if (elements.rankingUpdate) {
        elements.rankingUpdate.classList.add("is-error");
        elements.rankingUpdate.innerHTML =
          '<i aria-hidden="true"></i> 观测数据暂不可用';
      }
      elements.leaderboardStack.innerHTML =
        '<div class="leaderboard-error"><strong>榜单暂时无法载入</strong><span>观测数据没有被样例内容替代，请稍后刷新重试。</span><button type="button" id="retry-rankings">重新加载</button></div>';
      document
        .querySelector("#retry-rankings")
        ?.addEventListener("click", () => window.location.reload());
    });
})();
