# PR #287 MMP 评审记录

## 锁定事实

- PR #287「feat(capabilities): expose change request branch and review facts」，Closes #279。
- 第一轮评审 head `8fd546bd`，base `main@6417d459`，4 个提交；评审前没有 review 或 thread；PR Fast Gate 与 Merge Gate 各 lane 在该 head 上 success（`Create review session` 失败是本地 DSH 端点未运行，非必需检查）。
- 作者是 Codex 会话，人类伙伴指定评审会话接手修订与合并。评审账号：Singularity-AI-Bot；开发、回复与合并：SingularityKChen。

## P0–P3 风险矩阵（第一轮）

| 层 | 结论 |
|---|---|
| 代码 | fake 先按 repository、再按 headBranch 字节精确过滤，然后排序、分页；空串答 `invalid_input`，未知分支答空页；正常与失败路径成立 |
| 产品闭环 | #279 三条验收成立；验收 2 主要靠 main 已有的 observation 规则 |
| 架构 | core 中没有 `reviewState` / `headBranch` 的消费方，工程事实不进入规划状态；依赖边不变 |
| 测试 | 过滤用例按 create 键早退，只读 provider 得到假绿（P2）；共享 suite 新增「声明 create 就必须能以裸 SHA 作 head」与「新建必为 unknown」两条 GitHub 做不到的义务（P2）；字节精确、相对集合、未知枚举、比较器方向缺判别（P3） |
| 工作项 | ExecPlan 声称的 port 注释不在 diff 中；多处过时陈述（P3） |

结论：0 × P0 / P1，2 × P2、6 × P3，APPROVE。

## 跨 PR 事实

- 与 #288 同改 `tests/contract/suites/development.js`。并集预演（main + #286 / #287 / #288 / #295 / #289）全量 1314/1314，#287 新增的 suite 行在并集中全部保留，并在 #288 的能力变体下实际执行。
- 合并次序：#288 先合并；本 PR rebase 到 main 后在 #288 更严格的 suite 上修订。

## 修复与复评

- 第一轮修复：
  - 不需要现建对象的过滤断言按 `listChangeRequests` 自己的键执行；
  - 新增可选的 `expect.preparedChangeRequest`，用于只读形态的投影判别；
  - 裸 SHA 作 head 可以成功（headBranch 为 undefined）或答结构化 `invalid_input`；
  - 新建时的 reviewState 不得是猜的结论；
  - 补字节精确（大小写、首尾空白）与按事实过滤的判别；scope 改为相对比较；
  - fake 把 union 之外的枚举投影为 unknown；
  - 观察测试两种创建顺序都跑；port 注释补上。
  - 三向适配器对照：只接受分支 head 的合法 adapter 在 base / 修订前 / 修订后分别 10/0、10/2、12/0。
- 修复复评：0 × P0–P2、5 × P3，最重要的是新规则只有合法 adapter、没有坏 adapter，7 个放松 suite 的变异都存活。第二轮修复：
  - 只读形态必须提供预置事实（具名的「测试装配缺」）；
  - 新建只允许 unknown / review_required；
  - 补真前缀与后缀子串的变体；
  - 每条新规则一个坏 adapter，13 个列入矩阵 required。
- 最终：窄集 164/164；全量 1289/1289；mvp0 7/7；代码 477/1000；45 个坏 adapter 全部带具名消息非零退出；47 个变异全部 RED。
