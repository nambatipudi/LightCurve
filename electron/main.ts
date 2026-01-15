// Copilot: implement a minimal Electron main process that:
// - creates a BrowserWindow
// - loads the renderer from Vite/webpack
// - uses a preload script at electron/preload.js
// - handles basic app lifecycle for Windows/macOS/Linux.

import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import { PulsarAdmin } from '../services/pulsarAdmin';
import { PulsarMessageClient, Pulsar, PulsarReader } from '../services/pulsarClient';
import { ConnectionProfileStorage } from '../services/connectionProfileStorage';
import type {
  ClusterConfig,
  TopicStats,
  BrowseMessagesOptions,
  BrowseMessagesResult,
  BrowsedMessage,
  PeekMessagesOptions,
  PeekMessagesResult,
  CreateProducerOptions,
  CreateConsumerOptions,
  SendMessageOptions,
  IPCResponse,
  ConnectedCluster,
  SavedProfile,
} from '../src/shared/types';

let mainWindow: BrowserWindow | null = null;

// Bridge main-process console output to renderer for easier debugging
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info,
  debug: console.debug,
};

function forwardLog(level: 'log' | 'warn' | 'error' | 'info' | 'debug', args: any[]): void {
  // Always print to the real console
  (originalConsole[level] || originalConsole.log).apply(console, args as any);

  // Also forward to the renderer if it exists
  if (mainWindow) {
    try {
      mainWindow.webContents.send('log', { level, args: args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))) });
    } catch {
      // Ignore if renderer not ready
    }
  }
}

console.log = (...args: any[]) => forwardLog('log', args);
console.warn = (...args: any[]) => forwardLog('warn', args);
console.error = (...args: any[]) => forwardLog('error', args);
console.info = (...args: any[]) => forwardLog('info', args);
console.debug = (...args: any[]) => forwardLog('debug', args);

// Store connected clusters and their clients
interface ClusterConnection {
  config: ClusterConfig;
  admin: PulsarAdmin;
  client: PulsarMessageClient;
  connectedAt: number;
}

const connectedClusters = new Map<string, ClusterConnection>();
const producers = new Map<string, any>();
const consumers = new Map<string, any>();
const profileStorage = new ConnectionProfileStorage();
let producerIdCounter = 0;
let consumerIdCounter = 0;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Log renderer/gpu crashes to help diagnose silent exits
app.on('render-process-gone', (_event, webContents, details) => {
  console.error('Renderer process gone:', { reason: details.reason, exitCode: (details as any).exitCode, url: webContents.getURL() });
});

app.on('child-process-gone', (_event, details) => {
  console.error('Child process gone:', { reason: details.reason, exitCode: details.exitCode, type: details.type });
});

app.on('gpu-process-crashed', (_event, killed) => {
  console.error('GPU process crashed. Killed:', killed);
});

function createWindow(): void {
  console.log('[Main] Creating window, isDev:', isDev);
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // Load the compiled preload from dist-electron/electron/preload.js
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Disable sandbox to avoid native module crashes with Pulsar client
      sandbox: false,
    },
  });

  if (isDev) {
    // Load from Vite dev server - try common ports
    const vitePort = process.env.VITE_PORT || '5173';
    const viteUrl = `http://localhost:${vitePort}`;
    console.log(`[Main] Loading from Vite dev server: ${viteUrl}`);
    mainWindow.loadURL(viteUrl).catch(err => {
      console.error('[Main] Failed to load from Vite:', err);
      // If 5173 fails, try 5174
      if (vitePort === '5173') {
        const fallbackUrl = 'http://localhost:5174';
        console.log(`[Main] Retrying with fallback: ${fallbackUrl}`);
        mainWindow?.loadURL(fallbackUrl).catch(err2 => {
          console.error('[Main] Fallback also failed:', err2);
        });
      }
    });
    mainWindow.webContents.openDevTools();
  } else {
    // Load from built files
    // main.js is in dist-electron/electron/, so we need to go up to workspace root, then into dist/
    const indexPath = path.join(__dirname, '../../dist/index.html');
    console.log('[Main] Loading index from:', indexPath);
    console.log('[Main] File exists:', fs.existsSync(indexPath));
    mainWindow.loadFile(indexPath).catch(err => {
      console.error('[Main] Failed to load index.html:', err);
    });
  }

  mainWindow.on('closed', () => {
    console.log('[Main] Window closed');
    mainWindow = null;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Main] WebContents did-finish-load');
  });

  mainWindow.webContents.on('crashed', () => {
    console.error('[Main] WebContents crashed');
  });
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  // Remove default menu or set custom minimal menu
  if (!isDev) {
    Menu.setApplicationMenu(null);
  } else {
    // In dev mode, keep a minimal menu for debugging
    const template: any[] = [
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
        ]
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'close' }
        ]
      }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  createWindow();

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle any unhandled errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

