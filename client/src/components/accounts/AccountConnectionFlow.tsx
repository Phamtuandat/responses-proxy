// Account Connection Flow Component
// Handles OAuth flows, Kiro token management, API key input, and device login

import React, { useState, useCallback, useEffect, useRef } from "react";
import { StatusBadge } from "../StatusBadge";
import { LoadingState } from "../LoadingState";
import { CheckCircleIcon, AlertIcon, ExternalLinkIcon } from "../icons";
import { startKiroDeviceLogin, pollKiroDeviceLogin } from "../../api/client";
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
  const [step, setStep] = useState<'start' | 'authorize' | 'callback' | 'device_login' | 'complete'>('start');
  const [callbackUrl, setCallbackUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyName, setApiKeyName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Device login state
  const [deviceLoginPhase, setDeviceLoginPhase] = useState<'picker' | 'waiting' | 'done' | 'error'>('picker');
  const [deviceAuthMethod, setDeviceAuthMethod] = useState<'builder_id' | 'idc'>('builder_id');
  const [deviceStartUrl, setDeviceStartUrl] = useState('');
  const [deviceRegion, setDeviceRegion] = useState('us-east-1');
  const [deviceSessionId, setDeviceSessionId] = useState<string | null>(null);
  const [deviceUserCode, setDeviceUserCode] = useState('');
  const [deviceVerificationUri, setDeviceVerificationUri] = useState('');
  const [deviceVerificationUriComplete, setDeviceVerificationUriComplete] = useState('');
  const [deviceInterval, setDeviceInterval] = useState(5);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Kiro providers are connected by importing accounts from the 9router database
  // rather than running a live OAuth/API-key flow.
  const isKiro = connectionFlow?.type === 'kiro';

  // For API key providers, skip the "start" step and go directly to the input
  // when the connectionFlow is already initialized (the parent already started it).
  // For Kiro providers, skip directly to device login (no more 9router import option).
  useEffect(() => {
    if (step === 'start' && connectionFlow) {
      if (isKiro) {
        // Go straight to device login — no intermediate start screen
        setDeviceLoginPhase('picker');
        setStep('device_login');
      } else if (authType === 'api_key' && connectionFlow.type === 'api_key') {
        setStep('callback');
      } else if (authType === 'oauth' && connectionFlow.type === 'oauth') {
        setStep('authorize');
      }
    }
  }, [step, connectionFlow, authType, isKiro]);

  // Clean up polling interval when step changes or component unmounts
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [step]);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const handleDeviceLoginStart = useCallback(async () => {
    try {
      setLocalError(null);
      setDeviceError(null);
      setSubmitting(true);

      const input: { authMethod: 'builder_id' | 'idc'; startUrl?: string; region?: string } = {
        authMethod: deviceAuthMethod,
      };
      if (deviceAuthMethod === 'idc') {
        input.startUrl = deviceStartUrl.trim();
        input.region = deviceRegion.trim();
      }

      const result = await startKiroDeviceLogin(input);
      setDeviceSessionId(result.sessionId);
      setDeviceUserCode(result.userCode);
      setDeviceVerificationUri(result.verificationUri);
      setDeviceVerificationUriComplete(result.verificationUriComplete);
      setDeviceInterval(result.interval);
      setDeviceLoginPhase('waiting');
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : 'Failed to start device login');
      setDeviceLoginPhase('error');
    } finally {
      setSubmitting(false);
    }
  }, [deviceAuthMethod, deviceStartUrl, deviceRegion]);

  // Start polling when entering the waiting phase
  useEffect(() => {
    if (step !== 'device_login' || deviceLoginPhase !== 'waiting' || !deviceSessionId) {
      return;
    }

    const poll = async () => {
      try {
        const result = await pollKiroDeviceLogin(deviceSessionId);

        if (result.status === 'pending') {
          // Update interval if server changed it (e.g. slow_down)
          if (result.interval && result.interval !== deviceInterval) {
            setDeviceInterval(result.interval);
            // Restart interval with new timing
            stopPolling();
            pollIntervalRef.current = setInterval(poll, result.interval * 1000);
          }
        } else if (result.status === 'completed') {
          stopPolling();
          setDeviceLoginPhase('done');
          // Notify parent so it can trigger validation
          await onCompleteConnection({ kiroDeviceLogin: true, accountId: result.account?.id });
          setStep('complete');
        } else if (result.status === 'expired') {
          stopPolling();
          setDeviceError('Login expired. Please try again.');
          setDeviceLoginPhase('error');
        } else if (result.status === 'error') {
          stopPolling();
          setDeviceError(result.error?.message || 'Device login failed.');
          setDeviceLoginPhase('error');
        }
      } catch (err) {
        stopPolling();
        setDeviceError(err instanceof Error ? err.message : 'Polling failed.');
        setDeviceLoginPhase('error');
      }
    };

    // Start polling at the server-returned interval
    pollIntervalRef.current = setInterval(poll, deviceInterval * 1000);

    return () => {
      stopPolling();
    };
  }, [step, deviceLoginPhase, deviceSessionId, deviceInterval, stopPolling, onCompleteConnection]);

  const handleStartConnection = useCallback(async () => {
    try {
      setLocalError(null);
      // For Kiro providers, the auto-advance effect handles routing to device_login.
      // This fallback handles the case where the effect hasn't fired yet.
      if (isKiro) {
        setStep('device_login');
        setDeviceLoginPhase('picker');
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

  const renderStartStep = () => (
    <div className="connection-flow-step">
      <div className="step-header">
        <h3>Connect New Account</h3>
        <p>{`Add a new ${authType === 'oauth' ? 'OAuth' : 'API key'} account to this provider.`}</p>
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
          {connecting ? 'Starting...' : 'Start Connection'}
        </button>
      </div>
    </div>
  );

  const renderDeviceLoginStep = () => {
    // Phase: picker — choose Builder ID or IDC
    if (deviceLoginPhase === 'picker') {
      return (
        <div className="connection-flow-step">
          <div className="step-header">
            <h3>Sign In with Device Code</h3>
            <p>Choose your authentication method to connect a Kiro account.</p>
          </div>

          <div className="step-content">
            <div className="form-group">
              <label>Authentication Method</label>
              <div className="auth-method-cards">
                <button
                  type="button"
                  className={`auth-method-card ${deviceAuthMethod === 'builder_id' ? 'selected' : ''}`}
                  onClick={() => setDeviceAuthMethod('builder_id')}
                >
                  <strong>AWS Builder ID</strong>
                  <span>Personal account</span>
                </button>
                <button
                  type="button"
                  className={`auth-method-card ${deviceAuthMethod === 'idc' ? 'selected' : ''}`}
                  onClick={() => setDeviceAuthMethod('idc')}
                >
                  <strong>IAM Identity Center</strong>
                  <span>Enterprise</span>
                </button>
              </div>
            </div>

            {deviceAuthMethod === 'idc' && (
              <>
                <div className="form-group">
                  <label htmlFor="deviceStartUrl">Start URL *</label>
                  <input
                    id="deviceStartUrl"
                    type="text"
                    className="form-input"
                    placeholder="https://my-org.awsapps.com/start"
                    value={deviceStartUrl}
                    onChange={(e) => setDeviceStartUrl(e.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="deviceRegion">Region *</label>
                  <input
                    id="deviceRegion"
                    type="text"
                    className="form-input"
                    placeholder="us-east-1"
                    value={deviceRegion}
                    onChange={(e) => setDeviceRegion(e.target.value)}
                    disabled={submitting}
                  />
                </div>
              </>
            )}

            {(deviceError || localError) && (
              <div className="connection-error">
                <AlertIcon className="error-icon" />
                <span>{deviceError || localError}</span>
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
              onClick={handleDeviceLoginStart}
              disabled={submitting || (deviceAuthMethod === 'idc' && (!deviceStartUrl.trim() || !deviceRegion.trim()))}
            >
              {submitting ? 'Starting...' : 'Start Device Login'}
            </button>
          </div>
        </div>
      );
    }

    // Phase: waiting — show user code and poll
    if (deviceLoginPhase === 'waiting') {
      return (
        <div className="connection-flow-step">
          <div className="step-header">
            <h3>Enter Code in Browser</h3>
            <p>Enter the code above on the verification page</p>
          </div>

          <div className="step-content">
            <div className="device-user-code">{deviceUserCode}</div>

            <div className="auth-url-section">
              <a
                href={deviceVerificationUriComplete}
                target="_blank"
                rel="noopener noreferrer"
                className="auth-url-link"
              >
                <ExternalLinkIcon className="link-icon" />
                Open verification page
              </a>
            </div>

            <div className="connection-validating">
              <span className="login-spinner" aria-hidden="true" />
              <span>Waiting for browser approval...</span>
            </div>
          </div>

          <div className="step-actions">
            <button
              className="button-secondary"
              onClick={() => {
                stopPolling();
                onCancel();
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }

    // Phase: error — show error with retry
    if (deviceLoginPhase === 'error') {
      return (
        <div className="connection-flow-step">
          <div className="step-header">
            <h3>Device Login Failed</h3>
            <p>Something went wrong during the device login flow.</p>
          </div>

          <div className="step-content">
            <div className="connection-error">
              <AlertIcon className="error-icon" />
              <span>{deviceError || 'An unknown error occurred.'}</span>
            </div>
          </div>

          <div className="step-actions">
            <button
              className="button-secondary"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className="button-primary"
              onClick={() => {
                setDeviceError(null);
                setDeviceLoginPhase('picker');
              }}
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    // Phase: done — brief success before transition to 'complete'
    return (
      <div className="connection-flow-step">
        <div className="step-header">
          <CheckCircleIcon className="success-icon" />
          <h3>Device Login Successful</h3>
          <p>Your Kiro account has been connected.</p>
        </div>

        <div className="step-content">
          <div className="success-message">
            <p>Account connected successfully via device code flow.</p>
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
  };

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
        {step === 'device_login' && renderDeviceLoginStep()}
        {step === 'complete' && renderCompleteStep()}
      </div>
    </div>
  );
}