# Phase 3: 分层上下文引擎与跨 Agent 记忆同步

**创建日期**: 2026-03-24
**状态**: 实施中
**预计时间**: 2 周

---

## 一、现状分析

### 当前问题

根据架构审查报告，当前 Memory/Context 系统存在以下问题：

| 问题 | 严重程度 | 影响 |
|------|----------|------|
| HierarchicalContextEngine 未实际使用 | 🔴 高 | 上下文管理缺失 |
| 跨 Agent 记忆同步未实现 | 🔴 高 | 重复工作增加 52% |
| Memory 注入使用 `@ts-ignore` | 🟡 中 | 类型安全隐患 |
| 无 Fallback 策略 | 🟡 中 | 静默失败风险 |
| 缺少测试覆盖 | 🟡 中 | 代码质量 0% |

### 现有组件

```
src/context/
├── HierarchicalContextEngine.ts  # 4 层上下文管理 (已有基础实现)
└── PositionOptimizer.ts          # "Lost in the Middle"优化 (完整实现)

src/memory/
├── HybridSearchEngine.ts         # 混合搜索 (RRF + BM25 + Vector) (完整实现)
└── SemanticCache.ts              # 语义缓存 (需要实现 embed 方法)
```

### 目标架构

```
┌─────────────────────────────────────────────────────────┐
│              Phase 3 目标架构                            │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐   │
│  │         HierarchicalContextEngine                │   │
│  │  ┌───────────────────────────────────────────┐  │   │
│  │  │  System Layer (priority: 0)               │  │   │
│  │  │  - 系统指令、核心原则                      │  │   │
│  │  ├───────────────────────────────────────────┤  │   │
│  │  │  Task Layer (priority: 10)                │  │   │
│  │  │  - 任务描述、约束条件                      │  │   │
│  │  ├───────────────────────────────────────────┤  │   │
│  │  │  Team Layer (priority: 20)                │  │   │
│  │  │  - 角色组共享知识                          │  │   │
│  │  ├───────────────────────────────────────────┤  │   │
│  │  │  Local Layer (priority: 30)               │  │   │
│  │  │  - 个人工作区、临时变量                    │  │   │
│  │  └───────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────┘   │
│                          │                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │            CrossAgentMemoryRouter               │   │
│  │  - 记忆路由 (Local → Team → Global)             │   │
│  │  - 跨 Agent 同步 (CRDT 冲突解决)                  │   │
│  │  - 蒸馏压缩 (子 → 父知识回流)                    │   │
│  └─────────────────────────────────────────────────┘   │
│                          │                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │           Memory-Plugin Integration             │   │
│  │  - before_prompt_build Hook                     │   │
│  │  - Fallback 策略 (本地 → 共享 → 空)               │   │
│  │  - 类型安全的 Memory API                        │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 二、实施步骤

### Step 1: 增强 HierarchicalContextEngine (2 天)

**目标**: 添加 4 层上下文管理，支持 Local/Team/Global 层级

**任务**:
1. 修改 ContextLayer 支持 4 层结构
2. 添加层级间同步方法
3. 添加知识蒸馏方法
4. 集成 HybridSearchEngine

**代码**:
```typescript
// src/context/HierarchicalContextEngine.ts

export type ContextLayerType = 'system' | 'task' | 'team' | 'local';

export interface ContextLayer {
  type: ContextLayerType;
  name: string;
  priority: number;
  messages: AgentMessage[];
  memories: MemoryRecord[];  // 新增
  compressible: boolean;
}

export interface MemoryRecord {
  id: string;
  content: string;
  embedding?: number[];
  metadata: {
    source: string;
    agentId?: string;
    taskId?: string;
    timestamp: number;
    importance: number;
  };
}

export class HierarchicalContextEngine {
  // 4 层上下文
  private systemLayer: ContextLayer;
  private taskLayer: ContextLayer;
  private teamLayer: ContextLayer;
  private localLayer: ContextLayer;

  // 记忆管理
  private memories: Map<string, MemoryRecord> = new Map();
  private searchEngine: HybridSearchEngine;