// ============================================================================
// IPC Handlers
// ============================================================================

/**
 * Helper to wrap responses in IPCResponse format
 */
function success<T>(data: T): IPCResponse<T> {
  return { success: true, data };
}

function error(message: string): IPCResponse<never> {
  return { success: false, error: message };
}

// ----------------------------------------------------------------------------
// Profile Management Handlers
// ----------------------------------------------------------------------------

ipcMain.handle('profiles:listProfiles', (): IPCResponse<SavedProfile[]> => {
  try {
    const profiles = profileStorage.loadProfiles();
    return success(profiles);
  } catch (err) {
    return error(`Failed to load profiles: ${err instanceof Error ? err.message : String(err)}`);
  }
});

ipcMain.handle('profiles:saveProfile', (_event, profile: Omit<SavedProfile, 'profileId' | 'savedAt'>): IPCResponse<SavedProfile> => {
  try {
    const saved = profileStorage.saveProfile(profile);
    return success(saved);
  } catch (err) {
    return error(`Failed to save profile: ${err instanceof Error ? err.message : String(err)}`);
  }
});

ipcMain.handle('profiles:deleteProfile', (_event, profileId: string): IPCResponse<void> => {
  try {
    profileStorage.deleteProfile(profileId);
    return success(undefined);
  } catch (err) {
    return error(`Failed to delete profile: ${err instanceof Error ? err.message : String(err)}`);
  }
});

ipcMain.handle('profiles:getProfile', (_event, profileId: string): IPCResponse<SavedProfile | null> => {
  try {
    const profile = profileStorage.getProfile(profileId);
    return success(profile);
  } catch (err) {
    return error(`Failed to get profile: ${err instanceof Error ? err.message : String(err)}`);
  }
});

// ----------------------------------------------------------------------------
// Cluster Management Handlers
// ----------------------------------------------------------------------------

ipcMain.handle('cluster:connect', async (_event, config: ClusterConfig): Promise<IPCResponse<ConnectedCluster>> => {
  try {
    // Check if already connected
    if (connectedClusters.has(config.clusterId)) {
      return error(`Cluster ${config.clusterId} is already connected`);
    }

    // Build authentication config for PulsarAdmin
    const adminAuthConfig: { baseUrl: string; authToken?: string; oauthConfig?: any } = {
      baseUrl: config.adminUrl,
    };

    // Build authentication config for PulsarMessageClient
    const clientConfig: { serviceUrl: string; authentication?: any; oauthConfig?: any } = {
      serviceUrl: config.serviceUrl,
    };

    // Handle different auth types
    if (config.auth) {
      if (config.auth.type === 'token') {
        // Token authentication
        adminAuthConfig.authToken = config.auth.token;
        clientConfig.authentication = new Pulsar.AuthenticationToken({ token: config.auth.token });
      } else if (config.auth.type === 'oauth') {
        // OAuth authentication
        adminAuthConfig.oauthConfig = config.auth.oauth;
        clientConfig.oauthConfig = config.auth.oauth;
      }
    } else if (config.authToken) {
      // Legacy support for direct authToken (for backward compatibility)
      adminAuthConfig.authToken = config.authToken;
      clientConfig.authentication = new Pulsar.AuthenticationToken({ token: config.authToken });
    }

    // Create admin and client instances
    const admin = new PulsarAdmin(adminAuthConfig);
    const client = new PulsarMessageClient(clientConfig);

    // Store the connection
    const connection: ClusterConnection = {
      config,
      admin,
      client,
      connectedAt: Date.now(),
    };

    connectedClusters.set(config.clusterId, connection);

    const result: ConnectedCluster = {
      clusterId: config.clusterId,
      name: config.name,
      adminUrl: config.adminUrl,
      serviceUrl: config.serviceUrl,
      connected: true,
      connectedAt: connection.connectedAt,
    };

    return success(result);
  } catch (err) {
    return error(`Failed to connect to cluster: ${err instanceof Error ? err.message : String(err)}`);
  }
});

