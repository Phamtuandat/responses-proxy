import os from "node:os";
import path from "node:path";
import { z } from "zod";

function defaultKiroDbPath(): string {
  return path.join(os.homedir(), ".9router", "db", "data.sqlite");
}

function parseIdList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,\r?\n]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseDelimitedList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,\r?\n]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8318),
  HOST: z.string().min(1).default("0.0.0.0"),
  UPSTREAM_BASE_URL: z.url(),
  UPSTREAM_API_KEY: z.string().optional(),
  PROVIDER_USAGE_CHECK_URL: z
    .string()
    .optional()
    .transform((value) => (value?.trim() ? value.trim() : undefined))
    .pipe(z.url().optional()),
  PROVIDER_USAGE_CHECK_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  SUMMARY_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(900_000),
  STREAM_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(330_000),
  HERMES_EXTEND_SUMMARY_TIMEOUT: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  REQUEST_BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  HTTP_TRUST_PROXY: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  HTTP_RATE_LIMIT_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  HTTP_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  HTTP_RATE_LIMIT_RESPONSES_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  HTTP_RATE_LIMIT_UNAUTHENTICATED_MAX_REQUESTS: z.coerce.number().int().positive().default(20),
  HTTP_RATE_LIMIT_AUTH_MAX_REQUESTS: z.coerce.number().int().positive().default(30),
  HTTP_RATE_LIMIT_WEBHOOK_MAX_REQUESTS: z.coerce.number().int().positive().default(60),
  HTTP_RATE_LIMIT_HEALTH_MAX_REQUESTS: z.coerce.number().int().positive().default(240),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  LOG_BODY: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  CHATGPT_OAUTH_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  MODEL_ROUTING_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  MODEL_ROUTING_CHEAP_MODEL: z.string().optional().default("gpt-4o-mini"),
  MODEL_ROUTING_INPUT_TOKEN_THRESHOLD: z.coerce.number().int().positive().default(2000),
  MODEL_ROUTING_SKIP_IF_TOOLS: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  MODEL_ROUTING_SKIP_IF_IMAGES: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  MODEL_ROUTING_SKIP_IF_REASONING: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  CHATGPT_OAUTH_CLIENT_ID: z.string().min(1).default("app_EMoamEEZ73f0CkXaXp7hrann"),
  CHATGPT_OAUTH_REDIRECT_URI: z
    .string()
    .min(1)
    .default("http://localhost:1455/auth/callback"),
  CHATGPT_OAUTH_CALLBACK_PORT: z.coerce.number().int().positive().default(1455),
  CHATGPT_OAUTH_AUTH_URL: z
    .string()
    .min(1)
    .default("https://auth.openai.com/oauth/authorize")
    .pipe(z.url()),
  CHATGPT_OAUTH_TOKEN_URL: z
    .string()
    .min(1)
    .default("https://auth.openai.com/oauth/token")
    .pipe(z.url()),
  CHATGPT_OAUTH_DEVICE_USER_CODE_URL: z
    .string()
    .min(1)
    .default("https://auth.openai.com/api/accounts/deviceauth/usercode")
    .pipe(z.url()),
  CHATGPT_OAUTH_DEVICE_TOKEN_URL: z
    .string()
    .min(1)
    .default("https://auth.openai.com/api/accounts/deviceauth/token")
    .pipe(z.url()),
  CHATGPT_OAUTH_DEVICE_VERIFICATION_URL: z
    .string()
    .min(1)
    .default("https://auth.openai.com/codex/device")
    .pipe(z.url()),
  CHATGPT_CODEX_BASE_URL: z
    .string()
    .min(1)
    .default("https://chatgpt.com/backend-api/codex")
    .pipe(z.url()),
  RESPONSES_PROXY_DEFAULT_MODEL: z.string().default("gpt-5.5"),
  BOT_PUBLIC_RESPONSES_BASE_URL: z.string().optional(),
  CHATGPT_OAUTH_REFRESH_LEAD_DAYS: z.coerce.number().positive().default(5),
  OPENCLAW_TOKEN_OPTIMIZATION_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  OPENCLAW_DEFAULT_REASONING_SUMMARY: z
    .enum(["auto", "none", "concise", "detailed"])
    .default("auto"),
  OPENCLAW_DEFAULT_REASONING_EFFORT: z
    .enum(["minimal", "low", "medium", "high"])
    .default("low"),
  OPENCLAW_DEFAULT_TEXT_VERBOSITY: z
    .enum(["low", "medium", "high"])
    .default("low"),
  OPENCLAW_DEFAULT_MAX_OUTPUT_TOKENS: z
    .string()
    .optional()
    .transform((value) => {
      if (!value?.trim()) {
        return undefined;
      }
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
    }),
  OPENCLAW_AUTO_PROMPT_CACHE_KEY: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  OPENCLAW_PROMPT_CACHE_RETENTION: z.string().min(1).default("24h"),
  RESPONSE_CACHE_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  RESPONSE_CACHE_TTL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
  RESPONSE_CACHE_MAX_PAYLOAD_BYTES: z.coerce.number().int().positive().default(512 * 1024),
  PROVIDER_PROMPT_CACHE_REDESIGN_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  PROVIDER_PROMPT_CACHE_STABLE_SUMMARIZATION_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  PROVIDER_PROMPT_CACHE_INFLIGHT_DEDUPE_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  PROVIDER_PROMPT_CACHE_RETENTION_BY_FAMILY_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  PROVIDER_PROMPT_CACHE_SUMMARY_TRIGGER_ITEMS: z.coerce.number().int().positive().default(14),
  PROVIDER_PROMPT_CACHE_SUMMARY_KEEP_RECENT_ITEMS: z.coerce.number().int().positive().default(6),
  PROVIDER_PROMPT_CACHE_RETENTION_BY_FAMILY: z
    .string()
    .optional()
    .transform(parsePromptCacheFamilyRetentionRules),
  PROVIDER_PROMPT_CACHE_RETENTION_BY_STATIC_KEY_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  PROVIDER_PROMPT_CACHE_RETENTION_BY_STATIC_KEY: z
    .string()
    .optional()
    .transform(parsePromptCacheFamilyRetentionRules),
  RTK_LAYER_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  RTK_LAYER_TOOL_OUTPUT_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  RTK_LAYER_TOOL_OUTPUT_MAX_CHARS: z.coerce.number().int().positive().default(4000),
  RTK_LAYER_TOOL_OUTPUT_MAX_LINES: z.coerce.number().int().positive().default(120),
  RTK_LAYER_TOOL_OUTPUT_TAIL_LINES: z.coerce.number().int().nonnegative().default(0),
  RTK_LAYER_TOOL_OUTPUT_TAIL_CHARS: z.coerce.number().int().nonnegative().default(0),
  RTK_LAYER_TOOL_OUTPUT_DETECT_FORMAT: z
    .enum(["auto", "plain", "json", "stack", "command"])
    .default("auto"),
  OPENCLAW_DEFAULT_TRUNCATION: z.enum(["auto", "disabled"]).default("auto"),
  MAX_OUTPUT_TOKENS_PARAMETER_MODE_FOR_PROVIDER: z
    .enum(["forward", "strip", "rename"])
    .optional(),
  MAX_OUTPUT_TOKENS_PARAMETER_TARGET_FOR_PROVIDER: z.string().optional(),
  STRIP_MAX_OUTPUT_TOKENS_FOR_PROVIDER: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  SANITIZE_REASONING_SUMMARY_FOR_PROVIDER: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  FALLBACK_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  FALLBACK_STATUS_CODES: z
    .string()
    .default("429,500,502,503,504")
    .transform(parseFallbackStatusCodes),
  RESPONSES_PROXY_CLIENT_API_KEY: z.string().optional(),
  DASHBOARD_PASSWORD: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_OWNER_USER_IDS: z.string().optional().transform(parseIdList),
  TELEGRAM_ADMIN_USER_IDS: z.string().optional().transform(parseIdList),
  DASHBOARD_AUTH_OTP_TTL_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  DASHBOARD_AUTH_SESSION_TTL_MS: z.coerce.number().int().positive().default(12 * 60 * 60 * 1000),
  APP_DB_PATH: z.string().min(1).default("./logs/app.sqlite"),
  CUSTOMER_KEY_DB_PATH: z.string().min(1).default("./logs/telegram-bot.sqlite"),
  SESSION_LOG_DIR: z.string().min(1).default("./logs/sessions"),
  SESSION_LOG_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(14),
  SEPAY_WEBHOOK_ENABLED: z
    .string()
    .optional()
    .transform((value) => {
      const normalized = value?.trim().toLowerCase();
      return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
    }),
  SEPAY_WEBHOOK_SECRET: z.string().optional(),
  SEPAY_WEBHOOK_ALLOWED_IPS: z.string().optional().transform(parseDelimitedList),
  KIRO_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  KIRO_DB_PATH: z
    .string()
    .optional()
    .transform((value) => (value?.trim() ? value.trim() : defaultKiroDbPath())),
  KIRO_DEFAULT_REGION: z.string().min(1).default("us-east-1"),
  KIRO_REFRESH_LEAD_SECONDS: z.coerce.number().int().nonnegative().default(120),
  KIRO_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(8).default(5),
  KIRO_RETRY_BASE_DELAY_MS: z.coerce.number().int().nonnegative().default(1000),
  KIRO_RETRY_MAX_DELAY_MS: z.coerce.number().int().nonnegative().default(15000),
  // Short-circuit Claude Code CLI housekeeping requests (title/warmup/count/
  // topic-naming) locally instead of forwarding them to Kiro, cutting upstream
  // load and 429 throttling. Mirrors 9router's bypass handler.
  KIRO_CLI_BYPASS_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  KIRO_CLI_BYPASS_NAMING: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  KIRO_WRITE_BACK_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  KIRO_DEVICE_CLIENT_NAME: z.string().min(1).default("responses-proxy"),
  KIRO_BUILDER_ID_START_URL: z.string().min(1).default("https://view.awsapps.com/start"),
  KIRO_DEVICE_SCOPES: z
    .string()
    .min(1)
    .default("codewhisperer:completions,codewhisperer:analysis")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),

  // Routing System Configuration
  ROUTING_HEALTH_CHECK_INTERVAL: z.coerce.number().int().positive().default(30000), // 30 seconds
  ROUTING_WEBSOCKET_BROADCAST_INTERVAL: z.coerce.number().int().positive().default(5000), // 5 seconds
  ROUTING_PROVIDER_HEALTH_CACHE_TTL: z.coerce.number().int().positive().default(60000), // 1 minute
  ROUTING_HEALTH_SCORE_THRESHOLD: z.coerce.number().int().min(0).max(100).default(50), // Minimum eligibility score
  ROUTING_MAX_FALLBACK_DELAY: z.coerce.number().int().nonnegative().default(10000), // 10 seconds max delay
  ROUTING_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"), // Enable routing system by default
});

