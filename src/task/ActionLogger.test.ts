/**
 * ActionLogger 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ActionLogger } from './ActionLogger';

describe('ActionLogger', () => {
  let logger: ActionLogger;

  beforeEach(() => {
    logger = new ActionLogger();
  });

  describe('log()', () => {
    it('should log an action successfully', () => {
      const action = logger.log({
        agentId: 'agent-1',
        actionType: 'command_exec',
        payload: { command: 'ls -la' },
        result: 'success',
      });

      expect(action.id).toBeDefined();
      expect(action.timestamp).toBeDefined();
      expect(action.agentId).toBe('agent-1');
      expect(action.actionType).toBe('command_exec');
      expect(action.payload).toEqual({ command: 'ls -la' });
      expect(action.result).toBe('success');
    });

    it('should emit action event', () => {
      const emittedActions: any[] = [];
      logger.on('action', (action) => emittedActions.push(action));

      logger.log({
        agentId: 'agent-1',
        actionType: 'thinking',
        payload: { thought: 'Hmm...' },
        result: 'success',
      });

      expect(emittedActions).toHaveLength(1);
      expect(emittedActions[0].agentId).toBe('agent-1');
    });

    it('should include taskId when provided', () => {
      const action = logger.log({
        agentId: 'agent-1',
        taskId: 'task-123',
        actionType: 'task_claimed',
        payload: {},
        result: 'success',
      });

      expect(action.taskId).toBe('task-123');
    });
  });

  describe('start() and end()', () => {
    it('should start an action and create pending entry', () => {
      const correlationId = logger.start('agent-1', 'command_exec', { command: 'npm test' });

      expect(correlationId).toBeDefined();

      // Verify the action was logged
      const actions = logger.getActions({ agentId: 'agent-1' });
      const pendingAction = actions.find(a => a.correlationId === correlationId);

      expect(pendingAction).toBeDefined();
      expect(pendingAction?.result).toBe('pending');
    });

    it('should update action on end', () => {
      const correlationId = logger.start('agent-1', 'command_exec', { command: 'npm test' });

      // End the action
      logger.end(correlationId, 'success', { output: 'All tests passed' }, 1500);

      // Find the action and verify it was updated
      const actions = logger.getActions({ agentId: 'agent-1' });
      const completedAction = actions.find(a => a.correlationId === correlationId);

      expect(completedAction?.result).toBe('success');
      expect(completedAction?.payload.output).toBe('All tests passed');
    });

    it('should handle failure result', () => {
      const correlationId = logger.start('agent-1', 'command_exec', { command: 'invalid-command' });
      logger.end(correlationId, 'failure', { error: 'Command not found' }, 500);

      const actions = logger.getActions({ agentId: 'agent-1' });
      const failedAction = actions.find(a => a.correlationId === correlationId);

      expect(failedAction?.result).toBe('failure');
      expect(failedAction?.payload.error).toBe('Command not found');
    });
  });

  describe('getActions()', () => {
    beforeEach(() => {
      // Add some test actions
      logger.log({ agentId: 'agent-1', actionType: 'command_exec', payload: {}, result: 'success' });
      logger.log({ agentId: 'agent-1', actionType: 'file_read', payload: { filePath: 'test.txt' }, result: 'success' });
      logger.log({ agentId: 'agent-2', actionType: 'command_exec', payload: {}, result: 'success' });
      logger.log({ agentId: 'agent-1', actionType: 'thinking', payload: {}, result: 'success', taskId: 'task-1' });
    });

    it('should get all actions when no filter', () => {
      const actions = logger.getActions();
      expect(actions.length).toBe(4);
    });

    it('should filter by agentId', () => {
      const actions = logger.getActions({ agentId: 'agent-1' });
      expect(actions.length).toBe(3);
    });

    it('should filter by taskId', () => {
      const actions = logger.getActions({ taskId: 'task-1' });
      expect(actions.length).toBe(1);
      expect(actions[0].agentId).toBe('agent-1');
    });

    it('should filter by actionType', () => {
      const actions = logger.getActions({ actionType: 'command_exec' });
      expect(actions.length).toBe(2);
    });

    it('should filter by multiple actionTypes', () => {
      const actions = logger.getActions({ actionType: ['command_exec', 'file_read'] });
      expect(actions.length).toBe(3);
    });

    it('should filter by since timestamp', () => {
      const now = Date.now();
      const actions = logger.getActions({ since: now - 1000 });
      expect(actions.length).toBe(4);

      const oldActions = logger.getActions({ since: now + 10000 });
      expect(oldActions.length).toBe(0);
    });

    it('should limit results', () => {
      const actions = logger.getActions({ limit: 2 });
      expect(actions.length).toBe(2);
    });

    it('should return actions sorted by timestamp (newest first)', () => {
      const actions = logger.getActions({ agentId: 'agent-1' });
      expect(actions[0].timestamp).toBeGreaterThanOrEqual(actions[1].timestamp);
    });
  });

  describe('getAgentStatus()', () => {
    it('should return unknown status for non-existent agent', () => {
      const status = logger.getAgentStatus('non-existent');
      expect(status.status).toBe('unknown');
    });

    it('should return thinking status when last action is thinking', () => {
      logger.log({ agentId: 'agent-1', actionType: 'thinking', payload: {}, result: 'success' });

      const status = logger.getAgentStatus('agent-1');
      expect(status.status).toBe('thinking');
    });

    it('should return executing status when command is pending', () => {
      logger.start('agent-1', 'command_exec', { command: 'running...' });

      const status = logger.getAgentStatus('agent-1');
      expect(status.status).toBe('executing');
    });

    it('should return idle status for other actions', () => {
      logger.log({ agentId: 'agent-1', actionType: 'file_read', payload: {}, result: 'success' });

      const status = logger.getAgentStatus('agent-1');
      expect(status.status).toBe('idle');
    });
  });

  describe('cleanup()', () => {
    it('should not cleanup when under maxHistory', () => {
      for (let i = 0; i < 100; i++) {
        logger.log({ agentId: 'agent-1', actionType: 'idle', payload: {}, result: 'success' });
      }

      logger.cleanup();
      const actions = logger.getActions();
      expect(actions.length).toBe(100);
    });

    it('should cleanup when over maxHistory', () => {
      // Set maxHistory to small number for testing
      (logger as any).maxHistory = 10;

      for (let i = 0; i < 20; i++) {
        logger.log({ agentId: 'agent-1', actionType: 'idle', payload: {}, result: 'success' });
      }

      logger.cleanup();
      const actions = logger.getActions();
      expect(actions.length).toBe(10);
    });
  });

  describe('clear()', () => {
    beforeEach(() => {
      logger.log({ agentId: 'agent-1', actionType: 'idle', payload: {}, result: 'success' });
      logger.log({ agentId: 'agent-2', actionType: 'idle', payload: {}, result: 'success' });
    });

    it('should clear all actions when no agentId', () => {
      logger.clear();
      const actions = logger.getActions();
      expect(actions.length).toBe(0);
    });

    it('should clear only specified agent actions', () => {
      logger.clear('agent-1');
      const allActions = logger.getActions();
      expect(allActions.length).toBe(1);
      expect(allActions[0].agentId).toBe('agent-2');
    });
  });

  describe('getStats()', () => {
    beforeEach(() => {
      logger.log({ agentId: 'agent-1', actionType: 'command_exec', payload: {}, result: 'success' });
      logger.log({ agentId: 'agent-1', actionType: 'file_read', payload: {}, result: 'success' });
      logger.log({ agentId: 'agent-2', actionType: 'command_exec', payload: {}, result: 'failure' });
    });

    it('should return correct statistics', () => {
      const stats = logger.getStats();

      expect(stats.totalActions).toBe(3);
      expect(stats.byAgent.get('agent-1')).toBe(2);
      expect(stats.byAgent.get('agent-2')).toBe(1);
      expect(stats.byType.get('command_exec')).toBe(2);
      expect(stats.byType.get('file_read')).toBe(1);
      expect(stats.byResult.get('success')).toBe(2);
      expect(stats.byResult.get('failure')).toBe(1);
    });
  });

  describe('helper methods', () => {
    describe('logThinking()', () => {
      it('should log thinking action', () => {
        logger.logThinking('agent-1', 'Considering options...');

        const actions = logger.getActions({ agentId: 'agent-1', actionType: 'thinking' });
        expect(actions.length).toBe(1);
        expect(actions[0].payload.thought).toBe('Considering options...');
      });
    });

    describe('logFileOp()', () => {
      it('should log file read operation', () => {
        logger.logFileOp('agent-1', 'read', 'config.json');

        const actions = logger.getActions({ actionType: 'file_read' });
        expect(actions.length).toBe(1);
        expect(actions[0].payload.filePath).toBe('config.json');
      });

      it('should log file write operation', () => {
        logger.logFileOp('agent-1', 'write', 'output.txt', undefined, { bytes: 1024 });

        const actions = logger.getActions({ actionType: 'file_write' });
        expect(actions.length).toBe(1);
        expect(actions[0].payload.filePath).toBe('output.txt');
      });

      it('should log file delete operation', () => {
        logger.logFileOp('agent-1', 'delete', 'temp.txt');

        const actions = logger.getActions({ actionType: 'file_delete' });
        expect(actions.length).toBe(1);
      });
    });

    describe('logTaskAction()', () => {
      it('should log task claimed action', () => {
        logger.logTaskAction('agent-1', 'claimed', 'task-123');

        const actions = logger.getActions({ actionType: 'task_claimed' });
        expect(actions.length).toBe(1);
        expect(actions[0].taskId).toBe('task-123');
      });

      it('should log task released action', () => {
        logger.logTaskAction('agent-1', 'released', 'task-123');

        const actions = logger.getActions({ actionType: 'task_released' });
        expect(actions.length).toBe(1);
      });

      it('should log task assigned action', () => {
        logger.logTaskAction('agent-1', 'assigned', 'task-123', { toAgent: 'agent-2' });

        const actions = logger.getActions({ actionType: 'task_assigned' });
        expect(actions.length).toBe(1);
        expect(actions[0].payload.toAgent).toBe('agent-2');
      });
    });

    describe('logMessageSent()', () => {
      it('should log message sent action', () => {
        logger.logMessageSent('agent-1', 'Hello world');

        const actions = logger.getActions({ actionType: 'message_sent' });
        expect(actions.length).toBe(1);
        expect(actions[0].payload.content).toBe('Hello world');
      });

      it('should include recipient for private messages', () => {
        logger.logMessageSent('agent-1', 'Hi there', 'agent-2');

        const actions = logger.getActions({ actionType: 'message_sent' });
        expect(actions[0].payload.to).toBe('agent-2');
      });
    });

    describe('logStatusChange()', () => {
      it('should log status change', () => {
        logger.logStatusChange('agent-1', 'idle', 'busy', 'Starting task');

        const actions = logger.getActions({ actionType: 'status_change' });
        expect(actions.length).toBe(1);
        expect(actions[0].payload.fromStatus).toBe('idle');
        expect(actions[0].payload.toStatus).toBe('busy');
      });
    });

    describe('logIdle()', () => {
      it('should log idle state', () => {
        logger.logIdle('agent-1');

        const actions = logger.getActions({ actionType: 'idle' });
        expect(actions.length).toBe(1);
      });
    });
  });
});
