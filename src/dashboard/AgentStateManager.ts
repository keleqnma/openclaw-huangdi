/**
 * Huangdi Dashboard - Agent State Manager
 * Manages agent state tracking and polling logic
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { AgentState, AgentStatus, RoleId, AvatarConfig, MessageEntry } from './types';

/**
 * Role configurations based on RoleRouter
 */
const ROLE_CONFIGS: Record<RoleId, { emoji: string; color: string }> = {
  researcher: { emoji: '🔍', color: '#FF9F43' }, // 橙色
  coder: { emoji: '👨‍💻', color: '#54A0FF' },    // 蓝色
  reviewer: { emoji: '👓', color: '#A55EEA' },   // 紫色
  tester: { emoji: '🧪', color: '#42D18E' },     // 绿色
  writer: { emoji: '✍️', color: '#FF6B9D' },     // 粉色
  planner: { emoji: '📋', color: '#FFD93D' },    // 黄色
};

/**
 * AgentStateManager - Tracks agent state and polls for messages
 */
export class AgentStateManager {
  private agents: Map<string, AgentState> = new Map();
  private pollIntervals: Map<string, NodeJS.Timeout> = new Map();
  private pollErrors: Map<string, number> = new Map(); // Track consecutive errors per agent
  private api: OpenClawPluginApi | null = null;
  private pollInterval: number;
  private readonly MAX_AGENTS = 100; // Maximum concurrent agents to prevent memory explosion
  private readonly MAX_CONSECUTIVE_ERRORS = 5; // Stop polling after 5 consecutive errors

  constructor(pollInterval: number = 2000) {
    this.pollInterval = pollInterval;
  }

  /**
   * Initialize with plugin API
   */
  setApi(api: OpenClawPluginApi): void {
    this.api = api;
  }

  /**
   * Create avatar config for a role
   */
  private createAvatarConfig(roleId: RoleId, variant: number = 0): AvatarConfig {
    const config = ROLE_CONFIGS[roleId];
    return {
      roleId,
      emoji: config.emoji,
      color: config.color,
      variant,
    };
  }

  /**
   * Add a new agent in spawning state
   */
  addSpawningAgent(runId: string, sessionKey: string): AgentState | undefined {
    // Prevent memory explosion by limiting concurrent agents
    if (this.agents.size >= this.MAX_AGENTS) {
      this.api?.logger.warn(`Maximum agent limit (${this.MAX_AGENTS}) reached. Rejecting new agent: ${runId}`);
      return undefined;
    }

    const agent: AgentState = {
      runId,
      sessionKey,
      roleId: 'planner', // Default role until assigned
      status: 'spawning',
      messages: [],
      startTime: Date.now(),
      avatar: this.createAvatarConfig('planner'),
    };

    this.agents.set(runId, agent);
    this.pollErrors.set(runId, 0); // Initialize error counter
    return agent;
  }

  /**
   * Update agent when spawned (assign role and task)
   */
  updateAgentSpawned(
    runId: string,
    roleId: RoleId,
    task?: string
  ): AgentState | undefined {
    const agent = this.agents.get(runId);
    if (!agent) return undefined;

    agent.roleId = roleId;
    agent.task = task;
    agent.status = 'idle';
    agent.avatar = this.createAvatarConfig(roleId);

    // Start polling for messages
    this.startPolling(runId);

    return agent;
  }

  /**
   * Update agent status
   */
  updateAgentStatus(runId: string, status: AgentStatus): AgentState | undefined {
    const agent = this.agents.get(runId);
    if (!agent) return undefined;

    agent.status = status;
    if (status === 'completed' || status === 'error') {
      agent.endTime = Date.now();
      this.stopPolling(runId);
    }

    return agent;
  }

  /**
   * Update agent input/output
   */
  updateAgentIO(
    runId: string,
    input?: string,
    output?: string
  ): AgentState | undefined {
    const agent = this.agents.get(runId);
    if (!agent) return undefined;

    if (input !== undefined) agent.input = input;
    if (output !== undefined) agent.output = output;

    return agent;
  }

