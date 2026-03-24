/**
 * WebSocketServer - WebSocket 实时推送服务
 *
 * 使用 UnifiedWebSocketServer 作为底层实现，
 * 提供向后兼容的 API 接口
 */

import { UnifiedWebSocketServer } from '../types/UnifiedWebSocketServer';
import { TerminalOutputEvent } from '../terminal/types';
import { AgentRuntime } from '../terminal/types';
import { Task, TaskMessage, AgentAction, ChatMessage } from '../task/types';
import { UnifiedAgentState } from '../types/UnifiedAgentState';

/**
 * ApiWebSocketServer - 向后兼容的包装器类
 *
 * 使用 UnifiedWebSocketServer 作为底层实现，
 * 保留原有 API 接口以确保向后兼容性
 */
export class ApiWebSocketServer {
  private unifiedWs: UnifiedWebSocketServer;
  private readonly port: number;
  private readonly MAX_CLIENTS = 50;
  private readonly HEARTBEAT_INTERVAL = 30000;
  private readonly HEARTBEAT_TIMEOUT = 10000;

  constructor(port: number = 3457) {
    this.port = port;
    this.unifiedWs = new UnifiedWebSocketServer({
      maxClients: 100,
      heartbeatInterval: this.HEARTBEAT_INTERVAL,
      heartbeatTimeout: this.HEARTBEAT_TIMEOUT,
      broadcastInterval: 2000,
    });
    this.unifiedWs.start(port);
  }

  /**
   * 广播 Agent 状态更新
   */
  broadcastAgentUpdate(agent: AgentRuntime): void {
    // 转换为 UnifiedAgentState 格式
    const unifiedAgent: UnifiedAgentState = {
      id: agent.id,
      role: agent.config?.role || 'planner',
      status: this.convertStatus(agent.status),
      currentTaskId: agent.currentTask?.id,
      taskDescription: agent.currentTask?.description,
      lastEventAt: Date.now(),
      actionCount: 0,
      memoryIds: [],
      context: {
        global: [],
        team: [],
        local: [],
      },
      config: {
        systemPrompt: (agent.config as any)?.systemPrompt,
        customInstructions: (agent.config as any)?.customInstructions,
        memory: (agent.config as any)?.memory,
      },
      startedAt: agent.startedAt || Date.now(),
    };
    this.unifiedWs.broadcastAgentUpdate(unifiedAgent);
  }

  /**
   * 广播终端输出
   */
  broadcastTerminalOutput(event: TerminalOutputEvent): void {
    // 转换为统一的 TerminalOutputEvent 格式
    this.unifiedWs.broadcastTerminalOutput({
      sessionId: event.sessionId,
      output: (event as any).data || (event as any).content || '',
      timestamp: event.timestamp || Date.now(),
    });
  }

  /**
   * 广播任务事件
   */
  broadcastTaskEvent(eventType: 'started' | 'completed' | 'failed', task: any): void {
    // 映射事件类型
    const typeMap: Record<string, 'created' | 'updated' | 'completed' | 'failed'> = {
      'started': 'updated',
      'completed': 'completed',
      'failed': 'failed',
    };
    this.unifiedWs.broadcastTaskEvent(typeMap[eventType] || 'updated', task);
  }

  /**
   * 广播任务看板更新
   */
  broadcastTaskBoardUpdate(
    eventType: 'task:created' | 'task:claimed' | 'task:released' | 'task:updated' | 'task:completed',
    task: Task
  ): void {
    this.unifiedWs.broadcastTaskBoardUpdate(eventType, task);
  }

  /**
   * 广播任务消息
   */
  broadcastTaskBoardMessage(task: Task, message: TaskMessage): void {
    this.unifiedWs.broadcastTaskBoardMessage(task.id, message);
  }

  /**
   * 广播任务告警
   */
  broadcastTaskBoardAlert(alertType: 'overdue' | 'stalled', task: Task): void {
    // 使用统一 WebSocket 广播
    this.unifiedWs.broadcast({
      type: 'taskboard:alert',
      payload: { alertType, task },
    }, 'taskboard');
  }

  /**
   * 广播 Agent 动作
   */
  broadcastAgentAction(action: AgentAction): void {
    this.unifiedWs.broadcastAgentAction(
      action.agentId,
      action.actionType,
      action.payload
    );
  }

  /**
   * 广播 Agent 思考状态
   */
  broadcastThinking(agentId: string, thought: string, taskId?: string): void {
    this.unifiedWs.broadcastAgentThinking(agentId, thought, taskId);
  }

  /**
   * 广播 Agent 状态变化
   */
  broadcastAgentStatus(
    agentId: string,
    status: 'thinking' | 'working' | 'idle' | 'error' | 'running' | 'executing',
    detail?: string
  ): void {
    this.unifiedWs.broadcastAgentStatus(agentId, status, detail);
  }

  /**
   * 广播聊天消息
   */
  broadcastChatMessage(message: ChatMessage): void {
    this.unifiedWs.broadcastChatMessage(message);
  }

  /**
   * 获取客户端数量
   */
  getClientCount(): number {
    return this.unifiedWs.getClientCount();
  }

  /**
   * 获取服务器信息
   */
  getInfo(): {
    port: number;
    clients: number;
    maxClients: number;
    heartbeatInterval: number;
  } {
    const info = this.unifiedWs.getInfo();
    return {
      port: this.port,
      clients: info.clients,
      maxClients: this.MAX_CLIENTS,
      heartbeatInterval: this.HEARTBEAT_INTERVAL,
    };
  }

  /**
   * 关闭服务器
   */
  close(): void {
    this.unifiedWs.close();
  }

  /**
   * 转换状态
   */
  private convertStatus(status: string): any {
    const statusMap: Record<string, any> = {
      'idle': 'idle',
      'thinking': 'thinking',
      'working': 'executing',
      'running': 'executing',
      'executing': 'executing',
      'error': 'error',
      'completed': 'terminated',
    };
    return statusMap[status] || 'idle';
  }
}
