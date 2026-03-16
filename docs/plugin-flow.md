# OpenClaw 外挂插件嵌入执行逻辑流

## 概述

OpenClaw 的插件系统设计允许外部插件深度嵌入到核心执行流程中，不仅能扩展功能（工具、频道、命令），还能优化和修改核心 Agent 的**上下文（context）**和**记忆（memory）**行为。本文档详细说明插件的执行逻辑流以及实现上下文/记忆优化的机制。

---

## 一、插件加载与注册流程

### 1.1 插件发现阶段

插件从以下 4 个来源按优先级顺序被发现：

```
1. Workspace（工作区）   → ./extensions/*
2. Global（全局）        → ~/.openclaw/extensions/*
3. Bundled（内置）       → <openclaw-install>/extensions/*
4. Config load paths     → 配置文件中指定的加载路径
```

**关键代码**: `src/plugins/discovery.ts` - `discoverOpenClawPlugins()`

扫描逻辑：递归查找包含 `openclaw.plugin.json` 清单文件的目录。

### 1.2 清单验证阶段

每个插件必须提供 `openclaw.plugin.json` 清单：

```json
{
  "id": "my-plugin",
  "kind": "context-engine",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "apiKey": { "type": "string" }
    }
  },
  "skills": ["skills"]
}
```

**必填字段**:
- `id`: 插件唯一标识符
- `configSchema`: JSON Schema 配置验证

**可选字段**:
- `kind`: 插件类型（如 `memory`, `context-engine`）
- `skills`: 技能目录列表
- `channels`: 频道 ID 列表
- `providers`: 模型提供商 ID 列表

**关键代码**: `src/plugins/manifest-registry.ts:183-324` - `loadPluginManifestRegistry()`

### 1.3 模块加载与激活

```
┌─────────────────────────────────────────────────────────────┐
│                    Plugin Loader                            │
│  src/plugins/loader.ts:596-984                              │
├─────────────────────────────────────────────────────────────┤
│  1. Discovery → Manifest Registry → Provenance Indexing     │
│  2. Jiti 动态加载每个插件模块                                │
│  3. 调用 plugin.register(api)（如果导出）                   │
│  4. 调用 plugin.activate(api)（如果导出）                   │
└─────────────────────────────────────────────────────────────┘
```

**插件 API 接口** (`src/plugins/types.ts:366-409`):

```typescript
export type OpenClawPluginApi = {
  // 基础信息
  id: string;
  name: string;
  version?: string;
  config: OpenClawConfig;
  runtime: PluginRuntime;
  logger: PluginLogger;

  // 注册能力
  registerTool: (...) => void;
  registerHook: (...) => void;
  registerContextEngine: (...) => void;  // 上下文引擎
  registerProvider: (...) => void;
  registerChannel: (...) => void;
  registerService: (...) => void;
  registerCommand: (...) => void;

  // 生命周期钩子
  on: <K extends PluginHookName>(
    hookName: K,
    handler: PluginHookHandlerMap[K],
    opts?: { priority?: number },
  ) => void;
};
```

---

## 二、插件执行流程 - 钩子系统

### 2.1 24 种插件钩子类型

插件通过钩子系统嵌入到 OpenClaw 的各个执行阶段：

| 钩子名称 | 触发时机 | 执行模式 | 可修改内容 |
|---------|---------|---------|-----------|
| `before_model_resolve` | 模型选择前 | 串行（优先级合并） | 模型/提供商覆盖 |
| `before_prompt_build` | 提示词构建前 | 串行（优先级合并） | systemPrompt, prependContext, prependSystemContext, appendSystemContext |
| `before_agent_start` | Agent 启动前（兼容旧版） | 串行 | 合并上述两种 |
| `llm_input` | 发送到 LLM 前 | 并行 | 观察输入负载 |
| `llm_output` | 接收 LLM 响应后 | 并行 | 观察输出 |
| `agent_end` | Agent 回合结束 | 并行 | 分析对话 |
| `before_compaction` | 上下文压缩前 | 并行 | - |
| `after_compaction` | 上下文压缩后 | 并行 | - |
| `before_reset` | 会话重置前 | 并行 | - |
| `message_received` | 消息接收 | 并行 | - |
| `message_sending` | 消息发送前 | 串行 | 修改/取消消息 |
| `message_sent` | 消息已发送 | 并行 | - |
| `before_tool_call` | 工具调用前 | 串行 | 修改/阻止参数 |
| `after_tool_call` | 工具调用后 | 并行 | - |
| `tool_result_persist` | 工具结果持久化 | 同步串行 | 修改结果消息 |
| `before_message_write` | 写入会话前 | 同步串行 | 修改/阻止消息 |
| `session_start` | 会话开始 | 并行 | - |
| `session_end` | 会话结束 | 并行 | - |
| `subagent_spawning` | 子 Agent 生成前 | 串行 | 准备绑定 |
| `subagent_delivery_target` | 子 Agent 投递目标 | 串行 | 路由决策 |
| `subagent_spawned` | 子 Agent 已生成 | 并行 | - |
| `subagent_ended` | 子 Agent 结束 | 并行 | - |
| `gateway_start` | 网关启动 | 并行 | - |
| `gateway_stop` | 网关停止 | 并行 | - |

