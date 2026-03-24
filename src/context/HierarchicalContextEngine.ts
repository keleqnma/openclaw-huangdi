/**
 * Huangdi Orchestrator - Hierarchical Context Engine (Enhanced)
 *
 * Manages context with layered architecture for optimal token usage
 * and information retention.
 *
 * Enhanced with:
 * - 4-layer context management (System, Task, Team, Local)
 * - Memory integration with HybridSearchEngine
 * - Cross-agent context synchronization
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { PositionOptimizer, type PositionOptimizerConfig } from "./PositionOptimizer";
import { HybridSearchEngine, type SearchResult } from "../memory/HybridSearchEngine";

/**
 * Context layer types
 */
export type ContextLayerType = 'system' | 'task' | 'team' | 'local';

/**
 * Memory record for context storage
 */
export interface MemoryRecord {
  id: string;
  content: string;
  embedding?: number[];
  metadata: {
    source: string;
    agentId?: string;
    taskId?: string;
    teamId?: string;
    timestamp: number;
    importance: number;
    tags?: string[];
  };
}

/**
 * Context layer with memory support
 */
export interface ContextLayer {
  /** Layer type */
  type: ContextLayerType;
  /** Layer name */
  name: string;
  /** Layer priority (lower = more important, kept longer) */
  priority: number;
  /** Messages in this layer */
  messages: AgentMessage[];
  /** Memories in this layer */
  memories: MemoryRecord[];
  /** Token budget for this layer (optional) */
  tokenBudget?: number;
  /** Whether to compress messages in this layer */
  compressible: boolean;
}

/**
 * Hierarchical context configuration
 */
export interface HierarchicalContextConfig {
  /** Token budget for entire context */
  totalTokenBudget: number;
  /** Per-layer token budgets */
  layerBudgets: Record<string, number>;
  /** Position optimizer config */
  positionOptimizer: Partial<PositionOptimizerConfig>;
  /** Enable automatic compression */
  enableCompression: boolean;
  /** Compression threshold (tokens) */
  compressionThreshold: number;
  /** Enable memory search */
  enableMemorySearch: boolean;
  /** Memory search limit */
  memorySearchLimit: number;
}

/**
 * Context snapshot for debugging/monitoring
 */
export interface ContextSnapshot {
  layers: ContextLayer[];
  totalMessages: number;
  totalTokens: number;
  compressedLayers: string[];
  memoryCount: number;
}

/**
 * Search options for memory queries
 */
export interface ContextSearchOptions {
  query?: string;
  limit?: number;
  scope?: 'local' | 'team' | 'global' | 'all';
  agentId?: string;
  taskId?: string;
}

/**
 * Hierarchical Context Engine
 *
 * Organizes context into layers:
 * 1. System Layer (priority: 0): Core instructions, always retained
 * 2. Task Layer (priority: 10): Current task details and constraints
 * 3. Team Layer (priority: 20): Shared team knowledge
 * 4. Local Layer (priority: 30): Agent-specific working context
 *
 * Benefits:
 * - Predictable token usage per layer
 * - Graceful degradation under pressure
 * - Clear priorities for what to keep/discard
 * - Memory integration for intelligent retrieval
 */
export class HierarchicalContextEngine {
  // Four context layers
  private systemLayer: ContextLayer;
  private taskLayer: ContextLayer;
  private teamLayer: ContextLayer;
  private localLayer: ContextLayer;

  // Memory management
  private memories: Map<string, MemoryRecord[]> = new Map();
  private searchEngine: HybridSearchEngine;

  // Configuration
  private config: HierarchicalContextConfig;
  private positionOptimizer: PositionOptimizer;

  // Agent/Team metadata
  private currentAgentId?: string;
  private currentTeamId?: string;
  private currentTaskId?: string;

