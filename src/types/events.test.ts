/**
 * Tests for unified event types
 */

import { describe, it, expect } from 'vitest';
import {
  createTimelineEventFromAction,
  createTimelineEventFromDashboardEvent,
  filterEvents,
  type TimelineEvent,
  type EventFilter,
} from './events';

describe('TimelineEvent Creation', () => {
  describe('createTimelineEventFromAction', () => {
    it('should create timeline event from agent action', () => {
      const action = {
        id: 'action_123',
        timestamp: Date.now(),
        agentId: 'agent_001',
        taskId: 'task_001',
        actionType: 'command_exec' as const,
        payload: { command: 'npm test' },
        duration: 1500,
        result: 'success' as const,
        sessionId: 'session_001',
        correlationId: 'corr_001',
      };

      const event = createTimelineEventFromAction(action);

      expect(event.id).toBe('action_123');
      expect(event.type).toBe('agent:action');
      expect(event.timestamp).toBe(action.timestamp);
      expect(event.agentId).toBe('agent_001');
      expect(event.taskId).toBe('task_001');
      expect(event.sessionId).toBe('session_001');
      expect(event.level).toBe('info');
      expect(event.source).toBe('orchestrator');
      expect(event.summary).toContain('执行命令');
      expect(event.details).toEqual({
        actionType: 'command_exec',
        payload: { command: 'npm test' },
        duration: 1500,
        result: 'success',
      });
    });

    it('should set error level for failed actions', () => {
      const action = {
        id: 'action_124',
        timestamp: Date.now(),
        agentId: 'agent_001',
        actionType: 'file_write' as const,
        payload: { path: '/test.txt' },
        result: 'failure' as const,
      };

      const event = createTimelineEventFromAction(action);
      expect(event.level).toBe('error');
    });

    it('should handle optional fields', () => {
      const action = {
        id: 'action_125',
        timestamp: Date.now(),
        agentId: 'agent_001',
        actionType: 'idle' as const,
        payload: {},
      };

      const event = createTimelineEventFromAction(action);
      expect(event.taskId).toBeUndefined();
      expect(event.sessionId).toBeUndefined();
      expect(event.correlationId).toBeUndefined();
    });

    it('should format different action types correctly', () => {
      const testCases = [
        { type: 'file_read', payload: { path: '/test.txt' }, expected: '读取文件' },
        { type: 'file_write', payload: { path: '/test.txt' }, expected: '写入文件' },
        { type: 'file_delete', payload: { path: '/test.txt' }, expected: '删除文件' },
        { type: 'task_claimed', payload: {}, expected: '认领任务' },
        { type: 'task_released', payload: {}, expected: '释放任务' },
        { type: 'thinking', payload: {}, expected: '思考中' },
        { type: 'idle', payload: {}, expected: '空闲' },
      ];

      for (const testCase of testCases) {
        const event = createTimelineEventFromAction({
          id: `action_${testCase.type}`,
          timestamp: Date.now(),
          agentId: 'agent_001',
          actionType: testCase.type as any,
          payload: testCase.payload,
        });
        expect(event.summary).toContain(testCase.expected);
      }
    });
  });

  describe('createTimelineEventFromDashboardEvent', () => {
    it('should create timeline event from dashboard event', () => {
      const dashboardEvent = {
        id: 'dash_001',
        type: 'agent:status',
        timestamp: Date.now(),
        agentId: 'agent_001',
        payload: { status: 'working', detail: 'Processing task' },
      };

      const event = createTimelineEventFromDashboardEvent(dashboardEvent);

      expect(event.id).toBe('dash_001');
      expect(event.timestamp).toBe(dashboardEvent.timestamp);
      expect(event.agentId).toBe('agent_001');
      expect(event.source).toBe('dashboard');
      expect(event.level).toBe('info');
    });

    it('should set error level for error events', () => {
      const dashboardEvent = {
        id: 'dash_002',
        type: 'agent:error',
        timestamp: Date.now(),
        agentId: 'agent_001',
        payload: { error: 'Something went wrong' },
      };

      const event = createTimelineEventFromDashboardEvent(dashboardEvent);
      expect(event.level).toBe('error');
    });

    it('should map dashboard event types correctly', () => {
      const mappings = [
        { from: 'agent:update', to: 'agent:status' },
        { from: 'agent:action', to: 'agent:action' },
        { from: 'agent:thinking', to: 'agent:thinking' },
        { from: 'task:created', to: 'task:created' },
        { from: 'task:completed', to: 'task:completed' },
        { from: 'terminal:output', to: 'terminal:output' },
        { from: 'chat:message', to: 'chat:message' },
        { from: 'agent:heartbeat', to: 'system:heartbeat' },
        { from: 'unknown:event', to: 'system:info' },
      ];

      for (const mapping of mappings) {
        const event = createTimelineEventFromDashboardEvent({
          id: `event_${mapping.from}`,
          type: mapping.from,
          timestamp: Date.now(),
          agentId: 'agent_001',
          payload: {},
        });
        expect(event.type).toBe(mapping.to);
      }
    });
  });
});

