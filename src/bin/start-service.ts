/**
 * Multi-Agent Service 启动脚本
 *
 * 快速启动开发服务器
 */

import { MultiAgentService } from '../service/MultiAgentService.js';

async function main() {
  console.log('Starting Multi-Agent Service...');

  const service = new MultiAgentService({
    port: 3456,
    wsPort: 3457,
    maxConcurrentAgents: 10,
    sandbox: {
      mode: 'restricted',
      workspaceRoot: './workspaces',
      allowedPaths: [],
      networkAccess: false,
      resourceLimits: {
        maxCpu: 50,
        maxMemory: 512,
        maxProcesses: 10,
      },
    },
  });

  // 注册示例 Agents
  await service.registerAgents([
    {
      id: 'researcher-1',
      name: '信息搜集助手',
      role: 'researcher' as any,
      command: 'echo',
      args: ['Researcher started'],
      cwd: './workspaces/researcher',
    },
    {
      id: 'coder-1',
      name: '编码助手',
      role: 'coder' as any,
      command: 'echo',
      args: ['Coder started'],
      cwd: './workspaces/coder',
    },
    {
      id: 'tester-1',
      name: '测试助手',
      role: 'tester' as any,
      command: 'echo',
      args: ['Tester started'],
      cwd: './workspaces/tester',
    },
  ]);

  await service.start();

  console.log('\nService is running!');
  console.log('API: http://localhost:3456');
  console.log('WebSocket: ws://localhost:3457');
  console.log('\nPress Ctrl+C to stop');

  // 处理退出信号
  const cleanup = async () => {
    console.log('\nShutting down...');
    await service.stop();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch(console.error);
