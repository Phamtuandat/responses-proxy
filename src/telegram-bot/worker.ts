import { Bot } from "grammy";
import path from "node:path";
import { AuditLogRepository } from "../audit-log.js";
import { runBillingExpiration } from "../billing-expiration.js";
import { BillingRepository } from "../billing.js";
import { CustomerKeyRepository } from "../customer-keys.js";
import { CustomerWorkspaceRepository } from "./customer-workspace-repository.js";
import { readTelegramBotConfig } from "./config.js";

const config = readTelegramBotConfig(process.env);
const dbFile = path.resolve(config.sessionDbPath);
const billing = BillingRepository.create(dbFile);
const customerKeys = CustomerKeyRepository.create(dbFile);
const workspaces = CustomerWorkspaceRepository.create(dbFile);
const auditLog = AuditLogRepository.create(dbFile);
const bot = new Bot(config.telegramBotToken);

const intervalMs = readPositiveInteger(process.env.BOT_WORKER_INTERVAL_MS) ?? 60_000;
const runOnceOnly = readEnvBoolean(process.env.BOT_WORKER_ONCE);

let stopping = false;

process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

while (!stopping) {
  const startedAt = Date.now();
  const summary = await runBillingExpiration({
    billing,
    customerKeys,
    workspaces,
    auditLog,
    notifyCustomer: async ({ telegramUserId, text }) => {
      await bot.api.sendMessage(Number(telegramUserId), text);
    },
  });

  console.info("telegram billing worker cycle completed", {
    expiredEntitlements: summary.expiredEntitlements,
    suspendedWorkspaces: summary.suspendedWorkspaces,
    suspendedKeys: summary.suspendedKeys,
    notificationsSent: summary.notificationsSent,
    notificationsFailed: summary.notificationsFailed,
    totalMs: Date.now() - startedAt,
  });

  if (runOnceOnly || stopping) {
    break;
  }

  await sleep(intervalMs);
}

console.info("telegram billing worker stopped");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPositiveInteger(value: string | undefined): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readEnvBoolean(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}
