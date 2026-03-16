/**
 * Huangdi Orchestrator - Circuit Breaker
 *
 * Implements the circuit breaker pattern to prevent cascading failures
 * in multi-agent systems.
 */

export class CircuitOpenError extends Error {
  name = 'CircuitOpenError';

  constructor(
    public agentId: string,
    public retryAfter: number
  ) {
    super(`Circuit breaker is OPEN for agent ${agentId}. Retry after ${retryAfter}ms`);
  }
}

interface CircuitState {
  failures: number;
  successes: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  state: 'closed' | 'open' | 'half-open';
}

export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Number of successes in half-open state before closing */
  successThreshold: number;
  /** Time in ms before attempting reset after opening */
  timeoutMs: number;
  /** Optional: specific error types to count as failures */
  failureFilter?: (error: Error) => boolean;
}

/**
 * Circuit Breaker implementation for agent calls
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit tripped, requests fail immediately
 * - HALF-OPEN: Testing if service recovered
 */
export class CircuitBreaker {
  private states = new Map<string, CircuitState>();
  private config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = {
      failureThreshold: 5,
      successThreshold: 3,
      timeoutMs: 60000,  // 1 minute
      ...config
    };
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(
    operation: () => Promise<T>,
    agentId: string
  ): Promise<T> {
    const state = this.getState(agentId);

    // Check current state
    switch (state.state) {
      case 'open':
        if (this.shouldTryReset(agentId)) {
          state.state = 'half-open';
          state.successes = 0;
        } else {
          const retryAfter = this.getRetryAfter(agentId);
          throw new CircuitOpenError(agentId, retryAfter);
        }
        break;

      case 'half-open':
        // Allow request but monitor closely
        break;

      case 'closed':
      default:
        // Normal operation
        break;
    }

    try {
      const result = await operation();
      this.recordSuccess(agentId);
      return result;
    } catch (error) {
      if (this.isFailure(error)) {
        this.recordFailure(agentId);
      }
      throw error;
    }
  }

  /**
   * Execute with fallback if circuit is open
   */
  async executeWithFallback<T>(
    operation: () => Promise<T>,
    fallback: () => Promise<T>,
    agentId: string
  ): Promise<T> {
    try {
      return await this.execute(operation, agentId);
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        // Circuit is open, use fallback
        return fallback();
      }
      throw error;
    }
  }

  /**
   * Get current state for an agent
   */
  getState(agentId: string): CircuitState {
    if (!this.states.has(agentId)) {
      this.states.set(agentId, {
        failures: 0,
        successes: 0,
        state: 'closed'
      });
    }
    return this.states.get(agentId)!;
  }

  /**
   * Get circuit breaker status for all agents
   */
  getAllStates(): Map<string, CircuitState> {
    return new Map(this.states);
  }

  /**
   * Reset circuit breaker for specific agent
   */
  reset(agentId: string): void {
    this.states.set(agentId, {
      failures: 0,
      successes: 0,
      state: 'closed'
    });
  }

  /**
   * Force open circuit for specific agent
   */
  forceOpen(agentId: string): void {
    const state = this.getState(agentId);
    state.state = 'open';
    state.lastFailureTime = Date.now();
  }

  /**
   * Check if circuit is open for agent
   */
  isOpen(agentId: string): boolean {
    return this.getState(agentId).state === 'open';
  }

  /**
   * Check if circuit is closed for agent
   */
  isClosed(agentId: string): boolean {
    return this.getState(agentId).state === 'closed';
  }

  private recordFailure(agentId: string): void {
    const state = this.getState(agentId);
    state.failures++;
    state.lastFailureTime = Date.now();
    state.successes = 0;

    if (state.failures >= this.config.failureThreshold) {
      state.state = 'open';
    }
  }

  private recordSuccess(agentId: string): void {
    const state = this.getState(agentId);
    state.successes++;
    state.lastSuccessTime = Date.now();

    if (state.state === 'half-open') {
      if (state.successes >= this.config.successThreshold) {
        // Recovery successful, close circuit
        state.state = 'closed';
        state.failures = 0;
        state.successes = 0;
      }
    } else {
      // Reset failure count on success in closed state
      state.failures = 0;
    }
  }

  private shouldTryReset(agentId: string): boolean {
    const state = this.getState(agentId);
    if (!state.lastFailureTime) return true;

    const elapsed = Date.now() - state.lastFailureTime;
    return elapsed >= this.config.timeoutMs;
  }

  private getRetryAfter(agentId: string): number {
    const state = this.getState(agentId);
    if (!state.lastFailureTime) return 0;

    const elapsed = Date.now() - state.lastFailureTime;
    return Math.max(0, this.config.timeoutMs - elapsed);
  }

  private isFailure(error: unknown): boolean {
    if (this.config.failureFilter) {
      return this.config.failureFilter(error as Error);
    }
    // Default: count all errors as failures
    return error instanceof Error;
  }
}

/**
 * Factory function for common circuit breaker configurations
 */
export function createCircuitBreaker(type: 'conservative' | 'moderate' | 'aggressive'): CircuitBreaker {
  const configs = {
    conservative: {
      failureThreshold: 3,
      successThreshold: 5,
      timeoutMs: 120000  // 2 minutes
    },
    moderate: {
      failureThreshold: 5,
      successThreshold: 3,
      timeoutMs: 60000  // 1 minute
    },
    aggressive: {
      failureThreshold: 10,
      successThreshold: 2,
      timeoutMs: 30000  // 30 seconds
    }
  };

  return new CircuitBreaker(configs[type]);
}
