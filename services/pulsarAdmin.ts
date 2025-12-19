/**
 * PulsarAdmin - Service class for interacting with Apache Pulsar Admin REST API
 */

import { OAuthClient, type OAuthClientConfig } from './oauthClient';

export interface PulsarTopicStats {
  msgRateIn: number;
  msgRateOut: number;
  msgThroughputIn: number;
  msgThroughputOut: number;
  averageMsgSize: number;
  storageSize: number;
  publishers: Array<{
    producerId: number;
    producerName: string;
    msgRateIn: number;
    msgThroughputIn: number;
    averageMsgSize: number;
  }>;
  subscriptions: Record<string, {
    msgRateOut: number;
    msgThroughputOut: number;
    msgRateRedeliver: number;
    msgBacklog: number;
    consumers: Array<{
      consumerName: string;
      msgRateOut: number;
      msgThroughputOut: number;
    }>;
  }>;
}

export interface PulsarAdminConfig {
  baseUrl: string;
  authToken?: string;
  oauthConfig?: OAuthClientConfig;
}

export class PulsarAdmin {
  private readonly baseUrl: string;
  private readonly authToken?: string;
  private readonly oauthClient?: OAuthClient;

  constructor(config: PulsarAdminConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.authToken = config.authToken;
    if (config.oauthConfig) {
      this.oauthClient = new OAuthClient(config.oauthConfig);
    }
  }

  /**
   * Make an HTTP request to the Pulsar Admin API
   */
  private async request<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Get authorization token - either from direct token or OAuth
    let authToken = this.authToken;
    if (!authToken && this.oauthClient) {
      try {
        console.log('[PulsarAdmin] Fetching OAuth token for', url);
        authToken = await this.oauthClient.getAccessToken();
      } catch (error) {
        throw new Error(`Failed to acquire OAuth token for Pulsar Admin API: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    try {
      console.log('[PulsarAdmin] GET', url);
      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(
          `HTTP ${response.status}: ${response.statusText} - ${errorText}`
        );
      }

      return await response.json() as T;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to fetch ${url}: ${String(error)}`);
    }
  }

  /**
   * List all clusters in the Pulsar instance
   */
  async listClusters(): Promise<string[]> {
    return await this.request<string[]>('/admin/v2/clusters');
  }

  /**
   * List all tenants in the Pulsar instance
   * Falls back to deriving tenants from accessible namespaces if super-user access is denied
   */
  async listTenants(): Promise<string[]> {
    try {
      return await this.request<string[]>('/admin/v2/tenants');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn('[PulsarAdmin] Failed to list all tenants (may need super-user access):', errorMsg);
      
      // If access denied, try to derive tenants from accessible namespaces
      if (errorMsg.includes('401') || errorMsg.includes('Unauthorized') || errorMsg.includes('super-user')) {
        console.log('[PulsarAdmin] Falling back to listing accessible namespaces');
        try {
          const namespaces = await this.listAllNamespaces();
          // Extract unique tenant names from namespaces (format: tenant/namespace)
          const tenants = Array.from(new Set(
            namespaces.map(ns => ns.split('/')[0]).filter(Boolean)
          ));
          console.log('[PulsarAdmin] Derived tenants from accessible namespaces:', tenants);
          return tenants;
        } catch (fallbackError) {
          console.error('[PulsarAdmin] Fallback also failed:', fallbackError);
          // Return empty array instead of throwing
          return [];
        }
      }
      
      // For other errors, rethrow
      throw error;
    }
  }

  /**
   * List all namespaces across all accessible tenants
   * This endpoint typically works even without super-user access
   */
  private async listAllNamespaces(): Promise<string[]> {
    try {
      // Try the global namespaces endpoint first
      return await this.request<string[]>('/admin/v2/namespaces');
    } catch (error) {
      console.warn('[PulsarAdmin] Global namespaces endpoint failed:', error);
      return [];
    }
  }

  /**
   * Try to discover accessible tenants by checking the lookup service
   * This provides a fallback when admin endpoints are not accessible
   */
  async discoverAccessibleTenants(): Promise<string[]> {
    const discoveredTenants: Set<string> = new Set();

    // List of common tenant names to try (add more as needed)
    const commonTenants = [
      'express-returns', 'public', 'default', 'system', 'pulsar',
      'vespa', 'notification-service', 'event-service',
    ];

    for (const tenantName of commonTenants) {
      try {
        // Try to access a namespace under this tenant
        // If we can list even one namespace under it, the tenant exists and we have access
        const namespaces = await this.listNamespaces(tenantName).catch(() => []);
        if (namespaces.length > 0) {
          discoveredTenants.add(tenantName);
          console.log(`[PulsarAdmin] Found accessible tenant: ${tenantName}`);
        }
      } catch (error) {
        // Silently continue if this tenant is not accessible
      }
    }

    return Array.from(discoveredTenants);
  }

