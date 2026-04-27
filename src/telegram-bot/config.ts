import { z } from "zod";

function parseIdList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[,\r?\n]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) {
    return trimmed.slice(0, -3);
  }
  return trimmed;
}

const envBoolean = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      const normalized = value?.trim().toLowerCase();
      if (normalized === undefined || normalized === "") {
        return defaultValue;
      }
      return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
    });

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_ALLOWED_USER_IDS: z.string().optional(),
  TELEGRAM_ALLOWED_CHAT_IDS: z.string().optional(),
  TELEGRAM_OWNER_USER_IDS: z.string().optional(),
  TELEGRAM_ADMIN_USER_IDS: z.string().optional(),
  // Deprecated. Customers should be managed in the bot database, not in env.
  TELEGRAM_CUSTOMER_USER_IDS: z.string().optional(),
  TELEGRAM_BOT_MODE: z.enum(["polling", "webhook"]).default("polling"),
  TELEGRAM_WEBHOOK_URL: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  RESPONSES_PROXY_ADMIN_BASE_URL: z
    .string()
    .default("http://127.0.0.1:8318")
    .transform(normalizeBaseUrl),
  RESPONSES_PROXY_CLIENT_API_KEY: z.string().optional(),
  RESPONSES_PROXY_DEFAULT_MODEL: z.string().default("gpt-5.5"),
  BOT_PUBLIC_SIGNUP_ENABLED: envBoolean(false),
  BOT_REQUIRE_ADMIN_APPROVAL: envBoolean(true),
  BOT_DEFAULT_CUSTOMER_ROUTE: z.string().default("customers"),
  BOT_PUBLIC_RESPONSES_BASE_URL: z
    .string()
    .default("http://127.0.0.1:8318/v1")
    .transform((value) => value.trim().replace(/\/+$/, "")),
  BOT_PROXY_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  BOT_SESSION_DB_PATH: z.string().default("./logs/telegram-bot.sqlite"),
  BOT_SESSION_TTL_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  BOT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
  BOT_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(12),
  BOT_LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type TelegramBotConfig = {
  telegramBotToken: string;
  allowedUserIds: Set<string>;
  allowedChatIds: Set<string>;
  ownerUserIds: Set<string>;
  adminUserIds: Set<string>;
  botMode: "polling" | "webhook";
  webhookUrl?: string;
  webhookSecret?: string;
  proxyAdminBaseUrl: string;
  proxyClientApiKey?: string;
  defaultModel: string;
  publicSignupEnabled: boolean;
  requireAdminApproval: boolean;
  defaultCustomerRoute: string;
  publicResponsesBaseUrl: string;
  proxyRequestTimeoutMs: number;
  sessionDbPath: string;
  sessionTtlMs: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
};

export function readTelegramBotConfig(env: NodeJS.ProcessEnv): TelegramBotConfig {
  const parsed = envSchema.parse(env);
  return {
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    allowedUserIds: new Set(parseIdList(parsed.TELEGRAM_ALLOWED_USER_IDS)),
    allowedChatIds: new Set(parseIdList(parsed.TELEGRAM_ALLOWED_CHAT_IDS)),
    ownerUserIds: new Set(parseIdList(parsed.TELEGRAM_OWNER_USER_IDS)),
    adminUserIds: new Set(parseIdList(parsed.TELEGRAM_ADMIN_USER_IDS)),
    botMode: parsed.TELEGRAM_BOT_MODE,
    webhookUrl: parsed.TELEGRAM_WEBHOOK_URL?.trim() || undefined,
    webhookSecret: parsed.TELEGRAM_WEBHOOK_SECRET?.trim() || undefined,
    proxyAdminBaseUrl: parsed.RESPONSES_PROXY_ADMIN_BASE_URL,
    proxyClientApiKey: parsed.RESPONSES_PROXY_CLIENT_API_KEY?.trim() || undefined,
    defaultModel: parsed.RESPONSES_PROXY_DEFAULT_MODEL.trim(),
    publicSignupEnabled: parsed.BOT_PUBLIC_SIGNUP_ENABLED,
    requireAdminApproval: parsed.BOT_REQUIRE_ADMIN_APPROVAL,
    defaultCustomerRoute: normalizeRouteKey(parsed.BOT_DEFAULT_CUSTOMER_ROUTE),
    publicResponsesBaseUrl: parsed.BOT_PUBLIC_RESPONSES_BASE_URL,
    proxyRequestTimeoutMs: parsed.BOT_PROXY_REQUEST_TIMEOUT_MS,
    sessionDbPath: parsed.BOT_SESSION_DB_PATH.trim(),
    sessionTtlMs: parsed.BOT_SESSION_TTL_MS,
    rateLimitWindowMs: parsed.BOT_RATE_LIMIT_WINDOW_MS,
    rateLimitMaxRequests: parsed.BOT_RATE_LIMIT_MAX_REQUESTS,
    logLevel: parsed.BOT_LOG_LEVEL,
  };
}

function normalizeRouteKey(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "customers"
  );
}
