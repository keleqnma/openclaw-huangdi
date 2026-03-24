/**
 * Huangdi Dashboard - WebSocket + HTTP Server
 * Built with Hono framework
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import * as http from 'http';
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { ServerMessage, ClientMessage } from './types';
import type { TimelineEvent } from '../types/events';
import { EventStore } from './EventStore';
import { AgentStateManager } from './AgentStateManager';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
// 统一状态管理
import { UnifiedStateManager, getGlobalStateManager } from '../types/UnifiedStateManager';
import { UnifiedEventStore } from '../types/UnifiedEventStore';
import type { UnifiedAgentState } from '../types/UnifiedAgentState';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * DashboardServer - Manages HTTP + WebSocket server for dashboard
 */
export class DashboardServer {
  private app: Hono;
  private httpServer?: import('http').Server | import('http2').Http2Server;
  private wsServer?: WebSocketServer;
  private webSockets: Set<WebSocket> = new Set();
  // 旧版本状态管理 (用于向后兼容)
  private eventStore: EventStore;
  private agentManager: AgentStateManager;
  // 统一状态管理 (新版本)
  private unifiedState?: UnifiedStateManager;
  private unifiedEvents?: UnifiedEventStore;
  private port: number;
  private api: OpenClawPluginApi | null = null;

  constructor(
    port: number = 3456,
    maxEvents: number = 1000,
    pollInterval: number = 2000,
    useUnified: boolean = true
  ) {
    this.port = port;
    this.eventStore = new EventStore(maxEvents);
    this.agentManager = new AgentStateManager(pollInterval);

    // 启用统一状态管理
    if (useUnified) {
      this.unifiedState = getGlobalStateManager();
      this.unifiedEvents = new UnifiedEventStore(maxEvents * 10);
    }

    this.app = new Hono();
    this.setupRoutes();
  }

  /**
   * Set plugin API reference
   */
  setApi(api: OpenClawPluginApi): void {
    this.api = api;
    this.agentManager.setApi(api);
  }

  /**
   * Get agent state manager
   */
  getAgentManager(): AgentStateManager {
    return this.agentManager;
  }

  /**
   * Get event store
   */
  getEventStore(): EventStore {
    return this.eventStore;
  }

  /**
   * Get unified state manager (if enabled)
   */
  getUnifiedState(): UnifiedStateManager | undefined {
    return this.unifiedState;
  }

  /**
   * Get unified event store (if enabled)
   */
  getUnifiedEvents(): UnifiedEventStore | undefined {
    return this.unifiedEvents;
  }

  /**
   * Setup HTTP routes
   */
  private setupRoutes(): void {
    // Serve static files from public directory
    this.app.get('/public/*', async (c) => {
      const path = c.req.path.replace('/public/', '');
      try {
        const fs = await import('fs/promises');
        const filePath = `./public/${path}`;
        const content = await fs.readFile(filePath, 'utf-8');
        return c.html(content);
      } catch (e) {
        return c.text('File not found', 404);
      }
    });

    // Serve unified dashboard
    this.app.get('/', async (c) => {
      const dashboardPath = join(__dirname, '..', '..', 'public', 'index.html');
      try {
        const fs = await import('fs/promises');
        const content = await fs.readFile(dashboardPath, 'utf-8');
        return c.html(content);
      } catch (e: any) {
        console.error(`Dashboard HTML file not found at ${dashboardPath}:`, e.message);
        return c.html(this.getFallbackDashboardHTML());
      }
    });

    // API: Get all agents
    this.app.get('/api/agents', (c) => {
      const agents = this.agentManager.getAllAgents();
      return c.json({ agents });
    });

    // API: Get events since timestamp
    this.app.get('/api/events', (c) => {
      const since = parseInt(c.req.query('since') || '0', 10);
      const agentId = c.req.query('agentId');
      const events = this.eventStore.getEventsSince(since, agentId);
      return c.json({ events });
    });

    // API: Replay control
    this.app.post('/api/replay', async (c) => {
      const body = await c.req.json();
      const { action, speed, from, to } = body;

      this.eventStore.updateReplayState({
        isPlaying: action === 'play',
        speed: speed || 1,
        currentPosition: from || Date.now(),
        from,
        to,
      });

      return c.json({ success: true, state: this.eventStore.getReplayState() });
    });
  }

  /**
   * Start HTTP + WebSocket server
   */
  async start(): Promise<number> {
    return new Promise((resolve, _reject) => {
      // Start HTTP server using @hono/node-server
      this.httpServer = serve({
        fetch: this.app.fetch,
        port: this.port,
      }, (info) => {
        this.api?.logger.info(`Dashboard HTTP server running on port ${info.port}`);
        resolve(info.port);
      });

      // Upgrade to WebSocket
      this.httpServer.on('upgrade', (req: http.IncomingMessage, socket: import('net').Socket, head: Buffer) => {
        if (req.url === '/ws') {
          this.handleWebSocketUpgrade(req, socket, head);
        } else {
          socket.destroy();
        }
      });
    });
  }

