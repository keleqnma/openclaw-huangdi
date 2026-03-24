/**
 * WebSocket 消息协议 - 统一客户端与服务器通信格式
 */

import type { TimelineEvent } from './events';
import type { UnifiedAgentState } from './UnifiedAgentState';
import type { ReplayState } from '../dashboard/types';

// ==================== 客户端消息 ====================

/**
 * 客户端消息类型
 */
export type ClientMessageType =
  // 通用消息
  | 'ping'
  | 'pong'

  // Dashboard 消息
  | 'fetch_events'
  | 'replay_control'
  | 'fetch_logs'

  // 订阅消息
  | 'subscribe'
  | 'unsubscribe'

  // 终端操作
  | 'terminal:write'
  | 'terminal:resize'

  // Agent 操作
  | 'agent:ping'
  | 'workspace:refresh';

/**
 * 客户端消息接口
 */
export interface ClientMessage {
  type: ClientMessageType;
  payload: ClientMessagePayload;
}

/**
 * 客户端消息负载
 */
export interface ClientMessagePayload {
  // ping/pong
  timestamp?: number;

  // fetch_events
  since?: number;
  agentId?: string;
  limit?: number;

  // replay_control
  action?: 'play' | 'pause' | 'stop' | 'seek';
  speed?: number;
  from?: number;
  to?: number;

  // subscribe/unsubscribe
  channel?: string;

  // terminal:write
  data?: string;

  // terminal:resize
  rows?: number;
  cols?: number;
}

// ==================== 服务器消息 ====================

/**
 * 服务器消息类型
 */
export type ServerMessageType =
  // 连接管理
  | 'connected'
  | 'disconnected'
  | 'error'

  // 数据同步
  | 'sync'
  | 'event'
  | 'events'
  | 'logs'

  // 订阅确认
  | 'subscribed'
  | 'unsubscribed'

  // 重放控制
  | 'replay_state'

  // Agent 事件
  | 'agent:update'
  | 'agent:status'
  | 'agent:action'
  | 'agent:thinking'
  | 'agent:heartbeat'

  // 任务事件
  | 'task:created'
  | 'task:updated'
  | 'task:completed'
  | 'task:failed'

  // 任务看板
  | 'taskboard:update'
  | 'taskboard:message'
  | 'taskboard:alert'

  // 聊天
  | 'chat:message'

  // 终端
  | 'terminal:output'

  // 响应
  | 'pong';

/**
 * 服务器消息接口
 */
export interface ServerMessage {
  type: ServerMessageType;
  payload?: ServerMessagePayload;
  events?: TimelineEvent[];
  agents?: UnifiedAgentState[];
  replayState?: ReplayState;
}

/**
 * 服务器消息负载
 */
export type ServerMessagePayload =
  // 连接管理
  | {
      message?: string;
      clientId?: string;
      serverTime?: number;
    }

  // 错误
  | {
      message: string;
      code?: string;
      details?: any;
    }

  // 订阅确认
  | {
      channel: string;
    }

  // Agent 状态
  | {
      agent: UnifiedAgentState;
    }

  // Agent 状态变化
  | {
      agentId: string;
      status: string;
      detail?: string;
      timestamp: number;
    }

  // Agent 动作
  | {
      agentId: string;
      actionType: string;
      payload?: any;
      timestamp: number;
    }

  // Agent 思考
  | {
      agentId: string;
      thought: string;
      taskId?: string;
      timestamp: number;
    }

  // 任务事件
  | {
      task: any;
    }

  // 任务看板
  | {
      eventType: string;
      task: any;
    }

  // 任务看板消息
  | {
      taskId: string;
      message: any;
    }

  // 任务告警
  | {
      alertType: 'overdue' | 'stalled';
      task: any;
    }

  // 聊天消息
  | {
      message: any;
    }

  // 终端输出
  | {
      sessionId: string;
      output: string;
      timestamp: number;
    }

  // 心跳
  | {
      timestamp: number;
    }

  // 事件消息
  | {
      event: TimelineEvent;
    };

// ==================== 频道定义 ====================

/**
 * 预定义频道
 */
export const Channels = {
  // Agent 频道
  agent: (agentId: string) => `agent:${agentId}`,

  // 任务频道
  task: (taskId: string) => `task:${taskId}`,

  // 任务看板
  taskboard: 'taskboard',

  // 聊天频道
  chat: (userId?: string) => (userId ? `chat:${userId}` : 'chat:global'),

  // 终端频道
  terminal: (sessionId: string) => `terminal:${sessionId}`,

  // 系统频道
  system: 'system',
} as const;

// ==================== 消息创建辅助函数 ====================

/**
 * 创建客户端消息
 */
export function createClientMessage(
  type: ClientMessageType,
  payload: ClientMessagePayload = {}
): ClientMessage {
  return { type, payload };
}

/**
 * 创建服务器消息
 */
export function createServerMessage(
  type: ServerMessageType,
  payload?: ServerMessagePayload
): ServerMessage {
  return { type, payload: payload || {} };
}

/**
 * 创建事件消息
 */
export function createEventMessage(event: TimelineEvent): ServerMessage {
  return {
    type: 'event',
    payload: { event },
  };
}

/**
 * 创建同步消息
 */
export function createSyncMessage(
  agents: UnifiedAgentState[],
  events: TimelineEvent[]
): ServerMessage {
  return {
    type: 'sync',
    agents,
    events,
  };
}

/**
 * 创建错误消息
 */
export function createErrorMessage(
  message: string,
  code?: string,
  details?: any
): ServerMessage {
  return {
    type: 'error',
    payload: { message, code, details },
  };
}

// ==================== 消息验证 ====================

/**
 * 验证客户端消息格式
 */
export function isValidClientMessage(data: any): data is ClientMessage {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.type !== 'string') return false;

  const validTypes: string[] = [
    'ping', 'pong',
    'fetch_events', 'replay_control', 'fetch_logs',
    'subscribe', 'unsubscribe',
    'terminal:write', 'terminal:resize',
    'agent:ping', 'workspace:refresh',
  ];

  return validTypes.includes(data.type);
}

/**
 * 验证服务器消息格式
 */
export function isValidServerMessage(data: any): data is ServerMessage {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.type !== 'string') return false;

  const validTypes: string[] = [
    'connected', 'disconnected', 'error',
    'sync', 'event', 'events', 'logs',
    'subscribed', 'unsubscribed',
    'replay_state',
    'agent:update', 'agent:status', 'agent:action', 'agent:thinking', 'agent:heartbeat',
    'task:created', 'task:updated', 'task:completed', 'task:failed',
    'taskboard:update', 'taskboard:message', 'taskboard:alert',
    'chat:message',
    'terminal:output',
    'pong',
  ];

  return validTypes.includes(data.type);
}