**关键代码**: `src/plugins/hooks.ts:126-760` - `createHookRunner()`

### 2.2 钩子执行机制

```typescript
// 串行修改型钩子（按优先级顺序执行，结果合并）
async function runModifyingHook(hookName, event, ctx, mergeResults) {
  const hooks = getHooksSortedByPriority(hookName);
  let result;
  for (const hook of hooks) {
    const handlerResult = await hook.handler(event, ctx);
    result = mergeResults(result, handlerResult);
  }
  return result;
}

// 并行通知型钩子（fire-and-forget）
async function runVoidHook(hookName, event, ctx) {
  const hooks = getHooksSortedByPriority(hookName);
  await Promise.all(hooks.map(h => h.handler(event, ctx).catch(log)));
}
```

---

## 三、上下文优化机制

### 3.1 上下文引擎插槽（Exclusive Slot）

OpenClaw 使用**独占插槽**模式管理上下文引擎：

```typescript
// src/context-engine/registry.ts
export async function resolveContextEngine(config?: OpenClawConfig): Promise<ContextEngine> {
  // 1. 配置的插槽覆盖优先
  const slotValue = config?.plugins?.slots?.contextEngine;

  // 2. 默认使用 "legacy" 引擎
  const engineId = slotValue ?? defaultSlotIdForKey("contextEngine");

  // 3. 从注册表获取工厂函数并创建实例
  const factory = getContextEngineRegistryState().engines.get(engineId);
  return factory();
}
```

**配置示例**:

```yaml
plugins:
  slots:
    contextEngine: "my-custom-engine"  # 替换默认引擎
```

### 3.2 上下文引擎接口

```typescript
// src/context-engine/types.ts:68-177
export interface ContextEngine {
  readonly info: ContextEngineInfo;

  // 初始化会话状态
  bootstrap?(params: { sessionId: string; sessionKey?: string }): Promise<BootstrapResult>;

  // 消息摄入
  ingest(params: { sessionId: string; message: AgentMessage }): Promise<IngestResult>;
  ingestBatch?(params: { sessionId: string; messages: AgentMessage[] }): Promise<IngestBatchResult>;

  // 回合后处理（可触发后台压缩）
  afterTurn?(params: { sessionId: string; messages: AgentMessage[] }): Promise<void>;

  // 组装模型上下文（核心优化点）
  assemble(params: {
    sessionId: string;
    messages: AgentMessage[];
    tokenBudget?: number;
  }): Promise<AssembleResult>;

  // 上下文压缩
  compact(params: {
    sessionId: string;
    tokenBudget?: number;
    force?: boolean;
  }): Promise<CompactResult>;

  // 子 Agent 上下文准备
  prepareSubagentSpawn?(params: { parentSessionKey: string; childSessionKey: string }): Promise<SubagentSpawnPreparation>;
  onSubagentEnded?(params: { childSessionKey: string; reason: string }): Promise<void>;

  dispose?(): Promise<void>;
}

export type AssembleResult = {
  messages: AgentMessage[];           // 排序后的消息
  estimatedTokens: number;            // 估算 token 数
  systemPromptAddition?: string;      // 系统提示词补充
};
```

### 3.3 钩子注入点 - before_prompt_build

即使不替换整个上下文引擎，插件也可以通过钩子注入上下文：