  /**
   * Handle WebSocket upgrade
   */
  private handleWebSocketUpgrade(
    req: http.IncomingMessage,
    socket: import('net').Socket,
    head: Buffer
  ): void {
    this.wsServer?.handleUpgrade(req, socket, head, (ws) => {
      this.webSockets.add(ws);
      this.api?.logger.debug?.('WebSocket client connected');

      ws.on('close', () => {
        this.webSockets.delete(ws);
        this.api?.logger.debug?.('WebSocket client disconnected');
      });

      ws.on('message', (data) => {
        this.handleWebSocketMessage(ws, data);
      });

      // Send initial sync
      this.sendSync(ws);
    });
  }

  /**
   * Create WebSocket server
   */
  createWebSocketServer(): void {
    if (!this.httpServer) return;

    this.wsServer = new WebSocketServer({
      noServer: true,
      pingInterval: 30000,
    });

    // Heartbeat
    setInterval(() => {
      this.broadcast({ type: 'heartbeat', timestamp: Date.now() });
    }, 10000);
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleWebSocketMessage(ws: WebSocket, data: any): void {
    try {
      const message: ClientMessage = JSON.parse(data.toString());

      switch (message.type) {
        case 'fetch_events': {
          const events = this.eventStore.getEventsSince(
            message.since,
            message.agentId
          );
          ws.send(JSON.stringify({ type: 'event', events }));
          break;
        }
        case 'replay_control': {
          this.eventStore.updateReplayState({
            isPlaying: message.action === 'play',
            speed: message.speed,
            currentPosition: message.timestamp || Date.now(),
          });
          ws.send(JSON.stringify({
            type: 'sync',
            replayState: this.eventStore.getReplayState(),
          }));
          break;
        }
        case 'fetch_logs': {
          // TODO: Implement log fetching
          break;
        }
      }
    } catch (error) {
      this.api?.logger.warn(`WebSocket message parse error: ${error}`);
    }
  }

  /**
   * Send sync message to a WebSocket
   */
  private sendSync(ws: WebSocket): void {
    const agents = this.agentManager.getAllAgents();
    const events = this.eventStore.getAllEvents();

    ws.send(JSON.stringify({
      type: 'sync',
      agents,
      events,
    }));
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(message: ServerMessage | { type: 'event'; event: TimelineEvent }): void {
    const data = JSON.stringify(message);
    for (const ws of this.webSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  /**
   * Broadcast event to all clients
   */
  broadcastEvent(event: TimelineEvent): void {
    // 写入旧事件存储
    this.eventStore.add(event);

    // 写入统一事件存储 (如果启用)
    if (this.unifiedEvents) {
      this.unifiedEvents.add(event);
    }

    // 同步到统一状态管理器 (如果是 Agent 相关事件)
    if (this.unifiedState && event.agentId) {
      this.syncAgentEvent(event);
    }

    // 广播到 WebSocket 客户端
    this.broadcast({ type: 'event', event });
  }

  /**
   * Sync event to UnifiedStateManager
   */
  private syncAgentEvent(event: TimelineEvent): void {
    // 此方法调用前已确保 event.agentId 存在
    const agentId = event.agentId!;

    switch (event.type) {
      case 'agent:created': {
        // 从事件详情提取 Agent 信息
        const role = event.details?.role || 'planner';
        this.unifiedState?.createAgent({
          id: agentId,
          role,
          status: 'spawning',
          taskDescription: event.details?.task,
          config: {},
        });
        break;
      }

      case 'agent:status': {
        const newStatus = event.details?.status;
        if (newStatus) {
          this.unifiedState?.transitionState(agentId, newStatus, event.details?.reason);
        }
        break;
      }

      case 'agent:action': {
        // 增加动作计数
        this.unifiedState?.incrementActionCount(agentId);
        break;
      }

      case 'agent:thinking': {
        // 思考中状态
        this.unifiedState?.transitionState(agentId, 'thinking');
        break;
      }
    }
  }

  /**
   * Stop the server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      // Stop all polling
      this.agentManager.clear();

      // Close WebSocket connections
      for (const ws of this.webSockets) {
        ws.close();
      }
      this.webSockets.clear();

      // Close WebSocket server
      this.wsServer?.close(() => {
        // Close HTTP server
        this.httpServer?.close(() => {
          this.api?.logger.info('Dashboard server stopped');
          resolve();
        });
      });
    });
  }

  /**
   * Get dashboard URL
   */
  getUrl(): string {
    return `http://localhost:${this.port}`;
  }

  /**
   * Fallback dashboard HTML when file not found
   */
  private getFallbackDashboardHTML(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Huangdi Dashboard</title>
  <style>body{background:#0d1117;color:#c9d1d9;font-family:sans-serif;padding:20px;}h1{color:#58a6ff;}</style>
</head>
<body>
  <h1>Huangdi Dashboard</h1>
  <p>Dashboard HTML file not found. Please build the project first.</p>
  <p>Run: npm run build</p>
</body>
</html>`;
  }

  /**
   * Generate inline dashboard HTML (deprecated, kept for backwards compatibility)
   */
  private getDashboardHTML(): string {
    return this.getFallbackDashboardHTML();
  }
}
