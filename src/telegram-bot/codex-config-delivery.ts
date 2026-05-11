import { InputFile, type Context } from "grammy";

export type CodexConfigFiles = {
  configToml: string;
  authJson: string;
};

export function buildCodexConfigFiles(input: {
  baseUrl: string;
  apiKey: string;
  model?: string;
}): CodexConfigFiles {
  const model = input.model?.trim() || "gpt-5.5";
  const baseUrl = input.baseUrl.trim();
  const apiKey = input.apiKey.trim();

  return {
    configToml: [
      `model = ${tomlString(model)}`,
      `model_provider = "resproxy"`,
      `model_reasoning_effort = "medium"`,
      "",
      `[model_providers.resproxy]`,
      `name = "resproxy"`,
      `base_url = ${tomlString(baseUrl)}`,
      `api_key = ${tomlString(apiKey)}`,
      `wire_api = "responses"`,
      "",
    ].join("\n"),
    authJson: `${JSON.stringify(
      {
        auth_mode: "apikey",
        OPENAI_API_KEY: apiKey,
      },
      null,
      2,
    )}\n`,
  };
}

export async function sendCodexConfigFiles(
  ctx: Context,
  telegramUserId: string,
  files: CodexConfigFiles,
): Promise<void> {
  const chatId = Number(telegramUserId);
  await ctx.api.sendDocument(
    chatId,
    new InputFile(Buffer.from(files.configToml, "utf8"), "config.toml"),
    { caption: "Codex config.toml" },
  );
  await ctx.api.sendDocument(
    chatId,
    new InputFile(Buffer.from(files.authJson, "utf8"), "auth.json"),
    { caption: "Codex auth.json" },
  );
}

export async function sendCustomerCodexSetup(ctx: Context, input: {
  telegramUserId: string;
  baseUrl: string;
  apiKey: string;
  model?: string;
  title: string;
  details: string[];
}): Promise<boolean> {
  try {
    await ctx.api.sendMessage(
      Number(input.telegramUserId),
      [
        input.title,
        ...input.details,
        "Paste both files into your Codex config folder:",
        "Mac: ~/.codex/",
        "Windows: %USERPROFILE%\\.codex\\",
        "If that folder does not exist, create it first.",
      ].join("\n"),
    );
    await sendCodexConfigFiles(
      ctx,
      input.telegramUserId,
      buildCodexConfigFiles({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        model: input.model,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}
