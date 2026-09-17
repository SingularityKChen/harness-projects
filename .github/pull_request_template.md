<!--
标题格式：<type>(<scope>): <中文摘要>（AGENTS.md §8.2）
规模上限：代码 ≤ 1000 行、文档 ≤ 1500 行；超出请先拆批次（AGENTS.md §8.3）
-->

## 闭环

<!-- 这个 PR 独立解决了什么？验收标准是什么？怎么回滚？必须构成可独立验收、合并、回滚的能力闭环。 -->

## 关联

- ExecPlan: `docs/exec-plan/active/YYYY-MM-DD-<slug>.md`（Batch N）
- Closes #
- Refs #

## 验证证据

<!-- 只写真正执行过的命令与观察到的输出。按改动面选最小证据，见 docs/review/README.md §2。 -->

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm verify`

<details>
<summary>Proof</summary>

<!-- 粘贴命令输出、检查链接、回读结果等可复核证据。 -->

</details>

## 风险与回滚

<!-- 最坏情况是什么？如何回滚？是否存在 revert 无法回退的外部状态（远端配置、项目字段、外部服务）？ -->
