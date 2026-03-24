/**
 * Agent 状态共享管理器
 *
 * 用于在 MultiAgentService 和 Dashboard 之间共享 Agent 状态
 * 支持双向同步：
 * 1. MultiAgentService 创建的 Agent 自动同步到 Dashboard
 * 2. Dashboard 创建的 Agent 自动同步到 MultiAgentService
 * 3. OpenClaw subagent 事件自动同步到 Dashboard
 */

import { EventEmitter } from 'events';

export interface SharedAgentState {
  id: string;
  name?: string;
  role?: string;
  status: 'spawning' | 'idle' | 'running' | 'completed' | 'error';
  sessionId?: string;
  createdAt: number;
  endedAt?: number;
  task?: string;
  error?: string;
  source: 'dashboard' | 'service' | 'openclaw';
}

export class SharedAgentStateManager extends EventEmitter {
  private agents: Map<string, SharedAgentState> = new Map();

  /**
   * 添加 Agent（从 Dashboard 创建）
   */
  addFromDashboard(id: string, config: { name?: string; role?: string }): SharedAgentState {
    const state: SharedAgentState = {
      id,
      ...config,
      status: 'spawning',
      createdAt: Date.now(),
      source: 'dashboard',
    };
    this.agents.set(id, state);
    this.emit('agent:created', state);
    return state;
  }

  /**
   * 添加 Agent（从 OpenClaw subagent 事件）
   */
  addFromOpenClaw(sessionKey: string, label?: string): SharedAgentState {
    const state: SharedAgentState = {
      id: sessionKey,
      task: label,
      status: 'spawning',
      createdAt: Date.now(),
      source: 'openclaw',
    };
    this.agents.set(sessionKey, state);
    this.emit('agent:created', state);
    return state;
  }

  /**
   * 添加 Agent（从 MultiAgentService 创建）
   */
  addFromService(id: string, config: { name?: string; role?: string; sessionId?: string }): SharedAgentState {
    const state: SharedAgentState = {
      id,
      ...config,
      status: 'idle',
      createdAt: Date.now(),
      source: 'service',
    };
    this.agents.set(id, state);
    this.emit('agent:created', state);
    return state;
  }

  /**
   * 更新 Agent 状态
   */
  updateStatus(id: string, status: SharedAgentState['status'], extra?: Partial<SharedAgentState>): SharedAgentState | undefined {
    const agent = this.agents.get(id);
    if (!agent) return undefined;

    agent.status = status;
    if (extra) {
      Object.assign(agent, extra);
    }

    this.emit('agent:updated', agent);
    return agent;
  }

  /**
   * 标记 Agent 为运行中
   */
  markRunning(id: string, sessionId?: string): SharedAgentState | undefined {
    return this.updateStatus(id, 'running', { sessionId });
  }

  /**
   * 标记 Agent 为完成
   */
  markCompleted(id: string): SharedAgentState | undefined {
    return this.updateStatus(id, 'completed', { endedAt: Date.now() });
  }

  /**
   * 标记 Agent 为错误
   */
  markError(id: string, error: string): SharedAgentState | undefined {
    return this.updateStatus(id, 'error', { error, endedAt: Date.now() });
  }

  /**
   * 获取 Agent 状态
   */
  getAgent(id: string): SharedAgentState | undefined {
    return this.agents.get(id);
  }

  /**
   * 获取所有 Agent
   */
  getAllAgents(): SharedAgentState[] {
    return Array.from(this.agents.values());
  }

  /**
   * 获取活动 Agent（未完成/未错误）
   */
  getActiveAgents(): SharedAgentState[] {
    return Array.from(this.agents.values()).filter(
      a => a.status !== 'completed' && a.status !== 'error'
    );
  }

  /**
   * 移除 Agent
   */
  removeAgent(id: string): void {
    this.agents.delete(id);
    this.emit('agent:removed', id);
  }

  /**
   * 清空所有 Agent
   */
  clear(): void {
    this.agents.clear();
    this.emit('agent:cleared');
  }
}

// 导出单例用于全局共享
export const sharedAgentState = new SharedAgentStateManager();
