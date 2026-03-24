/**
 * Unified State Manager Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UnifiedStateManager, getGlobalStateManager, resetGlobalStateManager } from './UnifiedStateManager';
import type { UnifiedAgentState } from './UnifiedAgentState';

describe('UnifiedStateManager', () => {
  let manager: UnifiedStateManager;

  beforeEach(() => {
    manager = new UnifiedStateManager({
      maxEvents: 1000,
      snapshotInterval: 0, // 禁用自动快照
    });
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('Agent 状态管理', () => {
    it('应该创建 Agent 状态', () => {
      const agent = manager.createAgent({
        id: 'agent_001',
        role: 'coder',
        status: 'idle',
      });

      expect(agent.id).toBe('agent_001');
      expect(agent.role).toBe('coder');
      expect(agent.status).toBe('idle');
      expect(agent.actionCount).toBe(0);
      expect(agent.startedAt).toBeDefined();
    });

    it('应该抛出错误当创建已存在的 Agent', () => {
      manager.createAgent({
        id: 'agent_001',
        role: 'coder',
        status: 'idle',
      });

      expect(() => {
        manager.createAgent({
          id: 'agent_001',
          role: 'coder',
          status: 'idle',
        });
      }).toThrow('already exists');
    });

    it('应该获取 Agent 状态', () => {
      manager.createAgent({
        id: 'agent_001',
        role: 'coder',
        status: 'idle',
      });

      const agent = manager.getAgent('agent_001');
      expect(agent).toBeDefined();
      expect(agent?.id).toBe('agent_001');
    });

    it('应该返回 undefined 当获取不存在的 Agent', () => {
      const agent = manager.getAgent('nonexistent');
      expect(agent).toBeUndefined();
    });

    it('应该更新 Agent 状态', () => {
      manager.createAgent({
        id: 'agent_001',
        role: 'coder',
        status: 'idle',
      });

      const updated = manager.updateState('agent_001', {
        status: 'thinking',
        taskDescription: 'Test task',
      });

      expect(updated?.status).toBe('thinking');
      expect(updated?.taskDescription).toBe('Test task');
      expect(updated?.lastEventAt).toBeDefined();
    });

    it('应该返回 undefined 当更新不存在的 Agent', () => {
      const result = manager.updateState('nonexistent', { status: 'thinking' });
      expect(result).toBeUndefined();
    });

    it('应该移除 Agent', () => {
      manager.createAgent({
        id: 'agent_001',
        role: 'coder',
        status: 'idle',
      });

      const removed = manager.removeAgent('agent_001');
      expect(removed).toBe(true);
      expect(manager.getAgent('agent_001')).toBeUndefined();
    });

    it('应该返回 false 当移除不存在的 Agent', () => {
      const removed = manager.removeAgent('nonexistent');
      expect(removed).toBe(false);
    });

    it('应该获取所有 Agent 状态', () => {
      manager.createAgent({ id: 'agent_001', role: 'coder', status: 'idle' });
      manager.createAgent({ id: 'agent_002', role: 'researcher', status: 'thinking' });
      manager.createAgent({ id: 'agent_003', role: 'tester', status: 'idle' });

      const agents = manager.getAllAgents();
      expect(agents.length).toBe(3);
    });
  });

  describe('状态机转换', () => {
    it('应该允许有效的状态转换', () => {
      manager.createAgent({
        id: 'agent_001',
        role: 'coder',
        status: 'spawning',
      });

      const result = manager.transitionState('agent_001', 'idle');
      expect(result.success).toBe(true);

      const agent = manager.getAgent('agent_001');
      expect(agent?.status).toBe('idle');
    });

    it('应该拒绝无效的状态转换', () => {
      manager.createAgent({
        id: 'agent_001',
        role: 'coder',
        status: 'spawning',
      });

      // spawning 不能直接到 terminated（根据状态机规则是可以的，所以需要测试其他无效转换）
      const result = manager.transitionState('agent_001', 'thinking');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid state transition');
    });

    it('应该允许 terminated 前的所有有效转换', () => {
      const validPaths = [
        ['spawning', 'idle', 'terminated'],
        ['spawning', 'error', 'idle', 'terminated'],
        ['spawning', 'idle', 'thinking', 'executing', 'terminated'],
      ];

      validPaths.forEach((path, index) => {
        const agentId = `agent_${index}`;
        manager.createAgent({
          id: agentId,
          role: 'coder',
          status: path[0] as any,
        });

        for (let i = 1; i < path.length; i++) {
          const result = manager.transitionState(agentId, path[i] as any);
          expect(result.success).toBe(true);
        }
      });
    });
  });

  describe('查询功能', () => {
    beforeEach(() => {
      manager.createAgent({ id: 'agent_001', role: 'coder', status: 'idle', taskDescription: 'Task A' });
      manager.createAgent({ id: 'agent_002', role: 'researcher', status: 'thinking', taskDescription: 'Task B' });
      manager.createAgent({ id: 'agent_003', role: 'coder', status: 'error', taskDescription: 'Task A' });
      manager.createAgent({ id: 'agent_004', role: 'tester', status: 'idle', taskDescription: 'Task C' });
    });

    it('应该按状态过滤', () => {
      const idleAgents = manager.queryAgents({ status: ['idle'] });
      expect(idleAgents.length).toBe(2);

      const errorAgents = manager.queryAgents({ status: ['error'] });
      expect(errorAgents.length).toBe(1);
    });

    it('应该按角色过滤', () => {
      const coders = manager.queryAgents({ role: ['coder'] });
      expect(coders.length).toBe(2);

      const researchers = manager.queryAgents({ role: ['researcher'] });
      expect(researchers.length).toBe(1);
    });

    it('应该按任务 ID 过滤', () => {
      // 这里用 taskDescription 模拟
      const taskAAgents = manager.queryAgents({ search: 'Task A' });
      expect(taskAAgents.length).toBe(2);
    });

    it('应该搜索关键词', () => {
      const searchResult = manager.queryAgents({ search: 'agent_001' });
      expect(searchResult.length).toBe(1);
      expect(searchResult[0].id).toBe('agent_001');
    });
  });

  describe('事件管理', () => {
    it('应该添加事件', () => {
      const event = {
        id: 'event_001',
        type: 'agent:created' as const,
        timestamp: Date.now(),
        agentId: 'agent_001',
        summary: 'Agent created',
        level: 'info' as const,
        source: 'orchestrator' as const,
      };

      manager.addEvent(event);
      const events = manager.getEvents();
      expect(events.length).toBe(1);
      expect(events[0].id).toBe('event_001');
    });

    it('应该限制事件数量', () => {
      const smallManager = new UnifiedStateManager({ maxEvents: 10, snapshotInterval: 0 });

      for (let i = 0; i < 100; i++) {
        smallManager.addEvent({
          id: `event_${i}`,
          type: 'system:info' as const,
          timestamp: Date.now(),
          summary: `Event ${i}`,
          level: 'info' as const,
        });
      }

      const events = smallManager.getEvents();
      expect(events.length).toBe(10);

      smallManager.destroy();
    });

    it('应该按 Agent ID 获取事件', () => {
      manager.addEvent({
        id: 'event_001',
        type: 'agent:created',
        timestamp: Date.now(),
        agentId: 'agent_001',
        summary: 'Agent 001 created',
        level: 'info',
      });
      manager.addEvent({
        id: 'event_002',
        type: 'agent:created',
        timestamp: Date.now(),
        agentId: 'agent_002',
        summary: 'Agent 002 created',
        level: 'info',
      });

      const agent1Events = manager.getEventsByAgent('agent_001');
      expect(agent1Events.length).toBe(1);
      expect(agent1Events[0].agentId).toBe('agent_001');
    });

    it('应该按时间过滤事件', () => {
      const now = Date.now();
      manager.addEvent({
        id: 'event_001',
        type: 'system:info',
        timestamp: now - 1000,
        summary: 'Old event',
        level: 'info',
      });
      manager.addEvent({
        id: 'event_002',
        type: 'system:info',
        timestamp: now,
        summary: 'New event',
        level: 'info',
      });

      const recentEvents = manager.getEvents(now - 500);
      expect(recentEvents.length).toBe(1);
      expect(recentEvents[0].id).toBe('event_002');
    });
  });

  describe('快照管理', () => {
    it('应该创建快照', () => {
      manager.createAgent({ id: 'agent_001', role: 'coder', status: 'idle' });
      manager.createAgent({ id: 'agent_002', role: 'researcher', status: 'thinking' });

      const snapshot = manager.createSnapshot();

      expect(snapshot.timestamp).toBeDefined();
      expect(snapshot.agents.size).toBe(2);
      expect(snapshot.eventCount).toBe(2); // 2 个 agent:created 事件
    });

    it('应该限制快照数量', () => {
      for (let i = 0; i < 15; i++) {
        manager.createSnapshot();
      }

      expect(manager.getSnapshots().length).toBe(10);
    });

    it('应该获取快照列表', () => {
      manager.createSnapshot();
      manager.createSnapshot();

      const snapshots = manager.getSnapshots();
      expect(snapshots.length).toBe(2);
      snapshots.forEach(s => {
        expect(s.timestamp).toBeDefined();
        expect(s.eventCount).toBeDefined();
        expect(s.agentCount).toBeDefined();
      });
    });

    it('应该恢复到快照', () => {
      manager.createAgent({ id: 'agent_001', role: 'coder', status: 'idle' });
      const snapshot1 = manager.createSnapshot();

      manager.createAgent({ id: 'agent_002', role: 'researcher', status: 'thinking' });
      expect(manager.getAgentCount()).toBe(2);

      manager.restoreSnapshot(0);
      expect(manager.getAgentCount()).toBe(1);
    });
  });

  describe('统计信息', () => {
    it('应该获取统计信息', () => {
      manager.createAgent({ id: 'agent_001', role: 'coder', status: 'idle' });
      manager.createAgent({ id: 'agent_002', role: 'coder', status: 'thinking' });
      manager.createAgent({ id: 'agent_003', role: 'tester', status: 'error' });

      const stats = manager.getStats();

      expect(stats.total).toBe(3);
      expect(stats.byStatus.idle).toBe(1);
      expect(stats.byStatus.thinking).toBe(1);
      expect(stats.byStatus.error).toBe(1);
      expect(stats.byRole.coder).toBe(2);
      expect(stats.byRole.tester).toBe(1);
      expect(stats.activeCount).toBe(2); // thinking + error
      expect(stats.errorCount).toBe(1);
    });
  });

  describe('EventEmitter', () => {
    it('应该触发 agent:created 事件', () => {
      const listener = vi.fn();
      manager.on('agent:created', listener);

      manager.createAgent({ id: 'agent_001', role: 'coder', status: 'idle' });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ agentId: 'agent_001' });
    });

    it('应该触发 agent:changed 事件', () => {
      manager.createAgent({ id: 'agent_001', role: 'coder', status: 'idle' });

      const listener = vi.fn();
      manager.on('agent:changed', listener);

      manager.updateState('agent_001', { status: 'thinking' });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({
        agentId: 'agent_001',
        state: expect.objectContaining({ status: 'thinking' }),
      });
    });

    it('应该触发 agent:removed 事件', () => {
      manager.createAgent({ id: 'agent_001', role: 'coder', status: 'idle' });

      const listener = vi.fn();
      manager.on('agent:removed', listener);

      manager.removeAgent('agent_001');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ agentId: 'agent_001' });
    });

    it('应该触发 event:added 事件', () => {
      const listener = vi.fn();
      manager.on('event:added', listener);

      manager.addEvent({
        id: 'event_001',
        type: 'system:info',
        timestamp: Date.now(),
        summary: 'Test event',
        level: 'info',
      });

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('全局单例', () => {
    afterEach(() => {
      resetGlobalStateManager();
    });

    it('应该创建全局单例', () => {
      const manager1 = getGlobalStateManager();
      const manager2 = getGlobalStateManager();

      expect(manager1).toBe(manager2);
    });

    it('应该重置全局单例', () => {
      const manager1 = getGlobalStateManager();
      manager1.createAgent({ id: 'agent_001', role: 'coder', status: 'idle' });

      resetGlobalStateManager();

      const manager2 = getGlobalStateManager();
      expect(manager2.getAgent('agent_001')).toBeUndefined();
    });
  });

  describe('辅助方法', () => {
    it('应该增加动作计数', () => {
      manager.createAgent({ id: 'agent_001', role: 'coder', status: 'idle' });

      manager.incrementActionCount('agent_001');
      manager.incrementActionCount('agent_001');

      const agent = manager.getAgent('agent_001');
      expect(agent?.actionCount).toBe(2);
    });

    it('应该添加记忆 ID', () => {
      manager.createAgent({ id: 'agent_001', role: 'coder', status: 'idle' });

      manager.addMemoryId('agent_001', 'memory_001');
      manager.addMemoryId('agent_001', 'memory_002');

      const agent = manager.getAgent('agent_001');
      expect(agent?.memoryIds).toContain('memory_001');
      expect(agent?.memoryIds).toContain('memory_002');
    });

    it('应该重置状态管理器', () => {
      manager.createAgent({ id: 'agent_001', role: 'coder', status: 'idle' });
      manager.addEvent({
        id: 'event_001',
        type: 'system:info',
        timestamp: Date.now(),
        summary: 'Test',
        level: 'info',
      });

      manager.reset();

      expect(manager.getAgentCount()).toBe(0);
      expect(manager.getEvents().length).toBe(0);
    });
  });
});
