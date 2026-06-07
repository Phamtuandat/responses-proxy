/**
 * Sudo password cache — mirrors 9Router's two-layer caching:
 * 1. In-memory cache (per-process, fast)
 * 2. Encrypted persistent cache (AES-256-GCM, survives restarts)
 *
 * The encryption key is derived from a machine-specific value so the
 * encrypted password can't be trivially decrypted if copied to another host.
 */

import crypto from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const ENCRYPT_ALGO = "aes-256-gcm";
const ENCRYPT_SALT = "responses-proxy-mitm-sudo-v1";
const CACHE_FILE = path.join(os.homedir(), ".responses-proxy", "mitm", "sudo.enc");

// ─── In-memory cache ─────────────────────────────────────────────────────────

let memoryPassword: string | null = null;

export function getCachedPassword(): string | null {
  return memoryPassword;
}

export function setCachedPassword(pwd: string): void {
  if (!pwd) return;
  memoryPassword = pwd;
  // Also persist encrypted
  saveEncryptedPassword(pwd);
}

export function clearCachedPassword(): void {
  memoryPassword = null;
  try {
    if (existsSync(CACHE_FILE)) writeFileSync(CACHE_FILE, "");
  } catch { /* ignore */ }
}

// ─── Encryption ──────────────────────────────────────────────────────────────

function deriveKey(): Buffer {
  // Use hostname + platform + a salt as a stable machine-specific key.
  // (node-machine-id would be better but avoids extra dependency)
  const machineId = `${os.hostname()}:${os.platform()}:${os.userInfo().username}`;
  return crypto.createHash("sha256").update(machineId + ENCRYPT_SALT).digest();
}

function encryptPassword(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPT_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptPassword(stored: string): string | null {
  try {
    const [ivHex, tagHex, dataHex] = stored.split(":");
    if (!ivHex || !tagHex || !dataHex) return null;
    const key = deriveKey();
    const decipher = crypto.createDecipheriv(ENCRYPT_ALGO, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return decipher.update(Buffer.from(dataHex, "hex")).toString("utf8") + decipher.final("utf8");
  } catch {
    return null;
  }
}

function saveEncryptedPassword(pwd: string): void {
  try {
    mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, encryptPassword(pwd), { mode: 0o600 });
  } catch { /* best effort */ }
}

export function loadEncryptedPassword(): string | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const stored = readFileSync(CACHE_FILE, "utf8").trim();
    if (!stored) return null;
    return decryptPassword(stored);
  } catch {
    return null;
  }
}

// ─── Resolution chain ────────────────────────────────────────────────────────

/**
 * Resolve the sudo password: provided → memory cache → encrypted disk.
 * Caches whatever is resolved so future calls are free.
 */
export function resolvePassword(provided?: string): string {
  const pwd = provided || getCachedPassword() || loadEncryptedPassword() || "";
  if (pwd && pwd !== memoryPassword) {
    memoryPassword = pwd;
  }
  return pwd;
}

export function hasCachedPassword(): boolean {
  return Boolean(getCachedPassword() || loadEncryptedPassword());
}
