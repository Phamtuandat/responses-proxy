// Account Management Modal Component
// Unified interface for adding, editing, and managing provider accounts

import React, { useState, useCallback, useEffect, useRef } from "react";
import { StatusBadge } from "../StatusBadge";
import { AccountConnectionFlow } from "./AccountConnectionFlow";
import { CheckCircleIcon, AlertIcon, TrashIcon, RefreshIcon } from "../icons";
import type { AccountConnection } from "../../features/accounts/accountApi";
import type { ProviderAuthType, ProviderAccountRoutingMode } from "../../features/providers/providerTypes";
import { useAccountConnection, useAccountOperations } from "../../features/accounts/accountHooks";
import {
  apiGet,
  getKiroAccounts,
  importKiroAccounts,
  submitChatGptOAuthCallback,
  updateProvider,
} from "../../api/client";
import { createOrRecoverProvider } from "./createOrRecoverProvider";
import { validateWithTimeout, type ValidationResult } from "./validateConnection";

/** Shape of an existing provider as returned by GET /api/providers/:id. */
interface ExistingProvider {
  providerApiKeys?: string[];
  name?: string;
  baseUrl?: string;
  authMode?: string;
  capabilities?: Record<string, unknown>;
}


interface AccountManagementModalProps {
  providerId: string;
  providerName: string;
  supportedAuthTypes: ProviderAuthType[];
  accounts: AccountConnection[];
  isOpen: boolean;
  mode: 'add' | 'edit' | 'manage';
  editingAccount?: AccountConnection;
  onClose: () => void;
  onAccountsChanged: () => void;
}

