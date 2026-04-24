const ROUTES = {
  dashboard: "dashboard",
  providers: "providers",
  rtk: "rtk",
  providerEdit: "provider-edit",
  usage: "usage",
  cache: "cache",
};

const routeLinks = [...document.querySelectorAll("[data-route-link]")];
const screens = {
  [ROUTES.dashboard]: document.getElementById("screen-dashboard"),
  [ROUTES.providers]: document.getElementById("screen-providers"),
  [ROUTES.rtk]: document.getElementById("screen-rtk"),
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
const providerListEl = document.getElementById("providerList");
const providerMetaEl = document.getElementById("providerMeta");
const providerSearchInputEl = document.getElementById("providerSearchInput");
const providerCrudTotalEl = document.getElementById("providerCrudTotal");
const providerCrudWithProviderKeysEl = document.getElementById("providerCrudWithProviderKeys");
const providerCrudWithClientKeysEl = document.getElementById("providerCrudWithClientKeys");
const providerCrudUsageCheckEl = document.getElementById("providerCrudUsageCheck");
const providerCrudRtkCustomEl = document.getElementById("providerCrudRtkCustom");
const providerCrudRequestPolicyEl = document.getElementById("providerCrudRequestPolicy");

const statProvidersEl = document.getElementById("statProviders");
const statCurrentModelEl = document.getElementById("statCurrentModel");
const statCacheStatusEl = document.getElementById("statCacheStatus");
const statCachedTokensEl = document.getElementById("statCachedTokens");
const statCacheSavedEl = document.getElementById("statCacheSaved");
const statRtkSavedEl = document.getElementById("statRtkSaved");
const statLastRequestIdEl = document.getElementById("statLastRequestId");
const docsBaseUrlEl = document.getElementById("docsBaseUrl");
const docsResponsesUrlEl = document.getElementById("docsResponsesUrl");
const docsCurlSnippetEl = document.getElementById("docsCurlSnippet");
const statsTodayRequestsEl = document.getElementById("statsTodayRequests");
const statsTodayHitRateEl = document.getElementById("statsTodayHitRate");
const statsTodayTelemetryEl = document.getElementById("statsTodayTelemetry");
const statsTodayCachedTokensEl = document.getElementById("statsTodayCachedTokens");
const statsTodayAvgSavedEl = document.getElementById("statsTodayAvgSaved");
const statsMonthRequestsEl = document.getElementById("statsMonthRequests");
const statsMonthHitRateEl = document.getElementById("statsMonthHitRate");
const statsMonthTelemetryEl = document.getElementById("statsMonthTelemetry");
const statsMonthCachedTokensEl = document.getElementById("statsMonthCachedTokens");
const statsMonthAvgSavedEl = document.getElementById("statsMonthAvgSaved");
const statsRtkTodayRequestsEl = document.getElementById("statsRtkTodayRequests");
const statsRtkTodayAppliedRateEl = document.getElementById("statsRtkTodayAppliedRate");
const statsRtkTodayCharsSavedEl = document.getElementById("statsRtkTodayCharsSaved");
const statsRtkTodayAvgSavedEl = document.getElementById("statsRtkTodayAvgSaved");
const statsRtkMonthRequestsEl = document.getElementById("statsRtkMonthRequests");
const statsRtkMonthAppliedRateEl = document.getElementById("statsRtkMonthAppliedRate");
const statsRtkMonthCharsSavedEl = document.getElementById("statsRtkMonthCharsSaved");
const statsRtkMonthAvgSavedEl = document.getElementById("statsRtkMonthAvgSaved");
const dailyStatsTableBodyEl = document.getElementById("dailyStatsTableBody");
const providerCacheStatsTableBodyEl = document.getElementById("providerCacheStatsTableBody");
const providerRtkStatsTableBodyEl = document.getElementById("providerRtkStatsTableBody");
const clientRouteTableBodyEl = document.getElementById("clientRouteTableBody");
const clientRouteRtkStatsTableBodyEl = document.getElementById("clientRouteRtkStatsTableBody");
const rtkClientRouteSelectEl = document.getElementById("rtkClientRouteSelect");
const rtkClientEnabledEl = document.getElementById("rtkClientEnabled");
const rtkClientToolOutputEnabledEl = document.getElementById("rtkClientToolOutputEnabled");
const rtkClientMaxCharsEl = document.getElementById("rtkClientMaxChars");
const rtkClientMaxLinesEl = document.getElementById("rtkClientMaxLines");
const rtkClientTailLinesEl = document.getElementById("rtkClientTailLines");
const rtkClientTailCharsEl = document.getElementById("rtkClientTailChars");
const rtkClientDetectFormatEl = document.getElementById("rtkClientDetectFormat");
const saveClientRtkPolicyBtnEl = document.getElementById("saveClientRtkPolicyBtn");
const clearClientRtkPolicyBtnEl = document.getElementById("clearClientRtkPolicyBtn");

const providerEditorPillEl = document.getElementById("providerEditorPill");
const providerEditorStatusEl = document.getElementById("providerEditorStatus");
const providerEditorTitleEl = document.getElementById("providerEditorTitle");
const providerEditorSubtitleEl = document.getElementById("providerEditorSubtitle");
const providerEditorMetaEl = document.getElementById("providerEditorMeta");
const providerEditorIdEl = document.getElementById("providerEditorId");
const providerEditorTabEls = [...document.querySelectorAll("[data-provider-tab]")];
const providerEditorPanelEls = [...document.querySelectorAll("[data-provider-panel]")];
const providerSummaryIdEl = document.getElementById("providerSummaryId");
const providerSummaryBaseUrlEl = document.getElementById("providerSummaryBaseUrl");
const providerSummaryProviderKeysEl = document.getElementById("providerSummaryProviderKeys");
const providerSummaryClientKeysEl = document.getElementById("providerSummaryClientKeys");
const providerSummaryRequestPolicyEl = document.getElementById("providerSummaryRequestPolicy");
const providerSummaryRtkPolicyEl = document.getElementById("providerSummaryRtkPolicy");
const providerSummaryErrorPolicyEl = document.getElementById("providerSummaryErrorPolicy");
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
const providerMaxOutputTokensModeEl = document.getElementById("providerMaxOutputTokensMode");
const providerMaxOutputTokensTargetEl = document.getElementById("providerMaxOutputTokensTarget");
const providerSanitizeReasoningSummaryEl = document.getElementById("providerSanitizeReasoningSummary");
const providerStripModelPrefixesEl = document.getElementById("providerStripModelPrefixes");
const providerRtkEnabledEl = document.getElementById("providerRtkEnabled");
const providerRtkToolOutputEnabledEl = document.getElementById("providerRtkToolOutputEnabled");
const providerRtkMaxCharsEl = document.getElementById("providerRtkMaxChars");
const providerRtkMaxLinesEl = document.getElementById("providerRtkMaxLines");
const providerRtkTailLinesEl = document.getElementById("providerRtkTailLines");
const providerRtkTailCharsEl = document.getElementById("providerRtkTailChars");
const providerRtkDetectFormatEl = document.getElementById("providerRtkDetectFormat");
const providerErrorRulesListEl = document.getElementById("providerErrorRulesList");
const providerErrorRuleTemplateEl = document.getElementById("providerErrorRuleTemplate");
const addProviderErrorRuleBtnEl = document.getElementById("addProviderErrorRuleBtn");
const customProviderBtnEl = document.getElementById("customProviderBtn");
const providerDeleteBtnEl = document.getElementById("providerDeleteBtn");

let providerState = { activeProviderId: "", providers: [], clientRoutes: [] };
let latestCacheSnapshot = null;
let usageStatsState = null;
let currentRoute = "";
let selectedCacheProviderId = "";
let providerSearchTerm = "";
let activeProviderEditorTab = "basics";
const TRI_STATE_INHERIT = "inherit";

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
    active === providerMaxOutputTokensModeEl ||
    active === providerMaxOutputTokensTargetEl ||
    active === providerSanitizeReasoningSummaryEl ||
    active === providerStripModelPrefixesEl ||
    active === providerRtkEnabledEl ||
    active === providerRtkToolOutputEnabledEl ||
    active === providerRtkMaxCharsEl ||
    active === providerRtkMaxLinesEl ||
    active === providerRtkTailLinesEl ||
    active === providerRtkTailCharsEl ||
    active === providerRtkDetectFormatEl ||
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

function formatRtkPolicySummary(policy) {
  if (!policy) return "Inherit";
  const parts = [];
  if (typeof policy.enabled === "boolean") {
    parts.push(policy.enabled ? "enabled" : "disabled");
  }
  if (typeof policy.toolOutputEnabled === "boolean") {
    parts.push(policy.toolOutputEnabled ? "tool-output:on" : "tool-output:off");
  }
  if (typeof policy.maxChars === "number") {
    parts.push(`chars:${policy.maxChars}`);
  }
  if (typeof policy.maxLines === "number") {
    parts.push(`lines:${policy.maxLines}`);
  }
  if (typeof policy.tailLines === "number") {
    parts.push(`tail:${policy.tailLines}`);
  }
  if (typeof policy.tailChars === "number") {
    parts.push(`tailChars:${policy.tailChars}`);
  }
  if (typeof policy.detectFormat === "string") {
    parts.push(`format:${policy.detectFormat}`);
  }
  return parts.length ? parts.join(" | ") : "Inherit";
}

function formatErrorPolicySummary(policy) {
  const rules = Array.isArray(policy?.rules) ? policy.rules : [];
  if (!rules.length) return "None";
  const first = rules[0] || {};
  const matcher =
    (Array.isArray(first.statusCodes) && first.statusCodes.length
      ? `status:${first.statusCodes.join("/")}`
      : "") ||
    (Array.isArray(first.upstreamCodes) && first.upstreamCodes.length
      ? `code:${first.upstreamCodes.join("/")}`
      : "") ||
    (Array.isArray(first.upstreamTypes) && first.upstreamTypes.length
      ? `type:${first.upstreamTypes.join("/")}`
      : "") ||
    (Array.isArray(first.messageIncludes) && first.messageIncludes.length
      ? `msg:${first.messageIncludes[0]}`
      : "") ||
    (Array.isArray(first.bodyIncludes) && first.bodyIncludes.length
      ? `body:${first.bodyIncludes[0]}`
      : "custom");
  const mapping = first.code || first.message || "rewrite";
  return rules.length === 1 ? `${matcher} -> ${mapping}` : `${rules.length} rules · ${matcher} -> ${mapping}`;
}

function parsePositiveIntegerInput(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeIntegerInput(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseCsvList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseIntegerCsvList(value) {
  return parseCsvList(value)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item));
}

function setTriStateBooleanSelectValue(element, value) {
  if (!element) return;
  element.value = typeof value === "boolean" ? String(value) : TRI_STATE_INHERIT;
}

function readTriStateBooleanSelectValue(element) {
  if (!element) return undefined;
  if (element.value === TRI_STATE_INHERIT) return undefined;
  return element.value === "true";
}

function readDetectFormatValue(element) {
  if (!element) return undefined;
  return element.value && element.value !== TRI_STATE_INHERIT ? element.value : undefined;
}

function setDetectFormatValue(element, value) {
  if (!element) return;
  element.value = typeof value === "string" ? value : TRI_STATE_INHERIT;
}

function collectClientRouteRtkPolicy() {
  const policy = {
    ...(readTriStateBooleanSelectValue(rtkClientEnabledEl) !== undefined
      ? { enabled: readTriStateBooleanSelectValue(rtkClientEnabledEl) }
      : {}),
    ...(readTriStateBooleanSelectValue(rtkClientToolOutputEnabledEl) !== undefined
      ? { toolOutputEnabled: readTriStateBooleanSelectValue(rtkClientToolOutputEnabledEl) }
      : {}),
    ...(parsePositiveIntegerInput(rtkClientMaxCharsEl.value)
      ? { maxChars: parsePositiveIntegerInput(rtkClientMaxCharsEl.value) }
      : {}),
    ...(parsePositiveIntegerInput(rtkClientMaxLinesEl.value)
      ? { maxLines: parsePositiveIntegerInput(rtkClientMaxLinesEl.value) }
      : {}),
    ...(parseNonNegativeIntegerInput(rtkClientTailLinesEl.value) !== undefined
      ? { tailLines: parseNonNegativeIntegerInput(rtkClientTailLinesEl.value) }
      : {}),
    ...(parseNonNegativeIntegerInput(rtkClientTailCharsEl.value) !== undefined
      ? { tailChars: parseNonNegativeIntegerInput(rtkClientTailCharsEl.value) }
      : {}),
    ...(readDetectFormatValue(rtkClientDetectFormatEl)
      ? { detectFormat: readDetectFormatValue(rtkClientDetectFormatEl) }
      : {}),
  };
  return policy;
}

function setProviderEditorStatus(message = "", tone = "") {
  if (!providerEditorStatusEl) return;
  if (!message) {
    providerEditorStatusEl.hidden = true;
    providerEditorStatusEl.className = "status";
    providerEditorStatusEl.textContent = "";
    return;
  }
  providerEditorStatusEl.hidden = false;
  providerEditorStatusEl.className = tone ? `status ${tone}` : "status";
  providerEditorStatusEl.textContent = message;
}

function setProviderEditorTab(tabKey) {
  const nextTab = providerEditorTabEls.some((element) => element.dataset.providerTab === tabKey)
    ? tabKey
    : "basics";
  activeProviderEditorTab = nextTab;
  for (const element of providerEditorTabEls) {
    const active = element.dataset.providerTab === nextTab;
    element.classList.toggle("active", active);
    element.setAttribute("aria-selected", active ? "true" : "false");
  }
  for (const element of providerEditorPanelEls) {
    element.classList.toggle("active", element.dataset.providerPanel === nextTab);
  }
}

function renderProviderEditorSummary() {
  if (!providerSummaryIdEl) {
    return;
  }
  const providerId = providerEditorIdEl.value.trim() || "Generated on save";
  const baseUrl = customProviderBaseUrlEl.value.trim() || "Not set";
  const providerKeys = collectProviderApiKeys().length;
  const clientKeys = collectClientApiKeys().length;
  const capabilities = collectProviderCapabilities();
  const maxOutputTokens = capabilities.requestParameterPolicy?.maxOutputTokens;
  const requestPolicySummary =
    maxOutputTokens?.mode && maxOutputTokens.mode !== "forward"
      ? maxOutputTokens.mode === "rename" && maxOutputTokens.target
        ? `max-output: rename -> ${maxOutputTokens.target}`
        : `max-output: ${maxOutputTokens.mode}`
      : capabilities.stripModelPrefixes?.length
        ? `strip prefixes: ${capabilities.stripModelPrefixes.join(", ")}`
        : "Default";

  providerSummaryIdEl.textContent = providerId;
  providerSummaryBaseUrlEl.textContent = baseUrl;
  providerSummaryProviderKeysEl.textContent = String(providerKeys);
  providerSummaryClientKeysEl.textContent = String(clientKeys);
  providerSummaryRequestPolicyEl.textContent = requestPolicySummary;
  providerSummaryRtkPolicyEl.textContent = formatRtkPolicySummary(capabilities.rtkPolicy);
  providerSummaryErrorPolicyEl.textContent = formatErrorPolicySummary(capabilities.errorPolicy);
}

function setProviderEditor(provider) {
  const capabilities = provider?.capabilities || {};
  const maxOutputTokensPolicy = capabilities.requestParameterPolicy?.maxOutputTokens || null;
  const maxOutputTokensMode = maxOutputTokensPolicy?.mode || (capabilities.stripMaxOutputTokens ? "strip" : "forward");
  const rtkPolicy = capabilities.rtkPolicy || null;
  const errorPolicy = capabilities.errorPolicy || null;
  providerEditorIdEl.value = provider?.id || "";
  customProviderNameEl.value = provider?.name || "";
  customProviderBaseUrlEl.value = provider?.baseUrl || "";
  providerOwnedByEl.value = capabilities.ownedBy || "";
  providerUsageCheckUrlEl.value = capabilities.usageCheckUrl || "";
  providerUsageCheckEnabledEl.checked = capabilities.usageCheckEnabled === true;
  providerMaxOutputTokensModeEl.value = maxOutputTokensMode;
  providerMaxOutputTokensTargetEl.value = maxOutputTokensPolicy?.target || "";
  providerSanitizeReasoningSummaryEl.checked =
    capabilities.sanitizeReasoningSummary === true;
  providerStripModelPrefixesEl.value = Array.isArray(capabilities.stripModelPrefixes)
    ? capabilities.stripModelPrefixes.join(", ")
    : "";
  setTriStateBooleanSelectValue(providerRtkEnabledEl, rtkPolicy?.enabled);
  setTriStateBooleanSelectValue(providerRtkToolOutputEnabledEl, rtkPolicy?.toolOutputEnabled);
  providerRtkMaxCharsEl.value =
    typeof rtkPolicy?.maxChars === "number" ? String(rtkPolicy.maxChars) : "";
  providerRtkMaxLinesEl.value =
    typeof rtkPolicy?.maxLines === "number" ? String(rtkPolicy.maxLines) : "";
  providerRtkTailLinesEl.value =
    typeof rtkPolicy?.tailLines === "number" ? String(rtkPolicy.tailLines) : "";
  providerRtkTailCharsEl.value =
    typeof rtkPolicy?.tailChars === "number" ? String(rtkPolicy.tailChars) : "";
  setDetectFormatValue(providerRtkDetectFormatEl, rtkPolicy?.detectFormat);
  renderProviderErrorRuleInputs(Array.isArray(errorPolicy?.rules) ? errorPolicy.rules : []);
  renderProviderApiKeyInputs(
    Array.isArray(provider?.providerApiKeys) ? provider.providerApiKeys : [""],
  );
  renderClientApiKeyInputs(
    Array.isArray(provider?.clientApiKeys) ? provider.clientApiKeys : [""],
  );
  customProviderBtnEl.textContent = provider ? "Update provider" : "Save provider";
  providerDeleteBtnEl.hidden = !provider;
  providerDeleteBtnEl.disabled = !provider;
  providerEditorPillEl.className = provider ? "pill ok-pill" : "pill";
  providerEditorPillEl.textContent = provider ? "Edit mode" : "Create mode";
  providerEditorTitleEl.textContent = provider ? `Edit ${provider.name}` : "New Provider";
  providerEditorSubtitleEl.textContent = provider
    ? "Update one provider record. Routing overview and inventory stay in the Providers page."
    : "Create one provider record. Use the Providers page for inventory, filtering, and bulk management.";
  setProviderEditorStatus("");
  providerEditorMetaEl.textContent = provider
    ? `Editing provider ${provider.id}. Save to apply changes.`
    : "A provider ID will be generated when you save this record.";
  setProviderEditorTab(activeProviderEditorTab);
  renderProviderEditorSummary();
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
    renderProviderEditorSummary();
  });
  input.addEventListener("input", () => renderProviderEditorSummary());
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
    renderProviderEditorSummary();
  });
  input.addEventListener("input", () => renderProviderEditorSummary());
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

