# OpenClaw-Huangdi 项目架构 Review 报告

**日期**: 2026-03-24
**审查范围**: 整个 openclaw-huangdi 项目
**审查视角**: 客户体验 + 技术架构 + 上下文 Memory 管理

---

## 执行摘要

### 核心发现

| 类别 | 问题数 | 严重程度 |
|------|--------|----------|
| 客户体验割裂点 | 8 | 🔴 高 |
| 上下文 Memory 管理 | 6 | 🔴 高 |
| 架构设计问题 | 5 | 🟡 中 |
| 性能/可扩展性 | 4 | 🟡 中 |

### 优先修复清单

1. **P0 - 统一状态管理架构** - 三套独立状态系统导致数据不一致
2. **P0 - 单一 WebSocket 服务** - 双端口设计导致消息割裂
3. **P1 - 渐进式披露 UI 架构** - 信息过载，缺少层级导航
4. **P1 - Memory 系统整合** - 跨 agent 记忆共享未实际启用
5. **P2 - 任务维度视图缺失** - 仅有 Agent 中心视角

---

## 第一部分：客户体验视角 - 操作割裂点

### 1.1 三套独立的状态管理系统

```
┌─────────────────────────────────────────────────────────────────┐
│                    前端 Dashboard                                │
│  public/agent-dashboard.html                                     │
│  - agents: Agent[]                                               │
│  - actions: AgentAction[]                                        │
│  - thinkingEvents: ThinkingEvent[]                               │
│  - 连接 WebSocket port 3457                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ ❌ 无同步
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              DashboardServer (port 3456)                         │
│  src/dashboard/DashboardServer.ts                                │
│  - AgentStateManager (轮询 OpenClaw subagent)                    │
│  - EventStore (DashboardEvent)                                   │
│  - 连接 OpenClaw Plugin API                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ ❌ 无同步
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              MultiAgentService (port 3458)                       │
│  src/service/MultiAgentService.ts                                │
│  - AgentOrchestrator (Terminal 多 Agent)                         │
│  - ApiWebSocketServer (port 3457)                                │
│  - ActionLogger / ChatManager / TaskBoard                        │
└─────────────────────────────────────────────────────────────────┘
```

**用户痛点**：
1. 用户在 agent-dashboard.html 上选择 agent 后，状态不会同步到 DashboardServer
2. DashboardServer 轮询的 OpenClaw subagent 消息不会反映到前端时间线
3. 用户需要在两个 dashboard 页面之间切换才能看到完整信息

**影响**：用户无法获得"单一事实来源"，需要在大脑中整合多个来源的信息

---

### 1.2 双 WebSocket 端口设计

| 服务 | 端口 | 消息类型 | 前端连接 |
|------|------|----------|----------|
| ApiWebSocketServer | 3457 | agent:action, agent:thinking, terminal:output | ✅ 已连接 |
| DashboardServer WS | 3456 | event:DashboardEvent, sync:agents | ❌ 未连接 |

**用户痛点**：
- 前端只连接了 3457，错过 DashboardServer 的 subagent 消息
- 用户看到的 Actions 时间线和 subagent 聊天消息是割裂的

---

### 1.3 Tab 信息孤岛

```
┌──────────────────────────────────────────────────────┐
│  [Actions] [Thinking] [Terminal] [Workspace] [Chat]  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Actions Tab:                                        │
│  - 只看 agent actions (command_exec, file_read...)   │
│  - 不显示 terminal output                            │
│  - 不显示 thinking 详情                              │
│                                                      │
│  Thinking Tab:                                       │
│  - 只看 thinking events                              │
│  - 不与 actions 关联                                  │
│                                                      │
│  Terminal Tab:                                       │
│  - 只看终端输出                                      │
│  - 不显示是什么任务触发的                            │
│                                                      │
│  Workspace Tab:                                      │
│  - 只看文件树                                        │
│  - 不显示谁修改了文件                                │
│                                                      │
│  Chat Tab:                                           │
│  - 只看聊天消息                                      │
│  - 不与任务/动作关联                                  │
└──────────────────────────────────────────────────────┘
```

