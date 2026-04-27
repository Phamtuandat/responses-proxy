import { createTelegramBot } from "./telegram-adapter.js";
import { readTelegramBotConfig } from "./config.js";
import { ResponsesProxyClient } from "./proxy-client.js";

const config = readTelegramBotConfig(process.env);
const proxyClient = new ResponsesProxyClient(
  config.proxyAdminBaseUrl,
  config.proxyClientApiKey,
  config.proxyRequestTimeoutMs,
);

if (config.botMode === "webhook") {
  throw new Error("Webhook mode is not implemented yet. Use TELEGRAM_BOT_MODE=polling.");
}

type TelegramBot = ReturnType<typeof createTelegramBot>;

let stopping = false;
let activeBot: TelegramBot | undefined;

async function registerCommandMetadata(bot: TelegramBot): Promise<void> {
  await bot.api.setMyCommands([
    { command: "status", description: "Check proxy health and active provider" },
    { command: "providers", description: "Show providers and route mapping" },
    { command: "clients", description: "Show Hermes and Codex client status" },
    { command: "models", description: "List models through the proxy" },
    { command: "apply", description: "Apply proxy config to Hermes or Codex" },
    { command: "oauth", description: "Start or inspect ChatGPT OAuth setup" },
    { command: "accounts", description: "Manage OAuth accounts" },
    { command: "grant", description: "Grant paid customer access manually" },
    { command: "renewuser", description: "Renew customer access or replace customer key" },
    { command: "renew", description: "Create or manage renewal requests" },
    { command: "apikey", description: "Show or issue customer Responses API keys" },
    { command: "usage", description: "Show customer token usage for the current period" },
    { command: "quota", description: "Show customer quota, remaining balance, and expiration" },
    { command: "test", description: "Send a small Responses API test request" },
    { command: "help", description: "Show bot help" },
  ]);
}

const stopBot = (signal: NodeJS.Signals) => {
  if (stopping) {
    return;
  }
  stopping = true;
  console.info(`telegram bot stopping on ${signal}`);
  activeBot?.stop();
};

process.once("SIGINT", () => stopBot("SIGINT"));
process.once("SIGTERM", () => stopBot("SIGTERM"));

while (!stopping) {
  const bot = createTelegramBot({ config, proxyClient });
  activeBot = bot;

  try {
    await registerCommandMetadata(bot);
  } catch (error) {
    console.warn("telegram bot could not register command metadata", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    console.info("telegram bot starting in polling mode");
    await bot.start();
    break;
  } catch (error) {
    if (stopping) {
      break;
    }
    if (isTelegramPollingConflict(error)) {
      console.warn("telegram polling conflict; retrying after 35 seconds", {
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(35_000);
      continue;
    }
    throw error;
  }
}

console.info("telegram bot stopped");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTelegramPollingConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as {
    method?: unknown;
    error_code?: unknown;
    description?: unknown;
  };
  const description =
    typeof candidate.description === "string" ? candidate.description : "";

  return (
    candidate.method === "getUpdates" &&
    candidate.error_code === 409 &&
    description.includes("Conflict")
  );
}
