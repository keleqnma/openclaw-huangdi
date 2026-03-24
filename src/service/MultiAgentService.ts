/**
 * MultiAgentService - 多 Agent 服务主类
 *
 * 整合所有模块，提供统一的服务启动和停止接口
 */

import { AgentOrchestrator } from '../agent/AgentOrchestrator';
import { TerminalService } from '../terminal/TerminalService';
import { ProcessRegistry } from '../terminal/ProcessRegistry';
import { SandboxManager } from '../sandbox/SandboxManager';
import { SandboxConfig } from '../sandbox/types';
import { createRoutes } from '../api/routes';
import { ApiWebSocketServer } from '../api/WebSocketServer';
import { AgentConfig } from '../terminal/types';
import { TaskBoardManager } from '../task/TaskBoardManager';
import { MonitorAgent } from '../task/MonitorAgent';
import { ActionLogger } from '../task/ActionLogger';
import { ChatManager } from '../task/ChatManager';
import { Hono } from 'hono';

export interface MultiAgentServiceConfig {
  // 服务配置
  port: number;
  wsPort: number;

  // Agent 池配置
  maxConcurrentAgents: number;

  // 终端配置
  maxBufferLength: number;

  // 沙箱配置
  sandbox: SandboxConfig;

  // 任务看板配置
  enableTaskBoard?: boolean;
  monitorCheckInterval?: number;      // 监控检查间隔 (ms)
  monitorStalledThreshold?: number;   // 停滞阈值 (ms)
}

const DEFAULT_CONFIG: MultiAgentServiceConfig = {
  port: 3456,
  wsPort: 3457,
  maxConcurrentAgents: 10,
  maxBufferLength: 1000,
  sandbox: {
    mode: 'restricted',
    workspaceRoot: './workspaces',
    allowedPaths: [],
    networkAccess: false,
    resourceLimits: {
      maxCpu: 50,
      maxMemory: 512,
      maxProcesses: 10,
    },
  },
  enableTaskBoard: true,
  monitorCheckInterval: 30000,
  monitorStalledThreshold: 300000,
};

export class MultiAgentService {
  private orchestrator: AgentOrchestrator;
  private terminalService: TerminalService;
  private processRegistry: ProcessRegistry;
  private sandboxManager: SandboxManager;
  private apiServer: any;
  private wsServer: ApiWebSocketServer;
  private config: MultiAgentServiceConfig;
  private httpServer?: any;

  // 任务看板组件
  private taskBoard?: TaskBoardManager;
  private monitorAgent?: MonitorAgent;

  // Agent 动作和聊天组件
  private actionLogger?: ActionLogger;
  private chatManager?: ChatManager;

  constructor(config: Partial<MultiAgentServiceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 初始化组件
    this.terminalService = new TerminalService();
    this.processRegistry = new ProcessRegistry();
    this.sandboxManager = new SandboxManager(this.config.sandbox);
    this.orchestrator = new AgentOrchestrator(
      this.terminalService,
      this.processRegistry,
      this.sandboxManager
    );

    // 初始化任务看板（如果启用）
    if (this.config.enableTaskBoard) {
      this.taskBoard = new TaskBoardManager();
      this.monitorAgent = new MonitorAgent(this.taskBoard, {
        checkInterval: this.config.monitorCheckInterval,
        stalledThreshold: this.config.monitorStalledThreshold,
      });
    }

    // 初始化 Agent 动作记录和聊天管理器
    this.actionLogger = new ActionLogger();
    this.chatManager = new ChatManager();

    // 将 actionLogger 传递给其他模块
    this.terminalService.actionLogger = this.actionLogger;
    this.sandboxManager.actionLogger = this.actionLogger;
    if (this.taskBoard) {
      this.taskBoard.actionLogger = this.actionLogger;
    }

    // 创建 API 路由（包含任务看板路由）
    this.apiServer = createRoutes(
      this.orchestrator,
      this.terminalService,
      this.sandboxManager,
      this.taskBoard,
      this.monitorAgent,
      this.actionLogger,
      this.chatManager
    );

    // 创建 WebSocket 服务
    this.wsServer = new ApiWebSocketServer(this.config.wsPort);

    // 绑定事件
    this.bindEvents();
  }