**用户痛点**：
- 要了解"这个 agent 在做什么"，需要切换 5 个 tab
- 任务和动作之间没有明确的关联显示

---

### 1.4 缺少任务维度视图

**当前设计**："Agent 中心"视角
- 必须先选 agent → 才能看动作
- TaskBoard 在独立页面 (task-board.html)

**用户期望**：
- "当前有哪些任务在运行？"
- "哪个 agent 在处理我的任务？"
- "任务 X 的进度如何？"

---

### 1.5 无渐进式披露

**问题**：所有技术细节一次性展示

| 层级 | 应显示内容 | 当前显示 |
|------|------------|----------|
| 总览 | 系统健康、关键指标 | 所有 agent 卡片 |
| 任务 | 任务状态、进度 | 无 |
| Agent | Agent 状态、当前任务 | 直接显示 sessionId, actionType |
| 调试 | 完整时间线、终端、配置 | 全部混在一起 |

**用户痛点**：
- 业务用户被技术细节淹没
- 无法快速获得高层视图
- 没有时间范围过滤（最近 1 小时/今天/全部）
- 没有事件类型过滤（关键动作 vs 详细日志）

---

## 第二部分：技术视角 - 上下文 Memory 管理

### 2.1 Memory 系统架构分析

```
src/memory/
├── HybridSearchEngine.ts    # 混合搜索引擎 (RRF + BM25 + Vector)
└── SemanticCache.ts         # 语义缓存 (未实现)

src/context/
├── HierarchicalContextEngine.ts  # 分层上下文引擎
└── PositionOptimizer.ts          # 位置优化器

src/plugin.ts
└── before_prompt_build hook     # 记忆注入
```

### 2.2 发现的问题

#### 问题 1：记忆系统未实际启用

```typescript
// src/plugin.ts:139-158
api.on("before_prompt_build", async (event) => {
  // @ts-ignore - memory 可能未定义
  const memories = await api.runtime.memory?.search?.(event.prompt, { limit: 5 });
  // ...
});
```

**问题**：
1. 使用 `@ts-ignore` 绕过了类型检查
2. `api.runtime.memory` 可能不存在，导致静默失败
3. 没有 fallback 策略

#### 问题 2：跨 Agent 记忆共享缺失

虽然有 `CrossAgentMemoryRouter` 的设计文档，但实际代码中：
- 没有实现跨 agent 记忆同步
- 每个 agent 的记忆是孤立的
- 子 agent 完成后的知识不会回流到父 agent

#### 问题 3：HierarchicalContextEngine 未整合

```typescript
// src/context/HierarchicalContextEngine.ts
// 定义了 4 层架构：
// - System Layer (priority: 0)
// - Task Layer (priority: 10)
// - Dialogue Layer (priority: 20)
// - Reference Layer (priority: 30)
```

**问题**：
- 这个引擎没有在任何地方被实际使用
- 与 OpenClaw 的上下文系统没有集成
- `countTokens` 使用简单字符数估算，不准确

---

### 2.3 EventStore 与 ActionLogger 重复

| 特性 | EventStore | ActionLogger |
|------|-----------|--------------|
| 位置 | src/dashboard/ | src/task/ |
| 事件类型 | DashboardEvent | AgentAction |
| 存储上限 | maxEvents=1000 | 未定义 |
| 查询方式 | getEventsSince(since) | getActions(agentId, limit) |
| WebSocket 广播 | DashboardServer | ApiWebSocketServer |

**问题**：
1. 两套事件存储，数据不一致
2. 类型定义不兼容
3. 前端需要调用不同 API 获取不同类型事件

---

### 2.4 Agent ID 映射混乱

```
不同系统中使用的 ID：

1. agent-dashboard.html:
   - agent.id (例如 "agent_1234567890_abc123")

2. AgentStateManager:
   - runId (子 agent 运行 ID)
   - sessionKey (子 agent 会话 key)

3. AgentOrchestrator:
   - agentId (配置的 agent ID)
   - sessionId (终端会话 ID)

4. OpenClaw Plugin API:
   - childSessionKey (subagent 会话)
   - targetSessionKey (结束时的会话)
```

