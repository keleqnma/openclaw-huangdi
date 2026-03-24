/**
 * HierarchicalContextEngine Test Suite
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  HierarchicalContextEngine,
  createHierarchicalContext,
  type ContextLayerType,
  type MemoryRecord
} from './HierarchicalContextEngine';

describe('HierarchicalContextEngine', () => {
  let engine: HierarchicalContextEngine;

  beforeEach(() => {
    engine = createHierarchicalContext('medium');
  });

  describe('setAgentContext()', () => {
    it('should set agent context', () => {
      engine.setAgentContext('agent-1', 'team-1', 'task-1');
      const stats = engine.getStats();

      expect(stats.agentId).toBe('agent-1');
      expect(stats.teamId).toBe('team-1');
      expect(stats.taskId).toBe('task-1');
    });
  });

  describe('addMessage()', () => {
    it('should add message to system layer', () => {
      engine.addMessage('system', { role: 'system', content: 'System instruction' });

      const layer = engine.getLayer('system');
      expect(layer.messages.length).toBe(1);
      expect(layer.messages[0].content).toBe('System instruction');
    });

    it('should add message to task layer', () => {
      engine.addMessage('task', { role: 'user', content: 'Task description' });

      const layer = engine.getLayer('task');
      expect(layer.messages.length).toBe(1);
    });

    it('should add message to team layer', () => {
      engine.addMessage('team', { role: 'assistant', content: 'Team knowledge' });

      const layer = engine.getLayer('team');
      expect(layer.messages.length).toBe(1);
    });

    it('should add message to local layer', () => {
      engine.addMessage('local', { role: 'user', content: 'Local context' });

      const layer = engine.getLayer('local');
      expect(layer.messages.length).toBe(1);
    });
  });

  describe('addMemory()', () => {
    it('should add memory to layer', () => {
      const memory: MemoryRecord = {
        id: 'mem-1',
        content: 'Test memory',
        metadata: {
          source: 'test',
          timestamp: Date.now(),
          importance: 0.8
        }
      };

      engine.addMemory(memory, 'local');

      const layer = engine.getLayer('local');
      expect(layer.memories.length).toBe(1);
    });

    it('should index memory by agentId', () => {
      engine.setAgentContext('agent-1');

      const memory: MemoryRecord = {
        id: 'mem-1',
        content: 'Agent memory',
        metadata: {
          source: 'test',
          agentId: 'agent-1',
          timestamp: Date.now(),
          importance: 0.8
        }
      };

      engine.addMemory(memory, 'local');

      const snapshot = engine.getSnapshot();
      // Memory is added to both layer and agent index
      expect(snapshot.memoryCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('searchMemories()', () => {
    beforeEach(async () => {
      engine.setAgentContext('agent-1');

      // Add memories
      await engine.addMemory({
        id: 'mem-1',
        content: 'Important memory about API design',
        metadata: {
          source: 'test',
          agentId: 'agent-1',
          timestamp: Date.now(),
          importance: 0.9
        }
      }, 'local');

      await engine.addMemory({
        id: 'mem-2',
        content: 'Secondary memory about testing',
        metadata: {
          source: 'test',
          agentId: 'agent-1',
          timestamp: Date.now(),
          importance: 0.6
        }
      }, 'local');
    });

    it('should search memories by query', async () => {
      const memories = await engine.searchMemories('API', { limit: 5 });

      expect(memories.length).toBeGreaterThan(0);
    });

    it('should respect limit parameter', async () => {
      const memories = await engine.searchMemories('', { limit: 1 });

      expect(memories.length).toBe(1);
    });

    it('should rank by importance', async () => {
      const memories = await engine.searchMemories('', { limit: 10 });

      expect(memories[0].metadata.importance).toBeGreaterThanOrEqual(
        memories[memories.length - 1].metadata.importance
      );
    });
  });

  describe('getOptimizedContext()', () => {
    beforeEach(() => {
      engine.addMessage('system', { role: 'system', content: 'System prompt' });
      engine.addMessage('task', { role: 'user', content: 'Task info' });
      engine.addMessage('local', { role: 'assistant', content: 'Local response' });
    });

    it('should return optimized messages', async () => {
      const messages = await engine.getOptimizedContext();

      expect(messages.length).toBe(3);
    });

    it('should order by layer priority', async () => {
      const messages = await engine.getOptimizedContext();

      // System should come first (priority 0)
      expect(messages[0].role).toBe('system');
    });
  });

  describe('getContextWithMetadata()', () => {
    beforeEach(() => {
      engine.addMessage('system', { role: 'system', content: 'System' });
      engine.addMessage('local', { role: 'user', content: 'User message' });
    });

    it('should return messages with layer metadata', () => {
      const context = engine.getContextWithMetadata();

      expect(context.length).toBe(2);
      expect(context[0].layer).toBe('system');
      expect(context[1].layer).toBe('local');
    });
  });

  describe('compressLayer()', () => {
    it('should compress layer messages', () => {
      // Add 20 messages to local layer
      for (let i = 0; i < 20; i++) {
        engine.addMessage('local', { role: 'user', content: `Message ${i}` });
      }

      engine.compressLayer('local');

      const layer = engine.getLayer('local');
      expect(layer.messages.length).toBeLessThan(20);
    });

    it('should not compress non-compressible layers', () => {
      engine.addMessage('system', { role: 'system', content: 'System' });
      engine.addMessage('system', { role: 'system', content: 'System 2' });

      engine.compressLayer('system');

      const layer = engine.getLayer('system');
      // System layer is not compressible
      expect(layer.messages.length).toBe(2);
    });
  });

  describe('compressToFit()', () => {
    it('should compress layers to fit budget', () => {
      // Add many messages to exceed budget
      for (let i = 0; i < 100; i++) {
        engine.addMessage('local', { role: 'user', content: `Message ${i} - ${'x'.repeat(100)}` });
      }

      engine.compressToFit();

      const stats = engine.getStats();
      expect(stats.totalTokens).toBeLessThanOrEqual(stats.totalBudget);
    });
  });

  describe('clearLayer()', () => {
    it('should clear specific layer', () => {
      engine.addMessage('local', { role: 'user', content: 'To clear' });
      engine.addMemory({
        id: 'mem-1',
        content: 'Memory to clear',
        metadata: { source: 'test', timestamp: Date.now(), importance: 0.5 }
      }, 'local');

      engine.clearLayer('local');

      const layer = engine.getLayer('local');
      expect(layer.messages.length).toBe(0);
      expect(layer.memories.length).toBe(0);
    });
  });

  describe('clear()', () => {
    it('should clear all layers', () => {
      engine.addMessage('system', { role: 'system', content: 'System' });
      engine.addMessage('local', { role: 'user', content: 'Local' });

      engine.clear();

      const snapshot = engine.getSnapshot();
      expect(snapshot.totalMessages).toBe(0);
      expect(snapshot.memoryCount).toBe(0);
    });
  });

  describe('getLayer()', () => {
    it('should get layer by type', () => {
      const systemLayer = engine.getLayer('system');
      expect(systemLayer.type).toBe('system');
      expect(systemLayer.priority).toBe(0);
    });

    it('should return all layers', () => {
      const layers = engine.getLayers();
      expect(layers.length).toBe(4);
    });
  });

  describe('getSnapshot()', () => {
    it('should return context snapshot', () => {
      engine.addMessage('system', { role: 'system', content: 'System' });

      const snapshot = engine.getSnapshot();

      expect(snapshot.totalMessages).toBe(1);
      expect(snapshot.layers.length).toBe(4);
    });
  });

  describe('getStats()', () => {
    it('should return layer statistics', () => {
      engine.addMessage('system', { role: 'system', content: 'System' });
      engine.addMessage('local', { role: 'user', content: 'Local' });

      const stats = engine.getStats();

      expect(stats.layerStats.length).toBe(4);
      expect(stats.totalTokens).toBeGreaterThan(0);
    });

    it('should include agent context', () => {
      engine.setAgentContext('agent-1', 'team-1', 'task-1');

      const stats = engine.getStats();

      expect(stats.agentId).toBe('agent-1');
      expect(stats.teamId).toBe('team-1');
      expect(stats.taskId).toBe('task-1');
    });
  });

  describe('syncToAgent()', () => {
    it('should sync context to another agent', async () => {
      engine.setAgentContext('agent-1');
      engine.addMessage('team', { role: 'assistant', content: 'Team knowledge' });

      await engine.syncToAgent('agent-2', 'team');

      // Verified that sync completes without error
      expect(true).toBe(true);
    });
  });
});

describe('createHierarchicalContext', () => {
  it('should create small context engine', () => {
    const engine = createHierarchicalContext('small');
    const stats = engine.getStats();

    expect(stats.totalBudget).toBe(32000);
  });

  it('should create medium context engine', () => {
    const engine = createHierarchicalContext('medium');
    const stats = engine.getStats();

    expect(stats.totalBudget).toBe(128000);
  });

  it('should create large context engine', () => {
    const engine = createHierarchicalContext('large');
    const stats = engine.getStats();

    expect(stats.totalBudget).toBe(256000);
  });
});
