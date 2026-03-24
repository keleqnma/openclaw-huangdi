# Dashboard Review Findings

## 1. 客户视角：操作割裂点分析

### 1.1 信息分散问题

**问题 1：三套独立的状态管理系统**
- `agent-dashboard.html` - 前端独立维护 agents/actions/thinkingEvents 状态
- `DashboardServer.ts` + `AgentStateManager` - 后端轮询 OpenClaw subagent 状态
- `MultiAgentService` + `AgentOrchestrator` - 服务层管理 Agent 生命周期

**用户痛点：**
1. 用户在 agent-dashboard.html 点击选择 agent 后，状态不会同步到 DashboardServer 的 AgentStateManager
2. DashboardServer 轮询的 subagent 消息也不会自动反映到 agent-dashboard.html 的时间线
3. 用户需要在两个 dashboard 之间切换才能看到完整信息

**问题 2：重复的事件广播机制**
- `ApiWebSocketServer` (port 3457) - 广播 agent:action, agent:thinking, agent:status
- `DashboardServer` (port 3456) - 广播 event:DashboardEvent, heartbeat
- 两套 WebSocket 服务监听不同端口，前端需要连接两个 WebSocket

**用户痛点：**
1. 前端代码只连接了 port 3457，错过 DashboardServer 的 subagent 消息
2. 用户看到的时间线 (Actions) 和 subagent 聊天消息是割裂的
3. 无法在一个视图中看到 agent 的完整活动历史

### 1.2 上下文切换成本

**问题 3：Tab 之间的信息孤岛**
```
Actions Tab     → 只看 agent actions (command_exec, file_read, etc.)
Thinking Tab    → 只看 thinking events
Terminal Tab    → 只看终端输出
Workspace Tab   → 只看文件树
Chat Tab        → 只看聊天消息
```

**用户痛点：**
1. 用户无法在一个视图中看到"这个 agent 在做什么任务"的完整上下文
2. 要看一个 agent 的完整活动，需要切换 5 个 tab
3. 任务和动作之间没有明确的关联显示

**问题 4：缺少任务维度的视图**
- 当前设计是"Agent 中心"，用户必须先选 agent 才能看动作
- 但用户可能更关心"当前有哪些任务在运行"
- TaskBoard 有独立页面 (task-board.html)，但和 agent-dashboard 没有整合

### 1.3 渐进式披露缺失

**问题 5：信息过载**
- 所有 agent 卡片都显示在 sidebar，没有分组/过滤
- 没有时间范围过滤（只看最近 1 小时/今天/全部）
- 没有事件类型过滤（只看关键动作 vs 详细日志）

**问题 6：缺少层级导航**
- 没有"总览 → 详情 → 深入"的信息层级
- 用户一上来就看到所有技术细节 (sessionId, actionType, payload)
- 业务用户可能只关心"任务是否完成"，不需要看终端命令

---

## 2. 技术视角：上下文 Memory 管理问题

### 2.1 状态同步问题

**问题 7：双向同步缺失**

```
DashboardServer (3456)          MultiAgentService (3458)
     │                                │
     │ AgentStateManager              │ AgentOrchestrator
     │ - polls subagent messages      │ - manages agent lifecycle
     │ - tracks runId → sessionKey    │ - tracks agentId → runtime
     │                                │
     └─────────── NO SYNC ────────────┘
```

**技术债务：**
1. `AgentStateManager` 通过轮询 `api.runtime.subagent.getSessionMessages()` 获取消息
2. `AgentOrchestrator` 通过事件Emitter 推送 agent:registered/started/stopped
3. 两套系统互相不知道对方的存在

**修复方向：**
- DashboardServer 应该订阅 AgentOrchestrator 的事件
- AgentStateManager 应该与 MultiAgentService 共享状态

**问题 8：EventStore 与 ActionLogger 重复**

```typescript
// EventStore (DashboardServer)
- add(event: DashboardEvent)
- getEventsSince(since, agentId)
- maxEvents = 1000

// ActionLogger (MultiAgentService)
- log(action: AgentAction)
- getActions(agentId, limit)
- maxActions = 1000 (默认)
```

**技术债务：**
1. 两套事件存储系统，数据不一致
2. DashboardEvent 和 AgentAction 类型定义不兼容
3. 前端需要调用不同 API 获取不同类型的事件

### 2.2 内存泄漏风险

**问题 9：轮询间隔未清理**

```typescript
// AgentStateManager.ts:166-193
private startPolling(runId: string): void {
  const interval = setInterval(async () => {
    // ... poll messages
  }, this.pollInterval);
  this.pollIntervals.set(runId, interval);
}
```

**风险点：**
1. 如果 agent 被移除但 `stopPolling` 未被调用，interval 持续运行
2. `clear()` 方法会清理所有 interval，但如果 DashboardServer 被 hot-reload 呢？
3. 没有最大 poll 数量限制，可能创建数千个 subagent 导致内存爆炸

**问题 10：WebSocket 客户端未清理**

