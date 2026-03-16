# @openclaw/huangdi-orchestrator

Multi-agent orchestrator plugin for OpenClaw with task decomposition, role-based routing, and memory optimization.

## Features

- **Task Decomposition**: Break complex tasks into subtasks with dependency tracking
- **Role-Based Routing**: Intelligent agent assignment across 6 predefined roles
- **Circuit Breaker**: Fault tolerance with configurable failure thresholds
- **Smart Retry**: Exponential backoff with ±25% jitter
- **Timeout Management**: Task-type-specific timeout budgets
- **Semantic Cache**: Embedding-based similarity caching with LRU eviction
- **Hybrid Search**: Vector + BM25 fusion with RRF ranking
- **Hierarchical Context**: Layered token budgets for optimal context management
- **Position Optimization**: "Lost in the Middle" aware message ordering

## Installation

```bash
npm install @openclaw/huangdi-orchestrator
```

## Quick Start

### Plugin Configuration

Add to your OpenClaw plugin configuration:

```json
{
  "plugins": [
    {
      "name": "@openclaw/huangdi-orchestrator",
      "config": {
        "coordinator": {
          "maxDepth": 3,
          "complexityThreshold": 6
        },
        "memory": {
          "cacheSize": 1000,
          "cacheTTL": 3600
        },
        "context": {
          "totalTokenBudget": 128000,
          "enableCompression": true
        }
      }
    }
  ]
}
```

### Programmatic Usage

```typescript
import {
  TaskDecomposer,
  RoleRouter,
  createCircuitBreaker,
  createRetryManager,
  createHierarchicalContext
} from '@openclaw/huangdi-orchestrator';

// Initialize components
const taskDecomposer = new TaskDecomposer(api);
const roleRouter = new RoleRouter(api);
const circuitBreaker = createCircuitBreaker('moderate');
const retryManager = createRetryManager('moderate');
const context = createHierarchicalContext('medium');

// Decompose a complex task
const taskTree = await taskDecomposer.decompose(
  'Build a REST API with authentication and rate limiting'
);

// Route to appropriate agent
const assignment = await roleRouter.assignRole(taskTree.rootTask);

// Execute with resilience
const result = await circuitBreaker.execute(async () => {
  return retryManager.retry(async () => {
    // Your task execution logic
  });
});
```

## Configuration Options

### Coordinator

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxDepth` | number | 3 | Maximum task tree depth |
| `complexityThreshold` | number | 6 | LLM complexity score (1-10) to trigger decomposition |

### Memory

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cacheSize` | number | 1000 | Maximum cache entries (LRU) |
| `cacheTTL` | number | 3600 | Cache entry TTL in seconds |
| `similarityThreshold` | number | 0.85 | Minimum cosine similarity for cache hits |

### Context

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `totalTokenBudget` | number | 128000 | Total context token limit |
| `enableCompression` | boolean | true | Enable automatic compression |
| `compressionThreshold` | number | 100000 | Token threshold to trigger compression |

## Module Overview

| Module | Exports | Description |
|--------|---------|-------------|
| `coordinator` | `TaskDecomposer`, `RoleRouter`, `CircuitBreaker`, `RetryManager`, `TimeoutManager` | Task orchestration and resilience |
| `memory` | `SemanticCache`, `HybridSearchEngine` | Caching and search |
| `context` | `HierarchicalContextEngine`, `PositionOptimizer` | Context management |

## Architecture

Huangdi orchestrates multi-agent workflows through three layers:

1. **Coordinator Layer**: Task decomposition and agent routing
2. **Memory Layer**: Semantic caching and hybrid search
3. **Context Layer**: Hierarchical token budgets and position optimization

For detailed design documentation, see [docs/optimized-design.md](docs/optimized-design.md).

## License

MIT
