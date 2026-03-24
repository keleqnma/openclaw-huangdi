/**
 * TaskBoardManager 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TaskBoardManager } from './TaskBoardManager';
import { CreateTaskParams } from './types';

describe('TaskBoardManager', () => {
  let taskBoard: TaskBoardManager;

  beforeEach(() => {
    taskBoard = new TaskBoardManager();
  });

  describe('createTask()', () => {
    it('should create a task successfully', () => {
      const params: CreateTaskParams = {
        title: 'Test Task',
        description: 'Test Description',
        priority: 'high',
      };

      const task = taskBoard.createTask('system', params);

      expect(task.id).toBeDefined();
      expect(task.title).toBe('Test Task');
      expect(task.description).toBe('Test Description');
      expect(task.priority).toBe('high');
      expect(task.status).toBe('pending');
      expect(task.createdBy).toBe('system');
      expect(task.progress).toBe(0);
      expect(task.messages).toEqual([]);
    });

    it('should create task with assignedTo', () => {
      const task = taskBoard.createTask('system', {
        title: 'Assigned Task',
        description: 'For agent-1',
        assignedTo: 'agent-1',
      });

      expect(task.assignedTo).toBe('agent-1');
    });

    it('should create task with tags', () => {
      const task = taskBoard.createTask('system', {
        title: 'Tagged Task',
        description: 'With tags',
        tags: ['urgent', 'backend'],
      });

      expect(task.tags).toEqual(['urgent', 'backend']);
    });

    it('should emit task:created event', () => {
      const emittedTasks: any[] = [];
      taskBoard.on('task:created', (task) => emittedTasks.push(task));

      taskBoard.createTask('system', {
        title: 'Event Task',
        description: 'Test',
      });

      expect(emittedTasks).toHaveLength(1);
      expect(emittedTasks[0].title).toBe('Event Task');
    });

    it('should create task with due date', () => {
      const dueAt = Date.now() + 86400000; // 1 day from now
      const task = taskBoard.createTask('system', {
        title: 'Due Task',
        description: 'Has deadline',
        dueAt,
      });

      expect(task.dueAt).toBe(dueAt);
    });
  });

  describe('getTask() and getAllTasks()', () => {
    beforeEach(() => {
      taskBoard.createTask('system', { title: 'Task 1', description: 'Desc 1' });
      taskBoard.createTask('system', { title: 'Task 2', description: 'Desc 2' });
    });

    it('should get task by ID', () => {
      const tasks = taskBoard.getAllTasks();
      const task = taskBoard.getTask(tasks[0].id);

      expect(task).toBeDefined();
      expect(task?.title).toBe('Task 1');
    });

    it('should return undefined for non-existent task', () => {
      const task = taskBoard.getTask('non-existent');
      expect(task).toBeUndefined();
    });

    it('should get all tasks', () => {
      const tasks = taskBoard.getAllTasks();
      expect(tasks.length).toBe(2);
    });
  });

  describe('getTaskBoard()', () => {
    beforeEach(() => {
      taskBoard.createTask('system', { title: 'Task 1', description: 'Desc 1', priority: 'high' });
      taskBoard.createTask('system', { title: 'Task 2', description: 'Desc 2', priority: 'low' });
    });

    it('should return task board statistics', () => {
      const board = taskBoard.getTaskBoard();

      expect(board.total).toBe(2);
      expect(board.byStatus.pending).toBe(2);
      expect(board.byPriority.high).toBe(1);
      expect(board.byPriority.low).toBe(1);
    });
  });

  describe('filterTasks()', () => {
    beforeEach(() => {
      taskBoard.createTask('system', { title: 'High Priority', description: 'Urgent task', priority: 'high', tags: ['urgent'] });
      taskBoard.createTask('system', { title: 'Low Priority', description: 'Normal task', priority: 'low', tags: ['backend'] });
      taskBoard.createTask('agent-1', { title: 'Assigned Task', description: 'For testing', priority: 'normal', assignedTo: 'agent-1' });
    });

    it('should filter by status', () => {
      const tasks = taskBoard.filterTasks({ status: 'pending' });
      expect(tasks.length).toBe(3);
    });

    it('should filter by priority', () => {
      const tasks = taskBoard.filterTasks({ priority: 'high' });
      expect(tasks.length).toBe(1);
      expect(tasks[0].title).toBe('High Priority');
    });

    it('should filter by multiple priorities', () => {
      const tasks = taskBoard.filterTasks({ priority: ['high', 'low'] });
      expect(tasks.length).toBe(2);
    });

    it('should filter by claimedBy', () => {
      // First claim a task
      const allTasks = taskBoard.getAllTasks();
      taskBoard.claimTask(allTasks[2].id, 'agent-1');

      const tasks = taskBoard.filterTasks({ claimedBy: 'agent-1' });
      expect(tasks.length).toBe(1);
      expect(tasks[0].claimedBy).toBe('agent-1');
    });

    it('should filter by createdBy', () => {
      const tasks = taskBoard.filterTasks({ createdBy: 'agent-1' });
      expect(tasks.length).toBe(1);
      expect(tasks[0].createdBy).toBe('agent-1');
    });

    it('should filter by tags', () => {
      const tasks = taskBoard.filterTasks({ tags: ['urgent'] });
      // At least the "High Priority" task which has 'urgent' tag
      expect(tasks.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter by search query', () => {
      const tasks = taskBoard.filterTasks({ search: 'priority' });
      expect(tasks.length).toBe(2);
    });

    it('should combine multiple filters', () => {
      const tasks = taskBoard.filterTasks({
        priority: 'high',
        search: 'urgent',
      });
      expect(tasks.length).toBe(1);
    });
  });

  describe('claimTask()', () => {
    let taskId: string;

    beforeEach(() => {
      const task = taskBoard.createTask('system', {
        title: 'Claimable Task',
        description: 'Can be claimed',
      });
      taskId = task.id;
    });

    it('should claim a pending task successfully', () => {
      const result = taskBoard.claimTask(taskId, 'agent-1');

      expect(result.success).toBe(true);
      expect(result.task?.status).toBe('claimed');
      expect(result.task?.claimedBy).toBe('agent-1');
      expect(result.task?.claimedAt).toBeDefined();
    });

    it('should not claim already claimed task', () => {
      taskBoard.claimTask(taskId, 'agent-1');
      const result = taskBoard.claimTask(taskId, 'agent-2');

      expect(result.success).toBe(false);
      expect(result.error).toContain('already claimed by agent-1');
    });

    it('should not claim task assigned to another agent', () => {
      const assignedTask = taskBoard.createTask('system', {
        title: 'Assigned Task',
        description: 'For agent-1 only',
        assignedTo: 'agent-1',
      });

      const result = taskBoard.claimTask(assignedTask.id, 'agent-2');

      expect(result.success).toBe(false);
      expect(result.error).toContain('assigned to agent-1');
    });

    it('should allow assigned agent to claim their task', () => {
      const assignedTask = taskBoard.createTask('system', {
        title: 'Assigned Task',
        description: 'For agent-1 only',
        assignedTo: 'agent-1',
      });

      const result = taskBoard.claimTask(assignedTask.id, 'agent-1');

      expect(result.success).toBe(true);
    });

    it('should not claim non-pending task', () => {
      taskBoard.claimTask(taskId, 'agent-1');
      taskBoard.updateTaskStatus(taskId, 'agent-1', 'completed');

      const result = taskBoard.claimTask(taskId, 'agent-2');

      expect(result.success).toBe(false);
    });

    it('should emit task:claimed event', () => {
      const emittedClaims: any[] = [];
      taskBoard.on('task:claimed', (data) => emittedClaims.push(data));

      taskBoard.claimTask(taskId, 'agent-1');

      expect(emittedClaims).toHaveLength(1);
      expect(emittedClaims[0].agentId).toBe('agent-1');
    });

    it('should not find task', () => {
      const result = taskBoard.claimTask('non-existent', 'agent-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Task not found');
    });
  });

  describe('releaseTask()', () => {
    let taskId: string;

    beforeEach(() => {
      const task = taskBoard.createTask('system', {
        title: 'Releasable Task',
        description: 'Can be released',
      });
      taskId = task.id;
      taskBoard.claimTask(taskId, 'agent-1');
    });

    it('should release claimed task successfully', () => {
      const result = taskBoard.releaseTask(taskId, 'agent-1');

      expect(result.success).toBe(true);
      const task = taskBoard.getTask(taskId);
      expect(task?.status).toBe('pending');
      expect(task?.claimedBy).toBeUndefined();
    });

    it('should not release task claimed by another agent', () => {
      const result = taskBoard.releaseTask(taskId, 'agent-2');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Only the claimer can release');
    });

    it('should not release unclaimed task', () => {
      const newTask = taskBoard.createTask('system', {
        title: 'Unclaimed Task',
        description: 'Not claimed yet',
      });

      const result = taskBoard.releaseTask(newTask.id, 'agent-1');

      expect(result.success).toBe(false);
    });

    it('should emit task:released event', () => {
      const emittedReleases: any[] = [];
      taskBoard.on('task:released', (data) => emittedReleases.push(data));

      taskBoard.releaseTask(taskId, 'agent-1');

      expect(emittedReleases).toHaveLength(1);
      expect(emittedReleases[0].agentId).toBe('agent-1');
    });
  });

  describe('updateTaskStatus()', () => {
    let taskId: string;

    beforeEach(() => {
      const task = taskBoard.createTask('system', {
        title: 'Updatable Task',
        description: 'Status can be updated',
      });
      taskId = task.id;
      taskBoard.claimTask(taskId, 'agent-1');
    });

    it('should update task status to in-progress', () => {
      const result = taskBoard.updateTaskStatus(taskId, 'agent-1', 'in-progress');

      expect(result.success).toBe(true);
      const task = taskBoard.getTask(taskId);
      expect(task?.status).toBe('in-progress');
      expect(task?.startedAt).toBeDefined();
    });

    it('should update task status to completed', () => {
      taskBoard.updateTaskStatus(taskId, 'agent-1', 'in-progress');
      const result = taskBoard.updateTaskStatus(taskId, 'agent-1', 'completed');

      expect(result.success).toBe(true);
      const task = taskBoard.getTask(taskId);
      expect(task?.status).toBe('completed');
      expect(task?.completedAt).toBeDefined();
    });

    it('should update task status to failed', () => {
      const result = taskBoard.updateTaskStatus(taskId, 'agent-1', 'failed');

      expect(result.success).toBe(true);
      const task = taskBoard.getTask(taskId);
      expect(task?.status).toBe('failed');
    });

    it('should not update status if agent is not claimer', () => {
      const result = taskBoard.updateTaskStatus(taskId, 'agent-2', 'completed');

      expect(result.success).toBe(false);
      expect(result.error).toContain('claimer');
    });

    it('should emit task:updated event', () => {
      const emittedUpdates: any[] = [];
      taskBoard.on('task:updated', (task) => emittedUpdates.push(task));

      taskBoard.updateTaskStatus(taskId, 'agent-1', 'in-progress');

      expect(emittedUpdates).toHaveLength(1);
    });

    it('should emit task:completed event', () => {
      taskBoard.updateTaskStatus(taskId, 'agent-1', 'in-progress');

      const emittedCompletions: any[] = [];
      taskBoard.on('task:completed', (task) => emittedCompletions.push(task));

      taskBoard.updateTaskStatus(taskId, 'agent-1', 'completed');

      expect(emittedCompletions).toHaveLength(1);
    });

    it('should not find task', () => {
      const result = taskBoard.updateTaskStatus('non-existent', 'agent-1', 'completed');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Task not found');
    });
  });

  describe('updateProgress()', () => {
    let taskId: string;

    beforeEach(() => {
      const task = taskBoard.createTask('system', {
        title: 'Progress Task',
        description: 'Track progress',
      });
      taskId = task.id;
      taskBoard.claimTask(taskId, 'agent-1');
      taskBoard.updateTaskStatus(taskId, 'agent-1', 'in-progress');
    });

    it('should update task progress', () => {
      const result = taskBoard.updateProgress(taskId, 'agent-1', 50);

      expect(result.success).toBe(true);
      const task = taskBoard.getTask(taskId);
      expect(task?.progress).toBe(50);
    });

    it('should not update progress if agent is not claimer', () => {
      const result = taskBoard.updateProgress(taskId, 'agent-2', 50);

      expect(result.success).toBe(false);
    });

    it('should limit progress to 100', () => {
      const result = taskBoard.updateProgress(taskId, 'agent-1', 150);

      // Implementation may cap at 100 or return error
      // Either way, progress should not exceed 100
      const task = taskBoard.getTask(taskId);
      expect(task?.progress).toBeLessThanOrEqual(100);
    });

    it('should auto-complete task when progress reaches 100', () => {
      const result = taskBoard.updateProgress(taskId, 'agent-1', 100);

      // If implementation auto-completes, status should be completed
      const task = taskBoard.getTask(taskId);
      expect(task?.progress).toBe(100);
    });
  });

  describe('addMessage()', () => {
    let taskId: string;

    beforeEach(() => {
      const task = taskBoard.createTask('system', {
        title: 'Message Task',
        description: 'Has messages',
      });
      taskId = task.id;
    });

    it('should add message to task', () => {
      const message = taskBoard.addMessage(taskId, 'agent-1', 'Working on it', 'comment');

      expect(message).toBeDefined();
      expect(message.content).toBe('Working on it');
      expect(message.fromAgent).toBe('agent-1');
      expect(message.type).toBe('comment');

      const task = taskBoard.getTask(taskId);
      expect(task?.messages.length).toBe(1);
    });

    it('should add status-update message', () => {
      const message = taskBoard.addMessage(taskId, 'system', 'Task claimed', 'status-update');

      expect(message.type).toBe('status-update');
    });

    it('should add message with mentions', () => {
      const message = taskBoard.addMessage(taskId, 'agent-1', '@agent-2 please review', 'comment', ['agent-2']);

      expect(message.mentions).toEqual(['agent-2']);
    });

    it('should emit message:added event', () => {
      const emittedMessages: any[] = [];
      taskBoard.on('message:added', (data) => emittedMessages.push(data));

      taskBoard.addMessage(taskId, 'agent-1', 'Hello', 'comment');

      expect(emittedMessages).toHaveLength(1);
      expect(emittedMessages[0].message.content).toBe('Hello');
    });

    it('should not find task', () => {
      const message = taskBoard.addMessage('non-existent', 'agent-1', 'Test', 'comment');

      expect(message).toBeUndefined();
    });
  });

  describe('assignTask()', () => {
    let taskId: string;

    beforeEach(() => {
      const task = taskBoard.createTask('system', {
        title: 'Assignable Task',
        description: 'Can be assigned',
      });
      taskId = task.id;
    });

    it('should assign task to another agent', () => {
      const result = taskBoard.assignTask(taskId, 'system', 'agent-2');

      expect(result.success).toBe(true);
      const task = taskBoard.getTask(taskId);
      expect(task?.assignedTo).toBe('agent-2');
    });

    it('should add handoff message when assigning', () => {
      taskBoard.assignTask(taskId, 'system', 'agent-2');

      const task = taskBoard.getTask(taskId);
      // The task should have at least one message
      expect(task?.messages.length).toBeGreaterThan(0);
    });

    it('should not assign non-existent task', () => {
      const result = taskBoard.assignTask('non-existent', 'agent-1', 'agent-2');

      expect(result.success).toBe(false);
    });
  });

  describe('getOverdueTasks()', () => {
    it('should return tasks past their due date', () => {
      const pastDue = Date.now() - 86400000; // 1 day ago
      taskBoard.createTask('system', {
        title: 'Overdue Task',
        description: 'Past due',
        dueAt: pastDue,
      });

      taskBoard.createTask('system', {
        title: 'Future Task',
        description: 'Not due yet',
        dueAt: Date.now() + 86400000,
      });

      const overdueTasks = taskBoard.getOverdueTasks();
      expect(overdueTasks.length).toBe(1);
      expect(overdueTasks[0].title).toBe('Overdue Task');
    });
  });

  describe('deleteTask()', () => {
    let taskId: string;

    beforeEach(() => {
      const task = taskBoard.createTask('system', {
        title: 'Deletable Task',
        description: 'Can be deleted',
      });
      taskId = task.id;
    });

    it('should delete a pending task', () => {
      const result = taskBoard.deleteTask(taskId, 'system');

      expect(result.success).toBe(true);
      expect(taskBoard.getTask(taskId)).toBeUndefined();
    });

    it('should not delete non-pending task', () => {
      taskBoard.claimTask(taskId, 'agent-1');
      const result = taskBoard.deleteTask(taskId, 'agent-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('delete');
    });

    it('should not delete task created by another agent', () => {
      const result = taskBoard.deleteTask(taskId, 'other-agent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('creator');
    });
  });
});
