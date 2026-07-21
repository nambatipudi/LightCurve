import React, { useState, useEffect, useRef } from 'react';
import './TestMessages.css';

interface TestMessagesProps {
  clusterId: string;
  topicName: string;
}

interface ReceivedMessage {
  messageId: string;
  data: string;
  properties: Record<string, string>;
  publishTimestamp: number;
  eventTimestamp: number;
  partitionKey?: string;
  receivedAt: number;
}

export const TestMessages: React.FC<TestMessagesProps> = ({ clusterId, topicName }) => {
  // Producer state
  const [payload, setPayload] = useState('{\n  "message": "Hello Pulsar!",\n  "timestamp": ' + Date.now() + '\n}');
  const [messageKey, setMessageKey] = useState('');
  const [properties, setProperties] = useState<Array<{ key: string; value: string }>>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastMessageId, setLastMessageId] = useState<string | null>(null);

  // Consumer state
  const [subscription, setSubscription] = useState('lightcurve-temp');
  const [subscriptionType, setSubscriptionType] = useState<'Exclusive' | 'Shared' | 'Failover' | 'Key_Shared'>('Exclusive');
  const [consumerId, setConsumerId] = useState<string | null>(null);
  const [consumerStatus, setConsumerStatus] = useState<'stopped' | 'running' | 'paused'>('stopped');
  const [messages, setMessages] = useState<ReceivedMessage[]>([]);
  const [consumerError, setConsumerError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Set up message listener
  useEffect(() => {
    const unsubscribe = window.lightcurve.messages.onMessage((data) => {
      if (data.consumerId === consumerId) {
        const receivedMsg: ReceivedMessage = {
          ...data.message,
          receivedAt: Date.now(),
        };
        setMessages((prev) => [...prev, receivedMsg]);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [consumerId]);

  // Cleanup consumer on unmount
  useEffect(() => {
    return () => {
      if (consumerId) {
        window.lightcurve.messages.stopConsumer(consumerId).catch(console.error);
      }
    };
  }, [consumerId]);

  // Producer functions
  const addProperty = () => {
    setProperties([...properties, { key: '', value: '' }]);
  };

  const updateProperty = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...properties];
    updated[index][field] = value;
    setProperties(updated);
  };

  const removeProperty = (index: number) => {
    setProperties(properties.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    setSending(true);
    setSendError(null);
    setLastMessageId(null);

    try {
      // Convert properties array to object
      const propsObject: Record<string, string> = {};
      properties.forEach((prop) => {
        if (prop.key) {
          propsObject[prop.key] = prop.value;
        }
      });

      const response = await window.lightcurve.messages.send(
        clusterId,
        topicName,
        payload,
        messageKey || undefined,
        Object.keys(propsObject).length > 0 ? propsObject : undefined
      );

      if (response.success && response.data) {
        setLastMessageId(response.data);
      } else {
        setSendError(response.error || 'Failed to send message');
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  // Consumer functions
  const handleStartConsumer = async () => {
    setConsumerError(null);
    try {
      const response = await window.lightcurve.messages.startConsumer(
        clusterId,
        topicName,
        subscription,
        subscriptionType
      );

      if (response.success && response.data) {
        setConsumerId(response.data);
        setConsumerStatus('running');
        setMessages([]);
      } else {
        setConsumerError(response.error || 'Failed to start consumer');
      }
    } catch (err) {
      setConsumerError(err instanceof Error ? err.message : 'Failed to start consumer');
    }
  };

  const handlePauseConsumer = async () => {
    if (!consumerId) return;

    try {
      const response = await window.lightcurve.messages.pauseConsumer(consumerId);
      if (response.success) {
        setConsumerStatus('paused');
      } else {
        setConsumerError(response.error || 'Failed to pause consumer');
      }
    } catch (err) {
      setConsumerError(err instanceof Error ? err.message : 'Failed to pause consumer');
    }
  };

  const handleResumeConsumer = async () => {
    if (!consumerId) return;

    try {
      // Resume by starting the consumer again (unpause)
      setConsumerStatus('running');
    } catch (err) {
      setConsumerError(err instanceof Error ? err.message : 'Failed to resume consumer');
    }
  };

  const handleStopConsumer = async () => {
    if (!consumerId) return;

    try {
      const response = await window.lightcurve.messages.stopConsumer(consumerId);
      if (response.success) {
        setConsumerId(null);
        setConsumerStatus('stopped');
      } else {
        setConsumerError(response.error || 'Failed to stop consumer');
      }
    } catch (err) {
      setConsumerError(err instanceof Error ? err.message : 'Failed to stop consumer');
    }
  };

  const handleClearMessages = () => {
    setMessages([]);
  };

  const formatTimestamp = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  return (
    <div className="test-messages">
      <div className="test-messages-left">
        <div className="test-section">
          <h3>Produce Message</h3>

          <div className="form-group">
            <label>Payload</label>
            <textarea
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              placeholder="Enter message payload (JSON or text)"
              rows={8}
              disabled={sending}
            />
          </div>

          <div className="form-group">
            <label>Message Key (optional)</label>
            <input
              type="text"
              value={messageKey}
              onChange={(e) => setMessageKey(e.target.value)}
              placeholder="Partition key"
              disabled={sending}
            />
          </div>

          <div className="form-group">
            <label>Properties</label>
            <div className="properties-list">
              {properties.map((prop, index) => (
                <div key={index} className="property-item">
                  <input
                    type="text"
                    value={prop.key}
                    onChange={(e) => updateProperty(index, 'key', e.target.value)}
                    placeholder="Key"
                    disabled={sending}
                  />
                  <input
                    type="text"
                    value={prop.value}
                    onChange={(e) => updateProperty(index, 'value', e.target.value)}
                    placeholder="Value"
                    disabled={sending}
                  />
                  <button
                    className="remove-button"
                    onClick={() => removeProperty(index)}
                    disabled={sending}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button className="add-property-button" onClick={addProperty} disabled={sending}>
                + Add Property
              </button>
            </div>
          </div>

          <button className="send-button" onClick={handleSend} disabled={sending || !payload}>
            {sending ? 'Sending...' : 'Send Message'}
          </button>

          {sendError && <div className="error-message">{sendError}</div>}
          {lastMessageId && (
            <div className="success-message">
              ✓ Message sent: {lastMessageId}
            </div>
          )}
        </div>
      </div>

      <div className="test-messages-right">
        <div className="test-section">
          <h3>Consume Messages</h3>

          <div className="consumer-controls">
            <div className="form-group-inline">
              <label>Subscription</label>
              <input
                type="text"
                value={subscription}
                onChange={(e) => setSubscription(e.target.value)}
                placeholder="Subscription name"
                disabled={consumerStatus !== 'stopped'}
              />
            </div>

            <div className="form-group-inline">
              <label>Type</label>
              <select
                value={subscriptionType}
                onChange={(e) => setSubscriptionType(e.target.value as any)}
                disabled={consumerStatus !== 'stopped'}
              >
                <option value="Exclusive">Exclusive</option>
                <option value="Shared">Shared</option>
                <option value="Failover">Failover</option>
                <option value="Key_Shared">Key Shared</option>
              </select>
            </div>

            <div className="consumer-buttons">
              {consumerStatus === 'stopped' && (
                <button className="control-button start" onClick={handleStartConsumer}>
                  ▶ Start
                </button>
              )}
              {consumerStatus === 'running' && (
                <button className="control-button pause" onClick={handlePauseConsumer}>
                  ⏸ Pause
                </button>
              )}
              {consumerStatus === 'paused' && (
                <button className="control-button resume" onClick={handleResumeConsumer}>
                  ▶ Resume
                </button>
              )}
              {consumerStatus !== 'stopped' && (
                <button className="control-button stop" onClick={handleStopConsumer}>
                  ⏹ Stop
                </button>
              )}
              <button
                className="control-button clear"
                onClick={handleClearMessages}
                disabled={messages.length === 0}
              >
                🗑 Clear
              </button>
            </div>
          </div>

          {consumerError && <div className="error-message">{consumerError}</div>}

          <div className="messages-log">
            <div className="messages-log-header">
              <span>Received Messages ({messages.length})</span>
              {consumerStatus === 'running' && <span className="status-indicator">● Live</span>}
              {consumerStatus === 'paused' && <span className="status-indicator paused">⏸ Paused</span>}
            </div>

            <div className="messages-list">
              {messages.length === 0 ? (
                <div className="messages-empty">
                  {consumerStatus === 'stopped'
                    ? 'Start consumer to receive messages'
                    : 'Waiting for messages...'}
                </div>
              ) : (
                messages.map((msg, index) => (
                  <div key={index} className="message-item">
                    <div className="message-header">
                      <span className="message-time">{formatTimestamp(msg.receivedAt)}</span>
                      <span className="message-id">{msg.messageId}</span>
                    </div>
                    <div className="message-body">
                      <pre>{msg.data}</pre>
                    </div>
                    {(msg.partitionKey || Object.keys(msg.properties).length > 0) && (
                      <div className="message-meta">
                        {msg.partitionKey && (
                          <span className="meta-item">Key: {msg.partitionKey}</span>
                        )}
                        {Object.keys(msg.properties).length > 0 && (
                          <span className="meta-item">
                            Props: {JSON.stringify(msg.properties)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
