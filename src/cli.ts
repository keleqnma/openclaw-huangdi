#!/usr/bin/env node

/**
 * Multi-Agent Service CLI
 *
 * 命令行工具用于启动和控制多 Agent 服务
 */

import { MultiAgentService } from './service/MultiAgentService.js';
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

const program = new Command();

program
  .name('multi-agent-service')
  .description('本地跨平台终端多 Agent 服务')
  .version('0.2.0');

program
  .command('start')
  .description('启动服务')
  .option('-p, --port <number>', 'HTTP API 端口', '3456')
  .option('-w, --ws-port <number>', 'WebSocket 端口', '3457')
  .option('-c, --config <path>', '配置文件路径')
  .option('--max-agents <number>', '最大并发 Agent 数', '10')
  .action(async (options: { port: string; wsPort: string; config?: string; maxAgents: string }) => {
    let config: any = {};
    let agents = [];

    if (options.config) {
      const configPath = path.resolve(options.config);
      if (!fs.existsSync(configPath)) {
        console.error(`Error: Config file not found: ${configPath}`);
        process.exit(1);
      }
      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(content);
      config = parsed;
      agents = parsed.agents || [];
    }

    const service = new MultiAgentService({
      port: parseInt(options.port),
      wsPort: parseInt(options.wsPort),
      maxConcurrentAgents: parseInt(options.maxAgents),
      sandbox: config.sandbox,
    });

    // 注册配置的 Agents
    if (agents.length > 0) {
      console.log(`Registering ${agents.length} agents...`);
      await service.registerAgents(agents);
      console.log('Agents registered successfully');
    }

    await service.start();

    // 处理退出信号
    const cleanup = async () => {
      console.log('\nShutting down...');
      await service.stop();
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  });

program
  .command('status')
  .description('查看服务状态')
  .option('-p, --port <number>', 'HTTP API 端口', '3456')
  .action(async (options: { port: string }) => {
    try {
      const response = await fetch(`http://localhost:${options.port}/api/stats`);
      const data: any = await response.json();
      console.log('\nService Status:');
      console.log('───────────────');
      console.log(JSON.stringify(data.stats, null, 2));
    } catch (error: any) {
      console.error('Failed to get status:', error.message);
      console.error('Is the service running?');
    }
  });

program
  .command('register')
  .description('注册 Agent')
  .requiredOption('--id <id>', 'Agent ID')
  .requiredOption('--role <role>', 'Agent 角色 (researcher/coder/reviewer/tester/writer/planner)')
  .requiredOption('--command <cmd>', '启动命令')
  .option('--name <name>', '显示名称')
  .option('--cwd <dir>', '工作目录')
  .option('--port <number>', 'HTTP API 端口', '3456')
  .action(async (options: { id: string; role: string; command: string; name?: string; cwd?: string; port: string }) => {
    try {
      const config = {
        id: options.id,
        name: options.name || options.id,
        role: options.role,
        command: options.command,
        cwd: options.cwd,
      };

      const response = await fetch(`http://localhost:${options.port}/api/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      const result: any = await response.json();
      if (result.success) {
        console.log(`Agent registered successfully: ${options.id}`);
      } else {
        console.error('Failed to register:', result.error);
      }
    } catch (error: any) {
      console.error('Failed to register:', error.message);
    }
  });

program
  .command('execute')
  .description('执行任务')
  .option('--agent <id>', 'Agent ID (不指定则自动分配)')
  .requiredOption('--task <task>', '任务描述')
  .option('--port <number>', 'HTTP API 端口', '3456')
  .option('--watch', '实时查看输出', false)
  .action(async (options: { agent?: string; task: string; port: string; watch: boolean }) => {
    try {
      const endpoint = options.agent
        ? `http://localhost:${options.port}/api/agents/${options.agent}/execute`
        : `http://localhost:${options.port}/api/tasks`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: options.task }),
      });

      const result: any = await response.json();
      if (result.success) {
        console.log(`Task started: ${result.taskId}`);
        console.log(`Session ID: ${result.sessionId}`);

        if (options.watch) {
          console.log('\nWatching output (Ctrl+C to stop)...');
          // 简单轮询输出
          const interval = setInterval(async () => {
            try {
              const outputRes = await fetch(`http://localhost:${options.port}/api/terminals/${result.sessionId}/tail?lines=10`);
              const outputData: any = await outputRes.json();
              if (outputData.output) {
                process.stdout.write(outputData.output);
              }
            } catch {
              // Ignore fetch errors
            }
          }, 1000);

          process.on('SIGINT', () => {
            clearInterval(interval);
            console.log('\nStopped watching');
            process.exit(0);
          });
        }
      } else {
        console.error('Failed to execute:', result.error);
      }
    } catch (error: any) {
      console.error('Failed to execute:', error.message);
    }
  });

program
  .command('list')
  .description('列出所有 Agent')
  .option('-p, --port <number>', 'HTTP API 端口', '3456')
  .action(async (options: { port: string }) => {
    try {
      const response = await fetch(`http://localhost:${options.port}/api/agents`);
      const data: any = await response.json();

      if (data.agents.length === 0) {
        console.log('No agents registered');
        return;
      }

      console.log('\nRegistered Agents:');
      console.log('──────────────────');

      // Simple table output
      data.agents.forEach((a: any, i: number) => {
        console.log(`${i + 1}. ${a.config.name} (${a.id}) - Role: ${a.config.role}, Status: ${a.status}`);
      });
    } catch (error: any) {
      console.error('Failed to list:', error.message);
    }
  });

program.parse();
