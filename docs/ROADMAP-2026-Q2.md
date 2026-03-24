# Huangdi Orchestrator 实施路线图

基于 [architecture-review-2026-03-24.md](./architecture-review-2026-03-24.md) 中发现的问题，制定本实施路线图。

---

## 总体目标

| 目标 | 当前评分 | 目标评分 | 时间线 |
|------|----------|----------|--------|
| 技术债务评分 | 5.6/10 | 8.0/10 | 3 个月 |
| 测试覆盖率 | ~60% | 85% | 2 个月 |
| 文档完整性 | 4/10 | 8/10 | 1 个月 |
| 架构清晰度 | 5/10 | 8/10 | 2 个月 |

---

## Phase 1: 紧急修复 (第 1-2 周)

**目标**: 解决 P0 级别的内存泄漏和状态同步问题

### T1: 清理 AgentStateManager 轮询泄漏

**问题**: 轮询间隔可能未被正确清理，导致内存泄漏

**任务**:
- [ ] 添加 try-catch 包裹 pollMessages
- [ ] 确保 agent 不存在时停止轮询
- [ ] 添加最大 poll 数量限制 (max: 100)
- [ ] 添加单元测试

**预计工时**: 2h

**验收标准**:
```typescript
// 应该有如下行为：
// 1. agent 被移除后，轮询自动停止
// 2. 异常不会导致 interval 泄漏
// 3. 超过 100 个 agent 时，拒绝创建新的轮询
```

---

### T2: 添加 WebSocket 心跳检测和重连

**问题**: 没有心跳检测僵尸连接，客户端断开后可能未被清理

**任务**:
- [ ] 实现 WebSocket ping/pong 心跳
- [ ] 添加 30 秒无响应自动断开
- [ ] 客户端实现自动重连 (指数退避)
- [ ] 添加最大连接数限制 (max: 50)

**预计工时**: 4h

**验收标准**:
```typescript
// 应该有如下行为：
// 1. 30 秒无心跳自动断开连接
// 2. 客户端断开后自动重连 (1s, 2s, 4s, 8s, 16s)
// 3. 超过 50 个连接时，拒绝新连接
```

---

### T3: 统一事件类型定义

**问题**: DashboardEvent 和 AgentAction 类型不兼容

**任务**:
- [ ] 创建统一的 TimelineEvent 类型
- [ ] 映射旧类型到新类型
- [ ] 更新 EventStore 使用新类型
- [ ] 更新 ActionLogger 使用新类型

**预计工时**: 4h

**验收标准**:
```typescript
interface TimelineEvent {
  type: 'action' | 'message' | 'status_change' | 'thinking' | 'task_event';
  timestamp: number;
  summary: string;
  details?: any;
  level: 'info' | 'warning' | 'error' | 'debug';
  taskId?: string;
  sessionId?: string;
  correlationId?: string;
}
```

---

### T4: 添加统一 ID 映射表

**问题**: 不同系统使用不同的 ID，无法正确映射

**任务**:
- [ ] 创建 AgentIdMapper 类
- [ ] 维护 agentId ↔ runId ↔ sessionKey ↔ sessionId 映射
- [ ] 更新所有模块使用 mapper
- [ ] 添加映射查询 API

**预计工时**: 4h

**验收标准**:
```typescript
class AgentIdMapper {
  register(agentId: string, mapping: AgentIdMapping): void;
  getByAgentId(agentId: string): AgentIdMapping | undefined;
  getBySessionKey(sessionKey: string): AgentIdMapping | undefined;
  getBySessionId(sessionId: string): AgentIdMapping | undefined;
  remove(agentId: string): void;
}
```

---

## Phase 2: 架构整合 (第 3-5 周)

**目标**: 统一状态管理，合并 WebSocket 服务

### T5: 合并 EventStore 和 ActionLogger

**任务**:
- [x] 创建 UnifiedEventStore 类
- [x] 迁移 EventStore 数据
- [x] 迁移 ActionLogger 数据
- [x] 更新 DashboardServer 使用新存储
- [x] 更新 MultiAgentService 使用新存储

**预计工时**: 8h

**验收标准**:
- [x] UnifiedEventStore 支持按 agentId、taskId 索引
- [x] 支持 EventEmitter 实时推送
- [x] 支持重放控制（ReplayState）
- [x] 自动清理过期事件（maxEvents 限制）
- [x] 34 个单元测试全部通过

---

### T6: 合并两套 WebSocket 服务

**任务**:
- [x] 创建 UnifiedWebSocketServer
- [x] 统一定义 WebSocket 消息协议
- [x] 迁移 DashboardServer WebSocket 逻辑
- [x] 迁移 ApiWebSocketServer 逻辑
- [x] 更新前端连接新端口

**预计工时**: 8h

**验收标准**:
- [x] 支持 attachToHTTPServer() 和 start() 双模式
- [x] 支持 Dashboard 消息（fetch_events、replay_control）和 API 消息（subscribe、unsubscribe、ping）
- [x] 心跳检测机制（30s 间隔，10s 超时）
- [x] 基于频道的订阅/广播
- [x] 18 个单元测试全部通过

---

### T7: DashboardServer 订阅 AgentOrchestrator 事件

**任务**:
- [ ] DashboardServer 监听 AgentOrchestrator 事件
- [ ] 实现双向状态同步
- [ ] 测试状态一致性

**预计工时**: 4h

---

### T8: 实现统一状态管理

**任务**:
- [ ] 创建 UnifiedAgentState 类型
- [ ] 实现 StateManager 单例
- [ ] 所有模块通过 StateManager 访问状态
- [ ] 添加状态持久化（可选）

