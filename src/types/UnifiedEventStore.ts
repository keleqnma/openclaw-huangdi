/**
 * Unified Event Store - 统一事件存储
 *
 * 合并 EventStore 和 ActionLogger 的功能：
 * - 支持 DashboardEvent 和 AgentAction 的统一存储
 * - 提供事件索引（按 agentId、taskId）
 * - 支持 EventEmitter 实时推送
 * - 支持重放控制（ReplayState）
 */

import { EventEmitter } from 'events';
import type { ReplayState } from '../dashboard/types';
import type { TimelineEvent, EventFilter, AgentActionType } from './events';
import { filterEvents } from './events';

export interface UnifiedEventStoreStats {
  totalEvents: number;
  byAgent: Map<string, number>;
  byType: Map<string, number>;
  byLevel: Map<string, number>;
}

export class UnifiedEventStore extends EventEmitter {
  private events: TimelineEvent[] = [];
  private byId: Map<string, TimelineEvent> = new Map();
  private byAgentId: Map<string, Set<string>> = new Map(); // agentId -> Set<eventIds>
  private byTaskId: Map<string, Set<string>> = new Map(); // taskId -> Set<eventIds>
  private maxEvents: number;
  private replayState: ReplayState = {
    isPlaying: false,
    speed: 1,
    currentPosition: Date.now(),
  };

  constructor(maxEvents: number = 10000) {
    super();
    this.maxEvents = maxEvents;
  }

  /**
   * 添加事件
   */
  add(event: TimelineEvent): void {
    // 如果事件已存在，更新它
    if (this.byId.has(event.id)) {
      this.update(event);
      return;
    }

    // 存储事件
    this.events.push(event);
    this.byId.set(event.id, event);

    // 索引到 agentId
    if (event.agentId) {
      if (!this.byAgentId.has(event.agentId)) {
        this.byAgentId.set(event.agentId, new Set());
      }
      this.byAgentId.get(event.agentId)!.add(event.id);
    }

    // 索引到 taskId
    if (event.taskId) {
      if (!this.byTaskId.has(event.taskId)) {
        this.byTaskId.set(event.taskId, new Set());
      }
      this.byTaskId.get(event.taskId)!.add(event.id);
    }

    // 触发事件（用于 WebSocket 推送）
    this.emit('event', event);
    this.emit(`event:${event.type}`, event);

    // 按 agentId 触发
    if (event.agentId) {
      this.emit(`event:agent:${event.agentId}`, event);
    }

    // 清理过期事件
    this.cleanup();
  }

  /**
   * 批量添加事件
   */
  addBatch(events: TimelineEvent[]): void {
    for (const event of events) {
      this.add(event);
    }
  }

  /**
   * 更新现有事件
   */
  update(event: TimelineEvent): TimelineEvent | undefined {
    const existing = this.byId.get(event.id);
    if (!existing) return undefined;

    // 合并事件数据
    const merged: TimelineEvent = {
      ...existing,
      ...event,
      timestamp: event.timestamp || existing.timestamp,
    };

    this.byId.set(event.id, merged);

    // 在 events 数组中更新
    const index = this.events.findIndex(e => e.id === event.id);
    if (index >= 0) {
      this.events[index] = merged;
    }

    this.emit('event:updated', merged);
    return merged;
  }

  /**
   * 通过 ID 获取事件
   */
  getById(eventId: string): TimelineEvent | undefined {
    return this.byId.get(eventId);
  }

  /**
   * 获取某个时间点之后的事件
   */
  getEventsSince(since: number, agentId?: string): TimelineEvent[] {
    return this.events.filter(event => {
      const timeMatch = event.timestamp >= since;
      const agentMatch = agentId ? event.agentId === agentId : true;
      return timeMatch && agentMatch;
    });
  }

  /**
   * 获取所有事件
   */
  getAllEvents(): TimelineEvent[] {
    return [...this.events];
  }

  /**
   * 获取时间范围内的事件
   */
  getEventsInRange(from: number, to: number): TimelineEvent[] {
    return this.events.filter(
      event => event.timestamp >= from && event.timestamp <= to
    );
  }

  /**
   * 使用过滤器获取事件
   */
  getFilteredEvents(filter: EventFilter): TimelineEvent[] {
    return filterEvents(this.events, filter);
  }

  /**
   * 获取 Agent 相关的事件
   */
  getEventsByAgent(agentId: string, limit?: number): TimelineEvent[] {
    const eventIds = this.byAgentId.get(agentId);
    if (!eventIds) return [];

    let events = Array.from(eventIds)
      .map(id => this.byId.get(id))
      .filter((e): e is TimelineEvent => !!e);

    // 按时间排序（最新的在前）
    events.sort((a, b) => b.timestamp - a.timestamp);

    if (limit) {
      events = events.slice(0, limit);
    }

    return events;
  }

