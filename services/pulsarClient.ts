/**
 * PulsarMessageClient - Service class for interacting with Apache Pulsar messaging
 * Uses the pulsar-client npm package to provide producer, consumer, and reader functionality
 */

import Pulsar from 'pulsar-client';

export interface PulsarClientConfig {
  serviceUrl: string;
  authentication?: Pulsar.AuthenticationTls | Pulsar.AuthenticationToken | Pulsar.AuthenticationAthenz;
  operationTimeoutSeconds?: number;
  ioThreads?: number;
  messageListenerThreads?: number;
  concurrentLookupRequest?: number;
  tlsTrustCertsFilePath?: string;
  tlsValidateHostname?: boolean;
  tlsAllowInsecureConnection?: boolean;
  statsIntervalInSeconds?: number;
}

export interface ProducerOptions {
  topic: string;
  producerName?: string;
  sendTimeoutMs?: number;
  initialSequenceId?: number;
  maxPendingMessages?: number;
  maxPendingMessagesAcrossPartitions?: number;
  blockIfQueueFull?: boolean;
  messageRoutingMode?: 'SinglePartition' | 'RoundRobinPartition';
  hashingScheme?: 'Murmur3_32Hash' | 'BoostHash' | 'JavaStringHash';
  compressionType?: 'Zlib' | 'LZ4' | 'ZSTD' | 'SNAPPY';
  batchingEnabled?: boolean;
  batchingMaxPublishDelayMs?: number;
  batchingMaxMessages?: number;
}

export interface ConsumerOptions {
  topic: string;
  subscription: string;
  subscriptionType?: 'Exclusive' | 'Shared' | 'Failover' | 'Key_Shared';
  subscriptionInitialPosition?: 'Latest' | 'Earliest';
  ackTimeoutMs?: number;
  nAckRedeliverTimeoutMs?: number;
  receiverQueueSize?: number;
  receiverQueueSizeAcrossPartitions?: number;
  consumerName?: string;
  properties?: Record<string, string>;
}

export interface ReaderOptions {
  topic: string;
  startMessageId?: Pulsar.MessageId;
  receiverQueueSize?: number;
  readerName?: string;
  subscriptionRolePrefix?: string;
  readCompacted?: boolean;
}

export interface PulsarMessage {
  data: Buffer;
  messageId: string;
  properties: Record<string, string>;
  publishTimestamp: number;
  eventTimestamp: number;
  redeliveryCount: number;
  partitionKey?: string;
  topicName: string;
}

export interface ProducerSendOptions {
  data: Buffer;
  properties?: Record<string, string>;
  eventTimestamp?: number;
  sequenceId?: number;
  partitionKey?: string;
  orderingKey?: string;
  deliverAfter?: number;
  deliverAt?: number;
}

/**
 * Wrapper for Pulsar Producer
 */
export class PulsarProducer {
  constructor(private readonly producer: Pulsar.Producer) {}

  async send(options: ProducerSendOptions): Promise<Pulsar.MessageId> {
    const message: Pulsar.ProducerMessage = {
      data: options.data,
    };

    if (options.properties) {
      message.properties = options.properties;
    }
    if (options.eventTimestamp !== undefined) {
      message.eventTimestamp = options.eventTimestamp;
    }
    if (options.sequenceId !== undefined) {
      message.sequenceId = options.sequenceId;
    }
    if (options.partitionKey) {
      message.partitionKey = options.partitionKey;
    }
    if (options.orderingKey) {
      message.orderingKey = options.orderingKey;
    }
    if (options.deliverAfter !== undefined) {
      message.deliverAfter = options.deliverAfter;
    }
    if (options.deliverAt !== undefined) {
      message.deliverAt = options.deliverAt;
    }

    return await this.producer.send(message);
  }

  async flush(): Promise<void> {
    await this.producer.flush();
  }

  async close(): Promise<void> {
    await this.producer.close();
  }

  getProducerName(): string {
    return this.producer.getProducerName();
  }

  getTopic(): string {
    return this.producer.getTopic();
  }
}

/**
 * Wrapper for Pulsar Consumer
 */
export class PulsarConsumer {
  constructor(private readonly consumer: Pulsar.Consumer) {}

  async receive(): Promise<PulsarMessage> {
    const msg = await this.consumer.receive();
    return this.convertMessage(msg);
  }

  async receive_timeout(timeoutMs: number): Promise<PulsarMessage | null> {
    try {
      const msg = await this.consumer.receive(timeoutMs);
      return this.convertMessage(msg);
    } catch (error) {
      // Timeout returns null
      return null;
    }
  }

  async acknowledge(message: Pulsar.Message): Promise<void> {
    await this.consumer.acknowledge(message);
  }

