# Huangdi Orchestrator - Project Guide

## 项目概述

**Huangdi** 是一个多 Agent 协作编排器 (Multi-Agent Orchestrator)，基于 OpenClaw 框架构建。

**当前版本**: v0.2.0
**目标版本**: v0.3.0 (2026-06-24)

## 核心功能

- **任务分解**: 层次化任务分解与分配
- **角色路由**: 基于负载感知的角色路由
- **任务看板**: 任务创建/认领/执行/完成的全流程管理
- **实时监控**: WebSocket 实时推送 Agent 状态和事件
- **Dashboard**: 专业深色主题的可视化界面

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Node.js 24+, TypeScript 5.7+ |
| Web 框架 | Hono (轻量级 HTTP 框架) |
| WebSocket | ws |
| 前端 | 原生 HTML/CSS/JS (Plus Jakarta Sans + JetBrains Mono) |
| 测试 | Vitest |

## 项目结构

```
src/
├── agent/          # Agent Orchestrator 实现
├── api/            # HTTP API 路由
├── dashboard/      # Dashboard Server + 前端组件
├── sandbox/        # 沙箱管理 (命令/路径安全)
├── service/        # MultiAgentService 主服务
├── task/           # 任务管理 (TaskBoardManager, ChatManager, MonitorAgent)
├── terminal/       # 终端服务
├── types/          # 类型定义 (UnifiedEventStore, UnifiedWebSocketServer, etc.)
└── frontend/       # 前端组件库
```

## 快速启动

```bash
# 安装依赖
pnpm install

# 构建
npm run build

# 启动服务
npm run start

# 访问 Dashboard
http://localhost:3456/agent-dashboard.html
```

## 开发命令

```bash
npm run build        # 编译 TypeScript
npm run test         # 运行测试
npm run start        # 启动服务
npm run electron     # 启动 Electron 应用
```

## 改进计划 (2026 Q2)

### 进行中：Phase 1 - 统一状态管理 (2026-03-24 ~ 2026-04-07)

**目标**: 解决三套状态系统割裂问题，技术债务 5.6→8.5

| 阶段 | 任务 | 时间 | 状态 |
|------|------|------|------|
| Phase 1 | 统一状态管理 | 2 周 | 🔄 进行中 |
| Phase 2 | 合并 WebSocket | 1 周 | ⏳ 待启动 |
| Phase 3 | 分层上下文引擎 | 2 周 | ⏳ 待启动 |
| Phase 4 | 跨 Agent 记忆同步 | 2 周 | ⏳ 待启动 |
| Phase 5 | 图编排引擎 | 3 周 | ⏳ 待启动 |
| Phase 6 | 可视化编辑器 | 3 周 | ⏳ 待启动 |

### Phase 1 详细任务

1. **创建 UnifiedStateManager 单例**
   - 设计 `UnifiedAgentState` 类型
   - 实现状态原子更新
   - 添加事件溯源 (Event Sourcing)

2. **迁移数据**
   - EventStore → UnifiedEventStore
   - ActionLogger → UnifiedStateManager
   - 下线 AgentStateManager 轮询

3. **验收指标**
   - 状态一致性 > 99.9%
   - 状态查询延迟 < 50ms
   - 内存占用减少 30%

## 架构决策

### 决策 1: Event Sourcing 状态管理
- 所有状态变更通过事件累积
- 支持时间旅行调试
- 天然支持重放

### 决策 2: 单一 WebSocket 端口
- 统一使用端口 3457
- DashboardServer 作为客户端连接
- 统一心跳机制 (30s ping/pong)

### 决策 3: 层次化记忆共享
- Global → Team → Local 三层结构
- 平衡共享与隔离
- 查询效率提升 3.2x

## 关键类型

### UnifiedAgentState
```typescript
interface UnifiedAgentState {
  id: string;
  role: string;
  status: 'idle' | 'thinking' | 'executing' | 'error';
  currentTaskId?: string;
  lastEventAt: number;
  actionCount: number;
  memoryIds: string[];
}
```

### TimelineEvent
```typescript
interface TimelineEvent {
  id: string;
  type: 'action' | 'message' | 'status_change' | 'thinking' | 'task_event';
  timestamp: number;
  agentId: string;
  taskId?: string;
  summary: string;
  details?: any;
  level: 'info' | 'warning' | 'error' | 'debug';
}
```

## 测试覆盖率

| 模块 | 覆盖率 | 目标 |
|------|--------|------|
| TaskBoardManager | 95% | 85% ✅ |
| UnifiedEventStore | 92% | 85% ✅ |
| UnifiedWebSocketServer | 90% | 85% ✅ |
| AgentStateManager | 88% | 85% ✅ |
| **总体** | **~85%** | **85%** ✅ |

## 相关文档

- [架构审查报告](./docs/architecture-review-2026-03-24.md)
- [改进计划详情](./docs/multi-agent-提升点论证.md)
- [验收测试报告](./docs/验收测试报告 - 任务看板.md)
- [ROADMAP](./docs/ROADMAP-2026-Q2.md)

## 联系方式

- GitHub: https://github.com/keleqnma/openclaw-huangdi
- 问题反馈：创建 Issue