  /**
   * 获取任务相关的事件
   */
  getEventsByTask(taskId: string, limit?: number): TimelineEvent[] {
    const eventIds = this.byTaskId.get(taskId);
    if (!eventIds) return [];

    let events = Array.from(eventIds)
      .map(id => this.byId.get(id))
      .filter((e): e is TimelineEvent => !!e);

    // 按时间排序（最新的在前）
    events.sort((a, b) => b.timestamp - a.timestamp);

    if (limit) {
      events = events.slice(0, limit);
    }

    return events;
  }

  /**
   * 获取 Agent 最新状态
   */
  getAgentStatus(agentId: string): {
    status: string;
    lastEvent?: TimelineEvent;
    lastEventTime?: number;
  } {
    const events = this.getEventsByAgent(agentId, 1);
    const lastEvent = events[0];

    if (!lastEvent) {
      return { status: 'unknown' };
    }

    // 从事件类型推断状态
    let status = 'unknown';
    if (lastEvent.type === 'agent:thinking') {
      status = 'thinking';
    } else if (lastEvent.type === 'agent:status' && lastEvent.details?.status) {
      status = lastEvent.details.status;
    } else if (lastEvent.type === 'agent:action') {
      status = 'working';
    } else {
      status = 'idle';
    }

    return {
      status,
      lastEvent,
      lastEventTime: lastEvent.timestamp,
    };
  }

  /**
   * 更新重放状态
   */
  updateReplayState(update: Partial<ReplayState>): void {
    this.replayState = { ...this.replayState, ...update };
  }

  /**
   * 获取当前重放状态
   */
  getReplayState(): ReplayState {
    return { ...this.replayState };
  }

  /**
   * 获取下一个要重放的事件
   */
  getNextReplayEvent(): TimelineEvent | undefined {
    if (!this.replayState.isPlaying) return undefined;

    const { from, to, currentPosition } = this.replayState;
    if (!from || !to) return undefined;

    // 查找当前位置之后的下一个事件
    const nextEvent = this.events.find(
      event => event.timestamp > currentPosition && event.timestamp <= to
    );

    return nextEvent;
  }

  /**
   * 计算重放 tick 间隔
   */
  getReplayTickInterval(): number {
    const baseInterval = 1000; // 1 second base
    return baseInterval / this.replayState.speed;
  }

  /**
   * 清理过期事件
   */
  cleanup(): void {
    if (this.events.length <= this.maxEvents) {
      return;
    }

    // 按时间排序
    const sorted = [...this.events].sort((a, b) => a.timestamp - b.timestamp);

    // 删除最早的事件
    const toDelete = sorted.slice(0, sorted.length - this.maxEvents);
    for (const event of toDelete) {
      this.byId.delete(event.id);

      // 清理索引
      if (event.agentId) {
        const agentEvents = this.byAgentId.get(event.agentId);
        if (agentEvents) {
          agentEvents.delete(event.id);
          if (agentEvents.size === 0) {
            this.byAgentId.delete(event.agentId);
          }
        }
      }

      if (event.taskId) {
        const taskEvents = this.byTaskId.get(event.taskId);
        if (taskEvents) {
          taskEvents.delete(event.id);
          if (taskEvents.size === 0) {
            this.byTaskId.delete(event.taskId);
          }
        }
      }

      // 从主数组删除
      const index = this.events.findIndex(e => e.id === event.id);
      if (index >= 0) {
        this.events.splice(index, 1);
      }
    }
  }

  /**
   * 清空事件
   */
  clear(agentId?: string): void {
    if (agentId) {
      // 清空指定 Agent 的事件
      const eventIds = this.byAgentId.get(agentId);
      if (eventIds) {
        for (const id of eventIds) {
          const event = this.byId.get(id);
          if (event?.taskId) {
            const taskEvents = this.byTaskId.get(event.taskId);
            if (taskEvents) {
              taskEvents.delete(id);
              if (taskEvents.size === 0) {
                this.byTaskId.delete(event.taskId);
              }
            }
          }
          this.byId.delete(id);
        }
        this.byAgentId.delete(agentId);

        // 从主数组删除
        this.events = this.events.filter(e => e.agentId !== agentId);
      }
    } else {
      // 清空所有事件
      this.events = [];
      this.byId.clear();
      this.byAgentId.clear();
      this.byTaskId.clear();
    }

    // 重置重放状态
    this.replayState = {
      isPlaying: false,
      speed: 1,
      currentPosition: Date.now(),
    };
  }

  /**
   * 获取统计信息
   */
  getStats(): UnifiedEventStoreStats {
    const byAgent = new Map<string, number>();
    const byType = new Map<string, number>();
    const byLevel = new Map<string, number>();

    for (const event of this.events) {
      // By Agent
      if (event.agentId) {
        byAgent.set(event.agentId, (byAgent.get(event.agentId) || 0) + 1);
      }

      // By Type
      byType.set(event.type, (byType.get(event.type) || 0) + 1);

      // By Level
      byLevel.set(event.level, (byLevel.get(event.level) || 0) + 1);
    }

    return {
      totalEvents: this.events.length,
      byAgent,
      byType,
      byLevel,
    };
  }
}
