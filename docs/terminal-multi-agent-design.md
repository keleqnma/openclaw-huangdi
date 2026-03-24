# 终端多 Agent 服务 - 详细设计文档

## 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        User Interface Layer                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │   CLI Client    │  │   Web Dashboard │  │   REST/WebSocket    │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        API Gateway Layer                             │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │  AgentService API  -  createAgent, deleteAgent, executeTask    ││
│  │  TerminalService API -  spawn, kill, stream, resize            ││
│  │  SandboxService API  -  create, destroy, exec, policy          ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Core Service Layer                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Agent        │  │ Terminal     │  │ Sandbox                  │  │
│  │ Orchestrator │  │ Manager      │  │ Manager                  │  │
│  │              │  │              │  │                          │  │
│  │ - AgentPool  │  │ - PTY        │  │ - Docker/Podman          │  │
│  │ - RoleRouter │  │ - Registry   │  │ - Path Security          │  │
│  │ - TaskQueue  │  │ - Streamer   │  │ - Tool Policy            │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Infrastructure Layer                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ node-pty     │  │ Docker SDK   │  │ Config/Logger/Events     │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 模块 1: Agent Orchestrator (Agent 编排器)

### 1.1 类型定义

```typescript
// src/agent/types.ts

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
    apiKey?: string;             // API Key (可选，使用环境变量)
    baseUrl?: string;            // 自定义端点 (Ollama/自定义)
  };

  // 沙箱配置
  sandbox?: {
    enabled: boolean;            // 是否启用沙箱
    mode: 'docker' | 'podman' | 'chroot' | 'restricted';
    workspaceRoot?: string;      // 沙箱内工作目录
    allowedPaths?: string[];     // 允许访问的主机路径
    networkAccess?: boolean;     // 是否允许网络访问
    resourceLimits?: {
      maxCpu?: number;           // CPU 限制 (百分比)
      maxMemory?: number;        // 内存限制 (MB)
      maxProcesses?: number;     // 最大进程数
    };
  };

  // 工具权限配置
  tools?: {
    allowed: string[];           // 允许的工具列表
    denied: string[];            // 拒绝的工具列表
    requireApproval: string[];   // 需要审批的工具
  };

  // 子 Agent 配置
  subagents?: {
    allowAgents?: string[];      // 允许 spawn 的子 Agent ID 列表
    maxConcurrent?: number;      // 最大并发子 Agent 数
    maxDepth?: number;           // 最大递归深度
  };

  // 超时配置
  timeout?: {
    taskTimeoutMs?: number;      // 任务超时
    idleTimeoutMs?: number;      // 空闲超时
  };

  // 日志配置
  logging?: {
    level: 'debug' | 'info' | 'warn' | 'error';
    output: 'file' | 'stdout' | 'both';
    logFile?: string;
  };
}

/**
 * Agent 运行时状态
 */
export interface AgentRuntime {
  id: string;
  config: AgentConfig;
  status: 'idle' | 'running' | 'paused' | 'stopped' | 'error';
  pid?: number;                  // 进程 ID
  startedAt?: number;            // 启动时间戳
  lastActivityAt?: number;       // 最后活动时间戳
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
```

---

### 1.2 AgentPool (Agent 池)

```typescript
// src/agent/AgentPool.ts

import { AgentConfig, AgentRuntime, AgentRole } from './types';
import { EventEmitter } from 'events';

interface AgentPoolEvents {
  'agent:created': (runtime: AgentRuntime) => void;
  'agent:started': (runtime: AgentRuntime) => void;
  'agent:stopped': (runtime: AgentRuntime) => void;
  'agent:error': (agentId: string, error: Error) => void;
  'agent:idle': (agentId: string) => void;
  'agent:busy': (agentId: string, taskId: string) => void;
}

export class AgentPool extends EventEmitter<AgentPoolEvents> {
  private agents: Map<string, AgentRuntime> = new Map();
  private runningAgents: Set<string> = new Set();
  private readonly maxConcurrent: number;

  constructor(options: { maxConcurrent?: number } = {}) {
    super();
    this.maxConcurrent = options.maxConcurrent ?? 10;
  }

  /**
   * 注册 Agent 配置
   */
  async register(config: AgentConfig): Promise<void> {
    if (this.agents.has(config.id)) {
      throw new Error(`Agent ${config.id} already registered`);
    }

    const runtime: AgentRuntime = {
      id: config.id,
      config,
      status: 'idle',
      metrics: {
        tasksCompleted: 0,
        tasksFailed: 0,
        totalCpuTime: 0,
        totalMemoryUsage: 0,
      },
    };

    this.agents.set(config.id, runtime);
    this.emit('agent:created', runtime);
  }

  /**
   * 获取 Agent 运行时
   */
  getRuntime(agentId: string): AgentRuntime | undefined {
    return this.agents.get(agentId);
  }

  /**
   * 获取所有 Agent
   */
  getAll(): AgentRuntime[] {
    return Array.from(this.agents.values());
  }

  /**
   * 获取空闲 Agent
   */
  getIdleAgents(): AgentRuntime[] {
    return Array.from(this.agents.values())
      .filter(a => a.status === 'idle');
  }

  /**
   * 根据角色获取可用 Agent
   */
  async acquireByRole(role: AgentRole): Promise<AgentRuntime | null> {
    const idle = this.getIdleAgents().filter(a => a.config.role === role);
    if (idle.length === 0) return null;

    // 选择最后活动时间最早的
    return idle.sort((a, b) =>
      (a.lastActivityAt ?? 0) - (b.lastActivityAt ?? 0)
    )[0];
  }

  /**
   * 标记 Agent 为忙碌
   */
  markBusy(agentId: string, taskId: string): void {
    const runtime = this.agents.get(agentId);
    if (!runtime) throw new Error(`Agent ${agentId} not found`);

    runtime.status = 'running';
    runtime.currentTask = {
      id: taskId,
      description: taskId,
      startedAt: Date.now(),
    };
    this.emit('agent:busy', agentId, taskId);
  }

  /**
   * 标记 Agent 为空闲
   */
  markIdle(agentId: string): void {
    const runtime = this.agents.get(agentId);
    if (!runtime) throw new Error(`Agent ${agentId} not found`);

    runtime.status = 'idle';
    runtime.currentTask = undefined;
    runtime.lastActivityAt = Date.now();
    this.emit('agent:idle', agentId);
  }

  /**
   * 启动 Agent 进程
   */
  async start(agentId: string): Promise<void> {
    const runtime = this.agents.get(agentId);
    if (!runtime) throw new Error(`Agent ${agentId} not found`);
    if (this.runningAgents.has(agentId)) {
      throw new Error(`Agent ${agentId} already running`);
    }
    if (this.runningAgents.size >= this.maxConcurrent) {
      throw new Error('Maximum concurrent agents reached');
    }

    // TODO: 实际启动逻辑（spawn 进程）
    runtime.status = 'running';
    runtime.startedAt = Date.now();
    this.runningAgents.add(agentId);
    this.emit('agent:started', runtime);
  }

  /**
   * 停止 Agent 进程
   */
  async stop(agentId: string): Promise<void> {
    const runtime = this.agents.get(agentId);
    if (!runtime) throw new Error(`Agent ${agentId} not found`);

    // TODO: 实际停止逻辑（kill 进程）
    runtime.status = 'stopped';
    this.runningAgents.delete(agentId);
    this.emit('agent:stopped', runtime);
  }

  /**
   * 注销 Agent
   */
  async unregister(agentId: string): Promise<void> {
    const runtime = this.agents.get(agentId);
    if (!runtime) throw new Error(`Agent ${agentId} not found`);

    if (this.runningAgents.has(agentId)) {
      await this.stop(agentId);
    }

    this.agents.delete(agentId);
  }
}
```

