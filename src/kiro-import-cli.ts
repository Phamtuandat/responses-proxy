/**
 * CLI: copy Kiro OAuth accounts from a 9router SQLite DB into a resproxy-owned DB
 * so the proxy can own token refresh (write-back) without sharing 9router's live
 * database.
 *
 * Usage:
 *   npm run kiro:import -- [--from <9router.sqlite>] [--to <dest.sqlite>] [--provider kiro]
 *
 * Defaults:
 *   --from  $KIRO_SOURCE_DB_PATH or ~/.9router/db/data.sqlite
 *   --to    $KIRO_DB_PATH or ./logs/kiro.sqlite
 */
import os from "node:os";
import path from "node:path";
import { importKiroAccounts, KiroImportError } from "./kiro-import.js";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

function defaultSource(): string {
  return (
    process.env.KIRO_SOURCE_DB_PATH?.trim() ||
    path.join(os.homedir(), ".9router", "db", "data.sqlite")
  );
}

function defaultDest(): string {
  return process.env.KIRO_DB_PATH?.trim() || path.resolve("logs", "kiro.sqlite");
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const sourceDbPath = args.from ?? defaultSource();
  const destDbPath = args.to ?? defaultDest();
  const provider = args.provider ?? "kiro";

  try {
    const result = importKiroAccounts({ sourceDbPath, destDbPath, provider });
    console.log(`[kiro:import] source : ${result.source}`);
    console.log(`[kiro:import] dest   : ${result.dest}`);
    console.log(`[kiro:import] copied : ${result.imported} ${provider} account(s)`);
    for (const id of result.ids) {
      console.log(`[kiro:import]   - ${id}`);
    }
    if (result.imported === 0) {
      console.log(
        `[kiro:import] WARNING: no '${provider}' accounts found in the source DB. Nothing to import.`,
      );
    } else {
      console.log(
        `[kiro:import] Done. Point KIRO_DB_PATH at ${result.dest} and set KIRO_WRITE_BACK_ENABLED=true.`,
      );
    }
  } catch (error) {
    if (error instanceof KiroImportError) {
      console.error(`[kiro:import] ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

main();
