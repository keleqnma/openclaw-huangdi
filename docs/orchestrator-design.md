# OpenClaw Orchestrator 封装层项目设计文档

## 项目概述

**OpenClaw Orchestrator** 是一个独立的 npm 封装层项目，旨在增强 OpenClaw 的多 agent 协同能力。项目定位为 OpenClaw 的插件，无需修改 OpenClaw 本体代码。

### 核心价值

1. **主子 Agent 协同优化** - 透明的任务进度追踪、超时管理、自动重试
2. **上下文管理增强** - 智能上下文组装、跨 agent 上下文传递、知识回流
3. **记忆系统优化** - 跨 agent 记忆共享、智能检索路由、embedding 缓存
4. **实时可视化** - WebSocket 实时推送、Web 仪表板、agent 关系图

---

## 目录

- [架构设计](#架构设计)
- [核心模块](#核心模块)
- [安装配置](#安装配置)
- [API 参考](#api-参考)
- [使用示例](#使用示例)

---

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    OpenClaw Core                                │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐    │
│  │ Subagent    │  │ Agent Events │  │ Memory Index        │    │
│  │ Registry    │  │ System       │  │ Manager             │    │
│  └─────────────┘  └──────────────┘  └─────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Plugin API
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              @openclaw/orchestrator (封装层)                     │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐    │
│  │ Coordinator │  │ Context      │  │ Memory              │    │
│  │ - TaskTrack │  │ - SmartEngine│  │ - CrossAgent        │    │
│  │ - Monitor   │  │ - Propagation│  │ - Router            │    │
│  │ - Timeout   │  │ - Backflow   │  │ - EmbeddingCache    │    │
│  └─────────────┘  └──────────────┘  └─────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Visualization (WebSocket + Dashboard)       │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 数据流

```
用户请求
   │
   ▼
主 Agent ──┬──> 子 Agent 1 ──> 记忆同步 ──┐
           │                              │
           ├──> 子 Agent 2 ──> 记忆同步 ──┼──> 知识回流 ──> 主 Agent
           │                              │
           └──> 子 Agent 3 ──> 记忆同步 ──┘
                    │
                    ▼
              实时监控 ──> WebSocket ──> Dashboard
```

---

## 核心模块

### 1. Coordinator (协同层)

#### SubagentMonitor - 子 agent 监控器

**功能：**
- 监听 `agent-events` 事件流
- 追踪所有子 agent 的运行状态
- 检测卡住的任务（无活动超时）
- 构建任务树状结构

**核心 API：**

```typescript
class SubagentMonitor {
  // 获取所有活跃任务
  getActiveRuns(): SubagentRunState[]

  // 获取卡住的任务列表
  getStalledTasks(thresholdMs?: number): StalledTask[]

  // 获取任务关系图
  getTaskGraph(): AgentGraphNode[]

  // 启动监控
  start(): void

  // 停止监控
  stop(): void
}
```

**状态类型：**

```typescript
type SubagentRunState = {
  runId: string;
  sessionKey?: string;
  startTime: number;
  lastActivity: number;
  status: "running" | "completed" | "error" | "timeout";
  progress: number;
  currentTask: string;
}
```

#### TimeoutManager - 超时管理器

**功能：**
- 为子 agent 任务设置超时
- 自动重试 transient 错误
- 超时后优雅终止

**配置示例：**

```typescript
{
  timeoutSeconds: 600,           // 默认 10 分钟超时
  retryPolicy: {
    maxRetries: 2,
    retryDelaysMs: [5000, 10000] // 指数退避
  }
}
```

---

### 2. Context Engine (上下文引擎)

#### SmartContextEngine - 智能上下文引擎

**功能：**
- 消息优先级排序
- 关键上下文保留
- 增量 compaction
- Token 预算感知

**优先级策略：**

| 优先级 | 消息类型 | 说明 |
|--------|----------|------|
| 0 | subagent-complete | 子 agent 完成报告 |
| 1 | user-important | 用户重要指示 |
| 2 | assistant-decision | 关键决策 |
| 3 | tool-result | 工具执行结果 |
| 4 | assistant-regular | 普通回复 |
| 5 | user-regular | 普通用户消息 |

#### ContextPropagation - 上下文传递

**功能：**
- 父 agent → 子 agent 上下文继承
- 子 agent → 父 agent 知识回流
- 选择性传递（非全量）

**继承内容：**
```typescript
{
  systemPrompt: "...",
  recentTurns: [...],      // 最近 5 轮
  activeTasks: [...],      // 待办事项
  keyDecisions: [...],     // 关键决策
  relevantMemories: [...]  // 相关记忆
}
```

---

### 3. Memory (记忆系统)

#### CrossAgentMemoryRouter - 跨 agent 记忆路由

**功能：**
- 跨 agent 并行搜索
- 结果去重和重排序
- 子 agent 记忆同步

**搜索作用域：**
```typescript
type SearchScope = "parent-only" | "children-only" | "all"
```

**使用示例：**
```typescript
const memory = new CrossAgentMemoryRouter(api);
const results = await memory.search("API 认证流程", {
  scope: "all",
  maxResults: 10,
  minScore: 0.4
});
```

#### EmbeddingCache - Embedding 缓存

**功能：**
- 跨 agent 共享 embedding 缓存
- 批量预取
- 磁盘持久化

**缓存命中率优化：**
- 相似查询检测
- 前缀缓存
- LRU 淘汰策略

---

### 4. Visualization (可视化)

#### WebSocketServer - 实时推送服务

**消息格式：**
```typescript
// 初始状态
{
  type: "initial-state",
  payload: {
    agents: [...],
    tasks: [...],
    memory: {...}
  }
}

// 实时更新
{
  type: "event",
  payload: {
    runId: "...",
    stream: "lifecycle",
    kind: "subagent-complete",
    ts: 1234567890
  }
}
```

#### Dashboard - Web 仪表板

**功能模块：**

| 模块 | 说明 |
|------|------|
| Agent Graph | 实时 agent 关系图（树状结构） |
| Task Timeline | 任务时间线（甘特图） |
| Memory View | 记忆浏览和搜索 |
| Logs Panel | 事件日志流 |

**技术栈：**
- React + TypeScript
- React Flow (关系图)
- Recharts (图表)
- TailwindCSS (样式)

---

## 安装配置

### 前置要求

- OpenClaw v2026.2.0+
- Node.js 22+
- npm 10+

### 安装步骤

```bash
# 1. 安装插件
openclaw plugins install @openclaw/orchestrator

# 2. 启用智能上下文引擎
openclaw config set plugins.slots.contextEngine=smart

# 3. 配置跨 agent 记忆共享
openclaw config set orchestrator.crossAgentMemory=true

# 4. 配置仪表板端口
openclaw config set orchestrator.dashboardPort=8789

# 5. 配置子 agent 超时
openclaw config set orchestrator.taskTimeoutSeconds=600
```

### 完整配置示例

```json
{
  "plugins": {
    "slots": {
      "contextEngine": "smart"
    }
  },
  "orchestrator": {
    "dashboardPort": 8789,
    "crossAgentMemory": true,
    "taskTimeoutSeconds": 600,
    "enableProgressEvents": true,
    "memorySyncOnComplete": true
  },
  "agents": {
    "defaults": {
      "subagents": {
        "maxSpawnDepth": 2,
        "maxConcurrent": 8,
        "runTimeoutSeconds": 600
      }
    }
  }
}
```

---

## API 参考

### Plugin API

插件通过 OpenClaw 的 Plugin API 与核心系统交互：

```typescript
import type { OpenClawPluginApi } from "openclaw/dist/plugins/types.js";

export default function register(api: OpenClawPluginApi) {
  // 注册 Context Engine
  api.registerContextEngine("smart", () => new SmartContextEngine(api));

  // 注册 Hook 监听器
  api.on("subagent_spawning", handleSubagentSpawning);
  api.on("subagent_spawned", handleSubagentSpawned);
  api.on("subagent_ended", handleSubagentEnded);

  // 启动服务
  orchestrator.start();
  dashboard.start(8789);
}
```

### Hook 事件列表

| 事件 | 触发时机 | 用途 |
|------|----------|------|
| `subagent_spawning` | 子 agent 生成前 | 权限检查、上下文准备 |
| `subagent_spawned` | 子 agent 生成后 | 状态追踪、监控注册 |
| `subagent_ended` | 子 agent 完成后 | 知识回流、状态清理 |
| `before_compaction` | compaction 前 | 关键上下文保存 |
| `after_compaction` | compaction 后 | 上下文引用恢复 |

---

## 使用示例

### 示例 1：监控子 agent 任务

```typescript
import { SubagentMonitor } from "@openclaw/orchestrator";

const monitor = new SubagentMonitor(api);
monitor.start();

// 获取所有活跃任务
const activeRuns = monitor.getActiveRuns();
console.log(`Active tasks: ${activeRuns.length}`);

// 检测卡住的任务
const stalled = monitor.getStalledTasks(300000); // 5 分钟阈值
if (stalled.length > 0) {
  console.warn(`Stalled tasks detected: ${stalled.map(t => t.runId).join(", ")}`);
}
```

### 示例 2：跨 agent 记忆搜索

```typescript
import { CrossAgentMemoryRouter } from "@openclaw/orchestrator";

const memory = new CrossAgentMemoryRouter(api);

// 搜索所有 agent 的记忆
const results = await memory.search("认证流程", {
  scope: "all",  // parent-only | children-only | all
  maxResults: 10,
  minScore: 0.4
});

results.forEach(r => {
  console.log(`[${r.source}] ${r.path}:${r.startLine}-${r.endLine}`);
  console.log(r.snippet);
});
```

### 示例 3：可视化 Dashboard

```bash
# 启动后访问
open http://localhost:8789
```

Dashboard 显示：
- 实时 agent 树状图
- 任务进度条
- 事件日志流
- 记忆搜索框

---

## 开发指南

### 本地开发

```bash
# 克隆项目
git clone https://github.com/openclaw/orchestrator.git
cd orchestrator

# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build

# 测试
pnpm test
```

### 调试

```bash
# 启用调试日志
openclaw config set orchestrator.debug=true

# 查看详细日志
tail -f ~/.openclaw/logs/orchestrator.log
```

---

## 故障排查

### 问题 1：子 agent 监控不工作

**症状：** Dashboard 上看不到子 agent 状态

**排查步骤：**
1. 确认插件已加载：`openclaw plugins list`
2. 检查 Hook 注册：查看日志中是否有 `[orchestrator] plugin initialized`
3. 确认 `agent-events` 正常：`openclaw config get plugins.slots.contextEngine`

### 问题 2：跨 agent 记忆搜索无结果

**症状：** 只能搜索到父 agent 的记忆

**排查步骤：**
1. 确认 `crossAgentMemory: true`
2. 检查子 agent 记忆是否已同步：查看 `syncChildMemories()` 日志
3. 确认 embedding provider 可用

### 问题 3：Dashboard 无法连接

**症状：** WebSocket 连接失败

**排查步骤：**
1. 确认端口未被占用：`lsof -i :8789`
2. 检查防火墙设置
3. 尝试更换端口：`openclaw config set orchestrator.dashboardPort=9789`

---

## 性能考虑

### 内存占用

| 组件 | 基准内存 | 每 agent 增量 |
|------|----------|---------------|
| SubagentMonitor | ~5MB | ~100KB |
| CrossAgentMemory | ~10MB | ~2MB |
| Dashboard | ~20MB | ~50KB |

### 性能优化建议

1. **Embedding 缓存** - 减少重复计算
2. **增量 compaction** - 只压缩已完成的子 agent
3. **事件节流** - Dashboard 更新限制在 10Hz 以内

---

## 版本兼容性

| Orchestrator 版本 | OpenClaw 版本 | Node.js |
|-------------------|---------------|---------|
| 1.0.x             | 2026.2.0+     | 22+     |
| 1.1.x             | 2026.3.0+     | 22+     |

---

## 贡献指南

### 开发流程

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交变更 (`git commit -m 'Add amazing feature'`)
4. 推送到远程 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

### 代码规范

- 遵循 TypeScript 严格模式
- 使用 ESLint + Prettier
- 所有公共 API 必须有类型注解
- 关键逻辑必须有单元测试

---

## 许可证

MIT License - 与 OpenClaw 保持一致

---

## 联系方式

- GitHub Issues: https://github.com/openclaw/orchestrator/issues
- Discord: OpenClaw Community
- 文档：https://docs.openclaw.ai/orchestrator

---

## 附录：完整文件列表

```
@openclaw/orchestrator/
├── package.json
├── tsconfig.json
├── openclaw.plugin.json
├── src/
│   ├── index.ts                    # 公开 API 导出
│   ├── plugin.ts                   # 插件入口
│   ├── coordinator/
│   │   ├── OrchestratorPlugin.ts
│   │   ├── SubagentMonitor.ts
│   │   ├── TimeoutManager.ts
│   │   └── TaskTracker.ts
│   ├── context/
│   │   ├── SmartContextEngine.ts
│   │   ├── ContextPropagation.ts
│   │   └── KnowledgeBackflow.ts
│   ├── memory/
│   │   ├── CrossAgentMemoryRouter.ts
│   │   ├── MemoryRouter.ts
│   │   └── EmbeddingCache.ts
│   └── viz/
│       ├── DashboardServer.ts
│       ├── StateExporter.ts
│       └── WebSocketServer.ts
└── dashboard/
    ├── package.json
    ├── index.html
    └── src/
        ├── App.tsx
        └── components/
```

---

*文档版本：1.0.0*
*最后更新：2026-03-15*