function renderProviderErrorRuleInputs(rules) {
  providerErrorRulesListEl.innerHTML = "";
  const items = Array.isArray(rules) && rules.length ? rules : [];
  for (const rule of items) {
    appendProviderErrorRuleInput(rule);
  }
  syncProviderErrorRuleRemoveButtons();
}

function appendProviderErrorRuleInput(rule = {}) {
  const fragment = providerErrorRuleTemplateEl.content.cloneNode(true);
  const card = fragment.querySelector(".error-rule-card");
  const titleEl = fragment.querySelector(".error-rule-title");
  const statusCodesEl = fragment.querySelector(".provider-error-status-codes");
  const upstreamCodesEl = fragment.querySelector(".provider-error-upstream-codes");
  const upstreamTypesEl = fragment.querySelector(".provider-error-upstream-types");
  const messageIncludesEl = fragment.querySelector(".provider-error-message-includes");
  const bodyIncludesEl = fragment.querySelector(".provider-error-body-includes");
  const codeEl = fragment.querySelector(".provider-error-code");
  const retryableEl = fragment.querySelector(".provider-error-retryable");
  const messageEl = fragment.querySelector(".provider-error-message");
  const removeBtn = fragment.querySelector(".provider-error-rule-remove");
  const previewMatchEl = fragment.querySelector(".error-rule-preview-match");
  const previewRewriteEl = fragment.querySelector(".error-rule-preview-rewrite");

  statusCodesEl.value = Array.isArray(rule.statusCodes) ? rule.statusCodes.join(", ") : "";
  upstreamCodesEl.value = Array.isArray(rule.upstreamCodes) ? rule.upstreamCodes.join(", ") : "";
  upstreamTypesEl.value = Array.isArray(rule.upstreamTypes) ? rule.upstreamTypes.join(", ") : "";
  messageIncludesEl.value = Array.isArray(rule.messageIncludes) ? rule.messageIncludes.join(", ") : "";
  bodyIncludesEl.value = Array.isArray(rule.bodyIncludes) ? rule.bodyIncludes.join(", ") : "";
  codeEl.value = rule.code || "";
  retryableEl.value = typeof rule.retryable === "boolean" ? String(rule.retryable) : TRI_STATE_INHERIT;
  messageEl.value = rule.message || "";

  const refreshTitle = () => {
    const index = [...providerErrorRulesListEl.querySelectorAll(".error-rule-card")].indexOf(card) + 1;
    const matchLabel =
      statusCodesEl.value.trim() ||
      upstreamCodesEl.value.trim() ||
      upstreamTypesEl.value.trim() ||
      messageIncludesEl.value.trim() ||
      bodyIncludesEl.value.trim() ||
      "custom match";
    titleEl.textContent = `Rule ${index || 1} · ${matchLabel}`;
  };

  const refreshPreview = () => {
    const statusCodes = parseIntegerCsvList(statusCodesEl.value);
    const upstreamCodes = parseCsvList(upstreamCodesEl.value);
    const upstreamTypes = parseCsvList(upstreamTypesEl.value);
    const messageIncludes = parseCsvList(messageIncludesEl.value);
    const bodyIncludes = parseCsvList(bodyIncludesEl.value);
    const code = codeEl.value.trim();
    const message = messageEl.value.trim();
    const retryable =
      retryableEl.value === "true" ? "retryable" : retryableEl.value === "false" ? "not retryable" : "";

    const matchParts = [
      statusCodes.length ? `status in [${statusCodes.join(", ")}]` : "",
      upstreamCodes.length ? `upstream code in [${upstreamCodes.join(", ")}]` : "",
      upstreamTypes.length ? `upstream type in [${upstreamTypes.join(", ")}]` : "",
      messageIncludes.length ? `message contains [${messageIncludes.join(", ")}]` : "",
      bodyIncludes.length ? `body contains [${bodyIncludes.join(", ")}]` : "",
    ].filter(Boolean);

    const rewriteParts = [
      code ? `code -> ${code}` : "",
      message ? `message -> ${message}` : "",
      retryable ? `retry -> ${retryable}` : "",
    ].filter(Boolean);

    previewMatchEl.textContent = matchParts.length ? matchParts.join(" · ") : "No match condition yet";
    previewRewriteEl.textContent = rewriteParts.length ? rewriteParts.join(" · ") : "Keep default proxy error";
  };

  removeBtn.addEventListener("click", () => {
    card.remove();
    syncProviderErrorRuleRemoveButtons();
    syncProviderErrorRuleTitles();
    renderProviderEditorSummary();
  });

  [
    statusCodesEl,
    upstreamCodesEl,
    upstreamTypesEl,
    messageIncludesEl,
    bodyIncludesEl,
    codeEl,
    retryableEl,
    messageEl,
  ].forEach((element) => {
    element?.addEventListener("input", () => {
      refreshTitle();
      refreshPreview();
      renderProviderEditorSummary();
    });
    element?.addEventListener("change", () => {
      refreshTitle();
      refreshPreview();
      renderProviderEditorSummary();
    });
  });

  providerErrorRulesListEl.appendChild(fragment);
  refreshTitle();
  refreshPreview();
}

