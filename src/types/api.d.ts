/**
 * Type definitions for the window.lightcurve API
 * This should match the API exposed in electron/preload.ts
 */

import type {
  ClusterConfig,
  TopicStats,
  BrowseMessagesOptions,
  BrowseMessagesResult,
  CreateProducerOptions,
  CreateConsumerOptions,
  SendMessageOptions,
  IPCResponse,
  ConnectedCluster,
  SavedProfile,
} from '../shared/types';

export interface LightCurveAPI {
  cluster: {
    connect: (config: ClusterConfig) => Promise<IPCResponse<ConnectedCluster>>;
    disconnect: (clusterId: string) => Promise<IPCResponse<void>>;
    listConnected: () => Promise<IPCResponse<ConnectedCluster[]>>;
  };
  profiles: {
    listProfiles: () => Promise<IPCResponse<SavedProfile[]>>;
    saveProfile: (profile: Omit<SavedProfile, 'profileId' | 'savedAt'>) => Promise<IPCResponse<SavedProfile>>;
    deleteProfile: (profileId: string) => Promise<IPCResponse<void>>;
    getProfile: (profileId: string) => Promise<IPCResponse<SavedProfile | null>>;
  };
  admin: {
    listClusters: (clusterId: string) => Promise<IPCResponse<string[]>>;
    listTenants: (clusterId: string) => Promise<IPCResponse<string[]>>;
    listNamespaces: (clusterId: string, tenant: string) => Promise<IPCResponse<string[]>>;
    listTopics: (clusterId: string, tenant: string, namespace: string) => Promise<IPCResponse<string[]>>;
    getTopicStats: (clusterId: string, fullTopicName: string) => Promise<IPCResponse<TopicStats>>;
    listSubscriptions: (clusterId: string, fullTopicName: string) => Promise<IPCResponse<string[]>>;
  };
  messages: {
    browse: (clusterId: string, options: BrowseMessagesOptions) => Promise<IPCResponse<BrowseMessagesResult>>;
    peek: (clusterId: string, options: PeekMessagesOptions) => Promise<IPCResponse<PeekMessagesResult>>;
    browseMessages: (clusterId: string, topicName: string) => Promise<IPCResponse<{ readerId: string }>>;
    readMessages: (clusterId: string, readerId: string, maxMessages: number) => Promise<IPCResponse<any[]>>;
    closeReader: (clusterId: string, readerId: string) => Promise<IPCResponse<void>>;
    send: (clusterId: string, topic: string, payload: string, key?: string, properties?: Record<string, string>) => Promise<IPCResponse<string>>;
    startConsumer: (clusterId: string, topic: string, subscription: string, subscriptionType?: string) => Promise<IPCResponse<string>>;
    pauseConsumer: (consumerId: string) => Promise<IPCResponse<void>>;
    stopConsumer: (consumerId: string) => Promise<IPCResponse<void>>;
    onMessage: (callback: (data: { consumerId: string; message: any }) => void) => () => void;
  };
  producer: {
    create: (clusterId: string, options: CreateProducerOptions) => Promise<IPCResponse<string>>;
    send: (producerId: string, message: SendMessageOptions) => Promise<IPCResponse<string>>;
    close: (producerId: string) => Promise<IPCResponse<void>>;
  };
  consumer: {
    create: (clusterId: string, options: CreateConsumerOptions) => Promise<IPCResponse<string>>;
    receive: (consumerId: string, timeoutMs?: number) => Promise<IPCResponse<unknown>>;
    acknowledge: (consumerId: string, messageId: string) => Promise<IPCResponse<void>>;
    close: (consumerId: string) => Promise<IPCResponse<void>>;
  };
}

declare global {
  interface Window {
    lightcurve: LightCurveAPI;
  }
}

export {};
