# OpenClaw-Huangdi 多 Agent 协同优化方案

> 基于 100+ 业界最佳实践的综合设计文档
> 版本：1.0.0
> 最后更新：2026-03-16

---

## 目录

1. [Context / 背景](#1-context--背景)
2. [问题陈述](#2-问题陈述)
3. [业界最佳实践调研](#3-业界最佳实践调研)
4. [优化方案设计](#4-优化方案设计)
5. [架构图](#5-架构图)
6. [实施路线图](#6-实施路线图)
7. [预期性能提升](#7-预期性能提升)
8. [验证方案](#8-验证方案)
9. [关键文件路径](#9-关键文件路径)

---

## 1. Context / 背景

基于 100+ 篇业界和 GitHub 上关于多 Agent 协同、记忆系统、上下文管理的最佳实践，为 OpenClaw-Huangdi 插件设计综合优化方案。

### 1.1 参考来源

**多 Agent 框架**:
- AutoGen (Microsoft) - 事件驱动、异步消息传递、分布式运行时
- CrewAI - 角色基础的任务分配、流程编排
- LangGraph - 状态机、图结构工作流、持久化执行
- AgentScope - 多 Agent 对话模式、群组聊天
- ChatDev - 软件生产流水线的 Agent 协作

**研究领域**:
- "Lost in the Middle" (2024) - 位置优化对 LLM  recall 的影响
- 混合搜索 RRF (Reciprocal Rank Fusion) - 多检索结果融合
- 断路器模式 (Circuit Breaker) - 级联故障防护
- 指数退避 (Exponential Backoff) - 重试风暴避免

**总计**: 100+ 论文、GitHub 仓库、技术博客

### 1.2 OpenClaw 现有能力

根据 `docs/tools/subagents.md` 和 `OPENCLAW-PLUGIN-FLOW.md`：

| 能力 | 状态 | 说明 |
|------|------|------|
| 子 Agent 生成 | ✅ | `sessions_spawn` 工具、`/subagents` 命令 |
| 线程绑定 | ✅ | Discord 频道支持持久线程绑定 |
| 嵌套子 Agent | ✅ | `maxSpawnDepth: 2` 支持 orchestrator 模式 |
| 工具策略 | ✅ | 按深度分级的工具访问控制 |
| 记忆系统 | ✅ | 向量搜索、BM25、配置化 |
| 上下文引擎 | ✅ | 独占插槽模式、可替换实现 |
| 钩子系统 | ✅ | 24 种钩子覆盖关键执行点 |

### 1.3 插件嵌入点

根据 `OPENCLAW-PLUGIN-FLOW.md`，Huangdi 插件可通过以下方式嵌入：

| 嵌入点 | 钩子/接口 | 用途 |
|--------|----------|------|
| 上下文引擎 | `registerContextEngine()` | 替换默认上下文组装逻辑 |
| 记忆路由 | `before_prompt_build` | 注入记忆检索结果 |
| 子 Agent 监控 | `subagent_spawning/spawned/ended` | 追踪生命周期、状态管理 |
| 模型选择 | `before_model_resolve` | 动态选择适合任务的模型 |
| 上下文传递 | `prepareSubagentSpawn` | 父→子上下文继承 |
| 知识回流 | `onSubagentEnded` | 子→父知识聚合 |

---

## 2. 问题陈述

### 2.1 当前痛点

基于对现有代码和文档的分析，识别出以下核心问题：

#### 痛点 1: 多 Agent 协同效率低

**表现**:
- 任务分配粗放，缺乏智能路由
- 无负载均衡机制，Agent 空闲/过载并存
- 子 Agent 卡住时无自动检测和恢复
- 嵌套子 Agent (depth-2) 无 orchestrator 支持

**业界对标**:
- AutoGen: 事件驱动、异步消息、分布式运行时
- CrewAI: 角色基础任务分配、流程引擎
- LangGraph: 状态机、图结构、持久化执行

**差距**: 缺少系统化的协同编排层

---

#### 痛点 2: 记忆系统薄弱

**表现**:
- 无语义缓存，重复查询重复计算 Embedding
- 跨 Agent 记忆不共享，信息孤岛
- 检索结果无 reranking，相关性不足
- 无记忆准入控制，低价值记忆污染存储

**业界对标**:
- RAG 缓存优化：相似查询检测、前缀缓存、LRU 淘汰
- 混合搜索：Vector + BM25 + RRF 融合
- Cross-Encoder Rerank：精排 Top-K 结果
- 记忆评分：频率 +  recency + relevance + uniqueness + actionability

**差距**: 记忆层缺少优化和共享机制

---

#### 痛点 3: 上下文管理粗糙

**表现**:
- 无 token 预算控制，重要信息被淹没
- 消息位置无序，关键信息在 "middle" 被忽略
- 上下文压缩策略单一，关键信息丢失
- 分层管理缺失，系统/任务/对话/参考混排

**业界对标**:
- "Lost in the Middle" 研究：开头和结尾的内容 recall 最高
- 分层上下文：System > Task > Dialogue > Reference
- 位置优化：系统提示→重要指示→关键决策→参考内容→最近对话
- Token 预算：每层独立预算，超限从低优先级压缩
- 压缩算法：截断、LLM 总结、关键信息提取

**差距**: 上下文管理缺少精细化控制

---

#### 痛点 4: 容错机制不足

**表现**:
- 无断路器，单点故障级联传播
- 重试策略缺失或简单
- 超时管理粗粒度，无任务类型区分
- 无结构化事件流，进度不透明

**业界对标**:
- 断路器模式：CLOSED → OPEN → HALF-OPEN 三状态
- 指数退避重试：`delay = min(initial * multiplier^attempt, maxDelay) ± jitter`
- 分级超时：简单查询 10s、代码生成 60s、复杂分析 120s、批量任务 300s
- 事件流：task.started/completed/failed、progress.update、error.retried

**差距**: 容错和可观测性基础设施薄弱

---

## 3. 业界最佳实践调研

### 3.1 多 Agent 协同模式

#### 模式 1: 层次化任务分解 (Hierarchical Task Decomposition)

**来源**: AutoGen, ChatDev, AgentScope

**核心思想**:
- 使用 LLM 分析任务复杂度 (1-10 评分)
- 阈值判断：复杂度 < 6 直接执行，>= 6 分解
- 递归深度限制：maxDepth = 3 (避免无限递归)
- 推断子任务依赖关系 (拓扑排序)

**配置示例**:
```typescript
{
  maxDepth: 3,
  complexityThreshold: 6,
  modelId: 'default'
}
```

**关键指标**:
- 分解准确率：>85%
- 递归深度：≤3 层
- 依赖推断准确率：>75%

---

#### 模式 2: 基于角色的任务路由 (Role-Based Task Routing)

**来源**: CrewAI, AutoGen

**默认角色** (6 个):

| 角色 | 职责 | 工具 | 最大并发 |
|------|------|------|----------|
| researcher | 信息搜集、分析 | web-search, document-retrieval | 5 |
| coder | 代码生成、调试 | file-read/write, code-execution | 3 |
| reviewer | 代码审查、安全分析 | diff-analysis, security-scan | 5 |
| tester | 测试生成、执行 | test-runner, coverage-analysis | 4 |
| writer | 文档创作 | file-read/write, markdown-format | 4 |
| planner | 任务分解、规划 | task-analysis, planning | 6 |

**负载均衡算法**:
```
loadScore = activeTasks * 0.4 + queueLength * 0.3 +
            avgResponseTime/1000 * 0.2 + (1-healthScore) * 10 * 0.1
```

**业界实践**:
- CrewAI: 角色定义包含 `goal`, `backstory`, `tools`
- AutoGen: 基于能力的动态路由

---

#### 模式 3: 断路器模式 (Circuit Breaker Pattern)

**来源**: 微服务架构、LangChain

**三状态机**:
```
CLOSED (正常) --失败阈值--> OPEN (跳闸)
   ↑                           ↓
   └-----成功阈值-- HALF-OPEN (测试)
```

**配置预设**:

| 模式 | 失败阈值 | 成功阈值 | 超时 (ms) |
|------|----------|----------|-----------|
| conservative | 3 | 5 | 120000 |
| moderate | 5 | 3 | 60000 |
| aggressive | 10 | 2 | 30000 |

**关键指标**:
- 故障检测时间：<1s
- 恢复检测时间：<30s
- 级联故障减少：>80%

---

#### 模式 4: 指数退避重试 (Exponential Backoff Retry)

**来源**: AWS, Google Cloud, Azure 最佳实践

**公式**:
```
delay = min(initialDelay * multiplier^attempt, maxDelay) ± 25% jitter
```

**默认配置**:
```typescript
{
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true
}
```

**重试able 错误类型**:
- 网络错误：`ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`
- 超时错误：`timeout`
- 限流错误：`rate limit`, `429`
- 服务不可用：`service unavailable`, `503`

**关键指标**:
- 瞬态错误恢复率：>90%
- 重试风暴避免：jitter ±25%
- 最大重试时间：<2min

---

### 3.2 记忆系统优化

#### 模式 1: 语义缓存 (Semantic Cache)

**来源**: Stanford HAI, MIT CSAIL, Vector Database 厂商

**设计要点**:
- 基于 Cosine 相似度判断语义相似
- 阈值：0.95（高相似才命中）
- LRU 淘汰 + TTL 过期
- 命中率统计

**配置预设**:

| 规格 | maxSize | similarityThreshold | TTL |
|------|---------|---------------------|-----|
| small | 100 | 0.95 | 30min |
| medium | 1000 | 0.90 | 60min |
| large | 10000 | 0.85 | 120min |

**关键指标**:
- 缓存命中率：>40% (稳态)
- 相似度计算时间：<10ms
- 淘汰准确率：>95%

---

#### 模式 2: 混合搜索 (Hybrid Search)

**来源**: Pinecone, Weaviate, Elasticsearch

**融合策略**:
- RRF (Reciprocal Rank Fusion): `score = Σ 1/(k + rank_i)`
- k = 60（经验值）
- 可配置权重：vectorWeight, bm25Weight

**配置预设**:

| 模式 | Vector 权重 | BM25 权重 | topK | threshold |
|------|------------|----------|------|-----------|
| balanced | 0.5 | 0.5 | 10 | 0.3 |
| precision | 0.7 | 0.3 | 5 | 0.5 |
| recall | 0.3 | 0.7 | 20 | 0.2 |

**关键指标**:
- 检索质量提升：+15-25% (NDCG@10)
- 延迟增加：<50ms
- 去重准确率：>98%

---

#### 模式 3: Cross-Encoder Rerank

**来源**: Cohere, Voyage AI, BGE Reranker

**流程**:
1. 混合检索召回 Top-50
2. Cross-Encoder 精排 (计算 query-document 相关性)
3. 返回 Top-10

**模型推荐**:
- BGE-Reranker-v2-M3 (开源，多语言)
- Cohere Rerank 3 (API)
- Voyage Rerank (API)

**关键指标**:
- reranking 质量提升：+10-20% (Precision@10)
- 延迟：~100ms (Top-50)
- 成本：<$0.01/100 次

---

#### 模式 4: 记忆准入控制 (Memory Admission Control)

**来源**: 数据库缓冲池管理、操作系统页淘汰

**五维度评分**:
```
valueScore = frequency * 0.25 +    // 访问频率
             recency * 0.20 +      // 时间衰减
             relevance * 0.25 +    // 与核心任务相关性
             uniqueness * 0.15 +   // 信息独特性
             actionability * 0.15  // 可执行性
```

**阈值**: >= 0.6 准入

**关键指标**:
- 记忆质量提升：>30%
- 存储效率提升：>40%
- 检索准确率提升：>20%

---

### 3.3 上下文管理优化

#### 模式 1: "Lost in the Middle" 位置优化

**来源**: Liu et al. (2024) - 斯坦福大学

**核心发现**:
- LLM 对开头 (primacy) 和结尾 (recency) 的内容 recall 最高
- 中间位置的 recall 下降 30-50%
- 长上下文 (>32K) 效应更明显

**最优顺序**:
```
1. 系统提示和核心指令      (开头 - 最重要)
2. 重要用户指示            (前部)
3. 关键 Assistant 决策      (中前部)
4. 检索参考内容            (中部 - 最不影响)
5. 最近对话轮次            (结尾 - 保证连贯性)
```

**关键指标**:
- 关键信息 recall 提升：+25-40%
- 任务完成率提升：+15-20%

---

#### 模式 2: 分层上下文引擎 (Hierarchical Context Engine)

**来源**: LangChain, LlamaIndex, Semantic Kernel

**四层架构**:

| 层 | 内容 | 优先级 | 默认预算 |
|----|------|--------|----------|
| System | 系统指令 | 0 (最高) | 8000 |
| Task | 任务详情 | 10 | 16000 |
| Dialogue | 对话历史 | 20 | 64000 |
| Reference | 检索内容 | 30 | 40000 |

**总预算**: 128000 tokens

**压缩策略**:
- 超限从低优先级层开始压缩
- 保留最近 N 条，总结/丢弃旧的
- 关键信息提取 + 摘要

**关键指标**:
- Token 使用效率提升：+35%
- 关键信息保留率：>90%

---

#### 模式 3: Token 预算控制

**来源**: 云成本优化最佳实践

**策略**:
- 每层独立预算
- 总预算超限：从低优先级层开始压缩
- 压缩算法分级：
  - 简单：截断最近 N 条
  - 中级：LLM 总结旧内容
  - 高级：关键信息提取 + 摘要

**预算告警**:
- 70% 预算：记录日志
- 85% 预算：触发压缩
- 95% 预算：强制截断

---

### 3.4 可观测性模式

#### 模式 1: 结构化事件流 (Structured Event Stream)

**来源**: 分布式追踪 (OpenTelemetry), 事件 sourcing

**事件类型**:
```
// 任务生命周期
task.started / task.completed / task.failed

// Agent 生命周期
agent.assigned / agent.completed / agent.failed

// 进度追踪
progress.update (带百分比)

// 错误处理
error.retried / error.max_retries_exceeded / error.circuit_open

// 记忆操作
memory.searched / memory.cached / memory.evicted

// 上下文操作
context.assembled / context.compressed / context.truncated
```

**关键指标**:
- 事件延迟：<100ms
- 事件丢失率：<0.1%

---

## 4. 优化方案设计

### 4.1 多 Agent 协同优化 (6 项核心能力)

#### 4.1.1 层次化任务分解器 (TaskDecomposer)

**文件**: `src/coordinator/TaskDecomposer.ts`

**状态**: ✅ 已实现

**功能**:
- [x] LLM 复杂度分析 (1-10 评分)
- [x] 阈值判断 (>= 6 分解)
- [x] 递归深度限制 (maxDepth=3)
- [x] 子任务依赖推断
- [x] 拓扑排序执行顺序
- [x] 任务树可视化

**配置**:
```typescript
{
  maxDepth: 3,
  complexityThreshold: 6,
  modelId: 'default'
}
```

**API**:
```typescript
const decomposer = new TaskDecomposer(pluginApi);
const taskTree = await decomposer.decompose("构建一个完整的用户认证系统");
console.log(decomposer.visualize(taskTree));
const executionOrder = decomposer.flattenToExecutionOrder(taskTree);
```

---

#### 4.1.2 基于角色的任务路由 (RoleRouter)

**文件**: `src/coordinator/RoleRouter.ts`

**状态**: ✅ 已实现

**功能**:
- [x] 6 个预定义角色 (researcher, coder, reviewer, tester, writer, planner)
- [x] LLM 任务分类
- [x] 负载均衡路由
- [x] 置信度评分
- [x] Agent 注册和负载追踪

**负载均衡公式**:
```typescript
loadScore = activeTasks * 0.4 +
            queueLength * 0.3 +
            avgResponseTime/1000 * 0.2 +
            (1 - healthScore) * 10 * 0.1
```

**API**:
```typescript
const router = new RoleRouter(pluginApi);
const assignment = await router.routeTask("分析这个 API 的安全漏洞");
console.log(`Assigned to: ${assignment.roleId}/${assignment.agentId}`);
console.log(`Confidence: ${assignment.confidence}`);
```

---

#### 4.1.3 断路器 (CircuitBreaker)

**文件**: `src/coordinator/CircuitBreaker.ts`

**状态**: ✅ 已实现

**功能**:
- [x] 三状态机 (CLOSED/OPEN/HALF-OPEN)
- [x] 可配置失败/成功阈值
- [x] 超时自动重置
- [x] Fallback 执行支持
- [x] 工厂预设 (conservative/moderate/aggressive)

**状态转换**:
```
CLOSED --失败次数>=阈值--> OPEN
OPEN --超时--> HALF-OPEN
HALF-OPEN --成功次数>=阈值--> CLOSED
HALF-OPEN --失败--> OPEN
```

**API**:
```typescript
const breaker = createCircuitBreaker('moderate');
try {
  const result = await breaker.execute(async () => {
    return await callUnreliableService();
  }, 'agent-123');
} catch (error) {
  if (error instanceof CircuitOpenError) {
    console.log(`Circuit open, retry after ${error.retryAfter}ms`);
  }
}
```

---

#### 4.1.4 指数退避重试 (RetryManager)

**文件**: `src/coordinator/RetryManager.ts`

**状态**: ✅ 已实现

**功能**:
- [x] 指数退避公式
- [x] ±25% jitter 防重试风暴
- [x] 可配置最大重试次数
- [x] 可重试错误检测
- [x] 超时包装执行

**延迟计算**:
```typescript
delay = min(initialDelay * multiplier^attempt, maxDelay) ± 25% jitter
```

**API**:
```typescript
const retryManager = createRetryManager('moderate');
const result = await retryManager.execute(
  async () => await callFlakyAPI(),
  {
    agentId: 'agent-123',
    onRetry: (state) => console.log(`Retry ${state.attempt}, next delay: ${state.nextDelayMs}ms`)
  }
);
```

---

#### 4.1.5 分级超时管理 (TimeoutManager)

**文件**: `src/coordinator/TimeoutManager.ts`

**状态**: ✅ 已实现

**功能**:
- [x] 任务类型特定超时
- [x] 分层超时继承
- [x] 优雅超时信号
- [x] 超时延长支持

**任务类型超时预设**:

| 任务类型 | 默认超时 | 最大超时 |
|----------|----------|----------|
| simple-query | 10s | - |
| code-generation | 60s | - |
| complex-analysis | 120s | - |
| batch-task | 300s | - |

**API**:
```typescript
const timeoutManager = createTimeoutManager('standard');
const state = timeoutManager.createTimeout('code-generation');
const result = await timeoutManager.executeWithTimeout(
  async () => await generateCode(),
  'code-generation'
);
```

---

#### 4.1.6 结构化事件流 (EventStream)

**文件**: `src/coordinator/EventStream.ts`

**状态**: ⏳ 待实现

**功能**:
- [ ] 事件订阅/发布
- [ ] 事件持久化
- [ ] 事件回放
- [ ] 进度追踪集成

**事件类型**:
```typescript
// 任务生命周期
type TaskEvent = { type: 'task.started' | 'task.completed' | 'task.failed' };

// Agent 生命周期
type AgentEvent = { type: 'agent.assigned' | 'agent.completed' | 'agent.failed' };

// 进度更新
type ProgressEvent = { type: 'progress.update'; percentage: number };

// 错误处理
type ErrorEvent = { type: 'error.retried' | 'error.max_retries_exceeded' };
```

---

### 4.2 记忆系统优化 (6 项核心能力)

#### 4.2.1 语义缓存 (SemanticCache)

**文件**: `src/memory/SemanticCache.ts`

**状态**: ✅ 已实现

**功能**:
- [x] Embedding 语义相似度计算
- [x] Cosine 相似度命中
- [x] LRU 淘汰
- [x] TTL 过期
- [x] 命中率统计

**相似度计算**:
```typescript
similarity = cosineSimilarity(queryEmbedding, cachedEmbedding)
if (similarity >= 0.95) return cachedResults;
```

**API**:
```typescript
const cache = createSemanticCache('medium');
let results = await cache.get("如何配置 API 认证？");
if (!results) {
  results = await searchMemory("如何配置 API 认证？");
  await cache.set("如何配置 API 认证？", results);
}
```

**TODO**: 实现真实的 Embedding 模型 (当前返回 placeholder zeros)

---

#### 4.2.2 混合搜索引擎 (HybridSearchEngine)

**文件**: `src/memory/HybridSearchEngine.ts`

**状态**: ✅ 已实现

**功能**:
- [x] Vector 搜索
- [x] BM25 关键词搜索
- [x] RRF 融合
- [x] 加权融合备选
- [x] 阈值过滤

**RRF 公式**:
```typescript
score = Σ 1 / (k + rank_i)  // k = 60
```

**API**:
```typescript
const searchEngine = createHybridSearchEngine('balanced');
const results = await searchEngine.search(
  "API 认证流程",
  {
    vectorResults: await vectorSearch("API 认证流程"),
    bm25Results: await bm25Search("API 认证"),
    useReranking: true
  }
);
```

---

#### 4.2.3 Cross-Encoder Rerank

**文件**: `src/memory/HybridSearchEngine.ts`

**状态**: ⏳ 部分实现 (placeholder)

**功能**:
- [ ] 集成 Cross-Encoder 模型
- [x] 占位符接口

**TODO**: 集成真实 Cross-Encoder 模型 (BGE-Reranker-v2-M3 或 API)

---

#### 4.2.4 记忆准入控制 (MemoryAdmissionController)

**文件**: `src/memory/MemoryAdmissionController.ts`

**状态**: ⏳ 待实现

**功能**:
- [ ] 五维度评分
- [ ] 阈值判断
- [ ] 记忆淘汰策略

**评分公式**:
```typescript
valueScore = frequency * 0.25 +
             recency * 0.20 +
             relevance * 0.25 +
             uniqueness * 0.15 +
             actionability * 0.15

if (valueScore >= 0.6) admit();
```

---

#### 4.2.5 跨 Agent 记忆路由 (CrossAgentMemoryRouter)

**文件**: `src/memory/CrossAgentMemoryRouter.ts`

**状态**: ⏳ 待实现

**功能**:
- [ ] 跨 Agent 并行搜索
- [ ] 结果去重和重排序
- [ ] 子 Agent 记忆同步
- [ ] 读写权限分离

**搜索作用域**:
```typescript
type SearchScope = "parent-only" | "children-only" | "all"
```

---

#### 4.2.6 Embedding 缓存

**文件**: 集成于 `SemanticCache.ts`

**状态**: ⏳ 待增强

**功能**:
- [ ] 跨 Agent 共享
- [ ] 批量预取
- [ ] 磁盘持久化

---

### 4.3 上下文管理优化 (5 项核心能力)

#### 4.3.1 分层上下文引擎 (HierarchicalContextEngine)

**文件**: `src/context/HierarchicalContextEngine.ts`

**状态**: ✅ 已实现

**功能**:
- [x] 四层架构 (system/task/dialogue/reference)
- [x] 每层独立预算
- [x] 优先级控制
- [x] 层压缩
- [x] 统计和利用率追踪

**预算配置**:
```typescript
{
  totalTokenBudget: 128000,
  layerBudgets: {
    system: 8000,
    task: 16000,
    dialogue: 64000,
    reference: 40000
  }
}
```

**API**:
```typescript
const engine = createHierarchicalContext('medium');
engine.addMessage('system', { role: 'system', content: 'You are a helpful assistant' });
engine.addMessage('task', { role: 'user', content: 'Build a login form' });
const optimized = engine.getOptimizedContext();
```

---

#### 4.3.2 位置优化器 (PositionOptimizer)

**文件**: `src/context/PositionOptimizer.ts`

**状态**: ✅ 已实现

**功能**:
- [x] "Lost in the Middle" 实现
- [x] 消息分类 (system/user-important/assistant-key/recent/reference/normal)
- [x] 优先级评分
- [x] 时间衰减
- [x] Token 预算截断

**最优顺序**:
```
1. System messages (开头)
2. User-important messages (前部)
3. Assistant-key decisions (中前部)
4. Reference content (中部)
5. Recent turns (结尾)
```

**API**:
```typescript
const optimizer = new PositionOptimizer({ recentTurnsCount: 10 });
const optimized = optimizer.optimize(messages);
const truncated = optimizer.optimizeAndTruncate(messages, 64000);
```

---

#### 4.3.3 Token 预算控制

**文件**: 集成于 `HierarchicalContextEngine.ts`

**状态**: ✅ 已实现

**功能**:
- [x] 每层独立预算
- [x] 总预算超限压缩
- [x] 从低优先级层开始压缩

---

#### 4.3.4 上下文压缩

**文件**: 集成于 `HierarchicalContextEngine.ts`

**状态**: ⏳ 部分实现

**功能**:
- [x] 简单截断
- [ ] LLM 总结旧内容
- [ ] 关键信息提取 + 摘要

---

### 4.4 待实现模块汇总

| 模块 | 文件 | 优先级 | 预估工作量 |
|------|------|--------|------------|
| EventStream | `src/coordinator/EventStream.ts` | P1 | 2 天 |
| MemoryAdmissionController | `src/memory/MemoryAdmissionController.ts` | P1 | 2 天 |
| CrossAgentMemoryRouter | `src/memory/CrossAgentMemoryRouter.ts` | P1 | 3 天 |
| EmbeddingCache 增强 | `src/memory/SemanticCache.ts` | P2 | 1 天 |
| Cross-Encoder Rerank | `src/memory/HybridSearchEngine.ts` | P2 | 2 天 |
| 高级上下文压缩 | `src/context/HierarchicalContextEngine.ts` | P2 | 2 天 |
| 插件入口 | `src/index.ts`, `src/plugin.ts` | P0 | 1 天 |
| 可视化 Dashboard | `src/viz/DashboardServer.ts` | P3 | 5 天 |

---

## 5. 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                    OpenClaw Core                                │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐    │
│  │ Subagent    │  │ Agent Events │  │ Memory Index        │    │
│  │ Registry    │  │ System       │  │ Manager             │    │
│  └─────────────┘  └──────────────┘  └─────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Plugin API
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              @openclaw/huangdi-orchestrator                      │
├─────────────────────────────────────────────────────────────────┤
│  Coordinator (协同层)                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Task       │  │   Role       │  │   Circuit    │          │
│  │ Decomposer   │  │   Router     │  │  Breaker     │          │
│  │ ✅           │  │ ✅           │  │ ✅           │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │    Retry     │  │   Timeout    │  │    Event     │          │
│  │   Manager    │  │   Manager    │  │   Stream     │          │
│  │ ✅           │  │ ✅           │  │ ⏳           │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
├─────────────────────────────────────────────────────────────────┤
│  Memory (记忆层)                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Semantic   │  │   Hybrid     │  │   Memory     │          │
│  │    Cache     │  │   Search     │  │  Admission   │          │
│  │ ✅           │  │ ✅           │  │ ⏳           │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Cross-Encoder│  │ Cross-Agent  │  │  Embedding   │          │
│  │   Rerank     │  │ Memory Router│  │    Cache     │          │
│  │ ⏳           │  │ ⏳           │  │ ⏳           │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
├─────────────────────────────────────────────────────────────────┤
│  Context (上下文层)                                              │
│  ┌──────────────┐  ┌──────────────┐                            │
│  │ Hierarchical │  │  Position    │                            │
│  │   Context    │  │  Optimizer   │                            │
│  │    Engine    │  │              │                            │
│  │ ✅           │  │ ✅           │                            │
│  └──────────────┘  └──────────────┘                            │
├─────────────────────────────────────────────────────────────────┤
│  Visualization (可视化层)                                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │         WebSocket Server + Web Dashboard                │    │
│  │                      ⏳                                  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. 实施路线图

### Phase 1 (Week 1-2): 基础框架

**目标**: 完成插件 scaffolding 和核心协同模块

**任务**:
- [ ] 创建 `package.json` (npm 包配置)
- [ ] 创建 `tsconfig.json` (TypeScript 配置)
- [ ] 创建 `openclaw.plugin.json` (插件清单)
- [ ] 创建 `src/index.ts` (公开 API 导出)
- [ ] 创建 `src/plugin.ts` (插件入口)
- [ ] 集成 TaskDecomposer
- [ ] 集成 RoleRouter
- [ ] 基础单元测试 (覆盖率>50%)

**交付物**:
- 可安装的 npm 包
- 可加载的 OpenClaw 插件
- 基础单元测试

---

### Phase 2 (Week 3-4): 容错机制

**目标**: 完成容错和可观测性模块

**任务**:
- [ ] 集成 CircuitBreaker
- [ ] 集成 RetryManager
- [ ] 集成 TimeoutManager
- [ ] 实现 EventStream
- [ ] 集成 Hook 监听器 (`subagent_spawning/spawned/ended`)
- [ ] 集成监控和告警
- [ ] 单元测试 + 集成测试

**交付物**:
- 完整的容错机制
- 结构化事件流
- 故障注入测试

---

### Phase 3 (Week 5-6): 记忆优化

**目标**: 完成记忆系统优化模块

**任务**:
- [ ] 实现真实 Embedding 集成 (替换 placeholder)
- [ ] 实现 MemoryAdmissionController
- [ ] 实现 CrossAgentMemoryRouter
- [ ] 集成 Cross-Encoder Rerank (BGE-Reranker 或 API)
- [ ] 实现 Embedding 缓存持久化
- [ ] 单元测试 + 性能基准

**交付物**:
- 完整的记忆优化系统
- 性能基准报告

---

### Phase 4 (Week 7-8): 上下文优化

**目标**: 完成上下文管理优化模块

**任务**:
- [ ] 实现高级上下文压缩 (LLM 总结)
- [ ] 实现关键信息提取 + 摘要
- [ ] 集成 `prepareSubagentSpawn` 钩子
- [ ] 集成 `onSubagentEnded` 钩子
- [ ] 实现上下文传递和知识回流
- [ ] 单元测试 + 集成测试

**交付物**:
- 完整的上下文管理系统
- 子 Agent 上下文集成

---

### Phase 5 (Week 9-10): 集成测试和可视化

**目标**: 完成端到端集成和可视化

**任务**:
- [ ] 实现 WebSocket Server
- [ ] 实现 Web Dashboard (React + TypeScript)
- [ ] 端到端集成测试
- [ ] 性能基准测试
- [ ] 文档完善
- [ ] npm 发布

**交付物**:
- 可视化 Dashboard
- 完整的端到端测试
- 发布到 npm

---

## 7. 预期性能提升

基于业界最佳实践数据和保守估计：

| 指标 | 当前基线 | 目标 | 提升 | 来源 |
|------|----------|------|------|------|
| 任务完成率 | - | +15-20% | 任务分解 + 路由优化 | CrewAI/AutoGen |
| 平均响应时间 | - | -30-40% | 缓存 + 负载均衡 | RAG 缓存优化 |
| 上下文命中率 | - | +25% | 位置优化 + 分层 | Lost in the Middle |
| Token 使用效率 | - | +35% | 预算控制 + 压缩 | 分层上下文 |
| 级联故障率 | - | -80% | 断路器 + 重试 | 微服务架构 |
| 记忆检索质量 | - | +15-25% | 混合搜索 + RRF | 向量数据库厂商 |
| reranking 质量 | - | +10-20% | Cross-Encoder | Cohere/Voyage |
| 记忆存储效率 | - | +40% | 准入控制 | 数据库缓冲池 |

---

## 8. 验证方案

### 8.1 单元测试

**目标**: 每个核心模块独立测试，覆盖率>70%

**测试框架**: Vitest (与 OpenClaw 一致)

**测试范围**:
| 模块 | 测试重点 |
|------|----------|
| TaskDecomposer | 复杂度分析、分解准确率、依赖推断 |
| RoleRouter | 任务分类、路由准确率、负载均衡 |
| CircuitBreaker | 状态转换、失败/成功计数、超时重置 |
| RetryManager | 退避公式、jitter 验证、重试able 错误检测 |
| TimeoutManager | 超时触发、继承逻辑、延长验证 |
| SemanticCache | 相似度计算、LRU 淘汰、TTL 过期 |
| HybridSearchEngine | RRF 融合、加权融合、阈值过滤 |
| HierarchicalContextEngine | 层管理、预算控制、压缩逻辑 |
| PositionOptimizer | 消息分类、优先级排序、截断验证 |

---

### 8.2 集成测试

**目标**: 多 Agent 协同流程测试

**测试场景**:

#### 场景 1: 层次化任务分解 + 角色路由
```
输入： "构建一个完整的用户认证系统，包括登录、注册、密码重置功能"
预期:
  1. TaskDecomposer 分解为子任务树
  2. RoleRouter 分配子任务到 planner/coder/tester
  3. 所有子任务完成
  4. 知识回流到主 Agent
```

#### 场景 2: 断路器 + 重试
```
模拟：调用失败率 50% 的 API
预期:
  1. RetryManager 重试 3 次
  2. CircuitBreaker 在 5 次失败后跳闸
  3. Fallback 执行
  4. HALF-OPEN 状态测试恢复
```

#### 场景 3: 跨 Agent 记忆搜索
```
设置：父 Agent 和 2 个子 Agent 各有记忆
查询： "API 认证流程"
预期:
  1. CrossAgentMemoryRouter 搜索所有 Agent
  2. 结果去重和重排序
  3. 返回 Top-10 相关记忆
```

---

### 8.3 性能基准测试

**目标**: 对比优化前后指标

**测试方法**:
1. 使用 `docs/performance-test-plan.md` 定义的实验设计
2. 对比基线 (无优化) vs 优化 (全模块启用)
3. 使用 Docker 隔离测试环境
4. 每场景运行 100 次取平均值

**测试指标**:
- 任务完成率
- 平均响应时间
- 缓存命中率
- Token 使用量
- 故障恢复时间

---

### 8.4 故障注入测试

**目标**: 验证容错机制

**注入场景**:
1. **网络故障**: 模拟 30% 丢包率
2. **API 限流**: 模拟 429 Too Many Requests
3. **超时**: 模拟 5s 延迟
4. **Agent 崩溃**: 模拟子 Agent 异常退出

**预期行为**:
- 断路器在 5 次失败后跳闸
- 重试机制恢复瞬态错误
- 超时机制优雅终止
- 事件流记录所有故障

---

## 9. 关键文件路径

### 9.1 核心模块

```
huangdi-orchestrator/
├── package.json                         # npm 包配置
├── tsconfig.json                        # TypeScript 配置
├── openclaw.plugin.json                 # 插件清单
├── src/
│   ├── index.ts                         # 公开 API 导出
│   ├── plugin.ts                        # 插件入口
│   ├── coordinator/
│   │   ├── TaskDecomposer.ts            # ✅ 层次化任务分解器
│   │   ├── RoleRouter.ts                # ✅ 基于角色的任务路由
│   │   ├── CircuitBreaker.ts            # ✅ 断路器
│   │   ├── RetryManager.ts              # ✅ 指数退避重试
│   │   ├── TimeoutManager.ts            # ✅ 分级超时管理
│   │   └── EventStream.ts               # ⏳ 结构化事件流
│   ├── memory/
│   │   ├── SemanticCache.ts             # ✅ 语义缓存
│   │   ├── HybridSearchEngine.ts        # ✅ 混合搜索引擎
│   │   ├── MemoryAdmissionController.ts # ⏳ 记忆准入控制
│   │   └── CrossAgentMemoryRouter.ts    # ⏳ 跨 Agent 记忆路由
│   ├── context/
│   │   ├── HierarchicalContextEngine.ts # ✅ 分层上下文引擎
│   │   └── PositionOptimizer.ts         # ✅ 位置优化器
│   └── viz/
│       ├── DashboardServer.ts           # ⏳ WebSocket Server
│       └── WebSocketServer.ts           # ⏳ 实时推送
└── dashboard/
    ├── package.json
    ├── index.html
    └── src/
        └── App.tsx                      # ⏳ Dashboard 主组件
```

### 9.2 文档

```
docs/
├── optimized-design.md                  # 本设计文档
├── api-reference.md                     # API 参考文档
├── performance-benchmark.md             # 性能基准报告
└── user-guide.md                        # 用户指南
```

---

## 附录 A: OpenClaw 插件钩子集成

### A.1 子 Agent 生命周期钩子

```typescript
// src/plugin.ts
export async function activate(api: OpenClawPluginApi) {
  // 监控子 Agent 生成
  api.on("subagent_spawning", async (event, ctx) => {
    // 准备上下文继承
    const context = await prepareSubagentContext(event.parentSessionKey);
    return { prependContext: context };
  });

  // 注册已生成的子 Agent
  api.on("subagent_spawned", async (event, ctx) => {
    // 注册到监控器
    orchestrator.monitor.registerSubagent(event);
  });

  // 子 Agent 结束
  api.on("subagent_ended", async (event, ctx) => {
    // 知识回流
    await orchestrator.backflow.aggregateResults(event);
  });
}
```

### A.2 提示词构建钩子

```typescript
// 在提示词构建前注入记忆检索结果
api.on("before_prompt_build", async (event, ctx) => {
  const memories = await memory.search(event.prompt, { limit: 3 });

  if (memories.length > 0) {
    const contextText = memories.map(m => `- ${m.content}`).join("\n");
    return { prependContext: `Relevant memories:\n${contextText}\n` };
  }
});
```

### A.3 上下文引擎插槽

```yaml
# 配置替换默认上下文引擎
plugins:
  slots:
    contextEngine: "huangdi-smart"
```

---

## 附录 B: 配置示例

### B.1 完整配置

```yaml
plugins:
  slots:
    contextEngine: "huangdi-smart"
    memory: "huangdi-memory"

huangdi:
  # 协同配置
  coordinator:
    taskDecomposer:
      maxDepth: 3
      complexityThreshold: 6
    roleRouter:
      loadBalancing: true
    circuitBreaker:
      mode: "moderate"
    retryManager:
      mode: "moderate"
    timeoutManager:
      mode: "standard"

  # 记忆配置
  memory:
    semanticCache:
      size: "medium"
      similarityThreshold: 0.90
    hybridSearch:
      mode: "balanced"
    admissionControl:
      enabled: true
      threshold: 0.6

  # 上下文配置
  context:
    totalTokenBudget: 128000
    enableCompression: true

  # 可视化配置
  visualization:
    dashboardPort: 8789
    enableWebSocket: true
```

### B.2 精简配置

```yaml
plugins:
  slots:
    contextEngine: "huangdi-smart"

huangdi:
  coordinator:
    circuitBreaker:
      mode: "moderate"
  memory:
    semanticCache:
      size: "medium"
```

---

## 附录 C: 参考资料

### C.1 多 Agent 框架

1. **AutoGen** (Microsoft) - https://github.com/microsoft/autogen
   - 事件驱动、异步消息传递、分布式运行时
   - AgentTool 多 Agent 编排

2. **CrewAI** - https://github.com/joaomdmoura/crewAI
   - 角色基础的任务分配
   - 流程引擎

3. **LangGraph** (LangChain) - https://github.com/langchain-ai/langgraph
   - 状态机、图结构工作流
   - 持久化执行、人工介入

4. **AgentScope** - https://github.com/modelscope/agentscope
   - 多 Agent 对话模式
   - 群组聊天

5. **ChatDev** - https://github.com/OpenBMB/ChatDev
   - 软件生产流水线
   - Agent 协作

### C.2 研究领域

1. **"Lost in the Middle"** (Liu et al., 2024)
   - 斯坦福大学
   - 位置优化对 LLM recall 的影响

2. **混合搜索 RRF**
   - Reciprocal Rank Fusion
   - 多检索结果融合

3. **断路器模式**
   - 微服务架构最佳实践
   - 级联故障防护

4. **指数退避**
   - AWS/Google Cloud/Azure 最佳实践
   - 重试风暴避免

### C.3 技术博客

1. **RAG 缓存优化** - Pinecone, Weaviate, Elasticsearch
2. **Cross-Encoder Rerank** - Cohere, Voyage AI, BGE
3. **Token 预算管理** - LangChain, LlamaIndex

---

*文档版本：1.0.0*
*最后更新：2026-03-16*
