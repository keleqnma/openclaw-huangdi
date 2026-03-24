/**
 * Unified Event Types - 统一事件类型定义
 *
 * 整合 DashboardEvent 和 AgentAction，提供统一的时间线事件接口
 */

/**
 * 统一事件类型
 */
export type TimelineEventType =
  // Agent 相关事件
  | 'agent:action'         // Agent 动作
  | 'agent:thinking'       // Agent 思考
  | 'agent:status'         // Agent 状态变化
  | 'agent:created'        // Agent 创建
  | 'agent:removed'        // Agent 移除

  // 任务相关事件
  | 'task:created'         // 任务创建
  | 'task:started'         // 任务开始
  | 'task:updated'         // 任务更新
  | 'task:completed'       // 任务完成
  | 'task:failed'          // 任务失败

  // 终端相关事件
  | 'terminal:output'      // 终端输出
  | 'terminal:resize'      // 终端尺寸调整

  // 聊天相关事件
  | 'chat:message'         // 聊天消息

  // 系统相关事件
  | 'system:heartbeat'     // 系统心跳
  | 'system:error'         // 系统错误
  | 'system:info';         // 系统信息

/**
 * 事件级别
 */
export type EventLevel = 'debug' | 'info' | 'warning' | 'error';

/**
 * 统一时间线事件接口
 */
export interface TimelineEvent {
  /** 事件唯一 ID */
  id: string;

  /** 事件类型 */
  type: TimelineEventType;

  /** 事件发生时间戳 */
  timestamp: number;

  /** 关联的 Agent ID */
  agentId?: string;

  /** 关联的任务 ID */
  taskId?: string;

  /** 关联的会话 ID */
  sessionId?: string;

  /** 事件摘要（用于总览视图） */
  summary: string;

  /** 事件详细数据（用于调试视图） */
  details?: Record<string, any>;

  /** 事件级别 */
  level: EventLevel;

  /** 关联操作 ID（用于追踪相关操作） */
  correlationId?: string;

  /** 事件来源 */
  source?: 'dashboard' | 'orchestrator' | 'openclaw' | 'user';
}

/**
 * Agent 动作类型（兼容原有的 AgentAction）
 */
export type AgentActionType =
  | 'command_exec'      // 执行命令
  | 'file_read'        // 读取文件
  | 'file_write'       // 写入文件
  | 'file_delete'      // 删除文件
  | 'message_sent'     // 发送消息
  | 'task_claimed'     // 认领任务
  | 'task_released'    // 释放任务
  | 'task_assigned'    // 分配任务
  | 'status_change'    // 状态变更
  | 'thinking'         // 思考中
  | 'idle';            // 空闲

/**
 * Agent 动作事件
 */
export interface AgentActionEvent extends TimelineEvent {
  type: 'agent:action';
  details: {
    actionType: AgentActionType;
    payload: Record<string, any>;
    duration?: number;
    result?: 'success' | 'failure' | 'pending';
  };
}

/**
 * Agent 思考事件
 */
export interface AgentThinkingEvent extends TimelineEvent {
  type: 'agent:thinking';
  details: {
    thought: string;
    taskId?: string;
  };
}

/**
 * Agent 状态事件
 */
export interface AgentStatusEvent extends TimelineEvent {
  type: 'agent:status';
  details: {
    status: 'thinking' | 'working' | 'idle' | 'error' | 'running' | 'executing';
    detail?: string;
  };
}

/**
 * 任务事件
 */
export interface TaskEvent extends TimelineEvent {
  type: 'task:created' | 'task:started' | 'task:updated' | 'task:completed' | 'task:failed';
  details: {
    task: {
      id: string;
      title: string;
      description: string;
      status: string;
      priority: string;
      [key: string]: any;
    };
  };
}

/**
 * 终端输出事件
 */
export interface TerminalOutputEvent extends TimelineEvent {
  type: 'terminal:output';
  details: {
    sessionId: string;
    output: string;
    timestamp: number;
  };
}

/**
 * 聊天消息事件
 */
export interface ChatMessageEvent extends TimelineEvent {
  type: 'chat:message';
  details: {
    from: string;
    to?: string;
    content: string;
    mentions?: string[];
    isFromUser: boolean;
  };
}

/**
 * 从 AgentAction 创建 TimelineEvent
 */
export function createTimelineEventFromAction(action: {
  id: string;
  timestamp: number;
  agentId: string;
  taskId?: string;
  actionType: AgentActionType;
  payload: Record<string, any>;
  duration?: number;
  result?: 'success' | 'failure' | 'pending';
  sessionId?: string;
  correlationId?: string;
}): TimelineEvent {
  const event: AgentActionEvent = {
    id: action.id,
    type: 'agent:action',
    timestamp: action.timestamp,
    agentId: action.agentId,
    taskId: action.taskId,
    sessionId: action.sessionId,
    summary: formatActionSummary(action.actionType, action.payload),
    details: {
      actionType: action.actionType,
      payload: action.payload,
      duration: action.duration,
      result: action.result,
    },
    level: action.result === 'failure' ? 'error' : 'info',
    correlationId: action.correlationId,
    source: 'orchestrator',
  };

  return event;
}

