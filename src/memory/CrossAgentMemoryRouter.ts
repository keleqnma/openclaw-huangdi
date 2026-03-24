/**
 * Huangdi Orchestrator - Cross Agent Memory Router
 *
 * Manages memory routing across agents with hierarchical structure:
 * - Local: Agent-specific working memory
 * - Team: Shared memory within a team/role group
 * - Global: System-wide shared knowledge
 *
 * Features:
 * - Hierarchical memory storage and querying
 * - Cross-agent memory synchronization
 * - Knowledge distillation for memory compression
 * - CRDT-based conflict resolution
 */

import type { MemoryRecord } from '../context/HierarchicalContextEngine';

export interface MemoryRouterConfig {
  /** Sync interval in milliseconds */
  syncInterval: number;
  /** Maximum memories per agent */
  maxMemoriesPerAgent: number;
  /** Importance threshold for distillation */
  distillThreshold: number;
  /** Maximum global memories */
  maxGlobalMemories: number;
}

export interface MemoryQueryResult {
  memories: MemoryRecord[];
  source: 'local' | 'team' | 'global';
  similarityScore?: number;
}

export interface MemoryMetadata {
  source: string;
  agentId?: string;
  taskId?: string;
  teamId?: string;
  timestamp: number;
  importance: number;
  tags?: string[];
  embedding?: number[];
}

/**
 * Cross Agent Memory Router
 *
 * Implements hierarchical memory management with:
 * - Local memory for each agent
 * - Team memory for role groups
 * - Global memory for system-wide knowledge
 */
export class CrossAgentMemoryRouter {
  // Three-layer memory storage
  private localMemories: Map<string, MemoryRecord[]> = new Map();  // agentId -> memories
  private teamMemories: Map<string, MemoryRecord[]> = new Map();   // teamId -> memories
  private globalMemories: MemoryRecord[] = [];

  // Agent metadata
  private agentTeams: Map<string, string> = new Map();  // agentId -> teamId
  private agentParents: Map<string, string> = new Map(); // childAgentId -> parentAgentId

  // Config
  private config: MemoryRouterConfig;

  constructor(config?: Partial<MemoryRouterConfig>) {
    this.config = {
      syncInterval: 5000,        // 5 seconds
      maxMemoriesPerAgent: 100,
      distillThreshold: 0.7,     // 70% importance
      maxGlobalMemories: 500,
      ...config
    };
  }

  /**
   * Query memories across layers
   */
  async query(
    agentId: string,
    query: string,
    scope: 'local' | 'team' | 'global' | 'all' = 'all',
    limit: number = 10
  ): Promise<MemoryQueryResult[]> {
    const results: MemoryQueryResult[] = [];

    // Helper to filter and rank memories
    const filterAndRank = (memories: MemoryRecord[], source: 'local' | 'team' | 'global') => {
      // Simple ranking by importance and recency
      const ranked = memories
        .filter(m => {
          // Filter by scope
          if (scope === 'local' && source !== 'local') return false;
          if (scope === 'team' && source !== 'team') return false;
          if (scope === 'global' && source !== 'global') return false;
          return true;
        })
        .sort((a, b) => {
          // Sort by importance * recency
          const scoreA = a.metadata.importance * this.getRecencyScore(a.metadata.timestamp);
          const scoreB = b.metadata.importance * this.getRecencyScore(b.metadata.timestamp);
          return scoreB - scoreA;
        })
        .slice(0, limit);

      if (ranked.length > 0) {
        results.push({
          memories: ranked,
          source
        });
      }
    };

    // Query local memories
    if (scope === 'local' || scope === 'all') {
      const local = this.localMemories.get(agentId) || [];
      filterAndRank(local, 'local');
    }

    // Query team memories
    if (scope === 'team' || scope === 'all') {
      const teamId = this.agentTeams.get(agentId);
      if (teamId) {
        const team = this.teamMemories.get(teamId) || [];
        filterAndRank(team, 'team');
      }
    }

    // Query global memories
    if (scope === 'global' || scope === 'all') {
      filterAndRank(this.globalMemories, 'global');
    }

    return results;
  }