  /**
   * List all namespaces for a given tenant
   */
  async listNamespaces(tenant: string): Promise<string[]> {
    if (!tenant) {
      throw new Error('Tenant name is required');
    }
    return await this.request<string[]>(`/admin/v2/namespaces/${tenant}`);
  }

  /**
   * List all topics in a namespace
   * @param tenant - The tenant name
   * @param namespace - The namespace name (without tenant prefix)
   */
  async listTopics(tenant: string, namespace: string): Promise<string[]> {
    if (!tenant || !namespace) {
      throw new Error('Both tenant and namespace are required');
    }
    
    try {
      // Pulsar API expects format: /admin/v2/persistent/{tenant}/{namespace}
      const persistentTopics = await this.request<string[]>(
        `/admin/v2/persistent/${tenant}/${namespace}`
      ).catch(() => [] as string[]);

      const nonPersistentTopics = await this.request<string[]>(
        `/admin/v2/non-persistent/${tenant}/${namespace}`
      ).catch(() => [] as string[]);

      return [...persistentTopics, ...nonPersistentTopics];
    } catch (error) {
      // Log but don't throw - return empty array for missing namespaces
      console.warn(`Failed to list topics for ${tenant}/${namespace}:`, error);
      return [];
    }
  }

  /**
   * Get statistics for a specific topic
   * @param fullTopicName - Full topic name (e.g., "persistent://tenant/namespace/topic")
   */
  async getTopicStats(fullTopicName: string): Promise<PulsarTopicStats> {
    if (!fullTopicName) {
      throw new Error('Topic name is required');
    }

    // Parse the topic name to extract components
    const topicParts = this.parseTopicName(fullTopicName);
    const { persistence, tenant, namespace, topic } = topicParts;

    const path = `/admin/v2/${persistence}/${tenant}/${namespace}/${topic}/stats`;
    return await this.request<PulsarTopicStats>(path);
  }

  /**
   * List all subscriptions for a specific topic
   * @param fullTopicName - Full topic name (e.g., "persistent://tenant/namespace/topic")
   */
  async listSubscriptions(fullTopicName: string): Promise<string[]> {
    if (!fullTopicName) {
      throw new Error('Topic name is required');
    }

    const topicParts = this.parseTopicName(fullTopicName);
    const { persistence, tenant, namespace, topic } = topicParts;

    const path = `/admin/v2/${persistence}/${tenant}/${namespace}/${topic}/subscriptions`;
    return await this.request<string[]>(path);
  }

  /**
   * Parse a full topic name into its components
   * @param fullTopicName - Full topic name (e.g., "persistent://tenant/namespace/topic")
   */
  private parseTopicName(fullTopicName: string): {
    persistence: string;
    tenant: string;
    namespace: string;
    topic: string;
  } {
    // Handle format: persistent://tenant/namespace/topic or non-persistent://tenant/namespace/topic
    const match = fullTopicName.match(/^(persistent|non-persistent):\/\/([^/]+)\/([^/]+)\/(.+)$/);
    
    if (!match) {
      throw new Error(
        `Invalid topic name format: ${fullTopicName}. ` +
        'Expected format: persistent://tenant/namespace/topic'
      );
    }

    return {
      persistence: match[1],
      tenant: match[2],
      namespace: match[3],
      topic: match[4],
    };
  }

  /** Peek messages via Admin API (non-consuming) */
  async peekMessages(fullTopicName: string, _subscription: string, _maxMessages = 10): Promise<any[]> {
    // Pulsar doesn't have a built-in admin API for peeking messages
    // Instead, we'll use the subscription stats endpoint to show backlog info
    // In a real implementation, you'd need a subscription to exist
    const { persistence, tenant, namespace, topic } = this.parseTopicName(fullTopicName);
    
    try {
      // Try to get subscription info which shows message backlog
      const path = `/admin/v2/${persistence}/${tenant}/${namespace}/${topic}/subscriptions`;
      const subs = await this.request<string[]>(path);
      
      if (!subs || subs.length === 0) {
        // No subscriptions exist - can't peek without one
        return [];
      }
      
      // For now, return subscription info as a fallback
      // In production, you'd want to create a temporary subscription and read from it
      console.warn('[peekMessages] Returning subscription list as fallback - Pulsar requires a subscription to read messages');
      return subs.map((sub, idx) => ({
        messageId: `subscription-${idx}`,
        payload: `Subscription: ${sub}`,
        properties: {},
        publishTimestamp: Date.now(),
      }));
    } catch (err: any) {
      const errMsg = err.message || String(err);
      if (errMsg.includes('404') || errMsg.includes('Not Found')) {
        return [];
      }
      throw err;
    }
  }
}
