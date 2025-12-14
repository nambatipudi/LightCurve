import React, { useState, useEffect } from 'react';
import { SplitLayout } from './components/SplitLayout';
import { ExplorerTree } from './components/ExplorerTree';
import { DetailsPanel } from './components/DetailsPanel';
import type { ClusterConfig, ConnectedCluster } from './shared/types';
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

const App: React.FC = () => {
  const [connectedCluster, setConnectedCluster] = useState<ConnectedCluster | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [apiReady, setApiReady] = useState(false);

  // Connection form state
  const [clusterName, setClusterName] = useState('Local Pulsar');
  const [adminUrl, setAdminUrl] = useState('http://localhost:8080');
  const [serviceUrl, setServiceUrl] = useState('pulsar://localhost:6650');
  const [authToken, setAuthToken] = useState('');

  const hasAPI = typeof window !== 'undefined' && (window as any).lightcurve?.cluster;

  useEffect(() => {
    console.log('[App] mounted, hasAPI:', hasAPI, 'lightcurve:', (window as any).lightcurve);
    // Check API availability periodically until ready
    if (hasAPI) {
      setApiReady(true);
    } else {
      const checkInterval = setInterval(() => {
        const isReady = typeof window !== 'undefined' && (window as any).lightcurve?.cluster;
        if (isReady) {
          console.log('[App] API became ready');
          setApiReady(true);
          clearInterval(checkInterval);
        }
      }, 100);
      return () => clearInterval(checkInterval);
    }
  }, [hasAPI]);

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
      authToken: authToken || undefined,
    };

    try {
      const response = await window.lightcurve.cluster.connect(config);
      if (response.success && response.data) {
        setConnectedCluster(response.data);
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
    } catch (err) {
      console.error('Error disconnecting:', err);
    }
  };

  // Show splash screen if not connected
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
              <label>Auth Token (optional)</label>
              <input
                type="password"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder="Enter authentication token"
                disabled={connecting}
              />
            </div>

            <button
              className="connect-button"
              onClick={handleConnect}
              disabled={connecting || !adminUrl || !serviceUrl}
            >
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
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
            <p className="connected-cluster">{connectedCluster.name || connectedCluster.clusterId}</p>
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
