import { z } from "zod";
import {
  readCodexProviderFromConfig,
  resolveDefaultCodexConfigPath,
} from "./codex-config.js";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8318),
  HOST: z.string().min(1).default("0.0.0.0"),
  UPSTREAM_BASE_URL: z.url(),
  UPSTREAM_API_KEY: z.string().optional(),
  KROUTER_USAGE_CHECK_URL: z.url().default("https://krouter.net/api/keys/check-usage"),
  KROUTER_USAGE_CHECK_ENABLED: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  STREAM_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(330_000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  LOG_BODY: z
    .string()
    .optional()
    .transform((value) => value === "true"),
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
  OPENCLAW_DEFAULT_TRUNCATION: z.enum(["auto", "disabled"]).default("auto"),
  STRIP_MAX_OUTPUT_TOKENS_FOR_KROUTER: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  SANITIZE_REASONING_SUMMARY_FOR_KROUTER: z
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
  FALLBACK_CODEX_CONFIG_PATH: z
    .string()
    .min(1)
    .default(resolveDefaultCodexConfigPath()),
  APP_DB_PATH: z.string().min(1).default("./logs/app.sqlite"),
  SESSION_LOG_DIR: z.string().min(1).default("./logs/sessions"),
  SESSION_LOG_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(14),
  DEFAULT_MODEL_CONTEXT_LENGTH: z.coerce.number().int().positive().default(256_000),
  MODEL_CONTEXT_LENGTH_MAP: z
    .string()
    .default(
      "cx/gpt-5.4=1000000,gpt-5.4=1000000,cx/gpt-5.4-xhigh=1000000,gpt-5.4-xhigh=1000000,cx/gpt-5.4-mini=256000,gpt-5.4-mini=256000",
    )
    .transform(parseModelContextLengthMap),
});

export type AppConfig = z.infer<typeof envSchema> & {
  upstreamResponsesUrl: string;
  fallback?: {
    name: string;
    responsesUrl: string;
  };
};

export function readConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.parse(env);
  const base = parsed.UPSTREAM_BASE_URL.replace(/\/+$/, "");
  const codexProvider = parsed.FALLBACK_ENABLED
    ? readCodexProviderFromConfig(parsed.FALLBACK_CODEX_CONFIG_PATH)
    : undefined;
  const fallbackBase =
    codexProvider?.wireApi === "responses"
      ? codexProvider.baseUrl.replace(/\/+$/, "")
      : undefined;
  const fallback =
    fallbackBase && fallbackBase !== base
      ? {
          name: codexProvider?.name ?? "codex-fallback",
          responsesUrl: `${fallbackBase}/responses`,
        }
      : undefined;

  return {
    ...parsed,
    upstreamResponsesUrl: `${base}/responses`,
    fallback,
  };
}

function parseFallbackStatusCodes(raw: string): number[] {
  const codes = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value >= 400 && value <= 599);

  return codes.length > 0 ? codes : [429, 500, 502, 503, 504];
}

function parseModelContextLengthMap(raw: string): Record<string, number> {
  const entries = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        return undefined;
      }
      const model = entry.slice(0, separatorIndex).trim();
      const value = Number(entry.slice(separatorIndex + 1).trim());
      if (!model || !Number.isInteger(value) || value <= 0) {
        return undefined;
      }
      return [model, value] as const;
    })
    .filter((entry): entry is readonly [string, number] => Array.isArray(entry));

  return Object.fromEntries(entries);
}
