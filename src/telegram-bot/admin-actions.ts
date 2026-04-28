import { InlineKeyboard, type Bot } from "grammy";
import { replyOrEditMessage } from "./callbacks.js";

type InlineKeyboardMarkupLike = {
  inline_keyboard?: Array<Array<Record<string, unknown>>>;
};

export const ADMIN_CALLBACK_ACTIONS = [
  "status",
  "clients",
  "providers",
  "models",
  "oauth",
  "plans",
  "renewals",
  "apikeys",
  "apply",
  "menu",
] as const;

export type AdminCallbackAction = (typeof ADMIN_CALLBACK_ACTIONS)[number];
export type AdminButtonAction = AdminCallbackAction | "accounts";
export type AdminActionLoop = "main" | "proxy" | "config" | "billing" | "keys" | "apply" | "accounts";

export const ADMIN_CALLBACK_PATTERN = new RegExp(`^v1:admin:(${ADMIN_CALLBACK_ACTIONS.join("|")})$`);

export const ADMIN_ACTION_BUTTONS: Record<AdminButtonAction, { label: string; callbackData: string }> = {
  status: { label: "📈 Status", callbackData: "v1:admin:status" },
  clients: { label: "👥 Clients", callbackData: "v1:admin:clients" },
  providers: { label: "🧭 Providers", callbackData: "v1:admin:providers" },
  models: { label: "🧠 Models", callbackData: "v1:admin:models" },
  plans: { label: "💳 Plans", callbackData: "v1:admin:plans" },
  renewals: { label: "🧾 Renewals", callbackData: "v1:admin:renewals" },
  apikeys: { label: "🔑 API Keys", callbackData: "v1:admin:apikeys" },
  apply: { label: "⚙️ Apply", callbackData: "v1:admin:apply" },
  oauth: { label: "🔐 OAuth", callbackData: "v1:admin:oauth" },
  accounts: { label: "👤 Accounts", callbackData: "v1:acct:list" },
  menu: { label: "⬅️ Admin", callbackData: "v1:admin:menu" },
};

export const ADMIN_ACTION_LOOPS: Record<AdminActionLoop, { title: string; actions: AdminButtonAction[] }> = {
  main: {
    title: "Admin actions",
    actions: ["status", "clients", "providers", "models", "plans", "renewals", "apikeys", "apply", "oauth", "accounts"],
  },
  proxy: {
    title: "Proxy actions",
    actions: ["status", "providers", "models", "oauth", "accounts", "menu"],
  },
  config: {
    title: "Config actions",
    actions: ["clients", "apply", "providers", "models", "menu"],
  },
  billing: {
    title: "Billing actions",
    actions: ["plans", "renewals", "apikeys", "menu"],
  },
  keys: {
    title: "API key actions",
    actions: ["apikeys", "plans", "renewals", "clients", "menu"],
  },
  apply: {
    title: "Apply actions",
    actions: ["apply", "clients", "status", "menu"],
  },
  accounts: {
    title: "Account actions",
    actions: ["accounts", "oauth", "status", "menu"],
  },
};

export function buildAdminActionKeyboard(actions: AdminButtonAction[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  actions.forEach((action, index) => {
    const button = ADMIN_ACTION_BUTTONS[action];
    keyboard.text(button.label, button.callbackData);
    if (index % 2 === 1 && index < actions.length - 1) {
      keyboard.row();
    }
  });
  return keyboard;
}

export function buildAdminStartKeyboard(): InlineKeyboard {
  return buildAdminActionKeyboard(ADMIN_ACTION_LOOPS.main.actions);
}

export function mergeInlineKeyboards(
  ...keyboards: Array<InlineKeyboard | InlineKeyboardMarkupLike | undefined>
): InlineKeyboardMarkupLike | undefined {
  const rows = keyboards.flatMap((keyboard) => {
    if (!keyboard) {
      return [];
    }
    const raw = JSON.parse(JSON.stringify(keyboard)) as InlineKeyboardMarkupLike;
    return Array.isArray(raw.inline_keyboard) ? raw.inline_keyboard : [];
  });
  return rows.length > 0 ? { inline_keyboard: rows } : undefined;
}

export async function replyAdminActionLoop(
  ctx: Parameters<Bot["command"]>[1] extends infer _T ? any : never,
  loop: AdminActionLoop = "main",
): Promise<void> {
  const definition = ADMIN_ACTION_LOOPS[loop];
  await replyOrEditMessage(ctx, definition.title, {
    reply_markup: buildAdminActionKeyboard(definition.actions),
  });
}

export async function renderAdminScreen(
  ctx: Parameters<Bot["command"]>[1] extends infer _T ? any : never,
  input: {
    text: string;
    loop: AdminActionLoop;
    primaryKeyboard?: InlineKeyboard | InlineKeyboardMarkupLike;
  },
): Promise<void> {
  const loopKeyboard = buildAdminActionKeyboard(ADMIN_ACTION_LOOPS[input.loop].actions);
  await replyOrEditMessage(ctx, input.text, {
    reply_markup: mergeInlineKeyboards(input.primaryKeyboard, loopKeyboard) as never,
  });
}

export function buildApplyClientKeyboard(includeMenu = true): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("Hermes", "v1:apply:client:hermes")
    .text("Codex", "v1:apply:client:codex");
  if (includeMenu) {
    keyboard.row().text(ADMIN_ACTION_BUTTONS.menu.label, ADMIN_ACTION_BUTTONS.menu.callbackData);
  }
  return keyboard;
}
