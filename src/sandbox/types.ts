/**
 * 沙箱模块 - 类型定义
 */

/**
 * 沙箱模式
 */
export type SandboxMode = 'docker' | 'podman' | 'chroot' | 'restricted';

/**
 * 沙箱配置
 */
export interface SandboxConfig {
  mode: SandboxMode;
  workspaceRoot: string;       // 工作目录根
  workspaceDir?: string;       // Agent 独立 workspace 目录
  allowedPaths: string[];      // 允许访问的主机路径
  networkAccess: boolean;      // 网络访问
  resourceLimits: {
    maxCpu?: number;           // CPU 限制 (%)
    maxMemory?: number;        // 内存限制 (MB)
    maxProcesses?: number;     // 最大进程数
    maxFileSize?: number;      // 最大文件大小 (MB)
  };
  allowedCommands?: string[];  // 允许的命令（白名单模式）
  deniedCommands?: string[];   // 拒绝的命令（黑名单模式）
}

/**
 * 沙箱实例
 */
export interface SandboxInstance {
  id: string;
  agentId: string;
  config: SandboxConfig;
  status: 'creating' | 'ready' | 'running' | 'stopped' | 'error';
  createdAt: number;
  containerId?: string;        // 容器 ID (Docker/Podman)
  workspacePath: string;       // 沙箱内工作路径
}

/**
 * 路径安全检查结果
 */
export interface PathCheckResult {
  allowed: boolean;
  reason?: string;
  normalizedPath: string;
}

/**
 * 命令安全检查结果
 */
export interface CommandCheckResult {
  allowed: boolean;
  reason?: string;
  requiresApproval: boolean;
}
