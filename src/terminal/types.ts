/**
 * 终端多 Agent 服务 - 类型定义
 */

/**
 * Agent 角色定义
 */
export type AgentRole =
  | 'researcher'    // 信息搜集、文档检索
  | 'coder'         // 代码编写、修改
  | 'reviewer'      // 代码审查、安全检查
  | 'tester'        // 测试执行、覆盖率分析
  | 'writer'        // 文档编写
  | 'planner'       // 任务规划、拆解
  | 'custom';       // 自定义角色

/**
 * Agent 配置接口
 */
export interface AgentConfig {
  id: string;                    // 唯一标识
  name: string;                  // 显示名称
  role: AgentRole;               // 角色
  description?: string;          // 角色描述

  // 执行配置
  command: string;               // 启动命令 (如：claude, npm run agent)
  args?: string[];               // 命令行参数
  cwd?: string;                  // 工作目录
  env?: Record<string, string>;  // 环境变量

  // 模型配置
  model?: {
    provider: 'anthropic' | 'openai' | 'ollama' | 'custom';
    model: string;               // 模型名称
    apiKey?: string;             // API Key
    baseUrl?: string;            // 自定义端点
  };

  // 沙箱配置
  sandbox?: {
    enabled: boolean;
    mode: 'docker' | 'podman' | 'chroot' | 'restricted';
    workspaceRoot?: string;
    allowedPaths?: string[];
    networkAccess?: boolean;
    resourceLimits?: {
      maxCpu?: number;
      maxMemory?: number;
      maxProcesses?: number;
    };
  };

  // 工具权限配置
  tools?: {
    allowed: string[];
    denied: string[];
    requireApproval: string[];
  };

  // 子 Agent 配置
  subagents?: {
    allowAgents?: string[];
    maxConcurrent?: number;
    maxDepth?: number;
  };

  // 超时配置
  timeout?: {
    taskTimeoutMs?: number;
    idleTimeoutMs?: number;
  };
}

/**
 * Agent 运行时状态
 */
export interface AgentRuntime {
  id: string;
  config: AgentConfig;
  status: 'idle' | 'running' | 'paused' | 'stopped' | 'error';
  pid?: number;
  startedAt?: number;
  lastActivityAt?: number;
  currentTask?: {
    id: string;
    description: string;
    startedAt: number;
  };
  metrics: {
    tasksCompleted: number;
    tasksFailed: number;
    totalCpuTime: number;
    totalMemoryUsage: number;
  };
}

/**
 * 任务定义
 */
export interface Task {
  id: string;
  agentId: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: {
    success: boolean;
    output?: string;
    error?: string;
  };
}

/**
 * 终端会话状态
 */
export interface TerminalSession {
  id: string;
  agentId: string;
  pty: any;  // node-pty 实例
  cwd: string;
  shell: string;
  rows: number;
  cols: number;
  createdAt: number;
  lastActivityAt: number;
  status: 'active' | 'paused' | 'exited';
  exitCode?: number;
  outputBuffer: string[];
  maxBufferLength: number;
}

/**
 * 终端输出事件
 */
export interface TerminalOutputEvent {
  sessionId: string;
  type: 'data' | 'error' | 'exit';
  data: string;
  timestamp: number;
}

/**
 * 终端尺寸
 */
export interface TerminalSize {
  rows: number;
  cols: number;
}

/**
 * Shell 配置
 */
export interface ShellConfig {
  windows: {
    shell: string;
    args: string[];
  };
  unix: {
    shell: string;
    args: string[];
  };
}