export type AppConfig = z.infer<typeof envSchema> & {
  upstreamResponsesUrl: string;
  publicResponsesBaseUrl: string;
  PROVIDER_USAGE_CHECK_URL?: string;
};

export function readConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.parse(env);
  const base = parsed.UPSTREAM_BASE_URL.replace(/\/+$/, "");
  const publicResponsesBaseUrl =
    parsed.BOT_PUBLIC_RESPONSES_BASE_URL?.trim().replace(/\/+$/, "") ||
    `http://127.0.0.1:${parsed.PORT}/v1`;

  return {
    ...parsed,
    upstreamResponsesUrl: `${base}/responses`,
    publicResponsesBaseUrl,
  };
}

function parsePromptCacheFamilyRetentionRules(
  raw: string | undefined,
): Array<{ prefix: string; retention: string }> {
  if (!raw?.trim()) {
    return [];
  }

  return raw
    .split(",")
    .map((entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        return undefined;
      }
      const prefix = entry.slice(0, separatorIndex).trim();
      const retention = entry.slice(separatorIndex + 1).trim();
      if (!prefix || !retention) {
        return undefined;
      }
      return {
        prefix,
        retention,
      };
    })
    .filter((entry): entry is { prefix: string; retention: string } => Boolean(entry));
}

function parseFallbackStatusCodes(raw: string): number[] {
  const codes = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value >= 400 && value <= 599);

  return codes.length > 0 ? codes : [429, 500, 502, 503, 504];
}
