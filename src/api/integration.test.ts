/**
 * API 集成测试
 * 测试 REST API 端点和 WebSocket 通信
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MultiAgentService } from '../service/MultiAgentService';

// Type helper for API responses
type ApiResponse<T = any> = { success?: boolean; agent?: T; agents?: T[]; stats?: T; message?: T; messages?: T[]; task?: T; tasks?: T[]; actions?: T[]; success: boolean };

describe('API Integration Tests', () => {
  let service: MultiAgentService;
  let baseUrl: string;

  beforeAll(async () => {
    // 创建服务实例
    service = new MultiAgentService({
      port: 3458, // 使用不同端口避免冲突
      wsPort: 3459,
      sandbox: {
        mode: 'restricted',
        workspaceRoot: './test-workspaces',
        allowedPaths: [],
        networkAccess: false,
        resourceLimits: {
          maxCpu: 50,
          maxMemory: 512,
          maxProcesses: 10,
        },
      },
    });

    // 注册测试 Agents
    await service.registerAgents([
      {
        id: 'test-researcher',
        name: 'Test Researcher',
        role: 'researcher' as any,
        command: 'echo',
        args: ['Researcher started'],
        cwd: './test-workspaces/researcher',
      },
      {
        id: 'test-coder',
        name: 'Test Coder',
        role: 'coder' as any,
        command: 'echo',
        args: ['Coder started'],
        cwd: './test-workspaces/coder',
      },
    ]);

    await service.start();
    baseUrl = 'http://localhost:3458';
  });

  afterAll(async () => {
    await service.stop();
  });

  describe('Agents API', () => {
    it('GET /api/agents - should return all agents', async () => {
      const res = await fetch(`${baseUrl}/api/agents`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.agents).toHaveLength(2);
      expect(data.agents.map((a: any) => a.id)).toContain('test-researcher');
      expect(data.agents.map((a: any) => a.id)).toContain('test-coder');
    });

    it('GET /api/agents/:id - should return single agent', async () => {
      const res = await fetch(`${baseUrl}/api/agents/test-researcher`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.agent.id).toBe('test-researcher');
    });

    it('GET /api/agents/:id - should return 404 for non-existent agent', async () => {
      const res = await fetch(`${baseUrl}/api/agents/non-existent`);

      expect(res.status).toBe(404);
    });

    it('GET /api/stats - should return statistics', async () => {
      const res = await fetch(`${baseUrl}/api/stats`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.stats).toBeDefined();
    });
  });

  describe('Chat API', () => {
    it('POST /api/chat - should send global message', async () => {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'test-user',
          content: 'Hello everyone',
          isFromUser: true,
        }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message.content).toBe('Hello everyone');
      expect(data.message.isFromUser).toBe(true);
    });

    it('POST /api/chat - should parse @mentions', async () => {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'test-user',
          content: '@test-researcher please research this',
          isFromUser: true,
        }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.message.mentions).toContain('test-researcher');
    });

    it('POST /api/chat - should send private message', async () => {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'test-user',
          content: 'Private message',
          to: 'test-researcher',
          isFromUser: true,
        }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.message.to).toBe('test-researcher');
    });

    it('GET /api/chat - should return messages', async () => {
      const res = await fetch(`${baseUrl}/api/chat?limit=10`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data.messages)).toBe(true);
      expect(data.messages.length).toBeGreaterThan(0);
    });

    it('GET /api/chat/private/:agentId - should return private chat', async () => {
      const res = await fetch(`${baseUrl}/api/chat/private/test-researcher?limit=10`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data.messages)).toBe(true);
    });
  });

  describe('Tasks API', () => {
    let createdTaskId: string;

    it('POST /api/tasks - should create task', async () => {
      const res = await fetch(`${baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Integration Test Task',
          description: 'Task for integration testing',
          priority: 'high',
          assignedTo: 'test-researcher',
        }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.task.title).toBe('Integration Test Task');
      expect(data.task.assignedTo).toBe('test-researcher');

      createdTaskId = data.task.id;
    });

    it('GET /api/tasks - should return tasks list', async () => {
      const res = await fetch(`${baseUrl}/api/tasks`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data.tasks)).toBe(true);
      expect(data.tasks.length).toBeGreaterThan(0);
    });

    it('GET /api/tasks/:id - should return single task', async () => {
      const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.task.id).toBe(createdTaskId);
    });

    it('POST /api/tasks/:id/claim - should claim task', async () => {
      const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'test-researcher' }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.task.claimedBy).toBe('test-researcher');
      expect(data.task.status).toBe('claimed');
    });

    it('POST /api/tasks/:id/claim - should prevent duplicate claim', async () => {
      const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'test-coder' }),
      });

      expect(res.status).toBe(409);
    });

    it('POST /api/tasks/:id/progress - should update progress', async () => {
      const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'test-researcher', progress: 50 }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('POST /api/tasks/:id/messages - should add message', async () => {
      const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromAgent: 'test-researcher',
          content: 'Working on this task',
          type: 'comment',
        }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message.content).toBe('Working on this task');
    });

    it('GET /api/tasks/:id/messages - should return task messages', async () => {
      const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/messages`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data.messages)).toBe(true);
      expect(data.messages.length).toBeGreaterThan(0);
    });

    it('PUT /api/tasks/:id/status - should update status to completed', async () => {
      const res = await fetch(`${baseUrl}/api/tasks/${createdTaskId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'test-researcher', status: 'completed' }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify task is completed
      const getRes = await fetch(`${baseUrl}/api/tasks/${createdTaskId}`);
      const getData = await getRes.json();
      expect(getData.task.status).toBe('completed');
    });
  });

  describe('Actions API', () => {
    it('GET /api/actions - should return actions list', async () => {
      const res = await fetch(`${baseUrl}/api/actions?limit=50`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data.actions)).toBe(true);
    });

    it('GET /api/actions?agentId=:id - should filter by agent', async () => {
      const res = await fetch(`${baseUrl}/api/actions?agentId=test-researcher&limit=50`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data.actions)).toBe(true);
      data.actions.forEach((action: any) => {
        expect(action.agentId).toBe('test-researcher');
      });
    });

    it('GET /api/agents/:id/actions - should return agent actions', async () => {
      const res = await fetch(`${baseUrl}/api/agents/test-researcher/actions?limit=50`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data.actions)).toBe(true);
    });
  });

  describe('Workspace API', () => {
    it('GET /api/agents/:id/workspace - should return workspace files', async () => {
      const res = await fetch(`${baseUrl}/api/agents/test-researcher/workspace`);

      // Should return 404 if sandbox not found (since we didn't create actual sandboxes)
      // or return file list if workspace exists
      expect([200, 404]).toContain(res.status);
    });
  });

  describe('Task Filters API', () => {
    it('GET /api/tasks?status=completed - should filter by status', async () => {
      const res = await fetch(`${baseUrl}/api/tasks?status=completed`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data.tasks)).toBe(true);
      // Should have at least the task we completed
      expect(data.tasks.length).toBeGreaterThan(0);
    });

    it('GET /api/tasks?priority=high - should filter by priority', async () => {
      const res = await fetch(`${baseUrl}/api/tasks?priority=high`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data.tasks)).toBe(true);
      data.tasks.forEach((task: any) => {
        expect(task.priority).toBe('high');
      });
    });

    it('GET /api/tasks?claimedBy=test-researcher - should filter by claimer', async () => {
      const res = await fetch(`${baseUrl}/api/tasks?claimedBy=test-researcher`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data.tasks)).toBe(true);
      data.tasks.forEach((task: any) => {
        expect(task.claimedBy).toBe('test-researcher');
      });
    });

    it('GET /api/tasks?search=integration - should filter by search', async () => {
      const res = await fetch(`${baseUrl}/api/tasks?search=integration`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(Array.isArray(data.tasks)).toBe(true);
    });
  });

  describe('Task Stats API', () => {
    it('GET /api/task-stats - should return task statistics', async () => {
      const res = await fetch(`${baseUrl}/api/task-stats`);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.stats).toBeDefined();
      expect(typeof data.stats.total).toBe('number');
      expect(data.stats.byStatus).toBeDefined();
      expect(data.stats.byPriority).toBeDefined();
    });
  });
});
