/**
 * Huangdi Orchestrator - Retry Manager
 *
 * Implements exponential backoff with jitter for resilient agent calls.
 */

export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Initial delay in ms */
  initialDelayMs: number;
  /** Maximum delay in ms */
  maxDelayMs: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
  /** Add jitter to avoid thundering herd */
  jitter: boolean;
  /** Retry only on these error types */
  retryableErrors?: Array<typeof Error>;
  /** Custom predicate for retryable errors */
  isRetryable?: (error: Error) => boolean;
}

export interface RetryState {
  attempt: number;
  lastError?: Error;
  nextDelayMs: number;
  totalElapsedMs: number;
}

/**
 * Retry Manager with exponential backoff and jitter
 *
 * Best practices:
 * - Exponential backoff: delay = min(initial * multiplier^attempt, maxDelay)
 * - Jitter: add random variation (±25%) to prevent thundering herd
 * - Only retry transient errors (network, timeout, rate limit)
 */
export class RetryManager {
  private config: RetryConfig;

  constructor(config?: Partial<RetryConfig>) {
    this.config = {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 30000,  // 30 seconds
      backoffMultiplier: 2,
      jitter: true,
      ...config
    };
  }

  /**
   * Execute operation with retry logic
   */
  async execute<T>(
    operation: () => Promise<T>,
    context: {
      agentId?: string;
      operationName?: string;
      onRetry?: (state: RetryState) => void;
    } = {}
  ): Promise<T> {
    const { onRetry } = context;
    let lastError: Error | undefined;
    let totalElapsed = 0;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        // First attempt (attempt=0) or retry
        return await operation();
      } catch (error) {
        lastError = error as Error;

        // Check if we should retry
        if (attempt >= this.config.maxRetries) {
          // No more retries
          break;
        }

        if (!this.isRetryableError(error)) {
          // Non-retryable error
          throw error;
        }

        // Calculate delay for next attempt
        const delayMs = this.calculateDelay(attempt);
        totalElapsed += delayMs;

        const state: RetryState = {
          attempt: attempt + 1,
          lastError,
          nextDelayMs: delayMs,
          totalElapsedMs: totalElapsed
        };

        // Notify retry
        onRetry?.(state);

        // Wait before retrying
        await this.sleep(delayMs);
      }
    }

    // All retries exhausted
    throw new MaxRetriesExceededError(
      this.config.maxRetries,
      lastError,
      context.agentId,
      context.operationName
    );
  }

  /**
   * Execute with timeout and retry
   */
  async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    context?: Parameters<RetryManager['execute']>[1]
  ): Promise<T> {
    const startTime = Date.now();

    const wrappedOperation = async () => {
      const remainingTime = timeoutMs - (Date.now() - startTime);

      if (remainingTime <= 0) {
        throw new TimeoutError(timeoutMs);
      }

      return Promise.race([
        operation(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new TimeoutError(timeoutMs)), remainingTime)
        )
      ]);
    };

    return this.execute(wrappedOperation, context);
  }

  /**
   * Calculate delay for current attempt
   */
  private calculateDelay(attempt: number): number {
    // Exponential backoff: initialDelay * multiplier^attempt
    const exponentialDelay =
      this.config.initialDelayMs *
      Math.pow(this.config.backoffMultiplier, attempt);

    // Cap at maxDelay
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelayMs);

    // Add jitter if enabled (±25% variation)
    if (this.config.jitter) {
      const jitterRange = cappedDelay * 0.25;
      const jitter = (Math.random() - 0.5) * 2 * jitterRange;
      return Math.max(0, Math.round(cappedDelay + jitter));
    }

    return Math.round(cappedDelay);
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    // Custom predicate takes precedence
    if (this.config.isRetryable) {
      return this.config.isRetryable(error as Error);
    }

    // Default: check against retryableErrors list
    if (this.config.retryableErrors && error instanceof Error) {
      return this.config.retryableErrors.some(
        ErrorClass => error instanceof ErrorClass
      );
    }

    // Fallback: retry on common transient errors
    if (error instanceof Error) {
      const transientPatterns = [
        /timeout/i,
        /network/i,
        /rate limit/i,
        /temporarily unavailable/i,
        /service unavailable/i,
        /econnreset/i,
        /etimedout/i,
        /eai_again/i
      ];

      return transientPatterns.some(pattern => pattern.test(error.message));
    }

    return false;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<RetryConfig> {
    return { ...this.config };
  }
}

/**
 * Error thrown when max retries exceeded
 */
export class MaxRetriesExceededError extends Error {
  name = 'MaxRetriesExceededError';

  constructor(
    public maxRetries: number,
    public lastError?: Error,
    public agentId?: string,
    public operationName?: string
  ) {
    const context = [
      agentId && `agent ${agentId}`,
      operationName && `operation "${operationName}"`
    ].filter(Boolean).join(' ') || 'operation';

    super(
      `Max retries (${maxRetries}) exceeded for ${context}` +
      (lastError ? `: ${lastError.message}` : '')
    );
  }
}

/**
 * Error thrown on timeout
 */
export class TimeoutError extends Error {
  name = 'TimeoutError';

  constructor(public timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs}ms`);
  }
}

/**
 * Factory function for common retry configurations
 */
export function createRetryManager(
  type: 'conservative' | 'moderate' | 'aggressive'
): RetryManager {
  const configs = {
    conservative: {
      maxRetries: 5,
      initialDelayMs: 2000,
      maxDelayMs: 60000,  // 1 minute
      backoffMultiplier: 2,
      jitter: true
    },
    moderate: {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 30000,  // 30 seconds
      backoffMultiplier: 2,
      jitter: true
    },
    aggressive: {
      maxRetries: 2,
      initialDelayMs: 500,
      maxDelayMs: 10000,  // 10 seconds
      backoffMultiplier: 1.5,
      jitter: false
    }
  };

  return new RetryManager(configs[type]);
}
