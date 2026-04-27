import { InlineKeyboard, type Bot } from "grammy";
import { replyWithProxyError, sendClients, type BotDependencies } from "../actions.js";
import { maskApiKey } from "../format.js";
import { ProxyClientError } from "../proxy-client.js";
import { buildTelegramSessionScope, type TelegramBotStateStore } from "../sessions.js";

type QuickApplyClient = "hermes" | "codex";

export function registerApplyCommand(
  bot: Bot,
  deps: BotDependencies,
  sessions: TelegramBotStateStore,
): void {
  bot.command("apply", async (ctx) => {
    const args = ctx.match?.toString().trim() || "";
    if (!args) {
      await ctx.reply("Choose a client to configure.", {
        reply_markup: new InlineKeyboard()
          .text("Hermes", "v1:apply:client:hermes")
          .text("Codex", "v1:apply:client:codex"),
      });
      return;
    }

    const [clientRaw, model, routeApiKey] = args.split(/\s+/g);
    const client = clientRaw === "hermes" || clientRaw === "codex" ? clientRaw : null;
    if (!client || !model) {
      await ctx.reply("Usage: /apply <hermes|codex> <model> [routeApiKey]");
      return;
    }

    try {
      const result = await deps.proxyClient.applyClientConfig({
        client,
        model,
        routeApiKey,
      });
      await ctx.reply(
        [
          `Applied config for ${client}`,
          `model: ${model}`,
          `routeApiKey: ${maskApiKey(routeApiKey ?? result?.status?.routeApiKey ?? null)}`,
          `changed: ${String(result?.changed ?? false)}`,
        ].join("\n"),
      );
      await sendClients(ctx, deps);
    } catch (error) {
      await replyWithProxyError(ctx, error);
    }
  });

  bot.callbackQuery(/^v1:apply:client:(hermes|codex)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showProviderPicker(ctx, deps, ctx.match[1] as QuickApplyClient);
  });

  bot.callbackQuery(/^v1:apply:start:(hermes|codex):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showModelPicker(ctx, deps, sessions, {
      client: ctx.match[1] as QuickApplyClient,
      providerId: ctx.match[2],
    });
  });

  bot.callbackQuery(/^v1:apply:provider:(hermes|codex):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showModelPicker(ctx, deps, sessions, {
      client: ctx.match[1] as QuickApplyClient,
      providerId: ctx.match[2],
    });
  });

  bot.callbackQuery(/^v1:apply:model:(hermes|codex):([^:]+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const client = ctx.match[1] as QuickApplyClient;
    const providerId = ctx.match[2];
    const modelIndex = Number(ctx.match[3]);
    const chatId = ctx.chat?.id?.toString();
    const userId = ctx.from?.id?.toString();
    const session =
      chatId && userId ? sessions.get(buildTelegramSessionScope(chatId, userId)) : undefined;
    if (session?.kind !== "awaiting_apply_model_input" || session.providerId !== providerId) {
      await showModelPicker(ctx, deps, sessions, { client, providerId });
      return;
    }
    const model = session.models[modelIndex];
    if (!model) {
      await ctx.reply("Model selection expired. Please start /apply again.");
      return;
    }
    if (chatId && userId) {
      sessions.clear(buildTelegramSessionScope(chatId, userId));
    }
    await applySelection(ctx, deps, { client, providerId, providerName: session.providerName, model });
  });

  bot.callbackQuery(/^v1:apply:model-text:(hermes|codex):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = ctx.chat?.id?.toString();
    const userId = ctx.from?.id?.toString();
    if (!chatId || !userId) {
      return;
    }
    const client = ctx.match[1] as QuickApplyClient;
    const providerId = ctx.match[2];
    const providerName = await maybeReadProviderName(deps, providerId);
    sessions.set(buildTelegramSessionScope(chatId, userId), {
      kind: "awaiting_apply_model_input",
      client,
      providerId,
      providerName,
      models: [],
    });
    await ctx.reply("Send the model name to apply for this provider.");
  });

  bot.on("message:text", async (ctx, next) => {
    const chatId = ctx.chat?.id?.toString();
    const userId = ctx.from?.id?.toString();
    if (!chatId || !userId) {
      await next();
      return;
    }
    const scope = buildTelegramSessionScope(chatId, userId);
    const session = sessions.get(scope);
    if (session?.kind !== "awaiting_apply_model_input") {
      await next();
      return;
    }
    if (ctx.message.text.startsWith("/")) {
      await next();
      return;
    }
    sessions.clear(scope);
    await applySelection(ctx, deps, {
      client: session.client,
      providerId: session.providerId,
      providerName: session.providerName,
      model: ctx.message.text.trim(),
    });
  });
}

