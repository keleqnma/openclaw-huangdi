/**
 * Huangdi Dashboard - Type Definitions
 */

/** Agent status types */
export type AgentStatus =
  | 'spawning'    // 即将启动
  | 'idle'        // 空闲
  | 'thinking'    // 思考中
  | 'working'     // 工作中
  | 'waiting'     // 等待中
  | 'completed'   // 已完成
  | 'error';      // 出错

/** Role types based on RoleRouter */
export type RoleId =
  | 'researcher'  // 研究专家
  | 'coder'       // 编程专家
  | 'reviewer'    // 代码审核
  | 'tester'      // 测试专家
  | 'writer'      // 内容作家
  | 'planner';    // 任务规划

/** Dashboard event types */
export type DashboardEventType =
  | 'agent_spawning'
  | 'agent_spawned'
  | 'agent_status_change'
  | 'agent_message'
  | 'agent_ended';

/** Message entry from subagent session */
export interface MessageEntry {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  type: 'input' | 'output' | 'tool_result' | 'error';
  metadata?: {
    toolName?: string;
    toolCallId?: string;
  };
}

/** Agent state tracked by dashboard */
export interface AgentState {
  runId: string;              // 子 agent 运行 ID
  sessionKey: string;         // 子 agent 会话 key
  roleId: RoleId;             // 角色 ID
  label?: string;             // 用户自定义标签
  status: AgentStatus;        // 当前状态
  task?: string;              // 当前任务描述
  input?: string;             // 最新输入
  output?: string;            // 最新输出
  messages: MessageEntry[];   // 消息历史
  startTime: number;          // 启动时间戳
  endTime?: number;           // 结束时间戳
  avatar: AvatarConfig;       // 头像配置
}

/** Avatar configuration for agent visualization */
export interface AvatarConfig {
  roleId: RoleId;             // 角色 ID
  emoji: string;              // 表情符号
  color: string;              // 主题色
  variant: number;            // 变体编号（用于同角色不同外观）
}

/** Dashboard event for timeline/replay */
export interface DashboardEvent {
  id: string;                 // 事件 ID (UUID)
  type: DashboardEventType;
  timestamp: number;          // 事件发生时间
  agentId: string;            // 关联的 agent runId
  payload: EventPayload;
}

/** Event payload - variant by type */
export interface EventPayload {
  // agent_spawning
  spawningStatus?: 'spawning';

  // agent_spawned
  roleId?: RoleId;
  task?: string;

  // agent_status_change
  agentStatus?: AgentStatus;

  // agent_message
  message?: MessageEntry;

  // agent_ended
  outcome?: 'ok' | 'error' | 'timeout' | 'killed';
  error?: string;
}

/** WebSocket message: Server → Client */
export type ServerMessage =
  | { type: 'event'; event: import('../types/events').TimelineEvent }
  | { type: 'sync'; agents: AgentState[]; events: import('../types/events').TimelineEvent[] }
  | { type: 'heartbeat'; timestamp: number };

/** WebSocket message: Client → Server */
export type ClientMessage =
  | { type: 'fetch_events'; since: number; agentId?: string }
  | { type: 'replay_control'; action: 'play' | 'pause' | 'seek'; timestamp?: number; speed?: number }
  | { type: 'fetch_logs'; agentId: string; limit: number };

/** Dashboard configuration */
export interface DashboardConfig {
  port: number;           // 服务端口，默认 3456
  pollInterval: number;   // 轮询间隔 ms，默认 2000
  maxEvents: number;      // 最大事件存储数，默认 1000
  enableElectron: boolean; // 是否启用 Electron，默认 false
}

/** Replay control state */
export interface ReplayState {
  isPlaying: boolean;
  speed: number;          // 0.5 | 1 | 2 | 4
  currentPosition: number; // 当前时间戳
  from?: number;          // 回放起始
  to?: number;            // 回放结束
}
