import { testProviderAccount } from "../../features/accounts/accountApi";
import type { ProviderTestResult } from "../../features/providers/providerTypes";

/**
 * Result of a post-connection health check, normalized for display in the
 * connection flow's completion step.
 *
 * - `success` — the account responded and all checks passed
 * - `partial` — the account responded but only some checks passed
 * - `failed`  — the test reported an error (invalid key, expired token, etc.)
 * - `timeout` — the test did not resolve within the allotted time
 */
export interface ValidationResult {
  status: "success" | "failed" | "partial" | "timeout";
  latencyMs?: number;
  errorMessage?: string;
  suggestedFix?: string;
  checks?: {
    authOk: boolean;
    quotaOk: boolean;
    modelOk: boolean;
    routingOk: boolean;
  };
}

// Sentinel error message used internally to distinguish a timeout from a
// genuine test failure when the Promise.race rejects.
const TIMEOUT_SENTINEL = "__TIMEOUT__";

/** Default health-check timeout (AC 2.6). */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Maps a {@link ProviderTestResult} from `testProviderAccount` into a
 * {@link ValidationResult} for the UI. Handles `success`, `partial`, and
 * `failed` statuses.
 */
export function mapTestResultToValidation(result: ProviderTestResult): ValidationResult {
  const checks = {
    authOk: result.authOk,
    quotaOk: result.quotaOk,
    modelOk: result.modelOk,
    routingOk: result.routingOk,
  };

  if (result.status === "success") {
    return {
      status: "success",
      latencyMs: result.latencyMs,
      checks,
    };
  }

  if (result.status === "partial") {
    return {
      status: "partial",
      latencyMs: result.latencyMs,
      checks,
    };
  }

  return {
    status: "failed",
    errorMessage: result.errorMessage,
    suggestedFix: result.suggestedFix,
    checks,
  };
}

/**
 * Runs a health check against the given account using `testProviderAccount`,
 * wrapped in a timeout (AC 2.5, 2.6).
 *
 * - On timeout, resolves to `{ status: 'timeout' }` (AC 2.6).
 * - On test failure/error, resolves to `{ status: 'failed', errorMessage, suggestedFix }` (AC 2.3).
 *
 * The timeout timer is always cleared once the race settles to avoid leaking a
 * pending `setTimeout` handle.
 *
 * @param timeoutMs Timeout in milliseconds. Defaults to 10s.
 */
export async function validateWithTimeout(
  providerId: string,
  accountId: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<ValidationResult> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const testPromise = testProviderAccount(providerId, accountId);
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(TIMEOUT_SENTINEL)), timeoutMs);
  });

  try {
    const result = await Promise.race([testPromise, timeoutPromise]);
    return mapTestResultToValidation(result);
  } catch (err) {
    if (err instanceof Error && err.message === TIMEOUT_SENTINEL) {
      return { status: "timeout" };
    }
    return {
      status: "failed",
      errorMessage: err instanceof Error ? err.message : "Validation failed",
      suggestedFix: "Try testing the connection manually from the accounts list.",
    };
  } finally {
    // Clear the timeout so a pending timer doesn't leak after the race settles.
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}