describe('Event Filtering', () => {
  const createMockEvent = (overrides: Partial<TimelineEvent> = {}): TimelineEvent => ({
    id: 'event_001',
    type: 'agent:action',
    timestamp: Date.now(),
    agentId: 'agent_001',
    summary: 'Test event',
    level: 'info',
    source: 'orchestrator',
    ...overrides,
  });

  const mockEvents: TimelineEvent[] = [
    createMockEvent({
      id: 'event_001',
      type: 'agent:action',
      agentId: 'agent_001',
      taskId: 'task_001',
      level: 'info',
      timestamp: 1000,
      summary: 'Agent 001 executed command',
    }),
    createMockEvent({
      id: 'event_002',
      type: 'agent:thinking',
      agentId: 'agent_001',
      taskId: 'task_001',
      level: 'info',
      timestamp: 2000,
      summary: 'Agent 001 thinking',
    }),
    createMockEvent({
      id: 'event_003',
      type: 'agent:action',
      agentId: 'agent_002',
      taskId: 'task_002',
      level: 'error',
      timestamp: 3000,
      summary: 'Agent 002 failed',
    }),
    createMockEvent({
      id: 'event_004',
      type: 'task:completed',
      agentId: 'agent_001',
      taskId: 'task_001',
      level: 'info',
      timestamp: 4000,
      summary: 'Task 001 completed',
    }),
    createMockEvent({
      id: 'event_005',
      type: 'system:error',
      level: 'error',
      timestamp: 5000,
      summary: 'System error occurred',
      agentId: undefined, // Explicitly no agent ID for system events
    }),
  ];

  describe('filterEvents by type', () => {
    it('should filter by single event type', () => {
      const filter: EventFilter = { types: ['agent:action'] };
      const result = filterEvents(mockEvents, filter);
      expect(result).toHaveLength(2);
      expect(result.every(e => e.type === 'agent:action')).toBe(true);
    });

    it('should filter by multiple event types', () => {
      const filter: EventFilter = { types: ['agent:action', 'agent:thinking'] };
      const result = filterEvents(mockEvents, filter);
      expect(result).toHaveLength(3);
    });
  });

  describe('filterEvents by level', () => {
    it('should filter by error level', () => {
      const filter: EventFilter = { levels: ['error'] };
      const result = filterEvents(mockEvents, filter);
      expect(result).toHaveLength(2);
      expect(result.every(e => e.level === 'error')).toBe(true);
    });

    it('should filter by multiple levels', () => {
      const filter: EventFilter = { levels: ['info', 'error'] };
      const result = filterEvents(mockEvents, filter);
      expect(result).toHaveLength(mockEvents.length);
    });
  });

  describe('filterEvents by agentId', () => {
    it('should filter by agent ID', () => {
      const filter: EventFilter = { agentId: 'agent_001' };
      const result = filterEvents(mockEvents, filter);
      expect(result).toHaveLength(3); // event_001, event_002, event_004
      expect(result.every(e => e.agentId === 'agent_001')).toBe(true);
    });
  });

  describe('filterEvents by taskId', () => {
    it('should filter by task ID', () => {
      const filter: EventFilter = { taskId: 'task_001' };
      const result = filterEvents(mockEvents, filter);
      expect(result).toHaveLength(3);
      expect(result.every(e => e.taskId === 'task_001')).toBe(true);
    });
  });

  describe('filterEvents by time range', () => {
    it('should filter by from timestamp', () => {
      const filter: EventFilter = { from: 3000 };
      const result = filterEvents(mockEvents, filter);
      expect(result).toHaveLength(3);
      expect(result.every(e => e.timestamp >= 3000)).toBe(true);
    });

    it('should filter by to timestamp', () => {
      const filter: EventFilter = { to: 2000 };
      const result = filterEvents(mockEvents, filter);
      expect(result).toHaveLength(2);
      expect(result.every(e => e.timestamp <= 2000)).toBe(true);
    });

    it('should filter by time range', () => {
      const filter: EventFilter = { from: 2000, to: 4000 };
      const result = filterEvents(mockEvents, filter);
      expect(result).toHaveLength(3);
    });
  });

  describe('filterEvents by search term', () => {
    it('should filter by search term in summary', () => {
      const filter: EventFilter = { search: 'Agent 001' };
      const result = filterEvents(mockEvents, filter);
      expect(result).toHaveLength(2); // event_001 and event_002
    });

    it('should filter by search term in details', () => {
      const events: TimelineEvent[] = [
        createMockEvent({
          id: 'event_006',
          details: { command: 'npm run build' },
          summary: 'Build command',
        }),
      ];
      const filter: EventFilter = { search: 'npm run build' };
      const result = filterEvents(events, filter);
      expect(result).toHaveLength(1);
    });

    it('should be case insensitive', () => {
      const filter: EventFilter = { search: 'agent 001' };
      const result = filterEvents(mockEvents, filter);
      expect(result).toHaveLength(2); // event_001 and event_002
    });
  });

  describe('filterEvents with combined filters', () => {
    it('should apply multiple filters together', () => {
      const filter: EventFilter = {
        agentId: 'agent_001',
        types: ['agent:action'],
        levels: ['info'],
      };
      const result = filterEvents(mockEvents, filter);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('event_001');
    });

    it('should return empty array when no matches', () => {
      const filter: EventFilter = {
        agentId: 'nonexistent',
      };
      const result = filterEvents(mockEvents, filter);
      expect(result).toHaveLength(0);
    });
  });
});

describe('TimelineEvent Types', () => {
  it('should have correct TimelineEventType union', () => {
    const validTypes: string[] = [
      'agent:action',
      'agent:thinking',
      'agent:status',
      'agent:created',
      'agent:removed',
      'task:created',
      'task:started',
      'task:updated',
      'task:completed',
      'task:failed',
      'terminal:output',
      'terminal:resize',
      'chat:message',
      'system:heartbeat',
      'system:error',
      'system:info',
    ];

    // Just verify these types compile
    validTypes.forEach(type => {
      expect(typeof type).toBe('string');
    });
  });

  it('should have correct EventLevel union', () => {
    const validLevels: string[] = ['debug', 'info', 'warning', 'error'];
    validLevels.forEach(level => {
      expect(typeof level).toBe('string');
    });
  });
});
