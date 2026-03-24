# Huangdi Orchestrator v0.2.0

多 Agent 编排器 - 支持终端多 Agent 服务 + OpenClaw 插件集成

> **注意**: 本项目处于活跃开发阶段，当前技术债务评分：5.6/10
>
> 详细架构审查报告请参阅：[docs/architecture-review-2026-03-24.md](docs/architecture-review-2026-03-24.md)

## 新功能 (v0.2.0)

### 终端多 Agent 服务

新增了完整的终端多 Agent 服务能力，支持：

- **跨平台终端支持**: Windows (PowerShell) 和 Mac/Linux (bash/zsh)
- **Agent 角色系统**: 6 种预定义角色 (researcher/coder/reviewer/tester/writer/planner)
- **沙箱隔离**: Docker/Podman/Restricted 模式
- **安全检查**: 路径安全、命令过滤、防注入攻击
- **实时推送**: WebSocket 实时推送 Agent 状态和终端输出
- **REST API**: 完整的 HTTP API 用于集成

## 快速开始

### 安装依赖

```bash
pnpm install  # 或 npm install
```

### 启动服务

```bash
# 使用示例配置启动
pnpm run start:service

# 或者使用 CLI
pnpm run start -- -c config.example.json
```

### 访问 Dashboard

启动服务后，访问以下地址：

- **Agent Dashboard**: http://localhost:3458/agent-dashboard.html
- **Task Board**: http://localhost:3458/task-board.html

### OpenClaw 插件模式

如果你使用 OpenClaw，插件会自动激活：

1. 安装插件：`openclaw plugins install @openclaw/huangdi-orchestrator`
2. 启动 OpenClaw
3. 访问 Dashboard: http://localhost:3456/

### 使用 CLI

```bash
# 启动服务
npx multi-agent-service start -p 3456 -w 3457

# 查看状态
npx multi-agent-service status

# 注册 Agent
npx multi-agent-service register --id my-coder --role coder --command "echo hello"

# 执行任务
npx multi-agent-service execute --task "编写一个 Hello World 函数" --watch

# 列出所有 Agent
npx multi-agent-service list
```

## API 使用

### 注册 Agent

```bash
curl -X POST http://localhost:3456/api/agents \
  -H "Content-Type: application/json" \
  -d '{
    "id": "coder-1",
    "name": "编码助手",
    "role": "coder",
    "command": "claude",
    "cwd": "./workspaces/coder"
  }'
```

### 执行任务

```bash
curl -X POST http://localhost:3456/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "task": "实现一个快速排序算法"
  }'
```

### 获取终端输出

```bash
curl http://localhost:3456/api/terminals/<sessionId>/output
```

### WebSocket 实时推送

```javascript
const ws = new WebSocket('ws://localhost:3457');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Event:', data.type, data.payload);
};

// 订阅特定频道
ws.send(JSON.stringify({
  type: 'subscribe',
  payload: { channel: 'agent:coder-1' }
}));
```

## 配置说明

### 配置文件 (config.example.json)

```json
{
  "port": 3456,
  "wsPort": 3457,
  "maxConcurrentAgents": 10,
  "sandbox": {
    "mode": "restricted",
    "workspaceRoot": "./workspaces",
    "allowedPaths": ["./shared"],
    "networkAccess": false,
    "resourceLimits": {
      "maxCpu": 50,
      "maxMemory": 512,
      "maxProcesses": 10
    }
  },
  "agents": [
    {
      "id": "researcher-1",
      "name": "信息搜集助手",
      "role": "researcher",
      "command": "claude",
      "cwd": "./workspaces/researcher"
    }
  ]
}
```

### Agent 角色

| 角色 | 说明 | 适用场景 |
|------|------|----------|
| `researcher` | 信息搜集 | 文档检索、市场调研 |
| `coder` | 编码实现 | 功能开发、Bug 修复 |
| `reviewer` | 代码审查 | 代码审查、安全检查 |
| `tester` | 测试执行 | 单元测试、集成测试 |
| `writer` | 文档编写 | 技术文档、README |
| `planner` | 任务规划 | 任务拆解、架构设计 |

### 沙箱模式