```typescript
// src/plugins/hooks.ts:290-300
async function runBeforePromptBuild(event, ctx): Promise<PluginHookBeforePromptBuildResult | undefined> {
  return runModifyingHook("before_prompt_build", event, ctx, mergeBeforePromptBuild);
}

// 结果合并逻辑
const mergeBeforePromptBuild = (acc, next) => ({
  systemPrompt: next.systemPrompt ?? acc?.systemPrompt,
  prependContext: concatTextSegments(acc?.prependContext, next.prependContext),
  prependSystemContext: concatTextSegments(acc?.prependSystemContext, next.prependSystemContext),
  appendSystemContext: concatTextSegments(acc?.appendSystemContext, next.appendSystemContext),
});
```

**插件使用示例**:

```typescript
// 插件注册钩子处理器
api.on("before_prompt_build", async (event, ctx) => {
  return {
    // 覆盖整个系统提示词
    systemPrompt: "You are a helpful assistant with plugin-enhanced capabilities...",

    // 在上下文前添加（每回合都消耗 token）
    prependContext: "Previous conversation summary from plugin...",

    // 添加到系统提示词前缀（可被 provider 缓存）
    prependSystemContext: "[Plugin Guidance: Always check memory first]",

    // 添加到系统提示词后缀（可被 provider 缓存）
    appendSystemContext: "[Plugin: Use retrieval for factual queries]",
  };
}, { priority: 10 });
```

**优先级说明**:
- 更高优先级的钩子先执行
- 合并函数保留第一个定义的值（`acc ?? next` 模式）
- 文本段会拼接累积

---

## 四、记忆优化机制

### 4.1 记忆插槽（Memory Slot）

与上下文引擎类似，记忆系统也使用独占插槽：

```yaml
plugins:
  slots:
    memory: "my-memory-plugin"  # 替换默认记忆实现
```

**记忆插件注册**:

```typescript
// 插件清单中标识类型
{
  "id": "enhanced-memory",
  "kind": "memory",
  "configSchema": { ... }
}
```

### 4.2 记忆管理器接口

```typescript
// src/memory/manager.ts:61-840
export class MemoryIndexManager {
  // 搜索记忆
  async search(query: string, options?: SearchOptions): Promise<MemoryResult[]>;

  // 同步记忆
  async sync(params: SyncParams): Promise<SyncResult>;

  // 状态查询
  async status(): Promise<MemoryStatus>;

  // 向量可用性探测
  async probeVectorAvailability(): Promise<ProbeResult>;
}
```

### 4.3 记忆与上下文的集成

记忆插件通过以下方式影响上下文：

1. **`before_prompt_build` 钩子**: 在提示词构建前检索记忆并注入上下文
2. **`before_model_resolve` 钩子**: 根据查询类型选择更适合的模型
3. **`llm_output` 钩子**: 分析 LLM 输出并异步写入记忆

**记忆增强上下文流程**:

