# docs/product

产品范围与术语的仓库内权威表述。它回答"我们做的是什么、不做什么、对用户承诺什么"，不回答"怎么实现"。

## 内容范围

| 主题 | 说明 |
|---|---|
| 目标与非目标 | 首个版本覆盖什么、明确不覆盖什么 |
| 术语表 | 规划条目、工作项、变更请求、执行上下文、能力域等词的一致用法 |
| 目标形态 | 页面与交互的目标形态（不是实现顺序） |
| 范围分级 | MVP / V1 / 后续版本的边界 |

## 当前依据

在本目录下的主题文档补齐之前：

- `deepseek-harness-project-delivery-engineering-pack-v0.1/deepseek-harness-project-delivery-prd-v0.5.md` —— 当前 PRD（v0.4 已被其取代）；
- `deepseek-harness-project-delivery-engineering-pack-v0.1/deepseek-harness-project-delivery-ui-spec-v0.1.md` —— 界面与交互规范。

## 约束

- 视觉覆盖范围**大于**实现范围是有意设计：先保证产品一致性，再按纵向切片交付。不要把目标形态直接当成实现清单。
- 产品结论与工程不变量冲突时，以 `AGENTS.md` §1.3 的七条不变量为准，并回到 ADR 层评审。
