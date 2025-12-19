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
}

interface ExplorerTreeProps {
  clusterId: string;
  onSelectNode: (node: TreeNode) => void;
  selectedNodeId: string | null;
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

  // Load tenants on mount
  useEffect(() => {
    loadTenants();
  }, [clusterId]);

  const loadTenants = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await window.lightcurve.admin.listTenants(clusterId);
      if (response.success && response.data) {
        const tenantNodes: TreeNode[] = response.data.map(tenant => ({
          id: `tenant:${tenant}`,
          type: 'tenant',
          label: tenant,
          expanded: false,
        }));
        setTenants(tenantNodes);
      } else {
        setError(response.error || 'Failed to load tenants');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tenants');
    } finally {
      setLoading(false);
    }
  };

  const loadNamespaces = async (tenantNode: TreeNode, tenantName: string) => {
    try {
      // Mark as loading
      updateNodeLoading(tenantNode.id, true);

      const response = await window.lightcurve.admin.listNamespaces(clusterId, tenantName);
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
          };
        });
        
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

      const response = await window.lightcurve.admin.listTopics(clusterId, tenant, namespace);
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
          };
        });
        
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
          className={`tree-node ${isSelected ? 'selected' : ''}`}
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
          onClick={() => handleNodeClick(node)}
          role="button"
          tabIndex={0}
          title={getTypeLabel(node.type)}
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
            {node.type === 'tenant' ? '🏢' : node.type === 'namespace' ? '📁' : '📄'}
          </span>
          <span className="tree-node-label">{node.label}</span>
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
    return (
      <div className="explorer-tree error">
        <div className="explorer-tree-error">
          <p>Error: {error}</p>
          <button onClick={loadTenants}>Retry</button>
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
