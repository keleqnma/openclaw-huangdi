# Phase 2: 合并 WebSocket 服务

**创建日期**: 2026-03-24
**状态**: 待启动
**预计时间**: 1 周

---

## 一、现状分析

### 当前架构 (v0.3.0)

```
┌─────────────────────────────────────────────────────────┐
│                     Huangdi v0.3.0                       │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐   │
│  │           DashboardServer (Port 3456)            │   │
│  │  - HTTP 路由 (Hono)                              │   │
│  │  - WebSocket Server (ws)                         │   │
│  │  - EventStore                                    │   │
│  │  - AgentStateManager (轮询)                      │   │
│  └─────────────────────────────────────────────────┘   │
│                          │                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │         ApiWebSocketServer (Port 3457)           │   │
│  │  - WebSocket Server (ws)                         │   │
│  │  - 频道订阅/退订                                 │   │
│  │  - 心跳检测 (30s)                                │   │
│  │  - 广播 Agent 状态/任务事件                       │   │
│  └─────────────────────────────────────────────────┘   │
│                          │                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │           UnifiedWebSocketServer                 │   │
│  │  - 已实现的统一 WebSocket 服务                    │   │
│  │  - 支持 Dashboard 同步和重放控制                   │   │
│  │  - 支持频道订阅/取消订阅                         │   │
│  │  - 统一 TimelineEvent 格式                        │   │
│  │  - 心跳检测和僵尸连接清理                        │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘

问题：
1. 双端口运行 (3456 + 3457)
2. DashboardServer 和 ApiWebSocketServer 功能重叠
3. 统一 WebSocket 服务未充分利用
```

### 目标架构 (v0.3.1)

```
┌─────────────────────────────────────────────────────────┐
│                    Huangdi v0.3.1                        │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐   │
│  │            UnifiedWebSocketServer                │   │
│  │                   Port 3457                      │   │
│  │  ┌────────────────────────────────────────────┐ │   │
│  │  │         Dashboard Integration              │ │   │
│  │  │  - HTTP 路由 (Hono)                        │ │   │
│  │  │  - WebSocket 升级处理                       │ │   │
│  │  │  - 同步 Agent 状态和事件                     │ │   │
│  │  │  - 重放控制                                │ │   │
│  │  └────────────────────────────────────────────┘ │   │
│  │  ┌────────────────────────────────────────────┐ │   │
│  │  │         API Integration                    │ │   │
│  │  │  - 频道订阅/退订                           │ │   │
│  │  │  - Agent 状态广播                           │ │   │
│  │  │  - 任务事件广播                            │ │   │
│  │  │  - 聊天消息广播                            │ │   │
│  │  └────────────────────────────────────────────┘ │   │
│  │  ┌────────────────────────────────────────────┐ │   │
│  │  │         Unified State Manager              │ │   │
│  │  │  - UnifiedStateManager                     │ │   │
│  │  │  - UnifiedEventStore                       │ │   │
│  │  └────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘

优势:
✅ 单一端口 3457
✅ 统一的消息协议
✅ 统一的心跳机制
✅ 减少内存占用
```

---

## 二、现有组件分析

### UnifiedWebSocketServer (已存在)

**文件**: `src/types/UnifiedWebSocketServer.ts`

**已有功能**:
- ✅ 心跳检测 (30s 间隔，10s 超时)
- ✅ 周期性广播 (2s 间隔)
- ✅ 最大连接数限制 (100)
- ✅ 频道订阅/退订
- ✅ Dashboard 同步 (fetch_events, replay_control)
- ✅ broadcastEvent 方法 (广播 TimelineEvent)
- ✅ 客户端管理和清理

**已有测试**: `src/types/UnifiedWebSocketServer.test.ts`

### DashboardServer (需要集成)

**文件**: `src/dashboard/DashboardServer.ts`

**WebSocket 相关功能**:
- WebSocket 升级处理
- 初始同步 (agents + events)
- fetch_events 消息处理
- replay_control 消息处理
- broadcast 方法

