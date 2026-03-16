/**
 * Huangdi Orchestrator - Public API
 *
 * Multi-agent orchestrator plugin for OpenClaw with task decomposition,
 * role-based routing, and memory optimization.
 */

// Coordinator exports
export { TaskDecomposer } from './coordinator/TaskDecomposer';
export type { TaskTree, DecompositionConfig } from './coordinator/TaskDecomposer';

export { RoleRouter } from './coordinator/RoleRouter';
export type { RoleDefinition, AgentLoad, RoleAssignment, LoadBalancerConfig } from './coordinator/RoleRouter';

export { CircuitBreaker, CircuitOpenError, createCircuitBreaker } from './coordinator/CircuitBreaker';
export type { CircuitBreakerConfig } from './coordinator/CircuitBreaker';

export { RetryManager, MaxRetriesExceededError, TimeoutError, createRetryManager } from './coordinator/RetryManager';
export type { RetryConfig, RetryState } from './coordinator/RetryManager';

export { TimeoutManager, TimeoutExceededError, createTimeoutManager } from './coordinator/TimeoutManager';
export type { TimeoutConfig, TimeoutState } from './coordinator/TimeoutManager';

// Memory exports
export { SemanticCache, createSemanticCache } from './memory/SemanticCache';
export type { CacheEntry, SemanticCacheConfig } from './memory/SemanticCache';

export { HybridSearchEngine, createHybridSearchEngine } from './memory/HybridSearchEngine';
export type { SearchResult, HybridSearchConfig } from './memory/HybridSearchEngine';

// Context exports
export { HierarchicalContextEngine, createHierarchicalContext } from './context/HierarchicalContextEngine';
export type { ContextLayer, HierarchicalContextConfig, ContextSnapshot } from './context/HierarchicalContextEngine';

export { PositionOptimizer } from './context/PositionOptimizer';
export type { MessageWithPriority, MessageCategory, PositionOptimizerConfig } from './context/PositionOptimizer';

// Version
export const VERSION = '0.1.0';
