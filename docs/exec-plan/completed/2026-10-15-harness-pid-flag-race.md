# 变异夹具测试的 pid 标记竞态 ExecPlan

> 状态：Completed
> 创建：2026-10-15
> 范围：完成 issue #347：`tests/contract/review-mutation-harness.test.js` 里四个用例从标记文件读子进程 pid 时，读到「已建未写」的空文件得到 `0`，再把 `0` 交给 `process.kill`。只改测试读写标记的协议，不改 `scripts/review-mutate.mjs`。
> 上游输入：`AGENTS.md`、`PLANS.md`、issue #347、`docs/exec-plan/completed/2026-10-12-review-mutate-crash.md`（#302，这几个用例的来源）。
> 执行上下文：分支 `fix/harness-pid-flag-race`，工作树 `.worktrees/harness-pid-flag-race`，base `origin/main`（设计时 `21cb29eb`）。

## Purpose / Big Picture

完成后，这四个用例只在标记文件里出现完整的正整数 pid 之后才读取它，`process.kill` 永远拿不到 `0` 或 `NaN`；`alive()` 遇到非正整数直接断言失败，而不是对自己的进程组发信号。

最小成功证据：把基线剩余进程用例的写者改成「先建空文件、300 ms 后才写 pid」，旧读法稳定失败（「剩余进程 0 未被 SIGKILL」），新读法通过；新增的协议用例在「空文件 → 半截内容 → 完整记录」三步里只返回完整记录；四个用例连跑 50 次全绿，`pnpm verify` 全绿。

## Context and Orientation

- 写者：用例生成的脚本用 `writeFileSync(flag, String(pid))` 写标记。`writeFileSync` 先以截断方式打开（文件此刻已存在、内容为空）再写，读者能落在两步之间。
- 读者：用例轮询 `existsSync(flag)`，随即 `Number(readFileSync(flag, 'utf8'))`；`Number('')` 是 `0`。
- `process.kill(0, sig)` 的目标是调用者自己的进程组：`alive(0)` 恒为真；`process.kill(0, 'SIGKILL')` 会杀掉测试运行器自己。
- 受影响的四个用例：「EPIPE 崩溃时以 2 退出并杀死仍在变异批中的命令组」（`leaked`，无等待）、「三种信号中断时，包装进程下也在数秒内还原并以 130 退出」（`sleeper`，读前睡 100 ms）、「命令派生出脱离进程组的孙进程时……」（`escaped`，读前睡 100 ms，清理时 `process.kill(escaped, 'SIGKILL')`）、「基线中断后即使包装进程退出也 SIGKILL 剩余进程组」（`leftover`，无等待）。
- 观测：2026-10-15 对四个开放 PR 的并集跑六次 `pnpm verify`，一次在 `leftover` 用例失败；该文件与 `scripts/review-mutate.mjs` 与 `main` 无差异。

## Design / Spec

- 标记是一条记录：写者写 `` `${pid}\n` ``（换行是记录结束符），读者只接受匹配 `^[1-9]\d*\n$` 的全文。空文件、写到一半的数字都不匹配，继续等。
- 读者是一个函数 `readPid(flag, timeoutMs = 20_000)`：每 25 ms 读一次，匹配即返回 `Number`；超时返回 `undefined`，由调用方用原有的「没有启动」断言报告。四个用例的「轮询存在 + 立即读」与两处 100 ms 睡眠都换成它。
- `alive(pid)` 先断言 `Number.isSafeInteger(pid) && pid > 0`；删掉信号用例里与顶层逐字相同的局部 `alive`，让守卫对它也生效。
- 被放弃的方案：只在写者侧用临时文件加 `renameSync` 原子替换——要改四处生成脚本，且读者仍信任「存在即写完」，下一个新用例照旧会踩；只加长睡眠——是概率缓解，不是修复；改 `scripts/review-mutate.mjs`——问题不在夹具。
- 不变量：用例对夹具行为的断言不变；任何路径都不把非正整数交给 `process.kill`。

## Global Constraints

