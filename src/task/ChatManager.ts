/**
 * ChatManager - 聊天管理器
 *
 * 支持群聊和私聊，支持@Agent 提及
 * 集成任务创建功能
 */

import { EventEmitter } from 'events';
import { ChatMessage } from './types';

export class ChatManager extends EventEmitter {
  private messages: ChatMessage[] = [];
  private maxMessages: number = 1000;
  private messageCounter: number = 0;

  /**
   * 生成消息 ID
   */
  private generateId(): string {
    this.messageCounter++;
    return `msg_${Date.now()}_${this.messageCounter}`;
  }

  /**
   * 解析消息中的@提及
   */
  private parseMentions(content: string): string[] {
    const mentions: string[] = [];
    // 匹配 @agent-id 格式（允许连字符和数字）
    const mentionRegex = /@([a-zA-Z0-9_-]+)/g;
    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
      mentions.push(match[1].toLowerCase());
    }
    return mentions;
  }

  /**
   * 发送消息
   */
  sendMessage(params: {
    from: string;
    content: string;
    to?: string;  // 私聊目标
    isFromUser: boolean;
    relatedTaskId?: string;
  }): ChatMessage {
    const { from, content, to, isFromUser, relatedTaskId } = params;
    const mentions = this.parseMentions(content);

    const message: ChatMessage = {
      id: this.generateId(),
      timestamp: Date.now(),
      from,
      to,
      content,
      mentions: mentions.length > 0 ? mentions : undefined,
      isFromUser,
      relatedTaskId,
    };

    // 存储消息
    this.messages.push(message);

    // 限制消息数量
    if (this.messages.length > this.maxMessages) {
      this.messages.shift();
    }

    // 触发事件
    this.emit('message', message);

    // 如果有@提及，触发特别事件
    if (mentions.length > 0) {
      this.emit('mention', { message, mentions });
    }

    return message;
  }

  /**
   * 获取消息列表
   */
  getMessages(filter?: {
    limit?: number;
    since?: number;
    from?: string;
    to?: string;
    withMentions?: string[];  // 包含特定@提及的消息
    isGlobal?: boolean;       // 只获取群聊消息（to 未指定）
  }): ChatMessage[] {
    let messages = [...this.messages];

    // 按时间范围筛选
    if (filter?.since) {
      messages = messages.filter(m => m.timestamp >= filter.since!);
    }

    // 按发送者筛选
    if (filter?.from) {
      messages = messages.filter(m => m.from === filter.from);
    }

    // 按接收者筛选（私聊）
    if (filter?.to) {
      messages = messages.filter(m => m.to === filter.to);
    }

    // 只获取群聊消息
    if (filter?.isGlobal) {
      messages = messages.filter(m => !m.to);
    }

    // 获取包含特定@提及的消息
    if (filter?.withMentions) {
      const mentions = filter.withMentions.map(m => m.toLowerCase());
      messages = messages.filter(m =>
        m.mentions?.some(mention => mentions.includes(mention))
      );
    }

    // 按时间排序（最新的在前）
    messages.sort((a, b) => b.timestamp - a.timestamp);

    // 限制数量
    if (filter?.limit) {
      messages = messages.slice(0, filter.limit);
    }

    return messages;
  }

  /**
   * 获取与某个 Agent 的私聊消息
   */
  getPrivateChat(agentId: string, limit: number = 50): ChatMessage[] {
    const messages = this.getMessages({ to: agentId, limit });
    const userToAgent = this.getMessages({ from: agentId, to: agentId, limit });
    return [...messages, ...userToAgent]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * 获取包含@Agent 的消息
   */
  getMentionedMessages(agentId: string, limit: number = 20): ChatMessage[] {
    return this.getMessages({ withMentions: [agentId], limit });
  }

  /**
   * 清空消息
   */
  clear(agentId?: string): void {
    if (agentId) {
      // 清空与特定 Agent 相关的消息
      this.messages = this.messages.filter(
        m => m.from !== agentId && m.to !== agentId && !m.mentions?.includes(agentId)
      );
    } else {
      // 清空所有消息
      this.messages = [];
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalMessages: number;
    globalMessages: number;
    privateMessages: number;
    mentionedMessages: number;
    byAgent: Map<string, number>;
  } {
    const byAgent = new Map<string, number>();
    let globalMessages = 0;
    let privateMessages = 0;
    let mentionedMessages = 0;

    for (const msg of this.messages) {
      byAgent.set(msg.from, (byAgent.get(msg.from) || 0) + 1);

      if (msg.to) {
        privateMessages++;
      } else {
        globalMessages++;
      }

      if (msg.mentions && msg.mentions.length > 0) {
        mentionedMessages++;
      }
    }

    return {
      totalMessages: this.messages.length,
      globalMessages,
      privateMessages,
      mentionedMessages,
      byAgent,
    };
  }
}
