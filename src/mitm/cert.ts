/**
 * MITM Certificate Management — generates root CA + per-domain leaf certs.
 * Uses node-forge for certificate generation (no native deps).
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const MITM_DIR = process.env.RESPONSES_PROXY_MITM_DIR
  || path.join(process.env.HOME || "", ".responses-proxy", "mitm");
const ROOT_CA_KEY = path.join(MITM_DIR, "rootCA.key");
const ROOT_CA_CERT = path.join(MITM_DIR, "rootCA.crt");

export function getMitmDir(): string {
  mkdirSync(MITM_DIR, { recursive: true });
  return MITM_DIR;
}

export function rootCaExists(): boolean {
  return existsSync(ROOT_CA_KEY) && existsSync(ROOT_CA_CERT);
}

export function isRootCaTrusted(): boolean {
  if (process.platform !== "darwin") return false;
  try {
    const result = execSync(
      `security verify-cert -c "${ROOT_CA_CERT}" 2>&1`,
      { encoding: "utf8", timeout: 5000 },
    );
    return result.includes("successful") || !result.includes("CSSMERR");
  } catch {
    return false;
  }
}

/**
 * Generate a self-signed Root CA using openssl CLI (available on macOS/Linux).
 * Outputs rootCA.key + rootCA.crt to MITM_DIR.
 */
export function generateRootCA(): { keyPath: string; certPath: string } {
  mkdirSync(MITM_DIR, { recursive: true });

  if (rootCaExists()) {
    return { keyPath: ROOT_CA_KEY, certPath: ROOT_CA_CERT };
  }

  // Generate RSA 2048 key
  execSync(`openssl genrsa -out "${ROOT_CA_KEY}" 2048`, { stdio: "ignore", timeout: 10000 });

  // Generate self-signed CA cert (valid 10 years)
  execSync(
    `openssl req -x509 -new -nodes -key "${ROOT_CA_KEY}" -sha256 -days 3650 ` +
    `-subj "/CN=responses-proxy MITM CA/O=responses-proxy/C=US" ` +
    `-out "${ROOT_CA_CERT}"`,
    { stdio: "ignore", timeout: 10000 },
  );

  return { keyPath: ROOT_CA_KEY, certPath: ROOT_CA_CERT };
}

/**
 * Trust the root CA in the macOS system keychain (requires sudo).
 */
export async function trustRootCA(sudoPassword?: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("Trust cert is only supported on macOS");
  }
  if (!rootCaExists()) {
    throw new Error("Root CA does not exist. Generate it first.");
  }

  const cmd = `security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${ROOT_CA_CERT}"`;

  if (sudoPassword) {
    const { execWithPassword } = await import("./dns.js");
    await execWithPassword(cmd, sudoPassword);
  } else {
    execSync(`sudo ${cmd}`, { stdio: "ignore", timeout: 15000 });
  }
}

/**
 * Generate a leaf certificate for a specific domain, signed by the root CA.
 * Returns { key, cert } as PEM strings.
 */
export function generateLeafCert(domain: string): { key: string; cert: string } | null {
  if (!rootCaExists()) return null;

  const tmpDir = path.join(MITM_DIR, "tmp");
  mkdirSync(tmpDir, { recursive: true });

  const serial = randomBytes(8).toString("hex");
  const leafKey = path.join(tmpDir, `${serial}.key`);
  const leafCsr = path.join(tmpDir, `${serial}.csr`);
  const leafCert = path.join(tmpDir, `${serial}.crt`);
  const extFile = path.join(tmpDir, `${serial}.ext`);

  try {
    // Generate leaf key
    execSync(`openssl genrsa -out "${leafKey}" 2048`, { stdio: "ignore", timeout: 5000 });

    // Generate CSR
    execSync(
      `openssl req -new -key "${leafKey}" -subj "/CN=${domain}" -out "${leafCsr}"`,
      { stdio: "ignore", timeout: 5000 },
    );

    // Write SAN extension file
    writeFileSync(extFile, `authorityKeyIdentifier=keyid,issuer\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,nonRepudiation,keyEncipherment,dataEncipherment\nsubjectAltName=DNS:${domain}\n`);

    // Sign with root CA
    execSync(
      `openssl x509 -req -in "${leafCsr}" -CA "${ROOT_CA_CERT}" -CAkey "${ROOT_CA_KEY}" ` +
      `-CAcreateserial -out "${leafCert}" -days 825 -sha256 -extfile "${extFile}"`,
      { stdio: "ignore", timeout: 5000 },
    );

    const key = readFileSync(leafKey, "utf8");
    const cert = readFileSync(leafCert, "utf8");

    // Cleanup temp files
    try {
      for (const f of [leafKey, leafCsr, leafCert, extFile]) {
        if (existsSync(f)) require("node:fs").unlinkSync(f);
      }
    } catch { /* best effort */ }

    return { key, cert };
  } catch (error) {
    return null;
  }
}

export function loadRootCA(): { key: string; cert: string } {
  return {
    key: readFileSync(ROOT_CA_KEY, "utf8"),
    cert: readFileSync(ROOT_CA_CERT, "utf8"),
  };
}
