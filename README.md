# harness-projects

项目交付工作台：让**项目规划事实源**（GitHub Projects / 本地）与**工程执行事实**（本地 Git、GitHub、CI、Agent 执行）在同一个工作空间里被显式关联，而不是靠人去记忆和脑补。

## 它解决什么

- 规划状态与工程状态正交：CI 失败、Agent 完成、PR 合并都不会默认改写项目规划状态。
- 外部平台可替换：能力定义与具体实现分离，`core` 不依赖任何具体 Provider。
- 外部写入可追溯：只有 Provider 确认之后，本地才把新值当成权威事实。

## 它不是什么

- 不是又一个看板 UI：界面只是消费者，Host 拥有权威状态。
- 不是多主实时同步：一个工作空间只有一个规划事实源。
- 不是 LLM 驱动的项目管理：关键关联显式优先，模型不进入控制路径。

## 结构

```text
apps/        外壳：Harness 客户端模块注册、独立 Web
packages/    domain · capabilities · core · controller · client · ui-model · ui
             providers/*（规划 / 研发 / 交付 / 执行）· storage/sqlite
tests/       contract · integration · e2e
docs/        architecture · adr · product · exec-plan
```

依赖方向是单向的，并由契约测试保证：`providers|storage → capabilities → core → controller → client → ui-model → ui → apps`。

## 快速开始

```bash
pnpm install
pnpm verify        # typecheck + 契约测试
```

## 工作方式

| 文档 | 作用 |
|---|---|
| [`AGENTS.md`](AGENTS.md) | 唯一权威约定：目录所有权、依赖方向、文档落点、exec-plan、分支与 PR 规则 |
| [`PLANS.md`](PLANS.md) | ExecPlan 的格式与生命周期 |
| [`docs/README.md`](docs/README.md) | 文档地图与计划索引 |
| [`CLAUDE.md`](CLAUDE.md) | 指向 `AGENTS.md` 的相对软链接 |

## 当前阶段

产品与工程设计已冻结，进入实现前的身份与同步验证（Gate E1）。在此之前优先交付不依赖真实 GitHub 也能验收的纵向切片；上游依据见 `deepseek-harness-project-delivery-engineering-pack-v0.1/`（冻结输入，只读）。
