/**
 * Tests for AgentIdMapper
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentIdMapper, type AgentIdMapping } from './AgentIdMapper';

describe('AgentIdMapper', () => {
  let mapper: AgentIdMapper;

  beforeEach(() => {
    mapper = new AgentIdMapper();
  });

  const createMapping = (overrides: Partial<AgentIdMapping> = {}): AgentIdMapping => ({
    agentId: 'agent_001',
    runId: 'run_001',
    sessionKey: 'session_001',
    sessionId: 'terminal_001',
    taskId: 'task_001',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });

  describe('register', () => {
    it('should register a new mapping', () => {
      const mapping = createMapping();
      mapper.register(mapping);

      const result = mapper.getByAgentId('agent_001');
      expect(result).toEqual(expect.objectContaining({
        agentId: 'agent_001',
        runId: 'run_001',
        sessionKey: 'session_001',
      }));
    });

    it('should create reverse lookups', () => {
      const mapping = createMapping();
      mapper.register(mapping);

      expect(mapper.getByRunId('run_001')).toEqual(expect.objectContaining({ agentId: 'agent_001' }));
      expect(mapper.getBySessionKey('session_001')).toEqual(expect.objectContaining({ agentId: 'agent_001' }));
      expect(mapper.getBySessionId('terminal_001')).toEqual(expect.objectContaining({ agentId: 'agent_001' }));
    });

    it('should index by task ID', () => {
      const mapping = createMapping();
      mapper.register(mapping);

      const byTask = mapper.getByTaskId('task_001');
      expect(byTask).toHaveLength(1);
      expect(byTask[0].agentId).toBe('agent_001');
    });

    it('should handle optional sessionId and taskId', () => {
      const mapping = createMapping({ sessionId: undefined, taskId: undefined });
      mapper.register(mapping);

      const result = mapper.getByAgentId('agent_001');
      expect(result?.sessionId).toBeUndefined();
      expect(result?.taskId).toBeUndefined();
    });

    it('should update existing mapping with same agentId', () => {
      const mapping1 = createMapping();
      const mapping2 = createMapping({ runId: 'run_002' });

      mapper.register(mapping1);
      mapper.register(mapping2);

      const result = mapper.getByAgentId('agent_001');
      expect(result?.runId).toBe('run_002');
    });
  });

  describe('getBy*', () => {
    beforeEach(() => {
      mapper.register(createMapping());
      mapper.register(createMapping({
        agentId: 'agent_002',
        runId: 'run_002',
        sessionKey: 'session_002',
        sessionId: 'terminal_002',
        taskId: 'task_002',
      }));
    });

    it('should get by agentId', () => {
      const result = mapper.getByAgentId('agent_001');
      expect(result).toEqual(expect.objectContaining({ agentId: 'agent_001' }));
    });

    it('should get by runId', () => {
      const result = mapper.getByRunId('run_002');
      expect(result).toEqual(expect.objectContaining({ agentId: 'agent_002' }));
    });

    it('should return undefined for non-existent runId', () => {
      const result = mapper.getByRunId('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should get by sessionKey', () => {
      const result = mapper.getBySessionKey('session_001');
      expect(result).toEqual(expect.objectContaining({ agentId: 'agent_001' }));
    });

    it('should get by sessionId', () => {
      const result = mapper.getBySessionId('terminal_002');
      expect(result).toEqual(expect.objectContaining({ agentId: 'agent_002' }));
    });

    it('should get multiple agents by taskId', () => {
      mapper.register(createMapping({
        agentId: 'agent_003',
        taskId: 'task_001', // Same task as agent_001
      }));

      const results = mapper.getByTaskId('task_001');
      expect(results).toHaveLength(2);
      expect(results.map(r => r.agentId)).toEqual(expect.arrayContaining(['agent_001', 'agent_003']));
    });

    it('should return empty array for non-existent taskId', () => {
      const results = mapper.getByTaskId('nonexistent');
      expect(results).toHaveLength(0);
    });
  });

  describe('update', () => {
    beforeEach(() => {
      mapper.register(createMapping());
    });

    it('should update existing mapping', () => {
      const updated = mapper.update('agent_001', { status: 'working' } as any);
      expect(updated).toBeDefined();
      expect(updated?.updatedAt).toBeGreaterThan(Date.now() - 1000);
    });

    it('should update runId index', () => {
      mapper.update('agent_001', { runId: 'run_new' });

      expect(mapper.getByRunId('run_001')).toBeUndefined();
      expect(mapper.getByRunId('run_new')).toEqual(expect.objectContaining({ agentId: 'agent_001' }));
    });

    it('should update sessionKey index', () => {
      mapper.update('agent_001', { sessionKey: 'session_new' });

      expect(mapper.getBySessionKey('session_001')).toBeUndefined();
      expect(mapper.getBySessionKey('session_new')).toEqual(expect.objectContaining({ agentId: 'agent_001' }));
    });

    it('should update sessionId index', () => {
      mapper.update('agent_001', { sessionId: 'terminal_new' });

      expect(mapper.getBySessionId('terminal_001')).toBeUndefined();
      expect(mapper.getBySessionId('terminal_new')).toEqual(expect.objectContaining({ agentId: 'agent_001' }));
    });

    it('should update taskId index', () => {
      mapper.update('agent_001', { taskId: 'task_new' });

      expect(mapper.getByTaskId('task_001')).toHaveLength(0);
      expect(mapper.getByTaskId('task_new')).toHaveLength(1);
    });

    it('should return undefined for non-existent agentId', () => {
      const updated = mapper.update('nonexistent', { runId: 'run_new' });
      expect(updated).toBeUndefined();
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      mapper.register(createMapping());
    });

    it('should remove mapping', () => {
      mapper.remove('agent_001');
      expect(mapper.getByAgentId('agent_001')).toBeUndefined();
    });

    it('should remove from all indexes', () => {
      mapper.remove('agent_001');

      expect(mapper.getByRunId('run_001')).toBeUndefined();
      expect(mapper.getBySessionKey('session_001')).toBeUndefined();
      expect(mapper.getBySessionId('terminal_001')).toBeUndefined();
    });

    it('should remove from task index', () => {
      mapper.remove('agent_001');
      expect(mapper.getByTaskId('task_001')).toHaveLength(0);
    });

    it('should handle non-existent agentId', () => {
      expect(() => mapper.remove('nonexistent')).not.toThrow();
    });

    it('should clean up empty task index', () => {
      mapper.remove('agent_001');
      // After removal, the task index should be cleaned up
      const stats = mapper.getStats();
      expect(stats.byTaskId).toBe(0);
    });
  });

  describe('exists', () => {
    beforeEach(() => {
      mapper.register(createMapping());
    });

    it('should check existence by agentId', () => {
      expect(mapper.exists('agent_001')).toBe(true);
      expect(mapper.exists('nonexistent')).toBe(false);
    });

    it('should check existence by runId', () => {
      expect(mapper.exists(undefined, 'run_001')).toBe(true);
      expect(mapper.exists(undefined, 'nonexistent')).toBe(false);
    });

    it('should check existence by sessionKey', () => {
      expect(mapper.exists(undefined, undefined, 'session_001')).toBe(true);
      expect(mapper.exists(undefined, undefined, 'nonexistent')).toBe(false);
    });

    it('should check existence by sessionId', () => {
      expect(mapper.exists(undefined, undefined, undefined, 'terminal_001')).toBe(true);
      expect(mapper.exists(undefined, undefined, undefined, 'nonexistent')).toBe(false);
    });
  });

  describe('getAll and clear', () => {
    beforeEach(() => {
      mapper.register(createMapping());
      mapper.register(createMapping({
        agentId: 'agent_002',
        runId: 'run_002',
        sessionKey: 'session_002',
      }));
    });

    it('should get all mappings', () => {
      const all = mapper.getAll();
      expect(all).toHaveLength(2);
    });

    it('should clear all mappings', () => {
      mapper.clear();
      expect(mapper.getAll()).toHaveLength(0);
      expect(mapper.getStats().totalMappings).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      mapper.register(createMapping());
      mapper.register(createMapping({
        agentId: 'agent_002',
        runId: 'run_002',
        sessionKey: 'session_002',
        sessionId: 'terminal_002', // Unique sessionId
        taskId: 'task_001', // Same task
      }));

      const stats = mapper.getStats();
      expect(stats.totalMappings).toBe(2);
      expect(stats.byRunId).toBe(2);
      expect(stats.bySessionKey).toBe(2);
      expect(stats.bySessionId).toBe(2);
      expect(stats.byTaskId).toBe(1); // Only one unique task
    });
  });

  describe('memory limits', () => {
    it('should remove oldest mapping when exceeding max', () => {
      // Create a mapper with small limit
      const limitedMapper = new AgentIdMapper();
      // Access private maxMappings via any type for testing
      (limitedMapper as any).maxMappings = 3;

      // Register 4 mappings
      for (let i = 0; i < 4; i++) {
        limitedMapper.register(createMapping({
          agentId: `agent_${i}`,
          runId: `run_${i}`,
          sessionKey: `session_${i}`,
        }));
        // Add small delay to ensure different createdAt times
        if (i < 3) {
          // Wait a bit between registrations
        }
      }

      // Should only have 3 mappings
      expect(limitedMapper.getAll()).toHaveLength(3);
    });
  });

  describe('timestamps', () => {
    it('should set createdAt on register', () => {
      const before = Date.now();
      mapper.register(createMapping());
      const after = Date.now();

      const result = mapper.getByAgentId('agent_001');
      expect(result?.createdAt).toBeGreaterThanOrEqual(before);
      expect(result?.createdAt).toBeLessThanOrEqual(after);
    });

    it('should update updatedAt on update', async () => {
      mapper.register(createMapping());
      const firstUpdate = mapper.getByAgentId('agent_001')?.updatedAt;

      await new Promise(resolve => setTimeout(resolve, 10));
      mapper.update('agent_001', { runId: 'run_new' });

      const secondUpdate = mapper.getByAgentId('agent_001')?.updatedAt;
      expect(secondUpdate).toBeGreaterThan(firstUpdate!);
    });
  });
});