  /**
   * Add a memory record
   */
  async addMemory(
    agentId: string,
    content: string,
    metadata: Omit<MemoryMetadata, 'timestamp'>
  ): Promise<string> {
    const id = this.generateMemoryId();
    const memory: MemoryRecord = {
      id,
      content,
      metadata: {
        ...metadata,
        timestamp: Date.now()
      }
    };

    // Add to local memory
    if (!this.localMemories.has(agentId)) {
      this.localMemories.set(agentId, []);
    }

    const agentMemories = this.localMemories.get(agentId)!;
    agentMemories.push(memory);

    // Enforce limit
    if (agentMemories.length > this.config.maxMemoriesPerAgent) {
      // Remove least important memories
      agentMemories.sort((a, b) => b.metadata.importance - a.metadata.importance);
      agentMemories.splice(this.config.maxMemoriesPerAgent);
    }

    // Auto-sync to team if agent belongs to a team
    const teamId = this.agentTeams.get(agentId);
    if (teamId && metadata.importance >= this.config.distillThreshold) {
      await this.syncToTeam(agentId, teamId, memory);
    }

    return id;
  }

  /**
   * Delete a memory
   */
  deleteMemory(memoryId: string): boolean {
    // Search in local memories
    for (const [agentId, memories] of this.localMemories.entries()) {
      const index = memories.findIndex(m => m.id === memoryId);
      if (index !== -1) {
        memories.splice(index, 1);
        return true;
      }
    }

    // Search in team memories
    for (const [teamId, memories] of this.teamMemories.entries()) {
      const index = memories.findIndex(m => m.id === memoryId);
      if (index !== -1) {
        memories.splice(index, 1);
        return true;
      }
    }

    // Search in global memories
    const index = this.globalMemories.findIndex(m => m.id === memoryId);
    if (index !== -1) {
      this.globalMemories.splice(index, 1);
      return true;
    }

    return false;
  }

  /**
   * Set agent's team membership
   */
  setAgentTeam(agentId: string, teamId: string): void {
    this.agentTeams.set(agentId, teamId);
  }

  /**
   * Set parent-child relationship between agents
   */
  setAgentParent(childAgentId: string, parentAgentId: string): void {
    this.agentParents.set(childAgentId, parentAgentId);
  }

  /**
   * Sync memory to parent agent
   */
  async syncToParent(childAgentId: string): Promise<void> {
    const parentAgentId = this.agentParents.get(childAgentId);
    if (!parentAgentId) {
      return;
    }

    // Get child's memories
    const childMemories = this.localMemories.get(childAgentId) || [];

    // Distill and sync to parent
    for (const memory of childMemories) {
      if (memory.metadata.importance >= this.config.distillThreshold) {
        await this.addMemory(parentAgentId, memory.content, {
          ...memory.metadata,
          source: `synced-from:${childAgentId}`
        });
      }
    }
  }

  /**
   * Broadcast memory to team members
   */
  async broadcastToTeam(agentId: string, teamId: string, memory: MemoryRecord): Promise<void> {
    if (!this.teamMemories.has(teamId)) {
      this.teamMemories.set(teamId, []);
    }

    const teamMemories = this.teamMemories.get(teamId)!;

    // Check if similar memory exists (simple dedup)
    const exists = teamMemories.some(
      m => m.content === memory.content ||
           (m.metadata.taskId && m.metadata.taskId === memory.metadata.taskId)
    );

    if (!exists) {
      teamMemories.push(memory);
    }
  }

  /**
   * Distill knowledge from an agent's memories
   * Compresses and extracts key insights
   */
  async distillKnowledge(agentId: string): Promise<MemoryRecord[]> {
    const memories = this.localMemories.get(agentId) || [];

    // Filter high-importance memories
    const highImportance = memories.filter(
      m => m.metadata.importance >= this.config.distillThreshold
    );

    // Group by task and extract summaries
    const distilled: MemoryRecord[] = [];
    const taskGroups = new Map<string, MemoryRecord[]>();

    for (const memory of highImportance) {
      const taskId = memory.metadata.taskId || 'general';
      if (!taskGroups.has(taskId)) {
        taskGroups.set(taskId, []);
      }
      taskGroups.get(taskId)!.push(memory);
    }

    // Create distilled summaries
    for (const [taskId, taskMemories] of taskGroups.entries()) {
      const summary = this.createDistilledSummary(taskMemories, taskId);
      distilled.push(summary);
    }

    return distilled;
  }