---

### 1.3 RoleRouter (角色路由器)

```typescript
// src/agent/RoleRouter.ts

import { AgentPool } from './AgentPool';
import { AgentConfig, AgentRole, Task } from './types';

/**
 * 角色到工具列表的映射
 */
const ROLE_TOOLS: Record<AgentRole, string[]> = {
  researcher: ['web-search', 'document-retrieval', 'read'],
  coder: ['file-read', 'file-write', 'shell', 'read', 'write'],
  reviewer: ['diff-analysis', 'security-scan', 'read'],
  tester: ['test-runner', 'coverage-analysis', 'shell'],
  writer: ['file-read', 'file-write', 'read', 'write'],
  planner: ['task-analysis', 'planning', 'read'],
  custom: [],
};

/**
 * 角色描述（用于 system prompt）
 */
const ROLE_DESCRIPTIONS: Record<AgentRole, string> = {
  researcher: '你是一个信息搜集专家，擅长使用搜索引擎和文档检索来获取所需信息。',
  coder: '你是一个编码专家，擅长编写、修改和优化代码。',
  reviewer: '你是一个代码审查专家，擅长发现代码中的问题和安全隐患。',
  tester: '你是一个测试专家，擅长编写和执行测试用例。',
  writer: '你是一个文档编写专家，擅长编写清晰、准确的技术文档。',
  planner: '你是一个任务规划专家，擅长将复杂任务拆解为可执行的步骤。',
  custom: '你是一个自定义角色的 Agent。',
};

export class RoleRouter {
  constructor(private agentPool: AgentPool) {}

  /**
   * 根据任务描述自动选择角色
   */
  async selectRole(taskDescription: string): Promise<AgentRole> {
    const keywords: Record<AgentRole, string[]> = {
      researcher: ['搜索', '查找', '研究', 'search', 'find', 'research'],
      coder: ['代码', '实现', '编写', '修复', 'code', 'implement', 'fix', 'write'],
      reviewer: ['审查', '检查', '审计', 'review', 'audit', 'check'],
      tester: ['测试', '验证', 'test', 'verify', 'validate'],
      writer: ['文档', '说明', 'write', 'document', 'doc'],
      planner: ['规划', '计划', '拆解', 'plan', 'decompose'],
      custom: [],
    };

    const lowerDesc = taskDescription.toLowerCase();
    let bestRole: AgentRole = 'custom';
    let bestScore = 0;

    for (const [role, words] of Object.entries(keywords)) {
      const score = words.filter(w => lowerDesc.includes(w)).length;
      if (score > bestScore) {
        bestScore = score;
        bestRole = role as AgentRole;
      }
    }

    return bestRole;
  }

  /**
   * 为任务分配合适的 Agent
   */
  async assignAgent(task: Task): Promise<string | null> {
    // 1. 根据任务描述选择角色
    const role = await this.selectRole(task.description);

    // 2. 从池中获取该角色的空闲 Agent
    const agent = await this.agentPool.acquireByRole(role);
    if (!agent) return null;

    // 3. 标记为忙碌并返回 Agent ID
    this.agentPool.markBusy(agent.id, task.id);
    return agent.id;
  }

  /**
   * 获取角色的工具列表
   */
  getToolsForRole(role: AgentRole): string[] {
    return ROLE_TOOLS[role];
  }

  /**
   * 获取角色的 System Prompt
   */
  getSystemPrompt(role: AgentRole, customInstructions?: string): string {
    const base = ROLE_DESCRIPTIONS[role];
    const tools = this.getToolsForRole(role).join(', ');
    const toolsPrompt = `你可以使用的工具：${tools}`;
    const customPrompt = customInstructions ? `特殊指令：${customInstructions}` : '';

    return [base, toolsPrompt, customPrompt].filter(Boolean).join('\n\n');
  }
}
```

---

## 模块 2: Terminal Manager (终端管理器)

### 2.1 类型定义

