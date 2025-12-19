/**
 * Shared types between main and renderer processes
 * These types define the IPC API contract
 */

// OAuth configuration for client_credentials flow
export interface OAuthConfig {
  type: 'client_credentials';
  clientId: string;
  clientSecret: string;
  issuerUrl: string;
  audience: string;
  scopes?: string[];
}

// Authentication configuration (token or OAuth)
export type AuthConfig = {
  type: 'token';
  token: string;
} | {
  type: 'oauth';
  oauth: OAuthConfig;
} | {
  type: 'none';
};

// Cluster connection configuration
export interface ClusterConfig {
  clusterId: string;
  adminUrl: string;
  serviceUrl: string;
  name?: string;
  auth?: AuthConfig;
  // Legacy support for direct authToken (converted to token auth internally)
  authToken?: string;
}

// Pulsar topic statistics (simplified from PulsarTopicStats)
export interface TopicStats {
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

// Message browsing options
export interface BrowseMessagesOptions {
  topic: string;
  maxMessages?: number;
  startPosition?: 'earliest' | 'latest';
  timeoutMs?: number;
}

// Peek (admin API) options/result
export interface PeekMessagesOptions {
  topic: string;
  maxMessages?: number;
  subscription?: string; // optional: admin peek requires a subscription name
}

export interface PeekMessage {
  messageId: string;
  payload: string;
  properties: Record<string, string>;
  publishTimestamp: number;
  eventTimestamp?: number;
}

export interface PeekMessagesResult {
  messages: PeekMessage[];
}

// Browsed message result
export interface BrowsedMessage {
  messageId: string;
  data: string; // Base64 encoded or UTF-8 string
  properties: Record<string, string>;
  publishTimestamp: number;
  eventTimestamp: number;
  partitionKey?: string;
  topicName: string;
}

// Browse result with messages and metadata
export interface BrowseMessagesResult {
  messages: BrowsedMessage[];
  totalRead: number;
  hasMore: boolean;
}

// Producer creation options
export interface CreateProducerOptions {
  topic: string;
  producerName?: string;
}

// Consumer creation options
export interface CreateConsumerOptions {
  topic: string;
  subscription: string;
  subscriptionType?: 'Exclusive' | 'Shared' | 'Failover' | 'Key_Shared';
}

// Message to send via producer
export interface SendMessageOptions {
  data: string; // String or base64-encoded data
  properties?: Record<string, string>;
  partitionKey?: string;
  eventTimestamp?: number;
}

// IPC API response wrapper
export interface IPCResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Connected cluster information
export interface ConnectedCluster {
  clusterId: string;
  name?: string;
  adminUrl: string;
  serviceUrl: string;
  connected: boolean;
  connectedAt: number;
}

// Saved connection profile
export interface SavedProfile {
  profileId: string;
  clusterId: string;
  name: string;
  adminUrl: string;
  serviceUrl: string;
  auth?: AuthConfig;
  savedAt: number;
}
