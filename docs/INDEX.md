# Huangdi Orchestrator 文档索引

本索引整理了项目的所有设计文档和 API 参考，按类别组织。

---

## 📋 快速开始

| 文档 | 说明 | 适合人群 |
|------|------|----------|
| [README.md](../README.md) | 项目概述、安装和使用 | 所有用户 |
| [config.example.json](../config.example.json) | 配置文件示例 | 所有用户 |

---

## 🏗️ 架构设计文档

### 整体架构

| 文档 | 说明 | 最后更新 |
|------|------|----------|
| [architecture-review-2026-03-24.md](./architecture-review-2026-03-24.md) | **最新** 完整架构审查报告，包含客户体验和技术视角分析 | 2026-03-24 |
| [orchestrator-design.md](./orchestrator-design.md) | OpenClaw 插件封装层设计，包含核心模块和 API 参考 | - |
| [terminal-multi-agent-design.md](./terminal-multi-agent-design.md) | 终端多 Agent 服务详细设计，包含整体架构和模块说明 | - |

### 子系统设计

| 文档 | 说明 | 状态 |
|------|------|------|
| [task-board-design.md](./task-board-design.md) | 任务看板设计，包含任务状态机和管理器 API | 🟢 已实现 |
| [plugin-flow.md](./plugin-flow.md) | OpenClaw 插件流程和事件钩子 | 🟡 部分实现 |
| [optimized-design.md](./optimized-design.md) | 优化设计方案 | 🔴 待实现 |

---

## 📚 API 参考

### 核心 API

| 模块 | 源文件 | 说明 |
|------|--------|------|
| MultiAgentService | `src/service/MultiAgentService.ts` | 多 Agent 服务主入口 |
| AgentOrchestrator | `src/agent/AgentOrchestrator.ts` | Agent 编排器 |
| TerminalService | `src/terminal/TerminalService.ts` | 终端会话管理 |
| SandboxManager | `src/sandbox/SandboxManager.ts` | 沙箱管理器 |

### Dashboard API

| 模块 | 源文件 | 说明 |
|------|--------|------|
| DashboardServer | `src/dashboard/DashboardServer.ts` | Dashboard HTTP+WebSocket 服务器 |
| AgentStateManager | `src/dashboard/AgentStateManager.ts` | Agent 状态管理和轮询 |
| EventStore | `src/dashboard/EventStore.ts` | 事件存储和回放 |

### 任务系统 API

| 模块 | 源文件 | 说明 |
|------|--------|------|
| TaskBoardManager | `src/task/TaskBoardManager.ts` | 任务看板管理 |
| MonitorAgent | `src/task/MonitorAgent.ts` | 任务监控 Agent |
| ActionLogger | `src/task/ActionLogger.ts` | Agent 动作日志 |
| ChatManager | `src/task/ChatManager.ts` | Agent 聊天管理 |

### 协调器 API

| 模块 | 源文件 | 说明 |
|------|--------|------|
| TaskDecomposer | `src/coordinator/TaskDecomposer.ts` | 任务分解器 |
| RoleRouter | `src/coordinator/RoleRouter.ts` | 角色路由和负载均衡 |
| CircuitBreaker | `src/coordinator/CircuitBreaker.ts` | 熔断器 |
| RetryManager | `src/coordinator/RetryManager.ts` | 重试管理器 |
| TimeoutManager | `src/coordinator/TimeoutManager.ts` | 超时管理器 |

### 记忆和上下文 API

| 模块 | 源文件 | 说明 |
|------|--------|------|
| HybridSearchEngine | `src/memory/HybridSearchEngine.ts` | 混合搜索引擎 (RRF + BM25 + Vector) |
| SemanticCache | `src/memory/SemanticCache.ts` | 语义缓存 |
| HierarchicalContextEngine | `src/context/HierarchicalContextEngine.ts` | 分层上下文引擎 |
| PositionOptimizer | `src/context/PositionOptimizer.ts` | 位置优化器 |

---

## 🧪 测试文档

### 测试文件

