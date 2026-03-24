/**
 * 任务协作模块 - 类型定义
 */

/**
 * 任务状态
 */
export type TaskStatus = 'pending' | 'claimed' | 'in-progress' | 'completed' | 'failed';

/**
 * 任务优先级
 */
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * 消息类型
 */
export type TaskMessageType = 'comment' | 'status-update' | 'handoff' | 'mention';

/**
 * 任务消息
 */
export interface TaskMessage {
  id: string;
  taskId: string;
  fromAgent: string;
  content: string;
  type: TaskMessageType;
  timestamp: number;
  mentions?: string[];  // @提及的 Agent
}

/**
 * 任务定义
 */
export interface Task {
  id: string;
  title: string;
  description: string;
  createdBy: string;           // 创建者 Agent ID
  assignedTo?: string;         // 定向指派给谁
  claimedBy?: string;          // 实际认领者
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: number;
  claimedAt?: number;
  startedAt?: number;
  completedAt?: number;
  dueAt?: number;              // 截止时间
  progress: number;            // 0-100
  messages: TaskMessage[];
  tags?: string[];
  dependencies?: string[];     // 依赖的其他任务 ID
  metadata?: Record<string, any>;
  statusHistory?: StatusChange[]; // 状态变更历史
}

/**
 * 状态变更记录
 */
export interface StatusChange {
  from: TaskStatus;
  to: TaskStatus;
  timestamp: number;
  agentId: string;
}

/**
 * 任务创建参数
 */
export interface CreateTaskParams {
  title: string;
  description: string;
  priority?: TaskPriority;
  assignedTo?: string;
  tags?: string[];
  dependencies?: string[];
  dueAt?: number;
}

/**
 * 任务看板
 */
export interface TaskBoard {
  tasks: Task[];
  total: number;
  byStatus: Record<TaskStatus, number>;
  byPriority: Record<TaskPriority, number>;
}

/**
 * 任务筛选条件
 */
export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  priority?: TaskPriority | TaskPriority[];
  claimedBy?: string;
  createdBy?: string;
  tags?: string[];
  search?: string;
}

// ============================================
// Agent Action 类型定义（用于实时动作追踪）
// ============================================

/**
 * Agent 动作类型
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
 * Agent 动作接口
 */
export interface AgentAction {
  id: string;
  timestamp: number;
  agentId: string;
  taskId?: string;
  actionType: AgentActionType;
  payload: Record<string, any>;  // 操作详情
  duration?: number;             // 操作耗时（毫秒）
  result?: 'success' | 'failure' | 'pending';
  correlationId?: string;        // 关联操作 ID
  sessionId?: string;            // 终端会话 ID（如果是命令执行）
}

/**
 * 聊天消息接口
 */
export interface ChatMessage {
  id: string;
  timestamp: number;
  from: string;                  // 发送者（用户或 Agent）
  to?: string;                   // 接收者（私聊时使用，undefined 表示全局）
  content: string;
  mentions?: string[];           // @提及的 Agent
  isFromUser: boolean;           // 是否来自用户
  relatedTaskId?: string;        // 关联的任务 ID
}

/**
 * Agent 配置接口
 */
export interface AgentConfigUpdate {
  memory?: string;               // Agent 记忆/上下文
  systemPrompt?: string;         // 系统提示词（人设）
  customInstructions?: string;   // 自定义指令
}