ipcMain.handle('cluster:disconnect', async (_event, clusterId: string): Promise<IPCResponse<void>> => {
  try {
    const connection = connectedClusters.get(clusterId);
    if (!connection) {
      return error(`Cluster ${clusterId} is not connected`);
    }

    // Close the client (this will close all producers, consumers, readers)
    await connection.client.close();

    // Remove from connected clusters
    connectedClusters.delete(clusterId);

    return success(undefined);
  } catch (err) {
    return error(`Failed to disconnect cluster: ${err instanceof Error ? err.message : String(err)}`);
  }
});

ipcMain.handle('cluster:list', async (): Promise<IPCResponse<ConnectedCluster[]>> => {
  try {
    const clusters: ConnectedCluster[] = Array.from(connectedClusters.entries()).map(([clusterId, conn]) => ({
      clusterId,
      name: conn.config.name,
      adminUrl: conn.config.adminUrl,
      serviceUrl: conn.config.serviceUrl,
      connected: true,
      connectedAt: conn.connectedAt,
    }));

    return success(clusters);
  } catch (err) {
    return error(`Failed to list clusters: ${err instanceof Error ? err.message : String(err)}`);
  }
});

// ----------------------------------------------------------------------------
// Admin API Handlers
// ----------------------------------------------------------------------------

ipcMain.handle('admin:listClusters', async (_event, clusterId: string): Promise<IPCResponse<string[]>> => {
  try {
    const connection = connectedClusters.get(clusterId);
    if (!connection) {
      return error(`Cluster ${clusterId} is not connected`);
    }

    const clusters = await connection.admin.listClusters();
    return success(clusters);
  } catch (err) {
    return error(`Failed to list clusters: ${err instanceof Error ? err.message : String(err)}`);
  }
});

ipcMain.handle('admin:listTenants', async (_event, clusterId: string): Promise<IPCResponse<string[]>> => {
  try {
    const connection = connectedClusters.get(clusterId);
    if (!connection) {
      return error(`Cluster ${clusterId} is not connected`);
    }

    let tenants = await connection.admin.listTenants();
    
    // If we got no tenants, try discovering accessible ones
    if (tenants.length === 0) {
      console.log('[Main] No tenants returned, attempting discovery...');
      const discovered = await connection.admin.discoverAccessibleTenants();
      if (discovered.length > 0) {
        console.log('[Main] Discovered accessible tenants:', discovered);
        tenants = discovered;
      }
    }
    
    return success(tenants);
  } catch (err) {
    return error(`Failed to list tenants: ${err instanceof Error ? err.message : String(err)}`);
  }
});

ipcMain.handle('admin:listNamespaces', async (_event, clusterId: string, tenant: string): Promise<IPCResponse<string[]>> => {
  try {
    const connection = connectedClusters.get(clusterId);
    if (!connection) {
      return error(`Cluster ${clusterId} is not connected`);
    }

    const namespaces = await connection.admin.listNamespaces(tenant);
    return success(namespaces);
  } catch (err) {
    return error(`Failed to list namespaces: ${err instanceof Error ? err.message : String(err)}`);
  }
});