```typescript
// src/terminal/types.ts

import { PTYPacket } from '@lydell/node-pty';

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
  outputBuffer: string[];  // 输出缓冲
  maxBufferLength: number; // 最大缓冲行数
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
 * 终端输入命令
 */
export interface TerminalInput {
  sessionId: string;
  data: string;  // 输入的字符或字符串
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
  // Windows
  windows: {
    shell: string;
    args: string[];
  };
  // Unix
  unix: {
    shell: string;
    args: string[];
  };
}
```

---

### 2.2 TerminalService (终端服务)

```typescript
// src/terminal/TerminalService.ts

import * as pty from '@lydell/node-pty';
import { EventEmitter } from 'events';
import {
  TerminalSession,
  TerminalOutputEvent,
  TerminalInput,
  TerminalSize,
  ShellConfig
} from './types';

const DEFAULT_SHELL_CONFIG: ShellConfig = {
  windows: {
    shell: 'pwsh.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command'],
  },
  unix: {
    shell: process.env.SHELL || '/bin/sh',
    args: ['-c'],
  },
};

interface TerminalEvents {
  'session:created': (session: TerminalSession) => void;
  'session:exited': (session: TerminalSession) => void;
  'output': (event: TerminalOutputEvent) => void;
  'error': (sessionId: string, error: Error) => void;
}

export class TerminalService extends EventEmitter<TerminalEvents> {
  private sessions: Map<string, TerminalSession> = new Map();
  private shellConfig: ShellConfig;

  constructor(options: { shellConfig?: ShellConfig } = {}) {
    super();
    this.shellConfig = options.shellConfig ?? DEFAULT_SHELL_CONFIG;
  }

  /**
   * 获取当前平台的 Shell 配置
   */
  private getPlatformShell(): { shell: string; args: string[] } {
    const platform = process.platform;
    if (platform === 'win32') {
      return this.shellConfig.windows;
    }
    return this.shellConfig.unix;
  }

  /**
   * 创建终端会话
   */
  createSession(
    agentId: string,
    options: {
      cwd?: string;
      env?: Record<string, string>;
      rows?: number;
      cols?: number;
      maxBufferLength?: number;
    } = {}
  ): TerminalSession {
    const sessionId = this.generateSessionId();
    const { shell, args } = this.getPlatformShell();
    const rows = options.rows ?? 24;
    const cols = options.cols ?? 80;

    // 创建 PTY 实例
    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cwd: options.cwd ?? process.cwd(),
      env: options.env,
      cols,
      rows,
    });

    const session: TerminalSession = {
      id: sessionId,
      agentId,
      pty: ptyProcess,
      cwd: options.cwd ?? process.cwd(),
      shell,
      rows,
      cols,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      status: 'active',
      outputBuffer: [],
      maxBufferLength: options.maxBufferLength ?? 1000,
    };

    // 绑定 PTY 事件
    ptyProcess.onData((data: string) => {
      session.lastActivityAt = Date.now();
      session.outputBuffer.push(data);

      // 维护缓冲大小
      if (session.outputBuffer.length > session.maxBufferLength) {
        session.outputBuffer.shift();
      }

      this.emit('output', {
        sessionId,
        type: 'data',
        data,
        timestamp: Date.now(),
      });
    });

    ptyProcess.onExit(({ exitCode }) => {
      session.status = 'exited';
      session.exitCode = exitCode;
      this.emit('session:exited', session);
      this.emit('output', {
        sessionId,
        type: 'exit',
        data: `Process exited with code ${exitCode}`,
        timestamp: Date.now(),
      });
    });

    this.sessions.set(sessionId, session);
    this.emit('session:created', session);

    return session;
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 向终端写入数据
   */
  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.status !== 'active') {
      throw new Error(`Session ${sessionId} is not active`);
    }

    session.lastActivityAt = Date.now();
    session.pty.write(data);
  }

  /**
   * 调整终端尺寸
   */
  resize(sessionId: string, size: TerminalSize): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    session.rows = size.rows;
    session.cols = size.cols;
    session.pty.resize(size.cols, size.rows);
  }

  /**
   * 获取会话输出（全量）
   */
  getOutput(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.outputBuffer.join('');
  }

  /**
   * 获取会话输出（最后 N 行）
   */
  getTail(sessionId: string, lines: number = 100): string {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const output = session.outputBuffer.join('');
    const allLines = output.split('\n');
    return allLines.slice(-lines).join('\n');
  }

  /**
   * 关闭会话
   */
  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      session.pty.kill();
    } catch (e) {
      // Ignore kill errors
    }

    this.sessions.delete(sessionId);
  }

  /**
   * 关闭所有会话
   */
  closeAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.closeSession(sessionId);
    }
  }

  /**
   * 生成会话 ID
   */
  private generateSessionId(): string {
    return `term_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}
```

---

### 2.3 ProcessRegistry (进程注册表)

```typescript
// src/terminal/ProcessRegistry.ts

import { TerminalSession } from './types';
import { EventEmitter } from 'events';

/**
 * 进程信息
 */
interface ProcessInfo {
  pid: number;
  sessionId: string;
  agentId: string;
  command: string;
  cwd: string;
  startedAt: number;
  status: 'running' | 'exited' | 'killed';
  exitCode?: number;
  cpuTime?: number;
  memoryUsage?: number;
}

interface ProcessRegistryEvents {
  'process:started': (info: ProcessInfo) => void;
  'process:exited': (info: ProcessInfo) => void;
  'process:killed': (info: ProcessInfo) => void;
}

export class ProcessRegistry extends EventEmitter<ProcessRegistryEvents> {
  private processes: Map<number, ProcessInfo> = new Map();
  private sessionToPid: Map<string, number> = new Map();
  private history: ProcessInfo[] = [];

