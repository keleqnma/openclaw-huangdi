/**
 * Huangdi Orchestrator - Terminal Multi-Agent Service
 *
 * 本地跨平台终端多 Agent 服务
 */

// Terminal exports
export { TerminalService } from './terminal/TerminalService';
export { ProcessRegistry } from './terminal/ProcessRegistry';
export type * from './terminal/types';

// Sandbox exports
export { SandboxManager } from './sandbox/SandboxManager';
export { PathSecurity } from './sandbox/PathSecurity';
export { CommandSecurity } from './sandbox/CommandSecurity';
export type * from './sandbox/types';

// Agent exports
export { AgentOrchestrator } from './agent/AgentOrchestrator';

// Task exports (explicitly re-export to avoid conflicts)
export { TaskBoardManager } from './task/TaskBoardManager';
export { MonitorAgent } from './task/MonitorAgent';
export type {
  Task,
  TaskStatus,
  TaskPriority,
  TaskMessage,
  TaskMessageType,
  TaskBoard,
  TaskFilter,
  CreateTaskParams,
} from './task/types';

// API exports
export { createRoutes } from './api/routes';
export { createTaskBoardRoutes } from './api/taskRoutes';
export { ApiWebSocketServer } from './api/WebSocketServer';

// Service exports
export { MultiAgentService } from './service/MultiAgentService';
export type { MultiAgentServiceConfig } from './service/MultiAgentService';

// Version
export const VERSION = '0.2.0';