```typescript
// DashboardServer.ts:251-258
broadcast(message: ServerMessage): void {
  const data = JSON.stringify(message);
  for (const ws of this.webSockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}
```

**风险点：**
1. 如果客户端断开但 `webSockets.delete(ws)` 未被调用，广播会失败
2. 没有心跳检测僵尸连接
3. 没有最大连接数限制

### 2.3 数据一致性

**问题 11：Agent ID 映射混乱**

```
agent-dashboard.html 使用：
- agent.id (例如 "agent_1234567890_abc123")

AgentStateManager 使用：
- runId (子 agent 运行 ID)
- sessionKey (子 agent 会话 key)

AgentOrchestrator 使用：
- agentId (配置的 agent ID)
- sessionId (终端会话 ID)
```

**技术债务：**
1. 前端 selectAgent 时用的 ID 可能在不同系统中指向不同实体
2. WebSocket 消息中的 agentId 可能无法正确映射到 AgentState
3. 没有统一的 ID 映射表

---

## 3. 渐进式披露设计方案

### 3.1 信息层级架构

```
Level 1: Overview (总览)
├── 系统健康状态 (在线/离线/异常)
├── 活跃任务数 / Agent 数
├── 最近告警 (overdue/stalled)
└── 快速操作 (创建任务/创建 Agent)

Level 2: Task-Centric View (任务视图)
├── 任务卡片 (状态/负责人/进度)
├── 任务时间线 (关键里程碑)
└── 点击展开 → Level 3

Level 3: Agent-Centric View (Agent 视图)
├── Agent 状态 (thinking/working/idle)
├── 当前任务
├── 最近动作摘要 (非全部细节)
└── 点击展开 → Level 4

Level 4: Debug View (调试视图)
├── 完整动作时间线
├── 终端输出
├── Workspace 文件
├── 聊天消息
└── 配置详情
```

### 3.2 上下文感知过滤

```typescript
interface ViewContext {
  userRole: 'manager' | 'developer' | 'debugger';
  timeRange: '1h' | '24h' | '7d' | 'all';
  eventTypes: ('thinking' | 'command' | 'file' | 'chat')[];
  agents: string[] | 'all';
}

// 根据上下文过滤显示内容
function filterEvents(events: DashboardEvent[], context: ViewContext): DashboardEvent[] {
  return events.filter(event => {
    // Manager 只看任务状态变化，不看具体命令
    if (context.userRole === 'manager') {
      return ['task:created', 'task:completed', 'task:failed'].includes(event.type);
    }
    // Developer 看任务和关键动作
    if (context.userRole === 'developer') {
      return !['debug:trace'].includes(event.type);
    }
    // Debugger 看全部
    return true;
  });
}
```

### 3.3 统一状态管理

```typescript
// 提议的新架构
interface UnifiedAgentState {
  // 核心标识
  id: string;              // 统一 ID
  source: 'openclaw' | 'orchestrator' | 'dashboard';

  // 状态
  status: AgentStatus;
  currentTask?: Task;

  // 会话
  sessionId?: string;      // 终端会话
  sessionKey?: string;     // subagent 会话

  // 指标
  metrics: {
    actionsCount: number;
    messagesCount: number;
    cpuTime?: number;
    memoryUsage?: number;
  };

  // 时间线 (最近 N 条，支持分页加载更多)
  timeline: TimelineEvent[];
}

// 统一的事件类型
interface TimelineEvent {
  type: 'action' | 'message' | 'status_change' | 'thinking' | 'task_event';
  timestamp: number;
  summary: string;    // 简短摘要 (用于总览)
  details?: any;      // 详细信息 (用于调试)
  level: 'info' | 'warning' | 'error' | 'debug';
}
```

### 3.4 实现路线图

**Phase 1: 状态统一**
1. 合并 EventStore 和 ActionLogger
2. 创建统一 ID 映射表
3. DashboardServer 订阅 AgentOrchestrator 事件

**Phase 2: 单 WebSocket 架构**
1. 合并 port 3456 和 3457 的 WebSocket 服务
2. 定义统一的消息协议
3. 前端只连接一个 WebSocket

**Phase 3: 渐进式 UI**
1. 实现 Overview / Task / Agent / Debug 四层视图
2. 添加视图切换器（用户角色选择）
3. 实现可折叠/展开的详情面板

**Phase 4: 性能优化**
1. 实现事件分页（虚拟滚动）
2. 按需加载详细信息
3. 添加搜索和过滤

---

## 4. 优先修复清单

| 优先级 | 问题 | 影响 | 修复成本 |
|--------|------|------|----------|
| P0 | 两套 WebSocket 服务 | 消息割裂 | 中 |
| P0 | AgentStateManager 轮询泄漏 | 内存泄漏 | 低 |
| P1 | 事件存储重复 (EventStore vs ActionLogger) | 数据不一致 | 中 |
| P1 | 缺少任务维度视图 | 用户体验差 | 中 |
| P2 | 信息过载无过滤 | 认知负担 | 低 |
| P2 | ID 映射混乱 | 潜在 bug | 中 |
| P3 | 无渐进式披露 | 可扩展性差 | 高 |
