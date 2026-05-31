// Account Management Modal Component
// Unified interface for adding, editing, and managing provider accounts

import React, { useState, useCallback, useEffect } from "react";
import { StatusBadge } from "../StatusBadge";
import { AccountConnectionFlow } from "./AccountConnectionFlow";
import { CheckCircleIcon, AlertIcon, TrashIcon, RefreshIcon } from "../icons";
import type { AccountConnection } from "../../features/accounts/accountApi";
import type { ProviderAuthType, ProviderAccountRoutingMode } from "../../features/providers/providerTypes";
import { useAccountConnection, useAccountOperations } from "../../features/accounts/accountHooks";

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

  const handleCompleteConnection = useCallback(async (data: any) => {
    try {
      // Handle different completion types
      if (data.callbackUrl) {
        // OAuth completion
        const response = await fetch('/api/chatgpt-oauth/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callbackUrl: data.callbackUrl,
            state: data.state
          })
        });

        if (!response.ok) {
          throw new Error('Failed to complete OAuth flow');
        }
      } else if (data.apiKey) {
        // API key addition - this would need backend support
        console.log('API key addition not yet implemented:', data);
        throw new Error('API key addition not yet implemented');
      }

      // Refresh accounts and close modal
      onAccountsChanged();
      onClose();
    } catch (err) {
      console.error('Failed to complete connection:', err);
      throw err;
    }
  }, [onAccountsChanged, onClose]);

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

  const renderAddAccountMode = () => (
    <div className="account-modal-content">
      <div className="modal-header">
        <h2>Add Account to {providerName}</h2>
        <p>Connect a new account to enable this provider for routing.</p>
      </div>

      {!connectionFlow ? (
        <div className="auth-type-selection">
          <div className="auth-types">
            <h3>Select Authentication Method</h3>
            <div className="auth-type-options">
              {supportedAuthTypes.map(authType => (
                <button
                  key={authType}
                  className={`auth-type-option ${selectedAuthType === authType ? 'selected' : ''}`}
                  onClick={() => setSelectedAuthType(authType)}
                >
                  <div className="auth-type-info">
                    <StatusBadge
                      variant={authType === 'oauth' ? 'accent' : 'neutral'}
                      size="sm"
                    >
                      {authType === 'oauth' ? 'OAuth' : 'API Key'}
                    </StatusBadge>
                    <div className="auth-type-description">
                      {authType === 'oauth' && 'Secure OAuth authentication'}
                      {authType === 'api_key' && 'Direct API key authentication'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {(connectionError || operationError) && (
            <div className="modal-error">
              <AlertIcon className="error-icon" />
              <span>{connectionError || operationError}</span>
            </div>
          )}

          <div className="modal-actions">
            <button className="button-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="button-primary"
              onClick={() => handleStartConnection(selectedAuthType)}
              disabled={connecting}
            >
              {connecting ? 'Starting...' : 'Continue'}
            </button>
          </div>
        </div>
      ) : (
        <AccountConnectionFlow
          providerId={providerId}
          authType={selectedAuthType}
          connectionFlow={connectionFlow}
          connecting={connecting}
          error={connectionError}
          onStartConnection={handleStartConnection}
          onCompleteConnection={handleCompleteConnection}
          onCancel={onClose}
        />
      )}
    </div>
  );

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