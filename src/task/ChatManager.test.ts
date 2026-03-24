/**
 * ChatManager 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ChatManager } from './ChatManager';

describe('ChatManager', () => {
  let chatManager: ChatManager;

  beforeEach(() => {
    chatManager = new ChatManager();
  });

  describe('sendMessage()', () => {
    it('should send a global message successfully', () => {
      const message = chatManager.sendMessage({
        from: 'user',
        content: 'Hello everyone',
        isFromUser: true,
      });

      expect(message.id).toBeDefined();
      expect(message.timestamp).toBeDefined();
      expect(message.from).toBe('user');
      expect(message.content).toBe('Hello everyone');
      expect(message.isFromUser).toBe(true);
      expect(message.to).toBeUndefined();
    });

    it('should send a private message', () => {
      const message = chatManager.sendMessage({
        from: 'user',
        content: 'Hi there',
        to: 'agent-1',
        isFromUser: true,
      });

      expect(message.to).toBe('agent-1');
    });

    it('should parse @mentions from content', () => {
      const message = chatManager.sendMessage({
        from: 'user',
        content: 'Hey @researcher-1 and @coder-1, please help',
        isFromUser: true,
      });

      expect(message.mentions).toContain('researcher-1');
      expect(message.mentions).toContain('coder-1');
      expect(message.mentions?.length).toBe(2);
    });

    it('should handle case-insensitive mentions', () => {
      const message = chatManager.sendMessage({
        from: 'user',
        content: 'Hello @Researcher-1',
        isFromUser: true,
      });

      expect(message.mentions).toContain('researcher-1');
    });

    it('should emit message event', () => {
      const emittedMessages: any[] = [];
      chatManager.on('message', (msg) => emittedMessages.push(msg));

      chatManager.sendMessage({
        from: 'agent-1',
        content: 'Task completed',
        isFromUser: false,
      });

      expect(emittedMessages).toHaveLength(1);
      expect(emittedMessages[0].from).toBe('agent-1');
    });

    it('should emit mention event when message contains @mentions', () => {
      const emittedMentions: any[] = [];
      chatManager.on('mention', (data) => emittedMentions.push(data));

      chatManager.sendMessage({
        from: 'user',
        content: '@agent-1 please help',
        isFromUser: true,
      });

      expect(emittedMentions).toHaveLength(1);
      expect(emittedMentions[0].mentions).toContain('agent-1');
    });

    it('should include relatedTaskId when provided', () => {
      const message = chatManager.sendMessage({
        from: 'user',
        content: 'Update on task',
        isFromUser: true,
        relatedTaskId: 'task-123',
      });

      expect(message.relatedTaskId).toBe('task-123');
    });
  });

  describe('getMessages()', () => {
    beforeEach(() => {
      // Add test messages
      chatManager.sendMessage({ from: 'user', content: 'Hello', isFromUser: true });
      chatManager.sendMessage({ from: 'agent-1', content: 'Hi there', isFromUser: false });
      chatManager.sendMessage({ from: 'user', content: '@agent-1 help', isFromUser: true, to: 'agent-1' });
      chatManager.sendMessage({ from: 'agent-2', content: '@agent-1 ping', isFromUser: false });
    });

    it('should get all messages when no filter', () => {
      const messages = chatManager.getMessages();
      expect(messages.length).toBe(4);
    });

    it('should limit results', () => {
      const messages = chatManager.getMessages({ limit: 2 });
      expect(messages.length).toBe(2);
    });

    it('should filter by since timestamp', () => {
      const now = Date.now();
      const messages = chatManager.getMessages({ since: now - 1000 });
      expect(messages.length).toBe(4);

      const oldMessages = chatManager.getMessages({ since: now + 10000 });
      expect(oldMessages.length).toBe(0);
    });

    it('should filter by sender', () => {
      const messages = chatManager.getMessages({ from: 'user' });
      expect(messages.length).toBe(2);
      messages.forEach(m => expect(m.from).toBe('user'));
    });

    it('should filter by recipient (private messages)', () => {
      const messages = chatManager.getMessages({ to: 'agent-1' });
      expect(messages.length).toBe(1);
      expect(messages[0].to).toBe('agent-1');
    });

    it('should get only global messages', () => {
      const messages = chatManager.getMessages({ isGlobal: true });
      // All messages without 'to' field are global
      expect(messages.length).toBeGreaterThanOrEqual(2);
      messages.forEach(m => expect(m.to).toBeUndefined());
    });

    it('should filter by mentions', () => {
      const messages = chatManager.getMessages({ withMentions: ['agent-1'] });
      expect(messages.length).toBe(2);
    });

    it('should return messages sorted by timestamp (newest first)', () => {
      const messages = chatManager.getMessages();
      for (let i = 1; i < messages.length; i++) {
        expect(messages[i - 1].timestamp).toBeGreaterThanOrEqual(messages[i].timestamp);
      }
    });
  });

  describe('getPrivateChat()', () => {
    beforeEach(() => {
      chatManager.sendMessage({ from: 'user', content: 'Hi agent-1', isFromUser: true, to: 'agent-1' });
      chatManager.sendMessage({ from: 'agent-1', content: 'Hello user', isFromUser: false, to: 'user' });
      chatManager.sendMessage({ from: 'user', content: 'Global message', isFromUser: true });
    });

    it('should get private chat messages with specific agent', () => {
      const messages = chatManager.getPrivateChat('agent-1');
      // Should have at least 1 message (the one to agent-1)
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });

    it('should limit private chat results', () => {
      const messages = chatManager.getPrivateChat('agent-1', 1);
      expect(messages.length).toBe(1);
    });
  });

  describe('getMentionedMessages()', () => {
    beforeEach(() => {
      chatManager.sendMessage({ from: 'user', content: '@agent-1 help', isFromUser: true });
      chatManager.sendMessage({ from: 'agent-2', content: '@agent-1 ping', isFromUser: false });
      chatManager.sendMessage({ from: 'user', content: 'No mention', isFromUser: true });
    });

    it('should get messages mentioning specific agent', () => {
      const messages = chatManager.getMentionedMessages('agent-1');
      expect(messages.length).toBe(2);
      messages.forEach(m => {
        expect(m.mentions).toContain('agent-1');
      });
    });

    it('should limit mentioned messages', () => {
      const messages = chatManager.getMentionedMessages('agent-1', 1);
      expect(messages.length).toBe(1);
    });
  });

  describe('clear()', () => {
    beforeEach(() => {
      chatManager.sendMessage({ from: 'user', content: 'Msg 1', isFromUser: true });
      chatManager.sendMessage({ from: 'agent-1', content: 'Msg 2', isFromUser: false });
      chatManager.sendMessage({ from: 'agent-2', content: '@agent-1', isFromUser: false, mentions: ['agent-1'] });
    });

    it('should clear all messages', () => {
      chatManager.clear();
      const messages = chatManager.getMessages();
      expect(messages.length).toBe(0);
    });

    it('should clear messages related to specific agent', () => {
      chatManager.clear('agent-1');
      const messages = chatManager.getMessages();
      // Should remove messages from agent-1, to agent-1, or mentioning agent-1
      expect(messages.length).toBeLessThan(3);
    });
  });

  describe('getStats()', () => {
    beforeEach(() => {
      chatManager.sendMessage({ from: 'user', content: 'Global 1', isFromUser: true });
      chatManager.sendMessage({ from: 'user', content: 'Private', isFromUser: true, to: 'agent-1' });
      chatManager.sendMessage({ from: 'agent-1', content: 'Reply', isFromUser: false });
      chatManager.sendMessage({ from: 'agent-1', content: '@user mention', isFromUser: false, mentions: ['user'] });
    });

    it('should return correct statistics', () => {
      const stats = chatManager.getStats();

      expect(stats.totalMessages).toBe(4);
      expect(stats.globalMessages).toBe(3);
      expect(stats.privateMessages).toBe(1);
      expect(stats.mentionedMessages).toBe(1);
      expect(stats.byAgent.get('user')).toBe(2);
      expect(stats.byAgent.get('agent-1')).toBe(2);
    });
  });

  describe('message ID generation', () => {
    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const msg = chatManager.sendMessage({
          from: 'user',
          content: `Message ${i}`,
          isFromUser: true,
        });
        ids.add(msg.id);
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('max messages limit', () => {
    it('should enforce max messages limit', () => {
      // Set maxMessages to small number for testing
      (chatManager as any).maxMessages = 10;

      for (let i = 0; i < 20; i++) {
        chatManager.sendMessage({
          from: 'user',
          content: `Message ${i}`,
          isFromUser: true,
        });
      }

      const messages = chatManager.getMessages();
      expect(messages.length).toBe(10);
    });
  });
});
