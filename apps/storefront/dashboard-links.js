(() => {
  const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const dashboardOrigin = isLocal
    ? "http://localhost:3000"
    : "https://app.llm-hub.store";

  document.querySelectorAll("[data-dashboard-path]").forEach((link) => {
    link.href = new URL(link.dataset.dashboardPath, dashboardOrigin).toString();
  });
})();
