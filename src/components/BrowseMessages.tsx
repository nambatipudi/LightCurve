import React, { useState, useEffect, useRef } from 'react';
import { JsonHighlighter } from './JsonHighlighter';
import { Tooltip } from './Tooltip';
import './BrowseMessages.css';

interface BrowseMessagesProps {
  clusterId: string;
  topicName: string;
}

interface BrowsedMessage {
  messageId: string;
  timestamp: number;
  payload: string;
  properties: Record<string, string>;
  publisherName?: string;
}

interface SubscriptionPosition {
  name: string;
  msgBacklog: number;
  lastMessageId?: string;
}

export const BrowseMessages: React.FC<BrowseMessagesProps> = ({ clusterId, topicName }) => {
  const [messages, setMessages] = useState<BrowsedMessage[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(5);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const [newMessageIds, setNewMessageIds] = useState<Set<string>>(new Set());

  // Clear messages when topic changes
  useEffect(() => {
    setMessages([]);
    setSubscriptions([]);
    setError(null);
    setAutoRefresh(false);
  }, [clusterId, topicName]);

  // Cleanup on unmount: unsubscribe from topic
  useEffect(() => {
    return () => {
      // Unsubscribe when component unmounts
      if (clusterId && topicName) {
        window.lightcurve.messages.unsubscribe(clusterId, topicName).catch((err) => {
          console.warn('Failed to unsubscribe:', err);
        });
      }
    };
  }, [clusterId, topicName]);

  // No auto-scroll effect during auto-refresh - let scroll preservation handle it
  // This prevents scroll conflicts during auto-refresh

  // Auto-refresh logic
  useEffect(() => {
    if (autoRefresh) {
      // Fetch immediately when auto-refresh is enabled (silent to avoid button flicker)
      fetchPeek({ silent: true });
      
      // Set up interval
      intervalRef.current = setInterval(() => {
        fetchPeek({ silent: true });
      }, refreshInterval * 1000);
    } else {
      // Clear interval when auto-refresh is disabled
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [autoRefresh, refreshInterval, clusterId, topicName]);

  const fetchPeek = async (options?: { silent?: boolean }) => {
    const silent = options?.silent;
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    setIsReading(true);
    try {
      // Fetch messages and subscription stats in parallel
      const [messagesResponse, statsResponse] = await Promise.all([
        window.lightcurve.messages.peek(clusterId, {
          topic: topicName,
          maxMessages: 50,
        }),
        window.lightcurve.admin.getTopicStats(clusterId, topicName),
      ]);

      if (messagesResponse.success && messagesResponse.data) {
        const listEl = timelineRef.current;
        // Only preserve scroll during auto-refresh to avoid conflicts
        const preserveScroll = autoRefresh && !!listEl;
        const prevBottomGap = preserveScroll && listEl
          ? listEl.scrollHeight - listEl.scrollTop
          : 0;

        const mapped = (messagesResponse.data.messages || []).map(msg => ({
          messageId: msg.messageId,
          timestamp: msg.publishTimestamp,
          payload: msg.payload,
          properties: msg.properties || {},
        }));
        // Determine newly arrived messages (by messageId)
        const newIds: string[] = [];
        mapped.forEach(m => {
          if (!seenMessageIdsRef.current.has(m.messageId)) {
            newIds.push(m.messageId);
          }
        });

        // Update seen set
        mapped.forEach(m => seenMessageIdsRef.current.add(m.messageId));

        // Highlight new ones only when auto-refresh is on
        setNewMessageIds(autoRefresh ? new Set(newIds) : new Set());

        // Append-only mode during auto-refresh: add only new messages to existing list
        // Manual fetch: rebind entire list
        if (autoRefresh && messages.length > 0 && newIds.length > 0) {
          // Append mode: add new messages to the front (for desc order)
          // or to the back (for asc order), then keep only newest 50
          setMessages(prev => {
            const allMessages = [...prev];
            newIds.forEach(newId => {
              const newMsg = mapped.find(m => m.messageId === newId);
              if (newMsg && !allMessages.some(m => m.messageId === newId)) {
                allMessages.unshift(newMsg);
              }
            });
            return allMessages.slice(0, 50);
          });
        } else {
          // Manual fetch or first load: rebind everything
          setMessages(mapped);
        }

        if (preserveScroll && listEl) {
          requestAnimationFrame(() => {
            if (listEl) {
              listEl.scrollTop = listEl.scrollHeight - prevBottomGap;
            }
          });
        }
      } else {
        setError(messagesResponse.error || 'Failed to fetch messages');
      }

      // Extract subscription positions
      if (statsResponse.success && statsResponse.data) {
        const subPositions: SubscriptionPosition[] = Object.entries(
          statsResponse.data.subscriptions || {}
        ).map(([name, stats]: [string, any]) => ({
          name,
          msgBacklog: stats.msgBacklog || 0,
          lastMessageId: stats.lastMessageId,
        }));
        setSubscriptions(subPositions);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (!silent) {
        setLoading(false);
      }
      setIsReading(false);
    }
  };

  const clearMessages = () => {
    setMessages([]);
  };

  const parsePayload = (payload: string): string => {
    try {
      return JSON.stringify(JSON.parse(payload), null, 2);
    } catch {
      return payload;
    }
  };

  const isJson = (payload: string): boolean => {
    try {
      JSON.parse(payload);
      return true;
    } catch {
      return false;
    }
  };

  const parseMessageId = (messageId: string): { ledgerId: string; entryId: string; batchIndex: string; partitionNumber: string } | null => {
    // Message ID format: (ledgerId,entryId,batchIndex,partitionNumber)
    const match = messageId.match(/\((\d+),(\d+),(-?\d+),(\d+)\)/);
    if (match) {
      return {
        ledgerId: match[1],
        entryId: match[2],
        batchIndex: match[3],
        partitionNumber: match[4],
      };
    }
    return null;
  };

  return (
    <div className="browse-messages">
      <div className="browse-header">
        <h3>Browse Messages</h3>
        <p className="browse-subtitle">Read-only message browser (doesn&apos;t consume messages)</p>
      </div>

      <div className="browse-controls">
        <button
          className="browse-button primary"
          onClick={fetchPeek}
          disabled={loading || autoRefresh}
        >
          {loading ? '⟳ Fetching...' : '🔍 Peek Messages'}
        </button>
        <button
          className={`browse-button ${autoRefresh ? 'active' : 'secondary'}`}
          onClick={() => setAutoRefresh(!autoRefresh)}
        >
          {autoRefresh ? '⏸ Stop Auto-Refresh' : '▶ Auto-Refresh'}
        </button>
        {autoRefresh && (
          <select
            className="refresh-interval-select"
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(Number(e.target.value))}
          >
            <option value={2}>Every 2s</option>
            <option value={5}>Every 5s</option>
            <option value={10}>Every 10s</option>
            <option value={30}>Every 30s</option>
          </select>
        )}
        <button
          className="browse-button secondary"
          onClick={clearMessages}
        >
          🗑 Clear
        </button>
      </div>

      {error && (
        <div className="browse-error">
          <p>Error: {error}</p>
        </div>
      )}

      <div className="browse-status">
        <span className={`status-indicator ${isReading ? 'active' : ''}`}>
          {isReading ? '● Fetching' : '○ Idle'}
        </span>
        <span className="message-count">{messages.length} messages</span>
        {subscriptions.length > 0 && (
          <span className="subscription-count">{subscriptions.length} subscriptions</span>
        )}
      </div>

      {subscriptions.length > 0 && (
        <div className="subscriptions-legend">
          <div className="legend-title">📊 Subscription Positions:</div>
          <div className="legend-items">
            {subscriptions.map((sub, idx) => (
              <div key={idx} className="legend-item" style={{ '--sub-color': `hsl(${idx * 360 / subscriptions.length}, 70%, 60%)` } as any}>
                <span className="legend-marker"></span>
                <span className="legend-name">{sub.name}</span>
                <span className="legend-backlog">Backlog: {sub.msgBacklog}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="browse-messages-timeline" ref={timelineRef}>
        <div className="sort-fab-group">
          <button
            className={`sort-fab ${sortOrder === 'desc' ? 'active' : ''}`}
            onClick={() => setSortOrder('desc')}
            title="Newest first"
          >
            ↓
          </button>
          <button
            className={`sort-fab ${sortOrder === 'asc' ? 'active' : ''}`}
            onClick={() => setSortOrder('asc')}
            title="Oldest first"
          >
            ↑
          </button>
        </div>
        {messages.length === 0 ? (
          <div className="browse-empty">
            {isReading ? 'Waiting for messages...' : 'Click "Peek Messages" to view messages'}
          </div>
        ) : (
          <div className="timeline-container">
            <div className="timeline-line"></div>
            {[...messages].sort((a, b) => {
              // Sort by publish timestamp; tie-break by messageId
              const primary = sortOrder === 'desc'
                ? b.timestamp - a.timestamp
                : a.timestamp - b.timestamp;
              if (primary !== 0) return primary;
              return a.messageId.localeCompare(b.messageId);
            }).map((msg, idx) => {
              // Calculate position for subscriptions
              const totalMessages = messages.length;
              const messagePosition = sortOrder === 'desc' 
                ? idx + 1 
                : totalMessages - idx;
              
              // Get consumers that have consumed exactly up to this message (last consumed position)
              const sortedMessages = [...messages].sort((a, b) => {
                const primary = sortOrder === 'desc'
                  ? b.timestamp - a.timestamp
                  : a.timestamp - b.timestamp;
                if (primary !== 0) return primary;
                return a.messageId.localeCompare(b.messageId);
              });
              
              const consumersAtThisPosition = subscriptions.filter(sub => {
                // Find the last message this subscription has consumed
                const lastConsumedIdx = sortedMessages.findIndex((m, msgIdx) => {
                  const pos = sortOrder === 'desc' 
                    ? msgIdx + 1 
                    : totalMessages - msgIdx;
                  return sub.msgBacklog < pos;
                });
                // Only show the subscriber at their last consumed position
                return lastConsumedIdx === idx;
              });
              
                  return (
                    <div key={idx} className="timeline-message-group">
                  <div className="timeline-message">
                    <div className={`timeline-dot ${newMessageIds.has(msg.messageId) ? 'new' : ''}`}></div>
                    <div className="timeline-content">
                      <div className="message-header">
                        <div className="message-header-left">
                          <span className="message-time inline">
                            <span className="message-time-label">Published</span>
                            <span>{new Date(msg.timestamp).toLocaleString()}</span>
                          </span>
                          <div className="message-id-pills inline">
                            {parseMessageId(msg.messageId) ? (
                              <>
                                <Tooltip
                                  content="Unique identifier for the storage ledger/segment where this message is stored. Ledgers are immutable data files in the BookKeeper backend."
                                  position="top"
                                >
                                  <span className="id-pill compact">
                                    <span className="pill-label">Ledger ID</span>
                                    <span className="pill-value">{parseMessageId(msg.messageId)?.ledgerId}</span>
                                  </span>
                                </Tooltip>
                                <Tooltip
                                  content="Position within the ledger where this message is located. Entry IDs are sequential within each ledger starting from 0."
                                  position="top"
                                >
                                  <span className="id-pill compact">
                                    <span className="pill-label">Entry ID</span>
                                    <span className="pill-value">{parseMessageId(msg.messageId)?.entryId}</span>
                                  </span>
                                </Tooltip>

                                <Tooltip
                                  content="Index within a batch of messages. -1 means this message is not part of a batch (standalone message). Non-negative values indicate the message's position in a batched write."
                                  position="top"
                                >
                                  <span className="id-pill compact">
                                    <span className="pill-label">Batch Index</span>
                                    <span className="pill-value">{parseMessageId(msg.messageId)?.batchIndex}</span>
                                  </span>
                                </Tooltip>

                                <Tooltip
                                  content="The partition number of the topic where this message is stored. Partitions allow for parallel processing and scalability."
                                  position="top"
                                >
                                  <span className="id-pill compact">
                                    <span className="pill-label">Partition</span>
                                    <span className="pill-value">{parseMessageId(msg.messageId)?.partitionNumber}</span>
                                  </span>
                                </Tooltip>
                              </>
                            ) : (
                              <span className="message-id">{msg.messageId}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <div className="message-payload">
                        {isJson(msg.payload) ? (
                          <JsonHighlighter json={parsePayload(msg.payload)} />
                        ) : (
                          <pre>{msg.payload}</pre>
                        )}
                      </div>
                      {Object.keys(msg.properties || {}).length > 0 && (
                        <div className="message-properties">
                          <div className="properties-label">Properties:</div>
                          {Object.entries(msg.properties).map(([key, value]) => (
                            <div key={key} className="property-item">
                              <span className="property-key">{key}:</span>
                              <span className="property-value">{value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Subscriptions positioned on the timeline */}
                  {consumersAtThisPosition.length > 0 && (
                    <div className="timeline-subscriptions">
                      {consumersAtThisPosition.map((sub, subIdx) => {
                        const colorIdx = subscriptions.findIndex(s => s.name === sub.name);
                        return (
                          <div
                            key={subIdx}
                            className="timeline-subscriber"
                            style={{ '--sub-color': `hsl(${colorIdx * 360 / subscriptions.length}, 70%, 60%)` } as any}
                          >
                            <div className="subscriber-badge">
                              <span className="subscriber-checkmark">✓</span>
                              <span className="subscriber-name">{sub.name}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>
    </div>
  );
};