  /**
   * 注册进程
   */
  register(session: TerminalSession): void {
    // node-pty 不直接暴露 PID，这里做逻辑注册
    const pid = session.pty.pid ?? 0;

    const info: ProcessInfo = {
      pid,
      sessionId: session.id,
      agentId: session.agentId,
      command: session.shell,
      cwd: session.cwd,
      startedAt: session.createdAt,
      status: 'running',
    };

    this.processes.set(pid, info);
    this.sessionToPid.set(session.id, pid);
    this.emit('process:started', info);
  }

  /**
   * 标记进程退出
   */
  markExited(sessionId: string, exitCode?: number): void {
    const pid = this.sessionToPid.get(sessionId);
    if (!pid) return;

    const info = this.processes.get(pid);
    if (!info) return;

    info.status = 'exited';
    info.exitCode = exitCode;

    this.processes.delete(pid);
    this.sessionToPid.delete(sessionId);
    this.history.push(info);
    this.emit('process:exited', info);
  }

  /**
   * 获取活跃进程
   */
  getActiveProcesses(): ProcessInfo[] {
    return Array.from(this.processes.values());
  }

  /**
   * 根据 Agent ID 获取进程
   */
  getByAgentId(agentId: string): ProcessInfo[] {
    return Array.from(this.processes.values())
      .filter(p => p.agentId === agentId);
  }

  /**
   * 获取历史进程
   */
  getHistory(limit: number = 100): ProcessInfo[] {
    return this.history.slice(-limit);
  }

  /**
   * 清理历史记录
   */
  cleanupHistory(maxAge: number = 3600000): void {
    const now = Date.now();
    this.history = this.history.filter(p => now - p.startedAt < maxAge);
  }
}
```

---

## 模块 3: Sandbox Manager (沙箱管理器)

### 3.1 类型定义

```typescript
// src/sandbox/types.ts

/**
 * 沙箱模式
 */
export type SandboxMode = 'docker' | 'podman' | 'chroot' | 'restricted';

/**
 * 沙箱配置
 */
export interface SandboxConfig {
  mode: SandboxMode;
  workspaceRoot: string;       // 工作目录根
  allowedPaths: string[];      // 允许访问的主机路径
  networkAccess: boolean;      // 网络访问
  resourceLimits: {
    maxCpu?: number;           // CPU 限制 (%)
    maxMemory?: number;        // 内存限制 (MB)
    maxProcesses?: number;     // 最大进程数
    maxFileSize?: number;      // 最大文件大小 (MB)
  };
  allowedCommands?: string[];  // 允许的命令（白名单模式）
  deniedCommands?: string[];   // 拒绝的命令（黑名单模式）
}

/**
 * 沙箱实例
 */
export interface SandboxInstance {
  id: string;
  agentId: string;
  config: SandboxConfig;
  status: 'creating' | 'ready' | 'running' | 'stopped' | 'error';
  createdAt: number;
  containerId?: string;        // 容器 ID (Docker/Podman)
  workspacePath: string;       // 沙箱内工作路径
}

/**
 * 路径安全检查结果
 */
export interface PathCheckResult {
  allowed: boolean;
  reason?: string;
  normalizedPath: string;
}

/**
 * 命令安全检查结果
 */
export interface CommandCheckResult {
  allowed: boolean;
  reason?: string;
  requiresApproval: boolean;
}
```

---

### 3.2 PathSecurity (路径安全)

```typescript
// src/sandbox/PathSecurity.ts

import * as path from 'path';
import * as fs from 'fs';

export class PathSecurity {
  private allowedPaths: string[];
  private workspaceRoot: string;

  constructor(config: {
    workspaceRoot: string;
    allowedPaths: string[];
  }) {
    this.workspaceRoot = this.normalizePath(config.workspaceRoot);
    this.allowedPaths = [
      this.workspaceRoot,
      ...config.allowedPaths.map(p => this.normalizePath(p)),
    ];
  }

  /**
   * 标准化路径
   */
  private normalizePath(input: string): string {
    // 移除 null 字节
    const sanitized = input.replace(/\0/g, '');
    // 解析用户路径 (~)
    const resolved = this.resolveUserPath(sanitized);
    // 标准化
    const normalized = path.normalize(resolved);
    // Windows 转小写
    if (process.platform === 'win32') {
      return normalized.toLowerCase();
    }
    return normalized;
  }

  /**
   * 解析用户路径
   */
  private resolveUserPath(input: string): string {
    if (input.startsWith('~')) {
      return path.join(process.env.HOME || process.env.USERPROFILE || '', input.slice(1));
    }
    return input;
  }

  /**
   * 检查路径是否在允许范围内
   */
  checkPath(filePath: string): PathCheckResult {
    const normalized = this.normalizePath(filePath);

    // 检查是否以任何允许路径为前缀
    for (const allowed of this.allowedPaths) {
      if (normalized === allowed || normalized.startsWith(allowed + path.sep)) {
        return {
          allowed: true,
          normalizedPath: normalized,
        };
      }
    }

    return {
      allowed: false,
      reason: `Path ${normalized} is outside allowed paths`,
      normalizedPath: normalized,
    };
  }

  /**
   * 断言路径安全（抛出异常如果检查失败）
   */
  assertPath(filePath: string): string {
    const result = this.checkPath(filePath);
    if (!result.allowed) {
      throw new Error(result.reason);
    }
    return result.normalizedPath;
  }

  /**
   * 检查并阻止目录遍历攻击
   */
  assertNoTraversal(filePath: string): string {
    const normalized = this.normalizePath(filePath);

    // 标准化后检查是否还包含 ..
    if (normalized.includes('..' + path.sep) || normalized.endsWith('..')) {
      throw new Error('Directory traversal detected');
    }

    return this.assertPath(normalized);
  }
}
```

---

### 3.3 CommandSecurity (命令安全)

```typescript
// src/sandbox/CommandSecurity.ts

import { CommandCheckResult } from './types';

