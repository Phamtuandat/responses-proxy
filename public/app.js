const ROUTES = {
  dashboard: "dashboard",
  clients: "clients",
  clientEdit: "client-edit",
  configHelper: "config-helper",
  oauth: "oauth",
  authManagement: "auth-management",
  providers: "providers",
  rtk: "rtk",
  providerEdit: "provider-edit",
  usage: "usage",
  cache: "cache",
};

const routeLinks = [...document.querySelectorAll("[data-route-link]")];
const screens = {
  [ROUTES.dashboard]: document.getElementById("screen-dashboard"),
  [ROUTES.clients]: document.getElementById("screen-clients"),
  [ROUTES.clientEdit]: document.getElementById("screen-client-edit"),
  [ROUTES.configHelper]: document.getElementById("screen-config-helper"),
  [ROUTES.oauth]: document.getElementById("screen-oauth"),
  [ROUTES.authManagement]: document.getElementById("screen-auth-management"),
  [ROUTES.providers]: document.getElementById("screen-providers"),
  [ROUTES.rtk]: document.getElementById("screen-rtk"),
  [ROUTES.providerEdit]: document.getElementById("screen-provider-edit"),
  [ROUTES.usage]: document.getElementById("screen-usage"),
  [ROUTES.cache]: document.getElementById("screen-cache"),
};

const usageLiveStatusEl = document.getElementById("usageLiveStatus");
const usageProviderCountEl = document.getElementById("usageProviderCount");
const usageOkCountEl = document.getElementById("usageOkCount");
const usageUpdatedAtEl = document.getElementById("usageUpdatedAt");
const usageLiveTableBodyEl = document.getElementById("usageLiveTableBody");
const usageRawEl = document.getElementById("usageRaw");

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
const clientSearchInputEl = document.getElementById("clientSearchInput");
const providerCrudTotalEl = document.getElementById("providerCrudTotal");
const providerCrudWithProviderKeysEl = document.getElementById("providerCrudWithProviderKeys");
const providerCrudWithClientKeysEl = document.getElementById("providerCrudWithClientKeys");
const providerCrudUsageCheckEl = document.getElementById("providerCrudUsageCheck");
const providerCrudRtkCustomEl = document.getElementById("providerCrudRtkCustom");
const providerCrudRequestPolicyEl = document.getElementById("providerCrudRequestPolicy");
const chatgptOauthEnabledBadgeEl = document.getElementById("chatgptOauthEnabledBadge");
const chatgptOauthStartBtnEl = document.getElementById("chatgptOauthStartBtn");
const chatgptOauthCopyLinkBtnEl = document.getElementById("chatgptOauthCopyLinkBtn");
const chatgptOauthOpenLinkEl = document.getElementById("chatgptOauthOpenLink");
const chatgptOauthRotationModeEl = document.getElementById("chatgptOauthRotationMode");
const chatgptOauthAuthUrlEl = document.getElementById("chatgptOauthAuthUrl");
const chatgptOauthCallbackInputEl = document.getElementById("chatgptOauthCallbackInput");
const chatgptOauthSubmitBtnEl = document.getElementById("chatgptOauthSubmitBtn");
const chatgptOauthStatusEl = document.getElementById("chatgptOauthStatus");
const chatgptOauthAccountsEl = document.getElementById("chatgptOauthAccounts");

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
const applyHermesConfigBtnEl = document.getElementById("applyHermesConfigBtn");
const applyCodexConfigBtnEl = document.getElementById("applyCodexConfigBtn");
const quickApplyStatusEl = document.getElementById("quickApplyStatus");
const hermesConfigStateBadgeEl = document.getElementById("hermesConfigStateBadge");
const hermesConfigRouteBadgeEl = document.getElementById("hermesConfigRouteBadge");
const hermesBaseUrlInputEl = document.getElementById("hermesBaseUrlInput");
const hermesConfigPathEl = document.getElementById("hermesConfigPath");
const hermesConfigBaseUrlEl = document.getElementById("hermesConfigBaseUrl");
const hermesConfigProviderEl = document.getElementById("hermesConfigProvider");
const hermesConfigApiKeySelectEl = document.getElementById("hermesConfigApiKeySelect");
const hermesConfigModelSelectEl = document.getElementById("hermesConfigModelSelect");
const hermesConfigBackupsEl = document.getElementById("hermesConfigBackups");
const codexConfigStateBadgeEl = document.getElementById("codexConfigStateBadge");
const codexConfigRouteBadgeEl = document.getElementById("codexConfigRouteBadge");
const codexBaseUrlInputEl = document.getElementById("codexBaseUrlInput");
const codexConfigPathEl = document.getElementById("codexConfigPath");
const codexConfigBaseUrlEl = document.getElementById("codexConfigBaseUrl");
const codexConfigProviderEl = document.getElementById("codexConfigProvider");
const codexConfigApiKeySelectEl = document.getElementById("codexConfigApiKeySelect");
const codexConfigModelSelectEl = document.getElementById("codexConfigModelSelect");
const codexConfigBackupsEl = document.getElementById("codexConfigBackups");
const clientCrudNameEl = document.getElementById("clientCrudName");
const clientCrudProviderSelectEl = document.getElementById("clientCrudProviderSelect");
const clientCrudModelEl = document.getElementById("clientCrudModel");
const clientCrudApiKeysEl = document.getElementById("clientCrudApiKeys");
const saveClientCrudBtnEl = document.getElementById("saveClientCrudBtn");
const clearClientCrudBtnEl = document.getElementById("clearClientCrudBtn");
const deleteClientCrudBtnEl = document.getElementById("deleteClientCrudBtn");
const clientCrudStatusEl = document.getElementById("clientCrudStatus");
const clientCrudListEl = document.getElementById("clientCrudList");
const clientCrudModeBadgeEl = document.getElementById("clientCrudModeBadge");
const clientCrudFormTitleEl = document.getElementById("clientCrudFormTitle");
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
const providerModelAliasesListEl = document.getElementById("providerModelAliasesList");
const providerModelAliasTemplateEl = document.getElementById("providerModelAliasTemplate");
const addProviderModelAliasBtnEl = document.getElementById("addProviderModelAliasBtn");
const providerModelAliasesErrorEl = document.getElementById("providerModelAliasesError");
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

let providerState = { activeProviderId: "", providers: [], providerOptions: [], clientRoutes: [] };
let chatgptOauthState = { enabled: false, accounts: [], authUrl: "", rotationMode: "round_robin" };
let latestCacheSnapshot = null;
let usageStatsState = null;
let clientConfigState = null;
let clientConfigModelCache = {};
let clientConfigModelSelections = {};
let usageLiveState = null;
let usageLiveTimerId = 0;
let currentRoute = "";
let selectedCacheProviderId = "";
let providerSearchTerm = "";
let clientSearchTerm = "";
let providerEditorDirty = false;
let chatgptOauthRotationSaveId = 0;
let selectedClientCrudKey = "";
const TRI_STATE_INHERIT = "inherit";

function isInteractiveClientRoute() {
  return currentRoute === ROUTES.configHelper;
}

function shouldSkipBackgroundRefresh() {
  return currentRoute === ROUTES.configHelper || currentRoute === ROUTES.providerEdit;
}

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
    const activeTarget =
      routeState.name === ROUTES.clientEdit
        ? ROUTES.clients
        : routeState.name === ROUTES.providerEdit
          ? ROUTES.providers
          : routeState.name;
    link.classList.toggle("active", target === activeTarget);
  }
  if (routeState.name === ROUTES.providerEdit) {
    hydrateProviderEditorFromRoute(routeState.query);
  }
  if (routeState.name === ROUTES.clientEdit) {
    hydrateClientEditorFromRoute(routeState.query);
  }
  syncUsageLivePolling();
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
    clientApiKeysListEl.contains(active) ||
    providerModelAliasesListEl.contains(active) ||
    providerErrorRulesListEl.contains(active)
  );
}

function getEditableProviders() {
  return providerState.providers;
}

