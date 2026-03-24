/**
 * Unified Agent State - 统一 Agent 状态定义
 *
 * 整合 Dashboard AgentState 和 Orchestrator Agent 状态，
 * 提供跨模块的统一状态管理。
 */

import type { RoleId } from '../dashboard/types';
import type { TimelineEvent } from './events';

/**
 * Agent 运行状态
 */
export type AgentExecutionStatus =
  | 'spawning'      // 即将启动
  | 'idle'          // 空闲
  | 'thinking'      // 思考中
  | 'executing'     // 执行命令中
  | 'waiting'       // 等待中（如等待子 Agent 完成）
  | 'error'         // 出错
  | 'terminated';   // 已终止

/**
 * 统一 Agent 状态接口
 */
export interface UnifiedAgentState {
  /** Agent 唯一 ID */
  id: string;

  /** 角色类型 */
  role: RoleId | string;

  /** 执行状态 */
  status: AgentExecutionStatus;

  /** 当前任务 ID */
  currentTaskId?: string;

  /** 任务描述 */
  taskDescription?: string;

  /** 最后事件时间戳 */
  lastEventAt: number;

  /** 动作计数器 */
  actionCount: number;

  /** 关联的运行 ID (子 Agent session key) */
  runId?: string;

  /** 关联的会话 Key */
  sessionKey?: string;

  /** 关联的 Session ID */
  sessionId?: string;

  /** 记忆 ID 列表 */
  memoryIds: string[];

  /** 上下文层次 */
  context: {
    /** 全局上下文 ID 列表 */
    global: string[];
    /** 团队上下文 ID 列表 */
    team: string[];
    /** 本地上下文 ID 列表 */
    local: string[];
  };

  /** 配置信息 */
  config: {
    systemPrompt?: string;
    customInstructions?: string;
    memory?: string;
  };

  /** 启动时间 */
  startedAt: number;

  /** 结束时间（如果有） */
  endedAt?: number;

  /** 错误信息（如果有） */
  error?: string;

  /** 标签（用户自定义） */
  label?: string;
}

/**
 * Agent 状态变更事件
 */
export interface StateChangeEvent {
  agentId: string;
  from: AgentExecutionStatus;
  to: AgentExecutionStatus;
  timestamp: number;
  reason?: string;
}

/**
 * 状态快照
 */
export interface StateSnapshot {
  /** 快照时间戳 */
  timestamp: number;

  /** 所有 Agent 状态 */
  agents: Map<string, UnifiedAgentState>;

  /** 事件数量 */
  eventCount: number;
}

/**
 * 状态查询选项
 */
export interface StateQueryOptions {
  /** 按状态过滤 */
  status?: AgentExecutionStatus[];

  /** 按角色过滤 */
  role?: string[];

  /** 按任务 ID 过滤 */
  taskId?: string;

  /** 搜索关键词 */
  search?: string;
}

/**
 * Agent 统计信息
 */
export interface AgentStats {
  total: number;
  byStatus: Record<AgentExecutionStatus, number>;
  byRole: Record<string, number>;
  activeCount: number;
  errorCount: number;
  avgActionCount: number;
}