**风险**：
- 前端 selectAgent 用的 ID 在不同系统中可能指向不同实体
- WebSocket 消息中的 agentId 无法正确映射到 AgentState
- 没有统一的 ID 映射表

---

### 2.5 内存泄漏风险

#### 轮询间隔未清理

```typescript
// AgentStateManager.ts:166-193
private startPolling(runId: string): void {
  const interval = setInterval(async () => {
    const agent = this.agents.get(runId);
    if (!agent) {
      this.stopPolling(runId);  // 这里会清理，但如果...
      return;
    }
    // ... poll messages
  }, this.pollInterval);
  this.pollIntervals.set(runId, interval);
}
```

**风险场景**：
1. 如果 `pollMessages()` 抛出异常，interval 持续运行
2. 如果 DashboardServer 被 hot-reload，interval 不会被清理
3. 没有最大 poll 数量限制，可能创建数千个 subagent

#### WebSocket 客户端未清理

```typescript
// DashboardServer.ts:251-258
broadcast(message: ServerMessage): void {
  for (const ws of this.webSockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}
```

**风险**：
- 没有心跳检测僵尸连接
- 没有最大连接数限制
- `webSockets.delete(ws)` 依赖 `ws.on('close')` 回调，可能不可靠

---

## 第三部分：架构设计问题

### 3.1 模块依赖关系混乱

```
期望的依赖方向：

plugin.ts (入口)
    │
    └──► DashboardServer
    │        │
    │        └──► AgentStateManager
    │        └──► EventStore
    │
    └──► MultiAgentService
             │
             └──► AgentOrchestrator
             └──► ApiWebSocketServer
```

**实际情况**：
- DashboardServer 和 MultiAgentService 互相不知道对方的存在
- 没有统一的事件总线
- AgentStateManager 直接依赖 OpenClaw Plugin API，无法独立测试

---

### 3.2 缺少统一配置管理

当前配置分散在：
- `package.json` - 端口等基础配置
- `config.example.json` - 示例配置
- 代码中的硬编码默认值（DashboardServer port 3456, MultiAgentService port 3458）

**风险**：
- 配置变更需要修改多处
- 容易产生端口冲突
- 没有配置验证

---

### 3.3 错误处理不统一

```typescript
// 风格 1: 记录日志后继续
try {
  await sandboxManager.create(...);
} catch (error) {
  console.warn(`Failed to create sandbox: ${error}`);
}

// 风格 2: 抛出异常
if (!agent) {
  throw new Error(`Agent ${agentId} not found`);
}

// 风格 3: 静默失败
// @ts-ignore
const memories = await api.runtime.memory?.search?.(...);
```

**问题**：
- 没有统一的错误处理策略
- 用户不知道什么错误是致命的
- 调试困难

---

### 3.4 测试覆盖不完整

| 模块 | 测试文件 | 覆盖率估算 |
|------|----------|------------|
| EventStore | ✅ EventStore.test.ts | 高 |
| AgentStateManager | ✅ AgentStateManager.test.ts | 高 |
| ActionLogger | ✅ ActionLogger.test.ts | 高 |
| TaskBoardManager | ✅ TaskBoardManager.test.ts | 高 |
| ChatManager | ✅ ChatManager.test.ts | 高 |
| HierarchicalContextEngine | ❌ 无测试 | 0% |
| HybridSearchEngine | ❌ 无测试 | 0% |
| TaskDecomposer | ❌ 无测试 | 0% |
| RoleRouter | ❌ 无测试 | 0% |

---

### 3.5 文档更新滞后

| 文档 | 最后更新 | 与代码一致性 |
|------|----------|--------------|
| docs/orchestrator-design.md | 未知 | 🟡 部分一致 |
| docs/terminal-multi-agent-design.md | 未知 | 🟢 较一致 |
| docs/task-board-design.md | 未知 | 🟢 较一致 |
| docs/plugin-flow.md | 未知 | 🔴 过时 |
| docs/optimized-design.md | 未知 | 🔴 过时 |

