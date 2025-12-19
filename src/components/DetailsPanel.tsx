import React, { useState, useEffect } from 'react';
import type { TopicStats } from '../shared/types';
import { TestMessages } from './TestMessages';
import { BrowseMessages } from './BrowseMessages';
import './DetailsPanel.css';

interface TreeNode {
  id: string;
  type: 'tenant' | 'namespace' | 'topic';
  label: string;
  expanded: boolean;
  children?: TreeNode[];
  loading?: boolean;
  fullPath?: string;
}

interface DetailsPanelProps {
  clusterId: string;
  node: TreeNode | null;
}

export const DetailsPanel: React.FC<DetailsPanelProps> = ({ clusterId, node }) => {
  if (!node) {
    return (
      <div className="details-panel">
        <div className="details-empty">
          <div className="empty-icon">📋</div>
          <p>Select a tenant, namespace, or topic to view details</p>
        </div>
      </div>
    );
  }

  switch (node.type) {
    case 'tenant':
      return <TenantDetails clusterId={clusterId} tenantName={node.label} />;
    case 'namespace':
      return <NamespaceDetails clusterId={clusterId} node={node} />;
    case 'topic':
      return <TopicDetails clusterId={clusterId} node={node} />;
    default:
      return null;
  }
};

// Tenant Details Component
const TenantDetails: React.FC<{ clusterId: string; tenantName: string }> = ({ 
  clusterId, 
  tenantName 
}) => {
  const [namespaceCount, setNamespaceCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadNamespaceCount();
  }, [clusterId, tenantName]);

  const loadNamespaceCount = async () => {
    setLoading(true);
    try {
      const response = await window.lightcurve.admin.listNamespaces(clusterId, tenantName);
      if (response.success && response.data) {
        setNamespaceCount(response.data.length);
      }
    } catch (err) {
      console.error('Error loading namespace count:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="details-panel">
      <div className="details-header">
        <div className="details-icon">🏢</div>
        <div className="details-title">
          <span className="details-type">Tenant</span>
          <h2>{tenantName}</h2>
        </div>
      </div>

      <div className="details-content">
        <div className="details-section">
          <h3>Overview</h3>
          <div className="details-grid">
            <div className="detail-item">
              <label>Tenant Name</label>
              <div className="detail-value">{tenantName}</div>
            </div>
            <div className="detail-item">
              <label>Namespaces</label>
              <div className="detail-value">
                {loading ? '...' : namespaceCount ?? 'N/A'}
              </div>
            </div>
          </div>
        </div>

        <div className="details-section">
          <h3>Description</h3>
          <p className="details-description">
            A tenant is a logical grouping of namespaces in Apache Pulsar. 
            Tenants provide isolation and multi-tenancy capabilities.
          </p>
        </div>
      </div>
    </div>
  );
};

// Namespace Details Component
const NamespaceDetails: React.FC<{ clusterId: string; node: TreeNode }> = ({ 
  clusterId, 
  node 
}) => {
  const [topicCount, setTopicCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Extract tenant and namespace from node ID
  const parts = node.id.replace('namespace:', '').split('/');
  const tenant = parts[0];
  const namespace = parts[1];

  useEffect(() => {
    loadTopicCount();
  }, [clusterId, tenant, namespace]);

  const loadTopicCount = async () => {
    setLoading(true);
    try {
      const response = await window.lightcurve.admin.listTopics(clusterId, tenant, namespace);
      if (response.success && response.data) {
        setTopicCount(response.data.length);
      }
    } catch (err) {
      console.error('Error loading topic count:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="details-panel">
      <div className="details-header">
        <div className="details-icon">📁</div>
        <div className="details-title">
          <span className="details-type">Namespace</span>
          <h2>{namespace}</h2>
        </div>
      </div>

      <div className="details-content">
        <div className="details-section">
          <h3>Overview</h3>
          <div className="details-grid">
            <div className="detail-item">
              <label>Tenant</label>
              <div className="detail-value">{tenant}</div>
            </div>
            <div className="detail-item">
              <label>Namespace</label>
              <div className="detail-value">{namespace}</div>
            </div>
            <div className="detail-item">
              <label>Full Path</label>
              <div className="detail-value">{tenant}/{namespace}</div>
            </div>
            <div className="detail-item">
              <label>Topics</label>
              <div className="detail-value">
                {loading ? '...' : topicCount ?? 'N/A'}
              </div>
            </div>
          </div>
        </div>

        <div className="details-section">
          <h3>Description</h3>
          <p className="details-description">
            A namespace is a logical grouping of topics within a tenant. 
            Namespaces allow you to organize topics and apply policies at the namespace level.
          </p>
        </div>
      </div>
    </div>
  );
};

// Topic Details Component
const TopicDetails: React.FC<{ clusterId: string; node: TreeNode }> = ({ 
  clusterId, 
  node 
}) => {
  const parseTopicName = (fullTopicName: string) => {
    const match = fullTopicName.match(/^(persistent|non-persistent):\/\/([^/]+)\/([^/]+)\/(.+)$/);
    if (!match) {
      return { persistence: 'persistent', tenant: '', namespace: '', topic: fullTopicName };
    }
    return {
      persistence: match[1],
      tenant: match[2],
      namespace: match[3],
      topic: match[4],
    };
  };
  const [activeTab, setActiveTab] = useState<'overview' | 'test' | 'browse'>('overview');
  const [browsingTopicName, setBrowsingTopicName] = useState<string>('');
  const [stats, setStats] = useState<TopicStats | null>(null);
  const [subscriptions, setSubscriptions] = useState<string[]>([]);
  const [dlqTopics, setDlqTopics] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fullTopicName = node.fullPath || '';

  useEffect(() => {
    loadTopicData();
  }, [clusterId, fullTopicName]);

  const loadTopicData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Load stats and subscriptions in parallel
      const [statsResponse, subsResponse] = await Promise.all([
        window.lightcurve.admin.getTopicStats(clusterId, fullTopicName),
        window.lightcurve.admin.listSubscriptions(clusterId, fullTopicName),
      ]);

      if (statsResponse.success && statsResponse.data) {
        setStats(statsResponse.data);
      } else {
        setError(statsResponse.error || 'Failed to load topic stats');
      }

      if (subsResponse.success && subsResponse.data) {
        setSubscriptions(subsResponse.data);
      }

      // Discover DLQ/Retry topics in the same namespace
      try {
        const { tenant, namespace, topic } = parseTopicName(fullTopicName);
        const topicsResp = await window.lightcurve.admin.listTopics(clusterId, tenant, namespace);
        const allTopics = topicsResp.success && topicsResp.data ? topicsResp.data : [];
        const candidates = new Set<string>();
        // Common DLQ naming patterns
        const baseName = topic;
        const patterns = [
          `${baseName}-DLQ`,
          `${baseName}-RETRY`,
          // Include subscription-qualified defaults
          ...subscriptions.map(s => `${baseName}-${s}-DLQ`),
          ...subscriptions.map(s => `${baseName}-${s}-RETRY`),
        ];

        for (const t of allTopics) {
          const simpleName = t.replace(/^persistent:\/\//, '').replace(/^non-persistent:\/\//, '').split('/').slice(2).join('/');
          if (simpleName && (simpleName.endsWith('-DLQ') || simpleName.endsWith('-RETRY') || patterns.some(p => simpleName.endsWith(p)))) {
            candidates.add(t);
          }
        }
        setDlqTopics(Array.from(candidates));
      } catch (e) {
        // Non-fatal: DLQ discovery best-effort
        console.warn('[DLQ] Discovery failed:', e);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load topic data');
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatRate = (rate: number): string => {
    return rate.toFixed(2);
  };

  const getTotalBacklog = (): number => {
    if (!stats) return 0;
    return Object.values(stats.subscriptions || {}).reduce(
      (total, sub) => total + (sub.msgBacklog || 0),
      0
    );
  };

  return (
    <div className="details-panel">
      <div className="details-header">
        <div className="details-icon">📄</div>
        <div className="details-title">
          <span className="details-type">Topic</span>
          <h2>{node.label}</h2>
        </div>
      </div>

      <div className="details-tabs">
        <button 
          className={`tab-button ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button 
          className={`tab-button ${activeTab === 'browse' ? 'active' : ''}`}
          onClick={() => setActiveTab('browse')}
        >
          Browse Messages
        </button>
        <button 
          className={`tab-button ${activeTab === 'test' ? 'active' : ''}`}
          onClick={() => setActiveTab('test')}
        >
          Test Messages
        </button>
      </div>

      <div className="details-content">
        {activeTab === 'overview' ? (
          loading ? (
            <div className="details-loading">Loading topic details...</div>
          ) : error ? (
            <div className="details-error">
              <p>Error: {error}</p>
              <button onClick={loadTopicData}>Retry</button>
            </div>
          ) : (
            <>
              <div className="details-section">
                <h3>Overview</h3>
              <div className="details-grid">
                <div className="detail-item">
                  <label>Full Name</label>
                  <div className="detail-value detail-value-small">{fullTopicName}</div>
                </div>
                <div className="detail-item">
                  <label>Publishers</label>
                  <div className="detail-value">{stats?.publishers?.length || 0}</div>
                </div>
                <div className="detail-item">
                  <label>Subscriptions</label>
                  <div className="detail-value">{subscriptions.length}</div>
                </div>
                <div className="detail-item">
                  <label>Total Backlog</label>
                  <div className="detail-value">{getTotalBacklog().toLocaleString()} msgs</div>
                </div>
              </div>
            </div>

            {stats && (
              <>
                <div className="details-section">
                  <h3>Throughput Metrics</h3>
                  <div className="details-grid">
                    <div className="detail-item">
                      <label>Message Rate In</label>
                      <div className="detail-value">{formatRate(stats.msgRateIn)} msg/s</div>
                    </div>
                    <div className="detail-item">
                      <label>Message Rate Out</label>
                      <div className="detail-value">{formatRate(stats.msgRateOut)} msg/s</div>
                    </div>
                    <div className="detail-item">
                      <label>Throughput In</label>
                      <div className="detail-value">{formatBytes(stats.msgThroughputIn)}/s</div>
                    </div>
                    <div className="detail-item">
                      <label>Throughput Out</label>
                      <div className="detail-value">{formatBytes(stats.msgThroughputOut)}/s</div>
                    </div>
                    <div className="detail-item">
                      <label>Average Message Size</label>
                      <div className="detail-value">{formatBytes(stats.averageMsgSize)}</div>
                    </div>
                    <div className="detail-item">
                      <label>Storage Size</label>
                      <div className="detail-value">{formatBytes(stats.storageSize)}</div>
                    </div>
                  </div>
                </div>

                {stats.publishers && stats.publishers.length > 0 && (
                  <div className="details-section">
                    <h3>Publishers ({stats.publishers.length})</h3>
                    <div className="details-list">
                      {stats.publishers.map((pub, idx) => (
                        <div key={idx} className="list-item">
                          <div className="list-item-name">{pub.producerName}</div>
                          <div className="list-item-stats">
                            {formatRate(pub.msgRateIn)} msg/s • {formatBytes(pub.msgThroughputIn)}/s
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {subscriptions.length > 0 && (
                  <div className="details-section">
                    <h3>Subscriptions ({subscriptions.length})</h3>
                    <div className="details-list">
                      {subscriptions.map((sub, idx) => {
                        const subStats = stats.subscriptions?.[sub];
                        return (
                          <div key={idx} className="list-item">
                            <div className="list-item-name">{sub}</div>
                            {subStats && (
                              <div className="list-item-stats">
                                Backlog: {subStats.msgBacklog.toLocaleString()} • 
                                Rate: {formatRate(subStats.msgRateOut)} msg/s • 
                                Consumers: {subStats.consumers?.length || 0}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {dlqTopics.length > 0 && (
                  <div className="details-section">
                    <h3>Dead Letter / Retry Topics</h3>
                    <div className="details-list">
                      {dlqTopics.map((dlq, idx) => (
                        <div key={idx} className="list-item">
                          <div className="list-item-name detail-value-small">{dlq}</div>
                          <div className="list-item-actions">
                            <button 
                              className="action-button"
                              onClick={() => {
                                setBrowsingTopicName(dlq);
                                setActiveTab('browse');
                              }}
                            >
                              📖 Browse
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="details-section">
              <h3>Actions</h3>
              <div className="details-actions">
                <button 
                  className="action-button primary"
                  onClick={() => setActiveTab('browse')}
                >
                  📖 Browse Messages
                </button>
                <button 
                  className="action-button"
                  onClick={loadTopicData}
                >
                  ⟳ Refresh Stats
                </button>
              </div>
            </div>
          </>
        )
        ) : activeTab === 'browse' ? (
          <BrowseMessages clusterId={clusterId} topicName={browsingTopicName || fullTopicName} />
        ) : (
          <TestMessages clusterId={clusterId} topicName={fullTopicName} />
        )}
      </div>
    </div>
  );
};
