/**
 * Huangdi Orchestrator - Hierarchical Context Engine
 *
 * Manages context with layered architecture for optimal token usage
 * and information retention.
 */

import type { AgentMessage } from "openclaw/plugin-sdk";
import { PositionOptimizer, type PositionOptimizerConfig } from "./PositionOptimizer";

export interface ContextLayer {
  /** Layer name */
  name: string;
  /** Layer priority (lower = more important, kept longer) */
  priority: number;
  /** Messages in this layer */
  messages: AgentMessage[];
  /** Token budget for this layer (optional) */
  tokenBudget?: number;
  /** Whether to compress messages in this layer */
  compressible: boolean;
}

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
}

export interface ContextSnapshot {
  layers: ContextLayer[];
  totalMessages: number;
  totalTokens: number;
  compressedLayers: string[];
}

/**
 * Hierarchical Context Engine
 *
 * Organizes context into layers:
 * 1. System Layer: Core instructions, always retained
 * 2. Task Layer: Current task details and constraints
 * 3. Dialogue Layer: Recent conversation turns
 * 4. Reference Layer: Retrieved context (most expendable)
 *
 * Benefits:
 * - Predictable token usage per layer
 * - Graceful degradation under pressure
 * - Clear priorities for what to keep/discard
 */
export class HierarchicalContextEngine {
  private layers = new Map<string, ContextLayer>();
  private config: HierarchicalContextConfig;
  private positionOptimizer: PositionOptimizer;

  constructor(config?: Partial<HierarchicalContextConfig>) {
    this.config = {
      totalTokenBudget: 128000,
      layerBudgets: {
        system: 8000,
        task: 16000,
        dialogue: 64000,
        reference: 40000
      },
      enableCompression: true,
      compressionThreshold: 100000,
      positionOptimizer: {
        recentTurnsCount: 10,
        tokenBudget: 128000,
        useImportanceScoring: true
      },
      ...config
    };

    this.positionOptimizer = new PositionOptimizer(
      this.config.positionOptimizer
    );
  }

  /**
   * Add message to a specific layer
   */
  addMessage(layerName: string, message: AgentMessage): void {
    if (!this.layers.has(layerName)) {
      this.createLayer(layerName);
    }

    const layer = this.layers.get(layerName)!;
    layer.messages.push(message);

    // Check if compression needed
    if (this.config.enableCompression) {
      const layerTokens = this.estimateLayerTokens(layer);
      const budget = this.config.layerBudgets[layerName] || Infinity;

      if (layerTokens > budget) {
        this.compressLayer(layerName);
      }
    }
  }

  /**
   * Get all messages optimized for LLM context
   */
  getOptimizedContext(): AgentMessage[] {
    const allMessages: AgentMessage[] = [];

    // Collect messages from all layers, ordered by priority
    const sortedLayers = Array.from(this.layers.values())
      .sort((a, b) => a.priority - b.priority);

    for (const layer of sortedLayers) {
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
  getContextWithMetadata(): Array<AgentMessage & { layer?: string }> {
    const result: Array<AgentMessage & { layer?: string }> = [];

    for (const [layerName, layer] of this.layers.entries()) {
      for (const msg of layer.messages) {
        result.push({
          ...msg,
          layer: layerName
        });
      }
    }

    return result;
  }

  /**
   * Compress a specific layer
   */
  compressLayer(layerName: string): void {
    const layer = this.layers.get(layerName);
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
    const sortedLayers = Array.from(this.layers.values())
      .sort((a, b) => b.priority - a.priority);  // Lowest priority first

    for (const layer of sortedLayers) {
      if (!layer.compressible) continue;

      this.compressLayer(layer.name);

      const newTotalTokens = this.getTotalTokens();
      if (newTotalTokens <= this.config.totalTokenBudget) {
        break;
      }
    }
  }

  /**
   * Clear a specific layer
   */
  clearLayer(layerName: string): void {
    const layer = this.layers.get(layerName);
    if (layer) {
      layer.messages = [];
    }
  }

  /**
   * Clear all layers
   */
  clear(): void {
    this.layers.clear();
  }

  /**
   * Get context snapshot for debugging/monitoring
   */
  getSnapshot(): ContextSnapshot {
    const layers = Array.from(this.layers.values());
    const compressedLayers: string[] = [];

    for (const layer of layers) {
      if (layer.messages.length === 0) {
        compressedLayers.push(layer.name);
      }
    }

    return {
      layers,
      totalMessages: layers.reduce((sum, l) => sum + l.messages.length, 0),
      totalTokens: this.getTotalTokens(),
      compressedLayers
    };
  }

  /**
   * Get layer by name
   */
  getLayer(layerName: string): ContextLayer | undefined {
    return this.layers.get(layerName);
  }

  /**
   * Get all layers
   */
  getLayers(): ContextLayer[] {
    return Array.from(this.layers.values());
  }

  /**
   * Create a new layer
   */
  createLayer(
    name: string,
    priority?: number,
    compressible: boolean = true
  ): void {
    if (this.layers.has(name)) {
      return;  // Layer already exists
    }

    // Default priorities based on layer type
    const defaultPriorities: Record<string, number> = {
      system: 0,
      task: 10,
      dialogue: 20,
      reference: 30
    };

    this.layers.set(name, {
      name,
      priority: priority ?? defaultPriorities[name] ?? 50,
      messages: [],
      compressible
    });
  }

  /**
   * Estimate tokens for a layer
   */
  private estimateLayerTokens(layer: ContextLayer): number {
    return layer.messages.reduce(
      (sum, msg) => sum + this.countTokens(msg),
      0
    );
  }

  /**
   * Get total tokens across all layers
   */
  getTotalTokens(): number {
    let total = 0;

    for (const layer of this.layers.values()) {
      total += this.estimateLayerTokens(layer);
    }

    return total;
  }

  /**
   * Count tokens in a message (rough estimate)
   */
  private countTokens(msg: AgentMessage): number {
    // Rough estimate: 1 token ≈ 4 characters for English
    const contentTokens = Math.ceil(msg.content.length / 4);
    const roleTokens = 4;
    return contentTokens + roleTokens;
  }

  /**
   * Get statistics about context usage
   */
  getStats(): {
    layerStats: Array<{
      name: string;
      messageCount: number;
      tokenCount: number;
      budget: number;
      utilization: number;
    }>;
    totalTokens: number;
    totalBudget: number;
    overallUtilization: number;
  } {
    const layerStats = Array.from(this.layers.values()).map(layer => {
      const tokenCount = this.estimateLayerTokens(layer);
      const budget = this.config.layerBudgets[layer.name] || 0;

      return {
        name: layer.name,
        messageCount: layer.messages.length,
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
      overallUtilization: totalBudget > 0 ? totalTokens / totalBudget : 0
    };
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
        dialogue: 16000,
        reference: 4000
      }
    },
    medium: {
      totalTokenBudget: 128000,
      layerBudgets: {
        system: 8000,
        task: 16000,
        dialogue: 64000,
        reference: 40000
      }
    },
    large: {
      totalTokenBudget: 256000,
      layerBudgets: {
        system: 16000,
        task: 32000,
        dialogue: 128000,
        reference: 80000
      }
    }
  };

  return new HierarchicalContextEngine(configs[type]);
}
