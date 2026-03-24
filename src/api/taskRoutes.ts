/**
 * Task Board API Routes - 任务看板 API 路由
 */

import { Hono } from 'hono';
import { TaskBoardManager } from '../task/TaskBoardManager';
import { MonitorAgent } from '../task/MonitorAgent';

export function createTaskBoardRoutes(
  taskBoard: TaskBoardManager,
  monitorAgent?: MonitorAgent
) {
  const app = new Hono();

  // ===== 任务看板路由 =====

  // 获取完整任务看板
  app.get('/api/task-board', (c) => {
    const board = taskBoard.getTaskBoard();
    return c.json({ board });
  });

  // 获取任务统计
  app.get('/api/task-stats', (c) => {
    const stats = taskBoard.getStats();
    return c.json({ stats });
  });

  // 获取监控摘要
  app.get('/api/monitor-summary', (c) => {
    if (!monitorAgent) {
      return c.json({ error: 'Monitor agent not enabled' }, 400);
    }
    const summary = monitorAgent.getSummary();
    return c.json({ summary });
  });

  // ===== 任务 CRUD 路由 =====

  // 获取所有任务（支持筛选）
  app.get('/api/tasks', (c) => {
    const filter: any = {};
    const status = c.req.query('status');
    const priority = c.req.query('priority');
    const claimedBy = c.req.query('claimedBy');
    const createdBy = c.req.query('createdBy');
    const search = c.req.query('search');

    if (status) filter.status = status.split(',');
    if (priority) filter.priority = priority.split(',');
    if (claimedBy) filter.claimedBy = claimedBy;
    if (createdBy) filter.createdBy = createdBy;
    if (search) filter.search = search;

    const tasks = taskBoard.filterTasks(filter);
    return c.json({ tasks });
  });

  // 创建任务
  app.post('/api/tasks', async (c) => {
    try {
      const { title, description, priority, assignedTo, tags, dueAt } = await c.req.json();

      if (!title || !description) {
        return c.json({ error: 'Title and description are required' }, 400);
      }

      const task = taskBoard.createTask('system', {
        title,
        description,
        priority,
        assignedTo,
        tags,
        dueAt,
      });

      return c.json({ success: true, task });
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  // 获取单个任务
  app.get('/api/tasks/:id', (c) => {
    const task = taskBoard.getTask(c.req.param('id'));
    if (!task) return c.json({ error: 'Task not found' }, 404);
    return c.json({ task });
  });

  // 认领任务（任务回避机制）
  app.post('/api/tasks/:id/claim', async (c) => {
    try {
      const { agentId } = await c.req.json();

      if (!agentId) {
        return c.json({ error: 'agentId is required' }, 400);
      }

      const result = taskBoard.claimTask(c.req.param('id'), agentId);

      if (result.success) {
        return c.json({ success: true, task: result.task });
      } else {
        return c.json({ error: result.error }, 409); // Conflict
      }
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  // 释放任务
  app.post('/api/tasks/:id/release', async (c) => {
    try {
      const { agentId } = await c.req.json();

      if (!agentId) {
        return c.json({ error: 'agentId is required' }, 400);
      }

      const result = taskBoard.releaseTask(c.req.param('id'), agentId);

      if (result.success) {
        return c.json({ success: true });
      } else {
        return c.json({ error: result.error }, 403);
      }
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  // 指派任务
  app.post('/api/tasks/:id/assign', async (c) => {
    try {
      const { fromAgent, toAgent } = await c.req.json();

      if (!fromAgent || !toAgent) {
        return c.json({ error: 'fromAgent and toAgent are required' }, 400);
      }

      const result = taskBoard.assignTask(c.req.param('id'), fromAgent, toAgent);

      if (result.success) {
        return c.json({ success: true });
      } else {
        return c.json({ error: result.error }, 403);
      }
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  // 更新任务状态
  app.put('/api/tasks/:id/status', async (c) => {
    try {
      const { agentId, status } = await c.req.json();

      if (!agentId || !status) {
        return c.json({ error: 'agentId and status are required' }, 400);
      }

      const result = taskBoard.updateTaskStatus(c.req.param('id'), agentId, status);

      if (result.success) {
        return c.json({ success: true });
      } else {
        return c.json({ error: result.error }, 403);
      }
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  // 更新任务进度
  app.post('/api/tasks/:id/progress', async (c) => {
    try {
      const { agentId, progress } = await c.req.json();

      if (!agentId || progress === undefined) {
        return c.json({ error: 'agentId and progress are required' }, 400);
      }

      const result = taskBoard.updateProgress(c.req.param('id'), agentId, progress);

      if (result.success) {
        return c.json({ success: true });
      } else {
        return c.json({ error: result.error }, 403);
      }
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  // 添加消息（Agent 聊天）
  app.post('/api/tasks/:id/messages', async (c) => {
    try {
      const { fromAgent, content, type, mentions } = await c.req.json();

      if (!fromAgent || !content) {
        return c.json({ error: 'fromAgent and content are required' }, 400);
      }

      const message = taskBoard.addMessage(
        c.req.param('id'),
        fromAgent,
        content,
        type || 'comment',
        mentions
      );

      if (!message) {
        return c.json({ error: 'Task not found' }, 404);
      }

      return c.json({ success: true, message });
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  // 获取任务消息
  app.get('/api/tasks/:id/messages', (c) => {
    const task = taskBoard.getTask(c.req.param('id'));
    if (!task) return c.json({ error: 'Task not found' }, 404);
    return c.json({ messages: task.messages });
  });

  // 删除任务
  app.delete('/api/tasks/:id', async (c) => {
    try {
      const { agentId } = await c.req.json();

      if (!agentId) {
        return c.json({ error: 'agentId is required' }, 400);
      }

      const result = taskBoard.deleteTask(c.req.param('id'), agentId);

      if (result.success) {
        return c.json({ success: true });
      } else {
        return c.json({ error: result.error }, 403);
      }
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  // 获取待认领任务
  app.get('/api/tasks/query/pending', (c) => {
    const tasks = taskBoard.getPendingTasks();
    return c.json({ tasks });
  });

  // 获取进行中的任务
  app.get('/api/tasks/query/in-progress', (c) => {
    const tasks = taskBoard.getInProgressTasks();
    return c.json({ tasks });
  });

  // 获取超时任务
  app.get('/api/tasks/query/overdue', (c) => {
    const tasks = taskBoard.getOverdueTasks();
    return c.json({ tasks });
  });

  // 获取 Agent 的任务
  app.get('/api/tasks/agent/:agentId', (c) => {
    const tasks = taskBoard.getTasksByAgent(c.req.param('agentId'));
    return c.json({ tasks });
  });

  return app;
}
