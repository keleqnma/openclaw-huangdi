/**
 * PathSecurity - 路径安全检查
 *
 * 防止目录遍历攻击，确保文件访问在允许的范围内
 */

import * as path from 'path';
import * as fs from 'fs';
import { PathCheckResult } from './types';

export class PathSecurity {
  private allowedPaths: string[];
  private workspaceRoot: string;

  constructor(config: {
    workspaceRoot: string;
    allowedPaths: string[];
  }) {
    this.workspaceRoot = this.normalizePath(config.workspaceRoot);
    this.allowedPaths = [
      this.workspaceRoot,
      ...config.allowedPaths.map(p => this.normalizePath(p)),
    ];
  }

  /**
   * 标准化路径
   */
  private normalizePath(input: string): string {
    // 移除 null 字节
    const sanitized = input.replace(/\0/g, '');
    // 解析用户路径 (~)
    const resolved = this.resolveUserPath(sanitized);
    // 标准化
    const normalized = path.normalize(resolved);
    // Windows 转小写
    if (process.platform === 'win32') {
      return normalized.toLowerCase();
    }
    return normalized;
  }

  /**
   * 解析用户路径
   */
  private resolveUserPath(input: string): string {
    if (input.startsWith('~')) {
      return path.join(process.env.HOME || process.env.USERPROFILE || '', input.slice(1));
    }
    return input;
  }

  /**
   * 检查路径是否在允许范围内
   */
  checkPath(filePath: string): PathCheckResult {
    const normalized = this.normalizePath(filePath);

    // 检查是否以任何允许路径为前缀
    for (const allowed of this.allowedPaths) {
      if (normalized === allowed || normalized.startsWith(allowed + path.sep)) {
        return {
          allowed: true,
          normalizedPath: normalized,
        };
      }
    }

    return {
      allowed: false,
      reason: `Path ${normalized} is outside allowed paths`,
      normalizedPath: normalized,
    };
  }

  /**
   * 断言路径安全（抛出异常如果检查失败）
   */
  assertPath(filePath: string): string {
    const result = this.checkPath(filePath);
    if (!result.allowed) {
      throw new Error(result.reason);
    }
    return result.normalizedPath;
  }

  /**
   * 检查并阻止目录遍历攻击
   */
  assertNoTraversal(filePath: string): string {
    const normalized = this.normalizePath(filePath);

    // 标准化后检查是否还包含 ..
    if (normalized.includes('..' + path.sep) || normalized.endsWith('..')) {
      throw new Error('Directory traversal detected');
    }

    return this.assertPath(normalized);
  }

  /**
   * 检查符号链接是否逃逸
   */
  async assertSymlink(linkPath: string): Promise<string> {
    const normalized = this.assertPath(linkPath);

    try {
      const realPath = await fs.promises.realpath(normalized);
      const realNormalized = this.normalizePath(realPath);

      for (const allowed of this.allowedPaths) {
        if (realNormalized === allowed || realNormalized.startsWith(allowed + path.sep)) {
          return realNormalized;
        }
      }

      throw new Error(`Symlink target ${realNormalized} is outside allowed paths`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // 文件不存在，返回标准化路径
        return normalized;
      }
      throw error;
    }
  }
}
