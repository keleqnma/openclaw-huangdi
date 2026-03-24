/**
 * TaskBoardManager - 任务看板管理器
 *
 * 管理任务的创建、认领、释放、进度追踪
 * 实现任务回避机制（防重复抢单）
 */

import { EventEmitter } from 'events';
import {
  Task,
  TaskStatus,
  TaskPriority,
  TaskMessage,
  TaskMessageType,
  TaskBoard,
  TaskFilter,
  CreateTaskParams,
} from './types';
import { ActionLogger } from './ActionLogger';

interface TaskBoardEvents {
  'task:created': Task;
  'task:claimed': { task: Task; agentId: string };
  'task:released': { task: Task; agentId: string };
  'task:updated': Task;
  'task:completed': Task;
  'task:failed': Task;
  'message:added': { task: Task; message: TaskMessage };
}

export class TaskBoardManager extends EventEmitter {
  private tasks: Map<string, Task> = new Map();
  private claimMap: Map<string, string> = new Map(); // taskId -> agentId
  private readonly historyLimit: number = 1000;
  public actionLogger?: ActionLogger;

  /**
   * 生成任务 ID
   */
  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * 创建任务
   */
  createTask(createdBy: string, params: CreateTaskParams): Task {
    const task: Task = {
      id: this.generateTaskId(),
      title: params.title,
      description: params.description,
      createdBy,
      assignedTo: params.assignedTo,
      status: 'pending',
      priority: params.priority || 'normal',
      createdAt: Date.now(),
      dueAt: params.dueAt,
      progress: 0,
      messages: [],
      tags: params.tags,
      dependencies: params.dependencies,
    };

    this.tasks.set(task.id, task);
    this.emit('task:created', task);

    // 记录 task_created 动作（如果是 Agent 创建的）
    if (this.actionLogger && createdBy.startsWith('agent_')) {
      this.actionLogger.log({
        agentId: createdBy,
        taskId: task.id,
        actionType: 'task_assigned',
        payload: { event: 'task_created', assignedTo: params.assignedTo },
        result: 'success',
      });
    }

    return task;
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 获取任务看板
   */
  getTaskBoard(): TaskBoard {
    const tasks = this.getAllTasks();

    const byStatus: Record<TaskStatus, number> = {
      pending: 0,
      claimed: 0,
      'in-progress': 0,
      completed: 0,
      failed: 0,
    };

    const byPriority: Record<TaskPriority, number> = {
      low: 0,
      normal: 0,
      high: 0,
      urgent: 0,
    };

    tasks.forEach(task => {
      byStatus[task.status]++;
      byPriority[task.priority]++;
    });

    return {
      tasks,
      total: tasks.length,
      byStatus,
      byPriority,
    };
  }

  /**
   * 筛选任务
   */
  filterTasks(filter: TaskFilter): Task[] {
    return this.getAllTasks().filter(task => {
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        if (!statuses.includes(task.status)) return false;
      }

      if (filter.priority) {
        const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
        if (!priorities.includes(task.priority)) return false;
      }

      if (filter.claimedBy && task.claimedBy !== filter.claimedBy) return false;
      if (filter.createdBy && task.createdBy !== filter.createdBy) return false;

      if (filter.tags && task.tags && filter.tags.length > 0) {
        const hasAllTags = filter.tags.filter(Boolean).every(tag => task.tags?.includes(tag));
        if (!hasAllTags) return false;
      }

      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        const titleMatch = (task.title || '').toLowerCase().includes(searchLower);
        const descMatch = (task.description || '').toLowerCase().includes(searchLower);
        if (!titleMatch && !descMatch) return false;
      }

      return true;
    });
  }

  /**
   * 认领任务（任务回避机制核心）
   *
   * 规则：
   * 1. 任务已被认领，不能重复认领
   * 2. 定向指派的任务，只能被指定者认领
   * 3. 认领后状态变为 'claimed'
   */
  claimTask(taskId: string, agentId: string): { success: boolean; error?: string; task?: Task } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // 检查任务是否已被认领
    if (task.claimedBy) {
      return {
        success: false,
        error: `Task already claimed by ${task.claimedBy}`,
      };
    }

    // 检查是否是定向指派
    if (task.assignedTo && task.assignedTo !== agentId) {
      return {
        success: false,
        error: `Task is assigned to ${task.assignedTo}, you cannot claim it`,
      };
    }

    // 检查任务状态
    if (task.status !== 'pending') {
      return {
        success: false,
        error: `Cannot claim task with status '${task.status}'`,
      };
    }

    // 认领成功
    task.claimedBy = agentId;
    task.status = 'claimed';
    task.claimedAt = Date.now();
    this.claimMap.set(taskId, agentId);

    // 添加系统消息
    this.addMessage(taskId, 'system', `${agentId} claimed the task`, 'status-update');

    // 记录 task_claimed 动作
    if (this.actionLogger) {
      this.actionLogger.log({
        agentId,
        taskId,
        actionType: 'task_claimed',
        payload: { action: 'claim' },
        result: 'success',
      });
    }

    this.emit('task:claimed', { task, agentId });

    return { success: true, task };
  }

  /**
   * 释放任务
   */
  releaseTask(taskId: string, agentId: string): { success: boolean; error?: string } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // 只有认领者可以释放
    if (task.claimedBy !== agentId) {
      return {
        success: false,
        error: 'Only the claimer can release this task',
      };
    }

    task.claimedBy = undefined;
    task.status = 'pending';
    task.claimedAt = undefined;
    this.claimMap.delete(taskId);

    this.addMessage(taskId, 'system', `${agentId} released the task`, 'status-update');

    // 记录 task_released 动作
    if (this.actionLogger) {
      this.actionLogger.log({
        agentId,
        taskId,
        actionType: 'task_released',
        payload: { action: 'release' },
        result: 'success',
      });
    }

    this.emit('task:released', { task, agentId });

    return { success: true };
  }

  /**
   * 指派任务
   */
  assignTask(taskId: string, fromAgent: string, toAgent: string): { success: boolean; error?: string } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // 只有创建者或当前认领者可以重新指派
    if (task.createdBy !== fromAgent && task.claimedBy !== fromAgent) {
      return {
        success: false,
        error: 'Only creator or claimer can assign this task',
      };
    }

    // 如果任务已被认领且不是当前认领者，需要先释放
    if (task.claimedBy && task.claimedBy !== fromAgent) {
      return {
        success: false,
        error: 'Task is already claimed, cannot assign',
      };
    }

    task.assignedTo = toAgent;
    task.status = 'pending';
    task.claimedBy = undefined;
    task.claimedAt = undefined;

    this.addMessage(taskId, fromAgent, `Assigned task to ${toAgent}`, 'handoff');

    // 记录 task_assigned 动作
    if (this.actionLogger) {
      this.actionLogger.log({
        agentId: fromAgent,
        taskId,
        actionType: 'task_assigned',
        payload: { toAgent },
        result: 'success',
      });
    }

    this.emit('task:updated', task);

    return { success: true };
  }

  /**
   * 更新任务状态
   */
  updateTaskStatus(
    taskId: string,
    agentId: string,
    status: TaskStatus
  ): { success: boolean; error?: string } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // 只有认领者可以更新状态
    if (task.claimedBy !== agentId && task.createdBy !== agentId) {
      return {
        success: false,
        error: 'Only claimer or creator can update task status',
      };
    }

    const oldStatus = task.status;
    task.status = status;

    // Record status change history
    if (!task.statusHistory) {
      task.statusHistory = [];
    }
    task.statusHistory.push({
      from: oldStatus,
      to: status,
      timestamp: Date.now(),
      agentId,
    });

    if (status === 'in-progress') {
      task.startedAt = Date.now();
    } else if (status === 'completed') {
      task.completedAt = Date.now();
      task.progress = 100;
    }

    this.addMessage(taskId, agentId, `Status changed: ${oldStatus} -> ${status}`, 'status-update');

    // 记录 status_change 动作
    if (this.actionLogger) {
      this.actionLogger.log({
        agentId,
        taskId,
        actionType: 'status_change',
        payload: { from: oldStatus, to: status },
        result: 'success',
      });
    }

    this.emit('task:updated', task);

    if (status === 'completed') {
      this.emit('task:completed', task);
    } else if (status === 'failed') {
      this.emit('task:failed', task);
    }

    return { success: true };
  }

  /**
   * 更新任务进度
   */
  updateProgress(
    taskId: string,
    agentId: string,
    progress: number
  ): { success: boolean; error?: string } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // 只有认领者可以更新进度
    if (task.claimedBy !== agentId) {
      return {
        success: false,
        error: 'Only claimer can update progress',
      };
    }

    task.progress = Math.max(0, Math.min(100, progress));
    this.emit('task:updated', task);

    return { success: true };
  }

  /**
   * 添加消息
   */
  addMessage(
    taskId: string,
    fromAgent: string,
    content: string,
    type: TaskMessageType = 'comment',
    mentions?: string[]
  ): TaskMessage | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    const message: TaskMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      taskId,
      fromAgent,
      content,
      type,
      timestamp: Date.now(),
      mentions,
    };

    task.messages.push(message);

    // 限制消息数量
    if (task.messages.length > 100) {
      task.messages = task.messages.slice(-100);
    }

    this.emit('message:added', { task, message });

    return message;
  }

  /**
   * 获取 Agent 认领的所有任务
   */
  getTasksByAgent(agentId: string): Task[] {
    return this.getAllTasks().filter(t => t.claimedBy === agentId);
  }

  /**
   * 获取待认领的任务
   */
  getPendingTasks(): Task[] {
    return this.getAllTasks().filter(t => t.status === 'pending');
  }

  /**
   * 获取进行中的任务
   */
  getInProgressTasks(): Task[] {
    return this.getAllTasks().filter(t => t.status === 'in-progress');
  }

  /**
   * 获取超时任务
   */
  getOverdueTasks(): Task[] {
    const now = Date.now();
    return this.getAllTasks().filter(t =>
      t.dueAt && t.status !== 'completed' && t.status !== 'failed' && t.dueAt < now
    );
  }

  /**
   * 删除任务
   */
  deleteTask(taskId: string, agentId: string): { success: boolean; error?: string } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    // 只有创建者可以删除
    if (task.createdBy !== agentId) {
      return {
        success: false,
        error: 'Only creator can delete task',
      };
    }

    this.tasks.delete(taskId);
    this.claimMap.delete(taskId);

    return { success: true };
  }

  /**
   * 获取任务统计
   */
  getStats(): {
    total: number;
    byStatus: Record<TaskStatus, number>;
    byPriority: Record<TaskPriority, number>;
    byAgent: Map<string, number>;
    overdueCount: number;
  } {
    const board = this.getTaskBoard();
    const byAgent = new Map<string, number>();

    board.tasks.forEach(task => {
      if (task.claimedBy) {
        byAgent.set(task.claimedBy, (byAgent.get(task.claimedBy) || 0) + 1);
      }
    });

    return {
      total: board.total,
      byStatus: board.byStatus,
      byPriority: board.byPriority,
      byAgent,
      overdueCount: this.getOverdueTasks().length,
    };
  }
}