  private bindEvents() {
    // Agent 事件 -> WebSocket 推送
    this.orchestrator.on('agent:registered', (runtime) => {
      this.wsServer.broadcastAgentUpdate(runtime);
    });
    this.orchestrator.on('agent:started', (runtime) => {
      this.wsServer.broadcastAgentUpdate(runtime);
    });
    this.orchestrator.on('agent:stopped', (runtime) => {
      this.wsServer.broadcastAgentUpdate(runtime);
    });

    // 终端事件 -> WebSocket 推送
    this.terminalService.on('output', (event) => {
      this.wsServer.broadcastTerminalOutput(event);
    });

    // 任务事件 -> WebSocket 推送
    this.orchestrator.on('task:started', (task) => {
      this.wsServer.broadcastTaskEvent('started', task);
    });
    this.orchestrator.on('task:completed', (task) => {
      this.wsServer.broadcastTaskEvent('completed', task);
    });
    this.orchestrator.on('task:failed', (data) => {
      this.wsServer.broadcastTaskEvent('failed', { ...data.task, error: data.error.message });
    });

    // 任务看板事件 -> WebSocket 推送
    if (this.taskBoard) {
      this.taskBoard.on('task:created', (task) => {
        this.wsServer.broadcastTaskBoardUpdate('task:created', task);
      });
      this.taskBoard.on('task:claimed', ({ task }) => {
        this.wsServer.broadcastTaskBoardUpdate('task:claimed', task);
      });
      this.taskBoard.on('task:released', ({ task }) => {
        this.wsServer.broadcastTaskBoardUpdate('task:released', task);
      });
      this.taskBoard.on('task:updated', (task) => {
        this.wsServer.broadcastTaskBoardUpdate('task:updated', task);
      });
      this.taskBoard.on('task:completed', (task) => {
        this.wsServer.broadcastTaskBoardUpdate('task:completed', task);
      });
      this.taskBoard.on('message:added', ({ task, message }) => {
        this.wsServer.broadcastTaskBoardMessage(task, message);
      });
    }

    // 监控 Agent 事件 -> WebSocket 推送
    if (this.monitorAgent) {
      this.monitorAgent.on('alert:overdue', (task) => {
        this.wsServer.broadcastTaskBoardAlert('overdue', task);
      });
      this.monitorAgent.on('alert:stalled', (task) => {
        this.wsServer.broadcastTaskBoardAlert('stalled', task);
      });
    }

    // Agent 动作事件 -> WebSocket 推送
    if (this.actionLogger) {
      this.actionLogger.on('action', (action) => {
        this.wsServer.broadcastAgentAction(action);
      });
      this.actionLogger.on('action:end', (action) => {
        this.wsServer.broadcastAgentAction(action);
      });
    }

    // 聊天消息事件 -> WebSocket 推送
    if (this.chatManager) {
      this.chatManager.on('message', (message) => {
        this.wsServer.broadcastChatMessage(message);
      });
    }
  }

  /**
   * 注册 Agent
   */
  async registerAgent(config: AgentConfig): Promise<void> {
    await this.orchestrator.register(config);
  }

  /**
   * 注册多个 Agent
   */
  async registerAgents(configs: AgentConfig[]): Promise<void> {
    for (const config of configs) {
      await this.registerAgent(config);
    }
  }

  /**
   * 执行任务
   */
  async executeTask(agentId: string | undefined, task: string): Promise<{ taskId: string; sessionId: string }> {
    return this.orchestrator.executeTask(agentId, task);
  }

  /**
   * 启动服务
   */
  async start(): Promise<void> {
    // 启动 HTTP API
    const { serve } = await import('@hono/node-server');

    this.httpServer = serve(
      {
        fetch: this.apiServer.fetch,
        port: this.config.port,
      },
      () => {
        console.log(`[MultiAgentService] API server listening on port ${this.config.port}`);
      }
    );

    // 启动监控 Agent（如果启用）
    if (this.monitorAgent) {
      this.monitorAgent.start();
      console.log(`[MonitorAgent] Started with checkInterval=${this.config.monitorCheckInterval}ms`);
    }

    console.log(`[MultiAgentService] WebSocket server listening on port ${this.config.wsPort}`);
    console.log(`[MultiAgentService] Service started successfully`);
    console.log(`[MultiAgentService] Task Board enabled: ${!!this.config.enableTaskBoard}`);
    console.log(`[MultiAgentService] Visit http://localhost:${this.config.port}/task-board.html`);
    console.log(`[MultiAgentService] Agent Dashboard: http://localhost:${this.config.port}/agent-dashboard.html`);
  }

  /**
   * 停止服务
   */
  async stop(): Promise<void> {
    console.log('[MultiAgentService] Stopping service...');

    // 停止监控 Agent
    if (this.monitorAgent) {
      this.monitorAgent.stop();
    }

    // 关闭所有终端会话
    this.terminalService.closeAll();

    // 关闭所有沙箱
    await this.sandboxManager.stopAll();

    // 关闭 WebSocket 服务
    this.wsServer.close();

    // 关闭 HTTP 服务
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer.close(() => resolve());
      });
    }

    console.log('[MultiAgentService] Service stopped');
  }

  /**
   * 获取服务状态
   */
  getStatus(): {
    running: boolean;
    apiPort: number;
    wsPort: number;
    wsClients: number;
    stats: ReturnType<AgentOrchestrator['getStats']>;
  } {
    return {
      running: !!this.httpServer,
      apiPort: this.config.port,
      wsPort: this.config.wsPort,
      wsClients: this.wsServer.getClientCount(),
      stats: this.orchestrator.getStats(),
    };
  }

  /**
   * 获取组件（用于高级用法）
   */
  getComponents(): {
    orchestrator: AgentOrchestrator;
    terminalService: TerminalService;
    sandboxManager: SandboxManager;
    wsServer: ApiWebSocketServer;
    actionLogger?: ActionLogger;
    chatManager?: ChatManager;
    taskBoard?: TaskBoardManager;
  } {
    return {
      orchestrator: this.orchestrator,
      terminalService: this.terminalService,
      sandboxManager: this.sandboxManager,
      wsServer: this.wsServer,
      actionLogger: this.actionLogger,
      chatManager: this.chatManager,
      taskBoard: this.taskBoard,
    };
  }

  /**
   * 更新 Agent 配置 (memory, systemPrompt 等)
   */
  async updateAgentConfig(
    agentId: string,
    config: { memory?: string; systemPrompt?: string; customInstructions?: string }
  ): Promise<void> {
    const runtime = this.orchestrator.getRuntime(agentId);
    if (!runtime) throw new Error(`Agent ${agentId} not found`);

    // 注：AgentRuntime 的配置更新需要在 AgentOrchestrator 中实现
    // 这里只是记录配置更新动作

    // 记录配置更新动作
    if (this.actionLogger) {
      this.actionLogger.log({
        agentId,
        actionType: 'status_change',
        payload: { event: 'config_updated', updates: Object.keys(config) },
        result: 'success',
      });
    }
  }
}