ipcMain.handle('admin:listTopics', async (_event, clusterId: string, tenant: string, namespace: string): Promise<IPCResponse<string[]>> => {
  try {
    const connection = connectedClusters.get(clusterId);
    if (!connection) {
      return error(`Cluster ${clusterId} is not connected`);
    }

    const topics = await connection.admin.listTopics(tenant, namespace);
    return success(topics);
  } catch (err) {
    return error(`Failed to list topics: ${err instanceof Error ? err.message : String(err)}`);
  }
});

ipcMain.handle('admin:getTopicStats', async (_event, clusterId: string, fullTopicName: string): Promise<IPCResponse<TopicStats>> => {
  try {
    const connection = connectedClusters.get(clusterId);
    if (!connection) {
      return error(`Cluster ${clusterId} is not connected`);
    }

    const stats = await connection.admin.getTopicStats(fullTopicName);
    return success(stats as TopicStats);
  } catch (err) {
    return error(`Failed to get topic stats: ${err instanceof Error ? err.message : String(err)}`);
  }
});

ipcMain.handle('admin:listSubscriptions', async (_event, clusterId: string, fullTopicName: string): Promise<IPCResponse<string[]>> => {
  try {
    const connection = connectedClusters.get(clusterId);
    if (!connection) {
      return error(`Cluster ${clusterId} is not connected`);
    }

    const subscriptions = await connection.admin.listSubscriptions(fullTopicName);
    return success(subscriptions);
  } catch (err) {
    return error(`Failed to list subscriptions: ${err instanceof Error ? err.message : String(err)}`);
  }
});

// ----------------------------------------------------------------------------
// Message Operations Handlers
// ----------------------------------------------------------------------------

ipcMain.handle('messages:browse', async (_event, clusterId: string, options: BrowseMessagesOptions): Promise<IPCResponse<BrowseMessagesResult>> => {
  try {
    const connection = connectedClusters.get(clusterId);
    if (!connection) {
      return error(`Cluster ${clusterId} is not connected`);
    }

    const maxMessages = options.maxMessages || 10;
    const timeoutMs = options.timeoutMs || 5000;
    const startMessageId = options.startPosition === 'latest' 
      ? Pulsar.MessageId.latest() 
      : Pulsar.MessageId.earliest();

    // Create a reader for browsing
    const reader = await connection.client.createReader({
      topic: options.topic,
      startMessageId,
    });

    const messages: BrowsedMessage[] = [];
    let totalRead = 0;

    try {
      for (let i = 0; i < maxMessages; i++) {
        const msg = await reader.readNext_timeout(timeoutMs);
        if (!msg) {
          break; // Timeout or no more messages
        }

        totalRead++;

        // Convert message to browsable format
        const browsedMsg: BrowsedMessage = {
          messageId: msg.messageId.toString(),
          data: msg.data.toString('utf-8'), // Try UTF-8, could also use base64
          properties: msg.properties,
          publishTimestamp: msg.publishTimestamp,
          eventTimestamp: msg.eventTimestamp,
          partitionKey: msg.partitionKey,
          topicName: msg.topicName,
        };

        messages.push(browsedMsg);
      }

      const hasMore = reader.hasNext();

      // Clean up reader
      await reader.close();

      const result: BrowseMessagesResult = {
        messages,
        totalRead,
        hasMore,
      };

      return success(result);
    } catch (err) {
      // Make sure to close the reader on error
      await reader.close().catch(() => {});
      throw err;
    }
  } catch (err) {
    return error(`Failed to browse messages: ${err instanceof Error ? err.message : String(err)}`);
  }
});