  constructor(config?: Partial<HierarchicalContextConfig>) {
    this.config = {
      totalTokenBudget: 128000,
      layerBudgets: {
        system: 8000,
        task: 16000,
        team: 32000,
        local: 72000
      },
      enableCompression: true,
      compressionThreshold: 100000,
      enableMemorySearch: true,
      memorySearchLimit: 10,
      positionOptimizer: {
        recentTurnsCount: 10,
        tokenBudget: 128000,
        useImportanceScoring: true
      },
      ...config
    };

    this.positionOptimizer = new PositionOptimizer(this.config.positionOptimizer);
    this.searchEngine = new HybridSearchEngine();

    // Initialize layers
    this.systemLayer = this.createLayerInternal('system', 'System', 0, false);
    this.taskLayer = this.createLayerInternal('task', 'Task', 10, true);
    this.teamLayer = this.createLayerInternal('team', 'Team', 20, true);
    this.localLayer = this.createLayerInternal('local', 'Local', 30, true);
  }

  /**
   * Set current agent context
   */
  setAgentContext(agentId: string, teamId?: string, taskId?: string): void {
    this.currentAgentId = agentId;
    this.currentTeamId = teamId;
    this.currentTaskId = taskId;
  }

  /**
   * Add message to a specific layer
   */
  addMessage(layerType: ContextLayerType, message: AgentMessage): void {
    const layer = this.getLayer(layerType);
    if (layer) {
      layer.messages.push(message);

      // Check if compression needed
      if (this.config.enableCompression) {
        const layerTokens = this.estimateLayerTokens(layer);
        const budget = this.config.layerBudgets[layerType] || Infinity;

        if (layerTokens > budget) {
          this.compressLayer(layerType);
        }
      }
    }
  }

  /**
   * Add memory to context
   */
  addMemory(memory: MemoryRecord, layerType: ContextLayerType = 'local'): void {
    const layer = this.getLayer(layerType);
    if (layer) {
      layer.memories.push(memory);
    }

    // Also store in memory index
    const agentId = memory.metadata.agentId || this.currentAgentId || 'default';
    if (!this.memories.has(agentId)) {
      this.memories.set(agentId, []);
    }
    this.memories.get(agentId)!.push(memory);
  }

  /**
   * Search memories in context
   */
  async searchMemories(query: string, options: ContextSearchOptions = {}): Promise<MemoryRecord[]> {
    const limit = options.limit || this.config.memorySearchLimit;
    const agentId = options.agentId || this.currentAgentId;

    // Get relevant memories
    const allMemories: MemoryRecord[] = [];

    if (agentId) {
      const agentMemories = this.memories.get(agentId) || [];
      allMemories.push(...agentMemories);
    }

    // Add layer memories
    for (const layer of [this.localLayer, this.teamLayer, this.taskLayer]) {
      allMemories.push(...layer.memories);
    }

    // If query provided, use search engine
    if (query && this.config.enableMemorySearch) {
      const searchResults = await this.searchEngine.search(query, {
        vectorResults: allMemories.map(m => ({
          id: m.id,
          content: m.content,
          score: m.metadata.importance,
          source: 'hybrid',
          metadata: m.metadata
        })),
        bm25Results: [],
        useReranking: true
      });

      return searchResults.slice(0, limit).map(r => ({
        id: r.id,
        content: r.content,
        metadata: r.metadata as MemoryRecord['metadata']
      }));
    }

    // Otherwise, return by importance
    return allMemories
      .sort((a, b) => b.metadata.importance - a.metadata.importance)
      .slice(0, limit);
  }

  /**
   * Get all messages optimized for LLM context
   */
  async getOptimizedContext(): Promise<AgentMessage[]> {
    const allMessages: AgentMessage[] = [];

    // Collect messages from all layers, ordered by priority
    const layers = [this.systemLayer, this.taskLayer, this.teamLayer, this.localLayer]
      .sort((a, b) => a.priority - b.priority);

    for (const layer of layers) {
      // Apply position optimization within layer
      const optimized = this.positionOptimizer.optimize(layer.messages);
      allMessages.push(...optimized);
    }

    // Final global optimization
    return this.positionOptimizer.optimize(allMessages);
  }

