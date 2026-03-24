/**
 * Huangdi Orchestrator - Plugin Entry Point
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { DashboardServer } from './dashboard/DashboardServer';
import type { DashboardEvent, RoleId } from './dashboard/types';
import { HierarchicalContextEngine, createHierarchicalContext } from './context/HierarchicalContextEngine';
import { CrossAgentMemoryRouter, createMemoryRouter } from './memory/CrossAgentMemoryRouter';
import { SemanticCache } from './memory/SemanticCache';

/**
 * Huangdi Orchestrator Plugin Class
 */
class HuangdiPlugin {
  id = 'huangdi-orchestrator';
  name = 'Huangdi Orchestrator';
  description = 'Multi-agent orchestrator with task decomposition, role-based routing, and memory optimization';

  // Context and Memory management
  private contextEngine: HierarchicalContextEngine | null = null;
  private memoryRouter: CrossAgentMemoryRouter | null = null;
  private semanticCache: SemanticCache | null = null;
  private dashboardServer: DashboardServer | null = null;

  /**
   * Plugin registration
   */
  register(api: OpenClawPluginApi) {
    api.logger.info('Huangdi Orchestrator registered');
  }

  /**
   * Plugin activation
   */
  async activate(api: OpenClawPluginApi) {
    const logger = api.logger;

    logger.info('Huangdi Orchestrator activating...');

    // Initialize Context and Memory systems
    this.contextEngine = createHierarchicalContext('medium');
    this.memoryRouter = createMemoryRouter('medium');
    this.semanticCache = new SemanticCache({
      maxSize: 500,
      similarityThreshold: 0.9,
      defaultTtl: 3600000,
      embeddingDimension: 384
    });

    // Inject Memory API into runtime (type-safe)
    this.injectMemoryApi(api);

    // Initialize Dashboard Server
    this.dashboardServer = new DashboardServer(3456, 1000, 2000);
    this.dashboardServer.setApi(api);

    try {
      const port = await this.dashboardServer.start();
      this.dashboardServer.createWebSocketServer();
      logger.info(`Dashboard server started on http://localhost:${port}`);
    } catch (error) {
      logger.error(`Failed to start Dashboard server: ${error}`);
    }

    // Register subagent lifecycle hooks
    api.on("subagent_spawning", async (event) => {
      logger.debug?.('Subagent spawning');

      if (!this.dashboardServer) return;

      // Create agent in spawning state
      const agentManager = this.dashboardServer.getAgentManager();
      const agent = agentManager.addSpawningAgent(event.childSessionKey, event.childSessionKey);

      // Broadcast spawning event
      const spawnEvent: DashboardEvent = {
        id: `evt_${Date.now()}_${event.childSessionKey}`,
        type: 'agent_spawning',
        timestamp: Date.now(),
        agentId: event.childSessionKey,
        payload: { spawningStatus: 'spawning' },
      };
      this.dashboardServer.broadcastEvent(spawnEvent);

      logger.info(`Agent ${event.childSessionKey} spawning (${agent.roleId})`);
    });

    api.on("subagent_spawned", async (event) => {
      logger.debug?.('Subagent spawned');

      if (!this.dashboardServer) return;

      const agentManager = this.dashboardServer.getAgentManager();
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
        this.dashboardServer.broadcastEvent(spawnedEvent);

        logger.info(`Agent ${event.childSessionKey} spawned as ${roleId}`);
      }
    });

    api.on("subagent_ended", async (event) => {
      logger.debug?.('Subagent ended');

      if (!this.dashboardServer) return;

      const agentManager = this.dashboardServer.getAgentManager();
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
        this.dashboardServer.broadcastEvent(endedEvent);

        logger.info(`Agent ${event.targetSessionKey} ended (${event.outcome})`);
      }
    });

    // Register before_prompt_build hook for memory injection
    api.on("before_prompt_build", async (event) => {
      try {
        // Get agent ID from event
        const agentId = (event as any).agentId || `agent_${Date.now()}`;

        // Set agent context in context engine
        if (this.contextEngine) {
          this.contextEngine.setAgentContext(agentId);
        }

        // Search memories with fallback strategy
        let memories: any[] = [];

        if (this.contextEngine) {
          // Primary: Use context engine search
          memories = await this.contextEngine.searchMemories(event.prompt, {
            limit: 5,
            agentId
          });
        } else if (this.memoryRouter) {
          // Fallback: Use memory router
          const results = await this.memoryRouter.query(agentId, event.prompt, 'all', 5);
          memories = results.flatMap(r => r.memories);
        } else if (api.runtime.memory?.search) {
          // Final fallback: Use runtime memory if available
          // @ts-ignore - memory may not be defined in all runtime types
          memories = await api.runtime.memory.search(event.prompt, { limit: 5 });
        }

        if (memories && memories.length > 0) {
          const contextText = memories
            .map((m: any) => `- ${m.content}`)
            .join("\n");

          return {
            prependContext: `Relevant memories from previous conversations:\n${contextText}\n`
          };
        }
      } catch (error) {
        logger.warn(`Memory injection failed: ${error}`);
      }

      return undefined;
    });

    logger.info('Huangdi Orchestrator activated');
  }

  /**
   * Inject type-safe Memory API into OpenClaw runtime
   */
  private injectMemoryApi(api: OpenClawPluginApi) {
    const self = this;

    // Extend the runtime with memory capabilities
    (api.runtime as any).memory = {
      /**
       * Search memories
       */
      async search(query: string, options?: {
        limit?: number;
        scope?: 'local' | 'team' | 'global' | 'all';
        agentId?: string;
      }) {
        if (self.contextEngine) {
          return self.contextEngine.searchMemories(query, {
            limit: options?.limit,
            scope: options?.scope,
            agentId: options?.agentId
          });
        }
        if (self.memoryRouter) {
          const results = await self.memoryRouter.query(
            options?.agentId || '',
            query,
            options?.scope || 'all',
            options?.limit || 10
          );
          return results.flatMap(r => r.memories);
        }
        return [];
      },

      /**
       * Add a memory
       */
      async add(content: string, metadata?: {
        agentId?: string;
        taskId?: string;
        teamId?: string;
        importance?: number;
        tags?: string[];
      }) {
        if (self.memoryRouter) {
          return self.memoryRouter.addMemory(
            metadata?.agentId || 'default',
            content,
            {
              source: 'plugin',
              agentId: metadata?.agentId,
              taskId: metadata?.taskId,
              teamId: metadata?.teamId,
              timestamp: Date.now(),
              importance: metadata?.importance ?? 0.5,
              tags: metadata?.tags
            }
          );
        }
        return '';
      },

      /**
       * Get context for an agent
       */
      async getContext(agentId: string) {
        if (self.contextEngine) {
          self.contextEngine.setAgentContext(agentId);
          return self.contextEngine.getOptimizedContext();
        }
        return [];
      }
    };
  }
}

/**
 * Plugin instance
 */
const plugin = new HuangdiPlugin();

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
