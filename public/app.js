const ROUTES = {
  dashboard: "dashboard",
  providerEdit: "provider-edit",
  usage: "usage",
  cache: "cache",
};

const routeLinks = [...document.querySelectorAll("[data-route-link]")];
const screens = {
  [ROUTES.dashboard]: document.getElementById("screen-dashboard"),
  [ROUTES.providerEdit]: document.getElementById("screen-provider-edit"),
  [ROUTES.usage]: document.getElementById("screen-usage"),
  [ROUTES.cache]: document.getElementById("screen-cache"),
};

const form = document.getElementById("check-form");
const submitBtn = document.getElementById("submitBtn");
const statusEl = document.getElementById("status");
const allowedEl = document.getElementById("allowed");
const remainingEl = document.getElementById("remaining");
const usedLimitEl = document.getElementById("usedLimit");
const rawEl = document.getElementById("raw");

const cachePillEl = document.getElementById("cachePill");
const cacheProviderSelectEl = document.getElementById("cacheProviderSelect");
const cacheProviderStatsPillEl = document.getElementById("cacheProviderStatsPill");
const cacheProviderNameEl = document.getElementById("cacheProviderName");
const cacheRequestIdEl = document.getElementById("cacheRequestId");
const cacheModelEl = document.getElementById("cacheModel");
const cacheKeyEl = document.getElementById("cacheKey");
const cacheRetentionEl = document.getElementById("cacheRetention");
const cacheTokensEl = document.getElementById("cacheTokens");
const cacheSavedPercentEl = document.getElementById("cacheSavedPercent");
const cacheHitStreakEl = document.getElementById("cacheHitStreak");
const cacheTargetEl = document.getElementById("cacheTarget");
const cacheTruncationEl = document.getElementById("cacheTruncation");
const cacheReasoningEl = document.getElementById("cacheReasoning");
const cacheProviderRequestsEl = document.getElementById("cacheProviderRequests");
const cacheProviderHitsEl = document.getElementById("cacheProviderHits");
const cacheProviderMissesEl = document.getElementById("cacheProviderMisses");
const cacheProviderHitRateEl = document.getElementById("cacheProviderHitRate");
const cacheProviderTelemetryEl = document.getElementById("cacheProviderTelemetry");
const cacheProviderCachedTokensEl = document.getElementById("cacheProviderCachedTokens");
const cacheProviderAvgSavedEl = document.getElementById("cacheProviderAvgSaved");
const cacheProviderTableBodyEl = document.getElementById("cacheProviderTableBody");

const providerTableBodyEl = document.getElementById("providerTableBody");
const providerMetaEl = document.getElementById("providerMeta");

const statProvidersEl = document.getElementById("statProviders");
const statCustomProvidersEl = document.getElementById("statCustomProviders");
const statCurrentModelEl = document.getElementById("statCurrentModel");
const statModelModeEl = document.getElementById("statModelMode");
const statCacheStatusEl = document.getElementById("statCacheStatus");
const statCachedTokensEl = document.getElementById("statCachedTokens");
const statCacheSavedEl = document.getElementById("statCacheSaved");
const statCacheHitStreakEl = document.getElementById("statCacheHitStreak");
const statLastRequestIdEl = document.getElementById("statLastRequestId");
const statsTodayRequestsEl = document.getElementById("statsTodayRequests");
const statsTodayHitsEl = document.getElementById("statsTodayHits");
const statsTodayHitRateEl = document.getElementById("statsTodayHitRate");
const statsTodayTelemetryEl = document.getElementById("statsTodayTelemetry");
const statsTodayCachedTokensEl = document.getElementById("statsTodayCachedTokens");
const statsTodayInputTokensEl = document.getElementById("statsTodayInputTokens");
const statsTodayAvgSavedEl = document.getElementById("statsTodayAvgSaved");
const statsMonthRequestsEl = document.getElementById("statsMonthRequests");
const statsMonthHitsEl = document.getElementById("statsMonthHits");
const statsMonthHitRateEl = document.getElementById("statsMonthHitRate");
const statsMonthTelemetryEl = document.getElementById("statsMonthTelemetry");
const statsMonthCachedTokensEl = document.getElementById("statsMonthCachedTokens");
const statsMonthInputTokensEl = document.getElementById("statsMonthInputTokens");
const statsMonthAvgSavedEl = document.getElementById("statsMonthAvgSaved");
const dailyStatsTableBodyEl = document.getElementById("dailyStatsTableBody");
const providerStatsTableBodyEl = document.getElementById("providerStatsTableBody");

