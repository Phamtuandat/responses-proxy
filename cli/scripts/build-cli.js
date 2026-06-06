#!/usr/bin/env node
/**
 * Build script for the CLI package.
 *
 * Copies the built server (dist/) and client (dist/client/) from the
 * root project into cli/dist/ so the CLI package is self-contained.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const CLI_DIR = path.resolve(__dirname, "..");
const DIST_SRC = path.join(ROOT, "dist");
const DIST_DEST = path.join(CLI_DIR, "dist");

console.log("🔨 Building responses-proxy CLI package...\n");

// Step 1: Build the root project
console.log("1. Building server + client...");
execSync("npm run build", { cwd: ROOT, stdio: "inherit" });

// Step 2: Copy dist/ into cli/dist/
console.log("\n2. Copying dist/ to cli/dist/...");
if (fs.existsSync(DIST_DEST)) {
  fs.rmSync(DIST_DEST, { recursive: true });
}
fs.cpSync(DIST_SRC, DIST_DEST, { recursive: true });

// Step 3: Copy node_modules production deps
// (The user will need to npm install in the cli dir, or we bundle deps)
console.log("\n3. Copying package.json for production deps...");
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const prodDeps = rootPkg.dependencies || {};

// Write a minimal package.json into cli/dist/ so better-sqlite3 can be resolved
const distPkg = {
  name: "responses-proxy-runtime",
  version: rootPkg.version,
  private: true,
  dependencies: prodDeps,
};
fs.writeFileSync(
  path.join(DIST_DEST, "package.json"),
  JSON.stringify(distPkg, null, 2) + "\n",
);

console.log("\n✅ CLI package built successfully!");
console.log(`   Output: ${DIST_DEST}`);
console.log(`\nTo publish:`);
console.log(`   cd cli && npm publish`);
console.log(`\nTo test locally:`);
console.log(`   cd cli/dist && npm install --omit=dev`);
console.log(`   cd .. && node cli.js`);
