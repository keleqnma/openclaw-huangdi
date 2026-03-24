/**
 * API Routes - REST API 路由
 *
 * 提供 Agent、Terminal、Sandbox 的 HTTP API
 */

import { Hono } from 'hono';
import { AgentOrchestrator } from '../agent/AgentOrchestrator';
import { TerminalService } from '../terminal/TerminalService';
import { SandboxManager } from '../sandbox/SandboxManager';
import { TaskBoardManager } from '../task/TaskBoardManager';
import { MonitorAgent } from '../task/MonitorAgent';
import { ActionLogger } from '../task/ActionLogger';
import { ChatManager } from '../task/ChatManager';
import { serveStatic } from '@hono/node-server/serve-static';

export function createRoutes(
  orchestrator: AgentOrchestrator,
  terminalService: TerminalService,
  sandboxManager: SandboxManager,
  taskBoard?: TaskBoardManager,
  monitorAgent?: MonitorAgent,
  actionLogger?: ActionLogger,
  chatManager?: ChatManager
) {
  const app = new Hono();

  // 添加静态文件服务（任务看板前端页面）
  app.get('/task-board.html', serveStatic({ root: './public' }));
  app.get('/agent-dashboard.html', serveStatic({ root: './public' }));
  app.get('/public/*', serveStatic({ root: './public' }));

  // ===== Agent 路由 =====

  // 获取所有 Agent
  app.get('/api/agents', (c) => {
    const agents = orchestrator.getAll();
    return c.json({ agents });
  });

  // 获取统计信息
  app.get('/api/stats', (c) => {
    const stats = orchestrator.getStats();
    return c.json({ stats });
  });

  // 创建/注册 Agent
  app.post('/api/agents', async (c) => {
    try {
      const config = await c.req.json();
      const autoStart = config.autoStart ?? true;  // 默认自动启动
      await orchestrator.register(config, autoStart);
      return c.json({ success: true, agentId: config.id });
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  // 启动 Agent
  app.post('/api/agents/:id/start', async (c) => {
    try {
      const result = await orchestrator.startAgent(c.req.param('id'));
      return c.json({ success: true, sessionId: result.sessionId });
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  // 停止 Agent
  app.post('/api/agents/:id/stop', async (c) => {
    try {
      await orchestrator.stopAgent(c.req.param('id'));
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  // 获取单个 Agent
  app.get('/api/agents/:id', (c) => {
    const agent = orchestrator.getRuntime(c.req.param('id'));
    if (!agent) return c.json({ error: 'Agent not found' }, 404);
    return c.json({ agent });
  });

  // 获取 Agent 的终端会话
  app.get('/api/agents/:id/session', (c) => {
    const agent = orchestrator.getRuntime(c.req.param('id'));
    if (!agent) return c.json({ error: 'Agent not found' }, 404);

    const sessions = terminalService.getByAgentId(c.req.param('id'));
    if (sessions.length === 0) {
      return c.json({ error: 'No active session for this agent' }, 404);
    }

    // 返回最新的活动会话
    const session = sessions[sessions.length - 1];
    return c.json({ session });
  });

  // 获取 Agent 终端输出（最后 N 行）
  app.get('/api/agents/:id/output', (c) => {
    try {
      const sessionId = c.req.query('sessionId');
      const agent = orchestrator.getRuntime(c.req.param('id'));
      if (!agent) return c.json({ error: 'Agent not found' }, 404);

      // 如果没有指定 sessionId，使用最新的活动会话
      const targetSessionId = sessionId || (() => {
        const sessions = terminalService.getByAgentId(c.req.param('id'));
        return sessions.length > 0 ? sessions[sessions.length - 1].id : null;
      })();

      if (!targetSessionId) {
        return c.json({ error: 'No active session for this agent' }, 404);
      }

      const lines = parseInt(c.req.query('lines') || '100');
      const output = terminalService.getTail(targetSessionId, lines);
      return c.json({ output });
    } catch (error: any) {
      return c.json({ error: error.message }, 404);
    }
  });

  // 删除 Agent
  app.delete('/api/agents/:id', async (c) => {
    await orchestrator.unregister(c.req.param('id'));
    return c.json({ success: true });
  });

  // 执行任务
  app.post('/api/agents/:id/execute', async (c) => {
    try {
      const { task, createSandbox } = await c.req.json();
      const result = await orchestrator.executeTask(c.req.param('id'), task, { createSandbox });
      return c.json({ success: true, ...result });
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  // ===== Agent 执行任务（已废弃，使用任务看板 API）=====
  // 注：POST /api/tasks 已移至任务看板路由中

  // ===== Terminal 路由 =====

  // 创建终端会话
  app.post('/api/terminals', async (c) => {
    try {
      const { agentId, cwd, env, rows, cols } = await c.req.json();
      const session = terminalService.createSession(agentId, { cwd, env, rows, cols });
      return c.json({ sessionId: session.id });
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  // 获取所有终端会话
  app.get('/api/terminals', (c) => {
    const sessions = terminalService.getActiveSessions();
    return c.json({ sessions });
  });

  // 获取终端输出
  app.get('/api/terminals/:id/output', (c) => {
    try {
      const output = terminalService.getOutput(c.req.param('id'));
      return c.json({ output });
    } catch (error: any) {
      return c.json({ error: error.message }, 404);
    }
  });

  // 获取终端输出（最后 N 行）
  app.get('/api/terminals/:id/tail', (c) => {
    try {
      const lines = parseInt(c.req.query('lines') || '100');
      const output = terminalService.getTail(c.req.param('id'), lines);
      return c.json({ output });
    } catch (error: any) {
      return c.json({ error: error.message }, 404);
    }
  });

  // 向终端写入
  app.post('/api/terminals/:id/write', async (c) => {
    try {
      const { data } = await c.req.json();
      terminalService.write(c.req.param('id'), data);
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  // 调整终端尺寸
  app.post('/api/terminals/:id/resize', async (c) => {
    try {
      const { rows, cols } = await c.req.json();
      terminalService.resize(c.req.param('id'), { rows, cols });
      return c.json({ success: true });
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  // 关闭终端
  app.delete('/api/terminals/:id', (c) => {
    terminalService.closeSession(c.req.param('id'));
    return c.json({ success: true });
  });

  // ===== Sandbox 路由 =====

  // 创建沙箱
  app.post('/api/sandboxes', async (c) => {
    try {
      const { agentId, config } = await c.req.json();
      const sandbox = await sandboxManager.create(agentId, config);
      return c.json({ sandboxId: sandbox.id, sandbox });
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  // 获取所有沙箱
  app.get('/api/sandboxes', (c) => {
    const sandboxes = sandboxManager.getActive();
    return c.json({ sandboxes });
  });

  // 获取沙箱
  app.get('/api/sandboxes/:id', (c) => {
    const sandbox = sandboxManager.getInstance(c.req.param('id'));
    if (!sandbox) return c.json({ error: 'Sandbox not found' }, 404);
    return c.json({ sandbox });
  });

  // 停止沙箱
  app.delete('/api/sandboxes/:id', async (c) => {
    await sandboxManager.stop(c.req.param('id'));
    return c.json({ success: true });
  });

  // 验证命令
  app.post('/api/sandboxes/:id/validate-command', async (c) => {
    try {
      const { command } = await c.req.json();
      const result = sandboxManager.validateCommand(c.req.param('id'), command);
      return c.json({ result });
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  // 验证路径
  app.post('/api/sandboxes/:id/validate-path', async (c) => {
    try {
      const { filePath } = await c.req.json();
      const result = sandboxManager.validatePath(c.req.param('id'), filePath);
      return c.json({ result });
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  // ===== 任务看板路由 =====
  if (taskBoard) {
    // 获取任务统计
    app.get('/api/task-stats', (c) => {
      const stats = taskBoard.getStats();
      return c.json({ stats });
    });

    // 获取监控摘要
    if (monitorAgent) {
      app.get('/api/monitor-summary', (c) => {
        const summary = monitorAgent.getSummary();
        return c.json({ summary });
      });
    }

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
        if (!taskBoard) {
          return c.json({ error: 'Task board not enabled' }, 500);
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

    // 认领任务
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
          return c.json({ error: result.error }, 409);
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

    // 添加消息
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
  }

  // ===== Agent Action 路由 =====
  if (actionLogger) {
    // 获取所有动作
    app.get('/api/actions', (c) => {
      const agentId = c.req.query('agentId');
      const taskId = c.req.query('taskId');
      const actionType = c.req.query('actionType');
      const limit = parseInt(c.req.query('limit') || '100');
      const since = c.req.query('since') ? parseInt(c.req.query('since')!) : undefined;

      const filter: any = { limit };
      if (agentId) filter.agentId = agentId;
      if (taskId) filter.taskId = taskId;
      if (actionType) filter.actionType = actionType;
      if (since) filter.since = since;

      const actions = actionLogger.getActions(filter);
      return c.json({ actions });
    });

    // 获取某个 Agent 的动作
    app.get('/api/agents/:id/actions', (c) => {
      const limit = parseInt(c.req.query('limit') || '50');
      const actions = actionLogger.getActions({ agentId: c.req.param('id'), limit });
      return c.json({ actions });
    });

    // 获取任务相关的动作
    app.get('/api/tasks/:id/actions', (c) => {
      const limit = parseInt(c.req.query('limit') || '50');
      const actions = actionLogger.getActions({ taskId: c.req.param('id'), limit });
      return c.json({ actions });
    });
  }

  // ===== Chat 路由 =====
  if (chatManager) {
    // 获取聊天消息
    app.get('/api/chat', (c) => {
      const limit = parseInt(c.req.query('limit') || '100');
      const since = c.req.query('since') ? parseInt(c.req.query('since')!) : undefined;
      const from = c.req.query('from');
      const to = c.req.query('to');
      const isGlobal = c.req.query('global') === 'true';

      const filter: any = { limit };
      if (since) filter.since = since;
      if (from) filter.from = from;
      if (to) filter.to = to;
      if (isGlobal) filter.isGlobal = true;

      const messages = chatManager.getMessages(filter);
      return c.json({ messages });
    });

    // 发送消息
    app.post('/api/chat', async (c) => {
      try {
        const { from, content, to, isFromUser, relatedTaskId } = await c.req.json();
        if (!from || !content) {
          return c.json({ error: 'from and content are required' }, 400);
        }
        const message = chatManager.sendMessage({
          from,
          content,
          to,
          isFromUser: isFromUser || false,
          relatedTaskId,
        });
        return c.json({ success: true, message });
      } catch (error: any) {
        return c.json({ error: error.message }, 400);
      }
    });

    // 获取与某个 Agent 的私聊消息
    app.get('/api/chat/private/:agentId', (c) => {
      const limit = parseInt(c.req.query('limit') || '50');
      const messages = chatManager.getPrivateChat(c.req.param('agentId'), limit);
      return c.json({ messages });
    });

    // 获取包含@Agent 的消息
    app.get('/api/chat/mentioned/:agentId', (c) => {
      const limit = parseInt(c.req.query('limit') || '20');
      const messages = chatManager.getMentionedMessages(c.req.param('agentId'), limit);
      return c.json({ messages });
    });
  }

  // ===== Workspace 路由 =====
  // 获取 Agent 的 workspace 文件树
  app.get('/api/agents/:id/workspace', async (c) => {
    try {
      const sandbox = sandboxManager.getInstance(c.req.param('id'));
      if (!sandbox) {
        return c.json({ error: 'Sandbox not found' }, 404);
      }

      const dirPath = c.req.query('path') ?? '.';
      const { readdir, stat } = await import('fs/promises');
      const { join } = await import('path');

      // 安全检查：确保路径在 workspace 内
      const workspaceRoot = sandbox.config.workspaceDir || sandbox.config.workspaceRoot;
      if (!workspaceRoot) {
        return c.json({ error: 'Workspace not configured' }, 500);
      }
      const targetPath = join(workspaceRoot, dirPath);

      if (!targetPath.startsWith(workspaceRoot)) {
        return c.json({ error: 'Invalid path' }, 403);
      }

      const files = await readdir(targetPath, { withFileTypes: true });
      const fileTree: Array<{ name: string; isDirectory: boolean; path: string }> = [];
      for (const file of files) {
        const filePath = join(dirPath === '.' ? '' : dirPath, file.name);
        if (file.isDirectory()) {
          fileTree.push({ name: file.name, isDirectory: true, path: filePath });
        } else {
          const fileStat = await stat(join(workspaceRoot, filePath));
          fileTree.push({ name: file.name, isDirectory: false, path: filePath });
        }
      }

      return c.json({ path: dirPath, files: fileTree });
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  // 读取 workspace 中的文件
  app.get('/api/agents/:id/workspace/read', async (c) => {
    try {
      const sandbox = sandboxManager.getInstance(c.req.param('id'));
      if (!sandbox) {
        return c.json({ error: 'Sandbox not found' }, 404);
      }

      const filePath = c.req.query('path');
      if (!filePath) {
        return c.json({ error: 'path parameter is required' }, 400);
      }

      const { readFile } = await import('fs/promises');
      const { join } = await import('path');

      const workspaceRoot = sandbox.config.workspaceDir || sandbox.config.workspaceRoot;
      if (!workspaceRoot) {
        return c.json({ error: 'Workspace not configured' }, 500);
      }
      const targetPath = join(workspaceRoot, filePath);

      if (!targetPath.startsWith(workspaceRoot)) {
        return c.json({ error: 'Invalid path' }, 403);
      }

      const content = await readFile(targetPath, 'utf-8');
      return c.json({ path: filePath, content });
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  // 更新 Agent 配置
  app.put('/api/agents/:id/config', async (c) => {
    try {
      const { role, systemPrompt, customInstructions, memory } = await c.req.json();
      // 注：这里只是返回成功，实际配置更新需要在 AgentOrchestrator 中实现
      return c.json({ success: true, message: 'Config updated (not persisted in this demo)' });
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  });

  return app;
}