const providerEditorPillEl = document.getElementById("providerEditorPill");
const providerEditorMetaEl = document.getElementById("providerEditorMeta");
const providerEditorIdEl = document.getElementById("providerEditorId");
const customProviderNameEl = document.getElementById("customProviderName");
const customProviderBaseUrlEl = document.getElementById("customProviderBaseUrl");
const providerApiKeysListEl = document.getElementById("providerApiKeysList");
const providerApiKeyTemplateEl = document.getElementById("providerApiKeyTemplate");
const addProviderApiKeyBtnEl = document.getElementById("addProviderApiKeyBtn");
const clientApiKeysListEl = document.getElementById("clientApiKeysList");
const clientApiKeyTemplateEl = document.getElementById("clientApiKeyTemplate");
const addClientApiKeyBtnEl = document.getElementById("addClientApiKeyBtn");
const providerOwnedByEl = document.getElementById("providerOwnedBy");
const providerUsageCheckUrlEl = document.getElementById("providerUsageCheckUrl");
const providerUsageCheckEnabledEl = document.getElementById("providerUsageCheckEnabled");
const providerStripMaxOutputTokensEl = document.getElementById("providerStripMaxOutputTokens");
const providerSanitizeReasoningSummaryEl = document.getElementById("providerSanitizeReasoningSummary");
const providerStripModelPrefixesEl = document.getElementById("providerStripModelPrefixes");
const customProviderBtnEl = document.getElementById("customProviderBtn");
const providerDeleteBtnEl = document.getElementById("providerDeleteBtn");

let providerState = { activeProviderId: "", providers: [] };
let latestCacheSnapshot = null;
let usageStatsState = null;
let currentRoute = "";
let selectedCacheProviderId = "";