  /**
   * Get context as flattened message list with layer metadata
   */
  getContextWithMetadata(): Array<AgentMessage & { layer?: string; memories?: MemoryRecord[] }> {
    const result: Array<AgentMessage & { layer?: string }> = [];

    for (const layer of [this.systemLayer, this.taskLayer, this.teamLayer, this.localLayer]) {
      for (const msg of layer.messages) {
        result.push({
          ...msg,
          layer: layer.type
        });
      }
    }

    return result;
  }

  /**
   * Compress a specific layer
   */
  compressLayer(layerType: ContextLayerType): void {
    const layer = this.getLayer(layerType);
    if (!layer || !layer.compressible) {
      return;
    }

    // Strategy: keep most recent messages, summarize older ones
    const maxMessages = Math.max(5, Math.floor(layer.messages.length / 2));

    if (layer.messages.length > maxMessages) {
      // Keep only recent messages
      layer.messages = layer.messages.slice(-maxMessages);
    }
  }

  /**
   * Compress all layers to fit within token budget
   */
  compressToFit(): void {
    const totalTokens = this.getTotalTokens();

    if (totalTokens <= this.config.totalTokenBudget) {
      return;  // Within budget
    }

    // Compress layers from lowest priority to highest
    const sortedLayers = [this.localLayer, this.teamLayer, this.taskLayer, this.systemLayer]
      .filter(l => l.compressible);

    for (const layer of sortedLayers) {
      this.compressLayer(layer.type as ContextLayerType);

      const newTotalTokens = this.getTotalTokens();
      if (newTotalTokens <= this.config.totalTokenBudget) {
        break;
      }
    }
  }

  /**
   * Clear a specific layer
   */
  clearLayer(layerType: ContextLayerType): void {
    const layer = this.getLayer(layerType);
    if (layer) {
      layer.messages = [];
      layer.memories = [];
    }
  }

  /**
   * Clear all layers
   */
  clear(): void {
    this.systemLayer.messages = [];
    this.systemLayer.memories = [];
    this.taskLayer.messages = [];
    this.taskLayer.memories = [];
    this.teamLayer.messages = [];
    this.teamLayer.memories = [];
    this.localLayer.messages = [];
    this.localLayer.memories = [];
    this.memories.clear();
  }

  /**
   * Get context snapshot for debugging/monitoring
   */
  getSnapshot(): ContextSnapshot {
    const layers = [this.systemLayer, this.taskLayer, this.teamLayer, this.localLayer];
    const compressedLayers: string[] = [];

    for (const layer of layers) {
      if (layer.messages.length === 0) {
        compressedLayers.push(layer.type);
      }
    }

    let memoryCount = 0;
    for (const memories of this.memories.values()) {
      memoryCount += memories.length;
    }
    for (const layer of layers) {
      memoryCount += layer.memories.length;
    }

    return {
      layers,
      totalMessages: layers.reduce((sum, l) => sum + l.messages.length, 0),
      totalTokens: this.getTotalTokens(),
      compressedLayers,
      memoryCount
    };
  }

  /**
   * Get layer by type
   */
  getLayer(layerType: ContextLayerType): ContextLayer {
    switch (layerType) {
      case 'system': return this.systemLayer;
      case 'task': return this.taskLayer;
      case 'team': return this.teamLayer;
      case 'local': return this.localLayer;
      default: return this.localLayer;
    }
  }

  /**
   * Get all layers
   */
  getLayers(): ContextLayer[] {
    return [this.systemLayer, this.taskLayer, this.teamLayer, this.localLayer];
  }

