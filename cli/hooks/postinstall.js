#!/usr/bin/env node
/**
 * postinstall hook — installs production dependencies into dist/node_modules
 * so the server can resolve fastify, better-sqlite3, etc. at runtime.
 *
 * Similar to 9Router's hooks/postinstall.js that installs sql.js into ~/.9router/runtime/
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const DIST_DIR = path.join(__dirname, "..", "dist");
const PKG_PATH = path.join(DIST_DIR, "package.json");

// Only run if dist/package.json exists (skip if just cloning the repo)
if (!fs.existsSync(PKG_PATH)) {
  process.exit(0);
}

// Check if node_modules already exists and has fastify
const fastifyPath = path.join(DIST_DIR, "node_modules", "fastify");
if (fs.existsSync(fastifyPath)) {
  // Already installed
  process.exit(0);
}

console.log("📦 Installing responses-proxy runtime dependencies...");

try {
  execSync("npm install --omit=dev --no-audit --no-fund --loglevel=error", {
    cwd: DIST_DIR,
    stdio: "inherit",
    timeout: 120000,
  });
  console.log("✅ Runtime dependencies installed successfully.");
} catch (error) {
  console.error("⚠️  Failed to install runtime dependencies.");
  console.error("   You may need to run manually:");
  console.error(`   cd ${DIST_DIR} && npm install --omit=dev`);
  // Don't fail the install — the user can fix it manually
  process.exit(0);
}
