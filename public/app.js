const ROUTES = {
  dashboard: "dashboard",
  providerEdit: "provider-edit",
  krouter: "krouter",
  cache: "cache",
};

const routeLinks = [...document.querySelectorAll("[data-route-link]")];
const screens = {
  [ROUTES.dashboard]: document.getElementById("screen-dashboard"),
  [ROUTES.providerEdit]: document.getElementById("screen-provider-edit"),
  [ROUTES.krouter]: document.getElementById("screen-krouter"),
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
const statsTodayCachedTokensEl = document.getElementById("statsTodayCachedTokens");
const statsTodayInputTokensEl = document.getElementById("statsTodayInputTokens");
const statsTodayAvgSavedEl = document.getElementById("statsTodayAvgSaved");
const statsMonthRequestsEl = document.getElementById("statsMonthRequests");
const statsMonthHitsEl = document.getElementById("statsMonthHits");
const statsMonthHitRateEl = document.getElementById("statsMonthHitRate");
const statsMonthCachedTokensEl = document.getElementById("statsMonthCachedTokens");
const statsMonthInputTokensEl = document.getElementById("statsMonthInputTokens");
const statsMonthAvgSavedEl = document.getElementById("statsMonthAvgSaved");
const dailyStatsTableBodyEl = document.getElementById("dailyStatsTableBody");

const providerEditorPillEl = document.getElementById("providerEditorPill");
const providerEditorMetaEl = document.getElementById("providerEditorMeta");
const providerEditorIdEl = document.getElementById("providerEditorId");
const customProviderNameEl = document.getElementById("customProviderName");
const customProviderBaseUrlEl = document.getElementById("customProviderBaseUrl");
const providerApiKeysListEl = document.getElementById("providerApiKeysList");
const providerApiKeyTemplateEl = document.getElementById("providerApiKeyTemplate");
const addProviderApiKeyBtnEl = document.getElementById("addProviderApiKeyBtn");
const customProviderBtnEl = document.getElementById("customProviderBtn");
const providerDeleteBtnEl = document.getElementById("providerDeleteBtn");

let providerState = { activeProviderId: "", providers: [] };
let latestCacheSnapshot = null;
let usageStatsState = null;
let currentRoute = "";

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
    providerApiKeysListEl.contains(active)
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
  providerEditorIdEl.value = provider?.id || "";
  customProviderNameEl.value = provider?.name || "";
  customProviderBaseUrlEl.value = provider?.baseUrl || "";
  renderProviderApiKeyInputs(Array.isArray(provider?.apiKeys) ? provider.apiKeys : [""]);
  customProviderBtnEl.textContent = provider ? "Update provider" : "Save provider";
  providerDeleteBtnEl.disabled = !provider;
  providerEditorPillEl.className = provider ? "pill ok-pill" : "pill";
  providerEditorPillEl.textContent = provider ? `Editing: ${provider.name}` : "Create mode";
  providerEditorMetaEl.textContent = provider
    ? `Editing provider ${provider.id}`
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

function collectProviderApiKeys() {
  return [...providerApiKeysListEl.querySelectorAll(".provider-api-key-input")]
    .map((input) => input.value.trim())
    .filter(Boolean);
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
    emptyRow.innerHTML = '<td colspan="5" class="mono">No providers</td>';
    providerTableBodyEl.appendChild(emptyRow);
    return;
  }

  for (const provider of providers) {
    const row = document.createElement("tr");
    row.className = "provider-row";
    row.innerHTML =
      '<td>' +
      escapeHtml(provider.name) +
      "</td>" +
      '<td class="mono">' + escapeHtml(provider.id) + "</td>" +
      '<td class="mono">' + escapeHtml(provider.baseUrl) + "</td>" +
      `<td>${provider.apiKeysCount ? `${provider.apiKeysCount} key${provider.apiKeysCount === 1 ? "" : "s"}` : "Not set"}</td>` +
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

  statsTodayRequestsEl.textContent = formatNumber(today?.requests);
  statsTodayHitsEl.textContent = formatNumber(today?.hits);
  statsTodayHitRateEl.textContent = formatPercent(today?.hitRate);
  statsTodayCachedTokensEl.textContent = formatNumber(today?.totalCachedTokens);
  statsTodayInputTokensEl.textContent = formatNumber(today?.totalInputTokens);
  statsTodayAvgSavedEl.textContent = formatPercent(today?.avgCacheSavedPercent);

  statsMonthRequestsEl.textContent = formatNumber(month?.requests);
  statsMonthHitsEl.textContent = formatNumber(month?.hits);
  statsMonthHitRateEl.textContent = formatPercent(month?.hitRate);
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
}

async function refreshCacheSnapshot() {
  try {
    const response = await fetch("/api/debug/prompt-cache/latest", { cache: "no-store" });
    const data = await response.json();
    const latest = data.latest;
    latestCacheSnapshot = latest || null;
    renderOverviewStats();
    if (!latest) {
      cachePillEl.className = "pill";
      cachePillEl.textContent = "No requests yet";
      return;
    }
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
    latestCacheSnapshot = null;
    renderOverviewStats();
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
}

async function refreshDashboard() {
  await refreshProviders();
  await refreshCacheSnapshot();
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
    await refreshCacheSnapshot();
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const apiKey = document.getElementById("apiKey").value.trim();
  if (!apiKey) return;

  submitBtn.disabled = true;
  submitBtn.textContent = "Checking...";
  statusEl.hidden = false;
  statusEl.className = "status";
  statusEl.textContent = "Calling KRouter...";

  try {
    const response = await fetch("/api/krouter/check-token", {
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
      ? "The token is still usable."
      : "The token is exhausted or not allowed.";
  } catch (error) {
    statusEl.className = "status bad";
    statusEl.textContent = error instanceof Error ? error.message : "Unexpected error";
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Check token";
  }
});

customProviderBtnEl.addEventListener("click", async () => {
  const editingProviderId = providerEditorIdEl.value.trim();
  const name = customProviderNameEl.value.trim();
  const baseUrl = customProviderBaseUrlEl.value.trim();
  const apiKeys = collectProviderApiKeys();
  if (!name || !baseUrl) return;
  customProviderBtnEl.disabled = true;
  customProviderBtnEl.textContent = "Saving...";
  try {
    const response = await fetch(
      editingProviderId ? "/api/providers/" + encodeURIComponent(editingProviderId) : "/api/providers",
      {
        method: editingProviderId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, baseUrl, apiKeys }),
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