- 只改 `tests/contract/review-mutation-harness.test.js` 与本计划、`docs/README.md` 索引；不改 `scripts/`。
- 体量：代码 ≤ 800、文档 ≤ 1300（CI 硬上限 1000 / 1500），本计划预计代码约 40 行。
- 先写会失败的判别性用例再改实现；变异先证明已施加（锚点恰好一次、按内存原文还原）。
- 不写 git config；提交只写 `Refs #347`；合并由人类伙伴决定。

## Plan of Work

### Batch 1 · 计划与 draft PR

最小闭环：本计划与索引入库，draft PR 关联 #347。涉及文件：本计划、`docs/README.md`。验证：`node --test tests/contract/plan-facts-consistency.test.js tests/contract/content-placement.test.js tests/contract/e1-evidence-consistency.test.js`（期望全绿）、`node scripts/rule-checks.mjs disclosure origin/main`（期望通过）。回滚：关闭 draft PR。

### Batch 2 · 记录协议、守卫与四个用例

最小闭环：协议用例先红后绿，四个用例改用 `readPid`，守卫生效。涉及文件：`tests/contract/review-mutation-harness.test.js`。步骤：先加协议用例（引用尚不存在的 `readPid`，红），再实现 `readPid` 与 `alive` 守卫、改四个写者为带换行的记录、四个读者改用 `readPid` 并删去 100 ms 睡眠与局部 `alive`。验证：`node --test --test-timeout=120000 tests/contract/review-mutation-harness.test.js`（期望全绿）；把基线剩余进程用例的写者换成「先建空文件、300 ms 后才写」的临时副本，在修复前后各跑一次（期望修复前失败于「剩余进程 0」、修复后通过）。回滚：`git revert`。

### Batch 3 · 对抗验证、连跑与收尾

最小闭环：三个变异都被杀死，四个用例连跑 50 次全绿，全量验证通过，计划归档。变异：M1 读者不要求换行（协议用例应红）；M2 去掉 `alive` 的正整数守卫（协议用例应红）；M3 基线用例退回「存在即读」并配延迟写者（应红）。验证：`pnpm verify`、`pnpm run boundaries`、`node scripts/rule-checks.mjs size origin/main`、`git diff --check origin/main...HEAD`。回滚：`git revert`。

## Concrete Steps

所有命令在 `.worktrees/harness-pid-flag-race` 根目录运行。

    node --test --test-timeout=120000 tests/contract/review-mutation-harness.test.js
    node --test --test-timeout=120000 --test-name-pattern "基线中断后即使包装进程退出" <延迟写者副本>
    for i in $(seq 1 50); do node --test --test-timeout=120000 --test-name-pattern "EPIPE 崩溃|三种信号中断|脱离进程组的孙进程|基线中断后即使包装进程退出" tests/contract/review-mutation-harness.test.js >/dev/null 2>&1 || echo "fail $i"; done
    pnpm verify && pnpm run boundaries
    node scripts/rule-checks.mjs size origin/main && node scripts/rule-checks.mjs disclosure origin/main && git diff --check origin/main...HEAD

延迟写者副本：复制测试文件为未跟踪的 `tests/contract/zz-repro-pidflag.test.js`，把基线剩余进程用例生成脚本里的 `writeFileSync(flag, …)` 换成 `openSync(flag, 'w')`、等 300 ms、再 `writeSync`；用完删除，不提交。

## Validation and Acceptance

| 验收（issue #347） | 判定证据 |
|---|---|
| 空文件后写入时返回真实 pid，旧读法得 `0` | 协议用例；延迟写者副本在修复前后的对照 |
| 没有 `0` / `NaN` 进入 `process.kill`；`alive()` 拒绝非正整数 | 协议用例对 `0`、`1.5`、`NaN`、`-1` 的断言与记录后多余字节（`4242\n5`）的断言；M2 变异与评审的 N2、N3、N5 |
| 四个用例连跑 50 次全绿，`pnpm verify` 通过 | 连跑计数与 `pnpm verify` 读数 |

## Progress