  /**
   * Sync context to another agent (for cross-agent collaboration)
   */
  async syncToAgent(targetAgentId: string, layerType: ContextLayerType = 'team'): Promise<void> {
    const sourceLayer = this.getLayer(layerType);
    const targetEngine = new HierarchicalContextEngine(this.config);
    targetEngine.setAgentContext(targetAgentId, this.currentTeamId, this.currentTaskId);

    // Copy relevant messages
    for (const message of sourceLayer.messages) {
      targetEngine.addMessage(layerType, message);
    }

    // Copy memories
    for (const memory of sourceLayer.memories) {
      targetEngine.addMemory(memory, layerType);
    }
  }

  /**
   * Get statistics about context usage
   */
  getStats(): {
    layerStats: Array<{
      type: ContextLayerType;
      name: string;
      messageCount: number;
      memoryCount: number;
      tokenCount: number;
      budget: number;
      utilization: number;
    }>;
    totalTokens: number;
    totalBudget: number;
    overallUtilization: number;
    agentId?: string;
    teamId?: string;
    taskId?: string;
  } {
    const layers = [this.systemLayer, this.taskLayer, this.teamLayer, this.localLayer];
    const layerStats = layers.map(layer => {
      const tokenCount = this.estimateLayerTokens(layer);
      const budget = this.config.layerBudgets[layer.type] || 0;

      return {
        type: layer.type as ContextLayerType,
        name: layer.name,
        messageCount: layer.messages.length,
        memoryCount: layer.memories.length,
        tokenCount,
        budget,
        utilization: budget > 0 ? tokenCount / budget : 0
      };
    });

    const totalTokens = this.getTotalTokens();
    const totalBudget = this.config.totalTokenBudget;

    return {
      layerStats,
      totalTokens,
      totalBudget,
      overallUtilization: totalBudget > 0 ? totalTokens / totalBudget : 0,
      agentId: this.currentAgentId,
      teamId: this.currentTeamId,
      taskId: this.currentTaskId
    };
  }

  // ===== Private Helpers =====

  /**
   * Create layer internally
   */
  private createLayerInternal(
    type: ContextLayerType,
    name: string,
    priority: number,
    compressible: boolean
  ): ContextLayer {
    return {
      type,
      name,
      priority,
      messages: [],
      memories: [],
      compressible,
      tokenBudget: this.config.layerBudgets[type]
    };
  }

  /**
   * Estimate tokens for a layer
   */
  private estimateLayerTokens(layer: ContextLayer): number {
    const messageTokens = layer.messages.reduce(
      (sum, msg) => sum + this.countTokens(msg),
      0
    );

    const memoryTokens = layer.memories.reduce(
      (sum, mem) => sum + Math.ceil(mem.content.length / 4),
      0
    );

    return messageTokens + memoryTokens;
  }

  /**
   * Get total tokens across all layers
   */
  getTotalTokens(): number {
    return [this.systemLayer, this.taskLayer, this.teamLayer, this.localLayer]
      .reduce((sum, layer) => sum + this.estimateLayerTokens(layer), 0);
  }

  /**
   * Count tokens in a message (rough estimate)
   */
  private countTokens(msg: AgentMessage): number {
    const content = typeof msg.content === 'string' ? msg.content : '';
    return Math.ceil(content.length / 4) + 4;
  }
}

/**
 * Factory function for common context configurations
 */
export function createHierarchicalContext(
  type: 'small' | 'medium' | 'large'
): HierarchicalContextEngine {
  const configs = {
    small: {
      totalTokenBudget: 32000,
      layerBudgets: {
        system: 4000,
        task: 8000,
        team: 8000,
        local: 12000
      }
    },
    medium: {
      totalTokenBudget: 128000,
      layerBudgets: {
        system: 8000,
        task: 16000,
        team: 32000,
        local: 72000
      }
    },
    large: {
      totalTokenBudget: 256000,
      layerBudgets: {
        system: 16000,
        task: 32000,
        team: 64000,
        local: 144000
      }
    }
  };

  return new HierarchicalContextEngine(configs[type]);
}