function syncProviderErrorRuleTitles() {
  const cards = [...providerErrorRulesListEl.querySelectorAll(".error-rule-card")];
  cards.forEach((card, index) => {
    const titleEl = card.querySelector(".error-rule-title");
    const statusCodesEl = card.querySelector(".provider-error-status-codes");
    const upstreamCodesEl = card.querySelector(".provider-error-upstream-codes");
    const upstreamTypesEl = card.querySelector(".provider-error-upstream-types");
    const messageIncludesEl = card.querySelector(".provider-error-message-includes");
    const bodyIncludesEl = card.querySelector(".provider-error-body-includes");
    const matchLabel =
      statusCodesEl?.value.trim() ||
      upstreamCodesEl?.value.trim() ||
      upstreamTypesEl?.value.trim() ||
      messageIncludesEl?.value.trim() ||
      bodyIncludesEl?.value.trim() ||
      "custom match";
    if (titleEl) {
      titleEl.textContent = `Rule ${index + 1} · ${matchLabel}`;
    }
  });
}

function syncProviderErrorRuleRemoveButtons() {
  const rows = [...providerErrorRulesListEl.querySelectorAll(".error-rule-card")];
  for (const row of rows) {
    const removeBtn = row.querySelector(".provider-error-rule-remove");
    removeBtn.disabled = rows.length === 1;
  }
}

