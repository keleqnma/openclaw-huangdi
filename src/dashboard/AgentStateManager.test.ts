/**
 * AgentStateManager 单元测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AgentStateManager } from './AgentStateManager';
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// Mock OpenClawPluginApi
const createMockApi = (): OpenClawPluginApi => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  runtime: {
    subagent: {
      getSessionMessages: vi.fn().mockResolvedValue({ messages: [] }),
    },
    memory: {
      search: vi.fn(),
    },
  },
  on: vi.fn(),
});

describe('AgentStateManager', () => {
  let agentManager: AgentStateManager;
  let mockApi: OpenClawPluginApi;

  beforeEach(() => {
    vi.useFakeTimers();
    agentManager = new AgentStateManager(2000);
    mockApi = createMockApi();
    agentManager.setApi(mockApi);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('addSpawningAgent()', () => {
    it('should create a new agent in spawning state', () => {
      const agent = agentManager.addSpawningAgent('run-1', 'session-1');

      expect(agent.runId).toBe('run-1');
      expect(agent.sessionKey).toBe('session-1');
      expect(agent.roleId).toBe('planner'); // Default role
      expect(agent.status).toBe('spawning');
      expect(agent.avatar.roleId).toBe('planner');
      expect(agent.avatar.emoji).toBe('📋');
      expect(agent.avatar.color).toBe('#FFD93D');
    });

    it('should store the agent in the map', () => {
      agentManager.addSpawningAgent('run-1', 'session-1');

      const stored = agentManager.getAgent('run-1');
      expect(stored).toBeDefined();
      expect(stored?.sessionKey).toBe('session-1');
    });

    it('should create multiple agents', () => {
      agentManager.addSpawningAgent('run-1', 'session-1');
      agentManager.addSpawningAgent('run-2', 'session-2');

      expect(agentManager.getAllAgents().length).toBe(2);
    });
  });

  describe('updateAgentSpawned()', () => {
    beforeEach(() => {
      agentManager.addSpawningAgent('run-1', 'session-1');
    });

    it('should update agent role and task', () => {
      const agent = agentManager.updateAgentSpawned('run-1', 'coder', 'Write code');

      expect(agent?.roleId).toBe('coder');
      expect(agent?.task).toBe('Write code');
      expect(agent?.status).toBe('idle');
    });

    it('should update avatar based on role', () => {
      const agent = agentManager.updateAgentSpawned('run-1', 'researcher');

      expect(agent?.avatar.roleId).toBe('researcher');
      expect(agent?.avatar.emoji).toBe('🔍');
      expect(agent?.avatar.color).toBe('#FF9F43');
    });

    it('should return undefined for non-existent agent', () => {
      const agent = agentManager.updateAgentSpawned('non-existent', 'coder');
      expect(agent).toBeUndefined();
    });

    it('should start polling for messages', () => {
      // Polling starts internally, verify by checking timer is set
      agentManager.updateAgentSpawned('run-1', 'coder');

      // Fast-forward time to trigger polling
      vi.advanceTimersByTime(2500);

      // Verify API was called for messages
      expect(mockApi.runtime.subagent.getSessionMessages).toHaveBeenCalled();
    });
  });

  describe('updateAgentStatus()', () => {
    beforeEach(() => {
      agentManager.addSpawningAgent('run-1', 'session-1');
      agentManager.updateAgentSpawned('run-1', 'coder');
    });

    it('should update agent status', () => {
      const agent = agentManager.updateAgentStatus('run-1', 'thinking');

      expect(agent?.status).toBe('thinking');
    });

    it('should set endTime for completed status', () => {
      const beforeTime = Date.now();
      const agent = agentManager.updateAgentStatus('run-1', 'completed');
      const afterTime = Date.now();

      expect(agent?.endTime).toBeDefined();
      expect(agent?.endTime!).toBeGreaterThanOrEqual(beforeTime);
      expect(agent?.endTime!).toBeLessThanOrEqual(afterTime);
    });

    it('should set endTime for error status', () => {
      agentManager.updateAgentStatus('run-1', 'error');

      const agent = agentManager.getAgent('run-1');
      expect(agent?.endTime).toBeDefined();
    });

    it('should stop polling for completed agents', () => {
      agentManager.updateAgentStatus('run-1', 'completed');

      // Fast-forward time
      vi.advanceTimersByTime(2500);

      // Should not poll again after completion
      const callsBefore = (mockApi.runtime.subagent.getSessionMessages as any).mock.calls.length;
      vi.advanceTimersByTime(2500);
      const callsAfter = (mockApi.runtime.subagent.getSessionMessages as any).mock.calls.length;

      expect(callsAfter).toBe(callsBefore);
    });

    it('should return undefined for non-existent agent', () => {
      const agent = agentManager.updateAgentStatus('non-existent', 'completed');
      expect(agent).toBeUndefined();
    });
  });

  describe('updateAgentIO()', () => {
    beforeEach(() => {
      agentManager.addSpawningAgent('run-1', 'session-1');
      agentManager.updateAgentSpawned('run-1', 'coder');
    });

    it('should update agent input', () => {
      const agent = agentManager.updateAgentIO('run-1', 'Hello world');

      expect(agent?.input).toBe('Hello world');
    });

    it('should update agent output', () => {
      const agent = agentManager.updateAgentIO('run-1', undefined, 'Response');

      expect(agent?.output).toBe('Response');
    });

    it('should update both input and output', () => {
      const agent = agentManager.updateAgentIO('run-1', 'Input', 'Output');

      expect(agent?.input).toBe('Input');
      expect(agent?.output).toBe('Output');
    });

    it('should return undefined for non-existent agent', () => {
      const agent = agentManager.updateAgentIO('non-existent', 'Input');
      expect(agent).toBeUndefined();
    });
  });

  describe('getAgent() and getAllAgents()', () => {
    beforeEach(() => {
      agentManager.addSpawningAgent('run-1', 'session-1');
      agentManager.addSpawningAgent('run-2', 'session-2');
    });

    it('should get agent by runId', () => {
      const agent = agentManager.getAgent('run-1');

      expect(agent).toBeDefined();
      expect(agent?.runId).toBe('run-1');
    });

    it('should return undefined for non-existent agent', () => {
      const agent = agentManager.getAgent('non-existent');
      expect(agent).toBeUndefined();
    });

    it('should get all agents', () => {
      const agents = agentManager.getAllAgents();

      expect(agents.length).toBe(2);
    });

    it('should get active agents only', () => {
      agentManager.updateAgentStatus('run-1', 'completed');

      const active = agentManager.getActiveAgents();
      expect(active.length).toBe(1);
      expect(active[0].runId).toBe('run-2');
    });
  });

  describe('removeAgent()', () => {
    beforeEach(() => {
      agentManager.addSpawningAgent('run-1', 'session-1');
      agentManager.updateAgentSpawned('run-1', 'coder');
    });

    it('should remove agent from map', () => {
      agentManager.removeAgent('run-1');

      const agent = agentManager.getAgent('run-1');
      expect(agent).toBeUndefined();
    });

    it('should stop polling for removed agent', () => {
      agentManager.removeAgent('run-1');

      // Fast-forward time
      vi.advanceTimersByTime(2500);

      // Should not poll for removed agent
      expect(mockApi.runtime.subagent.getSessionMessages).not.toHaveBeenCalled();
    });

    it('should not error for non-existent agent', () => {
      expect(() => agentManager.removeAgent('non-existent')).not.toThrow();
    });
  });

  describe('clear()', () => {
    beforeEach(() => {
      agentManager.addSpawningAgent('run-1', 'session-1');
      agentManager.addSpawningAgent('run-2', 'session-2');
      agentManager.updateAgentSpawned('run-1', 'coder');
    });

    it('should clear all agents', () => {
      agentManager.clear();

      expect(agentManager.getAllAgents().length).toBe(0);
    });

    it('should stop all polling intervals', () => {
      agentManager.clear();

      vi.advanceTimersByTime(2500);
      expect(mockApi.runtime.subagent.getSessionMessages).not.toHaveBeenCalled();
    });
  });

  describe('Avatar configuration', () => {
    it('should create correct avatar for researcher', () => {
      agentManager.addSpawningAgent('run-1', 'session-1');
      const agent = agentManager.updateAgentSpawned('run-1', 'researcher');

      expect(agent?.avatar).toEqual({
        roleId: 'researcher',
        emoji: '🔍',
        color: '#FF9F43',
        variant: 0,
      });
    });

    it('should create correct avatar for coder', () => {
      agentManager.addSpawningAgent('run-1', 'session-1');
      const agent = agentManager.updateAgentSpawned('run-1', 'coder');

      expect(agent?.avatar).toEqual({
        roleId: 'coder',
        emoji: '👨‍💻',
        color: '#54A0FF',
        variant: 0,
      });
    });

    it('should create correct avatar for reviewer', () => {
      agentManager.addSpawningAgent('run-1', 'session-1');
      const agent = agentManager.updateAgentSpawned('run-1', 'reviewer');

      expect(agent?.avatar).toEqual({
        roleId: 'reviewer',
        emoji: '👓',
        color: '#A55EEA',
        variant: 0,
      });
    });

    it('should create correct avatar for tester', () => {
      agentManager.addSpawningAgent('run-1', 'session-1');
      const agent = agentManager.updateAgentSpawned('run-1', 'tester');

      expect(agent?.avatar).toEqual({
        roleId: 'tester',
        emoji: '🧪',
        color: '#42D18E',
        variant: 0,
      });
    });

    it('should create correct avatar for writer', () => {
      agentManager.addSpawningAgent('run-1', 'session-1');
      const agent = agentManager.updateAgentSpawned('run-1', 'writer');

      expect(agent?.avatar).toEqual({
        roleId: 'writer',
        emoji: '✍️',
        color: '#FF6B9D',
        variant: 0,
      });
    });

    it('should create correct avatar for planner', () => {
      agentManager.addSpawningAgent('run-1', 'session-1');
      const agent = agentManager.updateAgentSpawned('run-1', 'planner');

      expect(agent?.avatar).toEqual({
        roleId: 'planner',
        emoji: '📋',
        color: '#FFD93D',
        variant: 0,
      });
    });
  });

  describe('Message polling', () => {
    it('should poll messages and update agent data', async () => {
      // Setup mock messages
      const mockMessages = [
        { role: 'user', content: 'Hello', id: 'msg-1' },
        { role: 'assistant', content: 'Hi there', id: 'msg-2' },
      ];

      (mockApi.runtime.subagent.getSessionMessages as any).mockResolvedValue({
        messages: mockMessages,
      });

      agentManager.addSpawningAgent('run-1', 'session-1');
      agentManager.updateAgentSpawned('run-1', 'coder');

      // Fast-forward to trigger polling
      vi.advanceTimersByTime(2500);

      // Wait for async operation
      await vi.runAllTicks();

      // Verify API was called
      expect(mockApi.runtime.subagent.getSessionMessages).toHaveBeenCalledWith({
        sessionKey: 'session-1',
        limit: 50,
      });
    });

    it('should handle polling errors gracefully', async () => {
      (mockApi.runtime.subagent.getSessionMessages as any).mockRejectedValue(new Error('Failed'));

      agentManager.addSpawningAgent('run-1', 'session-1');
      agentManager.updateAgentSpawned('run-1', 'coder');

      // Fast-forward to trigger polling
      vi.advanceTimersByTime(2500);

      await vi.runAllTicks();

      // Should not throw, just log warning
      expect(mockApi.logger.warn).toHaveBeenCalled();
    });
  });
});
