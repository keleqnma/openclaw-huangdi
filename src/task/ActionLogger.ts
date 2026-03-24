/**
 * ActionLogger - Agent 动作记录器
 *
 * 统一记录和追踪所有 Agent 的操作
 * 支持实时查询和 WebSocket 推送
 *
 * 注：ActionLogger 现在使用 UnifiedEventStore 作为底层存储，
 * 保持向后兼容性的同时实现数据统一
 */

import { EventEmitter } from 'events';
import { AgentAction, AgentActionType } from './types';
import { TimelineEvent, createTimelineEventFromAction } from '../types/events';
import { UnifiedEventStore } from '../types/UnifiedEventStore';
import { getGlobalStateManager } from '../types/UnifiedStateManager';

export class ActionLogger extends EventEmitter {
  private actions: Map<string, AgentAction> = new Map(); // id -> action
  private agentActions: Map<string, string[]> = new Map(); // agentId -> [actionIds]
  private taskActions: Map<string, string[]> = new Map(); // taskId -> [actionIds]
  private timelineEvents: Map<string, TimelineEvent> = new Map(); // id -> timelineEvent
  private maxHistory: number = 10000;
  private actionCounter: number = 0;

  // 统一存储 (可选，用于数据同步)
  private unifiedEvents?: UnifiedEventStore;
  private unifiedState = getGlobalStateManager();

  constructor(useUnified: boolean = true) {
    super();
    if (useUnified) {
      this.unifiedEvents = new UnifiedEventStore(this.maxHistory);
    }
  }

  /**
   * 生成动作 ID
   */
  private generateActionId(): string {
    this.actionCounter++;
    return `action_${Date.now()}_${this.actionCounter}`;
  }

  /**
   * 记录动作
   */
  log(action: Omit<AgentAction, 'id' | 'timestamp'> & { id?: string }): AgentAction {
    const id = action.id || this.generateActionId();
    const timestamp = Date.now();

    const fullAction: AgentAction = {
      ...action,
      id,
      timestamp,
    };

    // 存储动作
    this.actions.set(id, fullAction);

    // 创建统一的 TimelineEvent
    const timelineEvent = createTimelineEventFromAction({
      id,
      timestamp,
      agentId: action.agentId,
      taskId: action.taskId,
      actionType: action.actionType,
      payload: action.payload,
      duration: action.duration,
      result: action.result,
      sessionId: action.sessionId,
      correlationId: action.correlationId,
    });
    this.timelineEvents.set(id, timelineEvent);

    // 索引到 Agent
    if (!this.agentActions.has(action.agentId)) {
      this.agentActions.set(action.agentId, []);
    }
    this.agentActions.get(action.agentId)!.push(id);

    // 索引到任务（如果有）
    if (action.taskId) {
      if (!this.taskActions.has(action.taskId)) {
        this.taskActions.set(action.taskId, []);
      }
      this.taskActions.get(action.taskId)!.push(id);
    }

    // 同步到统一事件存储
    if (this.unifiedEvents) {
      this.unifiedEvents.add(timelineEvent);
    }

    // 同步到统一状态管理器 (增加动作计数)
    this.unifiedState?.incrementActionCount(action.agentId);

    // 触发事件（用于 WebSocket 推送）
    this.emit('action', fullAction);
    this.emit('timeline-event', timelineEvent);

    // 清理过期动作
    this.cleanup();

    return fullAction;
  }

  /**
   * 开始一个动作（用于记录耗时）
   */
  start(
    agentId: string,
    actionType: AgentActionType,
    payload: Record<string, any>,
    taskId?: string
  ): string {
    const id = this.generateActionId();

    this.log({
      agentId,
      taskId,
      actionType,
      payload,
      result: 'pending',
      id,
      correlationId: id,
    });

    return id;
  }

  /**
   * 结束一个动作（更新结果和耗时）
   */
  end(
    correlationId: string,
    result: 'success' | 'failure',
    payload?: Record<string, any>,
    duration?: number
  ): AgentAction | undefined {
    const action = this.actions.get(correlationId);
    if (!action) return undefined;

    action.result = result;
    action.duration = duration || (Date.now() - action.timestamp);
    if (payload) {
      action.payload = { ...action.payload, ...payload };
    }

    this.emit('action:end', action);

    return action;
  }

