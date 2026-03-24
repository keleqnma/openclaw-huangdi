/**
 * Tests for UnifiedWebSocketServer
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UnifiedWebSocketServer } from './UnifiedWebSocketServer';
import type { TimelineEvent } from './events';
import { WebSocketServer, WebSocket } from 'ws';

describe('UnifiedWebSocketServer', () => {
  let server: UnifiedWebSocketServer;
  let testPort: number;

  beforeEach(() => {
    testPort = 3500 + Math.floor(Math.random() * 1000);
    server = new UnifiedWebSocketServer({ maxClients: 10 });
  });

  afterEach(() => {
    server.close();
  });

  const createMockEvent = (overrides: Partial<TimelineEvent> = {}): TimelineEvent => ({
    id: 'event_001',
    type: 'agent:action',
    timestamp: Date.now(),
    agentId: 'agent_001',
    taskId: 'task_001',
    summary: 'Test event',
    level: 'info',
    source: 'orchestrator',
    ...overrides,
  });

  const createMockDataSources = () => ({
    getAgents: vi.fn(() => []),
    getEvents: vi.fn(() => []),
    getEventsSince: vi.fn((since: number, agentId?: string) => []),
    updateReplayState: vi.fn((update: Partial<any>) => {}),
    getReplayState: vi.fn(() => ({ isPlaying: false, speed: 1, currentPosition: Date.now() })),
  });

  describe('constructor', () => {
    it('should create server with default config', () => {
      const s = new UnifiedWebSocketServer();
      const info = s.getInfo();
      expect(info.maxClients).toBe(100);
      expect(info.heartbeatInterval).toBe(30000);
    });

    it('should create server with custom config', () => {
      const s = new UnifiedWebSocketServer({ maxClients: 50 });
      const info = s.getInfo();
      expect(info.maxClients).toBe(50);
    });
  });

  describe('start and stop', () => {
    it('should start server on port', () => {
      const port = 3600;
      expect(() => {
        server.start(port);
      }).not.toThrow();

      const info = server.getInfo();
      expect(info.clients).toBe(0);
    });

    it('should close server cleanly', () => {
      server.start(testPort);
      expect(() => {
        server.close();
      }).not.toThrow();
    });
  });

  describe('attachToHTTPServer', () => {
    it('should attach to existing WebSocket server', () => {
      const wss = new WebSocketServer({ port: testPort + 100 });
      const dataSources = createMockDataSources();

      expect(() => {
        server.attachToHTTPServer(wss, dataSources);
      }).not.toThrow();
    });
  });

  describe('client connections', () => {
    it('should track client count', () => {
      server.start(testPort);
      expect(server.getClientCount()).toBe(0);
    });

    it('should reject connections when max reached', (done) => {
      const smallServer = new UnifiedWebSocketServer({ maxClients: 1 });
      smallServer.start(testPort + 200);

      // Connect first client
      const ws1 = new WebSocket(`ws://localhost:${testPort + 200}`);
      ws1.on('open', () => {
        // Try to connect second client
        const ws2 = new WebSocket(`ws://localhost:${testPort + 200}`);
        ws2.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'error') {
            expect(msg.payload.message).toContain('Maximum connections');
            smallServer.close();
            done();
          }
        });
      });
    });
  });

  describe('subscribe/unsubscribe', (done) => {
    it('should handle channel subscriptions', () => {
      server.start(testPort + 300);

      const ws = new WebSocket(`ws://localhost:${testPort + 300}`);
      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'subscribe',
          payload: { channel: 'agent:001' },
        }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'subscribed') {
          expect(msg.payload.channel).toBe('agent:001');
          server.close();
          done();
        }
      });
    });

    it('should handle channel unsubscription', (done) => {
      server.start(testPort + 301);

      const ws = new WebSocket(`ws://localhost:${testPort + 301}`);
      ws.on('open', () => {
        // Subscribe first
        ws.send(JSON.stringify({
          type: 'subscribe',
          payload: { channel: 'agent:001' },
        }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'subscribed') {
          // Then unsubscribe
          ws.send(JSON.stringify({
            type: 'unsubscribe',
            payload: { channel: 'agent:001' },
          }));
        } else if (msg.type === 'unsubscribed') {
          expect(msg.payload.channel).toBe('agent:001');
          server.close();
          done();
        }
      });
    });
  });

  describe('broadcast', () => {
    it('should broadcast to subscribed clients', (done) => {
      server.start(testPort + 400);

      const ws = new WebSocket(`ws://localhost:${testPort + 400}`);
      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'subscribe',
          payload: { channel: 'test-channel' },
        }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'subscribed') {
          // After subscribing, wait for broadcast
          setTimeout(() => {
            server.broadcast({ type: 'test-message', payload: { test: 'data' } }, 'test-channel');
          }, 100);
        } else if (msg.type === 'test-message') {
          expect(msg.payload.test).toBe('data');
          server.close();
          done();
        }
      });
    });

    it('should not broadcast to unsubscribed clients', (done) => {
      server.start(testPort + 401);

      const receivedMessages: any[] = [];
      const ws1 = new WebSocket(`ws://localhost:${testPort + 401}`);
      const ws2 = new WebSocket(`ws://localhost:${testPort + 401}`);

      ws1.on('open', () => {
        ws1.send(JSON.stringify({
          type: 'subscribe',
          payload: { channel: 'channel-1' },
        }));
      });

      ws2.on('open', () => {
        // ws2 does NOT subscribe to channel-1
        setTimeout(() => {
          server.broadcast({ type: 'targeted' }, 'channel-1');
        }, 100);
      });

      const checkDone = () => {
        if (receivedMessages.length > 0) {
          // ws1 should receive, ws2 should not
          expect(receivedMessages.some(m => m.type === 'targeted')).toBe(true);
          server.close();
          done();
        }
      };

      ws1.on('message', (data) => {
        receivedMessages.push(JSON.parse(data.toString()));
        checkDone();
      });

      ws2.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'targeted') {
          throw new Error('ws2 should not receive messages for channel-1');
        }
      });
    });
  });

  describe('broadcastEvent', () => {
    it('should broadcast event to all clients', (done) => {
      server.start(testPort + 500);

      const ws = new WebSocket(`ws://localhost:${testPort + 500}`);
      ws.on('open', () => {
        setTimeout(() => {
          const event = createMockEvent();
          server.broadcastEvent(event);
        }, 100);
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'event') {
          expect(msg.payload.event.id).toBe('event_001');
          server.close();
          done();
        }
      });
    });

    it('should broadcast event to agent-specific channel', (done) => {
      server.start(testPort + 501);

      const ws = new WebSocket(`ws://localhost:${testPort + 501}`);
      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'subscribe',
          payload: { channel: 'agent:agent_001' },
        }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'subscribed') {
          setTimeout(() => {
            const event = createMockEvent({ agentId: 'agent_001' });
            server.broadcastEvent(event);
          }, 100);
        } else if (msg.type === 'event' && msg.payload.event.agentId === 'agent_001') {
          server.close();
          done();
        }
      });
    });
  });

  describe('ping/pong', (done) => {
    it('should respond to ping with pong', () => {
      server.start(testPort + 600);

      const ws = new WebSocket(`ws://localhost:${testPort + 600}`);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'ping' }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'pong') {
          expect(msg.payload.timestamp).toBeDefined();
          server.close();
        }
      });
    });
  });

  describe('getConnectedClients', () => {
    it('should return connected clients info', (done) => {
      server.start(testPort + 700);

      const ws = new WebSocket(`ws://localhost:${testPort + 700}`);
      ws.on('open', () => {
        setTimeout(() => {
          const clients = server.getConnectedClients();
          expect(clients.length).toBe(1);
          expect(clients[0].isAlive).toBe(true);
          server.close();
          done();
        }, 100);
      });
    });
  });

  describe('Dashboard integration', () => {
    it('should send sync on connect when data sources provided', (done) => {
      const wss = new WebSocketServer({ port: testPort + 800 });
      const dataSources = createMockDataSources();
      dataSources.getAgents.mockReturnValue([{ runId: 'run_001', status: 'idle' } as any]);
      dataSources.getEvents.mockReturnValue([createMockEvent()]);

      server.attachToHTTPServer(wss, dataSources);

      const ws = new WebSocket(`ws://localhost:${testPort + 800}`);
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'sync') {
          expect(msg.agents).toBeDefined();
          expect(msg.events).toBeDefined();
          server.close();
          done();
        }
      });
    });

    it('should handle fetch_events message', (done) => {
      const wss = new WebSocketServer({ port: testPort + 801 });
      const dataSources = createMockDataSources();
      dataSources.getEventsSince.mockReturnValue([createMockEvent()]);

      server.attachToHTTPServer(wss, dataSources);

      const ws = new WebSocket(`ws://localhost:${testPort + 801}`);
      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'fetch_events',
          payload: { since: Date.now() - 1000 },
        }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'event') {
          expect(msg.events).toBeDefined();
          server.close();
          done();
        }
      });
    });

    it('should handle replay_control message', (done) => {
      const wss = new WebSocketServer({ port: testPort + 802 });
      const dataSources = createMockDataSources();

      server.attachToHTTPServer(wss, dataSources);

      const ws = new WebSocket(`ws://localhost:${testPort + 802}`);
      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'replay_control',
          payload: { action: 'play', speed: 2 },
        }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'sync') {
          expect(dataSources.updateReplayState).toHaveBeenCalled();
          server.close();
          done();
        }
      });
    });
  });
});
