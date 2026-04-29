import { z } from "zod";

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
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DASHBOARD_UI: z.enum(["react", "legacy"]).default("react"),
  LOG_BODY: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  CHATGPT_OAUTH_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),
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
  APP_DB_PATH: z.string().min(1).default("./logs/app.sqlite"),
  CUSTOMER_KEY_DB_PATH: z.string().min(1).default("./logs/telegram-bot.sqlite"),
  SESSION_LOG_DIR: z.string().min(1).default("./logs/sessions"),
  SESSION_LOG_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(14),
});

export type AppConfig = z.infer<typeof envSchema> & {
  upstreamResponsesUrl: string;
  PROVIDER_USAGE_CHECK_URL?: string;
};

export function readConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.parse(env);
  const base = parsed.UPSTREAM_BASE_URL.replace(/\/+$/, "");

  return {
    ...parsed,
    upstreamResponsesUrl: `${base}/responses`,
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