### ApiWebSocketServer (需要集成)

**文件**: `src/api/WebSocketServer.ts`

**功能**:
- 频道订阅/退订
- Agent 状态广播
- 任务事件广播
- 聊天消息广播
- 终端输出广播

---

## 三、实施步骤

### Step 1: 增强 UnifiedWebSocketServer (1-2 天)

**目标**: 添加 ApiWebSocketServer 的广播方法

**任务**:
1. 添加 Agent 状态广播方法
2. 添加任务事件广播方法
3. 添加聊天消息广播方法
4. 添加终端输出广播方法

```typescript
// src/types/UnifiedWebSocketServer.ts

// 新增方法
broadcastAgentUpdate(agent: UnifiedAgentState): void {
  this.broadcast({
    type: 'agent:update',
    payload: { agent },
  }, `agent:${agent.id}`);
}

broadcastTaskEvent(eventType: 'created' | 'updated' | 'completed' | 'failed', task: any): void {
  this.broadcast({
    type: `task:${eventType}`,
    payload: { task },
  }, 'tasks');
}

broadcastChatMessage(message: ChatMessage): void {
  this.broadcast({
    type: 'chat:message',
    payload: { message },
  }, message.to ? `chat:${message.to}` : 'chat:global');
}

broadcastTerminalOutput(event: TerminalOutputEvent): void {
  this.broadcast({
    type: 'terminal:output',
    payload: event,
  }, `terminal:${event.sessionId}`);
}
```

### Step 2: 修改 DashboardServer 使用 UnifiedWebSocketServer (1 天)

**目标**: DashboardServer 使用 UnifiedWebSocketServer 进行 WebSocket 通信

**任务**:
1. 在 DashboardServer 中创建 UnifiedWebSocketServer 实例
2. 使用 attachToHTTPServer 方法附加到现有 HTTP 服务器
3. 删除重复的 WebSocket 处理代码
4. 注入数据源函数

```typescript
// src/dashboard/DashboardServer.ts

import { UnifiedWebSocketServer } from '../types/UnifiedWebSocketServer';

export class DashboardServer {
  private unifiedWs?: UnifiedWebSocketServer;

  async start(): Promise<number> {
    return new Promise((resolve, _reject) => {
      this.httpServer = serve({
        fetch: this.app.fetch,
        port: this.port,
      }, (info) => {
        resolve(info.port);
      });

      // 创建统一 WebSocket 服务器
      this.unifiedWs = new UnifiedWebSocketServer();
      this.unifiedWs.attachToHTTPServer(this.wss, {
        getAgents: () => this.agentManager.getAllAgents(),
        getEvents: () => this.eventStore.getAllEvents(),
        getEventsSince: (since, agentId) => this.eventStore.getEventsSince(since, agentId),
        updateReplayState: (update) => this.eventStore.updateReplayState(update),
        getReplayState: () => this.eventStore.getReplayState(),
      });
    });
  }
}
```

### Step 3: 修改 ApiWebSocketServer 使用 UnifiedWebSocketServer (1 天)

**目标**: ApiWebSocketServer 成为 UnifiedWebSocketServer 的包装器

**任务**:
1. 修改 ApiWebSocketServer 使用 UnifiedWebSocketServer
2. 保留原有的广播方法 (作为包装器)
3. 删除重复的 WebSocket 处理代码

```typescript
// src/api/WebSocketServer.ts

import { UnifiedWebSocketServer } from '../types/UnifiedWebSocketServer';

export class ApiWebSocketServer {
  private unifiedWs: UnifiedWebSocketServer;

  constructor(port: number = 3457) {
    this.unifiedWs = new UnifiedWebSocketServer();
    this.unifiedWs.start(port);
  }

  // 保留原有方法作为包装器
  broadcastAgentUpdate(agent: AgentRuntime): void {
    // 转换为 UnifiedAgentState
    const unifiedAgent = this.convertToUnifiedAgent(agent);
    this.unifiedWs.broadcastAgentUpdate(unifiedAgent);
  }

  broadcastTaskEvent(eventType: string, task: any): void {
    this.unifiedWs.broadcastTaskEvent(eventType as any, task);
  }

  // ... 其他包装方法
}
```

