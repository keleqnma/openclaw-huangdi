/**
 * Huangdi Orchestrator - Plugin Entry Point
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

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

    // Register subagent lifecycle hooks for logging
    api.on("subagent_spawning", () => logger.debug?.('Subagent spawning'));
    api.on("subagent_spawned", () => logger.debug?.('Subagent spawned'));
    api.on("subagent_ended", () => logger.debug?.('Subagent ended'));

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

export default plugin;

/**
 * Named exports for backwards compatibility
 */
export const { register } = plugin;
export const { activate } = plugin;
