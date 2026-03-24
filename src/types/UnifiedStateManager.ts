/**
 * Unified State Manager - 统一状态管理器
 *
 * 单例模式管理所有 Agent 状态，提供：
 * - 原子状态更新
 * - 事件溯源 (Event Sourcing)
 * - 状态快照
 * - 时间旅行调试
 * - EventEmitter 实时推送
 */

import { EventEmitter } from 'events';
import type { UnifiedAgentState, AgentExecutionStatus, StateSnapshot, StateQueryOptions, AgentStats } from './UnifiedAgentState';
import type { TimelineEvent } from './events';

/**
 * 状态管理器配置
 */
export interface StateManagerConfig {
  /** 最大事件存储数 */
  maxEvents: number;

  /** 快照间隔（毫秒） */
  snapshotInterval: number;

  /** 是否启用持久化 */
  enablePersistence: boolean;

  /** 持久化路径 */
  persistencePath?: string;
}

const DEFAULT_CONFIG: StateManagerConfig = {
  maxEvents: 10000,
  snapshotInterval: 60000, // 1 分钟
  enablePersistence: false,
};

/**
 * 状态管理器事件
 */
export interface StateManagerEvents {
  /** Agent 状态变更 */
  'agent:changed': [data: { agentId: string; state: UnifiedAgentState }];

  /** Agent 创建 */
  'agent:created': [data: { agentId: string }];

  /** Agent 移除 */
  'agent:removed': [data: { agentId: string }];

  /** 事件添加 */
  'event:added': [data: { event: TimelineEvent }];

  /** 快照创建 */
  'snapshot:created': [data: { snapshot: StateSnapshot }];

  /** 状态重置 */
  'state:reset': [];
}

/**
 * Unified State Manager
 */
export class UnifiedStateManager extends EventEmitter<StateManagerEvents> {
  /** Agent 状态存储 */
  private agents: Map<string, UnifiedAgentState> = new Map();

  /** 事件日志（用于 Event Sourcing） */
  private eventLog: TimelineEvent[] = [];

  /** 状态快照列表 */
  private snapshots: StateSnapshot[] = [];

  /** 配置 */
  private readonly config: StateManagerConfig;

  /** 快照定时器 */
  private snapshotTimer?: NodeJS.Timeout;

  /** 索引 - 按状态 */
  private indexByStatus: Map<AgentExecutionStatus, Set<string>> = new Map();

  /** 索引 - 按任务 ID */
  private indexByTaskId: Map<string, Set<string>> = new Map();

  /** 索引 - 按角色 */
  private indexByRole: Map<string, Set<string>> = new Map();

  constructor(config: Partial<StateManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initializeIndexes();
    this.startSnapshotTimer();
  }

  /**
   * 初始化索引
   */
  private initializeIndexes(): void {
    const statuses: AgentExecutionStatus[] = [
      'spawning', 'idle', 'thinking', 'executing', 'waiting', 'error', 'terminated'
    ];
    statuses.forEach(status => {
      this.indexByStatus.set(status, new Set());
    });
  }

  /**
   * 启动快照定时器
   */
  private startSnapshotTimer(): void {
    if (this.config.snapshotInterval > 0) {
      this.snapshotTimer = setInterval(() => {
        this.createSnapshot();
      }, this.config.snapshotInterval);
    }
  }

