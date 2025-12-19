import { contextBridge, ipcRenderer } from 'electron';
import type {
  ClusterConfig,
  TopicStats,
  BrowseMessagesOptions,
  BrowseMessagesResult,
  PeekMessagesOptions,
  PeekMessagesResult,
  CreateProducerOptions,
  CreateConsumerOptions,
  SendMessageOptions,
  IPCResponse,
  ConnectedCluster,
  SavedProfile,
} from '../src/shared/types';

// Expose a secure API to the renderer process
// This will be available as window.lightcurve in the renderer
contextBridge.exposeInMainWorld('lightcurve', {
  // Cluster Management
  cluster: {
    connect: async (config: ClusterConfig): Promise<IPCResponse<ConnectedCluster>> => {
      return await ipcRenderer.invoke('cluster:connect', config);
    },
    disconnect: async (clusterId: string): Promise<IPCResponse<void>> => {
      return await ipcRenderer.invoke('cluster:disconnect', clusterId);
    },
    listConnected: async (): Promise<IPCResponse<ConnectedCluster[]>> => {
      return await ipcRenderer.invoke('cluster:list');
    },
  },

  // Connection Profiles
  profiles: {
    listProfiles: async (): Promise<IPCResponse<SavedProfile[]>> => {
      return await ipcRenderer.invoke('profiles:listProfiles');
    },
    saveProfile: async (profile: Omit<SavedProfile, 'profileId' | 'savedAt'>): Promise<IPCResponse<SavedProfile>> => {
      return await ipcRenderer.invoke('profiles:saveProfile', profile);
    },
    deleteProfile: async (profileId: string): Promise<IPCResponse<void>> => {
      return await ipcRenderer.invoke('profiles:deleteProfile', profileId);
    },
    getProfile: async (profileId: string): Promise<IPCResponse<SavedProfile | null>> => {
      return await ipcRenderer.invoke('profiles:getProfile', profileId);
    },
  },

  // Admin API - Cluster Discovery
  admin: {
    listClusters: async (clusterId: string): Promise<IPCResponse<string[]>> => {
      return await ipcRenderer.invoke('admin:listClusters', clusterId);
    },
    listTenants: async (clusterId: string): Promise<IPCResponse<string[]>> => {
      return await ipcRenderer.invoke('admin:listTenants', clusterId);
    },
    listNamespaces: async (clusterId: string, tenant: string): Promise<IPCResponse<string[]>> => {
      return await ipcRenderer.invoke('admin:listNamespaces', clusterId, tenant);
    },
    listTopics: async (clusterId: string, tenant: string, namespace: string): Promise<IPCResponse<string[]>> => {
      return await ipcRenderer.invoke('admin:listTopics', clusterId, tenant, namespace);
    },
    getTopicStats: async (clusterId: string, fullTopicName: string): Promise<IPCResponse<TopicStats>> => {
      return await ipcRenderer.invoke('admin:getTopicStats', clusterId, fullTopicName);
    },
    listSubscriptions: async (clusterId: string, fullTopicName: string): Promise<IPCResponse<string[]>> => {
      return await ipcRenderer.invoke('admin:listSubscriptions', clusterId, fullTopicName);
    },
  },

  // Message Operations
  messages: {
    browse: async (clusterId: string, options: BrowseMessagesOptions): Promise<IPCResponse<BrowseMessagesResult>> => {
      return await ipcRenderer.invoke('messages:browse', clusterId, options);
    },
    peek: async (clusterId: string, options: PeekMessagesOptions): Promise<IPCResponse<PeekMessagesResult>> => {
      return await ipcRenderer.invoke('messages:peek', clusterId, options);
    },
    send: async (clusterId: string, topic: string, payload: string, key?: string, properties?: Record<string, string>): Promise<IPCResponse<string>> => {
      return await ipcRenderer.invoke('messages:send', clusterId, topic, payload, key, properties);
    },
    // Streaming consumer controls
    startConsumer: async (clusterId: string, topic: string, subscription: string, subscriptionType?: string): Promise<IPCResponse<string>> => {
      return await ipcRenderer.invoke('messages:startConsumer', clusterId, topic, subscription, subscriptionType);
    },
    pauseConsumer: async (consumerId: string): Promise<IPCResponse<void>> => {
      return await ipcRenderer.invoke('messages:pauseConsumer', consumerId);
    },
    stopConsumer: async (consumerId: string): Promise<IPCResponse<void>> => {
      return await ipcRenderer.invoke('messages:stopConsumer', consumerId);
    },
    // Event listener for streaming messages
    onMessage: (callback: (data: { consumerId: string; message: any }) => void) => {
      const listener = (_event: any, data: any) => callback(data);
      ipcRenderer.on('messages:received', listener);
      return () => ipcRenderer.removeListener('messages:received', listener);
    },
    // Browse messages (read-only)
    browseMessages: async (clusterId: string, topicName: string): Promise<IPCResponse<{ readerId: string }>> => {
      return await ipcRenderer.invoke('messages:browseMessages', clusterId, topicName);
    },
    readMessages: async (clusterId: string, readerId: string, maxMessages: number): Promise<IPCResponse<any[]>> => {
      return await ipcRenderer.invoke('messages:readMessages', clusterId, readerId, maxMessages);
    },
    closeReader: async (clusterId: string, readerId: string): Promise<IPCResponse<void>> => {
      return await ipcRenderer.invoke('messages:closeReader', clusterId, readerId);
    },
    unsubscribe: async (clusterId: string, topic: string): Promise<IPCResponse<void>> => {
      return await ipcRenderer.invoke('messages:unsubscribe', clusterId, topic);
    },
  },

  // Producer Operations
  producer: {
    create: async (clusterId: string, options: CreateProducerOptions): Promise<IPCResponse<string>> => {
      return await ipcRenderer.invoke('producer:create', clusterId, options);
    },
    send: async (producerId: string, message: SendMessageOptions): Promise<IPCResponse<string>> => {
      return await ipcRenderer.invoke('producer:send', producerId, message);
    },
    close: async (producerId: string): Promise<IPCResponse<void>> => {
      return await ipcRenderer.invoke('producer:close', producerId);
    },
  },

  // Consumer Operations
  consumer: {
    create: async (clusterId: string, options: CreateConsumerOptions): Promise<IPCResponse<string>> => {
      return await ipcRenderer.invoke('consumer:create', clusterId, options);
    },
    receive: async (consumerId: string, timeoutMs?: number): Promise<IPCResponse<unknown>> => {
      return await ipcRenderer.invoke('consumer:receive', consumerId, timeoutMs);
    },
    acknowledge: async (consumerId: string, messageId: string): Promise<IPCResponse<void>> => {
      return await ipcRenderer.invoke('consumer:acknowledge', consumerId, messageId);
    },
    close: async (consumerId: string): Promise<IPCResponse<void>> => {
      return await ipcRenderer.invoke('consumer:close', consumerId);
    },
  },

  // Logs from main process forwarded to renderer
  logs: {
    onLog: (callback: (payload: { level: string; args: string[] }) => void) => {
      const listener = (_event: any, payload: { level: string; args: string[] }) => callback(payload);
      ipcRenderer.on('log', listener);
      return () => ipcRenderer.removeListener('log', listener);
    },
  },
});

