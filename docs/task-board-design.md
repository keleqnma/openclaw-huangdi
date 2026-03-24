# Agent 任务协作系统设计

## 功能需求

### 1. Agent 互相指派任务
- Agent A 可以创建任务并指派给 Agent B
- 支持任务广播模式（开放抢单）
- 支持定向指派模式（指定执行者）

### 2. 任务回避机制
- 任务被认领后，其他 Agent 不能重复抢
- 认领状态实时更新
- 支持任务释放/转交

### 3. 任务看板
- 显示所有任务状态（待认领/进行中/已完成）
- 显示任务认领者
- 显示任务进度
- 支持筛选和搜索

### 4. 监控 Agent
- 主动扫描任务看板
- 监控任务进度
- 超时任务告警
- 生成进度报告

## 数据模型

```typescript
interface TaskBoard {
  tasks: Task[];
  claimMap: Map<string, string>;  // taskId -> agentId
  progressMap: Map<string, number>; // taskId -> progress(0-100)
}

interface Task {
  id: string;
  title: string;
  description: string;
  createdBy: string;           // 创建者 Agent ID
  assignedTo?: string;         // 定向指派给谁
  claimedBy?: string;          // 实际认领者
  status: 'pending' | 'claimed' | 'in-progress' | 'completed' | 'failed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  createdAt: number;
  claimedAt?: number;
  dueAt?: number;              // 截止时间
  progress: number;            // 0-100
  messages: TaskMessage[];     // Agent 聊天记录
  metadata: {
    tags?: string[];
    dependencies?: string[];   // 依赖的其他任务
  };
}

interface TaskMessage {
  id: string;
  taskId: string;
  fromAgent: string;
  content: string;
  type: 'comment' | 'status-update' | 'handoff';
  timestamp: number;
}
```

## API 设计

```
GET    /api/tasks              - 获取任务列表
POST   /api/tasks              - 创建任务
GET    /api/tasks/:id          - 获取单个任务
POST   /api/tasks/:id/claim    - 认领任务
POST   /api/tasks/:id/release  - 释放任务
POST   /api/tasks/:id/assign   - 指派任务
POST   /api/tasks/:id/message  - 发送消息
POST   /api/tasks/:id/progress - 更新进度
PUT    /api/tasks/:id/status   - 更新状态
GET    /api/task-board         - 获取完整任务看板
WS     /ws/task-board          - 任务看板实时更新
```
