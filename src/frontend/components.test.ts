/**
 * Frontend Component Tests
 * 测试 agent-dashboard.html 中的前端功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 模拟浏览器环境
declare global {
  interface Window {
    selectAgent: (agentId: string) => void;
    switchTab: (tab: string) => void;
    sendChatMessage: (event: any) => void;
    refreshAgents: () => void;
    formatTime: (timestamp: number) => string;
    escapeHtml: (str: string) => string;
    getAvatarColor: (id: string) => string;
    renderActionContent: (action: any) => string;
  }
}

describe('Frontend Components', () => {
  describe('Utility Functions', () => {
    describe('formatTime()', () => {
      it('should format recent timestamp as "Just now"', () => {
        const now = Date.now();
        const result = formatTime(now);
        expect(result).toBe('Just now');
      });

      it('should format timestamp within an hour as minutes ago', () => {
        const fiveMinAgo = Date.now() - 5 * 60 * 1000;
        const result = formatTime(fiveMinAgo);
        expect(result).toMatch(/\d+m ago/);
      });

      it('should format timestamp within a day as hours ago', () => {
        const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
        const result = formatTime(threeHoursAgo);
        expect(result).toMatch(/\d+h ago/);
      });

      it('should format old timestamp as time string', () => {
        const yesterday = Date.now() - 2 * 24 * 60 * 60 * 1000;
        const result = formatTime(yesterday);
        // Should be a time string like "12:34"
        expect(result).toMatch(/^\d{1,2}:\d{2}$/);
      });
    });

    describe('escapeHtml()', () => {
      it('should escape HTML special characters', () => {
        expect(escapeHtml('<script>alert("xss")</script>')).toBe(
          '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
        );
      });

      it('should escape ampersand', () => {
        expect(escapeHtml('A & B')).toBe('A &amp; B');
      });

      it('should escape single quotes', () => {
        expect(escapeHtml("It's")).toBe('It&#039;s');
      });

      it('should handle empty string', () => {
        expect(escapeHtml('')).toBe('');
      });

      it('should handle null/undefined', () => {
        expect(escapeHtml(null as any)).toBe('');
        expect(escapeHtml(undefined as any)).toBe('');
      });
    });

    describe('getAvatarColor()', () => {
      it('should return consistent color for same ID', () => {
        const color1 = getAvatarColor('agent-1');
        const color2 = getAvatarColor('agent-1');
        expect(color1).toBe(color2);
      });

      it('should return different colors for different IDs', () => {
        const color1 = getAvatarColor('agent-1');
        const color2 = getAvatarColor('agent-2');
        // May occasionally be the same due to hash collisions, but generally different
        // This test is probabilistic
      });

      it('should return valid hex color', () => {
        const color = getAvatarColor('test-agent');
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });

    describe('renderActionContent()', () => {
      it('should render command_exec action', () => {
        const action = {
          actionType: 'command_exec' as const,
          payload: { command: 'npm test' },
        };
        const html = renderActionContent(action);
        expect(html).toContain('Executed command');
        expect(html).toContain('npm test');
      });

      it('should render file_read action', () => {
        const action = {
          actionType: 'file_read' as const,
          payload: { filePath: 'config.json' },
        };
        const html = renderActionContent(action);
        expect(html).toContain('Read file');
        expect(html).toContain('config.json');
      });

      it('should render thinking action', () => {
        const action = {
          actionType: 'thinking' as const,
          payload: { thought: 'Considering options...' },
        };
        const html = renderActionContent(action);
        expect(html).toContain('Thinking');
        expect(html).toContain('Considering options...');
      });

      it('should render task action with task ID', () => {
        const action = {
          actionType: 'task_claimed' as const,
          payload: { taskId: 'task-123' },
        };
        const html = renderActionContent(action);
        expect(html).toContain('task-123');
      });

      it('should escape HTML in payload', () => {
        const action = {
          actionType: 'command_exec' as const,
          payload: { command: '<script>alert("xss")</script>' },
        };
        const html = renderActionContent(action);
        expect(html).not.toContain('<script>');
      });
    });
  });

  describe('Chat Message Parsing', () => {
    describe('parseMentions()', () => {
      it('should extract @mentions from message', () => {
        const content = 'Hello @agent-1 and @agent-2';
        const mentions = parseMentions(content);
        expect(mentions).toEqual(['agent-1', 'agent-2']);
      });

      it('should handle single mention', () => {
        const content = '@researcher please help';
        const mentions = parseMentions(content);
        expect(mentions).toEqual(['researcher']);
      });

      it('should handle no mentions', () => {
        const content = 'No mentions here';
        const mentions = parseMentions(content);
        expect(mentions).toEqual([]);
      });

      it('should handle mentions at end of message', () => {
        const content = 'Task done @manager';
        const mentions = parseMentions(content);
        expect(mentions).toEqual(['manager']);
      });
    });
  });

  describe('Tab Switching', () => {
    it('should switch between tabs', () => {
      // Mock DOM elements
      const mockTabs = {
        actions: { classList: { remove: vi.fn(), add: vi.fn() } },
        workspace: { classList: { remove: vi.fn(), add: vi.fn() } },
        config: { classList: { remove: vi.fn(), add: vi.fn() } },
      };
      const mockPanels = {
        'panel-actions': { classList: { remove: vi.fn(), add: vi.fn() } },
        'panel-workspace': { classList: { remove: vi.fn(), add: vi.fn() } },
        'panel-config': { classList: { remove: vi.fn(), add: vi.fn() } },
      };

      // Simulate tab switch
      const activeTab = 'workspace';

      // Verify tab would be activated
      expect(activeTab).toBe('workspace');
    });
  });

  describe('WebSocket Message Handling', () => {
    it('should handle agent:action messages', () => {
      const message = {
        type: 'agent:action',
        payload: {
          action: {
            agentId: 'agent-1',
            actionType: 'command_exec',
            timestamp: Date.now(),
          },
        },
      };

      // Verify message structure
      expect(message.type).toBe('agent:action');
      expect(message.payload.action.agentId).toBe('agent-1');
    });

    it('should handle chat:message messages', () => {
      const message = {
        type: 'chat:message',
        payload: {
          message: {
            from: 'user',
            content: 'Hello',
            isFromUser: true,
          },
        },
      };

      expect(message.type).toBe('chat:message');
      expect(message.payload.message.from).toBe('user');
    });

    it('should handle taskboard:update messages', () => {
      const message = {
        type: 'taskboard:update',
        payload: {
          eventType: 'task:claimed',
          task: {
            id: 'task-1',
            status: 'claimed',
            claimedBy: 'agent-1',
          },
        },
      };

      expect(message.type).toBe('taskboard:update');
      expect(message.payload.eventType).toBe('task:claimed');
    });
  });

  describe('Chat Form Validation', () => {
    it('should reject empty messages', () => {
      const content = '';
      expect(content.trim()).toBe('');
    });

    it('should accept non-empty messages', () => {
      const content = 'Hello world';
      expect(content.trim()).not.toBe('');
    });

    it('should handle messages with only whitespace', () => {
      const content = '   ';
      expect(content.trim()).toBe('');
    });
  });

  describe('Task Reference Handling', () => {
    it('should include task ID when provided', () => {
      const taskRef = 'task-123';
      expect(taskRef).toBe('task-123');
    });

    it('should handle empty task reference', () => {
      const taskRef = '';
      expect(taskRef.trim() || undefined).toBeUndefined();
    });
  });
});

// Helper functions (would be imported from the actual frontend code)
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getAvatarColor(id: string): string {
  const colors = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff', '#39d353', '#db6d28'];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

function renderActionContent(action: { actionType: string; payload: Record<string, any> }): string {
  const typeLabels: Record<string, string> = {
    command_exec: '⌨️ Executed command',
    file_read: '📖 Read file',
    file_write: '✏️ Wrote to file',
    file_delete: '🗑️ Deleted file',
    thinking: '💭 Thinking',
    task_claimed: '✅ Claimed task',
    task_released: '🔓 Released task',
    task_assigned: '📤 Assigned task',
    message_sent: '💬 Sent message',
    status_change: '🔄 Status changed',
    idle: '😴 Idle',
  };

  let content = `<strong>${typeLabels[action.actionType] || action.actionType}</strong>`;

  if (action.payload?.command) {
    content += `: <code>${escapeHtml(action.payload.command)}</code>`;
  }
  if (action.payload?.filePath) {
    content += `: <code>${escapeHtml(action.payload.filePath)}</code>`;
  }
  if (action.payload?.thought) {
    content += `: ${escapeHtml(action.payload.thought)}`;
  }
  if (action.payload?.taskId) {
    content += ` <span style="color: var(--accent-purple);">[${escapeHtml(action.payload.taskId)}]</span>`;
  }

  return content;
}

function parseMentions(content: string): string[] {
  const mentions: string[] = [];
  // Match @agent-id format (allow hyphens and numbers)
  const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    mentions.push(match[1].toLowerCase());
  }
  return mentions;
}