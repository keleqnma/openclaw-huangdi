/**
 * 添加 .js 扩展名到相对导入路径
 *
 * TypeScript 的 bundler 模式不会在输出中添加 .js 扩展名，
 * 但 Node.js ESM 需要明确的扩展名。
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

// 匹配相对导入 (import ... from './xxx' 或 import ... from "../xxx" 以及 export ... from)
const importRegex = /(import\s+.*?\s+from\s+['"]|export\s+.*?\s+from\s+['"])(\.\/|\.\.\/)([^'"]+?)(['"])/g;

function addJsExtension(content) {
  return content.replace(importRegex, (match, before, rel, path, after) => {
    // 如果路径已经有扩展名，跳过
    if (path.endsWith('.js') || path.endsWith('.ts') || path.endsWith('.json')) {
      return match;
    }
    // 添加 .js 扩展名
    return `${before}${rel}${path}.js${after}`;
  });
}

function processFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const newContent = addJsExtension(content);
    if (content !== newContent) {
      writeFileSync(filePath, newContent, 'utf-8');
    }
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message);
  }
}

function walkDir(dir) {
  const files = readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    const filePath = join(dir, file.name);
    if (file.isDirectory()) {
      walkDir(filePath);
    } else if (file.name.endsWith('.js')) {
      processFile(filePath);
    }
  }
}

console.log('Adding .js extensions to relative imports...');
walkDir(distDir);
console.log('Done!');
