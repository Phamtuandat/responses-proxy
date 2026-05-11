import { InputFile, type Context } from "grammy";
import {
  buildCodexConfigFiles,
  buildCodexSetupCurlCommand,
  type CodexConfigFiles,
} from "../codex-setup.js";

export { buildCodexConfigFiles, type CodexConfigFiles } from "../codex-setup.js";

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
        "",
        "Run this on machine that should hold Codex config:",
        buildCodexSetupCurlCommand({
          publicResponsesBaseUrl: input.baseUrl,
          apiKey: input.apiKey,
        }),
        "",
        "It patches ~/.codex/config.toml and ~/.codex/auth.json in place.",
        "If you want manual paste instead, files are attached below.",
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