  async acknowledgeById(messageId: Pulsar.MessageId): Promise<void> {
    await this.consumer.acknowledgeId(messageId);
  }

  async acknowledgeCumulative(message: Pulsar.Message): Promise<void> {
    await this.consumer.acknowledgeCumulative(message);
  }

  async negativeAcknowledge(message: Pulsar.Message): Promise<void> {
    await this.consumer.negativeAcknowledge(message);
  }

  async close(): Promise<void> {
    await this.consumer.close();
  }

  getSubscription(): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.consumer as any).getSubscription?.() || 'unknown';
  }

  getTopic(): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.consumer as any).getTopic?.() || 'unknown';
  }

  private convertMessage(msg: Pulsar.Message): PulsarMessage {
    return {
      // Copy the buffer to avoid referencing freed native memory
      data: Buffer.from(msg.getData()),
      // Store messageId as string to avoid native handle lifetime issues
      messageId: msg.getMessageId().toString(),
      // Clone properties to detach from native memory
      properties: { ...(msg.getProperties() || {}) },
      publishTimestamp: msg.getPublishTimestamp(),
      eventTimestamp: msg.getEventTimestamp(),
      redeliveryCount: msg.getRedeliveryCount(),
      partitionKey: msg.getPartitionKey() ? String(msg.getPartitionKey()) : undefined,
      topicName: String(msg.getTopicName()),
    };
  }
}

/**
 * Wrapper for Pulsar Reader
 */
export class PulsarReader {
  constructor(private readonly reader: Pulsar.Reader) {}

  async readNext(): Promise<PulsarMessage> {
    const msg = await this.reader.readNext();
    return this.convertMessage(msg);
  }

  async readNext_timeout(timeoutMs: number): Promise<PulsarMessage | null> {
    try {
      const msg = await this.reader.readNext(timeoutMs);
      return this.convertMessage(msg);
    } catch (error) {
      // Timeout returns null
      return null;
    }
  }

  hasNext(): boolean {
    return this.reader.hasNext();
  }

  async close(): Promise<void> {
    await this.reader.close();
  }

  getTopic(): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.reader as any).getTopic?.() || 'unknown';
  }

  private convertMessage(msg: Pulsar.Message): PulsarMessage {
    return {
      data: msg.getData(),
      messageId: msg.getMessageId().toString(),
      properties: { ...(msg.getProperties() || {}) },
      publishTimestamp: msg.getPublishTimestamp(),
      eventTimestamp: msg.getEventTimestamp(),
      redeliveryCount: msg.getRedeliveryCount(),
      partitionKey: msg.getPartitionKey(),
      topicName: msg.getTopicName(),
    };
  }
}

/**
 * Main PulsarMessageClient class
 */
export class PulsarMessageClient {
  private client: Pulsar.Client | null = null;
  private readonly config: PulsarClientConfig;
  private producers: Set<PulsarProducer> = new Set();
  private consumers: Set<PulsarConsumer> = new Set();
  private readers: Set<PulsarReader> = new Set();

  constructor(config: PulsarClientConfig) {
    this.config = config;
  }

  /**
   * Initialize the Pulsar client connection
   */
  private ensureClient(): Pulsar.Client {
    if (!this.client) {
      const clientConfig: Pulsar.ClientConfig = {
        serviceUrl: this.config.serviceUrl,
      };

      if (this.config.authentication) {
        clientConfig.authentication = this.config.authentication;
      }
      if (this.config.operationTimeoutSeconds !== undefined) {
        clientConfig.operationTimeoutSeconds = this.config.operationTimeoutSeconds;
      }
      if (this.config.ioThreads !== undefined) {
        clientConfig.ioThreads = this.config.ioThreads;
      }
      if (this.config.messageListenerThreads !== undefined) {
        clientConfig.messageListenerThreads = this.config.messageListenerThreads;
      }
      if (this.config.concurrentLookupRequest !== undefined) {
        clientConfig.concurrentLookupRequest = this.config.concurrentLookupRequest;
      }
      if (this.config.tlsTrustCertsFilePath) {
        clientConfig.tlsTrustCertsFilePath = this.config.tlsTrustCertsFilePath;
      }
      if (this.config.tlsValidateHostname !== undefined) {
        clientConfig.tlsValidateHostname = this.config.tlsValidateHostname;
      }
      if (this.config.tlsAllowInsecureConnection !== undefined) {
        clientConfig.tlsAllowInsecureConnection = this.config.tlsAllowInsecureConnection;
      }
      if (this.config.statsIntervalInSeconds !== undefined) {
        clientConfig.statsIntervalInSeconds = this.config.statsIntervalInSeconds;
      }

      this.client = new Pulsar.Client(clientConfig);
    }
    return this.client;
  }

