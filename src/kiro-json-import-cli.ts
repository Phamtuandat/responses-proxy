/**
 * CLI: import Kiro OAuth accounts from a JSON payload into a resproxy-owned DB,
 * mirroring 9router's Kiro import (refresh → validate → store with
 * providerSpecificData). Accepts the same JSON shapes 9router produces/consumes:
 * a single account object, a bare array, or a 9router backup export
 * (`{ providerConnections: [...] }`).
 *
 * Usage:
 *   npm run kiro:import:json -- --file <accounts.json> [--to <dest.sqlite>]
 *   npm run kiro:import:json -- --json '{"refreshToken":"aorAAAAAG..."}'
 *   cat accounts.json | npm run kiro:import:json -- --stdin
 *
 * Flags:
 *   --file <path>    Read JSON from a file
 *   --json <text>    Inline JSON string
 *   --stdin          Read JSON from standard input
 *   --to <path>      Destination DB ($KIRO_DB_PATH or ./logs/kiro.sqlite)
 *   --region <r>     Default region for IDC refresh ($KIRO_DEFAULT_REGION or us-east-1)
 *   --no-refresh     Store tokens verbatim without calling the refresh endpoint
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { KiroImportError } from "./kiro-import.js";
import { importKiroAccountsFromJson } from "./kiro-json-import.js";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

function defaultDest(): string {
  return process.env.KIRO_DB_PATH?.trim() || path.resolve("logs", "kiro.sqlite");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const destDbPath = args.to ?? defaultDest();
  const defaultRegion = args.region ?? process.env.KIRO_DEFAULT_REGION?.trim() ?? "us-east-1";
  const refresh = args["no-refresh"] !== "true";

  let jsonText: string | undefined;
  let filePath: string | undefined;
  if (args.stdin === "true") {
    jsonText = readFileSync(0, "utf-8");
  } else if (args.json) {
    jsonText = args.json;
  } else if (args.file) {
    filePath = args.file;
  } else {
    console.error(
      "[kiro:import:json] Provide one of --file <path>, --json <text>, or --stdin. See --help.",
    );
    process.exit(1);
  }

  try {
    const result = await importKiroAccountsFromJson({
      jsonText,
      filePath,
      destDbPath,
      defaultRegion,
      refresh,
    });
    console.log(`[kiro:import:json] dest     : ${result.dest}`);
    console.log(`[kiro:import:json] imported : ${result.imported} kiro account(s)`);
    for (const account of result.accounts) {
      const email = account.email ?? "(no email)";
      const tag = account.refreshed ? "refreshed" : "verbatim";
      console.log(`[kiro:import:json]   - ${account.name} <${email}> [${account.authMethod}, ${tag}]`);
    }
    console.log(
      `[kiro:import:json] Done. Point KIRO_DB_PATH at ${result.dest} and set KIRO_ENABLED=true.`,
    );
  } catch (error) {
    if (error instanceof KiroImportError) {
      console.error(`[kiro:import:json] ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
