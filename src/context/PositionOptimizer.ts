/**
 * Huangdi Orchestrator - Position Optimizer
 *
 * Optimizes context message ordering based on "Lost in the Middle" research.
 * LLMs pay more attention to content at the beginning and end of context.
 */

import type { AgentMessage } from "openclaw/plugin-sdk";

export interface MessageWithPriority {
  message: AgentMessage;
  priority: number;
  category: MessageCategory;
}

export type MessageCategory =
  | 'system'           // System prompts and instructions
  | 'user-important'   // Important user messages
  | 'assistant-key'    // Key assistant decisions
  | 'recent'           // Recent conversation turns
  | 'reference'        // Retrieved context/references
  | 'normal';          // Regular conversation

export interface PositionOptimizerConfig {
  /** Number of recent turns to always keep at the end */
  recentTurnsCount: number;
  /** Token budget for context */
  tokenBudget: number;
  /** Whether to use importance scoring */
  useImportanceScoring: boolean;
}

/**
 * Position Optimizer based on "Lost in the Middle" research
 *
 * Research shows LLMs have better recall for information at:
 * - The beginning of the context (primacy effect)
 * - The end of the context (recency effect)
 * - Middle content is often overlooked
 *
 * Optimal ordering:
 * 1. System prompts and core instructions
 * 2. Important user messages/instructions
 * 3. Key assistant decisions
 * 4. Retrieved references (middle - least important)
 * 5. Recent conversation turns (end - for coherence)
 */
export class PositionOptimizer {
  private defaultConfig: PositionOptimizerConfig = {
    recentTurnsCount: 10,
    tokenBudget: 128000,
    useImportanceScoring: true
  };

  constructor(private config: Partial<PositionOptimizerConfig> = {}) {}

  /**
   * Optimize message ordering for better LLM attention
   */
  optimize(messages: AgentMessage[]): AgentMessage[] {
    const effectiveConfig = { ...this.defaultConfig, ...this.config };

    // Categorize and score messages
    const categorized = messages.map(msg => ({
      message: msg,
      priority: this.getMessagePriority(msg),
      category: this.categorizeMessage(msg)
    }));

    // Sort by priority (lower = more important, placed at beginning)
    categorized.sort((a, b) => {
      // First sort by category
      const categoryOrder: Record<MessageCategory, number> = {
        'system': 0,
        'user-important': 1,
        'assistant-key': 2,
        'recent': 5,  // Recent turns go to end
        'reference': 3,
        'normal': 4
      };

      const catA = categoryOrder[a.category];
      const catB = categoryOrder[b.category];

      if (catA !== catB) {
        return catA - catB;
      }

      // Within same category, sort by importance score
      return a.priority - b.priority;
    });

    // Extract recent turns and place at end
    const recentTurns = categorized
      .filter(m => m.category === 'recent')
      .slice(-effectiveConfig.recentTurnsCount);

    const others = categorized.filter(m => m.category !== 'recent');

    // Build final ordered list
    const ordered = [
      ...others.map(m => m.message),
      ...recentTurns.map(m => m.message)
    ];

    return ordered;
  }

  /**
   * Optimize and truncate to token budget
   */
  optimizeAndTruncate(messages: AgentMessage[], tokenBudget?: number): AgentMessage[] {
    const budget = tokenBudget ?? this.defaultConfig.tokenBudget;

    // First optimize ordering
    const optimized = this.optimize(messages);

    // Then truncate to budget
    return this.truncateToBudget(optimized, budget);
  }

  /**
   * Categorize message for optimal placement
   */
  private categorizeMessage(msg: AgentMessage): MessageCategory {
    // System messages always go first
    if (msg.role === 'system') {
      return 'system';
    }

    // Check metadata for explicit categorization
    if (msg.metadata?.important) {
      return msg.role === 'user' ? 'user-important' : 'assistant-key';
    }

    if (msg.metadata?.type === 'decision') {
      return 'assistant-key';
    }

    if (msg.metadata?.type === 'reference') {
      return 'reference';
    }

    // Default to normal
    return 'normal';
  }

  /**
   * Compute priority score for message (lower = more important)
   */
  private getMessagePriority(msg: AgentMessage): number {
    let priority = 0.5;  // Base priority

    // User messages slightly more important
    if (msg.role === 'user') {
      priority += 0.1;
    }

    // Messages with decisions are important
    if (this.containsDecision(msg)) {
      priority -= 0.2;
    }

    // Messages with TODOs are important
    if (this.containsTodo(msg)) {
      priority -= 0.15;
    }

    // Time decay: older messages less important
    const ageInHours = this.getMessageAge(msg) / 3600000;
    priority *= Math.exp(-0.05 * ageInHours);

    return Math.max(0, Math.min(1, priority));
  }

  /**
   * Truncate messages to fit token budget
   */
  private truncateToBudget(messages: AgentMessage[], budget: number): AgentMessage[] {
    const result: AgentMessage[] = [];
    let currentTokens = 0;

    for (const msg of messages) {
      const msgTokens = this.countTokens(msg);

      if (currentTokens + msgTokens <= budget) {
        result.push(msg);
        currentTokens += msgTokens;
      } else {
        // Budget exceeded, stop adding messages
        break;
      }
    }

    return result;
  }

  /**
   * Check if message contains a decision
   */
  private containsDecision(msg: AgentMessage): boolean {
    const decisionPatterns = [
      /\bdecided\b|\bdecision\b|\bconcluded\b|\btherefore\b/i,
      /\bwill do\b|\bI'll\b|\bwe should\b/i,
      /\bkey point\b|\bimportant\b|\bcritical\b/i
    ];

    return decisionPatterns.some(pattern => pattern.test(msg.content));
  }

  /**
   * Check if message contains TODO items
   */
  private containsTodo(msg: AgentMessage): boolean {
    const todoPatterns = [
      /^\s*[-*]\s*\[?\]?\s*/m,  // Markdown checkboxes
      /\bTODO\b|\bTO-DO\b|\bto-do\b/i,
      /\bneed to\b|\bmust\b|\bshould\b/i
    ];

    return todoPatterns.some(pattern => pattern.test(msg.content));
  }

  /**
   * Get message age in milliseconds
   */
  private getMessageAge(msg: AgentMessage): number {
    if (msg.timestamp) {
      return Date.now() - msg.timestamp;
    }
    return 0;
  }

  /**
   * Estimate token count for message
   */
  private countTokens(msg: AgentMessage): number {
    // Rough estimate: 1 token ≈ 4 characters for English
    // More accurate: use tiktoken or provider's tokenizer
    const contentTokens = Math.ceil(msg.content.length / 4);
    const roleTokens = 4;  // Approximate tokens for role
    return contentTokens + roleTokens;
  }
}
