/**
 * 终端多 Agent 服务 - 公共类型导出
 */

// Agent 类型
export type { AgentRole } from '../terminal/types';
export type { AgentConfig } from '../terminal/types';
export type { AgentRuntime } from '../terminal/types';
export type { Task } from '../terminal/types';

// 终端类型
export type { TerminalSession } from '../terminal/types';
export type { TerminalOutputEvent } from '../terminal/types';
export type { TerminalSize } from '../terminal/types';
export type { ShellConfig } from '../terminal/types';

// 沙箱类型
export type { SandboxMode } from '../sandbox/types';
export type { SandboxConfig } from '../sandbox/types';
export type { SandboxInstance } from '../sandbox/types';
export type { PathCheckResult } from '../sandbox/types';
export type { CommandCheckResult } from '../sandbox/types';

// 服务类型
export type { MultiAgentServiceConfig } from '../service/MultiAgentService';

// 统一事件类型
export type {
  TimelineEvent,
  TimelineEventType,
  EventLevel,
  EventFilter,
  AgentActionEvent,
  AgentThinkingEvent,
  AgentStatusEvent,
  TaskEvent,
  TerminalOutputEvent as TimelineTerminalOutputEvent,
  ChatMessageEvent,
} from './events';
export {
  createTimelineEventFromAction,
  createTimelineEventFromDashboardEvent,
  filterEvents,
} from './events';

// ID 映射表
export { AgentIdMapper } from './AgentIdMapper';
export type { AgentIdMapping } from './AgentIdMapper';

// 统一事件存储
export { UnifiedEventStore } from './UnifiedEventStore';
export type { UnifiedEventStoreStats } from './UnifiedEventStore';

// 统一状态管理器
export { UnifiedStateManager, getGlobalStateManager, resetGlobalStateManager } from './UnifiedStateManager';
export type { StateManagerConfig, StateManagerEvents } from './UnifiedStateManager';

// 统一 Agent 状态
export type { UnifiedAgentState, AgentExecutionStatus, StateSnapshot, StateQueryOptions, AgentStats } from './UnifiedAgentState';

// 统一 WebSocket 服务
export { UnifiedWebSocketServer } from './UnifiedWebSocketServer';
export type { UnifiedWebSocketServerConfig, WebSocketClient as UnifiedWebSocketClient } from './UnifiedWebSocketServer';
