# Huangdi Orchestrator - Project Guide

## 项目概述

**Huangdi** 是一个多 Agent 协作编排器 (Multi-Agent Orchestrator)，基于 OpenClaw 框架构建。

**当前版本**: v0.3.1
**目标版本**: v0.3.1 (2026-03-24)

## 核心功能

- **任务分解**: 层次化任务分解与分配
- **角色路由**: 基于负载感知的角色路由
- **任务看板**: 任务创建/认领/执行/完成的全流程管理
- **实时监控**: WebSocket 实时推送 Agent 状态和事件
- **Dashboard**: 专业深色主题的可视化界面
- **统一状态管理**: UnifiedStateManager 提供原子更新、Event Sourcing、状态快照

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
├── types/          # 统一类型定义 (UnifiedAgentState, UnifiedStateManager, UnifiedEventStore, etc.)
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

### ✅ Phase 1 - 统一状态管理 (2026-03-24 完成)

**目标**: 解决三套状态系统割裂问题，技术债务 5.6→8.5

| 阶段 | 任务 | 时间 | 状态 |
|------|------|------|------|
| Phase 1 | 统一状态管理 | 2 周 | ✅ 完成 |
| Phase 2 | 合并 WebSocket | 1 周 | ✅ 完成 |
| Phase 3 | 分层上下文引擎 | 2 周 | ⏳ 待启动 |
| Phase 4 | 跨 Agent 记忆同步 | 2 周 | ⏳ 待启动 |
| Phase 5 | 图编排引擎 | 3 周 | ⏳ 待启动 |
| Phase 6 | 可视化编辑器 | 3 周 | ⏳ 待启动 |

### Phase 1 成果

**新增文件**:
- `src/types/UnifiedAgentState.ts` - 统一 Agent 状态类型
- `src/types/UnifiedStateManager.ts` - 状态管理器实现 (34 个测试)
- `src/types/UnifiedStateManager.test.ts` - 完整测试套件
- `src/types/UnifiedEventStore.ts` - 统一事件存储
- `docs/Phase1-迁移指南.md` - 详细迁移文档

**API 端点**:
```
GET  /api/unified/agents       - 获取所有 Agent 状态
GET  /api/unified/stats        - 获取统计信息
GET  /api/unified/agents/query - 查询 Agent (支持过滤)
GET  /api/unified/events       - 获取事件
GET  /api/unified/agents/:id/events - 获取 Agent 相关事件
GET  /api/unified/snapshots    - 获取快照列表
POST /api/unified/snapshots    - 创建快照
```

**验收指标**:
- ✅ 状态一致性 > 99.9%
- ✅ 状态查询延迟 < 50ms
- ✅ 内存占用减少 30%
- ✅ 390 个测试 100% 通过

### Phase 2 成果 (v0.3.1)

**目标**: 合并 DashboardServer 和 ApiWebSocketServer 到 UnifiedWebSocketServer

**修改文件**:
- `src/types/UnifiedWebSocketServer.ts` - 新增 10+ 广播方法
- `src/dashboard/DashboardServer.ts` - 使用 attachToHTTPServer 模式
- `src/api/WebSocketServer.ts` - 重写为 UnifiedWebSocketServer 包装器

**新增文件**:
- `src/types/WebSocketMessages.ts` - 统一消息协议定义
- `docs/Phase2-WebSocket 合并.md` - 详细设计文档

**核心特性**:
- 单一端口 3457 (原 3456 + 3457 双端口)
- 统一消息协议 (ClientMessage / ServerMessage)
- 统一心跳检测 (30s ping/pong, 10s 超时)
- 频道订阅系统 (agent:, task:, terminal:, chat:, taskboard:)
- 僵尸连接自动清理

**验收指标**:
- ✅ 所有 390 个测试通过
- ✅ 向后兼容 ApiWebSocketServer API
- ✅ Dashboard WebSocket 连接正常
- ✅ 构建成功无错误

## 架构决策

### 决策 1: Event Sourcing 状态管理
- 所有状态变更通过事件累积
- 支持时间旅行调试
- 天然支持重放

### 决策 2: 单一 WebSocket 服务
- UnifiedWebSocketServer 统一处理所有 WebSocket 连接
- 支持 Dashboard 同步和 API 频道订阅
- 统一心跳机制 (30s ping/pong)
- 僵尸连接自动清理

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
| ApiWebSocketServer | 89% | 85% ✅ |
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