  /**
   * Create a producer for a specific topic
   */
  async createProducer(topic: string, options?: Partial<ProducerOptions>): Promise<PulsarProducer> {
    const client = this.ensureClient();

    const producerConfig: Pulsar.ProducerConfig = {
      topic,
      producerName: options?.producerName,
      sendTimeoutMs: options?.sendTimeoutMs,
      initialSequenceId: options?.initialSequenceId,
      maxPendingMessages: options?.maxPendingMessages,
      maxPendingMessagesAcrossPartitions: options?.maxPendingMessagesAcrossPartitions,
      blockIfQueueFull: options?.blockIfQueueFull,
      batchingEnabled: options?.batchingEnabled,
      batchingMaxPublishDelayMs: options?.batchingMaxPublishDelayMs,
      batchingMaxMessages: options?.batchingMaxMessages,
    };

    const producer = await client.createProducer(producerConfig);
    const wrapper = new PulsarProducer(producer);
    this.producers.add(wrapper);
    return wrapper;
  }

  /**
   * Create a consumer for a specific topic and subscription
   */
  async createConsumer(options: ConsumerOptions): Promise<PulsarConsumer> {
    const client = this.ensureClient();

    const consumerConfig: Pulsar.ConsumerConfig = {
      topic: options.topic,
      subscription: options.subscription,
      // Map to numeric enum: Exclusive=0, Shared=1, Failover=2, KeyShared=3
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      subscriptionType: (options.subscriptionType === 'Key_Shared' ? 3 : options.subscriptionType === 'Failover' ? 2 : options.subscriptionType === 'Shared' ? 1 : 0) as any,
    };

    if (options.subscriptionInitialPosition) {
      consumerConfig.subscriptionInitialPosition = options.subscriptionInitialPosition;
    }
    if (options.ackTimeoutMs !== undefined) {
      consumerConfig.ackTimeoutMs = options.ackTimeoutMs;
    }
    if (options.nAckRedeliverTimeoutMs !== undefined) {
      consumerConfig.nAckRedeliverTimeoutMs = options.nAckRedeliverTimeoutMs;
    }
    if (options.receiverQueueSize !== undefined) {
      consumerConfig.receiverQueueSize = options.receiverQueueSize;
    }
    if (options.receiverQueueSizeAcrossPartitions !== undefined) {
      consumerConfig.receiverQueueSizeAcrossPartitions = options.receiverQueueSizeAcrossPartitions;
    }
    if (options.consumerName) {
      consumerConfig.consumerName = options.consumerName;
    }
    if (options.properties) {
      consumerConfig.properties = options.properties;
    }

    const consumer = await client.subscribe(consumerConfig);
    const wrapper = new PulsarConsumer(consumer);
    this.consumers.add(wrapper);
    return wrapper;
  }

  /**
   * Create a reader for a specific topic
   */
  async createReader(options: ReaderOptions): Promise<PulsarReader> {
    const client = this.ensureClient();

    const readerConfig: Pulsar.ReaderConfig = {
      topic: options.topic,
      startMessageId: options.startMessageId || Pulsar.MessageId.earliest(),
    };

    if (options.receiverQueueSize !== undefined) {
      readerConfig.receiverQueueSize = options.receiverQueueSize;
    }
    if (options.readerName) {
      readerConfig.readerName = options.readerName;
    }
    if (options.subscriptionRolePrefix) {
      readerConfig.subscriptionRolePrefix = options.subscriptionRolePrefix;
    }
    if (options.readCompacted !== undefined) {
      readerConfig.readCompacted = options.readCompacted;
    }

    const reader = await client.createReader(readerConfig);
    const wrapper = new PulsarReader(reader);
    this.readers.add(wrapper);
    return wrapper;
  }

  /**
   * Close all producers, consumers, readers, and the client connection
   */
  async close(): Promise<void> {
    // Close all producers
    const producerClosePromises = Array.from(this.producers).map(p => 
      p.close().catch(err => console.error('Error closing producer:', err))
    );
    await Promise.all(producerClosePromises);
    this.producers.clear();

    // Close all consumers
    const consumerClosePromises = Array.from(this.consumers).map(c => 
      c.close().catch(err => console.error('Error closing consumer:', err))
    );
    await Promise.all(consumerClosePromises);
    this.consumers.clear();

    // Close all readers
    const readerClosePromises = Array.from(this.readers).map(r => 
      r.close().catch(err => console.error('Error closing reader:', err))
    );
    await Promise.all(readerClosePromises);
    this.readers.clear();

    // Close the client
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  /**
   * Check if the client is connected
   */
  isConnected(): boolean {
    return this.client !== null;
  }
}

// Re-export Pulsar types for convenience
export { Pulsar };
