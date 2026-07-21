import React, { useState, useEffect } from 'react';
import { SplitLayout } from './components/SplitLayout';
import { ExplorerTree } from './components/ExplorerTree';
import { DetailsPanel } from './components/DetailsPanel';
import type { ClusterConfig, ConnectedCluster, AuthConfig, SavedProfile } from './shared/types';
import { dlog } from './utils/log';
import './App.css';

interface TreeNode {
  id: string;
  type: 'tenant' | 'namespace' | 'topic';
  label: string;
  expanded: boolean;
  children?: TreeNode[];
  loading?: boolean;
  fullPath?: string;
}

type AuthType = 'token' | 'oauth';

interface AppState {
  screen: 'splash' | 'profile-selection' | 'form' | 'connected';
  savedProfiles?: SavedProfile[];
}

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>({ screen: 'splash' });
  const [connectedCluster, setConnectedCluster] = useState<ConnectedCluster | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [apiReady, setApiReady] = useState(false);
  const [savedProfiles, setSavedProfiles] = useState<SavedProfile[]>([]);
  const [pulsarVersion, setPulsarVersion] = useState<string | null>(null);

  // Connection form state
  const [clusterName, setClusterName] = useState('Local Pulsar');
  const [adminUrl, setAdminUrl] = useState('http://localhost:8080');
  const [serviceUrl, setServiceUrl] = useState('pulsar://localhost:6650');
  const [authType, setAuthType] = useState<AuthType>('token');
  
  // Token auth fields
  const [authToken, setAuthToken] = useState('');
  
  // OAuth auth fields
  const [oauthClientId, setOAuthClientId] = useState('');
  const [oauthClientSecret, setOAuthClientSecret] = useState('');
  const [oauthIssuerUrl, setOAuthIssuerUrl] = useState('');
  const [oauthAudience, setOAuthAudience] = useState('');
  const [oauthScopes, setOAuthScopes] = useState('');

  const hasAPI = typeof window !== 'undefined' && (window as any).lightcurve?.cluster;

  // Bridge main-process logs into the renderer console for easier debugging
  useEffect(() => {
    const unsubscribe = (window as any).lightcurve?.logs?.onLog?.((payload: { level: string; args: string[] }) => {
      const level = payload.level as keyof Console;
      const fn = (console[level] as ((...args: unknown[]) => void)) || console.log;
      fn.apply(console, ['[main]', ...payload.args]);
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    dlog('[App] mounted, hasAPI:', hasAPI, 'lightcurve:', (window as any).lightcurve);
    // Check API availability periodically until ready
    if (hasAPI) {
      setApiReady(true);
      loadProfiles();
    } else {
      // Poll for the preload bridge, but give up after a bounded window so we
      // never spin forever if the desktop API never shows up (e.g. plain Vite URL).
      const MAX_WAIT_MS = 10000;
      const POLL_MS = 100;
      let waited = 0;
      const checkInterval = setInterval(() => {
        const isReady = typeof window !== 'undefined' && (window as any).lightcurve?.cluster;
        if (isReady) {
          dlog('[App] API became ready');
          setApiReady(true);
          loadProfiles();
          clearInterval(checkInterval);
          return;
        }
        waited += POLL_MS;
        if (waited >= MAX_WAIT_MS) {
          console.warn('[App] Desktop API did not become available; showing connection screen');
          clearInterval(checkInterval);
          // Render the (no-API) connection screen instead of an endless splash
          setApiReady(true);
        }
      }, POLL_MS);
      return () => clearInterval(checkInterval);
    }
  }, [hasAPI]);

  const loadProfiles = async () => {
    try {
      const response = await (window as any).lightcurve?.profiles?.listProfiles?.();
      if (response?.success && response.data) {
        setSavedProfiles(response.data);
        if (response.data.length > 0) {
          setAppState({ screen: 'profile-selection', savedProfiles: response.data });
        } else {
          setAppState({ screen: 'form' });
        }
      } else {
        setAppState({ screen: 'form' });
      }
    } catch (error) {
      console.error('Error loading profiles:', error);
      setAppState({ screen: 'form' });
    }
  };

  const loadProfile = (profile: SavedProfile) => {
    setClusterName(profile.name);
    setAdminUrl(profile.adminUrl);
    setServiceUrl(profile.serviceUrl);

    if (profile.auth?.type === 'token') {
      setAuthType('token');
      setAuthToken(profile.auth.token);
    } else if (profile.auth?.type === 'oauth') {
      setAuthType('oauth');
      setOAuthClientId(profile.auth.oauth.clientId);
      setOAuthClientSecret(profile.auth.oauth.clientSecret);
      setOAuthIssuerUrl(profile.auth.oauth.issuerUrl);
      setOAuthAudience(profile.auth.oauth.audience);
      setOAuthScopes(profile.auth.oauth.scopes?.join(' ') || '');
    }
  };

  const handleLoadProfile = (profile: SavedProfile) => {
    loadProfile(profile);
    setAppState({ screen: 'form' });
  };

  const handleConnectProfile = async (profile: SavedProfile) => {
    setConnecting(true);
    setConnectionError(null);

    const config: ClusterConfig = {
      clusterId: `cluster_${Date.now()}`,
      name: profile.name,
      adminUrl: profile.adminUrl,
      serviceUrl: profile.serviceUrl,
      auth: profile.auth,
    };

    try {
      const response = await window.lightcurve.cluster.connect(config);
      if (response.success && response.data) {
        setConnectedCluster(response.data);
        setAppState({ screen: 'connected' });
      } else {
        setConnectionError(response.error || 'Failed to connect');
        setAppState({ screen: 'profile-selection', savedProfiles });
      }
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : 'Connection failed');
      setAppState({ screen: 'profile-selection', savedProfiles });
    } finally {
      setConnecting(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!hasAPI) return;

    const auth: AuthConfig | undefined = 
      authType === 'token' && authToken.trim() 
        ? { type: 'token', token: authToken }
        : authType === 'oauth' && oauthClientId && oauthClientSecret && oauthIssuerUrl && oauthAudience
        ? {
            type: 'oauth',
            oauth: {
              type: 'client_credentials',
              clientId: oauthClientId,
              clientSecret: oauthClientSecret,
              issuerUrl: oauthIssuerUrl,
              audience: oauthAudience,
              scopes: oauthScopes.trim() ? oauthScopes.trim().split(/\s+/) : undefined,
            },
          }
        : undefined;

    try {
      const response = await (window as any).lightcurve?.profiles?.saveProfile?.({
        name: clusterName,
        adminUrl,
        serviceUrl,
        auth,
      });

      if (response?.success) {
        await loadProfiles();
        setConnectionError(null);
        return true;
      } else {
        setConnectionError('Failed to save profile');
        return false;
      }
    } catch (error) {
      setConnectionError('Error saving profile');
      console.error('Error saving profile:', error);
      return false;
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    if (!hasAPI) return;

    try {
      const response = await (window as any).lightcurve?.profiles?.deleteProfile?.(profileId);
      if (response?.success) {
        await loadProfiles();
      }
    } catch (error) {
      console.error('Error deleting profile:', error);
    }
  };

  const handleConnect = async () => {
    if (!hasAPI) {
      setConnectionError('Desktop API unavailable. Please run the Electron app (npm run dev) instead of opening the Vite URL directly.');
      return;
    }
    setConnecting(true);
    setConnectionError(null);

    const config: ClusterConfig = {
      clusterId: `cluster_${Date.now()}`,
      name: clusterName,
      adminUrl,
      serviceUrl,
    };

    // Build auth config based on selected auth type
    if (authType === 'token' && authToken.trim()) {
      config.auth = {
        type: 'token',
        token: authToken,
      };
    } else if (authType === 'oauth' && oauthClientId && oauthClientSecret && oauthIssuerUrl && oauthAudience) {
      config.auth = {
        type: 'oauth',
        oauth: {
          type: 'client_credentials',
          clientId: oauthClientId,
          clientSecret: oauthClientSecret,
          issuerUrl: oauthIssuerUrl,
          audience: oauthAudience,
          scopes: oauthScopes.trim() ? oauthScopes.trim().split(/\s+/) : undefined,
        },
      };
    }

    try {
      const response = await window.lightcurve.cluster.connect(config);
      if (response.success && response.data) {
        setConnectedCluster(response.data);
        setAppState({ screen: 'connected' });
      } else {
        setConnectionError(response.error || 'Failed to connect');
      }
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!connectedCluster) return;
    if (!hasAPI) return;

    try {
      await window.lightcurve.cluster.disconnect(connectedCluster.clusterId);
      setConnectedCluster(null);
      setSelectedNode(null);
      setPulsarVersion(null);
      setAppState(savedProfiles.length > 0 ? { screen: 'profile-selection', savedProfiles } : { screen: 'form' });
    } catch (err) {
      console.error('Error disconnecting:', err);
    }
  };

  // Fetch Pulsar version when cluster connects
  useEffect(() => {
    dlog('[App] Version fetch effect - connectedCluster:', !!connectedCluster, 'screen:', appState.screen);
    if (connectedCluster && appState.screen === 'connected') {
      const fetchVersion = async () => {
        try {
          dlog('[App] Attempting to fetch broker version for cluster:', connectedCluster.clusterId);
          dlog('[App] window.lightcurve?.admin:', (window as any).lightcurve?.admin);
          const response = await (window as any).lightcurve?.admin?.getBrokerVersion?.(connectedCluster.clusterId);
          dlog('[App] Broker version response:', response);
          if (response?.success && response.data) {
            dlog('[App] Setting Pulsar version:', response.data);
            setPulsarVersion(response.data);
          } else {
            console.warn('[App] Failed to fetch Pulsar version:', response?.error);
          }
        } catch (error) {
          console.error('[App] Error fetching Pulsar version:', error);
        }
      };
      fetchVersion();
    }
  }, [connectedCluster, appState.screen]);

  // Show splash screen if not ready
  if (!apiReady) {
    return (
      <div className="app">
        <div className="connection-screen">
          <div className="logo">
            <div className="star-icon">✦</div>
            <h1>LightCurve</h1>
          </div>
          <p className="tagline">An observatory for your message streams</p>
          <div style={{ marginTop: '2rem', fontSize: '14px', color: '#94a3b8' }}>
            Initializing...
          </div>
        </div>
      </div>
    );
  }

  // Show profile selection if we have saved profiles
  if (appState.screen === 'profile-selection' && savedProfiles.length > 0) {
    return (
      <div className="app">
        <div className="connection-screen">
          <div className="logo">
            <div className="star-icon">✦</div>
            <h1>LightCurve</h1>
          </div>
          <p className="tagline">An observatory for your message streams</p>

          <div className="connection-form">
            <h2>Select Connection</h2>
            <div className="profile-list">
              {savedProfiles.map((profile) => (
                <div
                  key={profile.profileId}
                  className="profile-card"
                  onClick={() => handleConnectProfile(profile)}
                >
                  <div className="profile-card-info">
                    <div className="profile-card-name">{profile.name}</div>
                    <div className="profile-card-url">{profile.adminUrl}</div>
                  </div>
                  <div className="profile-card-actions">
                    <button
                      className="profile-action-btn edit"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLoadProfile(profile);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="profile-action-btn delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteProfile(profile.profileId);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button
              className="connect-button"
              onClick={() => setAppState({ screen: 'form' })}
              style={{ marginTop: '1.25rem' }}
            >
              + New Connection
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!connectedCluster) {
    if (!hasAPI) {
      return (
        <div className="app">
          <div className="connection-screen">
            <div className="logo">
              <div className="star-icon">✦</div>
              <h1>LightCurve</h1>
            </div>
            <p className="tagline">An observatory for your message streams</p>
            <div className="connection-form">
              <h2>Connect to Pulsar Cluster</h2>
              <div className="connection-error">
                Desktop API unavailable. Please run the Electron app (npm run dev) or packaged build, not the plain Vite URL.
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="app">
        <div className="connection-screen">
          <div className="logo">
            <div className="star-icon">✦</div>
            <h1>LightCurve</h1>
          </div>
          <p className="tagline">An observatory for your message streams</p>

          <div className="connection-form">
            <h2>Connect to Pulsar Cluster</h2>
            
            {connectionError && (
              <div className="connection-error">
                {connectionError}
              </div>
            )}

            <div className="form-group">
              <label>Cluster Name</label>
              <input
                type="text"
                value={clusterName}
                onChange={(e) => setClusterName(e.target.value)}
                placeholder="Local Pulsar"
                disabled={connecting}
              />
            </div>

            <div className="form-group">
              <label>Admin URL</label>
              <input
                type="text"
                value={adminUrl}
                onChange={(e) => setAdminUrl(e.target.value)}
                placeholder="http://localhost:8080"
                disabled={connecting}
              />
            </div>

            <div className="form-group">
              <label>Service URL</label>
              <input
                type="text"
                value={serviceUrl}
                onChange={(e) => setServiceUrl(e.target.value)}
                placeholder="pulsar://localhost:6650"
                disabled={connecting}
              />
            </div>

            <div className="form-group">
              <label>Authentication Type</label>
              <select
                value={authType}
                onChange={(e) => setAuthType(e.target.value as AuthType)}
                disabled={connecting}
              >
                <option value="token">Bearer Token (Optional)</option>
                <option value="oauth">OAuth 2.0 Client Credentials</option>
              </select>
            </div>

            {authType === 'token' && (
              <div className="form-group">
                <label>Auth Token (optional)</label>
                <input
                  type="password"
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder="Enter authentication token"
                  disabled={connecting}
                />
              </div>
            )}

            {authType === 'oauth' && (
              <>
                <div className="form-group">
                  <label>Client ID</label>
                  <input
                    type="text"
                    value={oauthClientId}
                    onChange={(e) => setOAuthClientId(e.target.value)}
                    placeholder="Your OAuth client ID"
                    disabled={connecting}
                  />
                </div>

                <div className="form-group">
                  <label>Client Secret</label>
                  <input
                    type="password"
                    value={oauthClientSecret}
                    onChange={(e) => setOAuthClientSecret(e.target.value)}
                    placeholder="Your OAuth client secret"
                    disabled={connecting}
                  />
                </div>

                <div className="form-group">
                  <label>Issuer URL</label>
                  <input
                    type="text"
                    value={oauthIssuerUrl}
                    onChange={(e) => setOAuthIssuerUrl(e.target.value)}
                    placeholder="https://token-provider.example.com"
                    disabled={connecting}
                  />
                </div>

                <div className="form-group">
                  <label>Audience</label>
                  <input
                    type="text"
                    value={oauthAudience}
                    onChange={(e) => setOAuthAudience(e.target.value)}
                    placeholder="https://pulsar.example.com"
                    disabled={connecting}
                  />
                </div>

                <div className="form-group">
                  <label>Scopes (optional, space-separated)</label>
                  <input
                    type="text"
                    value={oauthScopes}
                    onChange={(e) => setOAuthScopes(e.target.value)}
                    placeholder="api:read api:write admin"
                    disabled={connecting}
                  />
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                className="connect-button"
                onClick={handleConnect}
                disabled={connecting || !adminUrl || !serviceUrl}
                style={{ flex: 1 }}
              >
                {connecting ? 'Connecting...' : 'Connect'}
              </button>
              <button
                className="connect-button"
                onClick={handleSaveProfile}
                disabled={connecting || !clusterName || !adminUrl || !serviceUrl}
                style={{ flex: 1, opacity: 0.7 }}
                title="Save this configuration as a profile for quick reuse"
              >
                Save Profile
              </button>
            </div>

            {savedProfiles.length > 0 && (
              <button
                className="connect-button"
                onClick={() => setAppState({ screen: 'profile-selection', savedProfiles })}
                style={{ marginTop: '0.75rem', opacity: 0.6 }}
              >
                Back to Profiles
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Show explorer when connected
  return (
    <div className="app">
      <div className="app-header">
        <div className="app-title">
          <div className="app-icon">✦</div>
          <div>
            <h1>LightCurve</h1>
            <p className="connected-cluster">
              <span className="connection-dot" />
              {connectedCluster.name || connectedCluster.clusterId}
              {pulsarVersion && <span className="version-badge">{pulsarVersion}</span>}
            </p>
          </div>
        </div>
        <button className="disconnect-button" onClick={handleDisconnect}>
          Disconnect
        </button>
      </div>

      <div className="app-content">
        <SplitLayout
          left={
            <ExplorerTree
              clusterId={connectedCluster.clusterId}
              onSelectNode={setSelectedNode}
              selectedNodeId={selectedNode?.id || null}
            />
          }
          right={
            <DetailsPanel
              clusterId={connectedCluster.clusterId}
              node={selectedNode}
            />
          }
          leftWidth="350px"
        />
      </div>
    </div>
  );
};

export default App;
