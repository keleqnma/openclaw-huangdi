/**
 * WebSocketServer - WebSocket 实时推送服务
 *
 * 推送 Agent 状态更新、终端输出等实时事件
 */

import { WebSocketServer, WebSocket } from 'ws';
import { TerminalOutputEvent } from '../terminal/types';
import { AgentRuntime } from '../terminal/types';
import { Task, TaskMessage, AgentAction, ChatMessage } from '../task/types';

interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'terminal:write' | 'terminal:resize' | 'agent:ping' | 'workspace:refresh' | 'ping';
  payload: any;
}

interface ServerMessage {
  type: string;
  payload: any;
}

interface WebSocketClient {
  ws: any;
  lastHeartbeat: number;
  isAlive: boolean;
}

export class ApiWebSocketServer {
  private wss: any;
  private clients: Map<any, WebSocketClient> = new Map(); // Track client with heartbeat info
  private subscriptions: Map<any, Set<string>> = new Map();
  private readonly port: number;
  private broadcastInterval?: NodeJS.Timeout;
  private heartbeatInterval?: NodeJS.Timeout;
  private readonly MAX_CLIENTS = 50; // Maximum concurrent WebSocket connections
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds heartbeat
  private readonly HEARTBEAT_TIMEOUT = 10000; // 10 seconds timeout after ping

  constructor(port: number) {
    this.port = port;
    this.wss = new WebSocketServer({ port });
    this.setup();
    this.startPeriodicBroadcast();
    this.startHeartbeatCheck();
  }

