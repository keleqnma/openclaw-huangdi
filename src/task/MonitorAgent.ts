/**
 * MonitorAgent - 监控 Agent
 *
 * 监控任务进度、超时告警、生成报告
 */

import { EventEmitter } from 'events';
import { TaskBoardManager } from './TaskBoardManager';
import { Task, TaskStatus } from './types';

interface MonitorAgentEvents {
  'alert:overdue': Task;
  'alert:stalled': Task;
  'report:progress': { tasks: Task[]; completed: number; inProgress: number };
  'report:daily': { date: string; summary: string };
}

export class MonitorAgent extends EventEmitter {
  private readonly taskBoard: TaskBoardManager;
  private readonly checkInterval: number;
  private readonly stalledThreshold: number; // 多少毫秒无更新视为停滞
  private intervalId?: NodeJS.Timeout;

  constructor(
    taskBoard: TaskBoardManager,
    options: {
      checkInterval?: number;        // 检查间隔 (ms)
      stalledThreshold?: number;     // 停滞阈值 (ms)
    } = {}
  ) {
    super();
    this.taskBoard = taskBoard;
    this.checkInterval = options.checkInterval ?? 30000; // 默认 30 秒
    this.stalledThreshold = options.stalledThreshold ?? 300000; // 默认 5 分钟
  }

  /**
   * 启动监控
   */
  start(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    this.intervalId = setInterval(() => {
      this.check();
    }, this.checkInterval);

    console.log('[MonitorAgent] Started monitoring tasks');
  }

  /**
   * 停止监控
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    console.log('[MonitorAgent] Stopped monitoring');
  }

  /**
   * 执行检查
   */
  private check(): void {
    const tasks = this.taskBoard.getAllTasks();

    // 检查超时任务
    const overdueTasks = this.taskBoard.getOverdueTasks();
    overdueTasks.forEach(task => {
      this.emit('alert:overdue', task);
    });

    // 检查停滞任务
    const stalledTasks = this.checkStalledTasks(tasks);
    stalledTasks.forEach(task => {
      this.emit('alert:stalled', task);
    });

    // 生成进度报告
    this.emitProgressReport();
  }

  /**
   * 检查停滞任务
   */
  private checkStalledTasks(tasks: Task[]): Task[] {
    const now = Date.now();
    const stalled: Task[] = [];

    tasks
      .filter(t => t.status === 'in-progress' && t.startedAt)
      .forEach(task => {
        const lastUpdate = task.completedAt || task.startedAt!;
        if (now - lastUpdate > this.stalledThreshold) {
          stalled.push(task);
        }
      });

    return stalled;
  }

  /**
   * 发送进度报告
   */
  private emitProgressReport(): void {
    const tasks = this.taskBoard.getAllTasks();
    const completed = tasks.filter(t => t.status === 'completed').length;
    const inProgress = tasks.filter(t => t.status === 'in-progress').length;

    this.emit('report:progress', {
      tasks: tasks.filter(t => t.status !== 'completed' && t.status !== 'failed'),
      completed,
      inProgress,
    });
  }

  /**
   * 获取任务摘要
   */
  getSummary(): {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
    overdue: number;
    stalled: number;
  } {
    const tasks = this.taskBoard.getAllTasks();
    const now = Date.now();

    return {
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      inProgress: tasks.filter(t => t.status === 'in-progress').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
      overdue: this.taskBoard.getOverdueTasks().length,
      stalled: this.checkStalledTasks(tasks).length,
    };
  }

  /**
   * 生成每日报告
   */
  generateDailyReport(): string {
    const summary = this.getSummary();
    const date = new Date().toLocaleDateString('zh-CN');

    return `
## 任务日报 - ${date}

### 总体统计
- 总任务数：${summary.total}
- 待认领：${summary.pending}
- 进行中：${summary.inProgress}
- 已完成：${summary.completed}
- 失败：${summary.failed}

### 告警
- 超时任务：${summary.overdue}
- 停滞任务：${summary.stalled}

### 建议
${summary.overdue > 0 ? '⚠️ 有任务超时，请及时处理' : '✅ 无超时任务'}
${summary.stalled > 0 ? '⚠️ 有任务停滞，请检查进度' : '✅ 无停滞任务'}
    `.trim();
  }
}
