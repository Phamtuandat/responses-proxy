/**
 * MITM Server entry point — spawned with sudo by the main proxy.
 * Runs the HTTPS interception server on port 443.
 */

import { startMitmServer } from "./server.js";

try {
  const { pid } = startMitmServer();
  console.log(`[mitm] Server started (PID: ${pid})`);
} catch (error) {
  console.error(`[mitm] Failed to start:`, error instanceof Error ? error.message : error);
  process.exit(1);
}