| 模式 | 说明 | 安全级别 |
|------|------|----------|
| `restricted` | 受限模式（路径限制） | ⭐⭐ |
| `chroot` | Chroot 隔离 | ⭐⭐⭐ |
| `docker` | Docker 容器 | ⭐⭐⭐⭐⭐ |
| `podman` | Podman 容器 | ⭐⭐⭐⭐⭐ |

## 程序化使用

```typescript
import { MultiAgentService } from '@openclaw/huangdi-orchestrator';

const service = new MultiAgentService({
  port: 3456,
  wsPort: 3457,
  maxConcurrentAgents: 10,
  sandbox: {
    mode: 'restricted',
    workspaceRoot: './workspaces',
    allowedPaths: [],
    networkAccess: false,
  },
});

// 注册 Agent
await service.registerAgents([
  {
    id: 'coder-1',
    name: '编码助手',
    role: 'coder',
    command: 'claude',
    cwd: './workspaces/coder',
  },
]);

// 启动服务
await service.start();

// 执行任务
const { taskId, sessionId } = await service.executeTask(
  'coder-1',
  '实现一个快速排序算法'
);

// 获取输出
const output = service.getComponents().terminalService.getOutput(sessionId);
console.log(output);
```

## API 参考

### REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/agents` | 获取所有 Agent |
| GET | `/api/agents/:id` | 获取单个 Agent |
| POST | `/api/agents` | 创建 Agent |
| DELETE | `/api/agents/:id` | 删除 Agent |
| POST | `/api/agents/:id/execute` | 执行任务 |
| POST | `/api/tasks` | 自动分配并执行任务 |
| GET | `/api/terminals` | 获取所有终端 |
| POST | `/api/terminals` | 创建终端 |
| GET | `/api/terminals/:id/output` | 获取输出 |
| POST | `/api/terminals/:id/write` | 写入命令 |
| POST | `/api/terminals/:id/resize` | 调整尺寸 |
| GET | `/api/sandboxes` | 获取所有沙箱 |
| POST | `/api/sandboxes` | 创建沙箱 |
| POST | `/api/sandboxes/:id/validate-command` | 验证命令 |
| POST | `/api/sandboxes/:id/validate-path` | 验证路径 |
| GET | `/api/stats` | 获取统计信息 |

### WebSocket 事件

**服务器推送 (port 3457):**
- `agent:update` - Agent 状态更新
- `agent:action` - Agent 动作
- `agent:thinking` - Agent 思考
- `agent:status` - Agent 状态变化
- `terminal:output` - 终端输出
- `task:started` - 任务开始
- `task:completed` - 任务完成
- `task:failed` - 任务失败
- `chat:message` - 聊天消息

**客户端发送:**
- `subscribe` - 订阅频道
- `unsubscribe` - 取消订阅

---

## 架构说明

### 双模式部署

本项目支持两种部署模式：

1. **OpenClaw 插件模式** (port 3456)
   - 作为 OpenClaw 的插件运行
   - 通过 Plugin API 与 OpenClaw 集成
   - 监听 subagent 事件

2. **独立服务模式** (port 3458)
   - 独立运行的多 Agent 服务
   - 完整的终端管理能力
   - 任务看板和聊天功能

### 核心模块

| 模块 | 职责 | 关键类 |
|------|------|--------|
| AgentOrchestrator | Agent 编排和任务分配 | `AgentOrchestrator` |
| TerminalService | 终端会话管理 | `TerminalService`, `ProcessRegistry` |
| SandboxManager | 沙箱隔离和安全 | `SandboxManager`, `PathSecurity` |
| TaskBoardManager | 任务看板管理 | `TaskBoardManager`, `MonitorAgent` |
| ActionLogger | 动作日志记录 | `ActionLogger` |
| ChatManager | Agent 间聊天 | `ChatManager` |
| DashboardServer | Dashboard 服务 (OpenClaw 模式) | `DashboardServer`, `AgentStateManager` |
| MultiAgentService | 统一服务入口 (独立模式) | `MultiAgentService` |

### 架构挑战

当前架构存在以下挑战，详见 [architecture-review-2026-03-24.md](docs/architecture-review-2026-03-24.md)：