async function showProviderPicker(
  ctx: Parameters<Bot["command"]>[1] extends infer _T ? any : never,
  deps: BotDependencies,
  client: QuickApplyClient,
): Promise<void> {
  try {
    const payload = await deps.proxyClient.getClientConfigs();
    const keyboard = new InlineKeyboard();
    for (const provider of payload?.providerOptions ?? []) {
      keyboard.text(
        provider.name,
        `v1:apply:provider:${client}:${provider.id}`,
      ).row();
    }
    await ctx.reply(`Choose provider for ${client}.`, { reply_markup: keyboard });
  } catch (error) {
    await replyWithProxyError(ctx, error);
  }
}

async function showModelPicker(
  ctx: Parameters<Bot["command"]>[1] extends infer _T ? any : never,
  deps: BotDependencies,
  sessions: TelegramBotStateStore,
  input: { client: QuickApplyClient; providerId: string },
): Promise<void> {
  try {
    const payload = await deps.proxyClient.getProviderModels(input.providerId);
    const models = Array.isArray(payload?.models)
      ? payload.models.filter((item: unknown): item is string => typeof item === "string")
      : [];
    const providerName = await maybeReadProviderName(deps, input.providerId);
    const chatId = ctx.chat?.id?.toString();
    const userId = ctx.from?.id?.toString();
    if (chatId && userId) {
      sessions.set(buildTelegramSessionScope(chatId, userId), {
        kind: "awaiting_apply_model_input",
        client: input.client,
        providerId: input.providerId,
        providerName,
        models,
      });
    }
    const keyboard = new InlineKeyboard();
    for (const [index, model] of models.slice(0, 8).entries()) {
      keyboard.text(model.slice(0, 32), `v1:apply:model:${input.client}:${input.providerId}:${index}`).row();
    }
    keyboard.text("Type model manually", `v1:apply:model-text:${input.client}:${input.providerId}`);
    await ctx.reply(
      [
        `Provider: ${providerName ?? input.providerId}`,
        `Choose model for ${input.client}, or type one manually.`,
      ].join("\n"),
      { reply_markup: keyboard },
    );
  } catch (error) {
    await replyWithProxyError(ctx, error);
  }
}

async function applySelection(
  ctx: Parameters<Bot["command"]>[1] extends infer _T ? any : never,
  deps: BotDependencies,
  input: {
    client: QuickApplyClient;
    providerId: string;
    providerName?: string;
    model: string;
  },
): Promise<void> {
  try {
    await deps.proxyClient.setProviderRoute({
      client: input.client,
      providerId: input.providerId,
    });
    const result = await deps.proxyClient.applyClientConfig({
      client: input.client,
      model: input.model,
    });
    await ctx.reply(
      [
        `Applied config for ${input.client}`,
        `provider: ${input.providerName ?? input.providerId}`,
        `model: ${input.model}`,
        `baseUrl: ${result?.proxyBaseUrl ?? "n/a"}`,
        `routeApiKey: ${maskApiKey(result?.status?.routeApiKey ?? null)}`,
        `changed: ${String(result?.changed ?? false)}`,
      ].join("\n"),
    );
    await sendClients(ctx, deps);
  } catch (error) {
    if (error instanceof ProxyClientError && error.body?.error?.code === "MODEL_REQUIRED") {
      await ctx.reply("Model is required. Please choose a model or type one manually.");
      return;
    }
    if (error instanceof ProxyClientError && error.body?.error?.code === "CLIENT_API_KEY_NOT_FOUND") {
      await ctx.reply("Selected client API key is no longer valid. Refreshing client status.");
      await sendClients(ctx, deps);
      return;
    }
    if (error instanceof ProxyClientError && error.body?.error?.code === "QUICK_APPLY_HOST_PATH_UNAVAILABLE") {
      await ctx.reply("Quick Apply cannot patch the host config path from this runtime.");
      return;
    }
    await replyWithProxyError(ctx, error);
  }
}

async function maybeReadProviderName(
  deps: BotDependencies,
  providerId: string,
): Promise<string | undefined> {
  try {
    const payload = await deps.proxyClient.getProviderDetails(providerId);
    return typeof payload?.provider?.name === "string" ? payload.provider.name : undefined;
  } catch {
    return undefined;
  }
}
