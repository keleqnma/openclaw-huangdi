/**
 * Huangdi Orchestrator - Role Router
 *
 * Routes tasks to appropriate agent roles based on task type and current load.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

export interface RoleDefinition {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  maxConcurrency: number;
}

export interface AgentLoad {
  agentId: string;
  activeTasks: number;
  queueLength: number;
  avgResponseTime: number;  // ms
  healthScore: number;      // 0-1
}

export interface RoleAssignment {
  roleId: string;
  agentId: string;
  confidence: number;
}

export interface LoadBalancerConfig {
  taskWeight: number;
  queueWeight: number;
  latencyWeight: number;
  healthWeight: number;
}

export class RoleRouter {
  private roles = new Map<string, RoleDefinition>();
  private agentLoads = new Map<string, AgentLoad>();
  private roleAgents = new Map<string, string[]>();

  private defaultConfig: LoadBalancerConfig = {
    taskWeight: 0.4,
    queueWeight: 0.3,
    latencyWeight: 0.2,
    healthWeight: 0.1
  };

  constructor(
    private pluginApi: OpenClawPluginApi,
    private config: Partial<LoadBalancerConfig> = {}
  ) {
    this.registerDefaultRoles();
  }

  /**
   * Register default role definitions
   */
  private registerDefaultRoles() {
    this.roles.set('researcher', {
      id: 'researcher',
      name: 'Research Specialist',
      description: 'Expert in web search, document retrieval, and information synthesis',
      systemPrompt: 'You are a research specialist. You excel at finding and synthesizing information from multiple sources. Always cite your sources and provide comprehensive summaries.',
      tools: ['web-search', 'document-retrieval', 'summarization'],
      maxConcurrency: 5
    });

    this.roles.set('coder', {
      id: 'coder',
      name: 'Programming Expert',
      description: 'Expert in code generation, refactoring, and debugging',
      systemPrompt: 'You are an expert programmer. You write clean, efficient, and well-documented code. Follow best practices and explain your decisions.',
      tools: ['file-read', 'file-write', 'code-execution', 'linting'],
      maxConcurrency: 3
    });

    this.roles.set('reviewer', {
      id: 'reviewer',
      name: 'Code Review Expert',
      description: 'Expert in code review, security analysis, and best practices',
      systemPrompt: 'You are a code review expert. You identify bugs, security issues, and suggest improvements. Provide constructive feedback with examples.',
      tools: ['file-read', 'diff-analysis', 'security-scan'],
      maxConcurrency: 5
    });

    this.roles.set('tester', {
      id: 'tester',
      name: 'QA Specialist',
      description: 'Expert in test generation, execution, and coverage analysis',
      systemPrompt: 'You are a QA specialist. You write comprehensive tests and ensure code quality. Focus on edge cases and error handling.',
      tools: ['test-runner', 'coverage-analysis', 'e2e-testing'],
      maxConcurrency: 4
    });

    this.roles.set('writer', {
      id: 'writer',
      name: 'Content Writer',
      description: 'Expert in documentation, content creation, and editing',
      systemPrompt: 'You are a content writer. You create clear, engaging, and well-structured documentation. Use appropriate formatting and examples.',
      tools: ['file-read', 'file-write', 'markdown-format'],
      maxConcurrency: 4
    });

    this.roles.set('planner', {
      id: 'planner',
      name: 'Task Planner',
      description: 'Expert in task decomposition and project planning',
      systemPrompt: 'You are a task planner. You break down complex goals into actionable steps. Identify dependencies and prioritize effectively.',
      tools: ['task-analysis', 'planning'],
      maxConcurrency: 6
    });
  }

  /**
   * Route a task to the most appropriate role and agent
   */
  async routeTask(task: string): Promise<RoleAssignment> {
    // 1. Classify task type
    const taskType = await this.classifyTask(task);

    // 2. Match to best role
    const bestRole = this.matchRoleToTask(taskType);

    // 3. Find available agent (considering load)
    const availableAgent = await this.findAvailableAgent(bestRole);

    // 4. Compute confidence score
    const confidence = await this.computeConfidence(task, bestRole);

    return {
      roleId: bestRole,
      agentId: availableAgent,
      confidence
    };
  }

  /**
   * Classify task into categories
   */
  private async classifyTask(task: string): Promise<string> {
    const prompt = `
Classify this task into exactly one of these categories:
- research: Information gathering, search, analysis
- coding: Writing, modifying, or debugging code
- review: Code review, quality check, security analysis
- testing: Writing or running tests
- writing: Documentation, content creation
- planning: Task decomposition, project planning
- other: Everything else

Task: ${task}

Return only the category name in lowercase.
`;

    try {
      // @ts-ignore - llm method may be available through runtime
      const response = await this.pluginApi.llm?.generate?.(prompt);
      return response.trim().toLowerCase();
    } catch (error) {
      return 'other';
    }
  }

  /**
   * Match task category to role
   */
  private matchRoleToTask(taskType: string): string {
    const mapping: Record<string, string> = {
      'research': 'researcher',
      'coding': 'coder',
      'review': 'reviewer',
      'testing': 'tester',
      'writing': 'writer',
      'planning': 'planner'
    };
    return mapping[taskType] || 'researcher';
  }

  /**
   * Find available agent for a role considering current load
   */
  private async findAvailableAgent(roleId: string): Promise<string> {
    const roleAgents = this.roleAgents.get(roleId) || [];

    if (roleAgents.length === 0) {
      // No specific agents registered for this role
      // Return a default agent ID
      return `default-${roleId}`;
    }

    let bestAgent: string | null = null;
    let bestScore = Infinity;

    for (const agentId of roleAgents) {
      const load = this.agentLoads.get(agentId);
      if (!load) continue;

      // Skip if at max concurrency
      if (load.activeTasks >= load.healthScore * 10) {
        continue;
      }

      const score = this.computeLoadScore(load);
      if (score < bestScore) {
        bestScore = score;
        bestAgent = agentId;
      }
    }

    return bestAgent || roleAgents[0];
  }

  /**
   * Compute load score for an agent (lower is better)
   */
  private computeLoadScore(load: AgentLoad): number {
    const config = { ...this.defaultConfig, ...this.config };

    const normalizedTasks = load.activeTasks;
    const normalizedQueue = load.queueLength * 2;
    const normalizedLatency = load.avgResponseTime / 1000;
    const healthPenalty = (1 - load.healthScore) * 10;

    return (
      normalizedTasks * config.taskWeight +
      normalizedQueue * config.queueWeight +
      normalizedLatency * config.latencyWeight +
      healthPenalty * config.healthWeight
    );
  }

  /**
   * Compute confidence score for role-task match
   */
  private async computeConfidence(
    task: string,
    roleId: string
  ): Promise<number> {
    const role = this.roles.get(roleId);
    if (!role) return 0.5;

    const prompt = `
On a scale of 1-10, how well does this role match the task?

Role: ${role.name}
Description: ${role.description}
Tools: ${role.tools.join(', ')}
Task: ${task}

Return only a single integer from 1 to 10.
`;

    try {
      // @ts-ignore - llm method may be available through runtime
      const response = await this.pluginApi.llm?.generate?.(prompt);
      const score = parseInt(response.trim());
      return isNaN(score) ? 0.5 : score / 10;
    } catch (error) {
      return 0.5;
    }
  }

  /**
   * Register an agent for a role
   */
  registerAgent(roleId: string, agentId: string) {
    if (!this.roleAgents.has(roleId)) {
      this.roleAgents.set(roleId, []);
    }
    const agents = this.roleAgents.get(roleId)!;
    if (!agents.includes(agentId)) {
      agents.push(agentId);
    }
  }

  /**
   * Update agent load information
   */
  updateAgentLoad(load: AgentLoad) {
    this.agentLoads.set(load.agentId, load);
  }

  /**
   * Get all registered roles
   */
  getRegisteredRoles(): RoleDefinition[] {
    return Array.from(this.roles.values());
  }

  /**
   * Get role by ID
   */
  getRole(roleId: string): RoleDefinition | undefined {
    return this.roles.get(roleId);
  }
}
