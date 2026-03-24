/**
 * CommandSecurity - 命令安全检查
 *
 * 检测危险命令，支持白名单和黑名单模式
 */

import { CommandCheckResult } from './types';

/**
 * 危险命令模式（正则匹配）
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  /^rm\s+(-[rf]+\s+)?\/$/,           // rm -rf /
  /^rm\s+(-[rf]+\s+)?\*$/,           // rm -rf *
  /^dd\s+.*of=\/dev\/(disk|hd)/,     // dd 写入设备
  /^chmod\s+777\s+/,                 // chmod 777
  /^chown\s+.*:.*\s+\/$/,            // chown 根目录
  /^\S*:\(\)\{\s*:\|:&\s*\}\s*;:/,   // Shellshock
  /mkfs\./,                          // 格式化
  /:,'\{\{.*\}\}'/,                  // 某些注入攻击
  /;\s*rm\s+(-[rf]+\s+)?\/?$/,       // ; rm -rf
  /\|\s*(ba)?sh$/,                   // | sh (管道执行)
];

/**
 * 需要审批的命令
 */
const REQUIRES_APPROVAL: RegExp[] = [
  /^sudo\s+/,                        // sudo 命令
  /^curl.*\|\s*(ba)?sh/,             // curl | sh
  /^wget.*\|\s*(ba)?sh/,             // wget | sh
  /^npm\s+(i|install)\s+-g/,         // 全局 npm 安装
  /^pip\s+install.*--system/,        // 系统 pip 安装
  /^ yarn \s+global\s+add/,          // 全局 yarn 安装
  /^dotnet\s+tool\s+install\s+--global/, // 全局 dotnet 工具
];

export class CommandSecurity {
  private allowedCommands: string[] = [];
  private deniedCommands: string[] = [];
  private useAllowlist: boolean;

  constructor(config: {
    useAllowlist?: boolean;
    allowedCommands?: string[];
    deniedCommands?: string[];
  }) {
    this.useAllowlist = config.useAllowlist ?? false;
    this.allowedCommands = config.allowedCommands ?? [];
    this.deniedCommands = config.deniedCommands ?? [
      'rm', 'dd', 'mkfs', 'chmod', 'chown',
    ];
  }

  /**
   * 提取命令的第一个词（可执行文件名）
   */
  private extractCommand(cmd: string): string {
    // 处理管道和分号
    const firstPart = cmd.split(/[|;&]/)[0].trim();
    // 提取第一个词
    const parts = firstPart.split(/\s+/);
    let cmdName = parts[0] || '';

    // 去掉路径前缀
    cmdName = cmdName.split(/[\\/]/).pop() || cmdName;

    return cmdName.toLowerCase();
  }

  /**
   * 检查命令是否允许
   */
  checkCommand(command: string): CommandCheckResult {
    const trimmed = command.trim();

    // 1. 检查危险模式
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          allowed: false,
          reason: 'Dangerous command pattern detected',
          requiresApproval: false,
        };
      }
    }

    // 2. 检查是否需要审批
    let requiresApproval = false;
    for (const pattern of REQUIRES_APPROVAL) {
      if (pattern.test(trimmed)) {
        requiresApproval = true;
        break;
      }
    }

    // 3. 白名单模式
    if (this.useAllowlist) {
      const firstWord = this.extractCommand(trimmed);
      const isAllowed = this.allowedCommands.some(allowed =>
        firstWord === allowed || firstWord.startsWith(allowed)
      );

      if (!isAllowed) {
        return {
          allowed: false,
          reason: `Command '${firstWord}' not in allowlist`,
          requiresApproval: true, // 白名单外的命令可申请审批
        };
      }
    }
    // 4. 黑名单模式
    else {
      const firstWord = this.extractCommand(trimmed);
      const isDenied = this.deniedCommands.includes(firstWord);

      if (isDenied) {
        return {
          allowed: false,
          reason: `Command '${firstWord}' is denied`,
          requiresApproval: false,
        };
      }
    }

    return {
      allowed: true,
      requiresApproval,
    };
  }

  /**
   * 批量检查命令
   */
  checkCommands(commands: string[]): CommandCheckResult[] {
    return commands.map(cmd => this.checkCommand(cmd));
  }

  /**
   * 断言命令安全（抛出异常如果检查失败）
   */
  assertCommand(command: string): void {
    const result = this.checkCommand(command);
    if (!result.allowed) {
      throw new Error(result.reason);
    }
  }
}