function collectProviderErrorPolicy() {
  const rules = [...providerErrorRulesListEl.querySelectorAll(".error-rule-card")]
    .map((card) => {
      const statusCodes = parseIntegerCsvList(
        card.querySelector(".provider-error-status-codes")?.value || "",
      );
      const upstreamCodes = parseCsvList(
        card.querySelector(".provider-error-upstream-codes")?.value || "",
      );
      const upstreamTypes = parseCsvList(
        card.querySelector(".provider-error-upstream-types")?.value || "",
      );
      const messageIncludes = parseCsvList(
        card.querySelector(".provider-error-message-includes")?.value || "",
      );
      const bodyIncludes = parseCsvList(
        card.querySelector(".provider-error-body-includes")?.value || "",
      );
      const code = card.querySelector(".provider-error-code")?.value.trim() || "";
      const message = card.querySelector(".provider-error-message")?.value.trim() || "";
      const retryableValue = card.querySelector(".provider-error-retryable")?.value;
      const retryable =
        retryableValue === "true" ? true : retryableValue === "false" ? false : undefined;

      if (
        !statusCodes.length &&
        !upstreamCodes.length &&
        !upstreamTypes.length &&
        !messageIncludes.length &&
        !bodyIncludes.length
      ) {
        return null;
      }

      return {
        ...(statusCodes.length ? { statusCodes } : {}),
        ...(upstreamCodes.length ? { upstreamCodes } : {}),
        ...(upstreamTypes.length ? { upstreamTypes } : {}),
        ...(messageIncludes.length ? { messageIncludes } : {}),
        ...(bodyIncludes.length ? { bodyIncludes } : {}),
        ...(code ? { code } : {}),
        ...(message ? { message } : {}),
        ...(typeof retryable === "boolean" ? { retryable } : {}),
      };
    })
    .filter(Boolean);

  return rules.length ? { rules } : undefined;
}

