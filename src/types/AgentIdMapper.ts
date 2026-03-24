/**
 * Agent ID Mapper - 统一 ID 映射表
 *
 * 维护不同系统之间的 ID 映射关系：
 * - agentId: Agent 在 Dashboard 中的 ID
 * - runId: OpenClaw 子 agent 运行 ID
 * - sessionKey: OpenClaw 子 agent 会话 Key
 * - sessionId: 终端会话 ID
 *
 * 解决不同系统使用不同 ID 导致的追踪困难问题
 */

export interface AgentIdMapping {
  /** Agent 在 Dashboard 中的 ID */
  agentId: string;
  /** OpenClaw 子 agent 运行 ID */
  runId: string;
  /** OpenClaw 子 agent 会话 Key */
  sessionKey: string;
  /** 终端会话 ID（可选） */
  sessionId?: string;
  /** 关联的任务 ID（可选） */
  taskId?: string;
  /** 映射创建时间 */
  createdAt: number;
  /** 映射最后更新时间 */
  updatedAt: number;
}

export class AgentIdMapper {
  private mappings: Map<string, AgentIdMapping> = new Map(); // agentId -> mapping
  private byRunId: Map<string, string> = new Map(); // runId -> agentId
  private bySessionKey: Map<string, string> = new Map(); // sessionKey -> agentId
  private bySessionId: Map<string, string> = new Map(); // sessionId -> agentId
  private byTaskId: Map<string, Set<string>> = new Map(); // taskId -> Set<agentId>
  private readonly maxMappings: number = 1000; // Maximum mappings to prevent memory explosion

  /**
   * 注册一个新的 ID 映射
   */
  register(mapping: AgentIdMapping): void {
    // Check if mapping already exists
    if (this.mappings.has(mapping.agentId)) {
      this.update(mapping.agentId, mapping);
      return;
    }

    // Prevent memory explosion
    if (this.mappings.size >= this.maxMappings) {
      this.removeOldestMapping();
    }

    // Store the mapping
    this.mappings.set(mapping.agentId, {
      ...mapping,
      updatedAt: Date.now(),
    });

    // Create reverse lookups
    this.byRunId.set(mapping.runId, mapping.agentId);
    this.bySessionKey.set(mapping.sessionKey, mapping.agentId);

    if (mapping.sessionId) {
      this.bySessionId.set(mapping.sessionId, mapping.agentId);
    }

    // Index by task ID
    if (mapping.taskId) {
      if (!this.byTaskId.has(mapping.taskId)) {
        this.byTaskId.set(mapping.taskId, new Set());
      }
      this.byTaskId.get(mapping.taskId)!.add(mapping.agentId);
    }
  }

  /**
   * 通过 agentId 获取映射
   */
  getByAgentId(agentId: string): AgentIdMapping | undefined {
    return this.mappings.get(agentId);
  }

  /**
   * 通过 runId 获取映射
   */
  getByRunId(runId: string): AgentIdMapping | undefined {
    const agentId = this.byRunId.get(runId);
    if (!agentId) return undefined;
    return this.mappings.get(agentId);
  }

  /**
   * 通过 sessionKey 获取映射
   */
  getBySessionKey(sessionKey: string): AgentIdMapping | undefined {
    const agentId = this.bySessionKey.get(sessionKey);
    if (!agentId) return undefined;
    return this.mappings.get(agentId);
  }

  /**
   * 通过 sessionId 获取映射
   */
  getBySessionId(sessionId: string): AgentIdMapping | undefined {
    const agentId = this.bySessionId.get(sessionId);
    if (!agentId) return undefined;
    return this.mappings.get(agentId);
  }

  /**
   * 通过 taskId 获取所有相关的 agentId
   */
  getByTaskId(taskId: string): AgentIdMapping[] {
    const agentIds = this.byTaskId.get(taskId);
    if (!agentIds) return [];
    return Array.from(agentIds).map(id => this.mappings.get(id)!).filter(Boolean);
  }

