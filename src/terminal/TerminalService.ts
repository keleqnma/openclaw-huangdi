/**
 * TerminalService - 终端服务
 *
 * 基于 node-pty 实现跨平台的 PTY 终端管理
 * 支持 Windows (PowerShell) 和 Unix (bash/zsh)
 */

import * as pty from '@lydell/node-pty';
import { EventEmitter } from 'events';
import {
  TerminalSession,
  TerminalOutputEvent,
  TerminalSize,
  ShellConfig,
} from './types';
import { ActionLogger } from '../task/ActionLogger';

const DEFAULT_SHELL_CONFIG: ShellConfig = {
  windows: {
    shell: 'pwsh.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command'],
  },
  unix: {
    shell: process.env.SHELL || '/bin/sh',
    args: ['-c'],
  },
};

export class TerminalService extends EventEmitter {
  private sessions: Map<string, TerminalSession> = new Map();
  private shellConfig: ShellConfig;
  public actionLogger?: ActionLogger;

  constructor(options: { shellConfig?: ShellConfig } = {}) {
    super();
    this.shellConfig = options.shellConfig ?? DEFAULT_SHELL_CONFIG;
  }

  /**
   * 获取当前平台的 Shell 配置
   */
  private getPlatformShell(): { shell: string; args: string[] } {
    const platform = process.platform;
    if (platform === 'win32') {
      // Windows: 尝试 PowerShell 7，回退到 PowerShell 5.1
      const pwsh7 = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
      const fs = require('fs');
      if (fs.existsSync(pwsh7)) {
        return { shell: pwsh7, args: ['-NoProfile', '-NonInteractive', '-Command'] };
      }
      return this.shellConfig.windows;
    }
    return this.shellConfig.unix;
  }

  /**
   * 创建终端会话
   */
  createSession(
    agentId: string,
    options: {
      cwd?: string;
      env?: Record<string, string>;
      rows?: number;
      cols?: number;
      maxBufferLength?: number;
    } = {}
  ): TerminalSession {
    const sessionId = this.generateSessionId();
    const { shell, args } = this.getPlatformShell();
    const rows = options.rows ?? 24;
    const cols = options.cols ?? 80;

    // 创建 PTY 实例
    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      cols,
      rows,
    });

    const session: TerminalSession = {
      id: sessionId,
      agentId,
      pty: ptyProcess,
      cwd: options.cwd ?? process.cwd(),
      shell,
      rows,
      cols,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      status: 'active',
      outputBuffer: [],
      maxBufferLength: options.maxBufferLength ?? 1000,
    };

    // 绑定 PTY 事件
    ptyProcess.onData((data: string) => {
      session.lastActivityAt = Date.now();
      session.outputBuffer.push(data);

      // 维护缓冲大小
      if (session.outputBuffer.length > session.maxBufferLength) {
        session.outputBuffer.shift();
      }

      this.emit('output', {
        sessionId,
        type: 'data',
        data,
        timestamp: Date.now(),
      } as TerminalOutputEvent);
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      session.status = 'exited';
      session.exitCode = exitCode;
      this.emit('session:exited', session);
      this.emit('output', {
        sessionId,
        type: 'exit',
        data: `Process exited with code ${exitCode}`,
        timestamp: Date.now(),
      } as TerminalOutputEvent);
    });

    this.sessions.set(sessionId, session);
    this.emit('session:created', session);

    // 记录 session_created 动作
    if (this.actionLogger) {
      this.actionLogger.log({
        agentId: session.agentId,
        sessionId,
        actionType: 'status_change',
        payload: { status: 'active', event: 'session_created' },
        result: 'success',
      });
    }

    return session;
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 向终端写入数据
   */
  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.status !== 'active') {
      throw new Error(`Session ${sessionId} is not active`);
    }

    session.lastActivityAt = Date.now();

    // 记录 command_exec 动作
    if (this.actionLogger) {
      this.actionLogger.log({
        agentId: session.agentId,
        sessionId,
        actionType: 'command_exec',
        payload: { command: data },
        result: 'pending',
      });
    }

    session.pty.write(data);
  }

  /**
   * 调整终端尺寸
   */
  resize(sessionId: string, size: TerminalSize): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    session.rows = size.rows;
    session.cols = size.cols;
    session.pty.resize(size.cols, size.rows);
  }

  /**
   * 获取会话输出（全量）
   */
  getOutput(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.outputBuffer.join('');
  }

  /**
   * 获取会话输出（最后 N 行）
   */
  getTail(sessionId: string, lines: number = 100): string {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const output = session.outputBuffer.join('');
    const allLines = output.split('\n');
    return allLines.slice(-lines).join('\n');
  }

  /**
   * 关闭会话
   */
  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // 记录 session_closed 动作
    if (this.actionLogger) {
      this.actionLogger.log({
        agentId: session.agentId,
        sessionId,
        actionType: 'status_change',
        payload: { status: 'closed', event: 'session_closed' },
        result: 'success',
      });
    }

    try {
      session.pty.kill();
    } catch (e) {
      // Ignore kill errors
    }

    this.sessions.delete(sessionId);
  }

  /**
   * 关闭所有会话
   */
  closeAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.closeSession(sessionId);
    }
  }

  /**
   * 获取所有活跃会话
   */
  getActiveSessions(): TerminalSession[] {
    return Array.from(this.sessions.values()).filter(s => s.status === 'active');
  }

  /**
   * 根据 Agent ID 获取会话
   */
  getByAgentId(agentId: string): TerminalSession[] {
    return Array.from(this.sessions.values()).filter(s => s.agentId === agentId);
  }

  /**
   * 生成会话 ID
   */
  private generateSessionId(): string {
    return `term_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}