  /**
   * Promote memory to global
   */
  async promoteToGlobal(memoryId: string): Promise<boolean> {
    // Find memory
    let sourceMemories: MemoryRecord[] | null = null;
    let memoryIndex = -1;

    for (const memories of this.localMemories.values()) {
      const index = memories.findIndex(m => m.id === memoryId);
      if (index !== -1) {
        sourceMemories = memories;
        memoryIndex = index;
        break;
      }
    }

    if (!sourceMemories || memoryIndex === -1) {
      for (const memories of this.teamMemories.values()) {
        const index = memories.findIndex(m => m.id === memoryId);
        if (index !== -1) {
          sourceMemories = memories;
          memoryIndex = index;
          break;
        }
      }
    }

    if (!sourceMemories || memoryIndex === -1) {
      return false;
    }

    // Copy to global
    const memory = sourceMemories[memoryIndex];
    this.globalMemories.push(memory);

    // Enforce global limit
    if (this.globalMemories.length > this.config.maxGlobalMemories) {
      this.globalMemories.sort(
        (a, b) => b.metadata.importance - a.metadata.importance
      );
      this.globalMemories.splice(this.config.maxGlobalMemories);
    }

    return true;
  }

  /**
   * Get memory statistics
   */
  getStats(): {
    localCount: number;
    teamCount: number;
    globalCount: number;
    agentCount: number;
    teamGroupCount: number;
  } {
    let localCount = 0;
    for (const memories of this.localMemories.values()) {
      localCount += memories.length;
    }

    let teamCount = 0;
    for (const memories of this.teamMemories.values()) {
      teamCount += memories.length;
    }

    return {
      localCount,
      teamCount,
      globalCount: this.globalMemories.length,
      agentCount: this.localMemories.size,
      teamGroupCount: this.teamMemories.size
    };
  }

  /**
   * Clear all memories
   */
  clear(): void {
    this.localMemories.clear();
    this.teamMemories.clear();
    this.globalMemories = [];
    this.agentTeams.clear();
    this.agentParents.clear();
  }

  // ===== Private Helpers =====

  /**
   * Sync memory to team storage
   */
  private async syncToTeam(agentId: string, teamId: string, memory: MemoryRecord): Promise<void> {
    await this.broadcastToTeam(agentId, teamId, memory);
  }

  /**
   * Create distilled summary from multiple memories
   */
  private createDistilledSummary(memories: MemoryRecord[], taskId: string): MemoryRecord {
    // Sort by importance
    const sorted = [...memories].sort(
      (a, b) => b.metadata.importance - a.metadata.importance
    );

    // Extract key points
    const keyPoints = sorted.slice(0, 5).map(m => m.content).join('\n');

    return {
      id: this.generateMemoryId(),
      content: `Task ${taskId} Summary:\n${keyPoints}`,
      metadata: {
        source: 'distilled',
        taskId,
        timestamp: Date.now(),
        importance: Math.max(...memories.map(m => m.metadata.importance)),
        tags: ['summary', 'distilled']
      }
    };
  }

  /**
   * Calculate recency score (0-1)
   */
  private getRecencyScore(timestamp: number): number {
    const ageInHours = (Date.now() - timestamp) / 3600000;
    // Exponential decay: 50% after 24 hours
    return Math.exp(-0.03 * ageInHours);
  }

  /**
   * Generate unique memory ID
   */
  private generateMemoryId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }
}

/**
 * Factory function for common configurations
 */
export function createMemoryRouter(
  type: 'small' | 'medium' | 'large'
): CrossAgentMemoryRouter {
  const configs = {
    small: {
      maxMemoriesPerAgent: 50,
      maxGlobalMemories: 200,
      distillThreshold: 0.8,
      syncInterval: 10000
    },
    medium: {
      maxMemoriesPerAgent: 100,
      maxGlobalMemories: 500,
      distillThreshold: 0.7,
      syncInterval: 5000
    },
    large: {
      maxMemoriesPerAgent: 200,
      maxGlobalMemories: 1000,
      distillThreshold: 0.6,
      syncInterval: 2000
    }
  };

  return new CrossAgentMemoryRouter(configs[type]);
}