**问题**：
- 文档没有版本控制
- 架构变更后文档未更新
- 缺少 API 参考文档

---

## 第四部分：渐进式披露设计方案

### 4.1 四层信息架构

```
┌─────────────────────────────────────────────────────────────┐
│ Level 1: Overview (总览视图)                                 │
├─────────────────────────────────────────────────────────────┤
│ - 系统健康状态 (🟢 在线 / 🟡 降级 / 🔴 异常)                   │
│ - 活跃任务数 / Agent 数 / 队列长度                           │
│ - 最近告警 (overdue / stalled)                              │
│ - 快速操作 (创建任务 / 创建 Agent)                          │
└─────────────────────────────────────────────────────────────┘
                              │ 点击下钻
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Level 2: Task-Centric View (任务视图)                        │
├─────────────────────────────────────────────────────────────┤
│ - 任务卡片 (状态 / 负责人 / 进度条)                         │
│ - 任务时间线 (关键里程碑)                                   │
│ - 任务依赖关系图                                            │
│ - 筛选：我的任务 / 逾期任务 / 高优先级                       │
└─────────────────────────────────────────────────────────────┘
                              │ 点击任务
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Level 3: Agent-Centric View (Agent 视图)                     │
├─────────────────────────────────────────────────────────────┤
│ - Agent 状态徽章 (thinking/working/idle/error)              │
│ - 当前任务摘要                                              │
│ - 最近动作摘要 (Top 5，非全部)                              │
│ - 关键指标 (CPU / 内存 / 运行时长)                          │
└─────────────────────────────────────────────────────────────┘
                              │ 点击展开详情
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Level 4: Debug View (调试视图)                              │
├─────────────────────────────────────────────────────────────┤
│ - 完整动作时间线 (可过滤类型)                               │
│ - 终端输出 (可搜索)                                         │
│ - Workspace 文件树 (可预览)                                  │
│ - 聊天消息历史                                              │
│ - Agent 配置详情 (可编辑)                                    │
│ - Memory/Context 状态                                       │
└─────────────────────────────────────────────────────────────┘
```

---

### 4.2 上下文感知过滤

```typescript
interface ViewContext {
  // 用户角色决定信息密度
  userRole: 'manager' | 'developer' | 'debugger';

  // 时间范围过滤
  timeRange: '1h' | '24h' | '7d' | 'all';

  // 事件类型过滤
  eventTypes: ('thinking' | 'command' | 'file' | 'chat')[];

  // Agent 过滤
  agents: string[] | 'all';

  // 任务过滤
  tasks: string[] | 'all';
}

// 根据上下文过滤显示内容
function filterEvents(
  events: DashboardEvent[],
  context: ViewContext
): DashboardEvent[] {
  // Manager 只看任务状态变化，不看具体命令
  if (context.userRole === 'manager') {
    return events.filter(e =>
      ['task:created', 'task:completed', 'task:failed'].includes(e.type)
    );
  }

  // Developer 看任务和关键动作
  if (context.userRole === 'developer') {
    return events.filter(e =>
      !['debug:trace', 'terminal:chunk'].includes(e.type)
    );
  }

  // Debugger 看全部
  return events;
}
```

---

### 4.3 统一状态管理架构

```typescript
// 提议的新架构

interface UnifiedAgentState {
  // ===== 核心标识 =====
  id: string;                    // 统一 ID (所有系统使用同一个)
  source: 'openclaw' | 'orchestrator' | 'dashboard';

  // ===== 状态 =====
  status: AgentStatus;
  currentTask?: Task;

  // ===== 会话 =====
  sessionId?: string;            // 终端会话
  sessionKey?: string;           // subagent 会话

  // ===== 指标 =====
  metrics: {
    actionsCount: number;
    messagesCount: number;
    cpuTime?: number;
    memoryUsage?: number;
  };

  // ===== 时间线 (支持分页) =====
  timeline: TimelineEvent[];
}

interface TimelineEvent {
  type: 'action' | 'message' | 'status_change' | 'thinking' | 'task_event';
  timestamp: number;
  summary: string;               // 简短摘要 (用于总览)
  details?: any;                 // 详细信息 (用于调试)
  level: 'info' | 'warning' | 'error' | 'debug';

  // 关联 ID
  taskId?: string;
  sessionId?: string;
  correlationId?: string;
}

interface UnifiedEventStore {
  // 统一的事件存储接口
  add(event: TimelineEvent): void;
  get(query: EventQuery): TimelineEvent[];
  subscribe(callback: (event: TimelineEvent) => void): () => void;

  // 分页支持
  getPaginated(query: EventQuery, page: number, size: number): PaginatedResult<TimelineEvent>;

  // 聚合查询
  aggregate(query: EventQuery): EventAggregation;
}
```

