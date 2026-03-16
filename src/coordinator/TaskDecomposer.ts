/**
 * Huangdi Orchestrator - Task Decomposer
 *
 * Hierarchical task decomposition for multi-agent collaboration.
 * Breaks down complex tasks into subtask trees with dependency tracking.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

export interface TaskTree {
  type: 'leaf' | 'branch';
  task: string;
  children?: TaskTree[];
  dependencies?: { from: string; to: string }[];
  metadata?: {
    complexity?: number;
    estimatedTokens?: number;
    requiredTools?: string[];
    assignedRole?: string;
  };
}

export interface DecompositionConfig {
  maxDepth: number;
  complexityThreshold: number;
  modelId: string;
}

export class TaskDecomposer {
  private defaultConfig: DecompositionConfig = {
    maxDepth: 3,
    complexityThreshold: 6,
    modelId: 'default'
  };

  constructor(
    private pluginApi: OpenClawPluginApi,
    private config: Partial<DecompositionConfig> = {}
  ) {}

  /**
   * Recursively decompose a complex task into a subtask tree
   */
  async decompose(task: string, depth: number = 0): Promise<TaskTree> {
    const effectiveConfig = { ...this.defaultConfig, ...this.config };

    // Check if reached max depth
    if (depth >= effectiveConfig.maxDepth) {
      return { type: 'leaf', task };
    }

    // Analyze task complexity
    const analysis = await this.analyzeTaskComplexity(task);

    // Return leaf node if below threshold
    if ((analysis.complexity || 0) < effectiveConfig.complexityThreshold) {
      return {
        type: 'leaf',
        task,
        metadata: analysis
      };
    }

    // Generate subtasks using LLM
    const subtasks = await this.generateSubtasks(task, analysis);

    // Recursively decompose each subtask
    const children = await Promise.all(
      subtasks.map(st => this.decompose(st, depth + 1))
    );

    // Infer dependencies between subtasks
    const dependencies = this.inferDependencies(subtasks);

    return {
      type: 'branch',
      task,
      children,
      dependencies,
      metadata: analysis
    };
  }

  /**
   * Analyze task complexity using LLM
   */
  private async analyzeTaskComplexity(task: string): Promise<{
    complexity: number;
    estimatedTokens: number;
    requiredTools: string[];
  }> {
    const prompt = `
Analyze the complexity of this task and return JSON:
{
  "complexity": <integer 1-10>,
  "estimatedTokens": <estimated token usage>,
  "requiredTools": ["list", "of", "tools"]
}

Task: ${task}

Return only valid JSON, no other text.
`;

    try {
      // @ts-ignore - llm method may be available through runtime
      const response = await this.pluginApi.llm?.generate?.(prompt, {
        responseFormat: 'json'
      });
      return JSON.parse(response);
    } catch (error) {
      // Fallback to simple heuristic
      const wordCount = task.split(/\s+/).length;
      return {
        complexity: Math.min(10, Math.ceil(wordCount / 10)),
        estimatedTokens: wordCount * 4,
        requiredTools: []
      };
    }
  }

  /**
   * Generate subtasks using LLM
   */
  private async generateSubtasks(
    task: string,
    analysis: { complexity?: number }
  ): Promise<string[]> {
    const numSubtasks = Math.min(5, Math.max(2, (analysis.complexity || 5) - 2));

    const prompt = `
Decompose this task into exactly ${numSubtasks} subtasks.
Each subtask should be:
- Independent and actionable
- Clear and specific
- Appropriate for a single agent to execute

Task: ${task}

Return a JSON array of subtask strings. Only valid JSON, no other text.
`;

    try {
      // @ts-ignore - llm method may be available through runtime
      const response = await this.pluginApi.llm?.generate?.(prompt, {
        responseFormat: 'json'
      });
      return JSON.parse(response);
    } catch (error) {
      return [task];
    }
  }

  /**
   * Infer dependencies between subtasks based on semantic analysis
   */
  private inferDependencies(
    subtasks: string[]
  ): { from: string; to: string }[] {
    // Simple heuristic: sequential tasks may have dependencies
    // More sophisticated: use LLM to analyze semantic relationships
    const dependencies: { from: string; to: string }[] = [];

    // Check for common dependency patterns
    const dependencyPatterns = [
      { before: /analyze|understand|research/i, after: /implement|build|create/i },
      { before: /design|plan/i, after: /implement|execute/i },
      { before: /write|create/i, after: /test|review/i }
    ];

    for (let i = 0; i < subtasks.length; i++) {
      for (let j = i + 1; j < subtasks.length; j++) {
        for (const pattern of dependencyPatterns) {
          if (
            pattern.before.test(subtasks[i]) &&
            pattern.after.test(subtasks[j])
          ) {
            dependencies.push({
              from: subtasks[i],
              to: subtasks[j]
            });
            break;
          }
        }
      }
    }

    return dependencies;
  }

  /**
   * Flatten task tree into execution order (topological sort)
   */
  flattenToExecutionOrder(tree: TaskTree): string[] {
    const result: string[] = [];
    const visited = new Set<string>();

    const visit = (node: TaskTree) => {
      if (node.type === 'leaf') {
        if (!visited.has(node.task)) {
          result.push(node.task);
          visited.add(node.task);
        }
      } else {
        // Process children with dependencies first
        const deps = node.dependencies || [];
        for (const child of node.children || []) {
          // Check if this child has dependencies
          const childDeps = deps.filter(d => d.to === child.task);
          if (childDeps.length === 0) {
            visit(child);
          }
        }
        // Then process dependent children
        for (const child of node.children || []) {
          const childDeps = deps.filter(d => d.to === child.task);
          if (childDeps.length > 0) {
            visit(child);
          }
        }
      }
    };

    visit(tree);
    return result;
  }

  /**
   * Get task tree as a visual string representation
   */
  visualize(tree: TaskTree, indent: string = ''): string {
    if (tree.type === 'leaf') {
      return `${indent}• ${tree.task}`;
    }

    let result = `${indent}• ${tree.task}`;

    if (tree.children && tree.children.length > 0) {
      for (const child of tree.children) {
        result += '\n' + this.visualize(child, indent + '  ');
      }
    }

    return result;
  }
}