  /**
   * 获取动作列表（支持筛选）
   */
  getActions(filter?: {
    agentId?: string;
    taskId?: string;
    actionType?: AgentActionType | AgentActionType[];
    since?: number;
    limit?: number;
  }): AgentAction[] {
    let actionIds: string[] = [];

    // 如果指定了 agentId，只获取该 Agent 的动作
    if (filter?.agentId) {
      const ids = this.agentActions.get(filter.agentId) || [];
      actionIds = [...ids];
    }
    // 如果指定了 taskId，只获取该任务相关的动作
    else if (filter?.taskId) {
      const ids = this.taskActions.get(filter.taskId) || [];
      actionIds = [...ids];
    }
    // 否则获取所有动作
    else {
      actionIds = Array.from(this.actions.keys());
    }

    // 获取动作对象
    let actions = actionIds
      .map(id => this.actions.get(id))
      .filter((a): a is AgentAction => !!a);

    // 按时间范围筛选
    if (filter?.since) {
      actions = actions.filter(a => a.timestamp >= filter.since!);
    }

    // 按动作类型筛选
    if (filter?.actionType) {
      const types = Array.isArray(filter.actionType) ? filter.actionType : [filter.actionType];
      actions = actions.filter(a => types.includes(a.actionType));
    }

    // 按时间排序（最新的在前）
    actions.sort((a, b) => b.timestamp - a.timestamp);

    // 限制数量
    if (filter?.limit) {
      actions = actions.slice(0, filter.limit);
    }

    return actions;
  }

  /**
   * 获取时间线事件列表（支持筛选）
   */
  getTimelineEvents(filter?: {
    agentId?: string;
    taskId?: string;
    since?: number;
    limit?: number;
  }): TimelineEvent[] {
    let eventIds: string[] = [];

    // 如果指定了 agentId，只获取该 Agent 的事件
    if (filter?.agentId) {
      const ids = this.agentActions.get(filter.agentId) || [];
      eventIds = [...ids];
    }
    // 如果指定了 taskId，只获取该任务相关的事件
    else if (filter?.taskId) {
      const ids = this.taskActions.get(filter.taskId) || [];
      eventIds = [...ids];
    }
    // 否则获取所有事件
    else {
      eventIds = Array.from(this.timelineEvents.keys());
    }

    // 获取事件对象
    let events = eventIds
      .map(id => this.timelineEvents.get(id))
      .filter((e): e is TimelineEvent => !!e);

    // 按时间范围筛选
    if (filter?.since) {
      events = events.filter(e => e.timestamp >= filter.since!);
    }

    // 按时间排序（最新的在前）
    events.sort((a, b) => b.timestamp - a.timestamp);

    // 限制数量
    if (filter?.limit) {
      events = events.slice(0, filter.limit);
    }

    return events;
  }

  /**
   * 获取 Agent 的最新状态
   */
  getAgentStatus(agentId: string): {
    status: 'thinking' | 'idle' | 'executing' | 'unknown';
    lastAction?: AgentAction;
    lastActionTime?: number;
  } {
    const actions = this.getActions({ agentId, limit: 1 });
    const lastAction = actions[0];

    if (!lastAction) {
      return { status: 'unknown' };
    }

    let status: 'thinking' | 'idle' | 'executing' = 'idle';
    if (lastAction.actionType === 'thinking') {
      status = 'thinking';
    } else if (lastAction.actionType === 'command_exec' && lastAction.result === 'pending') {
      status = 'executing';
    } else if (lastAction.actionType === 'idle') {
      status = 'idle';
    }

    return {
      status,
      lastAction,
      lastActionTime: lastAction.timestamp,
    };
  }

