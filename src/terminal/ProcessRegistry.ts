/**
 * ProcessRegistry - 进程注册表
 *
 * 追踪所有终端会话对应的进程状态
 * 提供进程查询、统计和清理功能
 */

import { TerminalSession } from './types';
import { EventEmitter } from 'events';

/**
 * 进程信息
 */
export interface ProcessInfo {
  pid: number;
  sessionId: string;
  agentId: string;
  command: string;
  cwd: string;
  startedAt: number;
  status: 'running' | 'exited' | 'killed';
  exitCode?: number;
  cpuTime?: number;
  memoryUsage?: number;
}

export class ProcessRegistry extends EventEmitter {
  private processes: Map<number, ProcessInfo> = new Map();
  private sessionToPid: Map<string, number> = new Map();
  private history: ProcessInfo[] = [];
  private readonly maxHistorySize: number;

  constructor(options: { maxHistorySize?: number } = {}) {
    super();
    this.maxHistorySize = options.maxHistorySize ?? 1000;
  }

  /**
   * 注册进程
   */
  register(session: TerminalSession): void {
    const pid = session.pty.pid ?? 0;

    const info: ProcessInfo = {
      pid,
      sessionId: session.id,
      agentId: session.agentId,
      command: session.shell,
      cwd: session.cwd,
      startedAt: session.createdAt,
      status: 'running',
    };

    this.processes.set(pid, info);
    this.sessionToPid.set(session.id, pid);
    this.emit('process:started', info);
  }

  /**
   * 标记进程退出
   */
  markExited(sessionId: string, exitCode?: number): void {
    const pid = this.sessionToPid.get(sessionId);
    if (!pid) return;

    const info = this.processes.get(pid);
    if (!info) return;

    info.status = 'exited';
    info.exitCode = exitCode;

    this.processes.delete(pid);
    this.sessionToPid.delete(sessionId);
    this.history.push(info);
    this.emit('process:exited', info);

    this.cleanupHistory();
  }

  /**
   * 标记进程被杀死
   */
  markKilled(sessionId: string): void {
    const pid = this.sessionToPid.get(sessionId);
    if (!pid) return;

    const info = this.processes.get(pid);
    if (!info) return;

    info.status = 'killed';

    this.processes.delete(pid);
    this.sessionToPid.delete(sessionId);
    this.history.push(info);
    this.emit('process:killed', info);

    this.cleanupHistory();
  }

  /**
   * 获取活跃进程
   */
  getActiveProcesses(): ProcessInfo[] {
    return Array.from(this.processes.values());
  }

  /**
   * 根据 Agent ID 获取进程
   */
  getByAgentId(agentId: string): ProcessInfo[] {
    return Array.from(this.processes.values())
      .filter(p => p.agentId === agentId);
  }

  /**
   * 根据会话 ID 获取进程
   */
  getBySessionId(sessionId: string): ProcessInfo | undefined {
    const pid = this.sessionToPid.get(sessionId);
    if (!pid) return undefined;
    return this.processes.get(pid);
  }

  /**
   * 获取历史进程
   */
  getHistory(limit: number = 100): ProcessInfo[] {
    return this.history.slice(-limit);
  }

  /**
   * 获取进程统计
   */
  getStats(): {
    active: number;
    exited: number;
    killed: number;
  } {
    const active = this.processes.size;
    const exited = this.history.filter(p => p.status === 'exited').length;
    const killed = this.history.filter(p => p.status === 'killed').length;

    return { active, exited, killed };
  }

  /**
   * 清理历史记录
   */
  cleanupHistory(): void {
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }
  }

  /**
   * 清理超过指定时间的历史记录
   */
  cleanupHistoryByAge(maxAge: number = 3600000): void {
    const now = Date.now();
    this.history = this.history.filter(p => now - p.startedAt < maxAge);
  }
}