/**
 * 危险命令模式
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  /^rm\s+(-[rf]+\s+)?\/$/,           // rm -rf /
  /^dd\s+.*of=\/dev\/(disk|hd)/,     // dd 写入设备
  /^chmod\s+777\s+/,                 // chmod 777
  /^chown\s+.*:.*\s+\/$/,            // chown 根目录
  /^\S*:\(\)\{\s*:\|:&\s*\}\s*;:/,   // Shellshock
  /mkfs\./,                          // 格式化
  /^:'\{\{.*\}\}'/,                  // 某些注入攻击
];

/**
 * 需要审批的命令
 */
const REQUIRES_APPROVAL: RegExp[] = [
  /^sudo\s+/,                        // sudo 命令
  /^curl.*\|\s*(ba)?sh/,             // curl | sh
  /^wget.*\|\s*(ba)?sh/,             // wget | sh
  /^npm\s+(i|install)\s+-g/,         // 全局 npm 安装
  /^pip\s+install.*--system/,        // 系统 pip 安装
];

export class CommandSecurity {
  private allowedCommands: string[] = [];
  private deniedCommands: string[] = [];
  private useAllowlist: boolean;

  constructor(config: {
    useAllowlist?: boolean;
    allowedCommands?: string[];
    deniedCommands?: string[];
  }) {
    this.useAllowlist = config.useAllowlist ?? false;
    this.allowedCommands = config.allowedCommands ?? [];
    this.deniedCommands = config.deniedCommands ?? [
      'rm', 'dd', 'mkfs', 'chmod', 'chown',
    ];
  }

  /**
   * 检查命令是否允许
   */
  checkCommand(command: string): CommandCheckResult {
    const trimmed = command.trim().toLowerCase();

    // 1. 检查危险模式
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          allowed: false,
          reason: 'Dangerous command pattern detected',
          requiresApproval: false,
        };
      }
    }

    // 2. 检查是否需要审批
    let requiresApproval = false;
    for (const pattern of REQUIRES_APPROVAL) {
      if (pattern.test(trimmed)) {
        requiresApproval = true;
        break;
      }
    }

    // 3. 白名单模式
    if (this.useAllowlist) {
      const firstWord = trimmed.split(/\s+/)[0];
      const isAllowed = this.allowedCommands.some(allowed =>
        firstWord === allowed || firstWord.startsWith(allowed)
      );

      if (!isAllowed) {
        return {
          allowed: false,
          reason: `Command not in allowlist`,
          requiresApproval: true, // 白名单外的命令可申请审批
        };
      }
    }
    // 4. 黑名单模式
    else {
      const firstWord = trimmed.split(/\s+/)[0];
      const isDenied = this.deniedCommands.includes(firstWord);

      if (isDenied) {
        return {
          allowed: false,
          reason: `Command ${firstWord} is denied`,
          requiresApproval: false,
        };
      }
    }

    return {
      allowed: true,
      requiresApproval,
    };
  }
}
```

---

### 3.4 SandboxManager (沙箱管理器)

```typescript
// src/sandbox/SandboxManager.ts

import { exec } from 'child_process';
import { EventEmitter } from 'events';
import { SandboxConfig, SandboxInstance } from './types';
import { PathSecurity } from './PathSecurity';
import { CommandSecurity } from './CommandSecurity';

interface SandboxEvents {
  'sandbox:created': (instance: SandboxInstance) => void;
  'sandbox:stopped': (instance: SandboxInstance) => void;
  'sandbox:error': (instanceId: string, error: Error) => void;
}

export class SandboxManager extends EventEmitter<SandboxEvents> {
  private sandboxes: Map<string, SandboxInstance> = new Map();
  private defaultConfig: SandboxConfig;

  constructor(defaultConfig: SandboxConfig) {
    super();
    this.defaultConfig = defaultConfig;
  }