### Step 4: 统一消息协议 (1 天)

**目标**: 定义统一的 WebSocket 消息协议

**任务**:
1. 创建消息类型定义
2. 统一事件格式
3. 统一错误格式

```typescript
// src/types/WebSocketMessages.ts

// 客户端消息
export interface ClientMessage {
  type: ClientMessageType;
  payload: any;
}

export type ClientMessageType =
  | 'subscribe' | 'unsubscribe'
  | 'fetch_events' | 'replay_control' | 'fetch_logs'
  | 'ping' | 'pong';

// 服务器消息
export interface ServerMessage {
  type: ServerMessageType;
  payload?: any;
  events?: TimelineEvent[];
  agents?: UnifiedAgentState[];
}

export type ServerMessageType =
  | 'connected' | 'disconnected'
  | 'sync' | 'event' | 'events'
  | 'subscribed' | 'unsubscribed'
  | 'agent:update' | 'agent:status' | 'agent:action' | 'agent:thinking'
  | 'task:created' | 'task:updated' | 'task:completed' | 'task:failed'
  | 'chat:message'
  | 'terminal:output'
  | 'heartbeat' | 'ping' | 'pong'
  | 'error';
```

### Step 5: 测试与验证 (1 天)

**任务**:
1. 运行现有测试确保向后兼容
2. 添加集成测试
3. 性能测试
4. 文档更新

---

## 四、验收标准

### 功能验收

- [ ] 单一端口 3457 运行
- [ ] Dashboard WebSocket 连接正常
- [ ] API WebSocket 连接正常
- [ ] 心跳检测正常工作 (30s ping/pong)
- [ ] 僵尸连接自动清理
- [ ] 最大连接数限制有效 (100)

### 性能验收

- [ ] 内存占用减少 > 20%
- [ ] WebSocket 连接延迟 < 100ms
- [ ] 广播延迟 < 50ms
- [ ] 无内存泄漏

### 测试验收

- [ ] 所有现有测试通过
- [ ] 添加 10+ 个集成测试
- [ ] 测试覆盖率 > 85%

---

## 五、风险评估

### 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| WebSocket 连接不稳定 | 低 | 高 | 充分测试 + 灰度发布 |
| 向后兼容性问题 | 中 | 中 | 保留包装器层 |
| 性能回退 | 低 | 中 | 性能测试验证 |

---

## 六、迁移计划

### 阶段 1: 并行运行 (1 天)
- 新旧系统并行运行
- 10% 流量使用新系统

### 阶段 2: 灰度切换 (2 天)
- 50% 流量使用新系统
- 监控性能和错误率

### 阶段 3: 全量切换 (1 天)
- 100% 流量使用新系统
- 删除旧代码

---

## 七、API 变更

### 旧 API (已废弃)

```typescript
// DashboardServer
dashboardServer.broadcast({ type: 'sync', agents, events });

// ApiWebSocketServer
apiWs.broadcastAgentUpdate(agent);
apiWs.broadcastTaskEvent('completed', task);
```

### 新 API (推荐)

```typescript
// UnifiedWebSocketServer
unifiedWs.broadcastAgentUpdate(agent);
unifiedWs.broadcastTaskEvent('completed', task);
unifiedWs.broadcastEvent(timelineEvent);
```

---

## 八、相关文件

| 文件 | 状态 | 操作 |
|------|------|------|
| `src/types/UnifiedWebSocketServer.ts` | 已有 | 增强 |
| `src/types/UnifiedWebSocketServer.test.ts` | 已有 | 更新 |
| `src/dashboard/DashboardServer.ts` | 已有 | 修改 |
| `src/api/WebSocketServer.ts` | 已有 | 修改 |
| `src/types/WebSocketMessages.ts` | 新建 | 创建 |

---

**最后更新**: 2026-03-24
**负责人**: Huangdi Team