export function AccountManagementModal({
  providerId,
  providerName,
  supportedAuthTypes,
  accounts,
  isOpen,
  mode,
  editingAccount,
  onClose,
  onAccountsChanged
}: AccountManagementModalProps) {
  const [selectedAuthType, setSelectedAuthType] = useState<ProviderAuthType>(supportedAuthTypes[0]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  const {
    connectionFlow,
    connecting,
    connectionError,
    startConnection,
    clearConnectionFlow,
    clearError: clearConnectionError
  } = useAccountConnection(providerId);

  const {
    updateRoutingMode,
    refreshAccount,
    deleteAccount,
    isAccountLoading,
    getAccountOperation,
    operationError,
    clearError: clearOperationError
  } = useAccountOperations(providerId);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      clearConnectionFlow();
      clearConnectionError();
      clearOperationError();
      setShowDeleteConfirm(false);
      setValidating(false);
      setValidationResult(null);
      if (editingAccount) {
        setSelectedAuthType(editingAccount.authType);
      }
    }
  }, [isOpen, editingAccount, clearConnectionFlow, clearConnectionError, clearOperationError]);

  const handleStartConnection = useCallback(async (authType: ProviderAuthType) => {
    try {
      await startConnection(authType);
    } catch (err) {
      console.error('Failed to start connection:', err);
    }
  }, [startConnection]);

  const runValidation = useCallback(async (accountId: string) => {
    setValidating(true);
    setValidationResult(null);
    try {
      const result = await validateWithTimeout(providerId, accountId);
      setValidationResult(result);
    } finally {
      setValidating(false);
    }
  }, [providerId]);

  const handleCompleteConnection = useCallback(async (data: any) => {
    try {
      // Account identifier to validate once the connection is saved. Left null
      // when validation should be skipped (e.g. bulk Kiro imports).
      let accountId: string | null = null;

      // Handle different completion types
      if (data.kiroImport) {
        // Kiro accounts are connected by importing them from a 9router database.
        const importResult = await importKiroAccounts(
          data.sourcePath ? { sourcePath: data.sourcePath } : undefined
        );

        if (importResult.imported === 0) {
          throw new Error('No Kiro accounts were found in the source database. Sign in through 9router first.');
        }

        // Only validate single-account imports; skip the health check for bulk
        // imports where there is no single obvious account to test.
        if (importResult.imported === 1) {
          try {
            const kiroAccounts = await getKiroAccounts();
            accountId = kiroAccounts.accounts?.[0]?.id ?? null;
          } catch (err) {
            console.warn('Could not resolve imported Kiro account for validation:', err);
          }
        }
      } else if (data.callbackUrl) {
        // OAuth completion. The callback URL IS the redirect URL the browser
        // landed on; the server extracts `state` from its query params.
        const response = await submitChatGptOAuthCallback({ redirectUrl: data.callbackUrl });
        accountId = response.account?.accountId ?? null;
      } else if (data.apiKey) {
        // API key addition. Check if the provider already exists on the backend.
        const newApiKey = data.apiKey;
        let existingProvider: ExistingProvider | null = null;

        try {
          const body = await apiGet<{ ok?: boolean; provider?: ExistingProvider }>(
            `/api/providers/${encodeURIComponent(providerId)}`
          );
          if (body.ok && body.provider) {
            existingProvider = body.provider;
          }
        } catch (err) {
          // apiGet throws on 404/network — treat as provider not existing.
          console.log("Provider does not exist on backend:", err);
        }

        if (!existingProvider) {
          // Provider doesn't exist on backend. Create it (with 409-recovery).
          await createOrRecoverProvider({ providerId, apiKey: newApiKey });
          // A freshly created provider has a single key at index 0.
          accountId = 'api-key-0';
        } else {
          // Provider exists. Append the new API key to the existing list.
          const existingKeys = Array.isArray(existingProvider.providerApiKeys)
            ? existingProvider.providerApiKeys
            : [];

          if (!existingKeys.includes(newApiKey)) {
            // The new key's index equals the length of the array before append.
            accountId = `api-key-${existingKeys.length}`;
            await updateProvider(providerId, {
              name: existingProvider.name ?? "",
              baseUrl: existingProvider.baseUrl ?? "",
              authMode: existingProvider.authMode ?? "api_key",
              providerApiKeys: [...existingKeys, newApiKey],
              capabilities: existingProvider.capabilities,
            });
          } else {
            // Key already present — validate the existing entry.
            accountId = `api-key-${existingKeys.indexOf(newApiKey)}`;
          }
        }
      }

      // Refresh accounts before kicking off validation so the list is current.
      onAccountsChanged();

      // Fire-and-forget the health check so handleCompleteConnection resolves
      // promptly and the connection flow can advance to the complete step,
      // where the spinner and result are rendered as state updates arrive.
      if (accountId) {
        void runValidation(accountId);
      }
    } catch (err) {
      console.error('Failed to complete connection:', err);
      throw err;
    }
  }, [providerId, onAccountsChanged, runValidation]);

  const handleUpdateRoutingMode = useCallback(async (
    accountId: string,
    mode: ProviderAccountRoutingMode
  ) => {
    try {
      await updateRoutingMode(accountId, mode);
      onAccountsChanged();
    } catch (err) {
      console.error('Failed to update routing mode:', err);
    }
  }, [updateRoutingMode, onAccountsChanged]);

  const handleRefreshAccount = useCallback(async (accountId: string) => {
    try {
      await refreshAccount(accountId);
      onAccountsChanged();
    } catch (err) {
      console.error('Failed to refresh account:', err);
    }
  }, [refreshAccount, onAccountsChanged]);

  const handleDeleteAccount = useCallback(async (accountId: string) => {
    try {
      await deleteAccount(accountId);
      onAccountsChanged();
      setShowDeleteConfirm(false);
      if (mode === 'edit') {
        onClose();
      }
    } catch (err) {
      console.error('Failed to delete account:', err);
    }
  }, [deleteAccount, onAccountsChanged, mode, onClose]);

  // ─── 9router-style single-screen Add API Key form ───
  const [addKeyName, setAddKeyName] = useState('');
  const [addKeyValue, setAddKeyValue] = useState('');
  const [addKeyValidation, setAddKeyValidation] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const [addKeySaving, setAddKeySaving] = useState(false);
  const [addKeyError, setAddKeyError] = useState<string | null>(null);

  // Reset add-key form when modal opens
  useEffect(() => {
    if (isOpen && mode === 'add') {
      setAddKeyName('');
      setAddKeyValue('');
      setAddKeyValidation('idle');
      setAddKeySaving(false);
      setAddKeyError(null);
    }
  }, [isOpen, mode]);

  const handleAddKeySave = useCallback(async () => {
    if (!addKeyValue.trim()) return;
    setAddKeySaving(true);
    setAddKeyError(null);
    try {
      await handleCompleteConnection({
        apiKey: addKeyValue.trim(),
        keyName: addKeyName.trim() || 'API Key'
      });
      // Don't close immediately — let the user see the result and dismiss manually.
      // The parent's onAccountsChanged already refreshed the account list.
    } catch (err) {
      setAddKeyError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setAddKeySaving(false);
    }
  }, [addKeyValue, addKeyName, handleCompleteConnection]);

  // Determine if this provider uses only api_key auth (most providers)
  const isApiKeyOnly = supportedAuthTypes.length === 1 && supportedAuthTypes[0] === 'api_key';
  // Determine if this provider is Kiro/OAuth-based (needs the wizard flow)
  const needsWizardFlow = supportedAuthTypes.includes('oauth') || connectionFlow?.type === 'kiro';

  // Auto-start connection for OAuth/Kiro providers
  const autoStarted = useRef(false);
  useEffect(() => {
    if (isOpen && mode === 'add' && needsWizardFlow && !connectionFlow && !autoStarted.current) {
      autoStarted.current = true;
      handleStartConnection(supportedAuthTypes.includes('oauth') ? 'oauth' : supportedAuthTypes[0]);
    }
    if (!isOpen) {
      autoStarted.current = false;
    }
  }, [isOpen, mode, needsWizardFlow, supportedAuthTypes, connectionFlow, handleStartConnection]);

  const renderAddAccountMode = () => {
    // ── API Key only: 9router-style single-screen form ──
    if (isApiKeyOnly) {
      // After successful save, show confirmation
      if (!addKeySaving && !addKeyError && validationResult) {
        return (
          <div className="account-modal-content">
            <div className="modal-header">
              <h2>Account Added</h2>
            </div>
            <div className="step-content">
              <div className={`add-key-badge ${validationResult.status === 'success' ? 'valid' : 'warning'}`}>
                {validationResult.status === 'success'
                  ? <><CheckCircleIcon className="success-icon" /> Connected{validationResult.latencyMs ? ` (${validationResult.latencyMs}ms)` : ''}</>
                  : <><AlertIcon className="error-icon" /> Saved — {validationResult.errorMessage || 'verify manually'}</>
                }
              </div>
            </div>
            <div className="modal-actions">
              <button className="button-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        );
      }

      if (validating) {
        return (
          <div className="account-modal-content">
            <div className="modal-header">
              <h2>Verifying...</h2>
            </div>
            <div className="connection-validating" style={{ padding: 'var(--space-4)', justifyContent: 'center' }}>
              <span className="login-spinner" aria-hidden="true" />
              <span>Verifying connection...</span>
            </div>
            <div className="modal-actions">
              <button className="button-secondary" onClick={onClose}>Done</button>
            </div>
          </div>
        );
      }

      return (
        <div className="account-modal-content">
          <div className="modal-header">
            <h2>Add {providerName} API Key</h2>
          </div>

          <div className="add-key-form">
            <div className="form-group">
              <label htmlFor="add-key-name" className="form-label">Name</label>
              <input
                id="add-key-name"
                type="text"
                className="form-input"
                placeholder="Production Key"
                value={addKeyName}
                onChange={(e) => setAddKeyName(e.target.value)}
                disabled={addKeySaving}
              />
            </div>

            <div className="form-group">
              <label htmlFor="add-key-value" className="form-label">API Key</label>
              <div className="form-input-row">
                <input
                  id="add-key-value"
                  type="password"
                  className="form-input"
                  placeholder="sk-..."
                  value={addKeyValue}
                  onChange={(e) => { setAddKeyValue(e.target.value); setAddKeyValidation('idle'); }}
                  disabled={addKeySaving}
                />
              </div>
            </div>

            {addKeyValidation === 'valid' && (
              <div className="add-key-badge valid">
                <CheckCircleIcon className="success-icon" /> Valid
              </div>
            )}
            {addKeyValidation === 'invalid' && (
              <div className="add-key-badge invalid">
                <AlertIcon className="error-icon" /> Invalid
              </div>
            )}

            {addKeyError && (
              <div className="connection-error">
                <AlertIcon className="error-icon" />
                <span>{addKeyError}</span>
              </div>
            )}
          </div>

          <div className="modal-actions">
            <button className="button-secondary" onClick={onClose} disabled={addKeySaving}>
              Cancel
            </button>
            <button
              className="button-primary"
              onClick={handleAddKeySave}
              disabled={!addKeyValue.trim() || addKeySaving}
            >
              {addKeySaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      );
    }

    // ── Multi-auth or OAuth/Kiro: use the wizard flow ──
    if (!connectionFlow) {
      // Multi-auth picker (rare case — e.g. provider supports both OAuth and API key)
      if (supportedAuthTypes.length > 1 && !needsWizardFlow) {
        return (
          <div className="account-modal-content">
            <div className="modal-header">
              <h2>Add Account to {providerName}</h2>
              <p>Choose how to connect.</p>
            </div>
            <div className="auth-type-options">
              {supportedAuthTypes.map(at => (
                <button
                  key={at}
                  className={`auth-type-option ${selectedAuthType === at ? 'selected' : ''}`}
                  onClick={() => setSelectedAuthType(at)}
                >
                  <div className="auth-type-info">
                    <StatusBadge variant={at === 'oauth' ? 'accent' : 'neutral'} size="sm">
                      {at === 'oauth' ? 'OAuth' : 'API Key'}
                    </StatusBadge>
                    <div className="auth-type-description">
                      {at === 'oauth' && 'Secure OAuth authentication'}
                      {at === 'api_key' && 'Direct API key authentication'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="button-secondary" onClick={onClose}>Cancel</button>
              <button
                className="button-primary"
                onClick={() => handleStartConnection(selectedAuthType)}
                disabled={connecting}
              >
                {connecting ? 'Starting...' : 'Continue'}
              </button>
            </div>
          </div>
        );
      }

      // Waiting for auto-start to kick in
      return (
        <div className="account-modal-content">
          <div className="connection-validating" style={{ padding: 'var(--space-6)', justifyContent: 'center' }}>
            <span className="login-spinner" aria-hidden="true" />
            <span>Preparing connection...</span>
          </div>
        </div>
      );
    }

    // Wizard flow active (OAuth / Kiro device login)
    return (
      <div className="account-modal-content">
        <AccountConnectionFlow
          providerId={providerId}
          authType={selectedAuthType}
          connectionFlow={connectionFlow}
          connecting={connecting}
          error={connectionError}
          onStartConnection={handleStartConnection}
          onCompleteConnection={handleCompleteConnection}
          onCancel={onClose}
          validating={validating}
          validationResult={validationResult}
        />
      </div>
    );
  };

  const renderEditAccountMode = () => {
    if (!editingAccount) return null;

    return (
      <div className="account-modal-content">
        <div className="modal-header">
          <h2>Manage Account</h2>
          <p>Configure settings for {editingAccount.label}</p>
        </div>

        <div className="account-details">
          <div className="account-info-section">
            <h3>Account Information</h3>
            <div className="account-info-grid">
              <div className="info-item">
                <label>Account Name</label>
                <span>{editingAccount.label}</span>
              </div>
              {editingAccount.email && (
                <div className="info-item">
                  <label>Email</label>
                  <span>{editingAccount.email}</span>
                </div>
              )}
              <div className="info-item">
                <label>Authentication</label>
                <StatusBadge
                  variant={editingAccount.authType === 'oauth' ? 'accent' : 'neutral'}
                  size="sm"
                >
                  {editingAccount.authType === 'oauth' ? 'OAuth' : 'API Key'}
                </StatusBadge>
              </div>
              <div className="info-item">
                <label>Status</label>
                <StatusBadge
                  variant={
                    editingAccount.status === 'connected' ? 'success' :
                    editingAccount.status === 'expired' ? 'error' : 'warning'
                  }
                  size="sm"
                >
                  {editingAccount.status}
                </StatusBadge>
              </div>
            </div>
          </div>

          <div className="routing-config-section">
            <h3>Routing Configuration</h3>
            <div className="routing-mode-selector">
              <label htmlFor="routingMode">Routing Mode</label>
              <select
                id="routingMode"
                value={editingAccount.routingMode}
                onChange={(e) => handleUpdateRoutingMode(
                  editingAccount.id,
                  e.target.value as ProviderAccountRoutingMode
                )}
                disabled={isAccountLoading(editingAccount.id)}
              >
                <option value="priority">Priority (Use first)</option>
                <option value="round_robin">Round Robin</option>
                <option value="sticky">Sticky (Session-based)</option>
                <option value="failover_only">Failover Only</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
          </div>

          {editingAccount.tokenStatus && (
            <div className="token-status-section">
              <h3>Token Status</h3>
              <div className="token-info">
                <StatusBadge
                  variant={
                    editingAccount.tokenStatus === 'valid' ? 'success' :
                    editingAccount.tokenStatus === 'expiring' ? 'warning' : 'error'
                  }
                  size="sm"
                >
                  {editingAccount.tokenStatus}
                </StatusBadge>
                {editingAccount.expiresAt && (
                  <span className="token-expiry">
                    Expires: {new Date(editingAccount.expiresAt).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          )}

          {(connectionError || operationError) && (
            <div className="modal-error">
              <AlertIcon className="error-icon" />
              <span>{connectionError || operationError}</span>
            </div>
          )}
        </div>

        <div className="account-actions">
          <div className="account-action-buttons">
            {editingAccount.refreshable && (
              <button
                className="button-secondary"
                onClick={() => handleRefreshAccount(editingAccount.id)}
                disabled={isAccountLoading(editingAccount.id)}
              >
                <RefreshIcon className="button-icon" />
                {getAccountOperation(editingAccount.id) === 'refreshing' ? 'Refreshing...' : 'Refresh Tokens'}
              </button>
            )}
            <button
              className="button-danger"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isAccountLoading(editingAccount.id)}
            >
              <TrashIcon className="button-icon" />
              Delete Account
            </button>
          </div>
        </div>

        <div className="modal-actions">
          <button className="button-secondary" onClick={onClose}>
            Close
          </button>
        </div>

        {showDeleteConfirm && (
          <div className="delete-confirm-overlay">
            <div className="delete-confirm-dialog">
              <h3>Delete Account</h3>
              <p>
                Are you sure you want to delete "{editingAccount.label}"?
                This will remove the account from this provider and cannot be undone.
              </p>
              <div className="delete-confirm-actions">
                <button
                  className="button-secondary"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isAccountLoading(editingAccount.id)}
                >
                  Cancel
                </button>
                <button
                  className="button-danger"
                  onClick={() => handleDeleteAccount(editingAccount.id)}
                  disabled={isAccountLoading(editingAccount.id)}
                >
                  {getAccountOperation(editingAccount.id) === 'deleting' ? 'Deleting...' : 'Delete Account'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderManageAccountsMode = () => (
    <div className="account-modal-content">
      <div className="modal-header">
        <h2>Manage Accounts for {providerName}</h2>
        <p>Configure all accounts connected to this provider.</p>
      </div>

      <div className="accounts-list">
        {accounts.length === 0 ? (
          <div className="no-accounts">
            <p>No accounts connected to this provider.</p>
            <button
              className="button-primary"
              onClick={() => handleStartConnection(supportedAuthTypes[0])}
            >
              Add First Account
            </button>
          </div>
        ) : (
          <div className="accounts-grid">
            {accounts.map(account => (
              <div key={account.id} className="account-summary-card">
                <div className="account-summary-header">
                  <div className="account-name">{account.label}</div>
                  <StatusBadge
                    variant={
                      account.status === 'connected' ? 'success' :
                      account.status === 'expired' ? 'error' : 'warning'
                    }
                    size="sm"
                  >
                    {account.status}
                  </StatusBadge>
                </div>
                <div className="account-summary-details">
                  {account.email && <div className="account-email">{account.email}</div>}
                  <div className="account-routing">Routing: {account.routingMode}</div>
                </div>
                <div className="account-summary-actions">
                  <button
                    className="button-secondary button-sm"
                    onClick={() => {
                      // Switch to edit mode for this account
                      // This would need to be handled by the parent component
                    }}
                  >
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="modal-actions">
        <button className="button-secondary" onClick={onClose}>
          Close
        </button>
        {accounts.length > 0 && (
          <button
            className="button-primary"
            onClick={() => handleStartConnection(supportedAuthTypes[0])}
          >
            Add Another Account
          </button>
        )}
      </div>
    </div>
  );

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card account-management-modal" onClick={(e) => e.stopPropagation()}>
        {mode === 'add' && renderAddAccountMode()}
        {mode === 'edit' && renderEditAccountMode()}
        {mode === 'manage' && renderManageAccountsMode()}
      </div>
    </div>
  );
}