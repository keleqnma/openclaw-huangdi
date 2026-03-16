/**
 * Huangdi Orchestrator - Hybrid Search Engine
 *
 * Combines vector search, BM25 keyword search, and RRF reranking
 * for optimal retrieval quality.
 */

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  source: 'vector' | 'bm25' | 'hybrid';
  metadata?: Record<string, unknown>;
}

export interface HybridSearchConfig {
  /** Weight for vector search scores (0-1) */
  vectorWeight: number;
  /** Weight for BM25 scores (0-1) */
  bm25Weight: number;
  /** RRF constant k */
  rrfK: number;
  /** Top-k results to return */
  topK: number;
  /** Minimum score threshold */
  scoreThreshold: number;
}

/**
 * Hybrid Search Engine combining multiple retrieval methods
 *
 * Research shows hybrid search with RRF reranking outperforms
 * either method alone on diverse retrieval tasks.
 */
export class HybridSearchEngine {
  private config: HybridSearchConfig;

  constructor(config?: Partial<HybridSearchConfig>) {
    this.config = {
      vectorWeight: 0.5,
      bm25Weight: 0.5,
      rrfK: 60,
      topK: 10,
      scoreThreshold: 0.3,
      ...config
    };
  }

  /**
   * Search with hybrid retrieval and RRF fusion
   */
  async search(
    _query: string,
    options: {
      vectorResults?: SearchResult[];
      bm25Results?: SearchResult[];
      useReranking?: boolean;
    } = {}
  ): Promise<SearchResult[]> {
    const {
      vectorResults = [],
      bm25Results = [],
      useReranking = true
    } = options;

    // If only one source available, return it directly
    if (vectorResults.length === 0 && bm25Results.length === 0) {
      return [];
    }

    if (vectorResults.length === 0) {
      return this.filterByThreshold(bm25Results);
    }

    if (bm25Results.length === 0) {
      return this.filterByThreshold(vectorResults);
    }

    if (!useReranking) {
      // Simple weighted fusion
      return this.weightedFusion(vectorResults, bm25Results);
    }

    // RRF (Reciprocal Rank Fusion) reranking
    return this.rrfFusion(vectorResults, bm25Results);
  }

  /**
   * RRF (Reciprocal Rank Fusion) fusion
   *
   * Formula: score = sum(1 / (k + rank_i)) for each result
   */
  private rrfFusion(
    vectorResults: SearchResult[],
    bm25Results: SearchResult[]
  ): SearchResult[] {
    const rrfScores = new Map<string, number>();
    const resultById = new Map<string, SearchResult>();

    // Score vector results
    vectorResults.forEach((result, rank) => {
      const score = 1 / (this.config.rrfK + rank + 1);
      rrfScores.set(result.id, (rrfScores.get(result.id) || 0) + score);
      resultById.set(result.id, { ...result, source: 'hybrid' });
    });

    // Score BM25 results
    bm25Results.forEach((result, rank) => {
      const score = 1 / (this.config.rrfK + rank + 1);
      rrfScores.set(result.id, (rrfScores.get(result.id) || 0) + score);

      if (!resultById.has(result.id)) {
        resultById.set(result.id, { ...result, source: 'hybrid' });
      } else {
        // Merge metadata
        const existing = resultById.get(result.id)!;
        resultById.set(result.id, {
          ...existing,
          metadata: { ...existing.metadata, ...result.metadata }
        });
      }
    });

    // Sort by RRF score and return top-k
    const results = Array.from(rrfScores.entries())
      .map(([id, score]) => ({
        ...resultById.get(id)!,
        score
      }))
      .filter(r => r.score >= this.config.scoreThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.topK);

    return results;
  }

  /**
   * Weighted score fusion
   */
  private weightedFusion(
    vectorResults: SearchResult[],
    bm25Results: SearchResult[]
  ): SearchResult[] {
    const fusedScores = new Map<string, { vector: number; bm25: number }>();
    const resultById = new Map<string, SearchResult>();

    // Normalize scores within each method
    const maxVectorScore = Math.max(...vectorResults.map(r => r.score), 1);
    const maxBm25Score = Math.max(...bm25Results.map(r => r.score), 1);

    vectorResults.forEach(result => {
      const normalizedScore = result.score / maxVectorScore;
      fusedScores.set(result.id, {
        vector: normalizedScore,
        bm25: 0
      });
      resultById.set(result.id, { ...result, source: 'hybrid' });
    });

    bm25Results.forEach(result => {
      const normalizedScore = result.score / maxBm25Score;
      const existing = fusedScores.get(result.id) || { vector: 0, bm25: 0 };
      fusedScores.set(result.id, {
        vector: existing.vector,
        bm25: normalizedScore
      });

      if (!resultById.has(result.id)) {
        resultById.set(result.id, { ...result, source: 'hybrid' });
      } else {
        const existing = resultById.get(result.id)!;
        resultById.set(result.id, {
          ...existing,
          metadata: { ...existing.metadata, ...result.metadata }
        });
      }
    });

    // Combine scores and sort
    const results = Array.from(fusedScores.entries())
      .map(([id, scores]) => {
        const combinedScore =
          scores.vector * this.config.vectorWeight +
          scores.bm25 * this.config.bm25Weight;

        return {
          ...resultById.get(id)!,
          score: combinedScore
        };
      })
      .filter(r => r.score >= this.config.scoreThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.topK);

    return results;
  }

  /**
   * Filter results by score threshold
   */
  private filterByThreshold(results: SearchResult[]): SearchResult[] {
    return results
      .filter(r => r.score >= this.config.scoreThreshold)
      .slice(0, this.config.topK);
  }

  /**
   * Cross-encoder reranking (requires external model)
   *
   * This is a placeholder - implement with actual cross-encoder
   */
  async rerankWithCrossEncoder(
    _query: string,
    results: SearchResult[],
    topK?: number
  ): Promise<SearchResult[]> {
    // TODO: Implement with actual cross-encoder model
    // For now, return results sorted by current score
    console.warn('Cross-encoder reranking not implemented - using score-based sorting');

    const k = topK ?? this.config.topK;
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

/**
 * Factory function for common search configurations
 */
export function createHybridSearchEngine(
  type: 'balanced' | 'precision' | 'recall'
): HybridSearchEngine {
  const configs = {
    balanced: {
      vectorWeight: 0.5,
      bm25Weight: 0.5,
      rrfK: 60,
      topK: 10,
      scoreThreshold: 0.3
    },
    precision: {
      vectorWeight: 0.7,
      bm25Weight: 0.3,
      rrfK: 30,  // Lower k = more weight to top ranks
      topK: 5,
      scoreThreshold: 0.5
    },
    recall: {
      vectorWeight: 0.3,
      bm25Weight: 0.7,
      rrfK: 90,  // Higher k = more balanced fusion
      topK: 20,
      scoreThreshold: 0.2
    }
  };

  return new HybridSearchEngine(configs[type]);
}