function getClientProviderOptions() {
  const options = Array.isArray(clientConfigState?.providerOptions)
    ? clientConfigState.providerOptions
    : Array.isArray(providerState.providerOptions)
      ? providerState.providerOptions
      : [];
  return options.length ? options : providerState.providers;
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

function setProviderMeta(message = "") {
  if (!providerMetaEl) return;
  providerMetaEl.textContent = message;
  providerMetaEl.hidden = !message;
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
  const requestPolicySummary = formatRequestPolicySummary(capabilities);

  providerSummaryIdEl.textContent = providerId;
  providerSummaryBaseUrlEl.textContent = baseUrl;
  providerSummaryProviderKeysEl.textContent = String(providerKeys);
  providerSummaryClientKeysEl.textContent = String(clientKeys);
  providerSummaryRequestPolicyEl.textContent = requestPolicySummary;
  providerSummaryRtkPolicyEl.textContent = formatRtkPolicySummary(capabilities.rtkPolicy);
  providerSummaryErrorPolicyEl.textContent = formatErrorPolicySummary(capabilities.errorPolicy);
}

function formatRequestPolicySummary(capabilities) {
  const maxOutputTokens = capabilities.requestParameterPolicy?.maxOutputTokens;
  const parts = [
    maxOutputTokens?.mode && maxOutputTokens.mode !== "forward"
      ? maxOutputTokens.mode === "rename" && maxOutputTokens.target
        ? `max-output: rename -> ${maxOutputTokens.target}`
        : `max-output: ${maxOutputTokens.mode}`
      : "",
    capabilities.modelAliases && Object.keys(capabilities.modelAliases).length
      ? `aliases: ${Object.keys(capabilities.modelAliases).length}`
      : "",
    capabilities.stripModelPrefixes?.length
      ? `prefixes: ${capabilities.stripModelPrefixes.join(", ")}`
      : "",
  ].filter(Boolean);

  return parts.length ? parts.join(" | ") : "Default";
}

function setProviderEditor(provider) {
  providerEditorDirty = false;
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
  renderProviderModelAliasInputs(capabilities.modelAliases || {});
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
  const toggleBtn = fragment.querySelector(".api-key-toggle");
  const copyBtn = fragment.querySelector(".api-key-copy");
  const removeBtn = fragment.querySelector(".provider-api-key-remove");
  input.value = value;
  bindApiKeyRowActions(input, toggleBtn, copyBtn);
  removeBtn.addEventListener("click", () => {
    row.remove();
    if (!providerApiKeysListEl.children.length) {
      appendProviderApiKeyInput("");
    }
    syncProviderApiKeyRemoveButtons();
    markProviderEditorDirty();
    renderProviderEditorSummary();
  });
  input.addEventListener("input", () => {
    markProviderEditorDirty();
    renderProviderEditorSummary();
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
  const toggleBtn = fragment.querySelector(".api-key-toggle");
  const copyBtn = fragment.querySelector(".api-key-copy");
  const removeBtn = fragment.querySelector(".client-api-key-remove");
  input.value = value;
  bindApiKeyRowActions(input, toggleBtn, copyBtn);
  removeBtn.addEventListener("click", () => {
    row.remove();
    if (!clientApiKeysListEl.children.length) {
      appendClientApiKeyInput("");
    }
    syncClientApiKeyRemoveButtons();
    markProviderEditorDirty();
    renderProviderEditorSummary();
  });
  input.addEventListener("input", () => {
    markProviderEditorDirty();
    renderProviderEditorSummary();
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

function renderProviderModelAliasInputs(aliases) {
  providerModelAliasesListEl.innerHTML = "";
  const entries = Object.entries(aliases || {});
  if (!entries.length) {
    appendProviderModelAliasInput("", "");
    syncProviderModelAliasRemoveButtons();
    validateProviderModelAliases();
    return;
  }
  for (const [source, target] of entries) {
    appendProviderModelAliasInput(source, target);
  }
  syncProviderModelAliasRemoveButtons();
  validateProviderModelAliases();
}

function appendProviderModelAliasInput(source = "", target = "") {
  const fragment = providerModelAliasTemplateEl.content.cloneNode(true);
  const row = fragment.querySelector(".alias-rule-row");
  const sourceInput = fragment.querySelector(".provider-model-alias-source");
  const targetInput = fragment.querySelector(".provider-model-alias-target");
  const removeBtn = fragment.querySelector(".provider-model-alias-remove");
  sourceInput.value = source;
  targetInput.value = target;
  removeBtn.addEventListener("click", () => {
    row.remove();
    if (!providerModelAliasesListEl.children.length) {
      appendProviderModelAliasInput("", "");
    }
    syncProviderModelAliasRemoveButtons();
    markProviderEditorDirty();
    validateProviderModelAliases();
    renderProviderEditorSummary();
  });
  sourceInput.addEventListener("input", () => {
    markProviderEditorDirty();
    validateProviderModelAliases();
    renderProviderEditorSummary();
  });
  targetInput.addEventListener("input", () => {
    markProviderEditorDirty();
    validateProviderModelAliases();
    renderProviderEditorSummary();
  });
  providerModelAliasesListEl.appendChild(fragment);
}

function syncProviderModelAliasRemoveButtons() {
  const rows = [...providerModelAliasesListEl.querySelectorAll(".alias-rule-row")];
  for (const row of rows) {
    const removeBtn = row.querySelector(".provider-model-alias-remove");
    removeBtn.disabled = rows.length === 1;
  }
}

function collectProviderModelAliases() {
  const entries = [...providerModelAliasesListEl.querySelectorAll(".alias-rule-row")]
    .map((row) => {
      const source = row.querySelector(".provider-model-alias-source")?.value.trim() || "";
      const target = row.querySelector(".provider-model-alias-target")?.value.trim() || "";
      return source && target ? [source, target] : null;
    })
    .filter(Boolean);

  return entries.length ? Object.fromEntries(entries) : undefined;
}

function findDuplicateProviderModelAliases() {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of providerModelAliasesListEl.querySelectorAll(".alias-rule-row")) {
    const source = row.querySelector(".provider-model-alias-source")?.value.trim() || "";
    if (!source) continue;
    const normalized = source.toLowerCase();
    if (seen.has(normalized)) {
      duplicates.add(source);
    } else {
      seen.add(normalized);
    }
  }
  return [...duplicates];
}

function validateProviderModelAliases() {
  const duplicates = findDuplicateProviderModelAliases();
  const hasDuplicates = duplicates.length > 0;

  for (const row of providerModelAliasesListEl.querySelectorAll(".alias-rule-row")) {
    const sourceInput = row.querySelector(".provider-model-alias-source");
    const source = sourceInput?.value.trim().toLowerCase() || "";
    sourceInput?.classList.toggle(
      "input-invalid",
      Boolean(source) && duplicates.some((entry) => entry.toLowerCase() === source),
    );
  }

  if (providerModelAliasesErrorEl) {
    providerModelAliasesErrorEl.hidden = !hasDuplicates;
    providerModelAliasesErrorEl.textContent = hasDuplicates
      ? `Duplicate aliases are not allowed: ${duplicates.join(", ")}`
      : "";
  }

  return !hasDuplicates;
}

function bindApiKeyRowActions(input, toggleBtn, copyBtn) {
  const refreshToggleLabel = () => {
    if (toggleBtn) {
      toggleBtn.textContent = input.type === "password" ? "Show" : "Hide";
    }
  };

  toggleBtn?.addEventListener("click", () => {
    input.type = input.type === "password" ? "text" : "password";
    refreshToggleLabel();
  });

  copyBtn?.addEventListener("click", async () => {
    const value = input.value.trim();
    if (!value) {
      copyBtn.textContent = "Empty";
      window.setTimeout(() => {
        copyBtn.textContent = "Copy";
      }, 900);
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      copyBtn.textContent = "Copied";
    } catch (_error) {
      input.focus();
      input.select();
      copyBtn.textContent = "Select";
    }

    window.setTimeout(() => {
      copyBtn.textContent = "Copy";
    }, 1200);
  });

  refreshToggleLabel();
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
    markProviderEditorDirty();
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
      markProviderEditorDirty();
      refreshTitle();
      refreshPreview();
      renderProviderEditorSummary();
    });
    element?.addEventListener("change", () => {
      markProviderEditorDirty();
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
  const providerModelAliases = collectProviderModelAliases();
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
    ...(providerModelAliases ? { modelAliases: providerModelAliases } : {}),
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

function goToClientEditor(client) {
  if (client) {
    window.location.hash = `#/client-edit?client=${encodeURIComponent(client)}`;
    return;
  }
  window.location.hash = "#/client-edit";
}

function hydrateProviderEditorFromRoute(query) {
  if (isEditingProviderForm() || providerEditorDirty) return;
  const providerId = query.get("id") || "";
  if (!providerId) {
    setProviderEditor();
    return;
  }
  const provider = getEditableProviders().find((item) => item.id === providerId);
  setProviderEditor(provider || null);
}

function markProviderEditorDirty() {
  providerEditorDirty = true;
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
      capabilities.modelAliases && Object.keys(capabilities.modelAliases).length
        ? `aliases:${Object.keys(capabilities.modelAliases).length}`
        : "",
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
    capabilities.modelAliases && Object.keys(capabilities.modelAliases).length
      ? `aliases:${Object.keys(capabilities.modelAliases).length}`
      : "",
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

function renderChatGptOauthPanel() {
  if (!chatgptOauthEnabledBadgeEl || !chatgptOauthAccountsEl) {
    return;
  }

  chatgptOauthEnabledBadgeEl.textContent = chatgptOauthState.enabled ? "Enabled" : "Disabled";
  chatgptOauthEnabledBadgeEl.className = `provider-badge ${
    chatgptOauthState.enabled ? "provider-badge-ok" : "provider-badge-warn"
  }`;
  if (chatgptOauthStartBtnEl) {
    chatgptOauthStartBtnEl.disabled = !chatgptOauthState.enabled;
  }
  if (chatgptOauthSubmitBtnEl) {
    chatgptOauthSubmitBtnEl.disabled = !chatgptOauthState.enabled;
  }
  if (chatgptOauthRotationModeEl) {
    chatgptOauthRotationModeEl.disabled = !chatgptOauthState.enabled;
    chatgptOauthRotationModeEl.value = chatgptOauthState.rotationMode || "round_robin";
  }
  if (chatgptOauthAuthUrlEl && chatgptOauthAuthUrlEl.value !== chatgptOauthState.authUrl) {
    chatgptOauthAuthUrlEl.value = chatgptOauthState.authUrl || "";
  }
  if (chatgptOauthCopyLinkBtnEl) {
    chatgptOauthCopyLinkBtnEl.disabled = !chatgptOauthState.authUrl;
  }
  if (chatgptOauthOpenLinkEl) {
    chatgptOauthOpenLinkEl.href = chatgptOauthState.authUrl || "#";
    const linkDisabled = !chatgptOauthState.authUrl;
    chatgptOauthOpenLinkEl.classList.toggle("disabled-link", linkDisabled);
    chatgptOauthOpenLinkEl.setAttribute("aria-disabled", linkDisabled ? "true" : "false");
    if (linkDisabled) {
      chatgptOauthOpenLinkEl.setAttribute("tabindex", "-1");
    } else {
      chatgptOauthOpenLinkEl.removeAttribute("tabindex");
    }
  }

  chatgptOauthAccountsEl.innerHTML = "";
  if (!chatgptOauthState.accounts.length) {
    chatgptOauthAccountsEl.classList.add("oauth-account-list-hidden");
    return;
  }
  chatgptOauthAccountsEl.classList.remove("oauth-account-list-hidden");

  for (const account of chatgptOauthState.accounts) {
    const provider = getClientProviderOptions().find(
      (item) => item.authMode === "chatgpt_oauth" && !item.chatgptAccountId,
    );
    const row = document.createElement("article");
    row.className = "oauth-account-row";
    row.innerHTML =
      '<div>' +
      '<div class="oauth-account-title">' +
      `<strong>${escapeHtml(account.email || account.accountId || account.id)}</strong>` +
      `<span class="pill">${escapeHtml(provider ? `${provider.id} pool` : "shared provider pending")}</span>` +
      `<span class="pill">${escapeHtml(account.disabled ? "Disabled" : "Enabled")}</span>` +
      "</div>" +
      `<div class="oauth-account-meta">Account: ${escapeHtml(account.accountId || account.id)}</div>` +
      `<div class="oauth-account-meta">Expires: ${escapeHtml(formatRelativeTimestamp(account.expiresAt))}</div>` +
      "</div>" +
      '<div class="oauth-account-actions">' +
      '<button type="button" class="table-button oauth-refresh-button">Refresh</button>' +
      `<button type="button" class="table-button table-button-utility oauth-toggle-button">${escapeHtml(account.disabled ? "Enable" : "Disable")}</button>` +
      '<button type="button" class="table-button button-danger-soft oauth-delete-button">Delete</button>' +
      "</div>";
    row.querySelector(".oauth-refresh-button")?.addEventListener("click", () =>
      refreshChatGptOauthAccount(account.id),
    );
    row.querySelector(".oauth-delete-button")?.addEventListener("click", () =>
      deleteChatGptOauthAccount(account.id, account.email || account.accountId || account.id),
    );
    row.querySelector(".oauth-toggle-button")?.addEventListener("click", () =>
      toggleChatGptOauthAccount(account.id, account.disabled),
    );
    chatgptOauthAccountsEl.appendChild(row);
  }
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
      setProviderMeta(`Deleting provider ${provider.id}...`);
      try {
        const response = await fetch(`/api/providers/${encodeURIComponent(provider.id)}`, {
          method: "DELETE",
        });
        const data = await response.json();
        if (!response.ok || data.error) {
          throw new Error(data.error?.message || "Delete failed");
        }
        await refreshProviders();
        setProviderMeta(`Deleted provider ${provider.id}`);
      } catch (error) {
        setProviderMeta(error instanceof Error ? error.message : "Could not delete provider");
      } finally {
        deleteBtn.disabled = false;
        deleteBtn.textContent = "Delete";
      }
    });
    providerListEl.appendChild(card);
  }
}

function renderClientRoutePolicySection() {
  const routes = Array.isArray(providerState.clientRoutes)
    ? providerState.clientRoutes.filter((route) => route.key !== "default")
    : [];
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
      row.innerHTML = '<td colspan="4" class="mono">No clients</td>';
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

async function copyTextWithButton(buttonEl, value, options = {}) {
  if (!buttonEl) return;
  const idleLabel = options.idleLabel || "Copy";
  const emptyLabel = options.emptyLabel || "Empty";
  const copiedLabel = options.copiedLabel || "Copied";
  const selectLabel = options.selectLabel || "Select";

  if (!value) {
    buttonEl.textContent = emptyLabel;
    window.setTimeout(() => {
      buttonEl.textContent = idleLabel;
    }, 900);
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    buttonEl.textContent = copiedLabel;
  } catch (_error) {
    buttonEl.textContent = selectLabel;
  }

  window.setTimeout(() => {
    buttonEl.textContent = idleLabel;
  }, 1200);
}

function maskApiKey(value) {
  if (!value) return "Missing";
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

function getAllClientApiKeyOptions() {
  const routes = Array.isArray(providerState.clientRoutes)
    ? providerState.clientRoutes.filter((route) => route.key !== "default")
    : [];
  return routes.flatMap((route) => {
    const keys = Array.isArray(route.apiKeys) ? route.apiKeys.filter(Boolean) : [];
    return keys.map((apiKey, index) => ({
      apiKey,
      client: route.key,
      label: keys.length > 1 ? `${route.key} (${index + 1})` : route.key,
    }));
  });
}

function renderClientApiKeySelect(selectEl, preferredApiKey) {
  if (!selectEl) return;
  const options = getAllClientApiKeyOptions();
  const keys = options.map((option) => option.apiKey);
  const currentValue = selectEl.value || "";
  const selectedValue =
    (currentValue && keys.includes(currentValue) ? currentValue : "") ||
    (preferredApiKey && keys.includes(preferredApiKey) ? preferredApiKey : "") ||
    keys[0] ||
    "";
  selectEl.innerHTML = "";
  if (!keys.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No client API keys";
    selectEl.appendChild(option);
    selectEl.disabled = true;
    return;
  }
  for (const optionEntry of options) {
    const option = document.createElement("option");
    option.value = optionEntry.apiKey;
    option.textContent = optionEntry.label;
    selectEl.appendChild(option);
  }
  selectEl.disabled = false;
  selectEl.value = selectedValue;
}

function getClientApiKeyOption(apiKey) {
  const key = typeof apiKey === "string" ? apiKey : "";
  return getAllClientApiKeyOptions().find((option) => option.apiKey === key) || null;
}

function getClientRouteByKey(client) {
  return (providerState.clientRoutes || []).find((route) => route.key === client) || null;
}

function renderClientModelSelect(selectEl, options = {}) {
  if (!selectEl) return;
  const models = Array.isArray(options.models) ? options.models.filter(Boolean) : [];
  const preferredModel = typeof options.preferredModel === "string" ? options.preferredModel : "";
  const currentValue = selectEl.value || "";
  const selectedValue =
    (currentValue && models.includes(currentValue) ? currentValue : "") ||
    (preferredModel && models.includes(preferredModel) ? preferredModel : "") ||
    models[0] ||
    "";

  selectEl.innerHTML = "";
  if (options.loading) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Loading models...";
    selectEl.appendChild(option);
    selectEl.disabled = true;
    return;
  }
  if (!models.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = options.emptyLabel || "No models available";
    selectEl.appendChild(option);
    selectEl.disabled = true;
    return;
  }
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    selectEl.appendChild(option);
  }
  selectEl.disabled = false;
  selectEl.value = selectedValue;
}

function updateQuickApplyActionState(client) {
  const entry = clientConfigState?.clients?.[client];
  const actionBtn = client === "hermes" ? applyHermesConfigBtnEl : applyCodexConfigBtnEl;
  const modelSelectEl = client === "hermes" ? hermesConfigModelSelectEl : codexConfigModelSelectEl;
  if (!actionBtn) return;
  const hasClientApiKey = getAllClientApiKeyOptions().length > 0;
  const hasModel = Boolean(modelSelectEl?.value);
  actionBtn.disabled = entry?.access?.canPatch === false || !hasClientApiKey || !hasModel;
  actionBtn.title =
    entry?.access?.reason ||
    (!hasClientApiKey ? "Add a client API key before applying." : "") ||
    (!hasModel ? "Choose an available model before applying." : "");
}

function updateClientConfigSelectedProviderSummary(client) {
  const isHermes = client === "hermes";
  const apiKeySelectEl = isHermes ? hermesConfigApiKeySelectEl : codexConfigApiKeySelectEl;
  const providerEl = isHermes ? hermesConfigProviderEl : codexConfigProviderEl;
  const routeBadgeEl = isHermes ? hermesConfigRouteBadgeEl : codexConfigRouteBadgeEl;
  const entry = clientConfigState?.clients?.[client];
  const selectedApiKeyOption = getClientApiKeyOption(apiKeySelectEl?.value || "");
  const selectedRoute = selectedApiKeyOption ? getClientRouteByKey(selectedApiKeyOption.client) : entry?.route;

  updateQuickApplyBadge(
    routeBadgeEl,
    selectedRoute?.providerName
      ? `${selectedRoute.key} → ${selectedRoute.providerName}`
      : selectedRoute?.key || client,
    selectedRoute?.providerId ? "ok" : "warn",
  );
  setTextContent(providerEl, selectedRoute?.providerName || selectedRoute?.providerId || "-");
}

async function loadClientConfigModelsForSelection(client, apiKey) {
  const selectEl = client === "hermes" ? hermesConfigModelSelectEl : codexConfigModelSelectEl;
  const option = getClientApiKeyOption(apiKey);
  const route = option ? getClientRouteByKey(option.client) : null;
  const providerId = route?.providerId || "";
  const preferredModel =
    clientConfigModelSelections[client] ||
    route?.modelOverride ||
    "";
  updateClientConfigSelectedProviderSummary(client);

  if (!providerId) {
    renderClientModelSelect(selectEl, { emptyLabel: "Select a client API key" });
    updateQuickApplyActionState(client);
    return;
  }

  if (Array.isArray(clientConfigModelCache[providerId])) {
    renderClientModelSelect(selectEl, {
      models: clientConfigModelCache[providerId],
      preferredModel,
    });
    updateQuickApplyActionState(client);
    return;
  }

  renderClientModelSelect(selectEl, { loading: true });
  updateQuickApplyActionState(client);
  try {
    const { response, data } = await fetchJsonWithTimeout(
      `/api/provider-models?providerId=${encodeURIComponent(providerId)}`,
      12000,
    );
    if (!response.ok || data.error) {
      throw new Error(data.error?.message || "Could not load provider models");
    }
    const models = Array.isArray(data.models) ? data.models : [];
    clientConfigModelCache[providerId] = models;
    renderClientModelSelect(selectEl, {
      models,
      preferredModel,
      emptyLabel: "No models returned",
    });
    updateQuickApplyActionState(client);
  } catch (error) {
    renderClientModelSelect(selectEl, {
      emptyLabel: error instanceof Error ? error.message : "Could not load models",
    });
    updateQuickApplyActionState(client);
  }
}

function setTextContent(element, value) {
  if (!element) return;
  element.textContent = value;
}

function setQuickApplyStatus(message, tone = "") {
  if (!quickApplyStatusEl) return;
  if (!message) {
    quickApplyStatusEl.hidden = true;
    quickApplyStatusEl.className = "compact-status";
    quickApplyStatusEl.textContent = "";
    return;
  }
  quickApplyStatusEl.hidden = false;
  quickApplyStatusEl.className = `compact-status${tone ? ` ${tone}` : ""}`;
  quickApplyStatusEl.textContent = message;
}

function setClientCrudStatus(message, tone = "") {
  if (!clientCrudStatusEl) return;
  if (!message) {
    clientCrudStatusEl.hidden = true;
    clientCrudStatusEl.className = "compact-status";
    clientCrudStatusEl.textContent = "";
    return;
  }
  clientCrudStatusEl.hidden = false;
  clientCrudStatusEl.className = `compact-status${tone ? ` ${tone}` : ""}`;
  clientCrudStatusEl.textContent = message;
}

function updateQuickApplyBadge(element, label, tone) {
  if (!element) return;
  element.textContent = label;
  element.className = `provider-badge${tone ? ` provider-badge-${tone}` : ""}`;
}

function syncQuickApplyModelInput(inputEl, preferredValue) {
  if (!inputEl) return;
  if (document.activeElement === inputEl) return;
  inputEl.value = preferredValue || "";
}

function formatRelativeTimestamp(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleString()}`;
}

function renderQuickApplyBackups(container, backups) {
  if (!container) return;
  container.innerHTML = "";
  if (!Array.isArray(backups) || !backups.length) {
    const empty = document.createElement("div");
    empty.className = "quick-apply-backup-item";
    empty.innerHTML = "<strong>No backups yet</strong><span>A timestamped backup will appear here after the first patch.</span>";
    container.appendChild(empty);
    return;
  }

  for (const backup of backups) {
    const item = document.createElement("div");
    item.className = "quick-apply-backup-item";
    item.innerHTML =
      `<strong class="mono">${escapeHtml(backup.fileName || "-")}</strong>` +
      `<span>${escapeHtml(formatRelativeTimestamp(backup.modifiedAt))} · ${escapeHtml(formatNumber(backup.sizeBytes) || "0")} bytes</span>`;
    container.appendChild(item);
  }
}

function renderClientConfigStatus() {
  const clients = clientConfigState?.clients || {};
  renderClientCrud();
  renderSingleClientConfigStatus("hermes", clients.hermes);
  renderSingleClientConfigStatus("codex", clients.codex);
}

function renderClientCrud() {
  const allRoutes = Array.isArray(providerState.clientRoutes)
    ? providerState.clientRoutes.filter((route) => route.key !== "default")
    : [];
  const search = clientSearchTerm.trim().toLowerCase();
  const routes = search
    ? allRoutes.filter((route) => {
      const haystack = [
        route.key,
        route.providerName,
        route.providerId,
        route.modelOverride || "Provider default",
        formatClientApiKeyCount(route.apiKeys?.length || 0),
      ].join(" ").toLowerCase();
      return haystack.includes(search);
    })
    : allRoutes;
  const providerOptions = getClientProviderOptions();
  if (
    selectedClientCrudKey &&
    selectedClientCrudKey !== "__new__" &&
    !allRoutes.some((route) => route.key === selectedClientCrudKey)
  ) {
    selectedClientCrudKey = "";
  }
  if (!selectedClientCrudKey && allRoutes.length) {
    selectedClientCrudKey = allRoutes[0].key;
  }
  if (clientCrudProviderSelectEl) {
    const currentValue = clientCrudProviderSelectEl.value;
    clientCrudProviderSelectEl.innerHTML = "";
    for (const provider of providerOptions) {
      const option = document.createElement("option");
      option.value = provider.id;
      option.textContent = provider.capabilities?.systemManaged
        ? `${provider.name} (account pool)`
        : `${provider.name} (${provider.id})`;
      clientCrudProviderSelectEl.appendChild(option);
    }
    clientCrudProviderSelectEl.disabled = !providerOptions.length;
    if (currentValue && providerOptions.some((provider) => provider.id === currentValue)) {
      clientCrudProviderSelectEl.value = currentValue;
    }
  }

  if (clientCrudListEl) {
    clientCrudListEl.innerHTML = "";
    if (!routes.length) {
      const empty = document.createElement("div");
      empty.className = "meta";
      empty.textContent = search ? "No clients match this search." : "No clients yet.";
      clientCrudListEl.appendChild(empty);
    }
    for (const route of routes) {
      const item = document.createElement("article");
      item.className = `client-route-item${route.key === selectedClientCrudKey ? " active" : ""}`;
      const title = document.createElement("div");
      title.className = "client-route-title";
      title.innerHTML =
        `<strong>${escapeHtml(route.key)}</strong>` +
        `<span class="provider-badge">${escapeHtml(formatClientApiKeyCount(route.apiKeys?.length || 0))}</span>`;
      const meta = document.createElement("div");
      meta.className = "client-route-meta";
      meta.textContent =
        `${route.providerName || route.providerId || "-"} · ${route.modelOverride || "Provider default"}`;
      const actions = document.createElement("div");
      actions.className = "client-route-actions";
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "button-link-muted";
      editButton.textContent = "Edit";
      editButton.addEventListener("click", (event) => {
        event.stopPropagation();
        goToClientEditor(route.key);
      });
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "table-button-danger-soft";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        void deleteClientCrud(route.key);
      });
      actions.append(editButton, deleteButton);
      item.append(title, meta, actions);
      item.addEventListener("click", () => {
        goToClientEditor(route.key);
      });
      clientCrudListEl.appendChild(item);
    }
  }

  if (currentRoute === ROUTES.clientEdit) {
    hydrateClientCrudForm(selectedClientCrudKey);
  }
}

function formatClientApiKeyCount(count) {
  return count === 1 ? "1 API key" : `${count} API keys`;
}

function hydrateClientEditorFromRoute(query) {
  const client = query.get("client") || "";
  selectedClientCrudKey = client || "__new__";
  setClientCrudStatus("");
  hydrateClientCrudForm(selectedClientCrudKey);
}

function hydrateClientCrudForm(routeKey) {
  const route = (providerState.clientRoutes || []).find((entry) => entry.key === routeKey);
  if (!clientCrudNameEl || !clientCrudProviderSelectEl || !clientCrudModelEl || !clientCrudApiKeysEl) return;
  if (!route) {
    setClientCrudFormMode("create");
    clientCrudNameEl.value = "";
    clientCrudNameEl.disabled = false;
    clientCrudProviderSelectEl.value = getClientProviderOptions()[0]?.id || "";
    clientCrudModelEl.value = "";
    clientCrudApiKeysEl.value = "";
    if (deleteClientCrudBtnEl) deleteClientCrudBtnEl.disabled = true;
    return;
  }
  setClientCrudFormMode("edit", route.key);
  clientCrudNameEl.value = route.key || "";
  clientCrudNameEl.disabled = true;
  clientCrudProviderSelectEl.value = route.providerId || getClientProviderOptions()[0]?.id || "";
  clientCrudModelEl.value = route.modelOverride || "";
  clientCrudApiKeysEl.value = Array.isArray(route.apiKeys) ? route.apiKeys.join("\n") : "";
  if (deleteClientCrudBtnEl) deleteClientCrudBtnEl.disabled = route.key === "default";
}

function setClientCrudFormMode(mode, client = "") {
  const isEdit = mode === "edit";
  if (clientCrudModeBadgeEl) {
    clientCrudModeBadgeEl.textContent = isEdit ? "Edit mode" : "Create mode";
    clientCrudModeBadgeEl.className = `pill${isEdit ? " ok-pill" : ""}`;
  }
  if (clientCrudFormTitleEl) {
    clientCrudFormTitleEl.textContent = isEdit ? `Edit ${client}` : "Create Client";
  }
  if (saveClientCrudBtnEl) {
    saveClientCrudBtnEl.textContent = isEdit ? "Update client" : "Create client";
  }
}

function clearClientCrudForm() {
  selectedClientCrudKey = "__new__";
  setClientCrudStatus("");
  if (currentRoute === ROUTES.clientEdit && normalizeRoute().query.get("client")) {
    goToClientEditor();
    return;
  }
  renderClientCrud();
  clientCrudNameEl?.focus();
}

async function fetchJsonWithTimeout(url, timeoutMs = 3500) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    const data = await response.json();
    return { response, data };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function renderSingleClientConfigStatus(client, entry) {
  const isHermes = client === "hermes";
  const stateBadgeEl = isHermes ? hermesConfigStateBadgeEl : codexConfigStateBadgeEl;
  const routeBadgeEl = isHermes ? hermesConfigRouteBadgeEl : codexConfigRouteBadgeEl;
  const baseUrlInputEl = isHermes ? hermesBaseUrlInputEl : codexBaseUrlInputEl;
  const pathEl = isHermes ? hermesConfigPathEl : codexConfigPathEl;
  const baseUrlEl = isHermes ? hermesConfigBaseUrlEl : codexConfigBaseUrlEl;
  const providerEl = isHermes ? hermesConfigProviderEl : codexConfigProviderEl;
  const apiKeySelectEl = isHermes ? hermesConfigApiKeySelectEl : codexConfigApiKeySelectEl;
  const modelSelectEl = isHermes ? hermesConfigModelSelectEl : codexConfigModelSelectEl;
  const backupsEl = isHermes ? hermesConfigBackupsEl : codexConfigBackupsEl;
  const preserveDraft = isInteractiveClientRoute();
  const currentBaseUrlValue = baseUrlInputEl?.value || "";

  if (!entry) {
    updateQuickApplyBadge(stateBadgeEl, "Unavailable", "bad");
    updateQuickApplyBadge(routeBadgeEl, "Client unknown", "warn");
    setTextContent(pathEl, "-");
    setTextContent(baseUrlEl, "-");
    setTextContent(providerEl, "-");
    renderClientApiKeySelect(apiKeySelectEl, "");
    renderClientModelSelect(modelSelectEl, { emptyLabel: "Select a client API key" });
    if (baseUrlInputEl && (!preserveDraft || document.activeElement !== baseUrlInputEl)) {
      baseUrlInputEl.value = preserveDraft ? currentBaseUrlValue || clientConfigState?.proxyBaseUrl || "" : clientConfigState?.proxyBaseUrl || "";
    }
    renderQuickApplyBackups(backupsEl, []);
    if (isHermes ? applyHermesConfigBtnEl : applyCodexConfigBtnEl) {
      (isHermes ? applyHermesConfigBtnEl : applyCodexConfigBtnEl).disabled = true;
    }
    return;
  }

  updateQuickApplyBadge(
    stateBadgeEl,
    entry.configured ? "Applied" : entry.exists ? "Needs patch" : "Config missing",
    entry.configured ? "ok" : entry.exists ? "warn" : "bad",
  );
  setTextContent(pathEl, entry.path || "-");
  setTextContent(baseUrlEl, entry.detected?.baseUrl || clientConfigState?.proxyBaseUrl || "-");
  renderClientApiKeySelect(apiKeySelectEl, entry.detected?.apiKey || entry.routeApiKey || "");
  loadClientConfigModelsForSelection(client, apiKeySelectEl?.value || "");
  if (baseUrlInputEl && (!preserveDraft || document.activeElement !== baseUrlInputEl)) {
    baseUrlInputEl.value =
      (preserveDraft ? currentBaseUrlValue : "") || entry.detected?.baseUrl || clientConfigState?.proxyBaseUrl || "";
  }
  renderQuickApplyBackups(backupsEl, entry.backups || []);
  updateQuickApplyActionState(client);
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
  const byClientRoute = Array.isArray(usageStatsState?.byClientRoute)
    ? usageStatsState.byClientRoute.filter((entry) => entry.key !== "default")
    : [];

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
      row.innerHTML = '<td colspan="7" class="mono">No client RTK stats yet</td>';
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
    const [response, oauthResponse] = await Promise.all([
      fetch("/api/providers", { cache: "no-store" }),
      fetch("/api/chatgpt-oauth/status", { cache: "no-store" }).catch(() => null),
    ]);
    const data = await response.json();
    const providers = Array.isArray(data.providers) ? data.providers : [];
    const providerOptions = Array.isArray(data.providerOptions) ? data.providerOptions : providers;
    const activeProviderId = data.activeProviderId;
    const clientRoutes = Array.isArray(data.clientRoutes) ? data.clientRoutes : [];
    providerState = { activeProviderId, providers, providerOptions, clientRoutes };
    if (oauthResponse) {
      const oauthData = await oauthResponse.json();
      if (oauthResponse.ok && !oauthData.error) {
        chatgptOauthState = {
          ...chatgptOauthState,
          enabled: oauthData.enabled === true,
          rotationMode: oauthData.rotationMode || "round_robin",
          accounts: Array.isArray(oauthData.accounts) ? oauthData.accounts : [],
        };
      }
    }
    renderProviderTable();
    renderProviderCrudSummary();
    renderChatGptOauthPanel();
    renderProviderCrudList();
    renderClientRoutePolicySection();
    setProviderMeta("");
    renderCacheProviderSelect();
    renderCacheProviderStats();

    if (currentRoute === ROUTES.providerEdit) {
      hydrateProviderEditorFromRoute(normalizeRoute().query);
    }

    renderOverviewStats();
  } catch (error) {
    setProviderMeta(error instanceof Error ? error.message : "Load failed");
  }
}

async function startChatGptOauthLogin() {
  if (!chatgptOauthStartBtnEl) {
    return;
  }
  chatgptOauthStartBtnEl.disabled = true;
  chatgptOauthStartBtnEl.textContent = "Starting...";
  if (chatgptOauthStatusEl) {
    chatgptOauthStatusEl.textContent = "Creating login session...";
  }
  try {
    const response = await fetch("/api/chatgpt-oauth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error?.message || "Could not start account login");
    }
    chatgptOauthState = {
      ...chatgptOauthState,
      enabled: true,
      authUrl: data.authUrl || "",
    };
    renderChatGptOauthPanel();
    if (chatgptOauthStatusEl) {
      chatgptOauthStatusEl.textContent = "Sign-in URL ready. Open it, then paste the redirected callback URL.";
    }
  } catch (error) {
    if (chatgptOauthStatusEl) {
      chatgptOauthStatusEl.textContent =
        error instanceof Error ? error.message : "Could not start account login";
    }
  } finally {
    chatgptOauthStartBtnEl.disabled = !chatgptOauthState.enabled;
    chatgptOauthStartBtnEl.textContent = "Start login";
  }
}

async function submitChatGptOauthCallback() {
  const redirectUrl = chatgptOauthCallbackInputEl?.value.trim() || "";
  if (!redirectUrl) {
    if (chatgptOauthStatusEl) {
      chatgptOauthStatusEl.textContent = "Paste the callback URL first.";
    }
    return;
  }

  if (chatgptOauthSubmitBtnEl) {
    chatgptOauthSubmitBtnEl.disabled = true;
    chatgptOauthSubmitBtnEl.textContent = "Connecting...";
  }
  if (chatgptOauthStatusEl) {
    chatgptOauthStatusEl.textContent = "Exchanging callback code...";
  }

  try {
    const response = await fetch("/api/chatgpt-oauth/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirectUrl }),
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error?.message || "Could not connect account");
    }
    chatgptOauthState = {
      ...chatgptOauthState,
      enabled: true,
      accounts: Array.isArray(data.accounts) ? data.accounts : chatgptOauthState.accounts,
      authUrl: "",
    };
    if (chatgptOauthCallbackInputEl) {
      chatgptOauthCallbackInputEl.value = "";
    }
    await refreshProviders();
    if (chatgptOauthStatusEl) {
      chatgptOauthStatusEl.textContent = "Account connected.";
    }
  } catch (error) {
    if (chatgptOauthStatusEl) {
      chatgptOauthStatusEl.textContent =
        error instanceof Error ? error.message : "Could not connect account";
    }
  } finally {
    if (chatgptOauthSubmitBtnEl) {
      chatgptOauthSubmitBtnEl.disabled = !chatgptOauthState.enabled;
      chatgptOauthSubmitBtnEl.textContent = "Connect account";
    }
  }
}

async function updateChatGptOauthRotationMode() {
  const rotationMode = chatgptOauthRotationModeEl?.value || "round_robin";
  const saveId = ++chatgptOauthRotationSaveId;
  if (chatgptOauthRotationModeEl) {
    chatgptOauthRotationModeEl.disabled = true;
  }
  if (chatgptOauthStatusEl) {
    chatgptOauthStatusEl.textContent = "Saving account rotation...";
  }
  try {
    const response = await fetch("/api/chatgpt-oauth/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rotationMode }),
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error?.message || "Could not save account rotation");
    }
    if (saveId === chatgptOauthRotationSaveId) {
      chatgptOauthState = {
        ...chatgptOauthState,
        rotationMode: data.rotationMode || rotationMode,
        accounts: Array.isArray(data.accounts) ? data.accounts : chatgptOauthState.accounts,
      };
      renderChatGptOauthPanel();
      if (chatgptOauthStatusEl) {
        chatgptOauthStatusEl.textContent = `Account rotation saved: ${chatgptOauthState.rotationMode}`;
      }
    }
  } catch (error) {
    if (saveId === chatgptOauthRotationSaveId && chatgptOauthStatusEl) {
      chatgptOauthStatusEl.textContent =
        error instanceof Error ? error.message : "Could not save account rotation";
    }
    if (saveId === chatgptOauthRotationSaveId) {
      renderChatGptOauthPanel();
    }
  } finally {
    if (saveId === chatgptOauthRotationSaveId && chatgptOauthRotationModeEl) {
      chatgptOauthRotationModeEl.disabled = !chatgptOauthState.enabled;
    }
  }
}

async function refreshChatGptOauthAccount(accountId) {
  if (chatgptOauthStatusEl) {
    chatgptOauthStatusEl.textContent = "Refreshing account...";
  }
  try {
    const response = await fetch(
      `/api/account-auth/accounts/${encodeURIComponent(accountId)}/refresh`,
      { method: "POST" },
    );
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error?.message || "Refresh failed");
    }
    await refreshProviders();
    if (chatgptOauthStatusEl) {
      chatgptOauthStatusEl.textContent = "Account refreshed.";
    }
  } catch (error) {
    if (chatgptOauthStatusEl) {
      chatgptOauthStatusEl.textContent = error instanceof Error ? error.message : "Refresh failed";
    }
  }
}

async function toggleChatGptOauthAccount(accountId, disabled) {
  if (chatgptOauthStatusEl) {
    chatgptOauthStatusEl.textContent = disabled ? "Enabling account..." : "Disabling account...";
  }
  try {
    const response = await fetch(
      `/api/account-auth/accounts/${encodeURIComponent(accountId)}/${disabled ? "enable" : "disable"}`,
      { method: "POST" },
    );
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error?.message || "Update failed");
    }
    chatgptOauthState = {
      ...chatgptOauthState,
      accounts: Array.isArray(data.accounts) ? data.accounts : chatgptOauthState.accounts,
    };
    await refreshProviders();
    if (chatgptOauthStatusEl) {
      chatgptOauthStatusEl.textContent = disabled ? "Account enabled." : "Account disabled.";
    }
  } catch (error) {
    if (chatgptOauthStatusEl) {
      chatgptOauthStatusEl.textContent = error instanceof Error ? error.message : "Update failed";
    }
  }
}

async function deleteChatGptOauthAccount(accountId, label) {
  const confirmed = window.confirm(`Delete connected account "${label}"?`);
  if (!confirmed) {
    return;
  }
  if (chatgptOauthStatusEl) {
    chatgptOauthStatusEl.textContent = "Deleting account...";
  }
  try {
    const response = await fetch(`/api/account-auth/accounts/${encodeURIComponent(accountId)}`, {
      method: "DELETE",
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error?.message || "Delete failed");
    }
    chatgptOauthState = {
      ...chatgptOauthState,
      accounts: Array.isArray(data.accounts) ? data.accounts : [],
    };
    await refreshProviders();
    if (chatgptOauthStatusEl) {
      chatgptOauthStatusEl.textContent = "Account deleted.";
    }
  } catch (error) {
    if (chatgptOauthStatusEl) {
      chatgptOauthStatusEl.textContent = error instanceof Error ? error.message : "Delete failed";
    }
  }
}

async function refreshClientConfigStatus() {
  try {
    const response = await fetch("/api/client-configs/status", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error?.message || "Could not load client config status");
    }
    clientConfigState = data;
    if (data.runtime === "container") {
      const blocked = [data.clients?.hermes, data.clients?.codex].filter(
        (entry) => entry?.access?.canPatch === false,
      );
      if (blocked.length) {
        setQuickApplyStatus(blocked[0].access.reason, "warn");
      }
    }
  } catch (error) {
    clientConfigState = null;
    setQuickApplyStatus(error instanceof Error ? error.message : "Could not load client config status", "bad");
  }
  renderClientConfigStatus();
}

async function saveClientCrud() {
  const client = clientCrudNameEl?.value.trim() || "";
  const providerId = clientCrudProviderSelectEl?.value || "";
  const model = clientCrudModelEl?.value.trim() || "";
  const apiKeys = clientCrudApiKeysEl?.value || "";
  if (!client) {
    setClientCrudStatus("Client name is required.", "bad");
    return;
  }
  if (!apiKeys.split(/\r?\n|,/g).some((entry) => entry.trim())) {
    setClientCrudStatus("At least one client API key is required.", "bad");
    return;
  }
  const exists = (providerState.clientRoutes || []).some((route) => route.key === client);
  const editingExisting = selectedClientCrudKey && selectedClientCrudKey !== "__new__" && exists;
  const targetClient = editingExisting ? selectedClientCrudKey : client;
  saveClientCrudBtnEl.disabled = true;
  saveClientCrudBtnEl.textContent = "Saving...";
  setClientCrudStatus("");
  let savedClient = "";
  try {
    const response = await fetch(
      editingExisting ? `/api/clients/${encodeURIComponent(targetClient)}` : "/api/clients",
      {
        method: editingExisting ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client, providerId, model, apiKeys }),
      },
    );
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error?.message || "Could not save client");
    }
    if (Array.isArray(data.clientRoutes)) {
      providerState = {
        ...providerState,
        clientRoutes: data.clientRoutes,
        providerOptions: Array.isArray(data.providerOptions) ? data.providerOptions : providerState.providerOptions,
      };
    }
    savedClient = data.client || targetClient;
    selectedClientCrudKey = savedClient;
    renderClientConfigStatus();
    renderClientRoutePolicySection();
    setClientCrudStatus("Client saved.", "ok");
    if (currentRoute === ROUTES.clientEdit) {
      goToClientEditor(savedClient);
    }
  } catch (error) {
    setClientCrudStatus(error instanceof Error ? error.message : "Could not save client", "bad");
  } finally {
    saveClientCrudBtnEl.disabled = false;
    setClientCrudFormMode(savedClient || editingExisting ? "edit" : "create", savedClient || targetClient);
  }
}

async function deleteClientCrud(clientOverride = "") {
  const client = clientOverride || selectedClientCrudKey;
  if (!client || client === "__new__" || client === "default") {
    return;
  }
  const confirmed = window.confirm(`Delete client "${client}"?`);
  if (!confirmed) return;
  deleteClientCrudBtnEl.disabled = true;
  setClientCrudStatus("Deleting client...");
  try {
    const response = await fetch(`/api/clients/${encodeURIComponent(client)}`, {
      method: "DELETE",
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error?.message || "Could not delete client");
    }
    providerState = {
      ...providerState,
      clientRoutes: Array.isArray(data.clientRoutes) ? data.clientRoutes : providerState.clientRoutes,
      providerOptions: Array.isArray(data.providerOptions) ? data.providerOptions : providerState.providerOptions,
    };
    selectedClientCrudKey = "";
    renderClientConfigStatus();
    renderClientRoutePolicySection();
    setClientCrudStatus("Client deleted.", "ok");
    if (currentRoute === ROUTES.clientEdit) {
      window.location.hash = "#/clients";
    }
  } catch (error) {
    setClientCrudStatus(error instanceof Error ? error.message : "Could not delete client", "bad");
  } finally {
    deleteClientCrudBtnEl.disabled = false;
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

function renderLiveUsage() {
  const providers = Array.isArray(usageLiveState?.providers) ? usageLiveState.providers : [];
  if (usageProviderCountEl) usageProviderCountEl.textContent = formatNumber(providers.length);
  if (usageOkCountEl) {
    usageOkCountEl.textContent = formatNumber(
      providers.filter((entry) => entry.ok === true && entry.usage?.allowed !== false).length,
    );
  }
  if (usageUpdatedAtEl) {
    usageUpdatedAtEl.textContent = usageLiveState?.timestamp
      ? new Date(usageLiveState.timestamp).toLocaleTimeString()
      : "-";
  }
  if (usageRawEl) {
    usageRawEl.textContent = JSON.stringify(usageLiveState || {}, null, 2);
  }
  if (!usageLiveTableBodyEl) return;

  usageLiveTableBodyEl.innerHTML = "";
  if (!providers.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="5" class="mono">No provider usage data yet</td>';
    usageLiveTableBodyEl.appendChild(row);
    return;
  }

  for (const entry of providers) {
    const usage = entry.usage || {};
    const source =
      entry.source === "openai_organization_usage"
        ? "OpenAI Usage API"
        : entry.configured
          ? "Provider usage URL"
          : "Not configured";
    const status = entry.ok
      ? usage.allowed === false
        ? "Blocked"
        : "Usable"
      : entry.error || "Unavailable";
    const row = document.createElement("tr");
    row.innerHTML =
      `<td><strong>${escapeHtml(entry.providerName || entry.providerId || "-")}</strong><div class="meta mono">${escapeHtml(entry.providerId || "-")}</div></td>` +
      `<td>${escapeHtml(source)}</td>` +
      `<td><span class="provider-badge">${escapeHtml(status)}</span></td>` +
      `<td>${usage.remaining ?? "unknown"}</td>` +
      `<td>${usage.used !== undefined || usage.limit !== undefined ? `${usage.used ?? "?"} / ${usage.limit ?? "?"}` : "unknown"}</td>`;
    usageLiveTableBodyEl.appendChild(row);
  }
}

async function refreshLiveUsage() {
  if (currentRoute !== ROUTES.usage) {
    return;
  }
  if (usageLiveStatusEl) {
    usageLiveStatusEl.textContent = "Refreshing...";
  }
  try {
    const response = await fetch("/api/providers/live-usage", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error?.message || "Could not load live usage");
    }
    usageLiveState = data;
    if (usageLiveStatusEl) {
      usageLiveStatusEl.textContent = "Live";
    }
  } catch (error) {
    usageLiveState = {
      timestamp: new Date().toISOString(),
      providers: [],
      error: error instanceof Error ? error.message : "Could not load live usage",
    };
    if (usageLiveStatusEl) {
      usageLiveStatusEl.textContent = "Error";
    }
  }
  renderLiveUsage();
}

function syncUsageLivePolling() {
  if (usageLiveTimerId) {
    window.clearInterval(usageLiveTimerId);
    usageLiveTimerId = 0;
  }
  if (currentRoute !== ROUTES.usage) {
    if (usageLiveStatusEl) {
      usageLiveStatusEl.textContent = "Idle";
    }
    return;
  }
  void refreshLiveUsage();
  usageLiveTimerId = window.setInterval(() => {
    void refreshLiveUsage();
  }, 15000);
}

async function refreshDashboard() {
  await refreshProviders();
  await refreshCacheSnapshot("");
  await refreshUsageStats();
  await refreshClientConfigStatus();
}

async function refreshClientsScreen() {
  await refreshProviders();
  await refreshClientConfigStatus();
  renderClientConfigStatus();
}

async function refreshClientEditScreen() {
  await refreshProviders();
  await refreshClientConfigStatus();
  hydrateClientEditorFromRoute(normalizeRoute().query);
}

async function refreshConfigHelperScreen() {
  await refreshProviders();
  await refreshClientConfigStatus();
  renderClientConfigStatus();
}

async function refreshActiveRoute() {
  if (currentRoute === ROUTES.dashboard) {
    await refreshDashboard();
    return;
  }
  if (currentRoute === ROUTES.clients) {
    await refreshClientsScreen();
    return;
  }
  if (currentRoute === ROUTES.clientEdit) {
    await refreshClientEditScreen();
    return;
  }
  if (currentRoute === ROUTES.configHelper) {
    await refreshConfigHelperScreen();
    return;
  }
  if (currentRoute === ROUTES.oauth) {
    await refreshProviders();
    return;
  }
  if (currentRoute === ROUTES.authManagement) {
    await refreshProviders();
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
  if (currentRoute === ROUTES.usage) {
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

providerSearchInputEl?.addEventListener("input", () => {
  providerSearchTerm = providerSearchInputEl.value || "";
  renderProviderCrudList();
});

clientSearchInputEl?.addEventListener("input", () => {
  clientSearchTerm = clientSearchInputEl.value || "";
  renderClientCrud();
});

chatgptOauthStartBtnEl?.addEventListener("click", () => {
  void startChatGptOauthLogin();
});

chatgptOauthCopyLinkBtnEl?.addEventListener("click", () => {
  void copyTextWithButton(chatgptOauthCopyLinkBtnEl, chatgptOauthState.authUrl, {
    idleLabel: "Copy",
    emptyLabel: "No URL",
    copiedLabel: "Copied",
    selectLabel: "Select",
  });
});

chatgptOauthSubmitBtnEl?.addEventListener("click", () => {
  void submitChatGptOauthCallback();
});

chatgptOauthRotationModeEl?.addEventListener("change", () => {
  void updateChatGptOauthRotationMode();
});

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
    setProviderMeta(error instanceof Error ? error.message : "Could not save RTK policy");
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
    setProviderMeta(error instanceof Error ? error.message : "Could not clear RTK policy");
  } finally {
    clearClientRtkPolicyBtnEl.disabled = false;
  }
});

saveClientCrudBtnEl?.addEventListener("click", () => {
  void saveClientCrud();
});

clearClientCrudBtnEl?.addEventListener("click", () => {
  clearClientCrudForm();
});

deleteClientCrudBtnEl?.addEventListener("click", () => {
  void deleteClientCrud();
});

async function applyClientQuickConfig(
  client,
  buttonEl,
  baseUrlInputEl,
  apiKeySelectEl,
  modelSelectEl,
) {
  buttonEl.disabled = true;
  const originalLabel = buttonEl.textContent;
  buttonEl.textContent = "Applying...";
  setQuickApplyStatus("");
  try {
    const response = await fetch("/api/client-configs/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client,
        baseUrl: baseUrlInputEl?.value.trim() || undefined,
        routeApiKey: apiKeySelectEl?.value || undefined,
        model: modelSelectEl?.value || undefined,
      }),
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error?.message || `Could not apply ${client} config`);
    }
    clientConfigState = {
      providerOptions: clientConfigState?.providerOptions || providerState.providerOptions || [],
      proxyBaseUrl: data.proxyBaseUrl,
      clients: {
        ...(clientConfigState?.clients || {}),
        [client]: data.status,
      },
    };
    if (Array.isArray(data.clientRoutes)) {
      providerState = {
        ...providerState,
        clientRoutes: data.clientRoutes,
      };
    }
    renderClientConfigStatus();
    renderProviderCrudList();
    renderClientRoutePolicySection();
    setQuickApplyStatus(
      `${client} config applied. Backup created with a timestamp before patching.`,
      "ok",
    );
  } catch (error) {
    setQuickApplyStatus(error instanceof Error ? error.message : `Could not apply ${client} config`, "bad");
  } finally {
    buttonEl.disabled = false;
    buttonEl.textContent = originalLabel;
  }
}

applyHermesConfigBtnEl?.addEventListener("click", async () => {
  await applyClientQuickConfig(
    "hermes",
    applyHermesConfigBtnEl,
    hermesBaseUrlInputEl,
    hermesConfigApiKeySelectEl,
    hermesConfigModelSelectEl,
  );
});

hermesConfigApiKeySelectEl?.addEventListener("change", () => {
  loadClientConfigModelsForSelection("hermes", hermesConfigApiKeySelectEl.value || "");
});

hermesConfigModelSelectEl?.addEventListener("change", () => {
  clientConfigModelSelections.hermes = hermesConfigModelSelectEl.value || "";
});

applyCodexConfigBtnEl?.addEventListener("click", async () => {
  await applyClientQuickConfig(
    "codex",
    applyCodexConfigBtnEl,
    codexBaseUrlInputEl,
    codexConfigApiKeySelectEl,
    codexConfigModelSelectEl,
  );
});

codexConfigApiKeySelectEl?.addEventListener("change", () => {
  loadClientConfigModelsForSelection("codex", codexConfigApiKeySelectEl.value || "");
});

codexConfigModelSelectEl?.addEventListener("change", () => {
  clientConfigModelSelections.codex = codexConfigModelSelectEl.value || "";
});

customProviderBtnEl.addEventListener("click", async () => {
  if (!validateProviderModelAliases()) {
    setProviderEditorStatus("Fix duplicate model aliases before saving.", "bad");
    return;
  }
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
    providerEditorDirty = false;
    await refreshProviders();
    setProviderEditorStatus("Provider saved successfully.", "ok");
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
  markProviderEditorDirty();
  renderProviderEditorSummary();
  const inputs = providerApiKeysListEl.querySelectorAll(".provider-api-key-input");
  const lastInput = inputs[inputs.length - 1];
  lastInput?.focus();
});

addClientApiKeyBtnEl.addEventListener("click", () => {
  appendClientApiKeyInput("");
  syncClientApiKeyRemoveButtons();
  markProviderEditorDirty();
  renderProviderEditorSummary();
  const inputs = clientApiKeysListEl.querySelectorAll(".client-api-key-input");
  const lastInput = inputs[inputs.length - 1];
  lastInput?.focus();
});

addProviderModelAliasBtnEl?.addEventListener("click", () => {
  appendProviderModelAliasInput("", "");
  syncProviderModelAliasRemoveButtons();
  markProviderEditorDirty();
  renderProviderEditorSummary();
  const inputs = providerModelAliasesListEl.querySelectorAll(".provider-model-alias-source");
  const lastInput = inputs[inputs.length - 1];
  lastInput?.focus();
});

addProviderErrorRuleBtnEl?.addEventListener("click", () => {
  appendProviderErrorRuleInput({});
  syncProviderErrorRuleRemoveButtons();
  syncProviderErrorRuleTitles();
  markProviderEditorDirty();
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
  providerModelAliasesListEl,
  providerRtkEnabledEl,
  providerRtkToolOutputEnabledEl,
  providerRtkMaxCharsEl,
  providerRtkMaxLinesEl,
  providerRtkTailLinesEl,
  providerRtkTailCharsEl,
  providerRtkDetectFormatEl,
].forEach((element) => {
  element?.addEventListener("input", () => {
    markProviderEditorDirty();
    renderProviderEditorSummary();
  });
  element?.addEventListener("change", () => {
    markProviderEditorDirty();
    renderProviderEditorSummary();
  });
});

providerDeleteBtnEl.addEventListener("click", async () => {
  const providerId = providerEditorIdEl.value.trim();
  if (!providerId) return;
  const impactedRoutes = (providerState.clientRoutes || [])
    .filter((route) => route.providerId === providerId)
    .map((route) => route.key);
  const impactMessage = impactedRoutes.length
    ? `This will remove provider routing for: ${impactedRoutes.join(", ")}.`
    : "This provider is not assigned to any client.";
  const confirmed = window.confirm(
    `Delete provider "${customProviderNameEl.value.trim() || providerId}"?\n\n${impactMessage}`,
  );
  if (!confirmed) {
    return;
  }
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
    providerEditorDirty = false;
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
renderProviderEditorSummary();
setRoute(normalizeRoute());
setInterval(() => {
  if (shouldSkipBackgroundRefresh()) {
    return;
  }
  refreshActiveRoute();
}, 5000);