  /**
   * Start heartbeat check to detect zombie connections
   */
  private startHeartbeatCheck() {
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((client, ws) => {
        if (!client.isAlive) {
          // Client didn't respond to ping, terminate connection
          console.debug(`Terminating zombie connection: ${ws._socket?.remoteAddress}`);
          ws.terminate();
          this.clients.delete(ws);
          this.subscriptions.delete(ws);
          return;
        }

        // Mark as not alive and send ping
        client.isAlive = false;
        client.lastHeartbeat = Date.now();
        ws.ping?.();
      });
    }, this.HEARTBEAT_INTERVAL);
  }

  /**
   * Start periodic broadcast (for real-time status updates)
   */
  private startPeriodicBroadcast() {
    // Broadcast heartbeat every 2 seconds
    this.broadcastInterval = setInterval(() => {
      this.broadcast({ type: 'agent:heartbeat', payload: { timestamp: Date.now() } });
    }, 2000);
  }

  private setup() {
    this.wss.on('connection', (ws: any) => {
      // Check maximum connections
      if (this.clients.size >= this.MAX_CLIENTS) {
        ws.send(JSON.stringify({
          type: 'error',
          payload: { message: `Maximum connections (${this.MAX_CLIENTS}) reached. Try again later.` },
        }));
        ws.close(1013, 'Too many connections');
        return;
      }

      // Add client with heartbeat tracking
      const client: WebSocketClient = {
        ws,
        lastHeartbeat: Date.now(),
        isAlive: true,
      };
      this.clients.set(ws, client);
      this.subscriptions.set(ws, new Set());

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connected',
        payload: {
          message: 'Connected to Multi-Agent WebSocket Server',
          clientId: ws._socket?.remoteAddress || 'unknown',
          serverTime: Date.now(),
        },
      }));

      ws.on('message', (data: Buffer) => {
        try {
          const message: ClientMessage = JSON.parse(data.toString());

          // Handle ping message for heartbeat
          if (message.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', payload: { timestamp: Date.now() } }));
            const client = this.clients.get(ws);
            if (client) {
              client.isAlive = true;
              client.lastHeartbeat = Date.now();
            }
            return;
          }

          this.handleMessage(ws, message);
        } catch {
          ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Invalid message format' },
          }));
        }
      });

      ws.on('pong', () => {
        const client = this.clients.get(ws);
        if (client) {
          client.isAlive = true;
          client.lastHeartbeat = Date.now();
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        this.subscriptions.delete(ws);
      });

      ws.on('error', (error: any) => {
        console.debug(`WebSocket error: ${error?.message || error}`);
      });
    });

    this.wss.on('error', (error: any) => {
      console.warn(`WebSocket server error: ${error?.message || error}`);
    });
  }

  private handleMessage(ws: any, message: ClientMessage) {
    switch (message.type) {
      case 'subscribe':
        this.subscriptions.get(ws)?.add(message.payload.channel);
        ws.send(JSON.stringify({
          type: 'subscribed',
          payload: { channel: message.payload.channel },
        }));
        break;

      case 'unsubscribe':
        this.subscriptions.get(ws)?.delete(message.payload.channel);
        ws.send(JSON.stringify({
          type: 'unsubscribed',
          payload: { channel: message.payload.channel },
        }));
        break;

      default:
        ws.send(JSON.stringify({
          type: 'error',
          payload: { message: `Unknown message type: ${message.type}` },
        }));
    }
  }

  /**
   * 广播 Agent 状态更新
   */
  broadcastAgentUpdate(agent: AgentRuntime): void {
    this.broadcast({
      type: 'agent:update',
      payload: { agent },
    }, 'agent:' + agent.id);
  }

  /**
   * 广播终端输出
   */
  broadcastTerminalOutput(event: TerminalOutputEvent): void {
    this.broadcast({
      type: 'terminal:output',
      payload: event,
    }, 'terminal:' + event.sessionId);
  }

  /**
   * 广播任务事件
   */
  broadcastTaskEvent(eventType: 'started' | 'completed' | 'failed', task: any): void {
    this.broadcast({
      type: `task:${eventType}`,
      payload: { task },
    }, 'tasks');
  }

  /**
   * 广播任务看板更新
   */
  broadcastTaskBoardUpdate(
    eventType: 'task:created' | 'task:claimed' | 'task:released' | 'task:updated' | 'task:completed',
    task: Task
  ): void {
    this.broadcast({
      type: 'taskboard:update',
      payload: { eventType, task },
    }, 'taskboard');
  }

  /**
   * 广播任务消息
   */
  broadcastTaskBoardMessage(task: Task, message: TaskMessage): void {
    this.broadcast({
      type: 'taskboard:message',
      payload: { taskId: task.id, message },
    }, 'taskboard');
  }

  /**
   * 广播任务告警
   */
  broadcastTaskBoardAlert(alertType: 'overdue' | 'stalled', task: Task): void {
    this.broadcast({
      type: 'taskboard:alert',
      payload: { alertType, task },
    }, 'taskboard');
  }

  /**
   * 广播 Agent 动作
   */
  broadcastAgentAction(action: AgentAction): void {
    this.broadcast({
      type: 'agent:action',
      payload: { action },
    }, 'agent:' + action.agentId);
  }

  /**
   * 广播 Agent 思考状态
   */
  broadcastThinking(agentId: string, thought: string, taskId?: string): void {
    this.broadcast({
      type: 'agent:thinking',
      payload: { agentId, thought, taskId, timestamp: Date.now() },
    }, 'agent:' + agentId);
  }

  /**
   * 广播 Agent 状态变化
   */
  broadcastAgentStatus(agentId: string, status: 'thinking' | 'working' | 'idle' | 'error', detail?: string): void {
    this.broadcast({
      type: 'agent:status',
      payload: { agentId, status, detail, timestamp: Date.now() },
    }, 'agent:' + agentId);
  }

  /**
   * 广播聊天消息
   */
  broadcastChatMessage(message: ChatMessage): void {
    // 私聊：只发送给特定接收者
    if (message.to) {
      this.broadcast({
        type: 'chat:message',
        payload: { message },
      }, 'chat:' + message.to);
    }
    // 群聊：发送给所有订阅者
    this.broadcast({
      type: 'chat:message',
      payload: { message },
    }, 'chat:global');
  }

  /**
   * Broadcast to subscribed clients
   */
  private broadcast(message: ServerMessage, channel?: string): void {
    const data = JSON.stringify(message);
    const deadClients: any[] = [];

    for (const [ws, client] of this.clients.entries()) {
      if (client.isAlive && ws.readyState === WebSocket.OPEN) {
        if (!channel || this.subscriptions.get(ws)?.has(channel)) {
          try {
            ws.send(data);
          } catch (error) {
            // Mark client as dead for cleanup
            deadClients.push(ws);
          }
        }
      } else if (ws.readyState !== WebSocket.OPEN) {
        deadClients.push(ws);
      }
    }

    // Cleanup dead clients
    for (const ws of deadClients) {
      this.clients.delete(ws);
      this.subscriptions.delete(ws);
    }
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get connected clients info
   */
  getConnectedClients(): Array<{ address: string; lastHeartbeat: number; isAlive: boolean }> {
    const clients: Array<{ address: string; lastHeartbeat: number; isAlive: boolean }> = [];
    for (const [ws, client] of this.clients.entries()) {
      clients.push({
        address: ws._socket?.remoteAddress || 'unknown',
        lastHeartbeat: client.lastHeartbeat,
        isAlive: client.isAlive,
      });
    }
    return clients;
  }

  /**
   * Close the server
   */
  close(): void {
    // Stop heartbeat check
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Stop periodic broadcast
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
    }

    // Close all client connections
    for (const client of this.clients.keys()) {
      client.close();
    }
    this.clients.clear();
    this.subscriptions.clear();
    this.wss.close();
  }

  /**
   * Get server info
   */
  getInfo(): {
    port: number;
    clients: number;
    maxClients: number;
    heartbeatInterval: number;
  } {
    return {
      port: this.port,
      clients: this.getClientCount(),
      maxClients: this.MAX_CLIENTS,
      heartbeatInterval: this.HEARTBEAT_INTERVAL,
    };
  }
}
