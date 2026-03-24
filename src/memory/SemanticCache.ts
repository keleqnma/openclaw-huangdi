/**
 * Huangdi Orchestrator - Semantic Cache
 *
 * Caches similar queries using embedding-based semantic similarity.
 * Reduces redundant computation for memory searches and LLM calls.
 */

export interface CacheEntry {
  query: string;
  embedding: number[];
  results: unknown[];
  timestamp: number;
  hitCount: number;
  ttl?: number;  // Time to live in ms
}

export interface SemanticCacheConfig {
  /** Maximum number of entries in cache */
  maxSize: number;
  /** Similarity threshold for cache hit (0-1) */
  similarityThreshold: number;
  /** Default TTL for entries in ms */
  defaultTtl: number;
  /** Enable LRU eviction */
  enableLruEviction: boolean;
  /** Embedding dimension */
  embeddingDimension: number;
}

/**
 * Semantic Cache using embedding-based similarity
 *
 * Features:
 * - Caches results for semantically similar queries
 * - Configurable similarity threshold
 * - LRU eviction when cache is full
 * - TTL-based expiration
 *
 * Embedding options:
 * - Use @xenova/transformers for local embedding
 * - Override embed() method for custom embedding provider
 */
export class SemanticCache {
  private cache = new Map<string, CacheEntry>();
  private config: SemanticCacheConfig;
  private embeddingModel?: any;
  private embeddingModelLoaded = false;

  constructor(config?: Partial<SemanticCacheConfig>) {
    this.config = {
      maxSize: 1000,
      similarityThreshold: 0.95,
      defaultTtl: 3600000,  // 1 hour
      enableLruEviction: true,
      embeddingDimension: 384,  // MiniLM-L6-v2 dimension
      ...config
    };
  }

  /**
   * Get cached results for semantically similar query
   */
  async get(query: string): Promise<unknown[] | null> {
    // First check for exact match
    const exactEntry = this.cache.get(query);
    if (exactEntry && !this.isExpired(exactEntry)) {
      exactEntry.hitCount++;
      return exactEntry.results;
    }

    // Compute embedding for query
    const queryEmbedding = await this.embed(query);

    // Find semantically similar entry
    let bestMatch: CacheEntry | null = null;
    let bestSimilarity = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        // Clean up expired entries
        this.cache.delete(key);
        continue;
      }

      const similarity = this.cosineSimilarity(queryEmbedding, entry.embedding);

      if (similarity >= this.config.similarityThreshold && similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = entry;
      }
    }

    if (bestMatch) {
      bestMatch.hitCount++;
      return bestMatch.results;
    }

    return null;
  }

  /**
   * Cache results for a query
   */
  async set(query: string, results: unknown[], ttl?: number): Promise<void> {
    const embedding = await this.embed(query);

    this.cache.set(query, {
      query,
      embedding,
      results,
      timestamp: Date.now(),
      hitCount: 0,
      ttl: ttl ?? this.config.defaultTtl
    });

    // Evict if over capacity
    if (this.cache.size > this.config.maxSize) {
      this.evict();
    }
  }

  /**
   * Check if cache has entry for query (exact or semantic)
   */
  async has(query: string): Promise<boolean> {
    const results = await this.get(query);
    return results !== null;
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    avgHitCount: number;
  } {
    const entries = Array.from(this.cache.values());
    const totalHits = entries.reduce((sum, e) => sum + e.hitCount, 0);
    const avgHitCount = entries.length > 0 ? totalHits / entries.length : 0;

    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hitRate: totalHits / Math.max(1, totalHits + this.cache.size),
      avgHitCount
    };
  }

  /**
   * Delete specific entry
   */
  delete(query: string): boolean {
    return this.cache.delete(query);
  }

  /**
   * Check if entry is expired
   */
  private isExpired(entry: CacheEntry): boolean {
    if (entry.ttl === Infinity || entry.ttl === undefined) {
      return false;
    }
    return Date.now() - entry.timestamp > entry.ttl;
  }

  /**
   * Evict entries when cache is full
   */
  private evict(): void {
    if (!this.config.enableLruEviction) {
      // Remove oldest entry
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [key, entry] of this.cache.entries()) {
        if (entry.timestamp < oldestTime) {
          oldestTime = entry.timestamp;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
      return;
    }

    // LRU eviction: remove entry with lowest hitCount
    let minKey: string | null = null;
    let minHits = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.hitCount < minHits) {
        minHits = entry.hitCount;
        minKey = key;
      }
    }

    if (minKey) {
      this.cache.delete(minKey);
    }
  }

  /**
   * Compute cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Compute embedding for text
   * Uses @xenova/transformers for local embedding computation
   * Override this method to use your preferred embedding model
   */
  protected async embed(text: string): Promise<number[]> {
    // Lazy load the embedding model
    if (!this.embeddingModelLoaded) {
      try {
        const { pipeline } = await import('@xenova/transformers');
        this.embeddingModel = await pipeline(
          'feature-extraction',
          'Xenova/all-MiniLM-L6-v2',
          { quantized: true }
        );
        this.embeddingModelLoaded = true;
      } catch (error) {
        console.warn('Failed to load embedding model, using fallback:', error);
        this.embeddingModelLoaded = true; // Mark as loaded to avoid retry
      }
    }

    // Compute embedding with loaded model
    if (this.embeddingModel) {
      try {
        const result = await this.embeddingModel(text, {
          pooling: 'mean',
          normalize: true
        });
        return Array.from(result.data) as number[];
      } catch (error) {
        console.warn('Embedding computation failed, using fallback:', error);
      }
    }

    // Fallback: return zero vector
    return new Array(this.config.embeddingDimension).fill(0);
  }
}

/**
 * Factory function for common cache configurations
 */
export function createSemanticCache(
  type: 'small' | 'medium' | 'large'
): SemanticCache {
  const configs = {
    small: {
      maxSize: 100,
      similarityThreshold: 0.95,
      defaultTtl: 1800000  // 30 minutes
    },
    medium: {
      maxSize: 1000,
      similarityThreshold: 0.90,
      defaultTtl: 3600000  // 1 hour
    },
    large: {
      maxSize: 10000,
      similarityThreshold: 0.85,
      defaultTtl: 7200000  // 2 hours
    }
  };

  return new SemanticCache(configs[type]);
}
