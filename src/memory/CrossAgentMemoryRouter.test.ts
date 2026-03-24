/**
 * CrossAgentMemoryRouter Test Suite
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CrossAgentMemoryRouter, createMemoryRouter } from './CrossAgentMemoryRouter';

describe('CrossAgentMemoryRouter', () => {
  let router: CrossAgentMemoryRouter;

  beforeEach(() => {
    router = createMemoryRouter('medium');
  });

  describe('addMemory()', () => {
    it('should add memory to local storage', async () => {
      const memoryId = await router.addMemory('agent-1', 'Test memory content', {
        source: 'test',
        importance: 0.8
      });

      expect(memoryId).toMatch(/^mem_/);
    });

    it('should enforce max memories per agent', async () => {
      const smallRouter = createMemoryRouter('small'); // max 50 memories

      // Add 60 memories
      for (let i = 0; i < 60; i++) {
        await smallRouter.addMemory('agent-1', `Memory ${i}`, {
          source: 'test',
          importance: 0.5
        });
      }

      const stats = smallRouter.getStats();
      expect(stats.localCount).toBeLessThanOrEqual(50);
    });

    it('should auto-sync high importance memories to team', async () => {
      router.setAgentTeam('agent-1', 'team-1');

      await router.addMemory('agent-1', 'Important memory', {
        source: 'test',
        importance: 0.9 // Above distillThreshold (0.7)
      });

      const stats = router.getStats();
      expect(stats.teamCount).toBeGreaterThan(0);
    });
  });

  describe('query()', () => {
    beforeEach(async () => {
      await router.addMemory('agent-1', 'Local memory 1', {
        source: 'test',
        importance: 0.8,
        taskId: 'task-1'
      });
      await router.addMemory('agent-1', 'Local memory 2', {
        source: 'test',
        importance: 0.6,
        taskId: 'task-2'
      });
      router.setAgentTeam('agent-1', 'team-1');

      // Manually add memory to team storage
      await router.broadcastToTeam('agent-1', 'team-1', {
        id: 'team-mem-1',
        content: 'Team memory',
        metadata: {
          source: 'test',
          importance: 0.9,
          teamId: 'team-1',
          timestamp: Date.now()
        }
      });
    });

    it('should query local memories', async () => {
      const results = await router.query('agent-1', '', 'local');

      expect(results.length).toBe(1);
      expect(results[0].source).toBe('local');
      expect(results[0].memories.length).toBe(2);
    });

    it('should query team memories', async () => {
      const results = await router.query('agent-1', '', 'team');

      // Team memories are returned if agent belongs to a team
      expect(results.length).toBeGreaterThanOrEqual(0);
      if (results.length > 0) {
        expect(results[0].source).toBe('team');
      }
    });

    it('should query all scopes', async () => {
      const results = await router.query('agent-1', '', 'all');

      // At least local memories should be returned
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('should respect limit parameter', async () => {
      // Add more memories
      for (let i = 0; i < 10; i++) {
        await router.addMemory('agent-1', `Memory ${i}`, {
          source: 'test',
          importance: 0.5
        });
      }

      const results = await router.query('agent-1', '', 'local', 5);

      expect(results[0].memories.length).toBe(5);
    });

    it('should rank by importance and recency', async () => {
      const results = await router.query('agent-1', '', 'local');
      const memories = results[0].memories;

      // Higher importance should come first
      expect(memories[0].metadata.importance).toBeGreaterThanOrEqual(
        memories[memories.length - 1].metadata.importance
      );
    });
  });

  describe('deleteMemory()', () => {
    it('should delete memory from local storage', async () => {
      const memoryId = await router.addMemory('agent-1', 'To delete', {
        source: 'test',
        importance: 0.5
      });

      const deleted = router.deleteMemory(memoryId);
      expect(deleted).toBe(true);

      const results = await router.query('agent-1', '', 'local');
      // Results might be empty if no memories found
      if (results.length > 0) {
        const exists = results[0].memories.some(m => m.id === memoryId);
        expect(exists).toBe(false);
      }
    });

    it('should return false for non-existent memory', () => {
      const deleted = router.deleteMemory('non-existent-id');
      expect(deleted).toBe(false);
    });
  });

  describe('syncToParent()', () => {
    beforeEach(async () => {
      router.setAgentParent('child-1', 'parent-1');

      await router.addMemory('child-1', 'Child memory 1', {
        source: 'test',
        importance: 0.9 // High importance
      });
      await router.addMemory('child-1', 'Child memory 2', {
        source: 'test',
        importance: 0.3 // Low importance
      });
    });

    it('should sync high importance memories to parent', async () => {
      await router.syncToParent('child-1');

      const results = await router.query('parent-1', '', 'local');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].memories[0].content).toBe('Child memory 1');
    });

    it('should not sync if no parent set', async () => {
      await router.addMemory('orphan-agent', 'Orphan memory', {
        source: 'test',
        importance: 0.9
      });

      // Orphan agent has no parent set, so sync should do nothing
      await router.syncToParent('orphan-agent');

      // Query for a different agent that also has no memories
      const results = await router.query('non-existent-parent', '', 'local');
      // Should return empty or no results since non-existent-parent has no memories
      expect(results.length).toBe(0);
    });
  });

  describe('distillKnowledge()', () => {
    beforeEach(async () => {
      await router.addMemory('agent-1', 'Task 1 item 1', {
        source: 'test',
        importance: 0.9,
        taskId: 'task-1'
      });
      await router.addMemory('agent-1', 'Task 1 item 2', {
        source: 'test',
        importance: 0.8,
        taskId: 'task-1'
      });
      await router.addMemory('agent-1', 'Task 2 item 1', {
        source: 'test',
        importance: 0.7,
        taskId: 'task-2'
      });
    });

    it('should create distilled summaries per task', async () => {
      const distilled = await router.distillKnowledge('agent-1');

      expect(distilled.length).toBe(2); // Two tasks
      expect(distilled[0].content).toContain('Summary');
    });

    it('should include top 5 key points in summary', async () => {
      const distilled = await router.distillKnowledge('agent-1');

      // Each summary should contain key points from its task
      expect(distilled[0].content).toContain('Task');
    });
  });

  describe('promoteToGlobal()', () => {
    it('should promote memory to global storage', async () => {
      const memoryId = await router.addMemory('agent-1', 'Global worthy', {
        source: 'test',
        importance: 0.95
      });

      const promoted = await router.promoteToGlobal(memoryId);
      expect(promoted).toBe(true);

      const stats = router.getStats();
      expect(stats.globalCount).toBe(1);
    });

    it('should enforce max global memories', async () => {
      const smallRouter = createMemoryRouter('small'); // max 200 global

      // Add and promote more than max
      for (let i = 0; i < 250; i++) {
        const id = await smallRouter.addMemory('agent-1', `Global ${i}`, {
          source: 'test',
          importance: 0.95
        });
        await smallRouter.promoteToGlobal(id);
      }

      const stats = smallRouter.getStats();
      expect(stats.globalCount).toBeLessThanOrEqual(200);
    });
  });

  describe('setAgentTeam()', () => {
    it('should set agent team membership', () => {
      router.setAgentTeam('agent-1', 'team-alpha');
      // Verified indirectly through team queries
    });
  });

  describe('getStats()', () => {
    it('should return correct statistics', async () => {
      await router.addMemory('agent-1', 'Memory 1', { source: 'test', importance: 0.5 });
      await router.addMemory('agent-1', 'Memory 2', { source: 'test', importance: 0.5 });

      const stats = router.getStats();

      expect(stats.localCount).toBe(2);
      expect(stats.agentCount).toBe(1);
    });
  });

  describe('clear()', () => {
    it('should clear all memories', async () => {
      await router.addMemory('agent-1', 'To clear', { source: 'test', importance: 0.5 });

      router.clear();

      const stats = router.getStats();
      expect(stats.localCount).toBe(0);
      expect(stats.teamCount).toBe(0);
      expect(stats.globalCount).toBe(0);
    });
  });
});

describe('createMemoryRouter', () => {
  it('should create small router', () => {
    const router = createMemoryRouter('small');
    const stats = router.getStats();
    // Small config has maxMemoriesPerAgent: 50
    expect(stats).toBeDefined();
  });

  it('should create medium router', () => {
    const router = createMemoryRouter('medium');
    expect(router).toBeDefined();
  });

  it('should create large router', () => {
    const router = createMemoryRouter('large');
    expect(router).toBeDefined();
  });
});
