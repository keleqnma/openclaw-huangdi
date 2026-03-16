/**
 * Huangdi Orchestrator - Enhanced Timeout Manager
 *
 * Implements hierarchical timeout management for different task types.
 * Prevents indefinite hangs and enables graceful timeout handling.
 */

export interface TimeoutConfig {
  /** Default timeout in ms */
  defaultTimeoutMs: number;
  /** Maximum timeout allowed in ms */
  maxTimeoutMs: number;
  /** Timeout per task type */
  taskTimeouts: Record<string, number>;
  /** Enable timeout inheritance (parent + child) */
  enableInheritance: boolean;
}

export interface TimeoutState {
  remainingMs: number;
  deadline: number;
  isExpired: boolean;
}

/**
 * Enhanced Timeout Manager
 *
 * Features:
 * - Task-type-specific timeouts
 * - Hierarchical timeout inheritance
 * - Graceful timeout signaling
 * - Timeout extension for long-running tasks
 */
export class TimeoutManager {
  private config: TimeoutConfig;

  constructor(config?: Partial<TimeoutConfig>) {
    this.config = {
      defaultTimeoutMs: 60000,  // 1 minute
      maxTimeoutMs: 600000,     // 10 minutes
      taskTimeouts: {
        'simple-query': 10000,      // 10s
        'code-generation': 60000,   // 60s
        'complex-analysis': 120000, // 120s
        'batch-task': 300000,       // 300s
        'default': 60000            // 60s
      },
      enableInheritance: true,
      ...config
    };
  }

  /**
   * Create a timeout for a specific task type
   */
  createTimeout(taskType?: string, parentState?: TimeoutState): TimeoutState {
    const timeoutMs = this.getTimeoutForTask(taskType);
    const now = Date.now();

    if (this.config.enableInheritance && parentState) {
      // Inherit remaining time from parent, but don't exceed task-specific timeout
      const remaining = Math.min(parentState.remainingMs, timeoutMs);
      return {
        remainingMs: remaining,
        deadline: now + remaining,
        isExpired: false
      };
    }

    return {
      remainingMs: timeoutMs,
      deadline: now + timeoutMs,
      isExpired: false
    };
  }

  /**
   * Create a timeout with explicit duration
   */
  createCustomTimeout(durationMs: number, parentState?: TimeoutState): TimeoutState {
    const cappedDuration = Math.min(durationMs, this.config.maxTimeoutMs);
    const now = Date.now();

    if (this.config.enableInheritance && parentState) {
      const remaining = Math.min(parentState.remainingMs, cappedDuration);
      return {
        remainingMs: remaining,
        deadline: now + remaining,
        isExpired: false
      };
    }

    return {
      remainingMs: cappedDuration,
      deadline: now + cappedDuration,
      isExpired: false
    };
  }

  /**
   * Update timeout state (call before each operation)
   */
  update(state: TimeoutState): TimeoutState {
    const now = Date.now();
    const remaining = Math.max(0, state.deadline - now);

    return {
      ...state,
      remainingMs: remaining,
      isExpired: remaining <= 0
    };
  }

  /**
   * Check if timeout has expired
   */
  isExpired(state: TimeoutState): boolean {
    return Date.now() >= state.deadline;
  }

  /**
   * Get remaining time in ms
   */
  getRemaining(state: TimeoutState): number {
    return Math.max(0, state.deadline - Date.now());
  }

  /**
   * Extend timeout by specified duration
   */
  extend(state: TimeoutState, durationMs: number): TimeoutState {
    const newDeadline = state.deadline + durationMs;
    const maxDeadline = Date.now() + this.config.maxTimeoutMs;

    // Cap at maximum timeout
    const cappedDeadline = Math.min(newDeadline, maxDeadline);

    return {
      ...state,
      deadline: cappedDeadline,
      remainingMs: Math.max(0, cappedDeadline - Date.now()),
      isExpired: false
    };
  }

  /**
   * Execute operation with timeout
   */
  async executeWithTimeout<T>(
    operation: () => Promise<T>,
    taskType?: string,
    parentState?: TimeoutState
  ): Promise<T> {
    const timeoutState = this.createTimeout(taskType, parentState);

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timeoutId = setTimeout(() => {
        clearTimeout(timeoutId);
        reject(new TimeoutExceededError(
          taskType || 'default',
          this.getTimeoutForTask(taskType)
        ));
      }, timeoutState.remainingMs);
    });

    return Promise.race([operation(), timeoutPromise]);
  }

  /**
   * Get timeout for a specific task type
   */
  getTimeoutForTask(taskType?: string): number {
    if (!taskType) {
      return this.config.defaultTimeoutMs;
    }

    // Try exact match first
    if (this.config.taskTimeouts[taskType]) {
      return this.config.taskTimeouts[taskType];
    }

    // Try partial match
    const matchedKey = Object.keys(this.config.taskTimeouts).find(
      key => taskType.includes(key)
    );

    if (matchedKey) {
      return this.config.taskTimeouts[matchedKey];
    }

    return this.config.defaultTimeoutMs;
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<TimeoutConfig> {
    return { ...this.config };
  }
}

/**
 * Error thrown when timeout exceeded
 */
export class TimeoutExceededError extends Error {
  name = 'TimeoutExceededError';

  constructor(
    public taskType: string,
    public timeoutMs: number
  ) {
    super(`Timeout exceeded for task type "${taskType}" after ${timeoutMs}ms`);
  }
}

/**
 * Factory function for common timeout configurations
 */
export function createTimeoutManager(
  type: 'short' | 'standard' | 'long'
): TimeoutManager {
  const configs = {
    short: {
      defaultTimeoutMs: 30000,
      maxTimeoutMs: 120000,
      taskTimeouts: {
        'simple-query': 5000,
        'code-generation': 30000,
        'complex-analysis': 60000,
        'batch-task': 120000
      }
    },
    standard: {
      defaultTimeoutMs: 60000,
      maxTimeoutMs: 300000,
      taskTimeouts: {
        'simple-query': 10000,
        'code-generation': 60000,
        'complex-analysis': 120000,
        'batch-task': 300000
      }
    },
    long: {
      defaultTimeoutMs: 120000,
      maxTimeoutMs: 600000,
      taskTimeouts: {
        'simple-query': 30000,
        'code-generation': 120000,
        'complex-analysis': 300000,
        'batch-task': 600000
      }
    }
  };

  return new TimeoutManager(configs[type]);
}