function collectClientApiKeys() {
  return [...clientApiKeysListEl.querySelectorAll(".client-api-key-input")]
    .map((input) => input.value.trim())
    .filter(Boolean);
}

function collectProviderCapabilities() {
  const maxOutputTokensMode = providerMaxOutputTokensModeEl.value || "forward";
  const maxOutputTokensTarget = providerMaxOutputTokensTargetEl.value.trim();
  const providerRtkPolicy = {
    ...(readTriStateBooleanSelectValue(providerRtkEnabledEl) !== undefined
      ? { enabled: readTriStateBooleanSelectValue(providerRtkEnabledEl) }
      : {}),
    ...(readTriStateBooleanSelectValue(providerRtkToolOutputEnabledEl) !== undefined
      ? { toolOutputEnabled: readTriStateBooleanSelectValue(providerRtkToolOutputEnabledEl) }
      : {}),
    ...(parsePositiveIntegerInput(providerRtkMaxCharsEl.value)
      ? { maxChars: parsePositiveIntegerInput(providerRtkMaxCharsEl.value) }
      : {}),
    ...(parsePositiveIntegerInput(providerRtkMaxLinesEl.value)
      ? { maxLines: parsePositiveIntegerInput(providerRtkMaxLinesEl.value) }
      : {}),
    ...(parseNonNegativeIntegerInput(providerRtkTailLinesEl.value) !== undefined
      ? { tailLines: parseNonNegativeIntegerInput(providerRtkTailLinesEl.value) }
      : {}),
    ...(parseNonNegativeIntegerInput(providerRtkTailCharsEl.value) !== undefined
      ? { tailChars: parseNonNegativeIntegerInput(providerRtkTailCharsEl.value) }
      : {}),
    ...(readDetectFormatValue(providerRtkDetectFormatEl)
      ? { detectFormat: readDetectFormatValue(providerRtkDetectFormatEl) }
      : {}),
  };
  return {
    ownedBy: providerOwnedByEl.value.trim(),
    usageCheckEnabled: providerUsageCheckEnabledEl.checked,
    usageCheckUrl: providerUsageCheckUrlEl.value.trim(),
    stripMaxOutputTokens: maxOutputTokensMode === "strip",
    requestParameterPolicy: {
      maxOutputTokens: {
        mode: maxOutputTokensMode,
        ...(maxOutputTokensMode === "rename" && maxOutputTokensTarget
          ? { target: maxOutputTokensTarget }
          : {}),
      },
    },
    sanitizeReasoningSummary: providerSanitizeReasoningSummaryEl.checked,
    stripModelPrefixes: providerStripModelPrefixesEl.value
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    ...(collectProviderErrorPolicy() ? { errorPolicy: collectProviderErrorPolicy() } : {}),
    ...(Object.keys(providerRtkPolicy).length ? { rtkPolicy: providerRtkPolicy } : {}),
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
  if (!providerTableBodyEl) {
    return;
  }
  const providers = providerState.providers;
  providerTableBodyEl.innerHTML = "";
  if (!providers.length) {
    const emptyRow = document.createElement("tr");
    emptyRow.innerHTML = '<td colspan="8" class="mono">No providers</td>';
    providerTableBodyEl.appendChild(emptyRow);
    return;
  }

  for (const provider of providers) {
    const capabilities = provider.capabilities || {};
    const maxOutputTokensPolicy = capabilities.requestParameterPolicy?.maxOutputTokens || null;
    const maxOutputTokensMode = maxOutputTokensPolicy?.mode || (capabilities.stripMaxOutputTokens ? "strip" : "forward");
    const capabilitySummary = [
      capabilities.usageCheckEnabled && capabilities.usageCheckUrl ? "usage-check" : "",
      maxOutputTokensMode !== "forward"
        ? `max-output:${maxOutputTokensMode}${maxOutputTokensMode === "rename" && maxOutputTokensPolicy?.target ? `->${maxOutputTokensPolicy.target}` : ""}`
        : "",
      capabilities.sanitizeReasoningSummary ? "sanitize-reasoning" : "",
      Array.isArray(capabilities.stripModelPrefixes) && capabilities.stripModelPrefixes.length
        ? `prefixes:${capabilities.stripModelPrefixes.join(",")}`
        : "",
    ]
      .filter(Boolean)
      .join(" | ");
    const row = document.createElement("tr");
    row.className = "provider-row";
    row.addEventListener("click", () => {
      goToProviderEditor(provider.id);
    });
    row.innerHTML =
      '<td>' +
      escapeHtml(provider.name) +
      "</td>" +
      '<td class="mono">' + escapeHtml(provider.id) + "</td>" +
      '<td class="mono">' + escapeHtml(provider.baseUrl) + "</td>" +
      '<td class="mono">' + escapeHtml(capabilitySummary || "Default") + "</td>" +
      '<td class="mono">' + escapeHtml(formatRtkPolicySummary(capabilities.rtkPolicy)) + "</td>" +
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

function getProviderCapabilitySummary(provider) {
  const capabilities = provider.capabilities || {};
  const maxOutputTokensPolicy = capabilities.requestParameterPolicy?.maxOutputTokens || null;
  const maxOutputTokensMode =
    maxOutputTokensPolicy?.mode || (capabilities.stripMaxOutputTokens ? "strip" : "forward");
  return [
    capabilities.usageCheckEnabled && capabilities.usageCheckUrl ? "usage-check" : "",
    maxOutputTokensMode !== "forward"
      ? `max-output:${maxOutputTokensMode}${maxOutputTokensMode === "rename" && maxOutputTokensPolicy?.target ? `->${maxOutputTokensPolicy.target}` : ""}`
      : "",
    capabilities.sanitizeReasoningSummary ? "sanitize-reasoning" : "",
    Array.isArray(capabilities.stripModelPrefixes) && capabilities.stripModelPrefixes.length
      ? `prefixes:${capabilities.stripModelPrefixes.join(",")}`
      : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

function providerMatchesSearch(provider, searchTerm) {
  if (!searchTerm) {
    return true;
  }
  const capabilities = provider.capabilities || {};
  const haystack = [
    provider.name,
    provider.id,
    provider.baseUrl,
    capabilities.ownedBy,
    capabilities.usageCheckUrl,
    getProviderCapabilitySummary(provider),
    formatRtkPolicySummary(capabilities.rtkPolicy),
    formatErrorPolicySummary(capabilities.errorPolicy),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(searchTerm);
}

function countRequestPolicyOverrides(provider) {
  const policy = provider.capabilities?.requestParameterPolicy || {};
  const maxOutputTokensMode = policy.maxOutputTokens?.mode || "forward";
  const hasLegacyStrip = provider.capabilities?.stripMaxOutputTokens === true;
  return maxOutputTokensMode !== "forward" || hasLegacyStrip ? 1 : 0;
}

function renderProviderCrudSummary() {
  if (!providerCrudTotalEl) {
    return;
  }
  const providers = providerState.providers;
  providerCrudTotalEl.textContent = String(providers.length);
  providerCrudWithProviderKeysEl.textContent = String(
    providers.filter((provider) => (provider.providerApiKeysCount || 0) > 0).length,
  );
  providerCrudWithClientKeysEl.textContent = String(
    providers.filter((provider) => (provider.clientApiKeysCount || 0) > 0).length,
  );
  providerCrudUsageCheckEl.textContent = String(
    providers.filter((provider) => provider.capabilities?.usageCheckEnabled === true).length,
  );
  providerCrudRtkCustomEl.textContent = String(
    providers.filter((provider) => provider.capabilities?.rtkPolicy).length,
  );
  providerCrudRequestPolicyEl.textContent = String(
    providers.filter((provider) => countRequestPolicyOverrides(provider) > 0).length,
  );
}

function renderProviderCrudList() {
  if (!providerListEl) {
    return;
  }
  const normalizedSearch = providerSearchTerm.trim().toLowerCase();
  const providers = providerState.providers.filter((provider) =>
    providerMatchesSearch(provider, normalizedSearch),
  );
  providerListEl.innerHTML = "";

  if (!providers.length) {
    const empty = document.createElement("section");
    empty.className = "provider-empty-state";
    empty.innerHTML =
      '<img src="/providers-illustration.svg" alt="No providers found" class="provider-empty-illustration" />' +
      `<h3>${normalizedSearch ? "No providers match this filter." : "No providers yet."}</h3>` +
      `<p>${normalizedSearch ? "Try a different name, id, or base URL." : "Create the first provider to start routing traffic through the proxy."}</p>` +
      '<div class="row-wrap"><a class="button-link" href="#/provider-edit">Create provider</a></div>';
    providerListEl.appendChild(empty);
    return;
  }

  for (const provider of providers) {
    const capabilities = provider.capabilities || {};
    const card = document.createElement("article");
    card.className = "provider-crud-card";
    const capabilitySummary = getProviderCapabilitySummary(provider) || "Default compatibility";
    const hasRtkCustom = capabilities.rtkPolicy ? "Custom RTK" : "Inherited RTK";
    const errorPolicyText = capabilities.errorPolicy?.rules?.length
      ? `${capabilities.errorPolicy.rules.length} error rule${capabilities.errorPolicy.rules.length === 1 ? "" : "s"}`
      : "No error policy";
    const usageText =
      capabilities.usageCheckEnabled && capabilities.usageCheckUrl
        ? "Usage check ready"
        : "No usage check";
    card.innerHTML =
      '<div class="provider-crud-header">' +
      '<div class="provider-crud-title">' +
      `<div class="provider-crud-title-row"><h3>${escapeHtml(provider.name)}</h3><span class="pill">${escapeHtml(provider.id)}</span></div>` +
      `<p class="mono">${escapeHtml(provider.baseUrl)}</p>` +
      "</div>" +
      '<div class="provider-crud-actions">' +
      '<button type="button" class="table-button provider-edit-button">Edit</button>' +
      '<button type="button" class="table-button button-danger-soft provider-delete-button">Delete</button>' +
      "</div>" +
      "</div>" +
      '<div class="provider-crud-badges">' +
      `<span class="provider-badge">${escapeHtml(usageText)}</span>` +
      `<span class="provider-badge">${escapeHtml(hasRtkCustom)}</span>` +
      `<span class="provider-badge">${escapeHtml(errorPolicyText)}</span>` +
      `<span class="provider-badge">${escapeHtml(capabilitySummary)}</span>` +
      "</div>" +
      '<div class="provider-crud-grid">' +
      `<div class="provider-crud-stat"><span>Provider keys</span><strong>${provider.providerApiKeysCount || 0}</strong></div>` +
      `<div class="provider-crud-stat"><span>Client keys</span><strong>${provider.clientApiKeysCount || 0}</strong></div>` +
      `<div class="provider-crud-stat"><span>Request policy</span><strong>${escapeHtml(countRequestPolicyOverrides(provider) ? "Custom" : "Default")}</strong></div>` +
      `<div class="provider-crud-stat"><span>Owner</span><strong>${escapeHtml(capabilities.ownedBy || "-")}</strong></div>` +
      "</div>";

    const editBtn = card.querySelector(".provider-edit-button");
    const deleteBtn = card.querySelector(".provider-delete-button");
    editBtn?.addEventListener("click", () => goToProviderEditor(provider.id));
    deleteBtn?.addEventListener("click", async () => {
      const confirmed = window.confirm(`Delete provider "${provider.name}"?`);
      if (!confirmed) {
        return;
      }
      deleteBtn.disabled = true;
      deleteBtn.textContent = "Deleting...";
      providerMetaEl.textContent = `Deleting provider ${provider.id}...`;
      try {
        const response = await fetch(`/api/providers/${encodeURIComponent(provider.id)}`, {
          method: "DELETE",
        });
        const data = await response.json();
        if (!response.ok || data.error) {
          throw new Error(data.error?.message || "Delete failed");
        }
        await refreshProviders();
        providerMetaEl.textContent = `Deleted provider ${provider.id}`;
      } catch (error) {
        providerMetaEl.textContent =
          error instanceof Error ? error.message : "Could not delete provider";
      } finally {
        deleteBtn.disabled = false;
        deleteBtn.textContent = "Delete";
      }
    });
    providerListEl.appendChild(card);
  }
}

function renderClientRoutePolicySection() {
  const routes = Array.isArray(providerState.clientRoutes) ? providerState.clientRoutes : [];
  if (rtkClientRouteSelectEl) {
    const previous = rtkClientRouteSelectEl.value;
    rtkClientRouteSelectEl.innerHTML = "";
    for (const route of routes) {
      const option = document.createElement("option");
      option.value = route.key;
      option.textContent = route.key;
      rtkClientRouteSelectEl.appendChild(option);
    }
    if (routes.length) {
      rtkClientRouteSelectEl.value =
        routes.some((route) => route.key === previous) ? previous : routes[0].key;
    }
  }

  if (clientRouteTableBodyEl) {
    clientRouteTableBodyEl.innerHTML = "";
    if (!routes.length) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="4" class="mono">No client routes</td>';
      clientRouteTableBodyEl.appendChild(row);
    } else {
      for (const route of routes) {
        const row = document.createElement("tr");
        row.innerHTML =
          `<td class="mono">${escapeHtml(route.key || "-")}</td>` +
          `<td>${escapeHtml(route.providerName || route.providerId || "-")}</td>` +
          `<td class="mono">${escapeHtml(route.modelOverride || "Default")}</td>` +
          `<td class="mono">${escapeHtml(formatRtkPolicySummary(route.rtkPolicy))}</td>`;
        row.addEventListener("click", () => {
          rtkClientRouteSelectEl.value = route.key;
          hydrateClientRouteRtkForm(route.key);
        });
        clientRouteTableBodyEl.appendChild(row);
      }
    }
  }

  hydrateClientRouteRtkForm(rtkClientRouteSelectEl?.value || routes[0]?.key || "");
}

function hydrateClientRouteRtkForm(routeKey) {
  const route = (providerState.clientRoutes || []).find((entry) => entry.key === routeKey);
  const policy = route?.rtkPolicy || null;
  if (!rtkClientEnabledEl) return;
  setTriStateBooleanSelectValue(rtkClientEnabledEl, policy?.enabled);
  setTriStateBooleanSelectValue(rtkClientToolOutputEnabledEl, policy?.toolOutputEnabled);
  rtkClientMaxCharsEl.value =
    typeof policy?.maxChars === "number" ? String(policy.maxChars) : "";
  rtkClientMaxLinesEl.value =
    typeof policy?.maxLines === "number" ? String(policy.maxLines) : "";
  rtkClientTailLinesEl.value =
    typeof policy?.tailLines === "number" ? String(policy.tailLines) : "";
  rtkClientTailCharsEl.value =
    typeof policy?.tailChars === "number" ? String(policy.tailChars) : "";
  setDetectFormatValue(rtkClientDetectFormatEl, policy?.detectFormat);
}

function renderOverviewStats() {
  statProvidersEl.textContent = String(providerState.providers.length || 0);
  statCurrentModelEl.textContent = latestCacheSnapshot?.model || "Client-provided";
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
  statRtkSavedEl.textContent =
    latestCacheSnapshot?.rtkCharsSaved === undefined
      ? "-"
      : formatNumber(latestCacheSnapshot.rtkCharsSaved);
  statLastRequestIdEl.textContent = latestCacheSnapshot?.requestId || "-";
  renderDashboardDocs();
}

function renderDashboardDocs() {
  if (!docsBaseUrlEl || !docsResponsesUrlEl || !docsCurlSnippetEl) {
    return;
  }
  const origin = window.location.origin;
  const responsesUrl = `${origin}/v1/responses`;
  docsBaseUrlEl.textContent = origin;
  docsResponsesUrlEl.textContent = responsesUrl;
  docsCurlSnippetEl.textContent = [
    `curl ${JSON.stringify(responsesUrl)} \\`,
    '  -H "Content-Type: application/json" \\',
    '  -H "Authorization: Bearer <client-api-key>" \\',
    '  --data-raw \'{"model":"gpt-5.4","input":"Hello"}\'',
  ].join("\n");
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
  const byClientRoute = Array.isArray(usageStatsState?.byClientRoute) ? usageStatsState.byClientRoute : [];

  statsTodayRequestsEl.textContent = formatNumber(today?.requests);
  statsTodayHitRateEl.textContent = formatPercent(today?.hitRate);
  statsTodayTelemetryEl.textContent = formatPercent(today?.telemetryCoverage);
  statsTodayCachedTokensEl.textContent = formatNumber(today?.totalCachedTokens);
  statsTodayAvgSavedEl.textContent = formatPercent(today?.avgCacheSavedPercent);

  statsMonthRequestsEl.textContent = formatNumber(month?.requests);
  statsMonthHitRateEl.textContent = formatPercent(month?.hitRate);
  statsMonthTelemetryEl.textContent = formatPercent(month?.telemetryCoverage);
  statsMonthCachedTokensEl.textContent = formatNumber(month?.totalCachedTokens);
  statsMonthAvgSavedEl.textContent = formatPercent(month?.avgCacheSavedPercent);
  statsRtkTodayRequestsEl.textContent = formatNumber(today?.rtkRequests);
  statsRtkTodayAppliedRateEl.textContent = formatPercent(today?.rtkAppliedRate);
  statsRtkTodayCharsSavedEl.textContent = formatNumber(today?.rtkCharsSaved);
  statsRtkTodayAvgSavedEl.textContent = formatNumber(today?.rtkAvgCharsSaved);
  statsRtkMonthRequestsEl.textContent = formatNumber(month?.rtkRequests);
  statsRtkMonthAppliedRateEl.textContent = formatPercent(month?.rtkAppliedRate);
  statsRtkMonthCharsSavedEl.textContent = formatNumber(month?.rtkCharsSaved);
  statsRtkMonthAvgSavedEl.textContent = formatNumber(month?.rtkAvgCharsSaved);

  dailyStatsTableBodyEl.innerHTML = "";
  if (!daily.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="6" class="mono">No usage stats yet</td>';
    dailyStatsTableBodyEl.appendChild(row);
  } else {
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

  if (providerCacheStatsTableBodyEl) {
    providerCacheStatsTableBodyEl.innerHTML = "";
    if (!byProvider.length) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="8" class="mono">No provider stats yet</td>';
      providerCacheStatsTableBodyEl.appendChild(row);
    } else {
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
        providerCacheStatsTableBodyEl.appendChild(row);
      }
    }
  }

  if (providerRtkStatsTableBodyEl) {
    providerRtkStatsTableBodyEl.innerHTML = "";
    if (!byProvider.length) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="7" class="mono">No provider RTK stats yet</td>';
      providerRtkStatsTableBodyEl.appendChild(row);
    } else {
      for (const entry of byProvider) {
        const row = document.createElement("tr");
        row.innerHTML =
          `<td class="mono">${escapeHtml(entry.key || "-")}</td>` +
          `<td>${formatNumber(entry.requests)}</td>` +
          `<td>${formatPercent(entry.rtkAppliedRate)}</td>` +
          `<td>${formatNumber(entry.rtkToolOutputsSeen)}</td>` +
          `<td>${formatNumber(entry.rtkToolOutputsReduced)}</td>` +
          `<td>${formatNumber(entry.rtkCharsSaved)}</td>` +
          `<td>${formatNumber(entry.rtkAvgCharsSaved)}</td>`;
        providerRtkStatsTableBodyEl.appendChild(row);
      }
    }
  }

  if (clientRouteRtkStatsTableBodyEl) {
    clientRouteRtkStatsTableBodyEl.innerHTML = "";
    if (!byClientRoute.length) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="7" class="mono">No client route RTK stats yet</td>';
      clientRouteRtkStatsTableBodyEl.appendChild(row);
    } else {
      for (const entry of byClientRoute) {
        const row = document.createElement("tr");
        row.innerHTML =
          `<td class="mono">${escapeHtml(entry.key || "-")}</td>` +
          `<td>${formatNumber(entry.requests)}</td>` +
          `<td>${formatPercent(entry.rtkAppliedRate)}</td>` +
          `<td>${formatNumber(entry.rtkToolOutputsSeen)}</td>` +
          `<td>${formatNumber(entry.rtkToolOutputsReduced)}</td>` +
          `<td>${formatNumber(entry.rtkCharsSaved)}</td>` +
          `<td>${formatNumber(entry.rtkAvgCharsSaved)}</td>`;
        clientRouteRtkStatsTableBodyEl.appendChild(row);
      }
    }
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
    const clientRoutes = Array.isArray(data.clientRoutes) ? data.clientRoutes : [];
    providerState = { activeProviderId, providers, clientRoutes };
    renderProviderTable();
    renderProviderCrudSummary();
    renderProviderCrudList();
    renderClientRoutePolicySection();
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
  if (currentRoute === ROUTES.providers) {
    await refreshProviders();
    return;
  }
  if (currentRoute === ROUTES.providerEdit) {
    await refreshProviders();
    return;
  }
  if (currentRoute === ROUTES.rtk) {
    await refreshProviders();
    await refreshUsageStats();
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

providerSearchInputEl?.addEventListener("input", () => {
  providerSearchTerm = providerSearchInputEl.value || "";
  renderProviderCrudList();
});

for (const element of providerEditorTabEls) {
  element.addEventListener("click", () => {
    setProviderEditorTab(element.dataset.providerTab || "basics");
  });
}

rtkClientRouteSelectEl?.addEventListener("change", () => {
  hydrateClientRouteRtkForm(rtkClientRouteSelectEl.value);
});

saveClientRtkPolicyBtnEl?.addEventListener("click", async () => {
  const client = rtkClientRouteSelectEl?.value || "";
  if (!client) return;
  saveClientRtkPolicyBtnEl.disabled = true;
  try {
    const response = await fetch("/api/rtk-policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client,
        policy: collectClientRouteRtkPolicy(),
      }),
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error?.message || "Could not save RTK policy");
    }
    await refreshProviders();
  } catch (error) {
    providerMetaEl.textContent = error instanceof Error ? error.message : "Could not save RTK policy";
  } finally {
    saveClientRtkPolicyBtnEl.disabled = false;
  }
});

clearClientRtkPolicyBtnEl?.addEventListener("click", async () => {
  const client = rtkClientRouteSelectEl?.value || "";
  if (!client) return;
  clearClientRtkPolicyBtnEl.disabled = true;
  try {
    const response = await fetch("/api/rtk-policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client,
        policy: {},
      }),
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error?.message || "Could not clear RTK policy");
    }
    await refreshProviders();
  } catch (error) {
    providerMetaEl.textContent = error instanceof Error ? error.message : "Could not clear RTK policy";
  } finally {
    clearClientRtkPolicyBtnEl.disabled = false;
  }
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
  if (!name || !baseUrl) {
    setProviderEditorStatus("Provider name and base URL are required.", "bad");
    return;
  }
  setProviderEditorStatus("");
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
    setProviderEditorStatus("Provider saved successfully.", "ok");
    setProviderEditorTab("basics");
    goToProviderEditor(data.provider?.id || editingProviderId || "");
  } catch (error) {
    setProviderEditorStatus(error instanceof Error ? error.message : "Save failed", "bad");
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
  renderProviderEditorSummary();
  const inputs = providerApiKeysListEl.querySelectorAll(".provider-api-key-input");
  const lastInput = inputs[inputs.length - 1];
  lastInput?.focus();
});

