// Account Connection Flow Component
// Handles OAuth flows, Kiro token management, and API key input

import React, { useState, useCallback } from "react";
import { StatusBadge } from "../StatusBadge";
import { LoadingState } from "../LoadingState";
import { CheckCircleIcon, AlertIcon, ExternalLinkIcon } from "../icons";
import type { ConnectionFlow } from "../../features/accounts/accountApi";
import type { ProviderAuthType } from "../../features/providers/providerTypes";

interface AccountConnectionFlowProps {
  providerId: string;
  authType: ProviderAuthType;
  connectionFlow: ConnectionFlow | null;
  connecting: boolean;
  error: string | null;
  onStartConnection: (authType: ProviderAuthType) => Promise<void>;
  onCompleteConnection: (data: any) => Promise<void>;
  onCancel: () => void;
}

export function AccountConnectionFlow({
  providerId,
  authType,
  connectionFlow,
  connecting,
  error,
  onStartConnection,
  onCompleteConnection,
  onCancel
}: AccountConnectionFlowProps) {
  const [step, setStep] = useState<'start' | 'authorize' | 'callback' | 'complete'>('start');
  const [callbackUrl, setCallbackUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyName, setApiKeyName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleStartConnection = useCallback(async () => {
    try {
      await onStartConnection(authType);
      if (authType === 'oauth') {
        setStep('authorize');
      } else if (authType === 'api_key') {
        setStep('callback'); // Skip to input step for API keys
      }
    } catch (err) {
      console.error('Failed to start connection:', err);
    }
  }, [authType, onStartConnection]);

  const handleCompleteOAuth = useCallback(async () => {
    if (!callbackUrl.trim()) return;

    try {
      setSubmitting(true);
      await onCompleteConnection({
        callbackUrl: callbackUrl.trim(),
        state: connectionFlow?.state
      });
      setStep('complete');
    } catch (err) {
      console.error('Failed to complete OAuth:', err);
    } finally {
      setSubmitting(false);
    }
  }, [callbackUrl, connectionFlow?.state, onCompleteConnection]);

  const handleCompleteApiKey = useCallback(async () => {
    if (!apiKey.trim()) return;

    try {
      setSubmitting(true);
      await onCompleteConnection({
        apiKey: apiKey.trim(),
        keyName: apiKeyName.trim() || 'API Key'
      });
      setStep('complete');
    } catch (err) {
      console.error('Failed to add API key:', err);
    } finally {
      setSubmitting(false);
    }
  }, [apiKey, apiKeyName, onCompleteConnection]);

  const renderStartStep = () => (
    <div className="connection-flow-step">
      <div className="step-header">
        <h3>Connect New Account</h3>
        <p>Add a new {authType === 'oauth' ? 'OAuth' : 'API key'} account to this provider.</p>
      </div>

      <div className="step-content">
        {authType === 'oauth' && (
          <div className="auth-info">
            <div className="auth-type-badge">
              <StatusBadge variant="accent" size="sm">OAuth</StatusBadge>
            </div>
            <p>This will start an OAuth flow to connect your account securely.</p>
          </div>
        )}

        {authType === 'api_key' && (
          <div className="auth-info">
            <div className="auth-type-badge">
              <StatusBadge variant="neutral" size="sm">API Key</StatusBadge>
            </div>
            <p>Enter your API key to connect this provider.</p>
          </div>
        )}

        {error && (
          <div className="connection-error">
            <AlertIcon className="error-icon" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="step-actions">
        <button
          className="button-secondary"
          onClick={onCancel}
          disabled={connecting}
        >
          Cancel
        </button>
        <button
          className="button-primary"
          onClick={handleStartConnection}
          disabled={connecting}
        >
          {connecting ? 'Starting...' : 'Start Connection'}
        </button>
      </div>
    </div>
  );

  const renderAuthorizeStep = () => (
    <div className="connection-flow-step">
      <div className="step-header">
        <h3>Authorize Account</h3>
        <p>Click the link below to authorize with the provider.</p>
      </div>

      <div className="step-content">
        {connectionFlow?.authUrl && (
          <div className="auth-url-section">
            <div className="auth-url-container">
              <a
                href={connectionFlow.authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="auth-url-link"
              >
                <ExternalLinkIcon className="link-icon" />
                Open Authorization Page
              </a>
            </div>
            <p className="auth-instructions">
              {connectionFlow.instructions || 'Complete the authorization and return here.'}
            </p>
          </div>
        )}

        {connectionFlow?.requiresCallback && (
          <div className="callback-section">
            <p>After authorizing, you'll be redirected to a callback URL. Copy and paste that URL below:</p>
            <button
              className="button-secondary"
              onClick={() => setStep('callback')}
            >
              I've Completed Authorization
            </button>
          </div>
        )}
      </div>

      <div className="step-actions">
        <button
          className="button-secondary"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );

  const renderCallbackStep = () => {
    if (authType === 'api_key') {
      return (
        <div className="connection-flow-step">
          <div className="step-header">
            <h3>Enter API Key</h3>
            <p>Provide your API key and an optional name for this connection.</p>
          </div>

          <div className="step-content">
            <div className="form-group">
              <label htmlFor="apiKey">API Key *</label>
              <input
                id="apiKey"
                type="password"
                className="form-input"
                placeholder="Enter your API key..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="form-group">
              <label htmlFor="apiKeyName">Key Name (Optional)</label>
              <input
                id="apiKeyName"
                type="text"
                className="form-input"
                placeholder="e.g., Production Key, Development Key"
                value={apiKeyName}
                onChange={(e) => setApiKeyName(e.target.value)}
                disabled={submitting}
              />
            </div>

            {error && (
              <div className="connection-error">
                <AlertIcon className="error-icon" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="step-actions">
            <button
              className="button-secondary"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              className="button-primary"
              onClick={handleCompleteApiKey}
              disabled={!apiKey.trim() || submitting}
            >
              {submitting ? 'Adding...' : 'Add API Key'}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="connection-flow-step">
        <div className="step-header">
          <h3>Complete Authorization</h3>
          <p>Paste the callback URL you were redirected to after authorization.</p>
        </div>

        <div className="step-content">
          <div className="form-group">
            <label htmlFor="callbackUrl">Callback URL *</label>
            <textarea
              id="callbackUrl"
              className="form-textarea"
              placeholder="Paste the full callback URL here..."
              value={callbackUrl}
              onChange={(e) => setCallbackUrl(e.target.value)}
              disabled={submitting}
              rows={3}
            />
          </div>

          <div className="callback-help">
            <p>The callback URL should look something like:</p>
            <code>https://chat.openai.com/auth/callback?code=...</code>
          </div>

          {error && (
            <div className="connection-error">
              <AlertIcon className="error-icon" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="step-actions">
          <button
            className="button-secondary"
            onClick={() => setStep('authorize')}
            disabled={submitting}
          >
            Back
          </button>
          <button
            className="button-primary"
            onClick={handleCompleteOAuth}
            disabled={!callbackUrl.trim() || submitting}
          >
            {submitting ? 'Completing...' : 'Complete Connection'}
          </button>
        </div>
      </div>
    );
  };

  const renderCompleteStep = () => (
    <div className="connection-flow-step">
      <div className="step-header">
        <CheckCircleIcon className="success-icon" />
        <h3>Connection Successful</h3>
        <p>Your account has been connected successfully.</p>
      </div>

      <div className="step-content">
        <div className="success-message">
          <p>The new account is now available for this provider and will be included in the routing configuration.</p>
        </div>
      </div>

      <div className="step-actions">
        <button
          className="button-primary"
          onClick={onCancel}
        >
          Done
        </button>
      </div>
    </div>
  );

  if (connecting && !connectionFlow) {
    return (
      <div className="connection-flow">
        <LoadingState
          title="Starting connection"
          description="Preparing account connection flow..."
          cards={1}
        />
      </div>
    );
  }

  return (
    <div className="connection-flow">
      <div className="connection-flow-container">
        {step === 'start' && renderStartStep()}
        {step === 'authorize' && renderAuthorizeStep()}
        {step === 'callback' && renderCallbackStep()}
        {step === 'complete' && renderCompleteStep()}
      </div>
    </div>
  );
}