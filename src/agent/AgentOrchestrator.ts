/**
 * Agent Orchestrator - Agent 编排器
 *
 * 整合 TerminalService、SandboxManager 和角色路由
 * 提供统一的 Agent 管理和任务执行接口
 */

import { EventEmitter } from 'events';
import { AgentConfig, AgentRuntime, Task, AgentRole } from '../terminal/types';
import { TerminalService } from '../terminal/TerminalService';
import { ProcessRegistry } from '../terminal/ProcessRegistry';
import { SandboxManager } from '../sandbox/SandboxManager';

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

export class AgentOrchestrator extends EventEmitter {
  private agents: Map<string, AgentRuntime> = new Map();
  private tasks: Map<string, Task> = new Map();
  private runningAgents: Set<string> = new Set();

  constructor(
    private terminalService: TerminalService,
    private processRegistry: ProcessRegistry,
    private sandboxManager: SandboxManager
  ) {
    super();
  }

  /**
   * 注册 Agent 配置
   */
  async register(config: AgentConfig, autoStart: boolean = false): Promise<void> {
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
    this.emit('agent:registered', runtime);

    // 如果配置了自动启动，则立即启动 Agent
    if (autoStart) {
      await this.startAgent(config.id);
    }
  }

  /**
   * 启动 Agent（创建终端会话并执行启动命令）
   */
  async startAgent(agentId: string): Promise<{ sessionId: string }> {
    const agent = this.getRuntime(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    if (this.runningAgents.has(agentId)) {
      throw new Error(`Agent ${agentId} is already running`);
    }

    // 1. 创建沙箱（如果配置了）
    if (agent.config.sandbox?.enabled) {
      try {
        await this.sandboxManager.create(agentId, {
          workspaceRoot: agent.config.sandbox?.workspaceRoot || './workspaces',
          allowedPaths: agent.config.sandbox?.allowedPaths || [],
          networkAccess: agent.config.sandbox?.networkAccess || false,
          mode: agent.config.sandbox?.mode || 'restricted',
          resourceLimits: agent.config.sandbox?.resourceLimits || {},
        });
      } catch (error) {
        console.warn(`Failed to create sandbox for agent ${agentId}:`, error);
      }
    }

    // 2. 创建终端会话
    const session = this.terminalService.createSession(agentId, {
      cwd: agent.config.cwd,
      env: agent.config.env,
    });

    // 3. 注册进程
    this.processRegistry.register(session);

    // 4. 标记为运行中
    this.runningAgents.add(agentId);
    agent.status = 'running';
    agent.pid = session.pty?.pid;
    agent.startedAt = Date.now();

    this.emit('agent:started', agent);

    return { sessionId: session.id };
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
    return Array.from(this.agents.values()).filter(a => a.status === 'idle');
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
   * 根据任务描述自动选择角色
   */
  async selectRole(taskDescription: string): Promise<AgentRole> {
    const keywords: Record<AgentRole, string[]> = {
      researcher: ['搜索', '查找', '研究', 'search', 'find', 'research', '查', '文档'],
      coder: ['代码', '实现', '编写', '修复', 'code', 'implement', 'fix', 'write', '函数', '类'],
      reviewer: ['审查', '检查', '审计', 'review', 'audit', 'check', '安全'],
      tester: ['测试', '验证', 'test', 'verify', 'validate', '单元测试'],
      writer: ['文档', '说明', 'write', 'document', 'doc', 'README'],
      planner: ['规划', '计划', '拆解', 'plan', 'decompose', '分析'],
      custom: [],
    };

    const lowerDesc = taskDescription.toLowerCase();
    let bestRole: AgentRole = 'custom';
    let bestScore = 0;

    for (const [role, words] of Object.entries(keywords)) {
      const score = words.filter(w => lowerDesc.includes(w.toLowerCase())).length;
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
  async assignAgent(taskDescription: string): Promise<string | null> {
    // 1. 根据任务描述选择角色
    const role = await this.selectRole(taskDescription);

    // 2. 从池中获取该角色的空闲 Agent
    const agent = await this.acquireByRole(role);
    if (!agent) return null;

    return agent.id;
  }

  /**
   * 标记 Agent 为忙碌
   */
  private markBusy(agentId: string, taskId: string): void {
    const runtime = this.agents.get(agentId);
    if (!runtime) throw new Error(`Agent ${agentId} not found`);

    runtime.status = 'running';
    runtime.currentTask = {
      id: taskId,
      description: taskId,
      startedAt: Date.now(),
    };
  }

  /**
   * 标记 Agent 为空闲
   */
  private markIdle(agentId: string): void {
    const runtime = this.agents.get(agentId);
    if (!runtime) throw new Error(`Agent ${agentId} not found`);

    runtime.status = 'idle';
    runtime.currentTask = undefined;
    runtime.lastActivityAt = Date.now();
  }

  /**
   * 执行任务
   */
  async executeTask(
    agentId: string | undefined,
    taskDescription: string,
    options: {
      priority?: Task['priority'];
      createSandbox?: boolean;
    } = {}
  ): Promise<{ taskId: string; sessionId: string }> {
    // 1. 分配 Agent（如果未指定）
    const targetAgentId = agentId || await this.assignAgent(taskDescription);
    if (!targetAgentId) {
      throw new Error('No available agent for task');
    }

    const agent = this.getRuntime(targetAgentId);
    if (!agent) {
      throw new Error(`Agent ${targetAgentId} not found`);
    }

    // 2. 创建任务记录
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const task: Task = {
      id: taskId,
      agentId: targetAgentId,
      description: taskDescription,
      priority: options.priority || 'normal',
      status: 'running',
      createdAt: Date.now(),
      startedAt: Date.now(),
    };
    this.tasks.set(taskId, task);
    this.emit('task:started', task);

    // 3. 标记 Agent 为忙碌
    this.markBusy(targetAgentId, taskId);

    // 4. 创建沙箱（如果配置了）
    if (options.createSandbox || agent.config.sandbox?.enabled) {
      try {
        await this.sandboxManager.create(targetAgentId, {
          workspaceRoot: agent.config.sandbox?.workspaceRoot || './workspaces',
          allowedPaths: agent.config.sandbox?.allowedPaths || [],
          networkAccess: agent.config.sandbox?.networkAccess || false,
          mode: agent.config.sandbox?.mode || 'restricted',
          resourceLimits: agent.config.sandbox?.resourceLimits || {},
        });
      } catch (error) {
        console.warn(`Failed to create sandbox for agent ${targetAgentId}:`, error);
      }
    }

    // 5. 创建终端会话
    const session = this.terminalService.createSession(targetAgentId, {
      cwd: agent.config.cwd,
      env: agent.config.env,
    });

    // 6. 注册进程
    this.processRegistry.register(session);

    // 7. 绑定终端退出事件
    this.terminalService.once('session:exited', (exitedSession) => {
      if (exitedSession.id === session.id) {
        this.processRegistry.markExited(session.id, exitedSession.exitCode);
        this.markIdle(targetAgentId);
        task.status = 'completed';
        task.completedAt = Date.now();
        task.result = {
          success: exitedSession.exitCode === 0,
          output: this.terminalService.getOutput(session.id),
        };
        this.emit('task:completed', task);
      }
    });

    return { taskId, sessionId: session.id };
  }

  /**
   * 向 Agent 终端写入命令
   */
  writeCommand(sessionId: string, command: string): void {
    // 安全检查
    const session = this.terminalService.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // 检查沙箱命令安全
    const sandbox = this.sandboxManager.getByAgentId(session.agentId);
    if (sandbox) {
      const validation = this.sandboxManager.validateCommand(sandbox.id, command);
      if (!validation.allowed) {
        throw new Error(`Command rejected: ${validation.reason}`);
      }
    }

    this.terminalService.write(sessionId, command);
  }

  /**
   * 获取任务输出
   */
  getTaskOutput(sessionId: string, lines?: number): string {
    if (lines) {
      return this.terminalService.getTail(sessionId, lines);
    }
    return this.terminalService.getOutput(sessionId);
  }

  /**
   * 获取角色的 System Prompt
   */
  getSystemPrompt(role: AgentRole, customInstructions?: string): string {
    const base = ROLE_DESCRIPTIONS[role];
    const tools = ROLE_TOOLS[role].join(', ');
    const toolsPrompt = `你可以使用的工具：${tools}`;
    const customPrompt = customInstructions ? `特殊指令：${customInstructions}` : '';

    return [base, toolsPrompt, customPrompt].filter(Boolean).join('\n\n');
  }

  /**
   * 停止 Agent
   */
  async stopAgent(agentId: string): Promise<void> {
    const agent = this.getRuntime(agentId);
    if (!agent) return;

    // 关闭相关终端会话
    const sessions = this.terminalService.getByAgentId(agentId);
    for (const session of sessions) {
      this.terminalService.closeSession(session.id);
    }

    agent.status = 'stopped';
    this.runningAgents.delete(agentId);
    this.emit('agent:stopped', agent);
  }

  /**
   * 注销 Agent
   */
  async unregister(agentId: string): Promise<void> {
    await this.stopAgent(agentId);
    this.agents.delete(agentId);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    agents: { total: number; running: number; idle: number };
    tasks: { total: number; running: number; completed: number; failed: number };
    processes: ReturnType<ProcessRegistry['getStats']>;
  } {
    const allAgents = this.getAll();
    const processStats = this.processRegistry.getStats();

    return {
      agents: {
        total: allAgents.length,
        running: allAgents.filter(a => a.status === 'running').length,
        idle: allAgents.filter(a => a.status === 'idle').length,
      },
      tasks: {
        total: this.tasks.size,
        running: Array.from(this.tasks.values()).filter(t => t.status === 'running').length,
        completed: Array.from(this.tasks.values()).filter(t => t.status === 'completed').length,
        failed: Array.from(this.tasks.values()).filter(t => t.status === 'failed').length,
      },
      processes: processStats,
    };
  }
}
