// Account Connection Flow Component
// Handles OAuth flows, Kiro token management, and API key input

import React, { useState, useCallback } from "react";
import { StatusBadge } from "../StatusBadge";
import { LoadingState } from "../LoadingState";
import { CheckCircleIcon, AlertIcon, ExternalLinkIcon } from "../icons";
import type { ConnectionFlow } from "../../features/accounts/accountApi";
import type { ProviderAuthType } from "../../features/providers/providerTypes";
import type { ValidationResult } from "./validateConnection";

interface AccountConnectionFlowProps {
  providerId: string;
  authType: ProviderAuthType;
  connectionFlow: ConnectionFlow | null;
  connecting: boolean;
  error: string | null;
  onStartConnection: (authType: ProviderAuthType) => Promise<void>;
  onCompleteConnection: (data: any) => Promise<void>;
  onCancel: () => void;
  // Post-connection health-check state, supplied by the parent modal after the
  // connection is saved. When omitted, the complete step shows the original
  // static success message (backward compatible).
  validationResult?: ValidationResult | null;
  validating?: boolean;
}

export function AccountConnectionFlow({
  providerId,
  authType,
  connectionFlow,
  connecting,
  error,
  onStartConnection,
  onCompleteConnection,
  onCancel,
  validationResult = null,
  validating = false
}: AccountConnectionFlowProps) {
  const [step, setStep] = useState<'start' | 'authorize' | 'callback' | 'kiro_import' | 'complete'>('start');
  const [callbackUrl, setCallbackUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyName, setApiKeyName] = useState('');
  const [kiroSourcePath, setKiroSourcePath] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Kiro providers are connected by importing accounts from the 9router database
  // rather than running a live OAuth/API-key flow.
  const isKiro = connectionFlow?.type === 'kiro';

  const handleStartConnection = useCallback(async () => {
    try {
      setLocalError(null);
      // The connection flow is already started before this component renders, so for
      // Kiro we just advance to the import step instead of re-initiating the flow.
      if (isKiro) {
        setStep('kiro_import');
        return;
      }
      await onStartConnection(authType);
      if (authType === 'oauth') {
        setStep('authorize');
      } else if (authType === 'api_key') {
        setStep('callback'); // Skip to input step for API keys
      }
    } catch (err) {
      console.error('Failed to start connection:', err);
      setLocalError(err instanceof Error ? err.message : 'Failed to start connection');
    }
  }, [authType, isKiro, onStartConnection]);

  const handleCompleteOAuth = useCallback(async () => {
    if (!callbackUrl.trim()) return;

    try {
      setSubmitting(true);
      setLocalError(null);
      await onCompleteConnection({
        callbackUrl: callbackUrl.trim(),
        state: connectionFlow?.state
      });
      setStep('complete');
    } catch (err) {
      console.error('Failed to complete OAuth:', err);
      setLocalError(err instanceof Error ? err.message : 'Failed to complete OAuth connection');
    } finally {
      setSubmitting(false);
    }
  }, [callbackUrl, connectionFlow?.state, onCompleteConnection]);

  const handleCompleteApiKey = useCallback(async () => {
    if (!apiKey.trim()) return;

    try {
      setSubmitting(true);
      setLocalError(null);
      await onCompleteConnection({
        apiKey: apiKey.trim(),
        keyName: apiKeyName.trim() || 'API Key'
      });
      setStep('complete');
    } catch (err) {
      console.error('Failed to add API key:', err);
      setLocalError(err instanceof Error ? err.message : 'Failed to add API key connection');
    } finally {
      setSubmitting(false);
    }
  }, [apiKey, apiKeyName, onCompleteConnection]);

  const handleCompleteKiroImport = useCallback(async () => {
    try {
      setSubmitting(true);
      setLocalError(null);
      await onCompleteConnection({
        kiroImport: true,
        sourcePath: kiroSourcePath.trim() || undefined
      });
      setStep('complete');
    } catch (err) {
      console.error('Failed to import Kiro accounts:', err);
      setLocalError(err instanceof Error ? err.message : 'Failed to import Kiro accounts');
    } finally {
      setSubmitting(false);
    }
  }, [kiroSourcePath, onCompleteConnection]);

  const renderStartStep = () => (
    <div className="connection-flow-step">
      <div className="step-header">
        <h3>{isKiro ? 'Connect Kiro Account' : 'Connect New Account'}</h3>
        <p>
          {isKiro
            ? 'Import your Kiro accounts from a 9router database to connect this provider.'
            : `Add a new ${authType === 'oauth' ? 'OAuth' : 'API key'} account to this provider.`}
        </p>
      </div>

      <div className="step-content">
        {isKiro && (
          <div className="auth-info">
            <div className="auth-type-badge">
              <StatusBadge variant="accent" size="sm">9router Import</StatusBadge>
            </div>
            <p>{connectionFlow?.instructions || 'Kiro accounts are imported from a 9router database. The proxy then owns token refresh.'}</p>
          </div>
        )}

        {!isKiro && authType === 'oauth' && (
          <div className="auth-info">
            <div className="auth-type-badge">
              <StatusBadge variant="accent" size="sm">OAuth</StatusBadge>
            </div>
            <p>This will start an OAuth flow to connect your account securely.</p>
          </div>
        )}

        {!isKiro && authType === 'api_key' && (
          <div className="auth-info">
            <div className="auth-type-badge">
              <StatusBadge variant="neutral" size="sm">API Key</StatusBadge>
            </div>
            <p>Enter your API key to connect this provider.</p>
          </div>
        )}

        {(error || localError) && (
          <div className="connection-error">
            <AlertIcon className="error-icon" />
            <span>{error || localError}</span>
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
          {connecting ? 'Starting...' : isKiro ? 'Continue to Import' : 'Start Connection'}
        </button>
      </div>
    </div>
  );

  const renderKiroImportStep = () => (
    <div className="connection-flow-step">
      <div className="step-header">
        <h3>Import Kiro Accounts</h3>
        <p>Import Kiro accounts from a 9router database. Leave the path empty to use the default location.</p>
      </div>

      <div className="step-content">
        <div className="form-group">
          <label htmlFor="kiroSourcePath">Source Database Path (Optional)</label>
          <input
            id="kiroSourcePath"
            type="text"
            className="form-input"
            placeholder="~/.9router/db/data.sqlite"
            value={kiroSourcePath}
            onChange={(e) => setKiroSourcePath(e.target.value)}
            disabled={submitting}
          />
          <small className="form-help">Default: ~/.9router/db/data.sqlite</small>
        </div>

        {(error || localError) && (
          <div className="connection-error">
            <AlertIcon className="error-icon" />
            <span>{error || localError}</span>
          </div>
        )}
      </div>

      <div className="step-actions">
        <button
          className="button-secondary"
          onClick={() => setStep('start')}
          disabled={submitting}
        >
          Back
        </button>
        <button
          className="button-primary"
          onClick={handleCompleteKiroImport}
          disabled={submitting}
        >
          {submitting ? 'Importing...' : 'Import Accounts'}
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

            {(error || localError) && (
              <div className="connection-error">
                <AlertIcon className="error-icon" />
                <span>{error || localError}</span>
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

          {(error || localError) && (
            <div className="connection-error">
              <AlertIcon className="error-icon" />
              <span>{error || localError}</span>
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

  // Renders the pass/fail breakdown of the four health checks (AC 2.4).
  const renderCheckList = (checks: NonNullable<ValidationResult['checks']>) => {
    const items: Array<{ label: string; ok: boolean }> = [
      { label: 'Authentication', ok: checks.authOk },
      { label: 'Quota', ok: checks.quotaOk },
      { label: 'Model access', ok: checks.modelOk },
      { label: 'Routing', ok: checks.routingOk }
    ];

    return (
      <ul className="validation-check-list">
        {items.map((item) => (
          <li key={item.label} className={item.ok ? 'check-pass' : 'check-fail'}>
            {item.ok ? (
              <CheckCircleIcon className="success-icon" />
            ) : (
              <AlertIcon className="error-icon" />
            )}
            <span>{item.label}: {item.ok ? 'Passed' : 'Did not pass'}</span>
          </li>
        ))}
      </ul>
    );
  };

  // The Done button is always rendered so the user can dismiss the modal at any
  // point, even while validation is still running (AC 2.7).
  const renderDoneAction = () => (
    <div className="step-actions">
      <button
        className="button-primary"
        onClick={onCancel}
      >
        Done
      </button>
    </div>
  );

  const renderCompleteStep = () => {
    // AC 2.8: health check in progress — show a spinner and status text.
    if (validating) {
      return (
        <div className="connection-flow-step">
          <div className="step-header">
            <h3>Verifying connection</h3>
            <p>Running a quick health check against the new account.</p>
          </div>

          <div className="step-content">
            <div className="connection-validating">
              <span className="login-spinner" aria-hidden="true" />
              <span>Verifying connection...</span>
            </div>
          </div>

          {renderDoneAction()}
        </div>
      );
    }

    // Health check finished — render based on the result status.
    if (validationResult) {
      // AC 2.2: success — green check plus measured latency.
      if (validationResult.status === 'success') {
        const latency =
          typeof validationResult.latencyMs === 'number'
            ? ` (${validationResult.latencyMs}ms)`
            : '';
        return (
          <div className="connection-flow-step">
            <div className="step-header">
              <CheckCircleIcon className="success-icon" />
              <h3>Connection Verified</h3>
              <p>{`Connected successfully${latency}.`}</p>
            </div>

            <div className="step-content">
              <div className="success-message">
                <p>The new account responded to a health check and is ready to use.</p>
              </div>
            </div>

            {renderDoneAction()}
          </div>
        );
      }

      // AC 2.4: partial — informational notice listing which checks passed.
      if (validationResult.status === 'partial') {
        return (
          <div className="connection-flow-step">
            <div className="step-header">
              <CheckCircleIcon className="success-icon" />
              <h3>Connection Saved — Partial Check</h3>
              <p>Your account was saved, but some health checks did not pass.</p>
            </div>

            <div className="step-content">
              <div className="connection-notice">
                <p>Health check results:</p>
                {validationResult.checks && renderCheckList(validationResult.checks)}
              </div>
            </div>

            {renderDoneAction()}
          </div>
        );
      }

      // AC 2.6: timeout — warning that validation timed out.
      if (validationResult.status === 'timeout') {
        return (
          <div className="connection-flow-step">
            <div className="step-header">
              <AlertIcon className="error-icon" />
              <h3>Connection Saved — Validation Timed Out</h3>
              <p>Your account was saved, but we couldn't verify it in time.</p>
            </div>

            <div className="step-content">
              <div className="connection-warning">
                <AlertIcon className="error-icon" />
                <span>Validation timed out. Test manually.</span>
              </div>
            </div>

            {renderDoneAction()}
          </div>
        );
      }

      // AC 2.3: failed — warning with error message and suggested fix.
      return (
        <div className="connection-flow-step">
          <div className="step-header">
            <AlertIcon className="error-icon" />
            <h3>Connection Saved — Validation Failed</h3>
            <p>Your account was saved, but the health check did not pass.</p>
          </div>

          <div className="step-content">
            <div className="connection-warning">
              <AlertIcon className="error-icon" />
              <div className="connection-warning-body">
                <span>{validationResult.errorMessage || 'Validation failed.'}</span>
                {validationResult.suggestedFix && (
                  <span className="connection-warning-fix">{validationResult.suggestedFix}</span>
                )}
              </div>
            </div>
          </div>

          {renderDoneAction()}
        </div>
      );
    }

    // Backward-compatible fallback: no validation supplied (validationResult is
    // null/undefined and validating is false) — show the original static
    // success message.
    return (
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

        {renderDoneAction()}
      </div>
    );
  };

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
        {step === 'kiro_import' && renderKiroImportStep()}
        {step === 'complete' && renderCompleteStep()}
      </div>
    </div>
  );
}