| 测试 | 源文件 | 说明 |
|------|--------|------|
| ActionLogger | `src/task/ActionLogger.test.ts` | 动作日志测试 |
| ChatManager | `src/task/ChatManager.test.ts` | 聊天管理测试 |
| TaskBoardManager | `src/task/TaskBoardManager.test.ts` | 任务看板测试 |
| EventStore | `src/dashboard/EventStore.test.ts` | 事件存储测试 |
| AgentStateManager | `src/dashboard/AgentStateManager.test.ts` | Agent 状态管理测试 |
| WebSocketServer | `src/api/WebSocketServer.test.ts` | WebSocket 服务测试 |
| Integration | `src/api/integration.test.ts` | API 集成测试 |
| E2E | `src/test/e2e.test.ts` | 端到端测试 |
| Frontend | `src/frontend/components.test.ts` | 前端组件测试 |

### 运行测试

```bash
# 运行所有测试
pnpm test

# 运行覆盖率报告
pnpm test:coverage

# 监视模式
pnpm test:watch
```

---

## 🎨 前端文档

### Dashboard 页面

| 页面 | 文件 | 说明 |
|------|------|------|
| Agent Dashboard | `public/agent-dashboard.html` | Agent 管理和监控面板 |
| Task Board | `public/task-board.html` | 任务看板视图 |

### 设计规格

- **主题**: 专业深色主题（ indigo/violet  accent）
- **字体**: Inter (正文) + JetBrains Mono (代码)
- **图标**: inline SVG
- **响应式**: 支持 1400px 和 900px 断点

---

## 📦 部署文档

### 部署模式

| 模式 | 说明 | 文档 |
|------|------|------|
| OpenClaw 插件 | 作为 OpenClaw 插件运行 | [plugin-flow.md](./plugin-flow.md) |
| 独立服务 | 独立运行的多 Agent 服务 | [terminal-multi-agent-design.md](./terminal-multi-agent-design.md) |
| Electron 应用 | 桌面应用程序 | - |

### 构建命令

```bash
# 构建 TypeScript
pnpm run build

# 构建 Electron 安装包 (Windows)
pnpm run app:build

# 打包 Electron 应用（不创建安装包）
pnpm run app:pack
```

---

## 🔧 开发指南

### 代码规范

- 遵循 TypeScript 严格模式
- 所有公共 API 必须有类型注解
- 关键逻辑必须有单元测试
- 架构变更后必须更新文档

### 项目结构

```
openclaw-huangdi/
├── src/                      # 源代码
│   ├── agent/                # Agent 编排
│   ├── api/                  # API 和 WebSocket
│   ├── bin/                  # 启动脚本
│   ├── coordinator/          # 任务协调
│   ├── context/              # 上下文管理
│   ├── dashboard/            # Dashboard 服务
│   ├── memory/               # 记忆系统
│   ├── sandbox/              # 沙箱管理
│   ├── service/              # 多 Agent 服务
│   ├── task/                 # 任务管理
│   ├── terminal/             # 终端服务
│   ├── types/                # 公共类型
│   ├── index.ts              # 公共 API
│   ├── cli.ts                # CLI
│   └── plugin.ts             # OpenClaw 插件
├── public/                   # 静态资源
├── docs/                     # 文档
├── config.example.json       # 配置示例
└── package.json
```

---

## 📝 决策日志

### 架构决策记录 (ADR)

| 编号 | 标题 | 日期 | 状态 |
|------|------|------|------|
| ADR-001 | 双模式部署架构 | - | ✅ 已采纳 |
| ADR-002 | WebSocket 双端口设计 | - | ⚠️ 待重新评估 |
| ADR-003 | 分层上下文引擎 | - | 🔄 进行中 |

### 待决定问题

1. **状态管理统一方案** - 详见 [architecture-review-2026-03-24.md](./architecture-review-2026-03-24.md)
2. **单一 WebSocket 架构** - 合并 port 3456 和 3457
3. **渐进式披露 UI** - 四层信息架构实现

---

## 🔗 外部链接

- [OpenClaw 官方文档](https://docs.openclaw.ai/)
- [Hono 框架文档](https://hono.dev/)
- [TypeScript 文档](https://www.typescriptlang.org/)
- [Vitest 测试框架](https://vitest.dev/)

---

## 📞 联系方式

- GitHub Issues: https://github.com/openclaw/huangdi-orchestrator/issues
- 项目主页：https://github.com/openclaw/huangdi-orchestrator

---

*文档索引最后更新：2026-03-24*
