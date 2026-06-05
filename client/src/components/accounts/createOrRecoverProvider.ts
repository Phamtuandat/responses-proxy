import { apiGet, createProvider, updateProvider } from "../../api/client";
import { getProviderById } from "../../features/providers/providerCatalog";
import type { ProviderMutationInput } from "../../api/types";

export interface CreateOrRecoverInput {
  providerId: string;
  apiKey: string;
}

/**
 * Shape of the existing provider returned by `GET /api/providers/:id` that we
 * rely on during 409-conflict recovery. Extra fields are ignored.
 */
interface ExistingProvider {
  name?: string;
  baseUrl?: string;
  authMode?: string;
  providerApiKeys?: string[];
  capabilities?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Creates a provider with the given API key. If a 409 "already exists" conflict
 * occurs, fetches the existing provider and appends the key if not already present.
 *
 * Throws on "already assigned to another provider" errors without recovery.
 * Attempts create-then-recover at most once (no retry loop).
 */
export async function createOrRecoverProvider({ providerId, apiKey }: CreateOrRecoverInput): Promise<void> {
  const catalogEntry = getProviderById(providerId);
  if (!catalogEntry) {
    throw new Error(`Provider ${providerId} not found in catalog.`);
  }

  const createPayload: ProviderMutationInput = {
    // Create the provider with the catalog ID so it matches the modal's existing
    // behaviour (the backend keys providers by this ID).
    id: providerId,
    name: catalogEntry.name,
    baseUrl: catalogEntry.defaultBaseUrl || "https://api.example.com",
    authMode: "api_key",
    providerApiKeys: [apiKey],
    capabilities: { transportMode: "chat_completions" },
  };

  try {
    await createProvider(createPayload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // AC 3.6: Key already registered to a different provider — no recovery
    if (message.includes("already assigned to another provider")) {
      throw new Error(
        `This API key is already registered with a different provider. Remove it from that provider first.`
      );
    }

    // AC 3.1: 409 conflict — provider already exists
    if (message.includes("already exists")) {
      await recoverFromConflict(providerId, apiKey);
      return;
    }

    // Unknown creation error
    throw err;
  }
}

async function recoverFromConflict(providerId: string, apiKey: string): Promise<void> {
  // AC 3.1: Fetch existing provider
  const response = await apiGet<{ ok?: boolean; provider?: ExistingProvider }>(
    `/api/providers/${encodeURIComponent(providerId)}`
  );
  const existing = response.provider;

  if (!existing) {
    throw new Error(`Provider ${providerId} reported as existing but could not be fetched.`);
  }

  const existingKeys: string[] = Array.isArray(existing.providerApiKeys)
    ? existing.providerApiKeys
    : [];

  // AC 3.3: Key already present — treat as success
  if (existingKeys.includes(apiKey)) {
    return;
  }

  // AC 3.2: Append the new key
  try {
    await updateProvider(providerId, {
      name: existing.name ?? "",
      baseUrl: existing.baseUrl ?? "",
      authMode: existing.authMode ?? "api_key",
      providerApiKeys: [...existingKeys, apiKey],
      capabilities: existing.capabilities,
    });
  } catch (recoveryErr) {
    // AC 3.4: Both create and recovery failed
    const reason = recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr);
    throw new Error(`Failed to add API key to existing provider: ${reason}`);
  }
}