  // 跨 Agent 同步
  async syncToParent(agentId: string, parentAgentId: string): Promise<void>;
  async broadcastToTeam(teamId: string, memory: MemoryRecord): Promise<void>;
  async distillKnowledge(agentId: string): Promise<MemoryRecord[]>;
}
```

---

### Step 2: 实现 CrossAgentMemoryRouter (3 天)

**目标**: 实现跨 Agent 记忆路由和同步

**任务**:
1. 创建 MemoryRouter 类
2. 实现三层记忆查询
3. 实现 CRDT 冲突解决
4. 实现记忆蒸馏压缩

**代码**:
```typescript
// src/memory/CrossAgentMemoryRouter.ts

export interface MemoryRouterConfig {
  syncInterval: number;       // 同步间隔 (ms)
  maxMemoriesPerAgent: number; // 每 Agent 最大记忆数
  distillThreshold: number;    // 蒸馏阈值 (重要性分数)
}

export interface MemoryQueryResult {
  memories: MemoryRecord[];
  source: 'local' | 'team' | 'global';
  similarityScore: number;
}

export class CrossAgentMemoryRouter {
  // 三层记忆存储
  private localMemories: Map<string, MemoryRecord[]> = new Map();  // agentId -> memories
  private teamMemories: Map<string, MemoryRecord[]> = new Map();   // teamId -> memories
  private globalMemories: MemoryRecord[] = [];

  // 查询方法
  async query(
    agentId: string,
    query: string,
    scope: 'local' | 'team' | 'global' | 'all'
  ): Promise<MemoryQueryResult[]>;

  // 添加记忆
  async addMemory(
    agentId: string,
    content: string,
    metadata: MemoryMetadata
  ): Promise<string>;

  // 同步到父 Agent
  async syncToParent(childAgentId: string, parentAgentId: string): Promise<void>;

  // 蒸馏知识 (压缩子 Agent 记忆)
  async distillKnowledge(agentId: string): Promise<MemoryRecord[]>;
}
```

---

### Step 3: 集成到 OpenClaw 插件 (2 天)

**目标**: 将 Memory/Context 系统注入 OpenClaw Plugin

**任务**:
1. 创建类型安全的 Memory API
2. 修改 before_prompt_build Hook
3. 添加 Fallback 策略
4. 支持运行时记忆搜索

**代码**:
```typescript
// src/plugin.ts

interface MemoryApi {
  // 搜索记忆
  search(query: string, options?: {
    limit?: number;
    scope?: 'local' | 'team' | 'global';
    agentId?: string;
  }): Promise<MemoryRecord[]>;

  // 添加记忆
  add(content: string, metadata?: MemoryMetadata): Promise<string>;

  // 获取上下文
  getContext(agentId: string): Promise<AgentMessage[]>;
}

const plugin = {
  contextEngine: new HierarchicalContextEngine(),
  memoryRouter: new CrossAgentMemoryRouter(),

  setApi(api: OpenClawPluginApi) {
    // 注入 Memory API (类型安全)
    api.runtime.memory = {
      search: this.contextEngine.search.bind(this.contextEngine),
      add: this.memoryRouter.addMemory.bind(this.memoryRouter),
    };
  },

  async on('before_prompt_build', async (event) => {
    try {
      // 获取上下文 (带 Fallback)
      const context = await this.contextEngine.getContext(event.agentId);
      const memories = await this.contextEngine.search(event.prompt, {
        limit: 5,
        agentId: event.agentId
      });

      // 注入到 prompt
      if (context.length > 0) {
        event.prompt.addSystemMessage(context);
      }
      if (memories.length > 0) {
        event.prompt.addUserMessage(
          `Relevant memories:\n${memories.map(m => `- ${m.content}`).join('\n')}`
        );
      }
    } catch (error) {
      // Fallback: 静默失败，不影响 prompt 构建
      api.logger.warn(`Memory injection failed: ${error}`);
    }
  })
};
```

---

### Step 4: 完善 SemanticCache (1 天)

**目标**: 实现实际的 Embedding 方法

**任务**:
1. 支持多种 Embedding 后端 (HuggingFace / OpenAI / 本地模型)
2. 添加 Embedding 缓存
3. 批量 Embedding 支持

**代码**:
```typescript
// src/memory/SemanticCache.ts

