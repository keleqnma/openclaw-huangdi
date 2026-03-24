/**
 * Unified WebSocket Server - 统一 WebSocket 服务
 *
 * 合并 DashboardServer 和 ApiWebSocketServer 的功能：
 * - 支持 Dashboard 同步和重放控制
 * - 支持频道订阅/取消订阅
 * - 统一使用 TimelineEvent 格式
 * - 心跳检测和僵尸连接清理
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { TimelineEvent } from './events';
import type { AgentState, ReplayState } from '../dashboard/types';
import type { UnifiedAgentState } from './UnifiedAgentState';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';

// 任务类型 (从 task/types 导入)
export interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  [key: string]: any;
}

// 聊天消息类型
export interface ChatMessage {
  id: string;
  from: string;
  to?: string;
  content: string;
  timestamp: number;
  isFromUser: boolean;
  relatedTaskId?: string;
}

// 终端输出事件类型
export interface TerminalOutputEvent {
  sessionId: string;
  output: string;
  timestamp: number;
}

interface ClientMessage {
  // Dashboard 消息类型
  type: 'fetch_events' | 'replay_control' | 'fetch_logs' |
        // Api 消息类型
        'subscribe' | 'unsubscribe' | 'ping';
  payload: any;
}

interface ServerMessage {
  type: string;
  payload?: any;
  events?: TimelineEvent[];
  agents?: AgentState[];
  replayState?: ReplayState;
}

export interface WebSocketClient {
  ws: WebSocket;
  lastHeartbeat: number;
  isAlive: boolean;
  subscriptions: Set<string>;
}

export interface UnifiedWebSocketServerConfig {
  maxClients: number;
  heartbeatInterval: number;
  heartbeatTimeout: number;
  broadcastInterval: number;
}

const DEFAULT_CONFIG: UnifiedWebSocketServerConfig = {
  maxClients: 100,
  heartbeatInterval: 30000, // 30s
  heartbeatTimeout: 10000,  // 10s
  broadcastInterval: 2000,  // 2s
};

export class UnifiedWebSocketServer {
  private wss?: any;
  private clients: Map<any, WebSocketClient> = new Map();
  private readonly config: UnifiedWebSocketServerConfig;
  private heartbeatInterval?: NodeJS.Timeout;
  private broadcastInterval?: NodeJS.Timeout;

  // Data sources (injected)
  private getAgentsFn?: () => AgentState[];
  private getEventsFn?: () => TimelineEvent[];
  private getEventsSinceFn?: (since: number, agentId?: string) => TimelineEvent[];
  private updateReplayStateFn?: (update: Partial<ReplayState>) => void;
  private getReplayStateFn?: () => ReplayState;

  constructor(config: Partial<UnifiedWebSocketServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 附加到现有的 HTTP 服务器（用于 DashboardServer 模式）
   */
  attachToHTTPServer(
    wss: WebSocketServer,
    dataSources: {
      getAgents: () => AgentState[];
      getEvents: () => TimelineEvent[];
      getEventsSince: (since: number, agentId?: string) => TimelineEvent[];
      updateReplayState: (update: Partial<ReplayState>) => void;
      getReplayState: () => ReplayState;
    }
  ): void {
    this.wss = wss;
    this.getAgentsFn = dataSources.getAgents;
    this.getEventsFn = dataSources.getEvents;
    this.getEventsSinceFn = dataSources.getEventsSince;
    this.updateReplayStateFn = dataSources.updateReplayState;
    this.getReplayStateFn = dataSources.getReplayState;

    this.setupConnectionHandler();
    this.startHeartbeatCheck();
    this.startPeriodicBroadcast();
  }

  /**
   * 作为独立服务器启动（用于 ApiWebSocketServer 模式）
   */
  start(port: number): void {
    this.wss = new WebSocketServer({ port });
    this.setupConnectionHandler();
    this.startHeartbeatCheck();
    this.startPeriodicBroadcast();
  }

  /**
   * 设置连接处理器
   */
  private setupConnectionHandler(): void {
    if (!this.wss) return;

    this.wss.on('connection', (ws: any, req?: IncomingMessage) => {
      // 检查最大连接数
      if (this.clients.size >= this.config.maxClients) {
        ws.send(JSON.stringify({
          type: 'error',
          payload: { message: `Maximum connections (${this.config.maxClients}) reached. Try again later.` },
        }));
        ws.close(1013, 'Too many connections');
        return;
      }

      // 添加客户端
      const client: WebSocketClient = {
        ws,
        lastHeartbeat: Date.now(),
        isAlive: true,
        subscriptions: new Set(),
      };
      this.clients.set(ws, client);

      // 发送欢迎消息
      ws.send(JSON.stringify({
        type: 'connected',
        payload: {
          message: 'Connected to Unified WebSocket Server',
          clientId: req?.socket?.remoteAddress || 'unknown',
          serverTime: Date.now(),
        },
      }));

      // 如果是 Dashboard 模式，发送初始同步
      if (this.getAgentsFn && this.getEventsFn) {
        this.sendSync(ws);
      }

      // 消息处理
      ws.on('message', (data: Buffer) => {
        try {
          const message: ClientMessage = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch {
          ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Invalid message format' },
          }));
        }
      });

      // Pong 响应
      ws.on('pong', () => {
        const client = this.clients.get(ws);
        if (client) {
          client.isAlive = true;
          client.lastHeartbeat = Date.now();
        }
      });

      // 关闭处理
      ws.on('close', () => {
        this.clients.delete(ws);
      });

      // 错误处理
      ws.on('error', (error: any) => {
        console.debug(`WebSocket error: ${error?.message || error}`);
      });
    });

    this.wss.on('error', (error: any) => {
      console.warn(`WebSocket server error: ${error?.message || error}`);
    });
  }

  /**
   * 处理客户端消息
   */
  private handleMessage(ws: WebSocket, message: ClientMessage): void {
    switch (message.type) {
      // Dashboard 消息类型
      case 'fetch_events': {
        if (!this.getEventsSinceFn) {
          ws.send(JSON.stringify({ type: 'error', payload: { message: 'Events API not available' } }));
          return;
        }
        const events = this.getEventsSinceFn(
          message.payload.since,
          message.payload.agentId
        );
        ws.send(JSON.stringify({ type: 'event', events }));
        break;
      }

      case 'replay_control': {
        if (!this.updateReplayStateFn) {
          ws.send(JSON.stringify({ type: 'error', payload: { message: 'Replay API not available' } }));
          return;
        }
        this.updateReplayStateFn({
          isPlaying: message.payload.action === 'play',
          speed: message.payload.speed,
          currentPosition: message.payload.timestamp || Date.now(),
          from: message.payload.from,
          to: message.payload.to,
        });
        ws.send(JSON.stringify({
          type: 'sync',
          replayState: this.getReplayStateFn?.(),
        }));
        break;
      }

      case 'fetch_logs': {
        // TODO: 实现日志获取
        ws.send(JSON.stringify({ type: 'logs', events: [] }));
        break;
      }

      // Api 订阅消息类型
      case 'subscribe': {
        const client = this.clients.get(ws);
        if (client) {
          client.subscriptions.add(message.payload.channel);
        }
        ws.send(JSON.stringify({
          type: 'subscribed',
          payload: { channel: message.payload.channel },
        }));
        break;
      }

      case 'unsubscribe': {
        const client = this.clients.get(ws);
        if (client) {
          client.subscriptions.delete(message.payload.channel);
        }
        ws.send(JSON.stringify({
          type: 'unsubscribed',
          payload: { channel: message.payload.channel },
        }));
        break;
      }

      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong', payload: { timestamp: Date.now() } }));
        const client = this.clients.get(ws);
        if (client) {
          client.isAlive = true;
          client.lastHeartbeat = Date.now();
        }
        break;
      }

      default:
        ws.send(JSON.stringify({
          type: 'error',
          payload: { message: `Unknown message type: ${message.type}` },
        }));
    }
  }

  /**
   * 发送同步消息（Dashboard 模式）
   */
  private sendSync(ws: WebSocket): void {
    if (!this.getAgentsFn || !this.getEventsFn) return;

    const agents = this.getAgentsFn();
    const events = this.getEventsFn();

    ws.send(JSON.stringify({
      type: 'sync',
      agents,
      events,
    }));
  }

  /**
   * 启动心跳检测
   */
  private startHeartbeatCheck(): void {
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((client, ws: any) => {
        if (!client.isAlive) {
          // 客户端未响应 ping，终止连接
          console.debug(`Terminating zombie connection: ${ws._socket?.remoteAddress}`);
          ws.terminate?.();
          this.clients.delete(ws);
          return;
        }

        // 标记为不活跃并发送 ping
        client.isAlive = false;
        client.lastHeartbeat = Date.now();
        ws.ping?.();
      });
    }, this.config.heartbeatInterval);
  }

  /**
   * 启动周期性广播
   */
  private startPeriodicBroadcast(): void {
    this.broadcastInterval = setInterval(() => {
      this.broadcast({ type: 'heartbeat', payload: { timestamp: Date.now() } });
    }, this.config.broadcastInterval);
  }

  /**
   * 广播消息到所有订阅的客户端
   */
  broadcast(message: ServerMessage, channel?: string): void {
    const data = JSON.stringify(message);
    const deadClients: any[] = [];

    for (const [ws, client] of this.clients.entries()) {
      if (client.isAlive && ws.readyState === 1 /* WebSocket.OPEN */) {
        if (!channel || client.subscriptions.has(channel)) {
          try {
            ws.send(data);
          } catch (error) {
            deadClients.push(ws);
          }
        }
      } else if (ws.readyState !== 1 /* WebSocket.OPEN */) {
        deadClients.push(ws);
      }
    }

    // 清理死亡客户端
    for (const ws of deadClients) {
      this.clients.delete(ws);
    }
  }

  /**
   * 广播 TimelineEvent
   */
  broadcastEvent(event: TimelineEvent): void {
    this.broadcast({
      type: 'event',
      payload: { event },
    });

    // 如果事件有 agentId，也广播到该 agent 的频道
    if (event.agentId) {
      this.broadcast({
        type: 'event',
        payload: { event },
      }, `agent:${event.agentId}`);
    }

    // 如果事件有 taskId，也广播到该任务的频道
    if (event.taskId) {
      this.broadcast({
        type: 'event',
        payload: { event },
      }, `task:${event.taskId}`);
    }
  }

  /**
   * 广播 Agent 状态更新
   */
  broadcastAgentUpdate(agent: UnifiedAgentState): void {
    this.broadcast({
      type: 'agent:update',
      payload: { agent },
    }, `agent:${agent.id}`);
  }

  /**
   * 广播 Agent 状态变化
   */
  broadcastAgentStatus(agentId: string, status: string, detail?: string): void {
    this.broadcast({
      type: 'agent:status',
      payload: { agentId, status, detail, timestamp: Date.now() },
    }, `agent:${agentId}`);
  }

  /**
   * 广播 Agent 动作
   */
  broadcastAgentAction(agentId: string, actionType: string, payload?: any): void {
    this.broadcast({
      type: 'agent:action',
      payload: { agentId, actionType, payload, timestamp: Date.now() },
    }, `agent:${agentId}`);
  }

  /**
   * 广播 Agent 思考状态
   */
  broadcastAgentThinking(agentId: string, thought: string, taskId?: string): void {
    this.broadcast({
      type: 'agent:thinking',
      payload: { agentId, thought, taskId, timestamp: Date.now() },
    }, `agent:${agentId}`);
  }

  /**
   * 广播任务事件
   */
  broadcastTaskEvent(eventType: 'created' | 'updated' | 'completed' | 'failed', task: Task): void {
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
  broadcastTaskBoardMessage(taskId: string, message: any): void {
    this.broadcast({
      type: 'taskboard:message',
      payload: { taskId, message },
    }, 'taskboard');
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
      }, `chat:${message.to}`);
    }
    // 群聊：发送给所有订阅者
    this.broadcast({
      type: 'chat:message',
      payload: { message },
    }, 'chat:global');
  }

  /**
   * 广播终端输出
   */
  broadcastTerminalOutput(event: TerminalOutputEvent): void {
    this.broadcast({
      type: 'terminal:output',
      payload: event,
    }, `terminal:${event.sessionId}`);
  }

  /**
   * 获取客户端数量
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * 获取已连接的客户端信息
   */
  getConnectedClients(): Array<{
    address: string;
    lastHeartbeat: number;
    isAlive: boolean;
    subscriptions: string[];
  }> {
    const clients: Array<{
      address: string;
      lastHeartbeat: number;
      isAlive: boolean;
      subscriptions: string[];
    }> = [];

    for (const [ws, client] of this.clients.entries()) {
      clients.push({
        address: ws._socket?.remoteAddress || 'unknown',
        lastHeartbeat: client.lastHeartbeat,
        isAlive: client.isAlive,
        subscriptions: Array.from(client.subscriptions),
      });
    }

    return clients;
  }

  /**
   * 关闭服务器
   */
  close(): void {
    // 停止心跳检测
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // 停止周期性广播
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
    }

    // 关闭所有客户端连接
    for (const client of this.clients.keys()) {
      client.close();
    }
    this.clients.clear();

    // 关闭 WebSocket 服务器
    this.wss?.close();
  }

  /**
   * 获取服务器信息
   */
  getInfo(): {
    clients: number;
    maxClients: number;
    heartbeatInterval: number;
    broadcastInterval: number;
  } {
    return {
      clients: this.getClientCount(),
      maxClients: this.config.maxClients,
      heartbeatInterval: this.config.heartbeatInterval,
      broadcastInterval: this.config.broadcastInterval,
    };
  }
}