1. **状态管理分散** - 三套独立的状态管理系统
2. **WebSocket 双端口** - 3456 和 3457 两个服务
3. **缺少渐进式披露** - 信息层级不清晰
4. **Memory 系统未启用** - 跨 Agent 记忆共享未实现

### 技术栈

- **运行时**: Node.js 22+, TypeScript 5.7+
- **Web 框架**: Hono (@hono/node-server)
- **WebSocket**: ws
- **终端**: @lydell/node-pty
- **AI SDK**: @mariozechner/pi-agent-core
- **测试**: Vitest
- **打包**: Electron Builder

## 开发

```bash
# 开发模式 (watch 模式编译)
pnpm run dev

# 构建
pnpm run build

# 类型检查
pnpm run typecheck

# 测试
pnpm run test

# 测试覆盖报告
pnpm run test:coverage

# 启动 Electron 应用
pnpm run electron

# 构建 Electron 安装包
pnpm run app:build
```

### 测试

```bash
# 运行所有测试
pnpm test

# 运行特定测试文件
pnpm test src/task/ActionLogger.test.ts

# 监视模式
pnpm test:watch
```

### 代码规范

- 遵循 TypeScript 严格模式
- 所有公共 API 必须有类型注解
- 关键逻辑必须有单元测试
- 架构变更后必须更新文档

## 项目结构

```
openclaw-huangdi/
├── src/
│   ├── agent/           # Agent 编排器
│   │   ├── AgentOrchestrator.ts
│   │   └── index.ts
│   ├── api/             # API 和 WebSocket 服务
│   │   ├── routes.ts
│   │   ├── WebSocketServer.ts
│   │   ├── taskRoutes.ts
│   │   └── index.ts
│   ├── bin/             # 二进制启动脚本
│   │   └── start-service.ts
│   ├── coordinator/     # 任务协调模块
│   │   ├── TaskDecomposer.ts
│   │   ├── RoleRouter.ts
│   │   ├── CircuitBreaker.ts
│   │   ├── RetryManager.ts
│   │   └── TimeoutManager.ts
│   ├── context/         # 上下文管理
│   │   ├── HierarchicalContextEngine.ts
│   │   └── PositionOptimizer.ts
│   ├── dashboard/       # Dashboard 服务器
│   │   ├── DashboardServer.ts
│   │   ├── AgentStateManager.ts
│   │   ├── EventStore.ts
│   │   └── types.ts
│   ├── memory/          # 记忆系统
│   │   ├── HybridSearchEngine.ts
│   │   └── SemanticCache.ts
│   ├── sandbox/         # 沙箱管理
│   │   ├── SandboxManager.ts
│   │   ├── PathSecurity.ts
│   │   ├── CommandSecurity.ts
│   │   ├── types.ts
│   │   └── index.ts
│   ├── service/         # 多 Agent 服务
│   │   ├── MultiAgentService.ts
│   │   ├── SharedAgentState.ts
│   │   └── index.ts
│   ├── task/            # 任务管理
│   │   ├── TaskBoardManager.ts
│   │   ├── MonitorAgent.ts
│   │   ├── ActionLogger.ts
│   │   ├── ChatManager.ts
│   │   ├── types.ts
│   │   └── *.test.ts
│   ├── terminal/        # 终端服务
│   │   ├── TerminalService.ts
│   │   ├── ProcessRegistry.ts
│   │   ├── types.ts
│   │   └── index.ts
│   ├── frontend/        # 前端组件
│   │   └── components.test.ts
│   ├── test/            # E2E 测试
│   │   └── e2e.test.ts
│   ├── types/           # 公共类型
│   │   └── index.ts
│   ├── index.ts         # 公共 API 导出
│   ├── cli.ts           # CLI 入口
│   └── plugin.ts        # OpenClaw 插件入口
├── public/              # 静态资源
│   ├── agent-dashboard.html
│   └── task-board.html
├── docs/                # 设计文档
│   ├── architecture-review-2026-03-24.md
│   ├── orchestrator-design.md
│   ├── terminal-multi-agent-design.md
│   ├── task-board-design.md
│   ├── plugin-flow.md
│   └── optimized-design.md
├── config.example.json  # 配置示例
├── start-service.ts     # 启动脚本
├── package.json
└── README.md
```

## License

MIT