  /**
   * Poll messages for an agent
   */
  private async pollMessages(runId: string): Promise<MessageEntry[]> {
    const agent = this.agents.get(runId);
    if (!agent || !this.api) return [];

    try {
      const result = await this.api.runtime.subagent.getSessionMessages({
        sessionKey: agent.sessionKey,
        limit: 50,
      });

      // Reset error counter on success
      this.pollErrors.set(runId, 0);

      return result.messages.map((msg: any, index) => ({
        id: msg.id || `msg_${runId}_${index}`,
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
        timestamp: Date.now(),
        type: this.determineMessageType(msg),
      }));
    } catch (error) {
      // Track consecutive errors
      const consecutiveErrors = (this.pollErrors.get(runId) || 0) + 1;
      this.pollErrors.set(runId, consecutiveErrors);

      this.api?.logger.warn(`Failed to poll messages for ${runId} (error #${consecutiveErrors}): ${error}`);

      // Auto-stop polling after too many consecutive errors
      if (consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
        this.api?.logger.error(`Too many consecutive errors for ${runId}. Stopping polling.`);
        this.stopPolling(runId);
      }

      return [];
    }
  }

  /**
   * Determine message type from raw message
   */
  private determineMessageType(msg: any): MessageEntry['type'] {
    if (msg.role === 'user') return 'input';
    if (msg.role === 'assistant') return 'output';
    if (msg.tool_results) return 'tool_result';
    return 'output';
  }

  /**
   * Start polling for an agent's messages
   */
  private startPolling(runId: string): void {
    // Prevent memory explosion by limiting concurrent agents
    if (this.pollIntervals.size >= this.MAX_AGENTS) {
      this.api?.logger.warn(`Maximum polling intervals (${this.MAX_AGENTS}) reached. Rejecting poll for: ${runId}`);
      return;
    }

    // Clear existing interval if any
    this.stopPolling(runId);

    const interval = setInterval(async () => {
      try {
        const agent = this.agents.get(runId);
        if (!agent) {
          this.stopPolling(runId);
          return;
        }

        const newMessages = await this.pollMessages(runId);

        // Update agent messages if there are new ones
        if (newMessages.length > agent.messages.length) {
          agent.messages = newMessages;

          // Update input/output from latest messages
          const latestInput = newMessages.filter(m => m.type === 'input').pop();
          const latestOutput = newMessages.filter(m => m.type === 'output').pop();

          if (latestInput) agent.input = latestInput.content;
          if (latestOutput) agent.output = latestOutput.content;
        }
      } catch (error) {
        // Catch any unhandled errors to prevent interval leak
        this.api?.logger.error(`Unhandled error in polling interval for ${runId}: ${error}`);
        this.stopPolling(runId);
      }
    }, this.pollInterval);

    this.pollIntervals.set(runId, interval);
  }

  /**
   * Stop polling for an agent
   */
  private stopPolling(runId: string): void {
    const interval = this.pollIntervals.get(runId);
    if (interval) {
      clearInterval(interval);
      this.pollIntervals.delete(runId);
    }
    // Also clean up error counter
    this.pollErrors.delete(runId);
  }

  /**
   * Get agent state by runId
   */
  getAgent(runId: string): AgentState | undefined {
    return this.agents.get(runId);
  }

  /**
   * Get all agents
   */
  getAllAgents(): AgentState[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get active (non-completed) agents
   */
  getActiveAgents(): AgentState[] {
    return Array.from(this.agents.values()).filter(
      a => a.status !== 'completed' && a.status !== 'error'
    );
  }

  /**
   * Remove an agent
   */
  removeAgent(runId: string): void {
    this.stopPolling(runId);
    this.agents.delete(runId);
  }

  /**
   * Clear all agents and stop polling
   */
  clear(): void {
    for (const runId of this.pollIntervals.keys()) {
      this.stopPolling(runId);
    }
    this.agents.clear();
    this.pollIntervals.clear();
    this.pollErrors.clear();
  }

  /**
   * Get statistics about polling
   */
  getStats(): {
    totalAgents: number;
    activePolls: number;
    pollingIntervals: Map<string, number>;
  } {
    const pollingIntervals = new Map<string, number>();
    for (const [runId, _interval] of this.pollIntervals.entries()) {
      pollingIntervals.set(runId, this.pollErrors.get(runId) || 0);
    }

    return {
      totalAgents: this.agents.size,
      activePolls: this.pollIntervals.size,
      pollingIntervals,
    };
  }
}