/**
 * 从 DashboardEvent 创建 TimelineEvent
 */
export function createTimelineEventFromDashboardEvent(event: {
  id: string;
  type: string;
  timestamp: number;
  agentId?: string;
  payload: any;
}): TimelineEvent {
  const type = mapDashboardEventType(event.type);

  return {
    id: event.id,
    type,
    timestamp: event.timestamp,
    agentId: event.agentId,
    summary: formatEventSummary(type, event.payload),
    details: event.payload,
    level: event.type.includes('error') || event.type.includes('failed') ? 'error' : 'info',
    source: 'dashboard',
  };
}

/**
 * 映射 DashboardEvent 类型到 TimelineEventType
 */
function mapDashboardEventType(type: string): TimelineEventType {
  const mapping: Record<string, TimelineEventType> = {
    'agent:update': 'agent:status',
    'agent:action': 'agent:action',
    'agent:thinking': 'agent:thinking',
    'agent:status': 'agent:status',
    'agent:created': 'agent:created',
    'agent:removed': 'agent:removed',
    'terminal:output': 'terminal:output',
    'task:started': 'task:started',
    'task:completed': 'task:completed',
    'task:failed': 'task:failed',
    'task:created': 'task:created',
    'task:updated': 'task:updated',
    'chat:message': 'chat:message',
    'agent:heartbeat': 'system:heartbeat',
  };

  return mapping[type] || 'system:info';
}

/**
 * 格式化动作摘要
 */
function formatActionSummary(actionType: AgentActionType, payload: Record<string, any>): string {
  const summaries: Record<AgentActionType, string> = {
    command_exec: `执行命令：${payload.command || 'unknown'}`,
    file_read: `读取文件：${payload.path || 'unknown'}`,
    file_write: `写入文件：${payload.path || 'unknown'}`,
    file_delete: `删除文件：${payload.path || 'unknown'}`,
    message_sent: `发送消息`,
    task_claimed: `认领任务`,
    task_released: `释放任务`,
    task_assigned: `分配任务`,
    status_change: `状态变更`,
    thinking: `思考中`,
    idle: `空闲`,
  };

  return summaries[actionType] || actionType;
}

/**
 * 格式化事件摘要
 */
function formatEventSummary(type: TimelineEventType, payload: any): string {
  switch (type) {
    case 'agent:created':
      return `Agent 创建：${payload?.id || 'unknown'}`;
    case 'agent:removed':
      return `Agent 移除：${payload?.id || 'unknown'}`;
    case 'task:created':
      return `任务创建：${payload?.task?.title || 'unknown'}`;
    case 'task:started':
      return `任务开始：${payload?.task?.title || 'unknown'}`;
    case 'task:completed':
      return `任务完成：${payload?.task?.title || 'unknown'}`;
    case 'task:failed':
      return `任务失败：${payload?.task?.title || 'unknown'}`;
    case 'terminal:output':
      return `终端输出`;
    case 'chat:message':
      return `聊天消息：${payload?.from || 'unknown'}`;
    default:
      return type;
  }
}

/**
 * 事件过滤器
 */
export interface EventFilter {
  /** 事件类型过滤 */
  types?: TimelineEventType[];

  /** 事件级别过滤 */
  levels?: EventLevel[];

  /** Agent ID 过滤 */
  agentId?: string;

  /** 任务 ID 过滤 */
  taskId?: string;

  /** 时间范围起始 */
  from?: number;

  /** 时间范围结束 */
  to?: number;

  /** 关键词搜索 */
  search?: string;
}

/**
 * 过滤事件列表
 */
export function filterEvents(events: TimelineEvent[], filter: EventFilter): TimelineEvent[] {
  return events.filter(event => {
    // 类型过滤
    if (filter.types && !filter.types.includes(event.type)) {
      return false;
    }

    // 级别过滤
    if (filter.levels && !filter.levels.includes(event.level)) {
      return false;
    }

    // Agent ID 过滤
    if (filter.agentId && event.agentId !== filter.agentId) {
      return false;
    }

    // 任务 ID 过滤
    if (filter.taskId && event.taskId !== filter.taskId) {
      return false;
    }

    // 时间范围过滤
    if (filter.from && event.timestamp < filter.from) {
      return false;
    }
    if (filter.to && event.timestamp > filter.to) {
      return false;
    }

    // 关键词搜索
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      const searchable = `${event.summary} ${JSON.stringify(event.details)}`.toLowerCase();
      if (!searchable.includes(searchLower)) {
        return false;
      }
    }

    return true;
  });
}
