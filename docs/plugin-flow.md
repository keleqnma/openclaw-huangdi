# OpenClaw 插件嵌入执行逻辑流 🧩

> 一份超详细的插件系统指南，带你从零开始理解插件如何"黑入"OpenClaw 核心流程

---

## 目录

- [🎯 核心概念速览](#-核心概念速览)
- [📦 插件生命周期全旅程](#-插件生命周期全旅程)
- [🔌 24 种钩子完全解析](#-24 种钩子完全解析)
- [🧠 上下文优化实战](#-上下文优化实战)
- [💾 记忆系统增强指南](#-记忆系统增强指南)
- [🤖 子 Agent 协同流程](#-子-agent-协同流程)
- [🛠️ 实战案例](#️-实战案例)

---

## 🎯 核心概念速览

### 插件能做什么？

想象一下，OpenClaw 是一个智能手机 📱，插件就是各种 App：

```
┌─────────────────────────────────────────────────────────┐
│                    OpenClaw 主机                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │ 📞 通话 │  │ 📷 相机 │  │ 🎵 音乐 │  │ 🧭 导航 │    │
│  │  (核心) │  │ (核心)  │  │ (插件)  │  │ (插件)  │    │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │
│                                                         │
│  插件插槽：                                              │
│  - 工具 (Tools)      - 频道 (Channels)                  │
│  - 上下文引擎        - 记忆系统                         │
│  - 模型提供商        - 命令 (Commands)                  │
└─────────────────────────────────────────────────────────┘
```

**关键区别**：其他系统的插件只能"添加功能"，OpenClaw 插件可以 **"修改核心行为"**！

### 架构图解

```
用户消息
   │
   ▼
┌────────────────────────────────────────────────────────────┐
│                    OpenClaw Core                           │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │              插件钩子执行点 (24 个!)                   │ │
│  │  before_model_resolve → before_prompt_build → ...   │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │ Subagent    │  │ Agent Events │  │ Memory Index    │   │
│  │ Registry    │  │ System       │  │ Manager         │   │
│  └─────────────┘  └──────────────┘  └─────────────────┘   │
└────────────────────────────────────────────────────────────┘
           ▲                    │                    ▼
           │                    │                    │
           └────────────────────┼────────────────────┘
                                │
           ┌────────────────────┴────────────────────┐
           │         @openclaw/huangdi               │
           │  (你的插件在这里！)                      │
           │                                         │
           │  - 修改上下文组装策略                    │
           │  - 跨 Agent 记忆共享                     │
           │  - 任务分解与路由                       │
           │  - 实时可视化监控                       │
           └─────────────────────────────────────────┘
```

---

## 📦 插件生命周期全旅程

### 阶段一：插件发现 🔍

```
┌─────────────────────────────────────────────────────────────┐
│                    插件发现流程                              │
└─────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ 1. Workspace │     │  2. Global   │     │  3. Bundled  │
│              │     │              │     │              │
│ ./extensions/│     │~/.openclaw/  │     │  <install>/  │
│   *.json     │ ──▶ │ extensions/  │ ──▶ │  extensions/ │
│              │     │   *.json     │     │    *.json    │
└──────────────┘     └──────────────┘     └──────────────┘
        │                    │                    │
        └────────────────────┴────────────────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │  4. Config Paths    │
                  │  (配置文件指定路径)  │
                  └─────────────────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │   发现完成！        │
                  │  共找到 N 个插件     │
                  └─────────────────────┘
```

**发现逻辑伪代码**：

```typescript
async function discoverPlugins() {
  const sources = [
    './extensions/*',           // 工作区优先
    '~/.openclaw/extensions/*', // 全局安装
    '<openclaw>/extensions/*',  // 内置插件
    ...config.loadPaths         // 自定义路径
  ];

  for (const source of sources) {
    const manifest = findManifest(source);
    if (manifest) {
      registry.add(manifest);
    }
  }
}
```

### 阶段二：清单验证 ✅

每个插件必须提交"身份证" —— `openclaw.plugin.json`：

```json
{
  "id": "huangdi-orchestrator",
  "name": "Huangdi Multi-Agent Orchestrator",
  "version": "0.1.0",
  "kind": "context-engine",
  "description": "多 Agent 协同编排引擎",

  "configSchema": {
    "type": "object",
    "properties": {
      "maxSubagents": { "type": "integer", "default": 5 },
      "enableMemorySync": { "type": "boolean", "default": true }
    }
  },

  "skills": ["skills/"],
  "exports": {
    "./coordinator": "./src/coordinator/index.ts",
    "./memory": "./src/memory/index.ts"
  }
}
```

**验证流程**：

```
┌─────────────────┐
│ 读取 manifest   │
│ openclaw.plugin.json │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ❌ 失败
│ 验证必填字段    │──────────────▶ 抛出错误
│ - id            │
│ - configSchema  │
└────────┬────────┘
         │ ✅ 通过
         ▼
┌─────────────────┐     ❌ 无效
│ JSON Schema 验证│──────────────▶ 拒绝加载
│ configSchema    │
└────────┬────────┘
         │ ✅ 通过
         ▼
┌─────────────────┐
│ 注册到插件列表  │
│ 准备加载...     │
└─────────────────┘
```

### 阶段三：加载与激活 🚀

这是最复杂的部分！让我们用**完整流程图**来看：

```
┌─────────────────────────────────────────────────────────────────────┐
│                        插件加载完整流程                              │
└─────────────────────────────────────────────────────────────────────┘

    ┌─────────┐
    │ 开始加载 │
    └────┬────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  Step 1: Jiti 动态导入模块               │
│                                         │
│  const module = await jiti(__filename)  │
│    .resolve('./src/plugin.ts');         │
└───────────────┬─────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│  Step 2: 检查导出函数                    │
│                                         │
│  - module.register ? ✅                │
│  - module.activate ? ✅                │
│  - module.default ? ✅                 │
└───────────────┬─────────────────────────┘
                │
         ┌──────┴──────┐
         │             │
         ▼             ▼
┌─────────────┐ ┌─────────────┐
│ register()  │ │ activate()  │
│ 静态注册    │ │ 动态激活    │
└──────┬──────┘ └──────┬──────┘
       │               │
       │               ▼
       │      ┌─────────────────────────┐
       │      │ 注册钩子处理器           │
       │      │ api.on('hook', handler) │
       │      └─────────────────────────┘
       │               │
       │               ▼
       │      ┌─────────────────────────┐
       │      │ 注册 Context Engine     │
       │      │ api.registerContext...  │
       │      └─────────────────────────┘
       │               │
       ▼               ▼
┌─────────────────────────────────────────┐
│  Step 3: 插件初始化完成                  │
│  🎉 插件已就绪！                        │
└─────────────────────────────────────────┘
```

**实际代码示例**：

```typescript
// src/plugin.ts - Huangdi 插件入口

import type { OpenClawPluginApi } from "openclaw/dist/plugins/types.js";
import { TaskDecomposer } from "./coordinator/TaskDecomposer";
import { RoleRouter } from "./coordinator/RoleRouter";
import { SemanticCache } from "./memory/SemanticCache";
import { HierarchicalContextEngine } from "./context/HierarchicalContextEngine";

// ============ 阶段 1: 注册 (静态) ============
export function register(api: OpenClawPluginApi) {
  api.logger.info('[huangdi] 注册上下文引擎插槽...');

  // 注册智能上下文引擎
  api.registerContextEngine('huangdi-smart', () => {
    return new HierarchicalContextEngine(api);
  });
}

// ============ 阶段 2: 激活 (动态) ============
export async function activate(api: OpenClawPluginApi) {
  api.logger.info('[huangdi] 激活插件...');

  // 初始化组件
  const taskDecomposer = new TaskDecomposer(api);
  const roleRouter = new RoleRouter(api);
  const semanticCache = new SemanticCache();

  // 注册钩子处理器
  api.on('subagent_spawning', async (event, ctx) => {
    api.logger.info(`[huangdi] 子 Agent 即将生成：${event.subagentId}`);
    // 准备子 Agent 上下文...
  });

  api.on('subagent_ended', async (event, ctx) => {
    api.logger.info(`[huangdi] 子 Agent 完成：${event.subagentId}`);
    // 同步记忆、清理资源...
  });

  api.logger.info('[huangdi] ✨ 激活完成！');
}
```

---

## 🔌 24 种钩子完全解析

### 钩子分类地图

```
                        ┌─────────────────┐
                        │   24 种钩子     │
                        └────────┬────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
        ▼                        ▼                        ▼
┌───────────────┐      ┌───────────────┐      ┌───────────────┐
│  修改型钩子   │      │  观察型钩子   │      │  控制型钩子   │
│  (Seria​​l)    │      │  (Parallel)   │      │  (Lifecycle)  │
│               │      │               │      │               │
│ 可修改输出    │      │ 只读观察      │      │ 生命周期管理  │
└───────────────┘      └───────────────┘      └───────────────┘
```

### 完整钩子时序图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        一次完整 Agent 调用的钩子触发顺序                 │
└─────────────────────────────────────────────────────────────────────────┘

用户发送消息："帮我分析这个项目的架构"
│
▼
┌─────────────────────────────────────────────────────────────┐
│ 1. message_received                                         │
│    [观察型] 消息已接收，可以做审计/日志                     │
└─────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────┐
│ 2. before_model_resolve                                     │
│    [修改型] 可以选择更适合的模型                            │
│    - 简单问题 → 轻量模型                                    │
│    - 复杂分析 → 强大模型                                    │
└─────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────┐
│ 3. before_prompt_build ⭐ (核心钩子!)                       │
│    [修改型] 注入记忆、修改系统提示词                        │
│    返回：{ systemPrompt, prependContext, ... }              │
└─────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────┐
│ 4. ContextEngine.assemble()                                 │
│    组装最终上下文（应用 token 预算）                         │
└─────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────┐
│ 5. llm_input                                                │
│    [观察型] 发送到 LLM 前的最后检查                         │
└─────────────────────────────────────────────────────────────┘
│
▼
    ╔════════════════════════╗
    ║   LLM 思考中... 🤔     ║
    ║   (插件无法干预)        ║
    ╚════════════════════════╝
│
▼
┌─────────────────────────────────────────────────────────────┐
│ 6. llm_output                                               │
│    [观察型] LLM 响应已生成，可异步写入记忆                  │
└─────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────┐
│ 7. before_tool_call (如果 LLM 决定调用工具)                │
│    [修改型] 可以修改参数或阻止危险调用                      │
└─────────────────────────────────────────────────────────────┘
│
▼
    ╔════════════════════════╗
    ║   工具执行中... 🔧     ║
    ╚════════════════════════╝
│
▼
┌─────────────────────────────────────────────────────────────┐
│ 8. after_tool_call                                          │
│    [观察型] 工具执行完成                                    │
└─────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────┐
│ 9. message_sending                                          │
│    [修改型] 可以修改或取消要发送的消息                      │
└─────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────┐
│ 10. agent_end                                               │
│     [观察型] 本轮结束，可做总结分析                         │
└─────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────┐
│ 11. after_turn (ContextEngine)                              │
│     触发后台压缩决策                                        │
└─────────────────────────────────────────────────────────────┘
```

### 钩子详细对照表

#### 修改型钩子 (Serial - 按优先级顺序执行)

| 钩子名称 | 触发时机 | 可修改内容 | 典型用途 |
|---------|---------|-----------|---------|
| `before_model_resolve` | 模型选择前 | `modelId`, `providerId` | 复杂查询用强模型 |
| `before_prompt_build` | 提示词构建前 | `systemPrompt`, `prependContext` | 注入记忆/上下文 |
| `before_tool_call` | 工具调用前 | `toolArgs`, 可阻止调用 | 安全审查/参数修正 |
| `message_sending` | 消息发送前 | `message`, 可取消发送 | 内容过滤/格式化 |
| `subagent_spawning` | 子 Agent 生成前 | `spawnParams` | 权限检查/上下文准备 |

#### 观察型钩子 (Parallel - 并行执行)

| 钩子名称 | 触发时机 | 典型用途 |
|---------|---------|---------|
| `message_received` | 消息接收 | 审计日志、命令解析 |
| `llm_input` | 发送到 LLM 前 | 负载分析、token 统计 |
| `llm_output` | 接收 LLM 响应 | 异步写入记忆、结果分析 |
| `agent_end` | Agent 回合结束 | 对话分析、统计上报 |
| `before_compaction` | 上下文压缩前 | 记录压缩前状态 |
| `after_compaction` | 上下文压缩后 | 验证压缩结果 |
| `after_tool_call` | 工具调用后 | 结果缓存、错误分析 |
| `message_sent` | 消息已发送 | 发送日志、回调通知 |
| `session_start` | 会话开始 | 初始化会话状态 |
| `session_end` | 会话结束 | 清理会话资源 |
| `subagent_spawned` | 子 Agent 已生成 | 状态追踪、监控注册 |
| `subagent_ended` | 子 Agent 结束 | 知识回流、状态清理 |
| `gateway_start` | 网关启动 | 初始化网关服务 |
| `gateway_stop` | 网关停止 | 清理网关资源 |

#### 控制型钩子 (Lifecycle)

| 钩子名称 | 触发时机 | 典型用途 |
|---------|---------|---------|
| `before_reset` | 会话重置前 | 保存会话快照 |
| `tool_result_persist` | 工具结果持久化 | 修改持久化格式 |
| `before_message_write` | 写入会话前 | 最终内容审查 |
| `subagent_delivery_target` | 子 Agent 投递目标 | 路由决策 |

---

## 🧠 上下文优化实战

### 插槽机制详解

OpenClaw 使用**独占插槽**模式，就像手机的 SIM 卡槽：

```
┌─────────────────────────────────────────────────────────────┐
│                    Context Engine 插槽                      │
│                                                             │
│   ┌─────────────────────────────────────────────────┐      │
│   │  slots.contextEngine = "huangdi-smart"          │      │
│   │                                                 │      │
│   │  [ huangdi-smart ] ← 你的插件在这里!            │      │
│   │                                                 │      │
│   │  (默认是 "legacy"，替换后就完全接管)             │      │
│   └─────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

**配置方式**：

```yaml
# ~/.openclaw/config.yaml
plugins:
  slots:
    contextEngine: "huangdi-smart"  # 替换默认引擎
    memory: "huangdi-memory"        # 替换记忆引擎
```

### ContextEngine 完整接口

```typescript
interface ContextEngine {
  // ========== 生命周期 ==========
  readonly info: ContextEngineInfo;
  dispose?(): Promise<void>;

  // ========== 会话初始化 ==========
  bootstrap?(params: {
    sessionId: string;
    sessionKey?: string;
  }): Promise<BootstrapResult>;

  // ========== 消息摄入 ==========
  ingest(params: {
    sessionId: string;
    message: AgentMessage;
  }): Promise<IngestResult>;

  ingestBatch?(params: {
    sessionId: string;
    messages: AgentMessage[];
  }): Promise<IngestBatchResult>;

  // ========== 回合后处理 ==========
  afterTurn?(params: {
    sessionId: string;
    messages: AgentMessage[];
  }): Promise<void>;

  // ========== 核心：组装上下文 ⭐ ==========
  assemble(params: {
    sessionId: string;
    messages: AgentMessage[];
    tokenBudget?: number;  // Token 预算限制
  }): Promise<AssembleResult>;

  // ========== 上下文压缩 ==========
  compact(params: {
    sessionId: string;
    tokenBudget?: number;
    force?: boolean;  // 强制压缩
  }): Promise<CompactResult>;

  // ========== 子 Agent 支持 ==========
  prepareSubagentSpawn?(params: {
    parentSessionKey: string;
    childSessionKey: string;
  }): Promise<SubagentSpawnPreparation>;

  onSubagentEnded?(params: {
    childSessionKey: string;
    reason: string;
  }): Promise<void>;
}
```

### AssembleResult 返回结构

```typescript
type AssembleResult = {
  // 排序后的消息列表（按优先级重新排列）
  messages: AgentMessage[];

  // 估算的 token 数量
  estimatedTokens: number;

  // 可选：额外的系统提示词
  systemPromptAddition?: string;
};
```

### 消息优先级策略示例

```
┌─────────────────────────────────────────────────────────────┐
│              Huangdi 智能上下文组装策略                      │
└─────────────────────────────────────────────────────────────┘

原始消息流（按时间顺序）:
┌─────┬──────────────┬─────────────────────────────────────┐
│ #   │ 角色         │ 内容                                │
├─────┼──────────────┼─────────────────────────────────────┤
│ 1   │ user         │ "帮我写个函数"                       │
│ 2   │ assistant    │ "好的，什么函数？"                   │
│ 3   │ user         │ "排序算法"                         │
│ 4   │ tool-result  │ "执行结果：[1,2,3]"                 │
│ 5   │ subagent-complete │ "子任务完成报告"               │
│ 6   │ user         │ "继续优化"                         │
└─────┴──────────────┴─────────────────────────────────────┘

优先级重排序（高优先级在前）:
┌─────┬─────────────────┬────────────────────────────────────┐
│ 优先级 │ 消息类型        │ 说明                              │
├─────┼─────────────────┼────────────────────────────────────┤
│ 0   │ subagent-complete│ 子 Agent 完成报告（最重要！）     │
│ 1   │ user-important  │ 用户重要指示                       │
│ 2   │ assistant-decision│ 关键决策点                        │
│ 3   │ tool-result     │ 工具执行结果                       │
│ 4   │ assistant-reply │ 普通回复                          │
│ 5   │ user-regular    │ 普通用户消息                       │
└─────┴─────────────────┴────────────────────────────────────┘

最终组装结果（Token 预算内）:
┌─────────────────────────────────────────────────────────────┐
│ System Prompt                                                │
│ "你是一个专业的代码助手..."                                  │
├─────────────────────────────────────────────────────────────┤
│ [高优先级] 最近 3 轮对话 + 所有子 Agent 报告                   │
│ [中优先级] 工具结果摘要                                      │
│ [低优先级] 早期对话摘要（已压缩）                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 💾 记忆系统增强指南

### 记忆插槽机制

```
┌─────────────────────────────────────────────────────────────┐
│                    Memory 插槽                              │
│                                                             │
│   默认实现：DefaultMemoryIndex                              │
│                                                             │
│   插槽覆盖后:                                                │
│   ┌─────────────────────────────────────────────────────┐  │
│   │  plugins.slots.memory = "huangdi-memory"            │  │
│   │                                                     │  │
│   │  [ huangdi-memory ] ← 你的记忆引擎!                 │  │
│   │                                                     │  │
│   │  - 跨 Agent 记忆共享                                 │  │
│   │  - 语义缓存加速                                     │  │
│   │  - 混合搜索 (向量+BM25)                              │  │
│   └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 记忆增强流程

```
用户查询："上次我们讨论的 API 认证怎么实现？"
│
▼
┌─────────────────────────────────────────────────────────────┐
│ before_prompt_build hook                                    │
│                                                             │
│ 1. 从当前 query 提取关键词：["API", "认证", "实现"]          │
│ 2. 搜索记忆：memory.search(query, { limit: 5 })            │
│ 3. 计算相关性分数                                            │
│ 4. 格式化记忆片段                                            │
└─────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────┐
│ 返回增强上下文                                              │
│                                                             │
│ {                                                           │
│   prependContext: `                                        │
│     ## 相关历史记忆                                         │
│                                                             │
│     1. [2024-01-15] API 认证方案讨论 (score: 0.92)          │
│        "建议使用 OAuth 2.0 flow..."                         │
│                                                             │
│     2. [2024-01-10] JWT Token 格式定义 (score: 0.85)        │
│        "Token 结构包含 header.payload.signature..."         │
│   `                                                          │
│ }                                                           │
└─────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────┐
│ 上下文引擎组装最终提示词                                     │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐│
│ │ [增强后的提示词]                                        ││
│ │                                                         ││
│ │ ## 相关历史记忆                                         ││
│ │ 1. API 认证方案讨论...                                   ││
│ │ 2. JWT Token 格式定义...                                 ││
│ │                                                         ││
│ │ ## 当前对话                                             ││
│ │ 用户：上次我们讨论的 API 认证怎么实现？                    ││
│ │                                                         ││
│ │ System: 你是一个专业的 API 助手...                       ││
│ └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### 记忆插件代码示例

```typescript
// 一个超简单的记忆增强插件示例
export async function activate(api: OpenClawPluginApi) {
  const memory = api.runtime.memory;

  // 🧠 在提示词构建前注入记忆
  api.on("before_prompt_build", async (event, ctx) => {
    // 搜索相关记忆
    const memories = await memory.search(event.prompt, {
      limit: 3,
      minScore: 0.4
    });

    if (memories.length === 0) {
      return undefined; // 没有相关记忆，不注入
    }

    // 格式化记忆内容
    const memoryText = memories.map((m, i) =>
      `${i + 1}. ${m.content} (相关度：${(m.score * 100).toFixed(0)}%)`
    ).join('\n');

    return {
      prependContext: `## 历史记忆参考\n\n${memoryText}\n\n`
    };
  });

  // 💾 在 LLM 响应后异步写入记忆
  api.on("llm_output", async (event, ctx) => {
    if (event.assistantTexts?.length > 0) {
      // 异步写入，不阻塞主流程
      memory.write({
        content: event.assistantTexts.join("\n"),
        metadata: {
          sessionId: event.sessionId,
          timestamp: Date.now()
        }
      }).catch(err => {
        api.logger.warn('[memory] 写入失败:', err);
      });
    }
  });
}
```

---

## 🤖 子 Agent 协同流程

### 子 Agent 生命周期

```
用户请求："分析这个代码库并生成文档"
│
▼
┌─────────────────────────────────────────────────────────────┐
│ 主 Agent 接收任务                                           │
│ 决策：需要分解为多个子任务！                                 │
└─────────────────────────────────────────────────────────────┘
│
│  生成子 Agent 1：代码结构分析
│  生成子 Agent 2：API 文档提取
│  生成子 Agent 3：示例代码整理
│
▼
┌─────────────────────────────────────────────────────────────┐
│                  子 Agent 执行流程                          │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Subagent 1   │  │ Subagent 2   │  │ Subagent 3   │      │
│  │ 代码分析     │  │ API 提取      │  │ 示例整理     │      │
│  │ (运行中...)  │  │ (运行中...)  │  │ (运行中...)  │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                 │               │
│         ▼                 ▼                 ▼               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ ✅ 完成      │  │ ✅ 完成      │  │ ✅ 完成      │      │
│  │ 输出报告     │  │ 输出报告     │  │ 输出报告     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         │                 │                 │               │
│         └─────────────────┴─────────────────┘               │
│                           │                                 │
│                           ▼                                 │
│                  ┌─────────────────┐                        │
│                  │  知识回流       │                        │
│                  │  汇总到主 Agent │                        │
│                  └─────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────┐
│ 主 Agent 汇总所有子 Agent 结果                                │
│ 生成最终回复给用户                                           │
└─────────────────────────────────────────────────────────────┘
```

### 钩子介入点

```
子 Agent 生成前
│
▼
┌─────────────────────────────────────────────────────────────┐
│ hook: subagent_spawning ⭐                                  │
│                                                             │
│ 可做的事情：                                                │
│ - 权限检查：是否有资格生成子 Agent？                        │
│ - 上下文准备：继承哪些父 Agent 的记忆？                     │
│ - 资源限制：是否超过并发子 Agent 数量？                      │
└─────────────────────────────────────────────────────────────┘
│
▼
子 Agent 生成成功
│
▼
┌─────────────────────────────────────────────────────────────┐
│ hook: subagent_spawned                                      │
│                                                             │
│ 可做的事情：                                                │
│ - 状态追踪：记录子 Agent 信息                               │
│ - 监控注册：开始监控子 Agent 进度                           │
│ - 超时设置：设置子 Agent 超时时间                           │
└─────────────────────────────────────────────────────────────┘
│
▼
子 Agent 执行中...
│
▼
子 Agent 完成
│
▼
┌─────────────────────────────────────────────────────────────┐
│ hook: subagent_ended ⭐                                     │
│                                                             │
│ 可做的事情：                                                │
│ - 知识回流：将子 Agent 结果同步到父 Agent 上下文             │
│ - 记忆同步：将子 Agent 的发现写入共享记忆                   │
│ - 状态清理：清理临时状态，释放资源                          │
└─────────────────────────────────────────────────────────────┘
```

### Huangdi 的子 Agent 管理策略

```typescript
// 子 Agent 生成前的权限检查
api.on('subagent_spawning', async (event, ctx) => {
  const currentDepth = event.parentSession?.depth ?? 0;
  const maxDepth = 3;  // 最大嵌套深度

  if (currentDepth >= maxDepth) {
    api.logger.warn('[huangdi] 达到最大子 Agent 深度，拒绝生成');
    return { abort: true, reason: 'max_depth_exceeded' };
  }

  // 准备继承的上下文
  const contextToInherit = {
    systemPrompt: event.parentSession.systemPrompt,
    recentTurns: event.parentSession.recentTurns.slice(-5),
    activeTasks: event.parentSession.activeTasks,
    keyDecisions: event.parentSession.keyDecisions
  };

  return {
    overrides: {
      context: contextToInherit
    }
  };
});

// 子 Agent 完成后的知识回流
api.on('subagent_ended', async (event, ctx) => {
  // 获取子 Agent 的输出
  const output = event.output;

  // 将重要发现写入共享记忆
  if (output.summary) {
    await api.runtime.memory.write({
      content: `[子 Agent 发现] ${output.summary}`,
      metadata: {
        source: 'subagent',
        subagentId: event.subagentId,
        parentSession: event.parentSessionKey
      }
    });
  }

  api.logger.info(`[huangdi] 子 Agent ${event.subagentId} 完成，知识已同步`);
});
```

---

## 🛠️ 实战案例

### 案例 1: 简单的命令前缀插件

功能：当用户消息以 `/doc` 开头时，自动切换到文档生成模式。

```typescript
export async function activate(api: OpenClawPluginApi) {
  api.on('before_prompt_build', async (event, ctx) => {
    if (event.prompt.startsWith('/doc')) {
      return {
        systemPrompt: `你现在是专业的技术文档写作助手。

你的职责：
1. 生成结构清晰的技术文档
2. 使用 Markdown 格式
3. 包含代码示例和注释
4. 提供 API 参考和用法说明

请直接开始生成文档，不要有多余的寒暄。`,
        prependContext: '用户请求的是文档生成任务...\n'
      };
    }
    return undefined;
  });
}
```

### 案例 2: 敏感操作确认插件

功能：当检测到危险命令（如 `rm -rf`、`DROP TABLE`）时，要求用户二次确认。

```typescript
export async function activate(api: OpenClawPluginApi) {
  const DANGEROUS_PATTERNS = [
    /rm\s+-rf/,
    /DROP\s+TABLE/i,
    /DELETE\s+FROM/i,
    /format\s+C:/i
  ];

  api.on('before_tool_call', async (event, ctx) => {
    const toolName = event.toolCall.name;
    const args = JSON.stringify(event.toolCall.arguments);

    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(args)) {
        api.logger.warn(`[security] 检测到危险操作：${toolName}`);

        // 阻止调用并请求用户确认
        return {
          abort: true,
          reason: 'dangerous_operation_detected',
          message: '⚠️ 检测到危险操作，请确认是否继续：' + args
        };
      }
    }

    return undefined;
  });
}
```

### 案例 3: 对话摘要插件

功能：每 10 轮对话自动生成摘要并写入记忆。

```typescript
let turnCount = 0;

export async function activate(api: OpenClawPluginApi) {
  api.on('agent_end', async (event, ctx) => {
    turnCount++;

    if (turnCount >= 10) {
      turnCount = 0;

      // 获取最近 10 轮对话
      const recentHistory = ctx.session.messages.slice(-20);

      // 调用 LLM 生成摘要
      const summary = await generateSummary(recentHistory);

      // 写入记忆
      await api.runtime.memory.write({
        content: `[对话摘要] ${summary}`,
        metadata: {
          type: 'conversation_summary',
          turnRange: `${turnCount - 10}-${turnCount}`
        }
      });

      api.logger.info('[summary] 已生成本轮对话摘要');
    }
  });
}

async function generateSummary(messages: AgentMessage[]): Promise<string> {
  // 调用 LLM API 生成摘要...
  return '用户询问了 X 问题，助手提供了 Y 解决方案...';
}
```

---

## 📚 附录：快速参考卡片

### 插件开发检查清单

```
□ 1. 创建 openclaw.plugin.json 清单文件
□ 2. 实现 register() 函数（可选）
□ 3. 实现 activate() 函数（可选）
□ 4. 注册需要的钩子处理器
□ 5. 测试插件加载和激活
□ 6. 验证钩子触发时机
□ 7. 检查错误处理和日志
□ 8. 编写使用文档
```

### 常用钩子速查

| 需求 | 推荐钩子 |
|-----|---------|
| 修改系统提示词 | `before_prompt_build` |
| 注入记忆/上下文 | `before_prompt_build` |
| 动态选择模型 | `before_model_resolve` |
| 拦截工具调用 | `before_tool_call` |
| 审计/日志 | `llm_input`, `llm_output` |
| 子 Agent 管理 | `subagent_spawning`, `subagent_ended` |
| 消息过滤 | `message_sending` |

### 调试技巧

```bash
# 启用调试日志
openclaw config set plugins.debug=true

# 查看插件列表
openclaw plugins list

# 查看已注册的钩子
openclaw plugins hooks --verbose

# 实时查看日志
tail -f ~/.openclaw/logs/openclaw.log | grep -i plugin
```

---

*文档版本：2.0.0*
*最后更新：2026-03-16*
*维护者：OpenClaw Team*
