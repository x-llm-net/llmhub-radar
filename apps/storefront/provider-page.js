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
    breadcrumb: document.querySelector("#breadcrumb-provider"),
    logo: document.querySelector("#provider-page-logo"),
    title: document.querySelector("#provider-page-title"),
    description: document.querySelector("#provider-page-description"),
    status: document.querySelector("#provider-page-status"),
    statusLink: document.querySelector("#provider-status-link"),
    websiteLink: document.querySelector("#provider-website-link"),
    summaryModels: document.querySelector("#provider-summary-models"),
    summarySamples: document.querySelector("#provider-summary-samples"),
    summaryBest: document.querySelector("#provider-summary-best"),
    summaryUpdated: document.querySelector("#provider-summary-updated"),
    modelCount: document.querySelector("#provider-model-count"),
    modelList: document.querySelector("#provider-model-list"),
    empty: document.querySelector("#provider-model-empty"),
    profile: document.querySelector("#provider-profile"),
    profileDescription: document.querySelector("#provider-profile-description"),
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeExternalUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function logoColor(slug) {
    const seed = [...String(slug)].reduce(
      (total, char) => total + char.charCodeAt(0),
      0,
    );
    return logoColors[seed % logoColors.length];
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
        configuration_error: "配置异常",
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

  function effectiveStatus(row) {
    if (
      !row.lastCheckAt ||
      Date.now() - new Date(row.lastCheckAt).getTime() > 30 * 60 * 1000
    ) {
      return "stale";
    }
    return row.currentStatus;
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

  function modelTone(model) {
    const family = String(model.family || "").toLowerCase();
    if (family.includes("claude")) return "claude";
    if (family.includes("gemini")) return "gemini";
    if (family.includes("grok")) return "grok";
    return "gpt";
  }

  function modelMark(model) {
    const family = String(model.family || model.vendor || "M");
    return [...family.trim()][0]?.toUpperCase() || "M";
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
    return `${formatter.format(start)} - ${formatter.format(end)} · ${score} · ${bucket.sampleCount} 次有效测试`;
  }

  function trendStrip(row, model) {
    const trend = Array.isArray(row.trend) ? row.trend : [];
    const bars = Array.from({ length: 56 }, (_, index) => {
      const bucket = trend[index];
      return bucket
        ? `<i class="trend-cell trend-${trendTone(bucket)}" title="${escapeHtml(bucketTitle(bucket))}"></i>`
        : '<i class="trend-cell trend-0" title="暂无数据"></i>';
    }).join("");
    return `<div class="ranking-trend"><span class="trend-strip" aria-label="${escapeHtml(model.displayName)} 近 7 日趋势">${bars}</span><small><span>近 7 日 · 3 小时/格</span><span>更新于 ${relativeTime(row.lastCheckAt)}</span></small></div>`;
  }

  function eligibilityText(row) {
    const status = effectiveStatus(row);
    if (status === "configuration_error") return "配置异常";
    if (status === "stale") return "数据待更新";
    if (status === "down") return "当前不可用";
    const reasons = {
      no_scoreable_samples: "暂无有效测试",
      insufficient_samples: `有效测试 ${row.sampleCount}/4`,
    };
    return reasons[row.eligibilityReason] || "数据积累中";
  }

  function modelRow(entry) {
    const row = entry.ranking || entry.observing;
    if (!row) return "";
    const ranked = Boolean(entry.ranking);
    const status = effectiveStatus(row);
    const grade = ranked ? row.grade || gradeForBps(row.availabilityBps) : null;
    const badge = ranked
      ? `<span class="grade grade-${String(grade).toLowerCase()}">${escapeHtml(grade)}</span>`
      : `<span class="observation-badge">${escapeHtml(eligibilityText(row))}</span>`;
    const rankText = ranked ? `实测排名 #${row.naturalRank}` : "数据积累中";
    return `<article class="provider-model-row">
      <div class="provider-model-identity">
        <span class="model-symbol ${modelTone(entry.model)}">${escapeHtml(modelMark(entry.model))}</span>
        <div><small>${escapeHtml(entry.model.vendor)} · ${escapeHtml(rankText)}</small><strong>${escapeHtml(entry.model.displayName)}</strong><small>${escapeHtml(row.providerModelName)}</small></div>
      </div>
      <div class="ranking-score"><strong>${scoreText(row.availabilityBps)}</strong>${badge}</div>
      ${trendStrip(row, entry.model)}
      <div class="ranking-fact"><strong>${row.sampleCount} 次有效测试</strong><span>${scoreText(row.coverageBps)} 数据完整度 · ${row.validBucketCount}/56 个时段有数据</span></div>
      <span class="status-line ${tone(status)}"><i></i>${statusText(status)}</span>
      <a class="row-action" href="./model.html?model=${encodeURIComponent(entry.model.slug)}">查看模型榜 <span aria-hidden="true">→</span></a>
    </article>`;
  }

  function summaryStatus(rows) {
    const statuses = rows.map(effectiveStatus);
    if (statuses.includes("down"))
      return { status: "down", text: "部分模型当前不可用" };
    if (statuses.includes("degraded"))
      return { status: "degraded", text: "部分模型近期波动" };
    if (statuses.includes("configuration_error"))
      return { status: "configuration_error", text: "部分模型配置异常" };
    if (statuses.includes("stale"))
      return { status: "stale", text: "榜单更新延迟" };
    if (rows.length && statuses.every((status) => status === "normal"))
      return { status: "normal", text: "当前测试正常" };
    return {
      status: "unknown",
      text: rows.length ? "部分数据仍在积累" : "暂无测试数据",
    };
  }

  function render(data) {
    const { provider } = data;
    const entries = Array.isArray(data.models) ? data.models : [];
    const rows = entries
      .map((entry) => entry.ranking || entry.observing)
      .filter(Boolean);
    const scores = rows
      .map((row) => row.availabilityBps)
      .filter((value) => value !== null);
    const totalSamples = rows.reduce(
      (total, row) => total + row.sampleCount,
      0,
    );
    const description = String(provider.description || "").trim();
    const websiteUrl = safeExternalUrl(provider.websiteUrl);
    const purchaseUrl = entries
      .map((entry) =>
        safeExternalUrl((entry.ranking || entry.observing)?.purchaseUrl),
      )
      .find(Boolean);
    const primaryUrl = purchaseUrl || websiteUrl;
    const name = provider.name || provider.slug;

    document.title = `${name} 模型实测 | LLMHub`;
    elements.breadcrumb.textContent = name;
    elements.title.textContent = name;
    elements.description.textContent = entries.length
      ? `持续测试 ${entries.length} 个具体模型，以下数据按模型独立统计。`
      : "该中转站暂时没有可展示的模型测试数据。";
    elements.logo.className = `provider-logo logo-${logoColor(provider.slug)}`;
    elements.logo.textContent = [...name.trim()][0]?.toUpperCase() || "L";
    const logoUrl = safeExternalUrl(provider.logoUrl);
    if (logoUrl) {
      const image = document.createElement("img");
      image.src = logoUrl;
      image.alt = "";
      image.addEventListener("error", () => image.remove(), { once: true });
      elements.logo.append(image);
    }

    const state = summaryStatus(rows);
    elements.status.className = `status-line ${tone(state.status)}`;
    elements.status.innerHTML = `<i></i>${escapeHtml(state.text)}`;
    elements.statusLink.href = `https://llm-hub.store/${encodeURIComponent(provider.slug)}`;
    elements.statusLink.hidden = false;
    if (primaryUrl) {
      elements.websiteLink.href = primaryUrl;
      elements.websiteLink.firstChild.textContent = purchaseUrl
        ? "前往中转站 "
        : "访问官网 ";
      elements.websiteLink.hidden = false;
    }

    elements.summaryModels.textContent = `${entries.length} 个`;
    elements.summarySamples.textContent = `${totalSamples} 次`;
    elements.summaryBest.textContent = scores.length
      ? scoreText(Math.max(...scores))
      : "--";
    elements.summaryUpdated.textContent = relativeTime(data.generatedAt);
    elements.modelCount.textContent = `${entries.filter((entry) => entry.ranking).length} 个入榜 · ${entries.filter((entry) => entry.observing).length} 个积累数据`;
    elements.modelList.innerHTML = entries.map(modelRow).join("");
    elements.modelList.hidden = !entries.length;
    elements.empty.hidden = Boolean(entries.length);

    if (description) {
      elements.profileDescription.textContent = description;
      elements.profile.hidden = false;
    }
  }

  function showError(message) {
    elements.title.textContent = "中转站详情暂时无法加载";
    elements.description.textContent = message;
    elements.status.className = "status-line is-muted";
    elements.status.innerHTML = "<i></i>数据不可用";
    elements.modelList.innerHTML = `<div class="leaderboard-error"><strong>数据暂时无法加载</strong><span>请稍后重试。</span><button type="button" id="retry-provider">重新加载</button></div>`;
    document
      .querySelector("#retry-provider")
      ?.addEventListener("click", () => window.location.reload());
  }

  async function load() {
    const slug = new URLSearchParams(window.location.search).get("slug");
    if (!slug) throw new Error("链接中缺少中转站标识");
    const isLocal = ["localhost", "127.0.0.1"].includes(
      window.location.hostname,
    );
    const apiBase =
      window.LLMHUB_MARKETPLACE_API_URL ??
      (isLocal ? "http://127.0.0.1:3010" : "");
    const response = await fetch(
      `${apiBase}/v1/providers/${encodeURIComponent(slug)}/rankings`,
      { headers: { accept: "application/json" } },
    );
    if (!response.ok) {
      if (response.status === 404)
        throw new Error("没有找到这个已公开的中转站");
      throw new Error(`中转站数据请求失败（HTTP ${response.status}）`);
    }
    const payload = await response.json();
    if (!payload.data?.provider) throw new Error("中转站数据格式不正确");
    render(payload.data);
  }

  load().catch((error) => {
    console.error(error);
    showError(error.message || "请稍后重试");
  });
})();
