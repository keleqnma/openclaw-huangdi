/**
 * WebSocketServer 集成测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { ApiWebSocketServer } from './WebSocketServer';
import { WebSocket } from 'ws';

describe('ApiWebSocketServer', () => {
  let server: ApiWebSocketServer;
  let wsUrl: string;
  const port = 3470;

  beforeAll(async () => {
    server = new ApiWebSocketServer(port);
    // Give server time to start
    await new Promise(resolve => setTimeout(resolve, 100));
    wsUrl = `ws://localhost:${port}`;
  });

  afterAll(async () => {
    server.close();
  });

  describe('WebSocket Connection', () => {
    it('should accept WebSocket connection', async () => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);

        ws.on('open', () => {
          expect(ws.readyState).toBe(WebSocket.OPEN);
          ws.close();
          resolve(true);
        });

        ws.on('error', reject);

        setTimeout(() => {
          ws.close();
          reject(new Error('Connection timeout'));
        }, 3000);
      });
    });

    it('should send connected message on connection', async () => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const messages: any[] = [];

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          messages.push(message);

          if (message.type === 'connected') {
            expect(message.payload.message).toBe('Connected to Multi-Agent WebSocket Server');
            ws.close();
            resolve(true);
          }
        });

        ws.on('error', reject);

        setTimeout(() => {
          ws.close();
          reject(new Error('No connected message received'));
        }, 3000);
      });
    });

    it('should handle multiple concurrent connections', async () => {
      const connections = await Promise.all([
        new Promise<boolean>((resolve, reject) => {
          const ws = new WebSocket(wsUrl);
          ws.on('open', () => { ws.close(); resolve(true); });
          ws.on('error', reject);
          setTimeout(() => reject(new Error('Connection 1 timeout')), 3000);
        }),
        new Promise<boolean>((resolve, reject) => {
          const ws = new WebSocket(wsUrl);
          ws.on('open', () => { ws.close(); resolve(true); });
          ws.on('error', reject);
          setTimeout(() => reject(new Error('Connection 2 timeout')), 3000);
        }),
        new Promise<boolean>((resolve, reject) => {
          const ws = new WebSocket(wsUrl);
          ws.on('open', () => { ws.close(); resolve(true); });
          ws.on('error', reject);
          setTimeout(() => reject(new Error('Connection 3 timeout')), 3000);
        }),
      ]);

      expect(connections).toEqual([true, true, true]);
    });
  });

  describe('Subscription System', () => {
    it('should subscribe to a channel', async () => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);

        ws.on('open', () => {
          ws.send(JSON.stringify({
            type: 'subscribe',
            payload: { channel: 'test-channel' },
          }));
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'subscribed') {
            expect(message.payload.channel).toBe('test-channel');
            ws.close();
            resolve(true);
          }
        });

        ws.on('error', reject);
        setTimeout(() => {
          ws.close();
          reject(new Error('Subscription timeout'));
        }, 3000);
      });
    });

    it('should unsubscribe from a channel', async () => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);

        ws.on('open', () => {
          // First subscribe
          ws.send(JSON.stringify({
            type: 'subscribe',
            payload: { channel: 'test-channel' },
          }));
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());

          if (message.type === 'subscribed') {
            // Then unsubscribe
            ws.send(JSON.stringify({
              type: 'unsubscribe',
              payload: { channel: 'test-channel' },
            }));
          }

          if (message.type === 'unsubscribed') {
            expect(message.payload.channel).toBe('test-channel');
            ws.close();
            resolve(true);
          }
        });

        ws.on('error', reject);
        setTimeout(() => {
          ws.close();
          reject(new Error('Unsubscribe timeout'));
        }, 3000);
      });
    });

    it('should reject unknown message types', async () => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);

        ws.on('open', () => {
          ws.send(JSON.stringify({
            type: 'unknown-type',
            payload: {},
          }));
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'error') {
            expect(message.payload.message).toContain('Unknown message type');
            ws.close();
            resolve(true);
          }
        });

        ws.on('error', reject);
        setTimeout(() => {
          ws.close();
          reject(new Error('Error response timeout'));
        }, 3000);
      });
    });

    it('should reject invalid JSON', async () => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);

        ws.on('open', () => {
          ws.send('invalid json {{{');
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'error') {
            expect(message.payload.message).toBe('Invalid message format');
            ws.close();
            resolve(true);
          }
        });

        ws.on('error', reject);
        setTimeout(() => {
          ws.close();
          reject(new Error('Error response timeout'));
        }, 3000);
      });
    });
  });

  describe('Broadcast System', () => {
    it('should broadcast agent update to subscribed clients', async () => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let subscribed = false;

        ws.on('open', () => {
          ws.send(JSON.stringify({
            type: 'subscribe',
            payload: { channel: 'agent:test-agent' },
          }));
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());

          if (message.type === 'subscribed') {
            subscribed = true;
            // Trigger broadcast after subscription
            const mockAgent = {
              id: 'test-agent',
              name: 'Test Agent',
              status: 'active',
            };
            server.broadcastAgentUpdate(mockAgent as any);
          }

          if (message.type === 'agent:update' && subscribed) {
            expect(message.payload.agent.id).toBe('test-agent');
            ws.close();
            resolve(true);
          }
        });

        ws.on('error', reject);
        setTimeout(() => {
          ws.close();
          reject(new Error('Broadcast timeout'));
        }, 3000);
      });
    });

    it('should broadcast terminal output to subscribed clients', async () => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let subscribed = false;

        ws.on('open', () => {
          ws.send(JSON.stringify({
            type: 'subscribe',
            payload: { channel: 'terminal:session-1' },
          }));
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());

          if (message.type === 'subscribed') {
            subscribed = true;
            const mockEvent = {
              sessionId: 'session-1',
              output: 'Hello from terminal',
              type: 'stdout',
            };
            server.broadcastTerminalOutput(mockEvent as any);
          }

          if (message.type === 'terminal:output' && subscribed) {
            expect(message.payload.sessionId).toBe('session-1');
            ws.close();
            resolve(true);
          }
        });

        ws.on('error', reject);
        setTimeout(() => {
          ws.close();
          reject(new Error('Broadcast timeout'));
        }, 3000);
      });
    });

    it('should broadcast task events to task subscribers', async () => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let subscribed = false;

        ws.on('open', () => {
          ws.send(JSON.stringify({
            type: 'subscribe',
            payload: { channel: 'tasks' },
          }));
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());

          if (message.type === 'subscribed') {
            subscribed = true;
            const mockTask = {
              id: 'task-1',
              title: 'Test Task',
              status: 'pending',
            };
            server.broadcastTaskEvent('started', mockTask);
          }

          if (message.type === 'task:started' && subscribed) {
            expect(message.payload.task.id).toBe('task-1');
            ws.close();
            resolve(true);
          }
        });

        ws.on('error', reject);
        setTimeout(() => {
          ws.close();
          reject(new Error('Broadcast timeout'));
        }, 3000);
      });
    });

    it('should broadcast task board updates', async () => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let subscribed = false;

        ws.on('open', () => {
          ws.send(JSON.stringify({
            type: 'subscribe',
            payload: { channel: 'taskboard' },
          }));
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());

          if (message.type === 'subscribed') {
            subscribed = true;
            const mockTask = {
              id: 'task-1',
              title: 'Test Task',
              status: 'claimed',
              claimedBy: 'agent-1',
            };
            server.broadcastTaskBoardUpdate('task:claimed', mockTask);
          }

          if (message.type === 'taskboard:update' && subscribed) {
            expect(message.payload.eventType).toBe('task:claimed');
            expect(message.payload.task.id).toBe('task-1');
            ws.close();
            resolve(true);
          }
        });

        ws.on('error', reject);
        setTimeout(() => {
          ws.close();
          reject(new Error('Broadcast timeout'));
        }, 3000);
      });
    });

    it('should broadcast chat messages', async () => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let subscribed = false;

        ws.on('open', () => {
          ws.send(JSON.stringify({
            type: 'subscribe',
            payload: { channel: 'chat:global' },
          }));
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());

          if (message.type === 'subscribed') {
            subscribed = true;
            const mockMessage = {
              id: 'msg-1',
              from: 'user',
              content: 'Hello',
              isFromUser: true,
            };
            server.broadcastChatMessage(mockMessage);
          }

          if (message.type === 'chat:message' && subscribed) {
            expect(message.payload.message.from).toBe('user');
            ws.close();
            resolve(true);
          }
        });

        ws.on('error', reject);
        setTimeout(() => {
          ws.close();
          reject(new Error('Broadcast timeout'));
        }, 3000);
      });
    });

    it('should send private chat messages to specific recipient', async () => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let subscribed = false;

        ws.on('open', () => {
          ws.send(JSON.stringify({
            type: 'subscribe',
            payload: { channel: 'chat:test-agent' },
          }));
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());

          if (message.type === 'subscribed') {
            subscribed = true;
            const mockMessage = {
              id: 'msg-1',
              from: 'user',
              content: 'Private message',
              to: 'test-agent',
              isFromUser: true,
            };
            server.broadcastChatMessage(mockMessage);
          }

          if (message.type === 'chat:message' && subscribed) {
            expect(message.payload.message.to).toBe('test-agent');
            ws.close();
            resolve(true);
          }
        });

        ws.on('error', reject);
        setTimeout(() => {
          ws.close();
          reject(new Error('Broadcast timeout'));
        }, 3000);
      });
    });

    it('should not broadcast to unsubscribed clients', async () => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let subscribed = false;
        let receivedBroadcast = false;

        ws.on('open', () => {
          // Don't subscribe, just wait
          setTimeout(() => {
            const mockAgent = { id: 'test-agent', name: 'Test', status: 'active' };
            server.broadcastAgentUpdate(mockAgent as any);
          }, 100);
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());

          if (message.type === 'subscribed') {
            subscribed = true;
          }

          if (message.type === 'agent:update') {
            receivedBroadcast = true;
          }
        });

        // After timeout, verify no broadcast received
        setTimeout(() => {
          ws.close();
          // Should only receive 'connected' message, not the broadcast
          expect(receivedBroadcast).toBe(false);
          resolve(true);
        }, 500);

        ws.on('error', reject);
      });
    });
  });

  describe('Agent Actions Broadcast', () => {
    it('should broadcast agent action to subscribed clients', async () => {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let subscribed = false;

        ws.on('open', () => {
          ws.send(JSON.stringify({
            type: 'subscribe',
            payload: { channel: 'agent:test-agent' },
          }));
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());

          if (message.type === 'subscribed') {
            subscribed = true;
            const mockAction = {
              id: 'action-1',
              agentId: 'test-agent',
              actionType: 'command_exec',
              payload: { command: 'ls -la' },
              timestamp: Date.now(),
            };
            server.broadcastAgentAction(mockAction);
          }

          if (message.type === 'agent:action' && subscribed) {
            expect(message.payload.action.agentId).toBe('test-agent');
            expect(message.payload.action.actionType).toBe('command_exec');
            ws.close();
            resolve(true);
          }
        });

        ws.on('error', reject);
        setTimeout(() => {
          ws.close();
          reject(new Error('Broadcast timeout'));
        }, 3000);
      });
    });
  });

  describe('getClientCount()', () => {
    it('should return correct client count', async () => {
      const ws1 = new WebSocket(wsUrl);
      const ws2 = new WebSocket(wsUrl);

      await Promise.all([
        new Promise(resolve => ws1.on('open', resolve)),
        new Promise(resolve => ws2.on('open', resolve)),
      ]);

      // Give server time to register clients
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(server.getClientCount()).toBe(2);

      ws1.close();
      ws2.close();
    });

    it('should update count when clients disconnect', async () => {
      const ws = new WebSocket(wsUrl);

      await new Promise(resolve => ws.on('open', resolve));
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(server.getClientCount()).toBe(1);

      ws.close();
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(server.getClientCount()).toBe(0);
    });
  });

  describe('getInfo()', () => {
    it('should return server info', () => {
      const info = server.getInfo();

      expect(info.port).toBe(port);
      expect(typeof info.clients).toBe('number');
    });
  });
});
