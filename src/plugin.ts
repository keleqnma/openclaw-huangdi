/**
 * Huangdi Orchestrator - Plugin Entry Point
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { TaskDecomposer } from "./coordinator/TaskDecomposer";
import { RoleRouter } from "./coordinator/RoleRouter";
import { createCircuitBreaker } from "./coordinator/CircuitBreaker";
import { createRetryManager } from "./coordinator/RetryManager";
import { createTimeoutManager } from "./coordinator/TimeoutManager";
import { createSemanticCache } from "./memory/SemanticCache";
import { createHybridSearchEngine } from "./memory/HybridSearchEngine";
import { createHierarchicalContext } from "./context/HierarchicalContextEngine";
import { PositionOptimizer } from "./context/PositionOptimizer";

/**
 * Plugin registration
 */
export function register(api: OpenClawPluginApi) {
  // Register Context Engine
  api.registerContextEngine("huangdi-smart", () => {
    return createHierarchicalContext('medium');
  });

  api.logger.info('Huangdi Orchestrator registered');
}

/**
 * Plugin activation
 */
export async function activate(api: OpenClawPluginApi) {
  const logger = api.logger;

  logger.info('Huangdi Orchestrator activating...');

  // Initialize components
  const taskDecomposer = new TaskDecomposer(api);
  const roleRouter = new RoleRouter(api);
  const circuitBreaker = createCircuitBreaker('moderate');
  const retryManager = createRetryManager('moderate');
  const timeoutManager = createTimeoutManager('standard');
  const semanticCache = createSemanticCache('medium');
  const hybridSearch = createHybridSearchEngine('balanced');
  const positionOptimizer = new PositionOptimizer();

  // Register subagent lifecycle hooks
  api.on("subagent_spawning", async (event, ctx) => {
    logger.debug(`Subagent spawning: ${event.runId}`);

    // Prepare context inheritance
    const context = await prepareSubagentContext(api, event.parentSessionKey);
    return { prependContext: context };
  });

  api.on("subagent_spawned", async (event, ctx) => {
    logger.debug(`Subagent spawned: ${event.runId}`);
    // Could register to monitoring here
  });

  api.on("subagent_ended", async (event, ctx) => {
    logger.debug(`Subagent ended: ${event.runId}`);
    // Could aggregate results here
  });

  // Register before_prompt_build hook for memory injection
  api.on("before_prompt_build", async (event, ctx) => {
    // Search memory and inject relevant context
    const memories = await searchMemories(
      event.prompt,
      semanticCache,
      hybridSearch,
      api.runtime.memory
    );

    if (memories.length > 0) {
      const contextText = memories
        .map(m => `- ${m.content}`)
        .join("\n");

      return {
        prependContext: `Relevant memories from previous conversations:\n${contextText}\n`
      };
    }

    return undefined;
  });

  logger.info('Huangdi Orchestrator activated');
}

/**
 * Prepare context for subagent inheritance
 */
async function prepareSubagentContext(
  api: OpenClawPluginApi,
  parentSessionKey: string
): Promise<string> {
  // Get recent conversation from parent session
  // This is a placeholder - implement based on OpenClaw API
  return "";
}

/**
 * Search memories with caching and hybrid search
 */
async function searchMemories(
  query: string,
  cache: ReturnType<typeof createSemanticCache>,
  searchEngine: ReturnType<typeof createHybridSearchEngine>,
  memoryIndex: any
): Promise<Array<{ content: string; score: number }>> {
  try {
    // Check cache first
    const cached = await cache.get(query);
    if (cached) {
      return cached as Array<{ content: string; score: number }>;
    }

    // Search memory
    const results = await memoryIndex.search(query, { limit: 10 });

    if (results.length > 0) {
      await cache.set(query, results);
    }

    return results;
  } catch (error) {
    return [];
  }
}