  /**
   * 更新现有映射
   */
  update(agentId: string, updates: Partial<AgentIdMapping>): AgentIdMapping | undefined {
    const existing = this.mappings.get(agentId);
    if (!existing) return undefined;

    const updated: AgentIdMapping = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    // Update runId index if changed
    if (updates.runId && updates.runId !== existing.runId) {
      this.byRunId.delete(existing.runId);
      this.byRunId.set(updated.runId, agentId);
    }

    // Update sessionKey index if changed
    if (updates.sessionKey && updates.sessionKey !== existing.sessionKey) {
      this.bySessionKey.delete(existing.sessionKey);
      this.bySessionKey.set(updated.sessionKey, agentId);
    }

    // Update sessionId index if changed
    if (updates.sessionId !== undefined) {
      if (existing.sessionId) {
        this.bySessionId.delete(existing.sessionId);
      }
      if (updates.sessionId) {
        this.bySessionId.set(updates.sessionId, agentId);
      }
    }

    // Update taskId index if changed
    if (updates.taskId !== undefined) {
      if (existing.taskId) {
        const taskAgents = this.byTaskId.get(existing.taskId);
        if (taskAgents) {
          taskAgents.delete(agentId);
          if (taskAgents.size === 0) {
            this.byTaskId.delete(existing.taskId);
          }
        }
      }
      if (updates.taskId) {
        if (!this.byTaskId.has(updates.taskId)) {
          this.byTaskId.set(updates.taskId, new Set());
        }
        this.byTaskId.get(updates.taskId)!.add(agentId);
      }
    }

    this.mappings.set(agentId, updated);
    return updated;
  }

  /**
   * 移除映射
   */
  remove(agentId: string): void {
    const existing = this.mappings.get(agentId);
    if (!existing) return;

    // Remove from reverse lookups
    this.byRunId.delete(existing.runId);
    this.bySessionKey.delete(existing.sessionKey);
    if (existing.sessionId) {
      this.bySessionId.delete(existing.sessionId);
    }

    // Remove from task index
    if (existing.taskId) {
      const taskAgents = this.byTaskId.get(existing.taskId);
      if (taskAgents) {
        taskAgents.delete(agentId);
        if (taskAgents.size === 0) {
          this.byTaskId.delete(existing.taskId);
        }
      }
    }

    // Remove from main map
    this.mappings.delete(agentId);
  }

  /**
   * 检查某个 ID 是否存在
   */
  exists(agentId?: string, runId?: string, sessionKey?: string, sessionId?: string): boolean {
    if (agentId && this.mappings.has(agentId)) return true;
    if (runId && this.byRunId.has(runId)) return true;
    if (sessionKey && this.bySessionKey.has(sessionKey)) return true;
    if (sessionId && this.bySessionId.has(sessionId)) return true;
    return false;
  }

  /**
   * 获取所有映射
   */
  getAll(): AgentIdMapping[] {
    return Array.from(this.mappings.values());
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalMappings: number;
    byRunId: number;
    bySessionKey: number;
    bySessionId: number;
    byTaskId: number;
  } {
    return {
      totalMappings: this.mappings.size,
      byRunId: this.byRunId.size,
      bySessionKey: this.bySessionKey.size,
      bySessionId: this.bySessionId.size,
      byTaskId: this.byTaskId.size,
    };
  }

  /**
   * 清空所有映射
   */
  clear(): void {
    this.mappings.clear();
    this.byRunId.clear();
    this.bySessionKey.clear();
    this.bySessionId.clear();
    this.byTaskId.clear();
  }

  /**
   * 移除最旧的映射（用于内存管理）
   */
  private removeOldestMapping(): void {
    let oldestTime = Infinity;
    let oldestAgentId: string | null = null;

    for (const [agentId, mapping] of this.mappings.entries()) {
      if (mapping.createdAt < oldestTime) {
        oldestTime = mapping.createdAt;
        oldestAgentId = agentId;
      }
    }

    if (oldestAgentId) {
      this.remove(oldestAgentId);
    }
  }
}