- [x] 2026-10-15 16:10 +08 定位根因并稳定复现：延迟写者副本下旧读法失败于「基线中断后剩余进程 0 未被 SIGKILL」。
- [x] 2026-10-15 16:16 +08 Batch 1：计划提交推送（归档前整理为 `68c44305`），draft PR #348 关联 #347（`closingIssuesReferences` 含 347）；计划 lint 与文档契约 18/18 通过。
- [x] 2026-10-15 16:25 +08 Batch 2：协议用例先红（`ReferenceError: readPid is not defined`）后绿；`readPid` 与 `alive` 守卫落地，四个写者改为 `String(pid) + '\n'`，四个读者改用 `readPid`，删去两处 100 ms 睡眠与信号用例里的局部 `alive`；整文件 18/18 通过；延迟写者副本在修复后通过（修复前失败于「剩余进程 0」），副本已删除。
- [x] 2026-10-15 16:14–16:30 +08 Batch 3：M1（读者不要求换行）、M2（去掉 `alive` 守卫）、M3（读者把空文件当 `0` 返回）均 KILLED，每次施加前断言锚点恰好一次、按内存原文逐字节还原；四个受影响用例连跑 50 次 50/50 通过（565 s）；`pnpm verify` 1579 + 7、`pnpm run boundaries` 9/9、size 代码 70 / 文档 106、`git diff --check` 无输出；计划归档。

## Surprises & Discoveries

- 2026-10-15：生成脚本的每一行写在外层模板字符串里，写者不能再用嵌套反引号的模板字符串（会截断外层字面量）；记录写成 `String(pid) + '\\n'`。

- 2026-10-15：`escaped` 用例的清理 `process.kill(escaped, 'SIGKILL')` 在读到 `0` 时会杀掉测试运行器自己的进程组；它只靠读前 100 ms 睡眠避开竞态，比只会误报的另外三处更危险。

## Decision Log

- 2026-10-15：M3 由「基线用例退回存在即读并配延迟写者」改为读者层的等价变异「空文件也返回 `Number(text)`」。理由：集成层面的同一场景已由延迟写者副本在修复前后各跑一次覆盖（修复前红、修复后绿），读者层变异能在协议用例里稳定、快速地判别。作者：协调者（Claude）。

- 2026-10-15：在读者侧定义「以换行结尾的完整记录」协议，而不是只在写者侧改原子写。理由：一处读者函数覆盖全部现有与将来的用例，换行让写到一半的数字也可判别；写者只需在 pid 后加一个换行。作者：协调者（Claude）。

## Idempotence and Recovery

改动只在一个测试文件；任何一步都可 `git revert`。复现副本是未跟踪的临时文件，用完删除，不入库。

## Artifacts and Notes

- 修复前的稳定复现（延迟写者副本）：`✖ 基线中断后即使包装进程退出也 SIGKILL 剩余进程组`，`AssertionError: 基线中断后剩余进程 0 未被 SIGKILL`。

## Interfaces and Dependencies

无对外接口变化；`scripts/review-mutate.mjs` 不变。上游：#302 引入这些用例。

## Outcomes & Retrospective

#347 的三条验收都已满足：协议用例证明空文件与半截记录不会被当成 pid，旧读法在同一输入上得 `0`；`alive()` 对非正整数直接断言失败，四个用例不再有任何路径把 `0` 或 `NaN` 交给 `process.kill`；相关用例连跑 50 次全绿，全量验证通过。改动只在一个测试文件，`scripts/review-mutate.mjs` 未改。遗留：无新的技术债。

## Bottom Change Note

- Change Note (2026-10-21)：按 PR #348 的 MMP 评审修复：协议用例补 `alive` 对 `1.5`、`NaN`、`-1` 的断言与 `4242\n5` 不被读成 pid 的断言（评审变异 N2 只判 `> 0`、N3 改成 `!== 0`、N5 读者去掉结尾 `$` 原先存活，现均被杀）；订正 Progress 里整理前的提交号与「五个用例」（连跑命令的 `--test-name-pattern` 只匹配四个受影响用例）。Progress 的时刻是执行时的记录，提交在归档前整理过，作者时间与这些时刻不一一对应。评审记录见 `docs/review/pr-348-mmp-review.md`。
- Change Note (2026-10-15 16:30 +08)：回填三个批次的读数、M3 的等价替换与模板字符串的发现，计划归档。
- Change Note (2026-10-15 16:15 +08)：创建计划——根因、以换行结尾的记录协议、三批次与验收表；补 Concrete Steps 与 Artifacts and Notes。
