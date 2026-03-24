/**
 * EventStore 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventStore } from './EventStore';
import type { DashboardEvent } from './types';

describe('EventStore', () => {
  let eventStore: EventStore;

  beforeEach(() => {
    eventStore = new EventStore(100);
  });

  describe('add()', () => {
    it('should add an event successfully', () => {
      const event: DashboardEvent = {
        id: 'evt_1',
        type: 'agent_spawning',
        timestamp: Date.now(),
        agentId: 'agent-1',
        payload: { spawningStatus: 'spawning' },
      };

      eventStore.add(event);

      const events = eventStore.getAllEvents();
      expect(events.length).toBe(1);
      expect(events[0].id).toBe('evt_1');
    });

    it('should trim old events when exceeding max', () => {
      // Create store with small max for testing
      const smallStore = new EventStore(5);

      // Add 10 events
      for (let i = 0; i < 10; i++) {
        smallStore.add({
          id: `evt_${i}`,
          type: 'agent_spawning',
          timestamp: Date.now() + i,
          agentId: 'agent-1',
          payload: {},
        });
      }

      const events = smallStore.getAllEvents();
      expect(events.length).toBe(5);
      expect(events[0].id).toBe('evt_5'); // Should keep latest 5
    });
  });

  describe('getEventsSince()', () => {
    beforeEach(() => {
      const now = Date.now();
      eventStore.add({
        id: 'evt_1',
        type: 'agent_spawning',
        timestamp: now - 2000,
        agentId: 'agent-1',
        payload: {},
      });
      eventStore.add({
        id: 'evt_2',
        type: 'agent_spawned',
        timestamp: now - 1000,
        agentId: 'agent-2',
        payload: {},
      });
      eventStore.add({
        id: 'evt_3',
        type: 'agent_ended',
        timestamp: now,
        agentId: 'agent-1',
        payload: {},
      });
    });

    it('should get events since timestamp', () => {
      const since = Date.now() - 1500;
      const events = eventStore.getEventsSince(since);

      expect(events.length).toBe(2);
      expect(events.map(e => e.id)).toContain('evt_2');
      expect(events.map(e => e.id)).toContain('evt_3');
    });

    it('should filter by agentId', () => {
      const since = Date.now() - 3000;
      const events = eventStore.getEventsSince(since, 'agent-1');

      expect(events.length).toBe(2);
      expect(events.every(e => e.agentId === 'agent-1')).toBe(true);
    });

    it('should combine time and agent filters', () => {
      const since = Date.now() - 1500;
      const events = eventStore.getEventsSince(since, 'agent-1');

      expect(events.length).toBe(1);
      expect(events[0].id).toBe('evt_3');
    });

    it('should return empty array for future timestamp', () => {
      const events = eventStore.getEventsSince(Date.now() + 10000);
      expect(events.length).toBe(0);
    });
  });

  describe('getEventsInRange()', () => {
    beforeEach(() => {
      const now = Date.now();
      eventStore.add({
        id: 'evt_1',
        type: 'agent_spawning',
        timestamp: now - 3000,
        agentId: 'agent-1',
        payload: {},
      });
      eventStore.add({
        id: 'evt_2',
        type: 'agent_spawned',
        timestamp: now - 2000,
        agentId: 'agent-1',
        payload: {},
      });
      eventStore.add({
        id: 'evt_3',
        type: 'agent_status_change',
        timestamp: now - 1000,
        agentId: 'agent-1',
        payload: {},
      });
      eventStore.add({
        id: 'evt_4',
        type: 'agent_ended',
        timestamp: now,
        agentId: 'agent-1',
        payload: {},
      });
    });

    it('should get events within time range', () => {
      const now = Date.now();
      const events = eventStore.getEventsInRange(now - 2500, now - 500);

      expect(events.length).toBe(2);
      expect(events.map(e => e.id)).toEqual(['evt_2', 'evt_3']);
    });

    it('should handle exact boundary timestamps', () => {
      const now = Date.now();
      const events = eventStore.getEventsInRange(now - 2000, now - 1000);

      expect(events.length).toBe(2);
      expect(events.map(e => e.id)).toEqual(['evt_2', 'evt_3']);
    });

    it('should return empty array for invalid range', () => {
      const now = Date.now();
      const events = eventStore.getEventsInRange(now + 1000, now + 2000);
      expect(events.length).toBe(0);
    });
  });

  describe('ReplayState management', () => {
    it('should have default replay state', () => {
      const state = eventStore.getReplayState();

      expect(state.isPlaying).toBe(false);
      expect(state.speed).toBe(1);
      expect(state.currentPosition).toBeDefined();
    });

    it('should update replay state', () => {
      eventStore.updateReplayState({
        isPlaying: true,
        speed: 2,
        currentPosition: 1234567890,
      });

      const state = eventStore.getReplayState();
      expect(state.isPlaying).toBe(true);
      expect(state.speed).toBe(2);
      expect(state.currentPosition).toBe(1234567890);
    });

    it('should partially update replay state', () => {
      eventStore.updateReplayState({ isPlaying: true });
      eventStore.updateReplayState({ speed: 4 });

      const state = eventStore.getReplayState();
      expect(state.isPlaying).toBe(true);
      expect(state.speed).toBe(4);
    });
  });

  describe('getNextReplayEvent()', () => {
    beforeEach(() => {
      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        eventStore.add({
          id: `evt_${i}`,
          type: 'agent_spawning',
          timestamp: now + i * 1000,
          agentId: 'agent-1',
          payload: {},
        });
      }
    });

    it('should return undefined when not playing', () => {
      eventStore.updateReplayState({
        isPlaying: false,
        currentPosition: Date.now(),
        from: Date.now(),
        to: Date.now() + 5000,
      });

      const event = eventStore.getNextReplayEvent();
      expect(event).toBeUndefined();
    });

    it('should return undefined if from/to not set', () => {
      eventStore.updateReplayState({
        isPlaying: true,
        currentPosition: Date.now(),
      });

      const event = eventStore.getNextReplayEvent();
      expect(event).toBeUndefined();
    });

    it('should return next event after current position', () => {
      const now = Date.now();
      eventStore.updateReplayState({
        isPlaying: true,
        currentPosition: now + 1500,
        from: now,
        to: now + 5000,
      });

      const event = eventStore.getNextReplayEvent();
      expect(event).toBeDefined();
      expect(event?.id).toBe('evt_2'); // First event after 1500ms
    });

    it('should return undefined when at end of range', () => {
      const now = Date.now();
      eventStore.updateReplayState({
        isPlaying: true,
        currentPosition: now + 10000,
        from: now,
        to: now + 5000,
      });

      const event = eventStore.getNextReplayEvent();
      expect(event).toBeUndefined();
    });
  });

  describe('getReplayTickInterval()', () => {
    it('should return base interval at speed 1', () => {
      eventStore.updateReplayState({ speed: 1 });
      expect(eventStore.getReplayTickInterval()).toBe(1000);
    });

    it('should return faster interval at speed 2', () => {
      eventStore.updateReplayState({ speed: 2 });
      expect(eventStore.getReplayTickInterval()).toBe(500);
    });

    it('should return slower interval at speed 0.5', () => {
      eventStore.updateReplayState({ speed: 0.5 });
      expect(eventStore.getReplayTickInterval()).toBe(2000);
    });

    it('should return very fast interval at speed 4', () => {
      eventStore.updateReplayState({ speed: 4 });
      expect(eventStore.getReplayTickInterval()).toBe(250);
    });
  });

  describe('clear()', () => {
    beforeEach(() => {
      for (let i = 0; i < 5; i++) {
        eventStore.add({
          id: `evt_${i}`,
          type: 'agent_spawning',
          timestamp: Date.now() + i,
          agentId: 'agent-1',
          payload: {},
        });
      }
      eventStore.updateReplayState({
        isPlaying: true,
        speed: 2,
        currentPosition: Date.now(),
        from: Date.now(),
        to: Date.now() + 1000,
      });
    });

    it('should clear all events', () => {
      eventStore.clear();

      const events = eventStore.getAllEvents();
      expect(events.length).toBe(0);
    });

    it('should reset replay state', () => {
      eventStore.clear();

      const state = eventStore.getReplayState();
      expect(state.isPlaying).toBe(false);
      expect(state.speed).toBe(1);
    });
  });
});