---

### 4.4 单一 WebSocket 架构

```typescript
// 合并 port 3456 和 3457 为一个服务

interface UnifiedWebSocketMessage {
  type:
    // 系统消息
    | 'connected' | 'heartbeat' | 'error'

    // Agent 消息
    | 'agent:created' | 'agent:updated' | 'agent:removed'
    | 'agent:action' | 'agent:thinking' | 'agent:status'

    // 终端消息
    | 'terminal:output' | 'terminal:resized'

    // 任务消息
    | 'task:created' | 'task:updated' | 'task:completed' | 'task:failed'

    // 聊天消息
    | 'chat:message';

  payload: any;

  // 元数据
  metadata?: {
    timestamp: number;
    source: string;
    correlationId?: string;
  };
}

// 前端只需连接一个 WebSocket
const ws = new WebSocket('ws://localhost:3456/ws');
```

---

## 第五部分：实施路线图

### Phase 1: 紧急修复 (1-2 周)

| ID | 任务 | 优先级 | 预计工时 |
|----|------|--------|----------|
| P1-T1 | 清理 AgentStateManager 轮询泄漏 | P0 | 2h |
| P1-T2 | 添加 WebSocket 心跳检测和重连 | P0 | 4h |
| P1-T3 | 统一事件类型定义 (DashboardEvent + AgentAction) | P0 | 4h |
| P1-T4 | 添加统一 ID 映射表 | P0 | 4h |

### Phase 2: 架构整合 (2-3 周)

| ID | 任务 | 优先级 | 预计工时 |
|----|------|--------|----------|
| P2-T1 | 合并 EventStore 和 ActionLogger | P1 | 8h |
| P2-T2 | 合并两套 WebSocket 服务 | P1 | 8h |
| P2-T3 | DashboardServer 订阅 AgentOrchestrator 事件 | P1 | 4h |
| P2-T4 | 实现统一状态管理 | P1 | 16h |

### Phase 3: 渐进式 UI (2-3 周)

| ID | 任务 | 优先级 | 预计工时 |
|----|------|--------|----------|
| P3-T1 | 实现 Overview 层 | P2 | 8h |
| P3-T2 | 实现 Task-Centric 层 | P2 | 16h |
| P3-T3 | 实现上下文感知过滤 | P2 | 8h |
| P3-T4 | 整合 TaskBoard 到 agent-dashboard | P2 | 8h |

### Phase 4: Memory 系统增强 (2-3 周)

| ID | 任务 | 优先级 | 预计工时 |
|----|------|--------|----------|
| P4-T1 | 启用 HierarchicalContextEngine | P2 | 8h |
| P4-T2 | 实现跨 Agent 记忆同步 | P2 | 16h |
| P4-T3 | 添加记忆注入的 fallback 策略 | P2 | 4h |
| P4-T4 | 为 Memory 和 Context 模块添加测试 | P2 | 8h |

---

## 第六部分：文档更新计划

### 6.1 需要更新的文档

| 文档 | 更新内容 | 优先级 |
|------|----------|--------|
| docs/architecture-overview.md | 新增：整体架构图、数据流、模块依赖 | P0 |
| docs/state-management.md | 新增：统一状态管理设计 | P0 |
| docs/websocket-protocol.md | 新增：WebSocket 消息协议 | P1 |
| docs/memory-system.md | 新增：记忆系统架构和使用 | P1 |
| docs/deployment-guide.md | 新增：部署和配置指南 | P1 |
| docs/api-reference.md | 新增：完整 API 参考 | P2 |