```
┌─────────────────────────────────────────────────────────────┐
│                   Agent Turn 开始                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  before_model_resolve hook                                   │
│  - 插件可以覆盖模型/提供商选择                               │
│  - 例如：复杂查询 → 更强模型                                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  before_prompt_build hook                                    │
│  - 插件从记忆中检索相关信息                                  │
│  - 返回 prependContext / prependSystemContext               │
│  - 合并到提示词构建                                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  assemble (ContextEngine)                                   │
│  - 上下文引擎组装最终消息列表                                │
│  - 应用 token 预算截断                                       │
│  - 可返回 systemPromptAddition                              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  llm_input hook                                              │
│  - 插件观察最终发送到 LLM 的负载                             │
│  - 可用于审计/日志                                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  LLM 调用                                                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  llm_output hook                                             │
│  - 插件接收 LLM 响应                                         │
│  - 可异步写入记忆（用于未来检索）                            │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  after_turn (ContextEngine)                                 │
│  - 上下文引擎可触发后台压缩决策                              │
│  - 持久化规范化的上下文                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 五、为什么外挂插件能优化上下文和记忆？

### 5.1 架构设计原因

1. **依赖反转**:
   - 核心定义接口（ContextEngine, MemoryIndexManager）
   - 插件实现接口并注册
   - 核心通过插槽解析使用插件实现

2. **钩子注入机制**:
   - 在关键决策点（模型选择、提示词构建、上下文组装）提供钩子
   - 插件可以修改或增强核心行为
   - 优先级系统确保确定性执行顺序

3. **插槽独占模式**:
   - `plugins.slots.contextEngine` 和 `plugins.slots.memory` 允许完全替换默认实现
   - 插件可以接管整个上下文/记忆生命周期

### 5.2 具体优化能力

| 优化类型 | 实现机制 | 效果 |
|---------|---------|------|
| **记忆检索增强** | `before_prompt_build` 钩子 + 记忆 API | 在上下文前添加相关历史记忆 |
| **上下文压缩策略** | 自定义 ContextEngine 实现 | 智能摘要、选择性修剪、语义压缩 |
| **模型动态选择** | `before_model_resolve` 钩子 | 根据查询复杂度选择合适模型 |
| **工具调用拦截** | `before_tool_call` 钩子 | 修改参数、阻止危险调用、注入额外参数 |
| **系统提示词增强** | `before_prompt_build` / `registerContextEngine` | 添加插件特定的行为指导 |
| **子 Agent 上下文隔离** | `prepareSubagentSpawn` / `onSubagentEnded` | 管理子 Agent 的上下文继承和回收 |

### 5.3 示例：记忆检索插件

```typescript
// 插件入口
export async function activate(api: OpenClawPluginApi) {
  const memory = api.runtime.memory;

  // 在提示词构建前注入记忆
  api.on("before_prompt_build", async (event, ctx) => {
    // 从记忆中检索与当前 prompt 相关的内容
    const memories = await memory.search(event.prompt, { limit: 3 });

    if (memories.length > 0) {
      const contextText = memories
        .map(m => `- ${m.content} (score: ${m.score})`)
        .join("\n");

      return {
        prependContext: `Relevant memories from previous conversations:\n${contextText}\n`,
      };
    }

    return undefined;
  }, { priority: 5 });

  // 在 LLM 响应后写入记忆
  api.on("llm_output", async (event, ctx) => {
    // 异步将重要信息写入记忆
    if (event.assistantTexts?.length > 0) {
      await memory.write({
        content: event.assistantTexts.join("\n"),
        metadata: { sessionId: event.sessionId, provider: event.provider },
      });
    }
  });
}
```

---

## 六、关键文件参考

| 文件 | 关键内容 |
|------|---------|
| `src/plugins/loader.ts:596-984` | 插件加载主流程 |
| `src/plugins/registry.ts:186-635` | 插件注册表创建 |
| `src/plugins/types.ts:366-409` | OpenClawPluginApi 接口 |
| `src/plugins/types.ts:424-996` | 24 种钩子类型定义 |
| `src/plugins/hooks.ts:126-760` | 钩子执行器实现 |
| `src/plugins/hook-runner-global.ts:36-68` | 全局钩子执行器单例 |
| `src/plugins/manifest-registry.ts:183-324` | 清单验证 |
| `src/plugins/discovery.ts` | 插件发现逻辑 |
| `src/context-engine/registry.ts:38-85` | 上下文引擎注册/解析 |
| `src/context-engine/types.ts:68-177` | ContextEngine 接口 |
| `src/memory/manager.ts:61-840` | 记忆管理器实现 |
| `src/agents/skills/plugin-skills.ts:15-89` | 插件技能目录解析 |
| `src/agents/skills.ts:292-527` | 技能加载（6 个来源） |
| `docs/plugins/manifest.md` | 清单文档 |
| `docs/plugins/agent-tools.md` | 工具注册文档 |

---

## 七、总结

OpenClaw 的插件系统通过以下机制实现深度嵌入：

1. **钩子系统**: 在 24 个关键执行点提供注入能力
2. **插槽模式**: 允许完全替换上下文引擎和记忆实现
3. **优先级执行**: 确保多个插件的确定性行为
4. **类型安全 API**: 完整的 TypeScript 接口定义

这使得外挂插件不仅能**扩展功能**，还能**修改和优化核心 Agent 的上下文组装和记忆管理行为**，实现：
- 更智能的上下文压缩策略
- 基于记忆的对话历史增强
- 动态模型选择
- 工具调用拦截和修改
- 子 Agent 上下文管理

---

## 参考链接

- 插件开发指南：https://docs.openclaw.ai/tools/plugin
- 插件清单文档：https://docs.openclaw.ai/plugins/manifest
- 工具注册文档：https://docs.openclaw.ai/plugins/agent-tools