**预计工时**: 16h

---

## Phase 3: 渐进式 UI (第 6-8 周)

**目标**: 实现四层信息架构

### T9: 实现 Overview 层

**任务**:
- [x] 设计总览视图 UI
- [x] 实现系统健康状态组件
- [x] 实现关键指标卡片
- [x] 实现告警列表

**预计工时**: 8h

**验收标准**:
- [x] 采用专业深色主题，色彩对比度优化
- [x] 使用 Plus Jakarta Sans + JetBrains Mono 字体组合
- [x] 所有组件采用统一的圆角、阴影、过渡样式
- [x] 移除 emoji 图标，使用 SVG 图标
- [x] 添加环境光效和微动画效果
- [x] 终端和代码显示专业控制台风格
- [x] Thinking 流采用日志查看器样式

---

### T10: 实现 Task-Centric 层

**任务**:
- [x] 设计任务卡片 UI
- [x] 实现任务时间线
- [x] 实现任务依赖关系图
- [x] 实现任务筛选器

**预计工时**: 16h

**验收标准**:
- [x] 任务卡片采用左侧彩色边框设计，状态色区分
- [x] 任务统计卡片显示总数、待认领、进行中、已完成等指标
- [x] 支持按状态、优先级、搜索词过滤任务
- [x] 任务详情 modal 包含描述、消息、时间线、依赖关系
- [x] 时间线显示创建、认领、状态变更等历史事件
- [x] 依赖关系以徽章形式展示，可点击跳转

---

### T11: 实现上下文感知过滤

**任务**:
- [ ] 实现用户角色选择器
- [ ] 实现时间范围过滤
- [ ] 实现事件类型过滤
- [ ] 实现 Agent/任务过滤

**预计工时**: 8h

---

### T12: 整合 TaskBoard 到 agent-dashboard

**任务**:
- [x] 设计统一布局
- [x] 实现视图切换器
- [x] 共享状态和事件
- [x] 优化性能（虚拟滚动）

**预计工时**: 8h

**验收标准**:
- [x] Tasks 标签页集成到主导航
- [x] 任务列表与 Agent 面板共享 WebSocket 连接
- [x] 支持创建任务、认领任务、更新状态等操作
- [x] 任务详情 modal 支持查看和交互
- [x] 采用相同的深色主题和组件样式

---

## Phase 4: Memory 系统增强 (第 9-11 周)

**目标**: 启用记忆系统，实现跨 Agent 记忆共享

### T13: 启用 HierarchicalContextEngine

**任务**:
- [ ] 集成到 OpenClaw 插件
- [ ] 实现 4 层上下文管理
- [ ] 添加配置选项
- [ ] 添加测试

**预计工时**: 8h

---

### T14: 实现跨 Agent 记忆同步

**任务**:
- [ ] 子 agent 完成后同步记忆到父 agent
- [ ] 实现记忆去重
- [ ] 实现记忆优先级排序

**预计工时**: 16h

---

### T15: 添加记忆注入的 fallback 策略

**任务**:
- [ ] 记忆系统不可用时使用本地缓存
- [ ] 添加错误日志
- [ ] 添加降级模式

**预计工时**: 4h

---

### T16: 为 Memory 和 Context 模块添加测试

**任务**:
- [ ] HybridSearchEngine 测试
- [ ] HierarchicalContextEngine 测试
- [ ] SemanticCache 测试

**预计工时**: 8h

---

## Phase 5: 文档和测试完善 (第 12 周)

### T17: 更新所有文档

**任务**:
- [ ] 更新架构文档
- [ ] 添加 API 参考
- [ ] 添加部署指南
- [ ] 添加故障排查指南

**预计工时**: 16h

---

### T18: 提高测试覆盖率

**任务**:
- [ ] 为未测试模块添加测试
- [ ] 添加集成测试
- [ ] 添加 E2E 测试场景

**预计工时**: 24h

---

## 里程碑

| 里程碑 | 完成 Phase | 预计日期 | 交付物 |
|--------|-----------|----------|--------|
| M1: 稳定性提升 | Phase 1 | 第 2 周末 | 无内存泄漏，WebSocket 稳定 |
| M2: 架构统一 | Phase 2 | 第 5 周末 | 统一状态管理，单一 WebSocket |
| M3: 体验优化 | Phase 3 | 第 8 周末 | 渐进式 UI，四层信息架构 |
| M4: 记忆系统 | Phase 4 | 第 11 周末 | 跨 Agent 记忆共享 |
| M5: 发布 v0.3.0 | Phase 5 | 第 12 周末 | 完整文档，85% 测试覆盖 |

---

## 风险管理

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| OpenClaw API 变更 | 中 | 高 | 添加适配层，定期同步 upstream |
| WebSocket 合并导致回归 | 中 | 中 | 充分测试，灰度发布 |
| 记忆系统性能问题 | 低 | 中 | 添加缓存，限制搜索范围 |
| 人力资源不足 | 中 | 高 | 优先处理 P0/P1 任务 |

---

## 成功指标

| 指标 | 基线 | 目标 | 测量方式 |
|------|------|------|----------|
| 技术债务评分 | 5.6/10 | 8.0/10 | 内部评估 |
| 测试覆盖率 | ~60% | 85% | vitest --coverage |
| 内存泄漏 | 存在 | 无 | 长时间运行测试 |
| 文档完整性 | 4/10 | 8/10 | 文档审查清单 |
| 用户满意度 | - | 4.5/5 | 用户调研 |

---

*路线图制定日期：2026-03-24*
*下次审查日期：2026-04-24*
