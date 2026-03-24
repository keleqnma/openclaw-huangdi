/**
 * Tests for UnifiedEventStore
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnifiedEventStore } from './UnifiedEventStore';
import type { TimelineEvent } from './events';

describe('UnifiedEventStore', () => {
  let store: UnifiedEventStore;

  beforeEach(() => {
    store = new UnifiedEventStore();
  });

  const createEvent = (overrides: Partial<TimelineEvent> = {}): TimelineEvent => ({
    id: 'event_001',
    type: 'agent:action',
    timestamp: Date.now(),
    agentId: 'agent_001',
    taskId: 'task_001',
    summary: 'Test event',
    level: 'info',
    source: 'orchestrator',
    ...overrides,
  });

  describe('add', () => {
    it('should add an event', () => {
      const event = createEvent();
      store.add(event);

      const result = store.getById('event_001');
      expect(result).toEqual(expect.objectContaining({
        id: 'event_001',
        agentId: 'agent_001',
      }));
    });

    it('should index by agentId', () => {
      store.add(createEvent());
      const events = store.getEventsByAgent('agent_001');
      expect(events).toHaveLength(1);
    });

    it('should index by taskId', () => {
      store.add(createEvent());
      const events = store.getEventsByTask('task_001');
      expect(events).toHaveLength(1);
    });

    it('should emit event', () => {
      const event = createEvent();
      const handler = vi.fn();
      store.on('event', handler);
      store.add(event);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should emit type-specific event', () => {
      const event = createEvent({ type: 'agent:thinking' });
      const handler = vi.fn();
      store.on('event:agent:thinking', handler);
      store.add(event);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should emit agent-specific event', () => {
      const event = createEvent({ agentId: 'agent_123' });
      const handler = vi.fn();
      store.on('event:agent:agent_123', handler);
      store.add(event);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should update existing event with same ID', () => {
      const event1 = createEvent();
      const event2 = createEvent({ summary: 'Updated summary' });

      store.add(event1);
      store.add(event2);

      const result = store.getById('event_001');
      expect(result?.summary).toBe('Updated summary');
    });
  });

  describe('addBatch', () => {
    it('should add multiple events', () => {
      const events = [
        createEvent({ id: 'event_001' }),
        createEvent({ id: 'event_002' }),
        createEvent({ id: 'event_003' }),
      ];

      store.addBatch(events);
      expect(store.getAllEvents()).toHaveLength(3);
    });
  });

  describe('getEvents*', () => {
    beforeEach(() => {
      store.addBatch([
        createEvent({ id: 'event_001', timestamp: 1000, agentId: 'agent_001', taskId: 'task_001' }),
        createEvent({ id: 'event_002', timestamp: 2000, agentId: 'agent_001', taskId: 'task_001' }),
        createEvent({ id: 'event_003', timestamp: 3000, agentId: 'agent_002', taskId: 'task_002' }),
        createEvent({ id: 'event_004', timestamp: 4000, agentId: 'agent_001', taskId: 'task_001' }),
      ]);
    });

    it('should get events since timestamp', () => {
      const events = store.getEventsSince(2500);
      expect(events).toHaveLength(2); // event_003 and event_004
    });

    it('should get events since timestamp for specific agent', () => {
      const events = store.getEventsSince(2500, 'agent_001');
      expect(events).toHaveLength(1); // only event_004
    });

    it('should get all events', () => {
      const events = store.getAllEvents();
      expect(events).toHaveLength(4);
    });

    it('should get events in range', () => {
      const events = store.getEventsInRange(1500, 3500);
      expect(events).toHaveLength(2); // event_002 and event_003
    });

    it('should get events by agent', () => {
      const events = store.getEventsByAgent('agent_001');
      expect(events).toHaveLength(3);
      expect(events[0].timestamp).toBe(4000); // Latest first
    });

    it('should get events by agent with limit', () => {
      const events = store.getEventsByAgent('agent_001', 2);
      expect(events).toHaveLength(2);
    });

    it('should get events by task', () => {
      const events = store.getEventsByTask('task_001');
      expect(events).toHaveLength(3);
    });

    it('should get filtered events', () => {
      const events = store.getFilteredEvents({
        types: ['agent:action'],
        agentId: 'agent_001',
      });
      expect(events).toHaveLength(3);
    });
  });

  describe('getAgentStatus', () => {
    it('should return thinking status', () => {
      store.add(createEvent({ type: 'agent:thinking', agentId: 'agent_001', timestamp: 1000 }));
      const status = store.getAgentStatus('agent_001');
      expect(status.status).toBe('thinking');
    });

    it('should return working status for action', () => {
      store.add(createEvent({ type: 'agent:action', agentId: 'agent_002', timestamp: 2000 }));
      const status = store.getAgentStatus('agent_002');
      expect(status.status).toBe('working');
    });

    it('should return status from details', () => {
      store.add(createEvent({
        type: 'agent:status',
        agentId: 'agent_003',
        details: { status: 'running' },
        timestamp: 3000,
      }));
      const status = store.getAgentStatus('agent_003');
      expect(status.status).toBe('running');
    });

    it('should return unknown for non-existent agent', () => {
      const status = store.getAgentStatus('nonexistent');
      expect(status.status).toBe('unknown');
    });
  });

  describe('update', () => {
    it('should update existing event', () => {
      store.add(createEvent({ summary: 'Original' }));
      const updated = store.update(createEvent({ summary: 'Updated' }));

      expect(updated).toBeDefined();
      expect(updated?.summary).toBe('Updated');
    });

    it('should return undefined for non-existent event', () => {
      const updated = store.update(createEvent({ id: 'nonexistent' }));
      expect(updated).toBeUndefined();
    });

    it('should emit update event', () => {
      store.add(createEvent());
      const handler = vi.fn();
      store.on('event:updated', handler);
      store.update(createEvent({ summary: 'Updated' }));
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('replay control', () => {
    beforeEach(() => {
      store.addBatch([
        createEvent({ id: 'event_001', timestamp: 1000 }),
        createEvent({ id: 'event_002', timestamp: 2000 }),
        createEvent({ id: 'event_003', timestamp: 3000 }),
        createEvent({ id: 'event_004', timestamp: 4000 }),
      ]);
    });

    it('should update replay state', () => {
      store.updateReplayState({ isPlaying: true, speed: 2 });
      const state = store.getReplayState();
      expect(state.isPlaying).toBe(true);
      expect(state.speed).toBe(2);
    });

    it('should return undefined when not playing', () => {
      const event = store.getNextReplayEvent();
      expect(event).toBeUndefined();
    });

    it('should get next replay event when playing', () => {
      store.updateReplayState({
        isPlaying: true,
        currentPosition: 1500,
        from: 1000,
        to: 4000,
      });

      const event = store.getNextReplayEvent();
      expect(event?.id).toBe('event_002');
    });

    it('should calculate replay tick interval', () => {
      store.updateReplayState({ speed: 2 });
      expect(store.getReplayTickInterval()).toBe(500);
    });
  });

  describe('cleanup', () => {
    it('should not cleanup if under limit', () => {
      const store = new UnifiedEventStore(100);
      for (let i = 0; i < 50; i++) {
        store.add(createEvent({ id: `event_${i}` }));
      }
      expect(store.getAllEvents()).toHaveLength(50);
    });

    it('should cleanup oldest events when exceeding limit', () => {
      const store = new UnifiedEventStore(10);
      for (let i = 0; i < 20; i++) {
        store.add(createEvent({ id: `event_${i}`, timestamp: i * 1000 }));
      }
      expect(store.getAllEvents()).toHaveLength(10);
      expect(store.getById('event_0')).toBeUndefined(); // Oldest deleted
      expect(store.getById('event_19')).toBeDefined(); // Newest kept
    });

    it('should clean up indexes after cleanup', () => {
      const store = new UnifiedEventStore(5);
      for (let i = 0; i < 10; i++) {
        store.add(createEvent({
          id: `event_${i}`,
          timestamp: i * 1000,
          agentId: 'agent_001',
        }));
      }
      const stats = store.getStats();
      expect(stats.byAgent.get('agent_001')).toBe(5);
    });
  });

  describe('clear', () => {
    beforeEach(() => {
      store.addBatch([
        createEvent({ id: 'event_001', agentId: 'agent_001' }),
        createEvent({ id: 'event_002', agentId: 'agent_001' }),
        createEvent({ id: 'event_003', agentId: 'agent_002' }),
      ]);
    });

    it('should clear all events', () => {
      store.clear();
      expect(store.getAllEvents()).toHaveLength(0);
      expect(store.getStats().totalEvents).toBe(0);
    });

    it('should clear specific agent events', () => {
      store.clear('agent_001');
      const events = store.getAllEvents();
      expect(events).toHaveLength(1);
      expect(events[0].agentId).toBe('agent_002');
    });

    it('should reset replay state', () => {
      store.updateReplayState({ isPlaying: true, from: 1000, to: 2000 });
      store.clear();
      const state = store.getReplayState();
      expect(state.isPlaying).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      store.addBatch([
        createEvent({ id: 'event_001', agentId: 'agent_001', level: 'info' }),
        createEvent({ id: 'event_002', agentId: 'agent_001', level: 'error' }),
        createEvent({ id: 'event_003', agentId: 'agent_002', level: 'info' }),
      ]);

      const stats = store.getStats();
      expect(stats.totalEvents).toBe(3);
      expect(stats.byAgent.get('agent_001')).toBe(2);
      expect(stats.byAgent.get('agent_002')).toBe(1);
      expect(stats.byLevel.get('info')).toBe(2);
      expect(stats.byLevel.get('error')).toBe(1);
    });
  });
});