  /**
   * 清理过期动作
   */
  cleanup(): void {
    if (this.actions.size <= this.maxHistory) {
      return;
    }

    // 获取所有动作 ID，按时间排序
    const allIds = Array.from(this.actions.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .map(([id]) => id);

    // 删除最早的动作
    const toDelete = allIds.slice(0, allIds.length - this.maxHistory);
    for (const id of toDelete) {
      const action = this.actions.get(id)!;
      this.actions.delete(id);
      this.timelineEvents.delete(id);

      // 清理索引
      const agentIds = this.agentActions.get(action.agentId);
      if (agentIds) {
        const idx = agentIds.indexOf(id);
        if (idx >= 0) agentIds.splice(idx, 1);
      }

      if (action.taskId) {
        const taskIds = this.taskActions.get(action.taskId);
        if (taskIds) {
          const idx = taskIds.indexOf(id);
          if (idx >= 0) taskIds.splice(idx, 1);
        }
      }
    }
  }

  /**
   * 清空动作历史
   */
  clear(agentId?: string): void {
    if (agentId) {
      // 清空指定 Agent 的动作
      const actionIds = this.agentActions.get(agentId) || [];
      for (const id of actionIds) {
        const action = this.actions.get(id);
        if (action?.taskId) {
          const taskIds = this.taskActions.get(action.taskId);
          if (taskIds) {
            const idx = taskIds.indexOf(id);
            if (idx >= 0) taskIds.splice(idx, 1);
          }
        }
        this.actions.delete(id);
        this.timelineEvents.delete(id);
      }
      this.agentActions.delete(agentId);
    } else {
      // 清空所有动作
      this.actions.clear();
      this.agentActions.clear();
      this.taskActions.clear();
      this.timelineEvents.clear();
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalActions: number;
    byAgent: Map<string, number>;
    byType: Map<AgentActionType, number>;
    byResult: Map<string, number>;
  } {
    const byAgent = new Map<string, number>();
    const byType = new Map<AgentActionType, number>();
    const byResult = new Map<string, number>();

    for (const action of this.actions.values()) {
      byAgent.set(action.agentId, (byAgent.get(action.agentId) || 0) + 1);
      byType.set(action.actionType, (byType.get(action.actionType) || 0) + 1);
      byResult.set(action.result || 'unknown', (byResult.get(action.result || 'unknown') || 0) + 1);
    }

    return {
      totalActions: this.actions.size,
      byAgent,
      byType,
      byResult,
    };
  }

  /**
   * 记录思考状态
   */
  logThinking(agentId: string, thought: string, taskId?: string): void {
    this.log({
      agentId,
      actionType: 'thinking',
      payload: { thought },
      result: 'success',
      taskId,
    });
  }

  /**
   * 记录文件操作
   */
  logFileOp(
    agentId: string,
    opType: 'read' | 'write' | 'delete',
    filePath: string,
    taskId?: string,
    extra?: Record<string, any>
  ): void {
    const actionType: AgentActionType =
      opType === 'read' ? 'file_read' :
      opType === 'write' ? 'file_write' : 'file_delete';

    this.log({
      agentId,
      actionType,
      payload: { filePath, ...extra },
      result: 'success',
      taskId,
    });
  }

  /**
   * 记录任务操作
   */
  logTaskAction(
    agentId: string,
    taskAction: 'claimed' | 'released' | 'assigned',
    taskId: string,
    extra?: Record<string, any>
  ): void {
    const actionTypeMap: Record<string, AgentActionType> = {
      claimed: 'task_claimed',
      released: 'task_released',
      assigned: 'task_assigned',
    };

    this.log({
      agentId,
      actionType: actionTypeMap[taskAction],
      payload: { taskId, ...extra },
      result: 'success',
      taskId,
    });
  }

  /**
   * 记录消息发送
   */
  logMessageSent(agentId: string, content: string, to?: string): void {
    this.log({
      agentId,
      actionType: 'message_sent',
      payload: { content, to },
      result: 'success',
    });
  }

  /**
   * 记录状态变更
   */
  logStatusChange(
    agentId: string,
    fromStatus: string,
    toStatus: string,
    reason?: string
  ): void {
    this.log({
      agentId,
      actionType: 'status_change',
      payload: { fromStatus, toStatus, reason },
      result: 'success',
    });
  }

  /**
   * 设置 Agent 为空闲状态
   */
  logIdle(agentId: string): void {
    this.log({
      agentId,
      actionType: 'idle',
      payload: {},
      result: 'success',
    });
  }
}