  /**
   * 创建沙箱
   */
  async create(agentId: string, overrideConfig?: Partial<SandboxConfig>): Promise<SandboxInstance> {
    const config: SandboxConfig = { ...this.defaultConfig, ...overrideConfig };
    const instanceId = `sandbox_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const instance: SandboxInstance = {
      id: instanceId,
      agentId,
      config,
      status: 'creating',
      createdAt: Date.now(),
      workspacePath: this.resolveWorkspacePath(instanceId, config),
    };

    this.sandboxes.set(instanceId, instance);

    try {
      // 根据模式创建沙箱
      if (config.mode === 'docker' || config.mode === 'podman') {
        await this.createContainer(instance);
      } else if (config.mode === 'chroot') {
        await this.createChroot(instance);
      } else if (config.mode === 'restricted') {
        await this.setupRestricted(instance);
      }

      instance.status = 'ready';
      this.emit('sandbox:created', instance);
      return instance;
    } catch (error) {
      instance.status = 'error';
      this.emit('sandbox:error', instanceId, error as Error);
      throw error;
    }
  }

  /**
   * 创建 Docker 容器
   */
  private async createContainer(instance: SandboxInstance): Promise<void> {
    const { config } = instance;
    const runtime = config.mode; // 'docker' or 'podman'

    // 构建 docker run 命令
    const args: string[] = [
      'run',
      '-d',  // 后台运行
      '--rm',  // 退出后自动清理
      '-w', instance.workspacePath,
    ];

    // CPU 限制
    if (config.resourceLimits.maxCpu) {
      args.push('--cpus', config.resourceLimits.maxCpu.toString());
    }

    // 内存限制
    if (config.resourceLimits.maxMemory) {
      args.push('-m', `${config.resourceLimits.maxMemory}m`);
    }

    // 进程数限制
    if (config.resourceLimits.maxProcesses) {
      args.push('--pids-limit', config.resourceLimits.maxProcesses.toString());
    }

    // 网络访问
    if (!config.networkAccess) {
      args.push('--network', 'none');
    }

    // 挂载卷（只读或指定路径）
    args.push('-v', `${config.workspaceRoot}:${instance.workspacePath}:rw`);
    for (const allowedPath of config.allowedPaths) {
      args.push('-v', `${allowedPath}:${allowedPath}:ro`);
    }

    // 使用基础镜像
    args.push('alpine:latest', 'tail', '-f', '/dev/null');

    return new Promise((resolve, reject) => {
      exec(`${runtime} ${args.join(' ')}`, (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          instance.containerId = stdout.trim();
          instance.status = 'running';
          resolve();
        }
      });
    });
  }

  /**
   * 创建 chroot 环境（简化版）
   */
  private async createChroot(instance: SandboxInstance): Promise<void> {
    // chroot 需要 root 权限，这里只做目录准备
    const fs = await import('fs/promises');
    await fs.mkdir(instance.workspacePath, { recursive: true });
    instance.status = 'running';
  }

  /**
   * 设置受限模式（无容器）
   */
  private async setupRestricted(instance: SandboxInstance): Promise<void> {
    const fs = await import('fs/promises');
    await fs.mkdir(instance.workspacePath, { recursive: true });
    instance.status = 'running';
  }

  /**
   * 解析工作目录路径
   */
  private resolveWorkspacePath(instanceId: string, config: SandboxConfig): string {
    const path = await import('path');
    return path.join(config.workspaceRoot, instanceId);
  }

  /**
   * 获取沙箱实例
   */
  getInstance(instanceId: string): SandboxInstance | undefined {
    return this.sandboxes.get(instanceId);
  }

  /**
   * 根据 Agent ID 获取沙箱
   */
  getByAgentId(agentId: string): SandboxInstance | undefined {
    return Array.from(this.sandboxes.values()).find(s => s.agentId === agentId);
  }

  /**
   * 停止沙箱
   */
  async stop(instanceId: string): Promise<void> {
    const instance = this.sandboxes.get(instanceId);
    if (!instance) return;

    if (instance.containerId && (instance.config.mode === 'docker' || instance.config.mode === 'podman')) {
      await new Promise<void>((resolve) => {
        exec(`${instance.config.mode} stop ${instance.containerId}`, () => {
          resolve();
        });
      });
    }

    instance.status = 'stopped';
    this.sandboxes.delete(instanceId);
    this.emit('sandbox:stopped', instance);
  }

  /**
   * 获取路径安全检查器
   */
  getPathSecurity(instanceId: string): PathSecurity | null {
    const instance = this.sandboxes.get(instanceId);
    if (!instance) return null;

    return new PathSecurity({
      workspaceRoot: instance.config.workspaceRoot,
      allowedPaths: instance.config.allowedPaths,
    });
  }

  /**
   * 获取命令安全检查器
   */
  getCommandSecurity(instanceId: string): CommandSecurity | null {
    const instance = this.sandboxes.get(instanceId);
    if (!instance) return null;

    return new CommandSecurity({
      useAllowlist: instance.config.allowedCommands !== undefined,
      allowedCommands: instance.config.allowedCommands,
      deniedCommands: instance.config.deniedCommands,
    });
  }
}
```

---

## 模块 4: API Gateway (API 网关)

### 4.1 REST API 设计

```typescript
// src/api/routes.ts

import { Hono } from 'hono';
import { AgentService } from '../agent/AgentService';
import { TerminalService } from '../terminal/TerminalService';
import { SandboxManager } from '../sandbox/SandboxManager';

export function createRoutes(
  agentService: AgentService,
  terminalService: TerminalService,
  sandboxManager: SandboxManager
) {
  const app = new Hono();

  // ===== Agent 路由 =====

  // 创建 Agent
  app.post('/api/agents', async (c) => {
    const config = await c.req.json();
    await agentService.createAgent(config);
    return c.json({ success: true, agentId: config.id });
  });

  // 获取所有 Agent
  app.get('/api/agents', (c) => {
    const agents = agentService.getAllAgents();
    return c.json({ agents });
  });

  // 获取单个 Agent
  app.get('/api/agents/:id', (c) => {
    const agent = agentService.getAgent(c.req.param('id'));
    if (!agent) return c.json({ error: 'Not found' }, 404);
    return c.json({ agent });
  });

  // 删除 Agent
  app.delete('/api/agents/:id', async (c) => {
    await agentService.deleteAgent(c.req.param('id'));
    return c.json({ success: true });
  });

  // 执行任务
  app.post('/api/agents/:id/execute', async (c) => {
    const { task, options } = await c.req.json();
    const result = await agentService.executeTask(c.req.param('id'), task, options);
    return c.json({ success: true, result });
  });

  // ===== Terminal 路由 =====

  // 创建终端会话
  app.post('/api/terminals', async (c) => {
    const { agentId, cwd, env } = await c.req.json();
    const session = terminalService.createSession(agentId, { cwd, env });
    return c.json({ sessionId: session.id });
  });

  // 获取终端输出
  app.get('/api/terminals/:id/output', (c) => {
    const output = terminalService.getOutput(c.req.param('id'));
    return c.json({ output });
  });

  // 向终端写入
  app.post('/api/terminals/:id/write', async (c) => {
    const { data } = await c.req.json();
    terminalService.write(c.req.param('id'), data);
    return c.json({ success: true });
  });

  // 调整终端尺寸
  app.post('/api/terminals/:id/resize', async (c) => {
    const { rows, cols } = await c.req.json();
    terminalService.resize(c.req.param('id'), { rows, cols });
    return c.json({ success: true });
  });

  // 关闭终端
  app.delete('/api/terminals/:id', async (c) => {
    terminalService.closeSession(c.req.param('id'));
    return c.json({ success: true });
  });

  // ===== Sandbox 路由 =====

  // 创建沙箱
  app.post('/api/sandboxes', async (c) => {
    const { agentId, config } = await c.req.json();
    const sandbox = await sandboxManager.create(agentId, config);
    return c.json({ sandboxId: sandbox.id });
  });

  // 获取沙箱
  app.get('/api/sandboxes/:id', (c) => {
    const sandbox = sandboxManager.getInstance(c.req.param('id'));
    if (!sandbox) return c.json({ error: 'Not found' }, 404);
    return c.json({ sandbox });
  });

  // 停止沙箱
  app.delete('/api/sandboxes/:id', async (c) => {
    await sandboxManager.stop(c.req.param('id'));
    return c.json({ success: true });
  });

  return app;
}
```

---

### 4.2 WebSocket 实时推送

```typescript
// src/api/WebSocketServer.ts

import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { TerminalOutputEvent } from '../terminal/types';
import { AgentRuntime } from '../agent/types';

interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'terminal:write' | 'terminal:resize';
  payload: any;
}

interface ServerMessage {
  type: string;
  payload: any;
}

export class ApiWebSocketServer extends EventEmitter {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private subscriptions: Map<WebSocket, Set<string>> = new Map();

  constructor(port: number) {
    super();
    this.wss = new WebSocketServer({ port });
    this.setup();
  }

  private setup() {
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      this.subscriptions.set(ws, new Set());

      ws.on('message', (data) => {
        const message: ClientMessage = JSON.parse(data.toString());
        this.handleMessage(ws, message);
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        this.subscriptions.delete(ws);
      });
    });
  }

  private handleMessage(ws: WebSocket, message: ClientMessage) {
    switch (message.type) {
      case 'subscribe':
        this.subscriptions.get(ws)?.add(message.payload.channel);
        break;
      case 'unsubscribe':
        this.subscriptions.get(ws)?.delete(message.payload.channel);
        break;
    }
  }

  /**
   * 广播 Agent 状态更新
   */
  broadcastAgentUpdate(agent: AgentRuntime): void {
    this.broadcast({
      type: 'agent:update',
      payload: { agent },
    }, 'agent:' + agent.id);
  }

  /**
   * 广播终端输出
   */
  broadcastTerminalOutput(event: TerminalOutputEvent): void {
    this.broadcast({
      type: 'terminal:output',
      payload: event,
    }, 'terminal:' + event.sessionId);
  }

  /**
   * 广播到订阅的客户端
   */
  private broadcast(message: ServerMessage, channel?: string): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        if (!channel || this.subscriptions.get(client)?.has(channel)) {
          client.send(data);
        }
      }
    }
  }

  /**
   * 关闭服务
   */
  close(): void {
    this.wss.close();
  }
}
```

---

## 模块 5: 主服务入口

### 5.1 MultiAgentService (主服务类)

```typescript
// src/MultiAgentService.ts

import { AgentPool } from './agent/AgentPool';
import { RoleRouter } from './agent/RoleRouter';
import { TerminalService } from './terminal/TerminalService';
import { ProcessRegistry } from './terminal/ProcessRegistry';
import { SandboxManager } from './sandbox/SandboxManager';
import { createRoutes } from './api/routes';
import { ApiWebSocketServer } from './api/WebSocketServer';
import { AgentConfig, SandboxConfig } from './types';

export interface MultiAgentServiceConfig {
  // 服务配置
  port: number;
  wsPort: number;

  // Agent 池配置
  maxConcurrentAgents: number;

  // 终端配置
  maxBufferLength: number;

  // 沙箱配置
  sandbox: SandboxConfig;
}

export class MultiAgentService {
  private agentPool: AgentPool;
  private roleRouter: RoleRouter;
  private terminalService: TerminalService;
  private processRegistry: ProcessRegistry;
  private sandboxManager: SandboxManager;
  private apiServer: any;  // Hono app
  private wsServer: ApiWebSocketServer;
  private config: MultiAgentServiceConfig;

  constructor(config: Partial<MultiAgentServiceConfig> = {}) {
    this.config = {
      port: config.port ?? 3456,
      wsPort: config.wsPort ?? 3457,
      maxConcurrentAgents: config.maxConcurrentAgents ?? 10,
      maxBufferLength: config.maxBufferLength ?? 1000,
      sandbox: config.sandbox ?? {
        mode: 'restricted',
        workspaceRoot: '/tmp/agent-workspace',
        allowedPaths: [],
        networkAccess: false,
        resourceLimits: {
          maxCpu: 50,
          maxMemory: 512,
          maxProcesses: 10,
        },
      },
    };

    // 初始化组件
    this.agentPool = new AgentPool({ maxConcurrent: this.config.maxConcurrentAgents });
    this.roleRouter = new RoleRouter(this.agentPool);
    this.terminalService = new TerminalService({
      maxBufferLength: this.config.maxBufferLength
    });
    this.processRegistry = new ProcessRegistry();
    this.sandboxManager = new SandboxManager(this.config.sandbox);

    // 创建 API 路由
    this.apiServer = createRoutes(
      this.agentPool,
      this.terminalService,
      this.sandboxManager
    );

    // 创建 WebSocket 服务
    this.wsServer = new ApiWebSocketServer(this.config.wsPort);

    // 绑定事件
    this.bindEvents();
  }

  private bindEvents() {
    // Agent 事件 -> WebSocket 推送
    this.agentPool.on('agent:created', (runtime) => {
      this.wsServer.broadcastAgentUpdate(runtime);
    });
    this.agentPool.on('agent:started', (runtime) => {
      this.wsServer.broadcastAgentUpdate(runtime);
    });
    this.agentPool.on('agent:stopped', (runtime) => {
      this.wsServer.broadcastAgentUpdate(runtime);
    });

    // 终端事件 -> WebSocket 推送
    this.terminalService.on('output', (event) => {
      this.wsServer.broadcastTerminalOutput(event);
    });
  }

  /**
   * 注册 Agent
   */
  async registerAgent(config: AgentConfig): Promise<void> {
    await this.agentPool.register(config);
  }

  /**
   * 执行任务
   */
  async executeTask(agentId: string, task: string): Promise<string> {
    // 1. 分配 Agent（如果未指定）
    const targetAgentId = agentId || await this.roleRouter.assignAgent(task);
    if (!targetAgentId) {
      throw new Error('No available agent for task');
    }

    // 2. 创建沙箱（如果配置了）
    const agent = this.agentPool.getRuntime(targetAgentId);
    let sandboxId: string | undefined;

    if (agent?.config.sandbox?.enabled) {
      const sandbox = await this.sandboxManager.create(targetAgentId);
      sandboxId = sandbox.id;
    }

    // 3. 创建终端会话
    const session = this.terminalService.createSession(targetAgentId, {
      cwd: agent?.config.cwd,
      env: agent?.config.env,
    });

    // 4. 发送任务到终端
    this.terminalService.write(session.id, task + '\n');

    return session.id;
  }

  /**
   * 启动服务
   */
  async start(): Promise<void> {
    // 启动 HTTP API
    const { serve } = await import('@hono/node-server');
    serve({
      fetch: this.apiServer.fetch,
      port: this.config.port,
    });
    console.log(`API server listening on port ${this.config.port}`);

    console.log(`WebSocket server listening on port ${this.config.wsPort}`);
  }

  /**
   * 停止服务
   */
  async stop(): Promise<void> {
    this.terminalService.closeAll();
    this.wsServer.close();
    // 清理沙箱
    // ...
  }
}
```

---

### 5.2 CLI 入口

```typescript
// src/cli.ts

#!/usr/bin/env node

import { MultiAgentService } from './MultiAgentService';
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

const program = new Command();

program
  .name('multi-agent-service')
  .description('本地跨平台终端多 Agent 服务')
  .version('0.1.0');

program
  .command('start')
  .description('启动服务')
  .option('-p, --port <number>', 'HTTP API 端口', '3456')
  .option('-w, --ws-port <number>', 'WebSocket 端口', '3457')
  .option('-c, --config <path>', '配置文件路径')
  .action(async (options) => {
    let config = {};

    if (options.config) {
      const configPath = path.resolve(options.config);
      const content = fs.readFileSync(configPath, 'utf-8');
      config = JSON.parse(content);
    }

    const service = new MultiAgentService({
      port: parseInt(options.port),
      wsPort: parseInt(options.wsPort),
      ...config,
    });

    await service.start();
    console.log('Service started. Press Ctrl+C to stop.');
  });

program
  .command('register')
  .description('注册 Agent')
  .requiredOption('--id <id>', 'Agent ID')
  .requiredOption('--role <role>', 'Agent 角色')
  .requiredOption('--command <cmd>', '启动命令')
  .option('--name <name>', '显示名称')
  .option('--cwd <dir>', '工作目录')
  .action(async (options) => {
    // CLI 调用 API 注册 Agent
    console.log('Registering agent:', options);
  });

program
  .command('execute')
  .description('执行任务')
  .requiredOption('--agent <id>', 'Agent ID')
  .requiredOption('--task <task>', '任务描述')
  .option('--watch', 'Watch output', false)
  .action(async (options) => {
    // CLI 调用 API 执行任务
    console.log('Executing task:', options);
  });

program.parse();
```

---

## 配置文件示例

```json
{
  "$schema": "./schema.json",
  "port": 3456,
  "wsPort": 3457,
  "maxConcurrentAgents": 10,
  "maxBufferLength": 1000,
  "sandbox": {
    "mode": "restricted",
    "workspaceRoot": "./workspaces",
    "allowedPaths": ["./shared"],
    "networkAccess": false,
    "resourceLimits": {
      "maxCpu": 50,
      "maxMemory": 512,
      "maxProcesses": 10
    },
    "allowedCommands": ["ls", "cat", "grep", "npm", "node"],
    "deniedCommands": ["rm", "dd", "mkfs"]
  },
  "agents": [
    {
      "id": "researcher-1",
      "name": "信息搜集助手",
      "role": "researcher",
      "command": "claude",
      "model": {
        "provider": "anthropic",
        "model": "claude-sonnet-4"
      },
      "cwd": "./workspaces/researcher",
      "sandbox": {
        "enabled": true,
        "mode": "restricted"
      }
    },
    {
      "id": "coder-1",
      "name": "编码助手",
      "role": "coder",
      "command": "claude",
      "model": {
        "provider": "anthropic",
        "model": "claude-opus-4"
      },
      "cwd": "./workspaces/coder",
      "sandbox": {
        "enabled": true,
        "mode": "docker"
      }
    },
    {
      "id": "tester-1",
      "name": "测试助手",
      "role": "tester",
      "command": "npm",
      "args": ["run", "test-agent"],
      "cwd": "./workspaces/tester",
      "sandbox": {
        "enabled": true,
        "mode": "restricted"
      }
    }
  ]
}
```

---

## 依赖清单

```json
{
  "name": "terminal-multi-agent-service",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "@hono/node-server": "^1.19.11",
    "@lydell/node-pty": "^1.1.0",
    "commander": "^12.1.0",
    "hono": "^4.12.8",
    "ws": "^8.19.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/ws": "^8.5.13",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

---

## 总结

这份设计文档包含了：

| 模块 | 核心功能 | 代码量估算 |
|------|---------|-----------|
| Agent Orchestrator | Agent 池管理、角色路由 | ~500 行 |
| Terminal Manager | PTY 终端、进程注册 | ~400 行 |
| Sandbox Manager | 路径安全、命令安全、容器管理 | ~500 行 |
| API Gateway | REST API、WebSocket | ~200 行 |
| CLI | 命令行界面 | ~100 行 |
| **总计** | | **~1700 行** |

<options>
    <option>开始实现 - 阶段 1: Agent Orchestrator + Terminal Manager</option>
    <option>需要修改设计 (请说明需求)</option>
    <option>先看 openclaw-huangdi 现有代码如何集成</option>
</options>