function normalizeRoute() {
  const route = window.location.hash.replace(/^#\/?/, "").trim();
  const [name, query = ""] = route.split("?");
  const normalizedName = Object.values(ROUTES).includes(name) ? name : ROUTES.dashboard;
  return { name: normalizedName, query: new URLSearchParams(query) };
}

function setRoute(routeState) {
  currentRoute = routeState.name;
  for (const [name, screenEl] of Object.entries(screens)) {
    screenEl.classList.toggle("active", name === routeState.name);
  }
  for (const link of routeLinks) {
    const target = (link.getAttribute("href") || "").replace(/^#\/?/, "");
    link.classList.toggle("active", target === routeState.name);
  }
  if (routeState.name === ROUTES.providerEdit) {
    hydrateProviderEditorFromRoute(routeState.query);
  }
  refreshActiveRoute();
}

function isEditingProviderForm() {
  const active = document.activeElement;
  return (
    active === customProviderNameEl ||
    active === customProviderBaseUrlEl ||
    active === providerOwnedByEl ||
    active === providerUsageCheckUrlEl ||
    active === providerUsageCheckEnabledEl ||
    active === providerStripMaxOutputTokensEl ||
    active === providerSanitizeReasoningSummaryEl ||
    active === providerStripModelPrefixesEl ||
    providerApiKeysListEl.contains(active) ||
    clientApiKeysListEl.contains(active)
  );
}

function getEditableProviders() {
  return providerState.providers;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function setProviderEditor(provider) {
  const capabilities = provider?.capabilities || {};
  providerEditorIdEl.value = provider?.id || "";
  customProviderNameEl.value = provider?.name || "";
  customProviderBaseUrlEl.value = provider?.baseUrl || "";
  providerOwnedByEl.value = capabilities.ownedBy || "";
  providerUsageCheckUrlEl.value = capabilities.usageCheckUrl || "";
  providerUsageCheckEnabledEl.checked = capabilities.usageCheckEnabled === true;
  providerStripMaxOutputTokensEl.checked = capabilities.stripMaxOutputTokens === true;
  providerSanitizeReasoningSummaryEl.checked =
    capabilities.sanitizeReasoningSummary === true;
  providerStripModelPrefixesEl.value = Array.isArray(capabilities.stripModelPrefixes)
    ? capabilities.stripModelPrefixes.join(", ")
    : "";
  renderProviderApiKeyInputs(
    Array.isArray(provider?.providerApiKeys) ? provider.providerApiKeys : [""],
  );
  renderClientApiKeyInputs(
    Array.isArray(provider?.clientApiKeys) ? provider.clientApiKeys : [""],
  );
  customProviderBtnEl.textContent = provider ? "Update provider" : "Save provider";
  providerDeleteBtnEl.disabled = !provider;
  providerEditorPillEl.className = provider ? "pill ok-pill" : "pill";
  providerEditorPillEl.textContent = provider ? `Editing: ${provider.name}` : "Create mode";
  providerEditorMetaEl.textContent = provider
    ? `Editing provider ${provider.id} · upstream keys + proxy client keys`
    : "Endpoint: POST /api/providers, PUT /api/providers/:providerId";
}

function renderProviderApiKeyInputs(values) {
  providerApiKeysListEl.innerHTML = "";
  const items = Array.isArray(values) && values.length ? values : [""];
  for (const value of items) {
    appendProviderApiKeyInput(value);
  }
  syncProviderApiKeyRemoveButtons();
}

function appendProviderApiKeyInput(value = "") {
  const fragment = providerApiKeyTemplateEl.content.cloneNode(true);
  const row = fragment.querySelector(".api-key-row");
  const input = fragment.querySelector(".provider-api-key-input");
  const removeBtn = fragment.querySelector(".provider-api-key-remove");
  input.value = value;
  removeBtn.addEventListener("click", () => {
    row.remove();
    if (!providerApiKeysListEl.children.length) {
      appendProviderApiKeyInput("");
    }
    syncProviderApiKeyRemoveButtons();
  });
  providerApiKeysListEl.appendChild(fragment);
}

function syncProviderApiKeyRemoveButtons() {
  const rows = [...providerApiKeysListEl.querySelectorAll(".api-key-row")];
  for (const row of rows) {
    const removeBtn = row.querySelector(".provider-api-key-remove");
    removeBtn.disabled = rows.length === 1;
  }
}

function renderClientApiKeyInputs(values) {
  clientApiKeysListEl.innerHTML = "";
  const items = Array.isArray(values) && values.length ? values : [""];
  for (const value of items) {
    appendClientApiKeyInput(value);
  }
  syncClientApiKeyRemoveButtons();
}

function appendClientApiKeyInput(value = "") {
  const fragment = clientApiKeyTemplateEl.content.cloneNode(true);
  const row = fragment.querySelector(".api-key-row");
  const input = fragment.querySelector(".client-api-key-input");
  const removeBtn = fragment.querySelector(".client-api-key-remove");
  input.value = value;
  removeBtn.addEventListener("click", () => {
    row.remove();
    if (!clientApiKeysListEl.children.length) {
      appendClientApiKeyInput("");
    }
    syncClientApiKeyRemoveButtons();
  });
  clientApiKeysListEl.appendChild(fragment);
}

function syncClientApiKeyRemoveButtons() {
  const rows = [...clientApiKeysListEl.querySelectorAll(".api-key-row")];
  for (const row of rows) {
    const removeBtn = row.querySelector(".client-api-key-remove");
    removeBtn.disabled = rows.length === 1;
  }
}

function collectProviderApiKeys() {
  return [...providerApiKeysListEl.querySelectorAll(".provider-api-key-input")]
    .map((input) => input.value.trim())
    .filter(Boolean);
}

function collectClientApiKeys() {
  return [...clientApiKeysListEl.querySelectorAll(".client-api-key-input")]
    .map((input) => input.value.trim())
    .filter(Boolean);
}

function collectProviderCapabilities() {
  return {
    ownedBy: providerOwnedByEl.value.trim(),
    usageCheckEnabled: providerUsageCheckEnabledEl.checked,
    usageCheckUrl: providerUsageCheckUrlEl.value.trim(),
    stripMaxOutputTokens: providerStripMaxOutputTokensEl.checked,
    sanitizeReasoningSummary: providerSanitizeReasoningSummaryEl.checked,
    stripModelPrefixes: providerStripModelPrefixesEl.value
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function goToProviderEditor(providerId) {
  if (providerId) {
    window.location.hash = `#/provider-edit?id=${encodeURIComponent(providerId)}`;
    return;
  }
  window.location.hash = "#/provider-edit";
}

function hydrateProviderEditorFromRoute(query) {
  if (isEditingProviderForm()) return;
  const providerId = query.get("id") || "";
  if (!providerId) {
    setProviderEditor();
    return;
  }
  const provider = getEditableProviders().find((item) => item.id === providerId);
  setProviderEditor(provider || null);
}

function renderProviderTable() {
  const providers = providerState.providers;
  providerTableBodyEl.innerHTML = "";
  if (!providers.length) {
    const emptyRow = document.createElement("tr");
    emptyRow.innerHTML = '<td colspan="7" class="mono">No providers</td>';
    providerTableBodyEl.appendChild(emptyRow);
    return;
  }

  for (const provider of providers) {
    const capabilities = provider.capabilities || {};
    const capabilitySummary = [
      capabilities.usageCheckEnabled && capabilities.usageCheckUrl ? "usage-check" : "",
      capabilities.stripMaxOutputTokens ? "strip-max-output" : "",
      capabilities.sanitizeReasoningSummary ? "sanitize-reasoning" : "",
      Array.isArray(capabilities.stripModelPrefixes) && capabilities.stripModelPrefixes.length
        ? `prefixes:${capabilities.stripModelPrefixes.join(",")}`
        : "",
    ]
      .filter(Boolean)
      .join(" | ");
    const row = document.createElement("tr");
    row.className = "provider-row";
    row.innerHTML =
      '<td>' +
      escapeHtml(provider.name) +
      "</td>" +
      '<td class="mono">' + escapeHtml(provider.id) + "</td>" +
      '<td class="mono">' + escapeHtml(provider.baseUrl) + "</td>" +
      '<td class="mono">' + escapeHtml(capabilitySummary || "Default") + "</td>" +
      `<td>${provider.providerApiKeysCount ? `${provider.providerApiKeysCount} key${provider.providerApiKeysCount === 1 ? "" : "s"}` : "Not set"}</td>` +
      `<td>${provider.clientApiKeysCount ? `${provider.clientApiKeysCount} key${provider.clientApiKeysCount === 1 ? "" : "s"}` : "Not set"}</td>` +
      "<td></td>";

    const actionCell = row.lastElementChild;
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.className = "table-button";
    editBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      goToProviderEditor(provider.id);
    });
    actionCell.appendChild(editBtn);
    providerTableBodyEl.appendChild(row);
  }
}

function renderOverviewStats() {
  statProvidersEl.textContent = String(providerState.providers.length || 0);
  statCustomProvidersEl.textContent = String(providerState.providers.length || 0);
  statCurrentModelEl.textContent = latestCacheSnapshot?.model || "Client-provided";
  statModelModeEl.textContent = latestCacheSnapshot?.model ? "Observed" : "Per request";
  statCacheStatusEl.textContent =
    latestCacheSnapshot?.cacheHit === true
      ? "Hit"
      : latestCacheSnapshot?.cacheHit === false
        ? "Miss"
        : "No data";
  statCachedTokensEl.textContent =
    latestCacheSnapshot?.cachedTokens === undefined ? "-" : String(latestCacheSnapshot.cachedTokens);
  statCacheSavedEl.textContent =
    latestCacheSnapshot?.cacheSavedPercent === undefined
      ? "-"
      : `${latestCacheSnapshot.cacheSavedPercent}%`;
  statCacheHitStreakEl.textContent =
    latestCacheSnapshot?.consecutiveCacheHits === undefined
      ? "-"
      : String(latestCacheSnapshot.consecutiveCacheHits);
  statLastRequestIdEl.textContent = latestCacheSnapshot?.requestId || "-";
}

function getSelectedCacheProvider() {
  return providerState.providers.find((provider) => provider.id === selectedCacheProviderId) || null;
}

function getProviderStatsEntry(providerId) {
  const entries = Array.isArray(usageStatsState?.byProvider) ? usageStatsState.byProvider : [];
  return entries.find((entry) => entry.key === providerId) || null;
}

function syncSelectedCacheProvider() {
  const providers = providerState.providers;
  if (!providers.length) {
    selectedCacheProviderId = "";
    return;
  }

  if (
    selectedCacheProviderId &&
    providers.some((provider) => provider.id === selectedCacheProviderId)
  ) {
    return;
  }

  if (
    latestCacheSnapshot?.providerId &&
    providers.some((provider) => provider.id === latestCacheSnapshot.providerId)
  ) {
    selectedCacheProviderId = latestCacheSnapshot.providerId;
    return;
  }

  selectedCacheProviderId = providerState.activeProviderId || providers[0].id;
}

function renderCacheProviderSelect() {
  if (!cacheProviderSelectEl) return;
  syncSelectedCacheProvider();
  cacheProviderSelectEl.innerHTML = "";

  if (!providerState.providers.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No providers";
    cacheProviderSelectEl.appendChild(option);
    cacheProviderSelectEl.disabled = true;
    return;
  }

  cacheProviderSelectEl.disabled = false;
  for (const provider of providerState.providers) {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = `${provider.name} (${provider.id})`;
    cacheProviderSelectEl.appendChild(option);
  }
  cacheProviderSelectEl.value = selectedCacheProviderId;
}

function formatNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : "-";
}

function formatPercent(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${value}%` : "-";
}

function renderUsageStats() {
  const today = usageStatsState?.today;
  const month = usageStatsState?.month;
  const daily = Array.isArray(usageStatsState?.daily) ? usageStatsState.daily : [];
  const byProvider = Array.isArray(usageStatsState?.byProvider) ? usageStatsState.byProvider : [];

  statsTodayRequestsEl.textContent = formatNumber(today?.requests);
  statsTodayHitsEl.textContent = formatNumber(today?.hits);
  statsTodayHitRateEl.textContent = formatPercent(today?.hitRate);
  statsTodayTelemetryEl.textContent = formatPercent(today?.telemetryCoverage);
  statsTodayCachedTokensEl.textContent = formatNumber(today?.totalCachedTokens);
  statsTodayInputTokensEl.textContent = formatNumber(today?.totalInputTokens);
  statsTodayAvgSavedEl.textContent = formatPercent(today?.avgCacheSavedPercent);

  statsMonthRequestsEl.textContent = formatNumber(month?.requests);
  statsMonthHitsEl.textContent = formatNumber(month?.hits);
  statsMonthHitRateEl.textContent = formatPercent(month?.hitRate);
  statsMonthTelemetryEl.textContent = formatPercent(month?.telemetryCoverage);
  statsMonthCachedTokensEl.textContent = formatNumber(month?.totalCachedTokens);
  statsMonthInputTokensEl.textContent = formatNumber(month?.totalInputTokens);
  statsMonthAvgSavedEl.textContent = formatPercent(month?.avgCacheSavedPercent);

  dailyStatsTableBodyEl.innerHTML = "";
  if (!daily.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="6" class="mono">No usage stats yet</td>';
    dailyStatsTableBodyEl.appendChild(row);
    return;
  }

  for (const entry of daily.slice(0, 14)) {
    const row = document.createElement("tr");
    row.innerHTML =
      `<td class="mono">${escapeHtml(entry.date || "-")}</td>` +
      `<td>${formatNumber(entry.requests)}</td>` +
      `<td>${formatNumber(entry.hits)}</td>` +
      `<td>${formatPercent(entry.hitRate)}</td>` +
      `<td>${formatNumber(entry.totalCachedTokens)}</td>` +
      `<td>${formatPercent(entry.avgCacheSavedPercent)}</td>`;
    dailyStatsTableBodyEl.appendChild(row);
  }

  providerStatsTableBodyEl.innerHTML = "";
  if (!byProvider.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="8" class="mono">No provider stats yet</td>';
    providerStatsTableBodyEl.appendChild(row);
    return;
  }

  for (const entry of byProvider) {
    const row = document.createElement("tr");
    row.innerHTML =
      `<td class="mono">${escapeHtml(entry.key || "-")}</td>` +
      `<td>${formatNumber(entry.requests)}</td>` +
      `<td>${formatNumber(entry.hits)}</td>` +
      `<td>${formatNumber(entry.misses)}</td>` +
      `<td>${formatPercent(entry.hitRate)}</td>` +
      `<td>${formatPercent(entry.telemetryCoverage)}</td>` +
      `<td>${formatNumber(entry.totalCachedTokens)}</td>` +
      `<td>${formatPercent(entry.avgCacheSavedPercent)}</td>`;
    providerStatsTableBodyEl.appendChild(row);
  }
}

function renderCacheProviderStats() {
  const selectedProvider = getSelectedCacheProvider();
  const providerStats = selectedProvider ? getProviderStatsEntry(selectedProvider.id) : null;
  const allProviderStats = Array.isArray(usageStatsState?.byProvider) ? usageStatsState.byProvider : [];

  cacheProviderRequestsEl.textContent = formatNumber(providerStats?.requests);
  cacheProviderHitsEl.textContent = formatNumber(providerStats?.hits);
  cacheProviderMissesEl.textContent = formatNumber(providerStats?.misses);
  cacheProviderHitRateEl.textContent = formatPercent(providerStats?.hitRate);
  cacheProviderTelemetryEl.textContent = formatPercent(providerStats?.telemetryCoverage);
  cacheProviderCachedTokensEl.textContent = formatNumber(providerStats?.totalCachedTokens);
  cacheProviderAvgSavedEl.textContent = formatPercent(providerStats?.avgCacheSavedPercent);

  if (selectedProvider && providerStats) {
    cacheProviderStatsPillEl.className = "pill ok-pill";
    cacheProviderStatsPillEl.textContent =
      `${selectedProvider.name} · ${formatPercent(providerStats.hitRate)} measured hit rate`;
  } else if (selectedProvider) {
    cacheProviderStatsPillEl.className = "pill";
    cacheProviderStatsPillEl.textContent = `${selectedProvider.name} · no cache stats yet`;
  } else {
    cacheProviderStatsPillEl.className = "pill";
    cacheProviderStatsPillEl.textContent = "No provider selected";
  }

  cacheProviderTableBodyEl.innerHTML = "";
  if (!allProviderStats.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="8" class="mono">No provider cache stats yet</td>';
    cacheProviderTableBodyEl.appendChild(row);
    return;
  }

  for (const entry of allProviderStats) {
    const row = document.createElement("tr");
    if (entry.key === selectedCacheProviderId) {
      row.className = "provider-row-active";
    }
    row.innerHTML =
      `<td class="mono">${escapeHtml(entry.key || "-")}</td>` +
      `<td>${formatNumber(entry.requests)}</td>` +
      `<td>${formatNumber(entry.hits)}</td>` +
      `<td>${formatNumber(entry.misses)}</td>` +
      `<td>${formatPercent(entry.hitRate)}</td>` +
      `<td>${formatPercent(entry.telemetryCoverage)}</td>` +
      `<td>${formatNumber(entry.totalCachedTokens)}</td>` +
      `<td>${formatPercent(entry.avgCacheSavedPercent)}</td>`;
    row.addEventListener("click", () => {
      selectedCacheProviderId = entry.key || "";
      renderCacheProviderSelect();
      renderCacheProviderStats();
      refreshCacheSnapshot();
    });
    cacheProviderTableBodyEl.appendChild(row);
  }
}

async function refreshCacheSnapshot(providerIdOverride) {
  try {
    if (providerIdOverride === undefined) {
      syncSelectedCacheProvider();
    }
    const effectiveProviderId =
      providerIdOverride === undefined ? selectedCacheProviderId : providerIdOverride;
    const query = effectiveProviderId
      ? `?providerId=${encodeURIComponent(effectiveProviderId)}`
      : "";
    const response = await fetch(`/api/debug/prompt-cache/latest${query}`, { cache: "no-store" });
    const data = await response.json();
    const latest = data.latest;
    if (!effectiveProviderId) {
      latestCacheSnapshot = latest || null;
      renderOverviewStats();
    }
    renderCacheProviderSelect();
    renderCacheProviderStats();
    if (!latest) {
      cachePillEl.className = "pill";
      cachePillEl.textContent = "No requests yet";
      cacheProviderNameEl.textContent = getSelectedCacheProvider()?.name || "-";
      cacheRequestIdEl.textContent = "-";
      cacheModelEl.textContent = "-";
      cacheKeyEl.textContent = "-";
      cacheRetentionEl.textContent = "-";
      cacheTokensEl.textContent = "-";
      cacheSavedPercentEl.textContent = "-";
      cacheHitStreakEl.textContent = "-";
      cacheTargetEl.textContent = "-";
      cacheTruncationEl.textContent = "-";
      cacheReasoningEl.textContent = "-";
      return;
    }
    const provider = providerState.providers.find((item) => item.id === latest.providerId) || null;
    cacheProviderNameEl.textContent =
      `${provider?.name || latest.providerId || "-"} / ${latest.upstreamTarget || "-"}`;
    cacheRequestIdEl.textContent = latest.requestId || "-";
    cacheModelEl.textContent = latest.model || "-";
    cacheKeyEl.textContent = latest.promptCacheKey || "-";
    cacheRetentionEl.textContent = latest.promptCacheRetention || "-";
    cacheTokensEl.textContent = latest.cachedTokens ?? "-";
    cacheSavedPercentEl.textContent =
      latest.cacheSavedPercent === undefined ? "-" : String(latest.cacheSavedPercent) + "%";
    cacheHitStreakEl.textContent = latest.consecutiveCacheHits ?? "-";
    cacheTargetEl.textContent =
      String(latest.upstreamTarget || "-") + " / " + (latest.stream ? "stream" : "json");
    cacheTruncationEl.textContent = latest.truncation || "-";
    cacheReasoningEl.textContent =
      [latest.reasoningEffort, latest.reasoningSummary, latest.textVerbosity].filter(Boolean).join(" / ") || "-";

    if (latest.cacheHit === true) {
      cachePillEl.className = "pill ok-pill";
      cachePillEl.textContent = "Cache hit";
    } else if (latest.cacheHit === false) {
      cachePillEl.className = "pill bad-pill";
      cachePillEl.textContent = "Cache miss";
    } else {
      cachePillEl.className = "pill";
      cachePillEl.textContent = "No usage data yet";
    }
  } catch (error) {
    if (!providerIdOverride) {
      latestCacheSnapshot = null;
      renderOverviewStats();
    }
    renderCacheProviderSelect();
    renderCacheProviderStats();
    cachePillEl.className = "pill bad-pill";
    cachePillEl.textContent = error instanceof Error ? error.message : "Load failed";
  }
}

async function refreshProviders() {
  try {
    const response = await fetch("/api/providers", { cache: "no-store" });
    const data = await response.json();
    const providers = Array.isArray(data.providers) ? data.providers : [];
    const activeProviderId = data.activeProviderId;
    providerState = { activeProviderId, providers };
    renderProviderTable();
    providerMetaEl.textContent = "Endpoint: GET /api/providers";
    renderCacheProviderSelect();
    renderCacheProviderStats();

    if (currentRoute === ROUTES.providerEdit) {
      hydrateProviderEditorFromRoute(normalizeRoute().query);
    }

    renderOverviewStats();
  } catch (error) {
    providerMetaEl.textContent = error instanceof Error ? error.message : "Load failed";
  }
}

async function refreshUsageStats() {
  try {
    const response = await fetch("/api/stats/usage", { cache: "no-store" });
    const data = await response.json();
    usageStatsState = data.stats || null;
  } catch {
    usageStatsState = null;
  }
  renderUsageStats();
  renderCacheProviderStats();
}

async function refreshDashboard() {
  await refreshProviders();
  await refreshCacheSnapshot("");
  await refreshUsageStats();
}

async function refreshActiveRoute() {
  if (currentRoute === ROUTES.dashboard) {
    await refreshDashboard();
    return;
  }
  if (currentRoute === ROUTES.providerEdit) {
    await refreshProviders();
    return;
  }
  if (currentRoute === ROUTES.cache) {
    await refreshProviders();
    await refreshUsageStats();
    await refreshCacheSnapshot(undefined);
  }
}

cacheProviderSelectEl?.addEventListener("change", () => {
  selectedCacheProviderId = cacheProviderSelectEl.value;
  renderCacheProviderSelect();
  renderCacheProviderStats();
  refreshCacheSnapshot(undefined);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const apiKey = document.getElementById("apiKey").value.trim();
  if (!apiKey) return;

  submitBtn.disabled = true;
  submitBtn.textContent = "Checking...";
  statusEl.hidden = false;
  statusEl.className = "status";
  statusEl.textContent = "Checking provider usage...";

  try {
    const response = await fetch("/api/providers/check-usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error?.message || "Request failed");
    const usage = data.usage || {};
    allowedEl.textContent = usage.allowed === undefined ? "unknown" : String(usage.allowed);
    remainingEl.textContent = usage.remaining ?? "unknown";
    usedLimitEl.textContent =
      usage.used !== undefined || usage.limit !== undefined
        ? String(usage.used ?? "?") + " / " + String(usage.limit ?? "?")
        : "unknown";
    rawEl.textContent = JSON.stringify(data.raw, null, 2);
    const ok = Boolean(data.ok);
    statusEl.className = ok ? "status ok" : "status bad";
    statusEl.textContent = ok
      ? "The upstream provider key is still usable."
      : "The upstream provider key is exhausted or not allowed.";
  } catch (error) {
    statusEl.className = "status bad";
    statusEl.textContent = error instanceof Error ? error.message : "Unexpected error";
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Check usage";
  }
});

customProviderBtnEl.addEventListener("click", async () => {
  const editingProviderId = providerEditorIdEl.value.trim();
  const name = customProviderNameEl.value.trim();
  const baseUrl = customProviderBaseUrlEl.value.trim();
  const providerApiKeys = collectProviderApiKeys();
  const clientApiKeys = collectClientApiKeys();
  const capabilities = collectProviderCapabilities();
  if (!name || !baseUrl) return;
  customProviderBtnEl.disabled = true;
  customProviderBtnEl.textContent = "Saving...";
  try {
    const response = await fetch(
      editingProviderId ? "/api/providers/" + encodeURIComponent(editingProviderId) : "/api/providers",
      {
        method: editingProviderId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, baseUrl, providerApiKeys, clientApiKeys, capabilities }),
      },
    );
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error?.message || "Save failed");
    await refreshProviders();
    goToProviderEditor(data.provider?.id || editingProviderId || "");
  } catch (error) {
    providerEditorPillEl.className = "pill bad-pill";
    providerEditorPillEl.textContent = error instanceof Error ? error.message : "Save failed";
  } finally {
    customProviderBtnEl.disabled = false;
    customProviderBtnEl.textContent = providerEditorIdEl.value.trim()
      ? "Update provider"
      : "Save provider";
  }
});

addProviderApiKeyBtnEl.addEventListener("click", () => {
  appendProviderApiKeyInput("");
  syncProviderApiKeyRemoveButtons();
  const inputs = providerApiKeysListEl.querySelectorAll(".provider-api-key-input");
  const lastInput = inputs[inputs.length - 1];
  lastInput?.focus();
});

addClientApiKeyBtnEl.addEventListener("click", () => {
  appendClientApiKeyInput("");
  syncClientApiKeyRemoveButtons();
  const inputs = clientApiKeysListEl.querySelectorAll(".client-api-key-input");
  const lastInput = inputs[inputs.length - 1];
  lastInput?.focus();
});

providerDeleteBtnEl.addEventListener("click", async () => {
  const providerId = providerEditorIdEl.value.trim();
  if (!providerId) return;
  providerDeleteBtnEl.disabled = true;
  providerDeleteBtnEl.textContent = "Deleting...";
  try {
    const response = await fetch("/api/providers/" + encodeURIComponent(providerId), {
      method: "DELETE",
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error?.message || "Delete failed");
    setProviderEditor();
    await refreshProviders();
    window.location.hash = "#/dashboard";
  } catch (error) {
    providerEditorPillEl.className = "pill bad-pill";
    providerEditorPillEl.textContent = error instanceof Error ? error.message : "Delete failed";
  } finally {
    providerDeleteBtnEl.disabled = false;
    providerDeleteBtnEl.textContent = "Delete provider";
  }
});

window.addEventListener("hashchange", () => setRoute(normalizeRoute()));

setProviderEditor();
setRoute(normalizeRoute());
setInterval(() => {
  refreshActiveRoute();
}, 5000);
