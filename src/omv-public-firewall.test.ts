import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const scriptPath = path.resolve(process.cwd(), "scripts", "omv-public-firewall.sh");
const script = readFileSync(scriptPath, "utf8");

test("omv firewall rollback only deletes guard table", () => {
  assert.match(script, /nft delete table inet "\$TABLE"/);
  assert.doesNotMatch(script, /nft list ruleset/);
  assert.doesNotMatch(script, /BACKUP_FILE/);
});