addClientApiKeyBtnEl.addEventListener("click", () => {
  appendClientApiKeyInput("");
  syncClientApiKeyRemoveButtons();
  renderProviderEditorSummary();
  const inputs = clientApiKeysListEl.querySelectorAll(".client-api-key-input");
  const lastInput = inputs[inputs.length - 1];
  lastInput?.focus();
});

addProviderErrorRuleBtnEl?.addEventListener("click", () => {
  appendProviderErrorRuleInput({});
  syncProviderErrorRuleRemoveButtons();
  syncProviderErrorRuleTitles();
  renderProviderEditorSummary();
  const inputs = providerErrorRulesListEl.querySelectorAll(".provider-error-status-codes");
  const lastInput = inputs[inputs.length - 1];
  lastInput?.focus();
});

[
  customProviderNameEl,
  customProviderBaseUrlEl,
  providerOwnedByEl,
  providerUsageCheckUrlEl,
  providerUsageCheckEnabledEl,
  providerMaxOutputTokensModeEl,
  providerMaxOutputTokensTargetEl,
  providerSanitizeReasoningSummaryEl,
  providerStripModelPrefixesEl,
  providerRtkEnabledEl,
  providerRtkToolOutputEnabledEl,
  providerRtkMaxCharsEl,
  providerRtkMaxLinesEl,
  providerRtkTailLinesEl,
  providerRtkTailCharsEl,
  providerRtkDetectFormatEl,
].forEach((element) => {
  element?.addEventListener("input", () => renderProviderEditorSummary());
  element?.addEventListener("change", () => renderProviderEditorSummary());
});

providerDeleteBtnEl.addEventListener("click", async () => {
  const providerId = providerEditorIdEl.value.trim();
  if (!providerId) return;
  setProviderEditorStatus("");
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
    window.location.hash = "#/providers";
  } catch (error) {
    setProviderEditorStatus(error instanceof Error ? error.message : "Delete failed", "bad");
  } finally {
    providerDeleteBtnEl.disabled = false;
    providerDeleteBtnEl.textContent = "Delete provider";
  }
});

window.addEventListener("hashchange", () => setRoute(normalizeRoute()));

setProviderEditor();
setProviderEditorTab("basics");
renderProviderEditorSummary();
setRoute(normalizeRoute());
setInterval(() => {
  refreshActiveRoute();
}, 5000);
