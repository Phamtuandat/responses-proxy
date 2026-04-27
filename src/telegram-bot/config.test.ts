import assert from "node:assert/strict";
import test from "node:test";
import { readTelegramBotConfig } from "./config.js";

test("readTelegramBotConfig supports legacy allowlist env", () => {
  const config = readTelegramBotConfig({
    TELEGRAM_BOT_TOKEN: "bot-token",
    TELEGRAM_ALLOWED_USER_IDS: "123,456",
    TELEGRAM_ADMIN_USER_IDS: "123",
  });

  assert.equal(config.telegramBotToken, "bot-token");
  assert.deepEqual([...config.allowedUserIds], ["123", "456"]);
  assert.deepEqual([...config.adminUserIds], ["123"]);
  assert.equal(config.publicSignupEnabled, false);
  assert.equal(config.requireAdminApproval, true);
});

test("readTelegramBotConfig supports public bot env without customer allowlist", () => {
  const config = readTelegramBotConfig({
    TELEGRAM_BOT_TOKEN: "bot-token",
    TELEGRAM_OWNER_USER_IDS: "1283361952",
    BOT_PUBLIC_SIGNUP_ENABLED: "true",
    BOT_REQUIRE_ADMIN_APPROVAL: "false",
    BOT_DEFAULT_CUSTOMER_ROUTE: "Paid Customers",
    BOT_PUBLIC_RESPONSES_BASE_URL: "https://proxy.example.com/v1/",
  });

  assert.deepEqual([...config.allowedUserIds], []);
  assert.deepEqual([...config.ownerUserIds], ["1283361952"]);
  assert.equal(config.publicSignupEnabled, true);
  assert.equal(config.requireAdminApproval, false);
  assert.equal(config.defaultCustomerRoute, "paid-customers");
  assert.equal(config.publicResponsesBaseUrl, "https://proxy.example.com/v1");
});

test("readTelegramBotConfig ignores deprecated customer env allowlist", () => {
  const config = readTelegramBotConfig({
    TELEGRAM_BOT_TOKEN: "bot-token",
    TELEGRAM_OWNER_USER_IDS: "1283361952",
    TELEGRAM_CUSTOMER_USER_IDS: "42,43",
    BOT_PUBLIC_SIGNUP_ENABLED: "true",
  });

  assert.deepEqual([...config.ownerUserIds], ["1283361952"]);
  assert.deepEqual([...config.allowedUserIds], []);
  assert.equal(config.publicSignupEnabled, true);
});