// Type definitions for the exposed API
export interface LightCurveAPI {
  cluster: {
    connect: (config: ClusterConfig) => Promise<IPCResponse<ConnectedCluster>>;
    disconnect: (clusterId: string) => Promise<IPCResponse<void>>;
    listConnected: () => Promise<IPCResponse<ConnectedCluster[]>>;
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
    send: (clusterId: string, topic: string, payload: string, key?: string, properties?: Record<string, string>) => Promise<IPCResponse<string>>;
    startConsumer: (clusterId: string, topic: string, subscription: string, subscriptionType?: string) => Promise<IPCResponse<string>>;
    pauseConsumer: (consumerId: string) => Promise<IPCResponse<void>>;
    stopConsumer: (consumerId: string) => Promise<IPCResponse<void>>;
    onMessage: (callback: (data: { consumerId: string; message: any }) => void) => () => void;
    browseMessages: (clusterId: string, topicName: string) => Promise<IPCResponse<{ readerId: string }>>;
    readMessages: (clusterId: string, readerId: string, maxMessages: number) => Promise<IPCResponse<any[]>>;
    closeReader: (clusterId: string, readerId: string) => Promise<IPCResponse<void>>;
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
  logs: {
    onLog: (callback: (payload: { level: string; args: string[] }) => void) => () => void;
  };
}

declare global {
  interface Window {
    lightcurve: LightCurveAPI;
  }
}
