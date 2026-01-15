import React, { useState, useEffect } from 'react';
import './ExplorerTree.css';

interface TreeNode {
  id: string;
  type: 'tenant' | 'namespace' | 'topic';
  label: string;
  expanded: boolean;
  children?: TreeNode[];
  loading?: boolean;
  fullPath?: string; // For topics: persistent://tenant/namespace/topic
  unavailable?: boolean; // Indicates the item doesn't exist in the target cluster
}

interface ExplorerTreeProps {
  clusterId: string;
  onSelectNode: (node: TreeNode) => void;
  selectedNodeId: string | null;
}

interface StructureProfile {
  profileId: string;
  name: string;
}

export const ExplorerTree: React.FC<ExplorerTreeProps> = ({ 
  clusterId, 
  onSelectNode, 
  selectedNodeId 
}) => {
  const [tenants, setTenants] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualTenant, setManualTenant] = useState('');
  const [availableProfiles, setAvailableProfiles] = useState<StructureProfile[]>([]);
  const [selectedStructureProfile, setSelectedStructureProfile] = useState<string | null>(null);
  const [loadingFromProfile, setLoadingFromProfile] = useState(false);

  // Load tenants on mount
  useEffect(() => {
    loadTenants();
  }, [clusterId]);

  const loadAvailableProfiles = async () => {
    try {
      const response = await window.lightcurve.profiles.listProfiles();
      if (response.success && response.data) {
        // Filter out the current profile
        const otherProfiles = response.data
          .filter(p => p.clusterId !== clusterId)
          .map(p => ({ profileId: p.profileId, name: p.name }));
        setAvailableProfiles(otherProfiles);
      }
    } catch (err) {
      console.error('Failed to load profiles:', err);
    }
  };

  const loadTenants = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await window.lightcurve.admin.listTenants(clusterId);
      console.log('[ExplorerTree] listTenants response:', response);
      
      if (response.success && response.data && response.data.length > 0) {
        const tenantNodes: TreeNode[] = response.data.map(tenant => ({
          id: `tenant:${tenant}`,
          type: 'tenant',
          label: tenant,
          expanded: false,
        }));
        setTenants(tenantNodes);
      } else if (response.success && (!response.data || response.data.length === 0)) {
        // Empty tenant list - offer to load from another profile
        console.log('[ExplorerTree] Empty tenant list returned');
        setError('No tenants found. You may not have permission to list tenants.');
        loadAvailableProfiles();
      } else {
        const errorMsg = response.error || 'Failed to load tenants';
        console.log('[ExplorerTree] Error response:', errorMsg);
        setError(errorMsg);
        // Check if it's a 401 authorization error
        if (errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
          loadAvailableProfiles();
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to load tenants';
      console.error('[ExplorerTree] Exception:', errMsg);
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const loadTenantsfromProfile = async (profileId: string) => {
    setLoadingFromProfile(true);
    try {
      // Get the profile details
      const profileResponse = await window.lightcurve.profiles.getProfile(profileId);
      if (!profileResponse.success || !profileResponse.data) {
        setError(`Failed to load profile ${profileId}`);
        setLoadingFromProfile(false);
        return;
      }

      const profile = profileResponse.data;

      // Connect to the source profile
      const connectResponse = await window.lightcurve.cluster.connect({
        clusterId: profileId,
        adminUrl: profile.adminUrl,
        serviceUrl: profile.serviceUrl,
        auth: profile.auth,
      });

      if (!connectResponse.success) {
        setError(`Failed to connect to ${profile.name}`);
        setLoadingFromProfile(false);
        return;
      }

      // Now load tenants from that cluster
      const response = await window.lightcurve.admin.listTenants(profileId);
      if (response.success && response.data && response.data.length > 0) {
        const tenantNodes: TreeNode[] = response.data.map(tenant => ({
          id: `tenant:${tenant}`,
          type: 'tenant',
          label: tenant,
          expanded: false,
        }));
        setTenants(tenantNodes);
        setSelectedStructureProfile(profileId);
        setError(null); // Clear error on success
      } else {
        setError(`No tenants found in ${profile.name}`);
      }
    } catch (err) {
      setError(`Failed to load structure: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoadingFromProfile(false);
    }
  };

  const loadNamespaces = async (tenantNode: TreeNode, tenantName: string) => {
    try {
      // Mark as loading
      updateNodeLoading(tenantNode.id, true);

      // Use the reference profile (DEV) for loading structure, not the current cluster (QA)
      const sourceClusterId = selectedStructureProfile || clusterId;
      
      const response = await window.lightcurve.admin.listNamespaces(sourceClusterId, tenantName);
      if (response.success && response.data) {
        const namespaceNodes: TreeNode[] = response.data.map(ns => {
          // ns is already in format "tenant/namespace" from the API
          const parts = ns.split('/');
          const namespaceName = parts[parts.length - 1];
          
          return {
            id: `namespace:${ns}`,
            type: 'namespace',
            label: namespaceName,
            expanded: false,
            unavailable: false,
          };
        });
        
        // If using a reference profile, try to validate namespaces exist in target cluster
        if (selectedStructureProfile) {
          try {
            const targetResponse = await window.lightcurve.admin.listNamespaces(clusterId, tenantName);
            
            // Only mark as unavailable if we successfully got the list and the item is missing
            if (targetResponse.success && targetResponse.data) {
              const targetNamespaces = new Set(targetResponse.data);
              
              namespaceNodes.forEach(node => {
                const nsPath = node.id.replace('namespace:', '');
                node.unavailable = !targetNamespaces.has(nsPath);
              });
            } else if (targetResponse.error && (targetResponse.error.includes('401') || targetResponse.error.includes('Unauthorized'))) {
              // If we don't have permission to validate, assume items exist (optimistic)
              console.log('[ExplorerTree] Cannot validate namespaces in target cluster (no permission) - assuming available');
            }
          } catch (err) {
            console.log('[ExplorerTree] Validation failed, assuming items are available:', err);
          }
        }
        
        // Update the tenant node with namespaces
        setTenants(prev => updateNodeChildren(prev, tenantNode.id, namespaceNodes));
      } else {
        console.error('Failed to load namespaces:', response.error);
      }
    } catch (err) {
      console.error('Error loading namespaces:', err);
    } finally {
      updateNodeLoading(tenantNode.id, false);
    }
  };

  const loadTopics = async (namespaceNode: TreeNode, tenant: string, namespace: string) => {
    try {
      // Mark as loading
      updateNodeLoading(namespaceNode.id, true);

      // Use the reference profile (DEV) for loading structure, not the current cluster (QA)
      const sourceClusterId = selectedStructureProfile || clusterId;

      const response = await window.lightcurve.admin.listTopics(sourceClusterId, tenant, namespace);
      console.log(`loadTopics response for ${tenant}/${namespace}:`, response);
      
      if (response.success && response.data) {
        console.log(`Found ${response.data.length} topics`);
        const topicNodes: TreeNode[] = response.data.map(topicFullName => {
          // Extract topic name from full path (e.g., persistent://tenant/namespace/topic)
          const parts = topicFullName.split('/');
          const topicName = parts[parts.length - 1];
          
          return {
            id: `topic:${topicFullName}`,
            type: 'topic',
            label: topicName,
            expanded: false,
            fullPath: topicFullName,
            unavailable: false,
          };
        });
        
        // If using a reference profile, try to validate topics exist in target cluster
        if (selectedStructureProfile) {
          try {
            const targetResponse = await window.lightcurve.admin.listTopics(clusterId, tenant, namespace);
            
            // Only mark as unavailable if we successfully got the list and the item is missing
            if (targetResponse.success && targetResponse.data) {
              const targetTopics = new Set(targetResponse.data);
              
              topicNodes.forEach(node => {
                node.unavailable = !targetTopics.has(node.fullPath || '');
              });
            } else if (targetResponse.error && (targetResponse.error.includes('401') || targetResponse.error.includes('Unauthorized'))) {
              // If we don't have permission to validate, assume items exist (optimistic)
              console.log('[ExplorerTree] Cannot validate topics in target cluster (no permission) - assuming available');
            }
          } catch (err) {
            console.log('[ExplorerTree] Validation failed, assuming items are available:', err);
          }
        }
        
        // Update the namespace node with topics
        setTenants(prev => updateNodeChildren(prev, namespaceNode.id, topicNodes));
      } else {
        console.error('Failed to load topics:', response.error);
      }
    } catch (err) {
      console.error('Error loading topics:', err);
    } finally {
      updateNodeLoading(namespaceNode.id, false);
    }
  };

  const updateNodeChildren = (nodes: TreeNode[], nodeId: string, children: TreeNode[]): TreeNode[] => {
    return nodes.map(node => {
      if (node.id === nodeId) {
        return { ...node, children, expanded: true };
      }
      if (node.children) {
        return { ...node, children: updateNodeChildren(node.children, nodeId, children) };
      }
      return node;
    });
  };

  const updateNodeLoading = (nodeId: string, loading: boolean) => {
    setTenants(prev => updateNodeLoadingState(prev, nodeId, loading));
  };

  const updateNodeLoadingState = (nodes: TreeNode[], nodeId: string, loading: boolean): TreeNode[] => {
    return nodes.map(node => {
      if (node.id === nodeId) {
        return { ...node, loading };
      }
      if (node.children) {
        return { ...node, children: updateNodeLoadingState(node.children, nodeId, loading) };
      }
      return node;
    });
  };

  const toggleNodeExpansion = (nodes: TreeNode[], nodeId: string): TreeNode[] => {
    return nodes.map(node => {
      if (node.id === nodeId) {
        return { ...node, expanded: !node.expanded };
      }
      if (node.children) {
        return { ...node, children: toggleNodeExpansion(node.children, nodeId) };
      }
      return node;
    });
  };

  const handleNodeClick = (node: TreeNode) => {
    console.log('Node clicked:', node.id, 'type:', node.type, 'label:', node.label);
    
    // Toggle expansion if not a topic
    if (node.type !== 'topic') {
      setTenants(prev => toggleNodeExpansion(prev, node.id));

      // Load children if expanding and not loaded yet
      if (!node.expanded && (!node.children || node.children.length === 0)) {
        if (node.type === 'tenant') {
          console.log('Loading namespaces for tenant:', node.label);
          loadNamespaces(node, node.label);
        } else if (node.type === 'namespace') {
          // Extract tenant from namespace ID
          const parts = node.id.replace('namespace:', '').split('/');
          const tenant = parts[0];
          const namespace = parts[1];
          console.log('Loading topics for namespace:', tenant, namespace);
          loadTopics(node, tenant, namespace);
        }
      }
    }

    // Always notify selection
    onSelectNode(node);
  };

  const renderNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const isSelected = node.id === selectedNodeId;
    const hasChildren = node.type !== 'topic';
    const isExpanded = node.expanded;
    
    const getTypeLabel = (type: string): string => {
      switch (type) {
        case 'tenant': return 'Tenant';
        case 'namespace': return 'Namespace';
        case 'topic': return 'Topic';
        default: return 'Unknown';
      }
    };

    return (
      <div key={node.id} className="tree-node-container">
        <div
          className={`tree-node ${isSelected ? 'selected' : ''} ${node.unavailable ? 'unavailable' : ''}`}
          style={{ 
            paddingLeft: `${depth * 20 + 8}px`,
            opacity: node.unavailable ? 0.5 : 1,
            textDecoration: node.unavailable ? 'line-through' : 'none',
          }}
          onClick={() => handleNodeClick(node)}
          role="button"
          tabIndex={0}
          title={node.unavailable ? `Not available in target cluster - ${getTypeLabel(node.type)}` : getTypeLabel(node.type)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleNodeClick(node);
            }
          }}
        >
          {hasChildren && (
            <span className="tree-node-icon">
              {node.loading ? '⟳' : isExpanded ? '▼' : '▶'}
            </span>
          )}
          <span className="tree-node-type-icon" title={getTypeLabel(node.type)}>
            {node.unavailable ? '🚫' : (node.type === 'tenant' ? '🏢' : node.type === 'namespace' ? '📁' : '📄')}
          </span>
          <span className="tree-node-label">{node.label}</span>
          {node.unavailable && <span style={{ marginLeft: '4px', fontSize: '10px', color: '#999' }}>⚠️ Not in QA</span>}
        </div>
        {isExpanded && node.children && (
          <div className="tree-node-children">
            {node.children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (loading && tenants.length === 0) {
    return (
      <div className="explorer-tree loading">
        <div className="explorer-tree-loading">Loading tenants...</div>
      </div>
    );
  }

  if (error) {
    const isAuthError = error.includes('401') || error.includes('Unauthorized') || error.includes('No tenants found');
    
    return (
      <div className="explorer-tree error">
        <div className="explorer-tree-error">
          <p>Error: {error}</p>
          <button onClick={loadTenants} style={{ marginRight: '0.5rem' }}>Retry</button>
          
          {isAuthError && availableProfiles.length > 0 && (
            <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#f0f8ff', borderRadius: '4px' }}>
              <p style={{ fontSize: '12px', marginBottom: '0.5rem' }}>
                💡 Load structure from another profile:
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {availableProfiles.map(profile => (
                  <button
                    key={profile.profileId}
                    onClick={() => loadTenantsfromProfile(profile.profileId)}
                    disabled={loadingFromProfile}
                    style={{
                      fontSize: '11px',
                      padding: '0.4rem 0.8rem',
                      backgroundColor: loadingFromProfile ? '#ccc' : '#4CAF50',
                      color: 'white',
                      border: 'none',
                      borderRadius: '3px',
                      cursor: loadingFromProfile ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {loadingFromProfile ? '⟳' : '📋'} Load from {profile.name}
                  </button>
                ))}
              </div>
              {selectedStructureProfile && (
                <p style={{ fontSize: '11px', marginTop: '0.5rem', color: '#666' }}>
                  ✓ Using structure from another profile. Data will be queried against the current cluster.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="explorer-tree">
      <div className="explorer-tree-header">
        <h3>Pulsar Explorer</h3>
        <button className="refresh-button" onClick={loadTenants} title="Refresh">
          ⟳
        </button>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', padding: '0 0.75rem 0.75rem' }}>
        <input
          type="text"
          value={manualTenant}
          onChange={(e) => setManualTenant(e.target.value)}
          placeholder="Enter tenant name manually"
          style={{ flex: 1 }}
        />
        <button
          onClick={() => {
            const name = manualTenant.trim();
            if (!name) return;
            // Avoid duplicates
            setTenants(prev => {
              if (prev.some(t => t.label === name)) return prev;
              return [...prev, { id: `tenant:${name}`, type: 'tenant', label: name, expanded: false }];
            });
            setManualTenant('');
          }}
          disabled={!manualTenant.trim()}
        >
          Add tenant
        </button>
      </div>
      <div className="explorer-tree-content">
        {tenants.length === 0 ? (
          <div className="explorer-tree-empty">
            <p>No tenants found. Common tenant names to try:</p>
            <ul style={{ fontSize: '12px', textAlign: 'left', marginTop: '0.5rem' }}>
              <li><code>express-returns</code></li>
              <li><code>public</code></li>
              <li><code>default</code></li>
              <li><code>vespa</code></li>
              <li><code>notification-service</code></li>
            </ul>
            <p style={{ marginTop: '0.5rem', fontSize: '12px' }}>Enter a tenant name above to explore it.</p>
          </div>
        ) : (
          tenants.map(node => renderNode(node))
        )}
      </div>
    </div>
  );
};
