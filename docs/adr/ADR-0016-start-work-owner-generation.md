# ADR-0016：Start Work 的持久 owner 代际

> 状态：Proposed
> 日期：2026-10-29
- 关联：#420、#304、#421；实施计划：[Start Work owner fencing](../exec-plan/completed/2026-10-29-start-work-owner-fencing.md)。

## Why

30 秒租约允许中断后的接管，却不能撤销仍存活的旧调用。旧调用在 Provider await 中停留，接管者已经提交以后再返回，原实现仍可回填 context、关系、attempt 和 run；两个调用均可能报告 Saved，最后一个句柄覆盖前一个。Ready 会清除租约时刻，但运行启动及其落账尚可能在途；以时间戳作为 owner 会漏掉这一阶段。

同一 context 的认领与 Storage transaction 已串行化。需要约束的是本地耐久写者，外部 Provider 不在这个事务中。

## Decision

1. `ExecutionContextRecord.provisioningGeneration?: number` 是持久 owner 身份。真正的新建、终态续跑、过期接管在同一认领事务内从上次值加一；未认领记录视为 0。值只允许 1..9007199254740991 的整数，耗尽时在认领写入前 conflict，不回绕。相同 key 重放、未过期观察和既有 Ready 不增代。
2. 租约 timestamp 只判定是否允许接管；generation 在 Ready/Failed/Closed 后保留。optional 用于无主的持久记录/契约夹具，不允许生产供应缺 owner。
3. Core 的私有短事务 helper 同时读取 current、比较期望 generation 并执行依赖写。分步回填、最终 context+关系+attempt 和所有主/unknown/人工 run 结算都使用它。路由拒绝的过期接管同样增代，防止旧 owner 撤销新 Failed 状态。Provider I/O 始终在事务外。
4. 迟到 owner 不改旧 attempt，不删除资源或发起新 fallback；已有 ack 时返回 result_unknown 和本次 ack 的句柄，未得到外部 ack 时返回 conflict。磁盘等一般本地写异常仍按既有 Unknown/ack 保留规则处理，不能把 owner 失效与磁盘失败混为一类。
5. 既有 Ready 的工作树验证需要降 Failed 时，必须在事务里复判 generation、Ready 状态和 branch/worktree 身份。若已变化，只重新读取当前本地事实，不重试无限的 Provider 验证。

## Consequences

### Storage 与数据库边界

Fake 和 SQLite 均校验正 safe integer；Fake 导出导入、SQLite 实际关库重开保留 generation。SQLite 在现有 `003_control_facts.sql` 增加可空整数列及 CHECK，当前不兼容世代从 1 变为 2。仍使用七份 SQL 建完整新库，没有第八份迁移、兼容 ALTER 或自动数据搬迁。

旧 generation=1 数据库拒绝；把缺列旧形状伪装成 2 或 0 也按 schema_shape 拒绝。拒绝不得改变原库 schema、行、账本或 user_version。用户需要停止相关进程、备份原库并核对所需数据，再决定在新位置重建；不自动删除旧库。

回滚必须匹配旧 artifact 与原备份库，不让旧程序降代接管新库，也不覆盖新库。分支、工作树、外部 run 及旧库都保留作恢复依据。

## Rejected

- opaque UUID/时刻/key：需要额外信任身份不复用；时刻可重复且 Ready 后清空。已有串行事务直接递增代际，能独立验证同钟值及重启后的 ABA 排斥。
- 通用 CAS/分布式锁端口：为单一编排者扩散接口，也不能把跨 Provider I/O 放进本地原子域。保持一个 Core owner 和现有 transaction 即可。
- 仅检查入口或仅保护 Git：旧调用可以在检查以后长时间 await；每个耐久写入边界必须重新比较，且比较和写入不能分开。

## 证据、限制与后续

`tests/integration/start-work-owner-fencing.test.js` 在 Fake/SQLite 上用注入时钟和屏障覆盖真实命令接管、route-denied 撤销、Ready/run 结算协议、迟到 Ready 验证及代际持久化。Ready 缺 run 当前不能通过正常命令直接接管，run 用例明确安装后继 Storage fixture，只证明本地结算协议，不伪称 public command 可达。

本决策不保证 at-most-one 外部 start：接管可以与已经在途的外部调用或丢失 ack 交错。#421 负责外部唯一性，#204 负责耐久 intent，#193 负责重启/不确定结果对账，父 #304 不由本切片关闭。这里的本地测试不代替 hosted CI、真实模型、Demo、Gate E1 或 R1 人类裁决。

设计原则参考 SQLite 官方事务文档的 IMMEDIATE 原子写域，以及 etcd 官方 `client/v3/concurrency/mutex.go` 的 IsOwner 事务比较；没有引入 etcd 依赖。