  /**
   * 停止快照定时器
   */
  private stopSnapshotTimer(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = undefined;
    }
  }

  // ==================== Agent 状态管理 ====================

  /**
   * 创建 Agent 状态
   */
  createAgent(state: Omit<UnifiedAgentState, 'lastEventAt' | 'actionCount' | 'memoryIds' | 'context' | 'startedAt'>): UnifiedAgentState {
    if (this.agents.has(state.id)) {
      throw new Error(`Agent '${state.id}' already exists`);
    }

    const agentState: UnifiedAgentState = {
      ...state,
      lastEventAt: Date.now(),
      actionCount: 0,
      memoryIds: [],
      context: {
        global: [],
        team: [],
        local: [],
      },
      startedAt: Date.now(),
    };

    this.agents.set(state.id, agentState);
    this.updateIndexes(state.id, undefined, agentState);

    // 记录事件
    this.addEvent({
      id: `agent_created_${state.id}_${Date.now()}`,
      type: 'agent:created',
      timestamp: Date.now(),
      agentId: state.id,
      summary: `Agent 创建：${state.id}`,
      level: 'info',
      source: 'orchestrator',
    });

    this.emit('agent:created', { agentId: state.id });

    return agentState;
  }

  /**
   * 获取 Agent 状态
   */
  getAgent(agentId: string): UnifiedAgentState | undefined {
    return this.agents.get(agentId);
  }

  /**
   * 更新 Agent 状态（原子操作）
   */
  updateState(agentId: string, update: Partial<UnifiedAgentState>): UnifiedAgentState | undefined {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return undefined;
    }

    const oldState = { ...agent };

    // 合并更新
    Object.assign(agent, update, {
      lastEventAt: Date.now(),
    });

    // 更新索引
    this.updateIndexes(agentId, oldState, agent);

    // 记录状态变更事件
    if (oldState.status !== agent.status) {
      this.addEvent({
        id: `state_change_${agentId}_${Date.now()}`,
        type: 'agent:status',
        timestamp: Date.now(),
        agentId,
        summary: `状态变更：${oldState.status} → ${agent.status}`,
        details: { from: oldState.status, to: agent.status },
        level: agent.status === 'error' ? 'error' : 'info',
        source: 'orchestrator',
      });
    }

    // 触发变更事件
    this.emit('agent:changed', { agentId, state: agent });

    return agent;
  }

  /**
   * 更新 Agent 状态（使用状态机）
   */
  transitionState(
    agentId: string,
    toStatus: AgentExecutionStatus,
    reason?: string
  ): { success: boolean; error?: string } {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }

    // 状态机转换规则
    const validTransitions: Record<AgentExecutionStatus, AgentExecutionStatus[]> = {
      spawning: ['idle', 'error', 'terminated'],
      idle: ['thinking', 'executing', 'waiting', 'error', 'terminated'],
      thinking: ['idle', 'executing', 'waiting', 'error', 'terminated'],
      executing: ['idle', 'thinking', 'waiting', 'error', 'terminated'],
      waiting: ['idle', 'thinking', 'executing', 'error', 'terminated'],
      error: ['idle', 'terminated'],
      terminated: [], // 终止状态不可转换
    };

    const allowedTransitions = validTransitions[agent.status];
    if (!allowedTransitions.includes(toStatus)) {
      return {
        success: false,
        error: `Invalid state transition from '${agent.status}' to '${toStatus}'`,
      };
    }

    const fromStatus = agent.status;
    this.updateState(agentId, { status: toStatus });

    // 记录状态转换事件
    this.addEvent({
      id: `state_transition_${agentId}_${Date.now()}`,
      type: 'agent:status',
      timestamp: Date.now(),
      agentId,
      summary: `状态转换：${fromStatus} → ${toStatus}`,
      details: { from: fromStatus, to: toStatus, reason },
      level: toStatus === 'error' ? 'error' : 'info',
      source: 'orchestrator',
    });

    return { success: true };
  }

  /**
   * 移除 Agent
   */
  removeAgent(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }

    // 从索引中移除
    this.removeFromIndexes(agentId, agent);

    this.agents.delete(agentId);
    agent.endedAt = Date.now();

    // 记录事件
    this.addEvent({
      id: `agent_removed_${agentId}_${Date.now()}`,
      type: 'agent:removed',
      timestamp: Date.now(),
      agentId,
      summary: `Agent 移除：${agentId}`,
      level: 'info',
      source: 'orchestrator',
    });

    this.emit('agent:removed', { agentId: agentId });

    return true;
  }

  /**
   * 获取所有 Agent 状态
   */
  getAllAgents(): UnifiedAgentState[] {
    return Array.from(this.agents.values());
  }

  /**
   * 查询 Agent 状态
   */
  queryAgents(options: StateQueryOptions): UnifiedAgentState[] {
    let results = this.getAllAgents();

    // 按状态过滤
    if (options.status && options.status.length > 0) {
      results = results.filter(agent => options.status!.includes(agent.status));
    }

    // 按角色过滤
    if (options.role && options.role.length > 0) {
      results = results.filter(agent => options.role!.includes(agent.role));
    }

    // 按任务 ID 过滤
    if (options.taskId) {
      results = results.filter(agent => agent.currentTaskId === options.taskId);
    }

    // 搜索关键词
    if (options.search) {
      const search = options.search.toLowerCase();
      results = results.filter(agent =>
        agent.id.toLowerCase().includes(search) ||
        agent.taskDescription?.toLowerCase().includes(search) ||
        agent.label?.toLowerCase().includes(search)
      );
    }

    return results;
  }

  // ==================== 索引管理 ====================

  /**
   * 更新索引
   */
  private updateIndexes(agentId: string, oldState: UnifiedAgentState | undefined, newState: UnifiedAgentState): void {
    // 从旧索引移除
    if (oldState) {
      this.indexByStatus.get(oldState.status)?.delete(agentId);
      if (oldState.role) {
        this.indexByRole.get(oldState.role)?.delete(agentId);
      }
      if (oldState.currentTaskId) {
        this.indexByTaskId.get(oldState.currentTaskId)?.delete(agentId);
      }
    }

    // 添加到新索引
    this.indexByStatus.get(newState.status)?.add(agentId);
    if (newState.role) {
      const roleSet = this.indexByRole.get(newState.role) || new Set();
      roleSet.add(agentId);
      this.indexByRole.set(newState.role, roleSet);
    }
    if (newState.currentTaskId) {
      const taskSet = this.indexByTaskId.get(newState.currentTaskId) || new Set();
      taskSet.add(agentId);
      this.indexByTaskId.set(newState.currentTaskId, taskSet);
    }
  }

  /**
   * 从索引移除
   */
  private removeFromIndexes(agentId: string, state: UnifiedAgentState): void {
    this.indexByStatus.get(state.status)?.delete(agentId);
    if (state.role) {
      this.indexByRole.get(state.role)?.delete(agentId);
    }
    if (state.currentTaskId) {
      this.indexByTaskId.get(state.currentTaskId)?.delete(agentId);
    }
  }

  // ==================== 事件管理 ====================

  /**
   * 添加事件
   */
  addEvent(event: TimelineEvent): void {
    this.eventLog.push(event);

    // 限制事件数量
    if (this.eventLog.length > this.config.maxEvents) {
      this.eventLog.shift();
    }

    this.emit('event:added', { event });
  }

  /**
   * 获取事件日志
   */
  getEvents(since?: number, limit: number = 1000): TimelineEvent[] {
    let events = this.eventLog;

    if (since) {
      events = events.filter(event => event.timestamp >= since);
    }

    return events.slice(-limit);
  }

  /**
   * 按 Agent ID 获取事件
   */
  getEventsByAgent(agentId: string, limit: number = 100): TimelineEvent[] {
    return this.eventLog
      .filter(event => event.agentId === agentId)
      .slice(-limit);
  }

  /**
   * 按任务 ID 获取事件
   */
  getEventsByTaskId(taskId: string, limit: number = 100): TimelineEvent[] {
    return this.eventLog
      .filter(event => event.taskId === taskId)
      .slice(-limit);
  }

  // ==================== 快照管理 ====================

  /**
   * 创建状态快照
   */
  createSnapshot(): StateSnapshot {
    const snapshot: StateSnapshot = {
      timestamp: Date.now(),
      agents: new Map(this.agents),
      eventCount: this.eventLog.length,
    };

    this.snapshots.push(snapshot);

    // 限制快照数量（保留最近 10 个）
    if (this.snapshots.length > 10) {
      this.snapshots.shift();
    }

    this.emit('snapshot:created', { snapshot });

    return snapshot;
  }

  /**
   * 获取快照列表
   */
  getSnapshots(): { timestamp: number; eventCount: number; agentCount: number }[] {
    return this.snapshots.map(s => ({
      timestamp: s.timestamp,
      eventCount: s.eventCount,
      agentCount: s.agents.size,
    }));
  }

  /**
   * 恢复到快照
   */
  restoreSnapshot(index: number): boolean {
    if (index < 0 || index >= this.snapshots.length) {
      return false;
    }

    const snapshot = this.snapshots[index];
    this.agents = new Map(snapshot.agents);

    this.emit('state:reset');

    return true;
  }

  // ==================== 统计信息 ====================

  /**
   * 获取统计信息
   */
  getStats(): AgentStats {
    const agents = this.getAllAgents();
    const byStatus: Record<AgentExecutionStatus, number> = {
      spawning: 0,
      idle: 0,
      thinking: 0,
      executing: 0,
      waiting: 0,
      error: 0,
      terminated: 0,
    };
    const byRole: Record<string, number> = {};
    let totalActions = 0;
    let errorCount = 0;

    agents.forEach(agent => {
      byStatus[agent.status]++;
      byRole[agent.role] = (byRole[agent.role] || 0) + 1;
      totalActions += agent.actionCount;
      if (agent.status === 'error') errorCount++;
    });

    return {
      total: agents.length,
      byStatus,
      byRole,
      activeCount: agents.filter(a => a.status !== 'idle' && a.status !== 'terminated').length,
      errorCount,
      avgActionCount: agents.length > 0 ? totalActions / agents.length : 0,
    };
  }

  /**
   * 获取 Agent 数量
   */
  getAgentCount(): number {
    return this.agents.size;
  }

  // ==================== 清理 ====================

  /**
   * 增加 Agent 动作计数
   */
  incrementActionCount(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.actionCount++;
      agent.lastEventAt = Date.now();
    }
  }

  /**
   * 添加记忆 ID
   */
  addMemoryId(agentId: string, memoryId: string): void {
    const agent = this.agents.get(agentId);
    if (agent && !agent.memoryIds.includes(memoryId)) {
      agent.memoryIds.push(memoryId);
    }
  }

  /**
   * 重置状态管理器
   */
  reset(): void {
    this.agents.clear();
    this.eventLog = [];
    this.snapshots = [];
    this.initializeIndexes();
    this.emit('state:reset');
  }

  /**
   * 销毁状态管理器
   */
  destroy(): void {
    this.stopSnapshotTimer();
    this.removeAllListeners();
    this.reset();
  }
}

/**
 * 全局单例（可选）
 */
let globalStateManager: UnifiedStateManager | undefined;

export function getGlobalStateManager(): UnifiedStateManager {
  if (!globalStateManager) {
    globalStateManager = new UnifiedStateManager();
  }
  return globalStateManager;
}

export function resetGlobalStateManager(): void {
  globalStateManager?.destroy();
  globalStateManager = undefined;
}
