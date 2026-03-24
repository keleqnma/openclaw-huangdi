/**
 * Huangdi Orchestrator - Plugin Entry Point
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { DashboardServer } from './dashboard/DashboardServer';
import type { DashboardEvent, RoleId } from './dashboard/types';

/**
 * Huangdi Orchestrator Plugin
 */
const plugin = {
  id: 'huangdi-orchestrator',
  name: 'Huangdi Orchestrator',
  description: 'Multi-agent orchestrator with task decomposition, role-based routing, and memory optimization',

  /**
   * Plugin registration
   */
  register(api: OpenClawPluginApi) {
    api.logger.info('Huangdi Orchestrator registered');
  },

  /**
   * Plugin activation
   */
  async activate(api: OpenClawPluginApi) {
    const logger = api.logger;

    logger.info('Huangdi Orchestrator activating...');

    // Initialize Dashboard Server
    const dashboardServer = new DashboardServer(3456, 1000, 2000);
    dashboardServer.setApi(api);

    try {
      const port = await dashboardServer.start();
      dashboardServer.createWebSocketServer();
      logger.info(`Dashboard server started on http://localhost:${port}`);
    } catch (error) {
      logger.error(`Failed to start Dashboard server: ${error}`);
    }

    // Register subagent lifecycle hooks
    api.on("subagent_spawning", async (event) => {
      logger.debug?.('Subagent spawning');

      // Create agent in spawning state
      const agentManager = dashboardServer.getAgentManager();
      const agent = agentManager.addSpawningAgent(event.childSessionKey, event.childSessionKey);

      // Broadcast spawning event
      const spawnEvent: DashboardEvent = {
        id: `evt_${Date.now()}_${event.childSessionKey}`,
        type: 'agent_spawning',
        timestamp: Date.now(),
        agentId: event.childSessionKey,
        payload: { spawningStatus: 'spawning' },
      };
      dashboardServer.broadcastEvent(spawnEvent);

      logger.info(`Agent ${event.childSessionKey} spawning (${agent.roleId})`);
    });

    api.on("subagent_spawned", async (event) => {
      logger.debug?.('Subagent spawned');

      const agentManager = dashboardServer.getAgentManager();
      const agent = agentManager.getAgent(event.childSessionKey);

      if (agent) {
        // Determine role from label or default to planner
        const roleId = detectRoleIdFromLabel(event.label || '');

        // Update agent state
        agentManager.updateAgentSpawned(event.childSessionKey, roleId, event.label);

        // Broadcast spawned event
        const spawnedEvent: DashboardEvent = {
          id: `evt_${Date.now()}_${event.childSessionKey}`,
          type: 'agent_spawned',
          timestamp: Date.now(),
          agentId: event.childSessionKey,
          payload: { roleId, task: event.label },
        };
        dashboardServer.broadcastEvent(spawnedEvent);

        logger.info(`Agent ${event.childSessionKey} spawned as ${roleId}`);
      }
    });

    api.on("subagent_ended", async (event) => {
      logger.debug?.('Subagent ended');

      const agentManager = dashboardServer.getAgentManager();
      const agent = agentManager.getAgent(event.targetSessionKey);

      if (agent) {
        // Map outcome to dashboard status
        let status: 'completed' | 'error' = 'completed';
        let outcome: 'ok' | 'error' | 'timeout' | 'killed' = 'ok';

        if (event.outcome === 'ok') {
          status = 'completed';
          outcome = 'ok';
        } else if (event.outcome === 'error') {
          status = 'error';
          outcome = 'error';
        } else if (event.outcome === 'timeout') {
          status = 'error';
          outcome = 'timeout';
        } else if (event.outcome === 'killed') {
          status = 'error';
          outcome = 'killed';
        }
        // reset/deleted treated as completed for dashboard purposes

        // Update agent state
        agentManager.updateAgentStatus(event.targetSessionKey, status);

        // Broadcast ended event
        const endedEvent: DashboardEvent = {
          id: `evt_${Date.now()}_${event.targetSessionKey}`,
          type: 'agent_ended',
          timestamp: Date.now(),
          agentId: event.targetSessionKey,
          payload: {
            outcome,
            error: event.error,
          },
        };
        dashboardServer.broadcastEvent(endedEvent);

        logger.info(`Agent ${event.targetSessionKey} ended (${event.outcome})`);
      }
    });

    // Register before_prompt_build hook for memory injection
    api.on("before_prompt_build", async (event) => {
      try {
        // @ts-ignore - memory may not be defined in all runtime types
        const memories = await api.runtime.memory?.search?.(event.prompt, { limit: 5 });

        if (memories && memories.length > 0) {
          const contextText = memories
            .map((m: any) => `- ${m.content}`)
            .join("\n");

          return {
            prependContext: `Relevant memories from previous conversations:\n${contextText}\n`
          };
        }
      } catch (error) {
        logger.warn(`Memory search failed: ${error}`);
      }

      return undefined;
    });

    logger.info('Huangdi Orchestrator activated');
  }
};

/**
 * Detect role ID from task/label description
 */
function detectRoleIdFromLabel(label: string): RoleId {
  const labelLower = label.toLowerCase();

  // Keywords for each role
  if (labelLower.includes('搜索') || labelLower.includes('研究') || labelLower.includes('分析') ||
      labelLower.includes('search') || labelLower.includes('research') || labelLower.includes('analyze')) {
    return 'researcher';
  }

  if (labelLower.includes('代码') || labelLower.includes('编程') || labelLower.includes('函数') ||
      labelLower.includes('写') || labelLower.includes('code') || labelLower.includes('program') ||
      labelLower.includes('function') || labelLower.includes('write')) {
    return 'coder';
  }

  if (labelLower.includes('审核') || labelLower.includes('审查') || labelLower.includes('检查') ||
      labelLower.includes('review') || labelLower.includes('audit') || labelLower.includes('check')) {
    return 'reviewer';
  }

  if (labelLower.includes('测试') || labelLower.includes('test') || labelLower.includes('unit')) {
    return 'tester';
  }

  if (labelLower.includes('文档') || labelLower.includes('写文章') ||
      labelLower.includes('document') || labelLower.includes('write') || labelLower.includes('article')) {
    return 'writer';
  }

  if (labelLower.includes('规划') || labelLower.includes('计划') || labelLower.includes('分解') ||
      labelLower.includes('plan') || labelLower.includes('decompose')) {
    return 'planner';
  }

  // Default to planner for task decomposition
  return 'planner';
}

export default plugin;

/**
 * Named exports for backwards compatibility
 */
export const { register } = plugin;
export const { activate } = plugin;
