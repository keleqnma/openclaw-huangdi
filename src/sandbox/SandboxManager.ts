/**
 * SandboxManager - 沙箱管理器
 *
 * 管理沙箱实例的生命周期，支持 Docker/Podman/Restricted 模式
 */

import { exec } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SandboxConfig, SandboxInstance } from './types';
import { PathSecurity } from './PathSecurity';
import { CommandSecurity } from './CommandSecurity';
import { ActionLogger } from '../task/ActionLogger';

export class SandboxManager extends EventEmitter {
  private sandboxes: Map<string, SandboxInstance> = new Map();
  private defaultConfig: SandboxConfig;
  public actionLogger?: ActionLogger;

  constructor(defaultConfig: SandboxConfig) {
    super();
    this.defaultConfig = defaultConfig;
  }

  /**
   * 创建沙箱
   */
  async create(agentId: string, overrideConfig?: Partial<SandboxConfig>): Promise<SandboxInstance> {
    const config: SandboxConfig = { ...this.defaultConfig, ...overrideConfig };
    const instanceId = `sandbox_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const instance: SandboxInstance = {
      id: instanceId,
      agentId,
      config,
      status: 'creating',
      createdAt: Date.now(),
      workspacePath: this.resolveWorkspacePath(instanceId, config),
    };

    this.sandboxes.set(instanceId, instance);

    try {
      // 根据模式创建沙箱
      if (config.mode === 'docker' || config.mode === 'podman') {
        await this.createContainer(instance);
      } else if (config.mode === 'chroot') {
        await this.createChroot(instance);
      } else if (config.mode === 'restricted') {
        await this.setupRestricted(instance);
      }

      instance.status = 'ready';
      this.emit('sandbox:created', instance);

      // 记录 sandbox_created 动作
      if (this.actionLogger) {
        this.actionLogger.log({
          agentId: instance.agentId,
          actionType: 'status_change',
          payload: { status: 'ready', event: 'sandbox_created', workspacePath: instance.workspacePath },
          result: 'success',
        });
      }

      return instance;
    } catch (error) {
      instance.status = 'error';
      this.emit('sandbox:error', { instanceId, error: error as Error });
      throw error;
    }
  }

  /**
   * 创建 Docker/Podman 容器
   */
  private async createContainer(instance: SandboxInstance): Promise<void> {
    const { config } = instance;
    const runtime = config.mode; // 'docker' or 'podman'

    // 确保工作目录存在
    await fs.mkdir(instance.workspacePath, { recursive: true });

    // 构建 docker run 命令
    const args: string[] = [
      'run',
      '-d',  // 后台运行
      '--rm',  // 退出后自动清理
      '-w', instance.workspacePath,
    ];

    // CPU 限制
    if (config.resourceLimits.maxCpu) {
      args.push('--cpus', config.resourceLimits.maxCpu.toString());
    }

    // 内存限制
    if (config.resourceLimits.maxMemory) {
      args.push('-m', `${config.resourceLimits.maxMemory}m`);
    }

    // 进程数限制
    if (config.resourceLimits.maxProcesses) {
      args.push('--pids-limit', config.resourceLimits.maxProcesses.toString());
    }

    // 网络访问
    if (!config.networkAccess) {
      args.push('--network', 'none');
    }

    // 挂载卷（只读或指定路径）
    args.push('-v', `${config.workspaceRoot}:${instance.workspacePath}:rw`);
    for (const allowedPath of config.allowedPaths) {
      args.push('-v', `${allowedPath}:${allowedPath}:ro`);
    }

    // 使用基础镜像
    args.push('alpine:latest', 'tail', '-f', '/dev/null');

    return new Promise((resolve, reject) => {
      exec(`${runtime} ${args.join(' ')}`, (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          instance.containerId = stdout.trim();
          instance.status = 'running';
          resolve();
        }
      });
    });
  }

  /**
   * 创建 chroot 环境（简化版）
   */
  private async createChroot(instance: SandboxInstance): Promise<void> {
    // chroot 需要 root 权限，这里只做目录准备
    await fs.mkdir(instance.workspacePath, { recursive: true });
    instance.status = 'running';
  }

  /**
   * 设置受限模式（无容器）
   */
  private async setupRestricted(instance: SandboxInstance): Promise<void> {
    await fs.mkdir(instance.workspacePath, { recursive: true });
    instance.status = 'running';
  }

  /**
   * 解析工作目录路径
   */
  private resolveWorkspacePath(instanceId: string, config: SandboxConfig): string {
    return path.join(config.workspaceRoot, instanceId);
  }

  /**
   * 获取沙箱实例
   */
  getInstance(instanceId: string): SandboxInstance | undefined {
    return this.sandboxes.get(instanceId);
  }

  /**
   * 根据 Agent ID 获取沙箱
   */
  getByAgentId(agentId: string): SandboxInstance | undefined {
    return Array.from(this.sandboxes.values()).find(s => s.agentId === agentId);
  }

  /**
   * 获取所有沙箱
   */
  getAll(): SandboxInstance[] {
    return Array.from(this.sandboxes.values());
  }

  /**
   * 获取活跃沙箱
   */
  getActive(): SandboxInstance[] {
    return Array.from(this.sandboxes.values()).filter(s => s.status === 'running' || s.status === 'ready');
  }

  /**
   * 停止沙箱
   */
  async stop(instanceId: string): Promise<void> {
    const instance = this.sandboxes.get(instanceId);
    if (!instance) return;

    // 记录 sandbox_stopped 动作
    if (this.actionLogger) {
      this.actionLogger.log({
        agentId: instance.agentId,
        actionType: 'status_change',
        payload: { status: 'stopped', event: 'sandbox_stopped' },
        result: 'success',
      });
    }

    if (instance.containerId && (instance.config.mode === 'docker' || instance.config.mode === 'podman')) {
      await new Promise<void>((resolve) => {
        exec(`${instance.config.mode} stop ${instance.containerId}`, () => {
          resolve();
        });
      });
    }

    instance.status = 'stopped';
    this.sandboxes.delete(instanceId);
    this.emit('sandbox:stopped', instance);
  }

  /**
   * 停止所有沙箱
   */
  async stopAll(): Promise<void> {
    const promises = Array.from(this.sandboxes.keys()).map(id => this.stop(id));
    await Promise.all(promises);
  }

  /**
   * 获取路径安全检查器
   */
  getPathSecurity(instanceId: string): PathSecurity | null {
    const instance = this.sandboxes.get(instanceId);
    if (!instance) return null;

    return new PathSecurity({
      workspaceRoot: instance.config.workspaceRoot,
      allowedPaths: instance.config.allowedPaths,
    });
  }

  /**
   * 获取命令安全检查器
   */
  getCommandSecurity(instanceId: string): CommandSecurity | null {
    const instance = this.sandboxes.get(instanceId);
    if (!instance) return null;

    return new CommandSecurity({
      useAllowlist: instance.config.allowedCommands !== undefined,
      allowedCommands: instance.config.allowedCommands,
      deniedCommands: instance.config.deniedCommands,
    });
  }

  /**
   * 验证命令在沙箱中是否允许执行
   */
  validateCommand(instanceId: string, command: string): { allowed: boolean; reason?: string } {
    const security = this.getCommandSecurity(instanceId);
    if (!security) {
      return { allowed: true }; // 没有安全配置，默认允许
    }

    const result = security.checkCommand(command);
    return {
      allowed: result.allowed,
      reason: result.reason,
    };
  }

  /**
   * 验证路径在沙箱中是否允许访问
   */
  validatePath(instanceId: string, filePath: string): { allowed: boolean; reason?: string; normalizedPath?: string } {
    const security = this.getPathSecurity(instanceId);
    if (!security) {
      return { allowed: true, normalizedPath: filePath };
    }

    const result = security.checkPath(filePath);
    return {
      allowed: result.allowed,
      reason: result.reason,
      normalizedPath: result.normalizedPath,
    };
  }

  /**
   * 读取文件（带 action 记录）
   */
  async readFile(instanceId: string, filePath: string, agentId?: string): Promise<string> {
    const instance = this.sandboxes.get(instanceId);
    if (!instance) throw new Error('Sandbox not found');

    // 验证路径
    const pathResult = this.validatePath(instanceId, filePath);
    if (!pathResult.allowed) {
      throw new Error(`Path not allowed: ${pathResult.reason}`);
    }

    const fullPath = pathResult.normalizedPath || filePath;
    const content = await fs.readFile(fullPath, 'utf-8');

    // 记录 file_read 动作
    if (this.actionLogger) {
      this.actionLogger.log({
        agentId: agentId || instance.agentId,
        actionType: 'file_read',
        payload: { filePath: fullPath },
        result: 'success',
      });
    }

    return content;
  }

  /**
   * 写入文件（带 action 记录）
   */
  async writeFile(instanceId: string, filePath: string, content: string, agentId?: string): Promise<void> {
    const instance = this.sandboxes.get(instanceId);
    if (!instance) throw new Error('Sandbox not found');

    // 验证路径
    const pathResult = this.validatePath(instanceId, filePath);
    if (!pathResult.allowed) {
      throw new Error(`Path not allowed: ${pathResult.reason}`);
    }

    const fullPath = pathResult.normalizedPath || filePath;

    // 确保目录存在
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');

    // 记录 file_write 动作
    if (this.actionLogger) {
      this.actionLogger.log({
        agentId: agentId || instance.agentId,
        actionType: 'file_write',
        payload: { filePath: fullPath, contentLength: content.length },
        result: 'success',
      });
    }
  }

  /**
   * 删除文件（带 action 记录）
   */
  async deleteFile(instanceId: string, filePath: string, agentId?: string): Promise<void> {
    const instance = this.sandboxes.get(instanceId);
    if (!instance) throw new Error('Sandbox not found');

    // 验证路径
    const pathResult = this.validatePath(instanceId, filePath);
    if (!pathResult.allowed) {
      throw new Error(`Path not allowed: ${pathResult.reason}`);
    }

    const fullPath = pathResult.normalizedPath || filePath;
    await fs.unlink(fullPath);

    // 记录 file_delete 动作
    if (this.actionLogger) {
      this.actionLogger.log({
        agentId: agentId || instance.agentId,
        actionType: 'file_delete',
        payload: { filePath: fullPath },
        result: 'success',
      });
    }
  }

  /**
   * 列出工作目录文件（用于前端展示）
   */
  async listWorkspace(instanceId: string): Promise<{ name: string; type: 'file' | 'directory'; size?: number }[]> {
    const instance = this.sandboxes.get(instanceId);
    if (!instance) throw new Error('Sandbox not found');

    const workspacePath = instance.workspacePath;
    const entries = await fs.readdir(workspacePath, { withFileTypes: true });

    const result: { name: string; type: 'file' | 'directory'; size?: number }[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        result.push({
          name: entry.name,
          type: 'directory',
        });
      } else {
        const stat = await fs.stat(path.join(workspacePath, entry.name));
        result.push({
          name: entry.name,
          type: 'file',
          size: stat.size,
        });
      }
    }

    return result;
  }
}