### 6.2 文档维护流程

```yaml
文档更新流程:
  1. 代码变更 PR 必须包含相关文档更新
  2. 架构变更后 1 周内必须更新架构文档
  3. 使用 docs/CHANGELOG.md 跟踪文档版本
  4. 每月审查一次文档一致性
```

---

## 附录 A：完整文件清单

### 核心源码

```
src/
├── index.ts                        # 公开 API 导出
├── plugin.ts                       # OpenClaw 插件入口
├── cli.ts                          # CLI 入口
│
├── agent/
│   ├── index.ts
│   └── AgentOrchestrator.ts        # Agent 编排器
│
├── api/
│   ├── index.ts
│   ├── routes.ts                   # HTTP 路由
│   ├── taskRoutes.ts               # 任务路由
│   ├── WebSocketServer.ts          # WebSocket 服务
│   └── integration.test.ts
│
├── bin/
│   └── start-service.ts            # 服务启动脚本
│
├── coordinator/
│   ├── CircuitBreaker.ts
│   ├── RetryManager.ts
│   ├── TimeoutManager.ts
│   ├── TaskDecomposer.ts           # 任务分解器
│   └── RoleRouter.ts               # 角色路由
│
├── context/
│   ├── HierarchicalContextEngine.ts # 分层上下文引擎
│   └── PositionOptimizer.ts        # 位置优化器
│
├── dashboard/
│   ├── DashboardServer.ts          # Dashboard 服务器
│   ├── AgentStateManager.ts        # Agent 状态管理
│   ├── EventStore.ts               # 事件存储
│   ├── types.ts                    # 类型定义
│   └── ws.d.ts
│
├── memory/
│   ├── HybridSearchEngine.ts       # 混合搜索引擎
│   └── SemanticCache.ts            # 语义缓存
│
├── sandbox/
│   ├── index.ts
│   ├── PathSecurity.ts             # 路径安全
│   ├── CommandSecurity.ts          # 命令安全
│   ├── SandboxManager.ts           # 沙箱管理器
│   └── types.ts
│
├── service/
│   ├── index.ts
│   ├── MultiAgentService.ts        # 多 Agent 服务
│   └── SharedAgentState.ts         # 共享状态
│
├── task/
│   ├── types.ts                    # 任务类型
│   ├── ActionLogger.ts             # 动作日志
│   ├── ChatManager.ts              # 聊天管理
│   ├── TaskBoardManager.ts         # 任务看板
│   ├── MonitorAgent.ts             # 监控 Agent
│   └── *.test.ts
│
├── terminal/
│   ├── index.ts
│   ├── TerminalService.ts          # 终端服务
│   ├── ProcessRegistry.ts          # 进程注册表
│   └── types.ts
│
└── types/
    └── index.ts
```

### 文档

```
docs/
├── orchestrator-design.md          # 编排器设计
├── terminal-multi-agent-design.md  # 终端多 Agent 设计
├── task-board-design.md            # 任务看板设计
├── plugin-flow.md                  # 插件流程
├── optimized-design.md             # 优化设计
└── dashboard-review-findings.md    # Dashboard Review 发现
```

---

## 附录 B：技术债务评分

| 类别 | 评分 (1-10) | 说明 |
|------|-------------|------|
| 代码质量 | 7 | TypeScript 类型安全较好，但有 `@ts-ignore` |
| 测试覆盖 | 6 | 核心模块有测试，但关键模块缺失 |
| 文档完整 | 4 | 设计文档分散，缺少 API 参考 |
| 架构清晰 | 5 | 模块职责清晰，但整合不足 |
| 可维护性 | 6 | 代码结构合理，但有重复代码 |
| 性能优化 | 5 | 基础优化有，但缺少高级特性 |
| 安全性 | 7 | 有路径/命令安全检查 |
| 可扩展性 | 5 | 当前架构限制了扩展能力 |

**总体技术债务评分**: 5.6/10

---

*报告生成时间：2026-03-24*
*下次审查日期：2026-04-24*