export type EmbeddingProvider = 'huggingface' | 'openai' | 'local';

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  model?: string;
  apiKey?: string;
  dimension: number;
}

export class SemanticCache {
  private embeddingModel?: any;
  private config: EmbeddingConfig;

  protected async embed(text: string): Promise<number[]> {
    switch (this.config.provider) {
      case 'openai':
        return this.embedWithOpenAI(text);
      case 'huggingface':
        return this.embedWithHuggingFace(text);
      case 'local':
        return this.embedWithLocal(text);
      default:
        return this.embedWithHuggingFace(text);
    }
  }

  private async embedWithHuggingFace(text: string): Promise<number[]> {
    // 使用 @xenova/transformers 本地运行
    const { pipeline } = await import('@xenova/transformers');
    const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    const result = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(result.data) as number[];
  }
}
```

---

### Step 5: 添加测试 (2 天)

**目标**: 为 Memory/Context 模块添加完整测试

**任务**:
1. HierarchicalContextEngine 测试 (15+ 用例)
2. CrossAgentMemoryRouter 测试 (20+ 用例)
3. SemanticCache 测试 (10+ 用例)
4. 集成测试 (5+ 用例)

---

## 三、验收标准

### 功能验收

| 标准 | 验证方法 |
|------|----------|
| 4 层上下文管理正常工作 | 单元测试验证各层独立操作 |
| Local → Team → Global 路由正常 | 集成测试验证查询路径 |
| 跨 Agent 记忆同步延迟 < 500ms | 性能测试 |
| 记忆查询延迟 < 100ms | 性能测试 |
| 蒸馏后记忆压缩率 > 50% | 对比测试 |

### 性能验收

| 指标 | 当前值 | 目标值 |
|------|--------|--------|
| 记忆查询延迟 | N/A | < 100ms |
| 跨 Agent 同步延迟 | N/A | < 500ms |
| Embedding 计算时间 | N/A | < 50ms |
| 缓存命中率 | N/A | > 60% |

### 测试验收

| 模块 | 目标用例数 | 覆盖率目标 |
|------|------------|------------|
| HierarchicalContextEngine | 15+ | > 85% |
| CrossAgentMemoryRouter | 20+ | > 85% |
| SemanticCache | 10+ | > 85% |
| 集成测试 | 5+ | N/A |

---

## 四、预期收益

### 协作效率提升

| 指标 | 当前值 | 目标值 | 提升幅度 |
|------|--------|--------|----------|
| 重复工作率 | 48% | 18% | -62.5% |
| 知识传递效率 | 0% | 78% | +78pp |
| 任务完成时间 | 100% | 72% | -28% |

### 技术债务清理

| 问题 | 修复状态 |
|------|----------|
| HierarchicalContextEngine 未使用 | ✅ 修复 |
| 跨 Agent 记忆同步缺失 | ✅ 修复 |
| Memory 注入类型不安全 | ✅ 修复 |
| 无 Fallback 策略 | ✅ 修复 |
| 测试覆盖率 0% | ✅ 修复 |

**技术债务评分变化**: 5.6 → 7.2 (+28.6%)

---

## 五、风险评估

### 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| Embedding 模型加载慢 | 中 | 中 | 懒加载 + 预缓存 |
| 记忆同步冲突 | 低 | 中 | CRDT 冲突解决 |
| 内存占用过高 | 中 | 中 | LRU  eviction + 压缩 |
| 与 OpenClaw API 不兼容 | 低 | 高 | Fallback 策略 |

---

## 六、相关文件

| 文件 | 状态 | 操作 |
|------|------|------|
| `src/context/HierarchicalContextEngine.ts` | 已有 | 增强 |
| `src/context/PositionOptimizer.ts` | 已有 | 保持 |
| `src/memory/HybridSearchEngine.ts` | 已有 | 保持 |
| `src/memory/SemanticCache.ts` | 已有 | 增强 |
| `src/memory/CrossAgentMemoryRouter.ts` | 新建 | 创建 |
| `src/plugin.ts` | 已有 | 修改 |

---

**最后更新**: 2026-03-24
**负责人**: Huangdi Team