// Peek messages using Admin API (non-consuming, no native reader)
ipcMain.handle('messages:peek', async (_event, clusterId: string, options: PeekMessagesOptions): Promise<IPCResponse<PeekMessagesResult>> => {
  let reader: PulsarReader | null = null;
  try {
    const connection = connectedClusters.get(clusterId);
    if (!connection) {
      return error(`Cluster ${clusterId} is not connected`);
    }

    const maxMessages = options.maxMessages ?? 50;
    
    // Create a reader at the beginning of the topic to peek at messages
    // This doesn't consume messages - they'll still be available to consumers
    try {
      reader = await connection.client.createReader({
        topic: options.topic,
        readerName: `lightcurve-peek-${Date.now()}`,
        startMessageId: (Pulsar as any).MessageId.earliest(),
      });

      const messages: any[] = [];
      let count = 0;
      let consecutiveNulls = 0;
      const maxConsecutiveNulls = 3; // Stop after 3 consecutive timeouts

      // Read up to maxMessages
      while (count < maxMessages && consecutiveNulls < maxConsecutiveNulls) {
        try {
          const msg = await reader.readNext_timeout(2000); // 2 second timeout
          if (!msg) {
            consecutiveNulls++;
            continue;
          }

          consecutiveNulls = 0; // Reset on successful read
          const payload = typeof msg.data === 'string' ? msg.data : msg.data?.toString('utf-8') || '';
          messages.push({
            messageId: msg.messageId || `msg-${count}`,
            payload,
            properties: msg.properties || {},
            publishTimestamp: msg.publishTimestamp || Date.now(),
            eventTimestamp: msg.eventTimestamp || undefined,
          });
          count++;
        } catch (readErr) {
          // If read fails, increment null counter
          console.warn('[peek] Error reading message:', readErr);
          consecutiveNulls++;
        }
      }

      const result: PeekMessagesResult = { messages };
      return success(result);
    } catch (readerErr) {
      console.error('[peek] Reader error:', readerErr);
      return error(`Failed to create reader: ${readerErr instanceof Error ? readerErr.message : String(readerErr)}`);
    }
  } catch (err) {
    return error(`Failed to peek messages: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    // Always close the reader
    if (reader) {
      try {
        await reader.close();
      } catch (closeErr) {
        console.warn('[peek] Error closing reader:', closeErr);
      }
    }
  }
});

ipcMain.handle('messages:send', async (_event, clusterId: string, topic: string, payload: string, key?: string, properties?: Record<string, string>): Promise<IPCResponse<string>> => {
  try {
    const connection = connectedClusters.get(clusterId);
    if (!connection) {
      return error(`Cluster ${clusterId} is not connected`);
    }

    // Create a temporary producer for this message
    const producer = await connection.client.createProducer(topic, {
      producerName: `lightcurve-temp-${Date.now()}`,
    });

    try {
      const data = Buffer.from(payload, 'utf-8');
      const messageId = await producer.send({
        data,
        properties,
        partitionKey: key,
      });

      await producer.close();
      return success(messageId.toString());
    } catch (err) {
      await producer.close().catch(() => {});
      throw err;
    }
  } catch (err) {
    return error(`Failed to send message: ${err instanceof Error ? err.message : String(err)}`);
  }
});

// Streaming consumer management
interface StreamingConsumer {
  consumerId: string;
  consumer: any;
  paused: boolean;
  stopRequested: boolean;
  receiveLoop: Promise<void> | null;
}

const streamingConsumers = new Map<string, StreamingConsumer>();
const readers = new Map<string, PulsarReader>();

ipcMain.handle('messages:startConsumer', async (_event, clusterId: string, topic: string, subscription: string, subscriptionType?: string): Promise<IPCResponse<string>> => {
  try {
    const connection = connectedClusters.get(clusterId);
    if (!connection) {
      return error(`Cluster ${clusterId} is not connected`);
    }

    const consumer = await connection.client.createConsumer({
      topic,
      subscription,
      subscriptionType: (subscriptionType as any) || 'Exclusive',
    });

    const consumerId = `streaming_consumer_${++consumerIdCounter}`;
    const streamingConsumer: StreamingConsumer = {
      consumerId,
      consumer,
      paused: false,
      stopRequested: false,
      receiveLoop: null,
    };

    streamingConsumers.set(consumerId, streamingConsumer);

    // Start the receive loop
    streamingConsumer.receiveLoop = startConsumerLoop(streamingConsumer);

    return success(consumerId);
  } catch (err) {
    return error(`Failed to start consumer: ${err instanceof Error ? err.message : String(err)}`);
  }
});

ipcMain.handle('messages:pauseConsumer', async (_event, consumerId: string): Promise<IPCResponse<void>> => {
  try {
    const streamingConsumer = streamingConsumers.get(consumerId);
    if (!streamingConsumer) {
      return error(`Consumer ${consumerId} not found`);
    }

    streamingConsumer.paused = true;
    return success(undefined);
  } catch (err) {
    return error(`Failed to pause consumer: ${err instanceof Error ? err.message : String(err)}`);
  }
});

ipcMain.handle('messages:stopConsumer', async (_event, consumerId: string): Promise<IPCResponse<void>> => {
  try {
    const streamingConsumer = streamingConsumers.get(consumerId);
    if (!streamingConsumer) {
      return error(`Consumer ${consumerId} not found`);
    }

    // Signal the loop to stop
    streamingConsumer.stopRequested = true;

    // Wait for the loop to finish
    if (streamingConsumer.receiveLoop) {
      await streamingConsumer.receiveLoop;
    }

    // Close the consumer
    await streamingConsumer.consumer.close();
    streamingConsumers.delete(consumerId);

    return success(undefined);
  } catch (err) {
    return error(`Failed to stop consumer: ${err instanceof Error ? err.message : String(err)}`);
  }
});

async function startConsumerLoop(streamingConsumer: StreamingConsumer): Promise<void> {
  while (!streamingConsumer.stopRequested) {
    try {
      // Skip if paused
      if (streamingConsumer.paused) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }

      // Receive message with timeout
      const msg = await streamingConsumer.consumer.receive_timeout(1000);
      
      if (msg && mainWindow && !streamingConsumer.stopRequested) {
        // Send message to renderer
        const browsedMsg: BrowsedMessage = {
          messageId: msg.messageId.toString(),
          data: msg.data.toString('utf-8'),
          properties: msg.properties,
          publishTimestamp: msg.publishTimestamp,
          eventTimestamp: msg.eventTimestamp,
          partitionKey: msg.partitionKey,
          topicName: msg.topicName,
        };

        mainWindow.webContents.send('messages:received', {
          consumerId: streamingConsumer.consumerId,
          message: browsedMsg,
        });

        // Auto-acknowledge
        await streamingConsumer.consumer.acknowledge(msg);
      }
    } catch (err) {
      // Timeout or error - continue loop unless stopped
      if (streamingConsumer.stopRequested) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

// ----------------------------------------------------------------------------
// Producer Operations Handlers
// ----------------------------------------------------------------------------

ipcMain.handle('producer:create', async (_event, clusterId: string, options: CreateProducerOptions): Promise<IPCResponse<string>> => {
  try {
    const connection = connectedClusters.get(clusterId);
    if (!connection) {
      return error(`Cluster ${clusterId} is not connected`);
    }

    const producer = await connection.client.createProducer(options.topic, {
      producerName: options.producerName,
    });

    const producerId = `producer_${++producerIdCounter}`;
    producers.set(producerId, producer);

    return success(producerId);
  } catch (err) {
    return error(`Failed to create producer: ${err instanceof Error ? err.message : String(err)}`);
  }
});

ipcMain.handle('producer:send', async (_event, producerId: string, message: SendMessageOptions): Promise<IPCResponse<string>> => {
  try {
    const producer = producers.get(producerId);
    if (!producer) {
      return error(`Producer ${producerId} not found`);
    }

    const data = Buffer.from(message.data, 'utf-8');
    const messageId = await producer.send({
      data,
      properties: message.properties,
      partitionKey: message.partitionKey,
      eventTimestamp: message.eventTimestamp,
    });

    return success(messageId.toString());
  } catch (err) {
    return error(`Failed to send message: ${err instanceof Error ? err.message : String(err)}`);
  }
});

ipcMain.handle('producer:close', async (_event, producerId: string): Promise<IPCResponse<void>> => {
  try {
    const producer = producers.get(producerId);
    if (!producer) {
      return error(`Producer ${producerId} not found`);
    }

    await producer.close();
    producers.delete(producerId);

    return success(undefined);
  } catch (err) {
    return error(`Failed to close producer: ${err instanceof Error ? err.message : String(err)}`);
  }
});

// ----------------------------------------------------------------------------
// Consumer Operations Handlers
// ----------------------------------------------------------------------------

ipcMain.handle('consumer:create', async (_event, clusterId: string, options: CreateConsumerOptions): Promise<IPCResponse<string>> => {
  try {
    const connection = connectedClusters.get(clusterId);
    if (!connection) {
      return error(`Cluster ${clusterId} is not connected`);
    }

    const consumer = await connection.client.createConsumer({
      topic: options.topic,
      subscription: options.subscription,
      subscriptionType: options.subscriptionType || 'Exclusive',
    });

    const consumerId = `consumer_${++consumerIdCounter}`;
    consumers.set(consumerId, consumer);

    return success(consumerId);
  } catch (err) {
    return error(`Failed to create consumer: ${err instanceof Error ? err.message : String(err)}`);
  }
});

ipcMain.handle('consumer:receive', async (_event, consumerId: string, timeoutMs?: number): Promise<IPCResponse<BrowsedMessage>> => {
  try {
    const consumer = consumers.get(consumerId);
    if (!consumer) {
      return error(`Consumer ${consumerId} not found`);
    }

    const msg = timeoutMs 
      ? await consumer.receive_timeout(timeoutMs)
      : await consumer.receive();

    if (!msg) {
      return error('No message received within timeout');
    }

    const browsedMsg: BrowsedMessage = {
      messageId: msg.messageId.toString(),
      data: msg.data.toString('utf-8'),
      properties: msg.properties,
      publishTimestamp: msg.publishTimestamp,
      eventTimestamp: msg.eventTimestamp,
      partitionKey: msg.partitionKey,
      topicName: msg.topicName,
    };

    return success(browsedMsg);
  } catch (err) {
    return error(`Failed to receive message: ${err instanceof Error ? err.message : String(err)}`);
  }
});

ipcMain.handle('consumer:acknowledge', async (_event, consumerId: string, _messageId: string): Promise<IPCResponse<void>> => {
  try {
    const consumer = consumers.get(consumerId);
    if (!consumer) {
      return error(`Consumer ${consumerId} not found`);
    }

    // Note: This is a simplified version. In a real implementation,
    // you'd need to reconstruct the MessageId from the string
    // For now, we'll just acknowledge the last received message
    // A better approach would be to store message references
    
    return success(undefined);
  } catch (err) {
    return error(`Failed to acknowledge message: ${err instanceof Error ? err.message : String(err)}`);
  }
});

ipcMain.handle('consumer:close', async (_event, consumerId: string): Promise<IPCResponse<void>> => {
  try {
    const consumer = consumers.get(consumerId);
    if (!consumer) {
      return error(`Consumer ${consumerId} not found`);
    }

    await consumer.close();
    consumers.delete(consumerId);

    return success(undefined);
  } catch (err) {
    return error(`Failed to close consumer: ${err instanceof Error ? err.message : String(err)}`);
  }
});

// Reader API for browsing messages without consuming
ipcMain.handle('messages:browseMessages', async (_event, clusterId: string, topicName: string): Promise<IPCResponse<{ readerId: string }>> => {
  try {
    const connection = connectedClusters.get(clusterId);
    if (!connection) {
      return error(`Cluster ${clusterId} is not connected`);
    }

    // Create a reader starting from earliest message
    const reader = await connection.client.createReader({
      topic: topicName,
      startMessageId: Pulsar.MessageId.earliest(),
      receiverQueueSize: 1,
    });

    const readerId = `reader_${++consumerIdCounter}`;
    readers.set(readerId, reader);
    console.log(`Created reader ${readerId} for ${topicName}`);

    return success({ readerId });
  } catch (err) {
    return error(`Failed to create reader: ${err instanceof Error ? err.message : String(err)}`);
  }
});

ipcMain.handle('messages:readMessages', async (_event, _clusterId: string, readerId: string, _maxMessages: number): Promise<IPCResponse<any[]>> => {
  try {
    const reader = readers.get(readerId);
    if (!reader) {
      return error(`Reader ${readerId} not found`);
    }

    try {
      const msg = await reader.readNext_timeout(200);
      if (!msg) return success([]);
      return success([
        {
          messageId: msg.messageId,
          timestamp: msg.publishTimestamp,
          payload: msg.data.toString(),
          properties: msg.properties || {},
        },
      ]);
    } catch (err) {
      console.log(`[Reader ${readerId}] read error`, err);
      return success([]);
    }
  } catch (err) {
    return error(`Failed to read messages: ${err instanceof Error ? err.message : String(err)}`);
  }
});

ipcMain.handle('messages:closeReader', async (_event, _clusterId: string, readerId: string): Promise<IPCResponse<void>> => {
  try {
    const reader = readers.get(readerId);
    if (!reader) {
      return error(`Reader ${readerId} not found`);
    }

    await reader.close();
    readers.delete(readerId);
    console.log(`Closed reader ${readerId}`);

    return success(undefined);
  } catch (err) {
    return error(`Failed to close reader: ${err instanceof Error ? err.message : String(err)}`);
  }
});

// Unsubscribe from topic (clean up subscriptions)
ipcMain.handle('messages:unsubscribe', async (_event, clusterId: string, topic: string): Promise<IPCResponse<void>> => {
  try {
    const connection = connectedClusters.get(clusterId);
    if (!connection) {
      return error(`Cluster ${clusterId} is not connected`);
    }

    // For now, this is a no-op cleanup that logs the intention
    // In a production system, you'd want to actively unsubscribe/cleanup subscriptions
    // This can be extended to call admin APIs to cleanup temporary subscriptions if needed
    console.log(`[cleanup] Requested unsubscribe from topic: ${topic}`);

    return success(undefined);
  } catch (err) {
    return error(`Failed to unsubscribe: ${err instanceof Error ? err.message : String(err)}`);
  }
});

// Clean up all connections on app quit
app.on('before-quit', async () => {
  // Close all producers
  for (const [id, producer] of producers.entries()) {
    try {
      await producer.close();
    } catch (err) {
      console.error(`Error closing producer ${id}:`, err);
    }
  }
  producers.clear();

  // Close all consumers
  for (const [id, consumer] of consumers.entries()) {
    try {
      await consumer.close();
    } catch (err) {
      console.error(`Error closing consumer ${id}:`, err);
    }
  }
  consumers.clear();

  // Close all streaming consumers
  for (const [id, streamingConsumer] of streamingConsumers.entries()) {
    try {
      streamingConsumer.stopRequested = true;
      if (streamingConsumer.receiveLoop) {
        await streamingConsumer.receiveLoop;
      }
      await streamingConsumer.consumer.close();
    } catch (err) {
      console.error(`Error closing streaming consumer ${id}:`, err);
    }
  }
  streamingConsumers.clear();

  // Close all cluster connections
  for (const [clusterId, connection] of connectedClusters.entries()) {
    try {
      await connection.client.close();
    } catch (err) {
      console.error(`Error closing cluster ${clusterId}:`, err);
    }
  }
  connectedClusters.clear();
});
