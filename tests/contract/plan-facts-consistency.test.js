/**
 * 栈内计划事实一致性契约（离线）。
 *
 * 保护的性质：本栈（SQLite v1 数据模型栈，控制计划 `docs/exec-plan/completed/2026-09-23-sqlite-v1-stack.md`）
 * 的 ExecPlan 在**每个合并点**只写那个时点为真的事实。三条规则都可机械判定，且都是「第三轮与第四轮各复发
 * 过一次」的那一类：
 *
 * (i) **不写字面 `Closes #N`**（按 GitHub 的整张关闭关键字表、大小写不敏感判定）：`Closes` 是发布面上的事实断言，唯一权威是 GitHub 的
 *     `closingIssuesReferences`。计划里写死它，就在同一事实上有了一份会漂移的手写副本——第四轮实测：
 *     控制计划的 Closes 列、各层计划正文与收敛计划的 Batch 标题是**三套互不相同的答案**。允许在同一行带
 *     `closingIssuesReferences` 的写法（那是回读命令，不是断言）。
 * (ii) **体量基线不写成值**：`size <SHA>` / `size <工作分支名>` 只在写入那一刻为真。允许，
 *     但同一行必须显式标注它是观察时刻快照（`观察时刻` / `不可复跑` / `回读`）。
 *     第四轮实测：#121 / #167 / #170 / #175 四层各有一处不可解析的 SHA 基线，且都是「上一轮修过一次」的。
 * (iii) **跨层引用必须可解析或显式声明**：反引号、Markdown 链接目标与围栏代码块里的 `docs/…` 路径在本检出内不存在时，同一行必须说明
 *     它是**未来层**的东西（`将新建` / `未来层` / `该层计划` / `由 L` / `随 L` / `PR #`）。
 *     栈自下而上合并，栈底文档引用只在上一层存在的文件，就是让 `main` 指向一个不存在的依据。
 *
 * 为什么需要它：`PLANS.md` §4 已经把三条都写成了规则，但**规则只是声明**——第三轮把三条写进计划后，
 * 第四轮在同一批 head 上复跑反例，六层里都有「回复称已修、实际未修」。强制点必须在能失败的检查里。
 *
 * 范围怎么定：按**内容**发现——一份计划只要引用了控制计划的路径（或它本身就是控制计划），它就是本栈的一份
 * 计划，三条规则对它一律生效。这样「新增一份本栈的计划」不需要改这个文件，范围也不会因为忘记登记而静默缩小；
 * 已知限度是：完全不引用控制计划的计划发现不到（判据自洽的代价，写在 Convergengence ExecPlan 的 D3 里）。
 *
 * 离线：只读仓库内的文档，不触网、不读凭据、不调用 gh。
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PLAN_DIRS = ['docs/exec-plan/active', 'docs/exec-plan/completed']
/**
 * 本栈的计划按**内容**判定，而不是按文件名日期：一份计划只要引用了控制计划的路径（或它本身就是控制计划），
 * 它就是本栈的一份计划。判据自洽（用被核对的那张表定义核对范围），且不会把同期别的栈的计划卷进来。
 */
const CONTROL_PLAN = '2026-09-23-sqlite-v1-stack.md'
const STACK_PLAN_NAME = /^2026-09-2[34]-.+[.]md$/

/** 同一条规则里的两种「显式说明」：写了就不算违规。 */
const SNAPSHOT_MARKERS = ['观察时刻', '不可复跑', '回读']
const FORWARD_MARKERS = ['将新建', '未来层', '该层计划', '由 L', '随 L', 'PR #', '拥有它的那一层', '由各层']
const CLOSES_ESCAPE = 'closingIssuesReferences'
/** GitHub 识别的全部关闭关键字（close / closes / closed / fix / fixes / fixed / resolve / resolves / resolved），大小写不敏感。 */
const CLOSING_KEYWORD = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#\d+/i

function discoverStackPlans() {
  const found = []
  for (const dir of PLAN_DIRS) {
    const absolute = path.join(repoRoot, dir)
    if (!existsSync(absolute)) continue
    for (const name of readdirSync(absolute)) {
      if (!STACK_PLAN_NAME.test(name)) continue
      const relative = path.posix.join(dir, name)
      const source = readFileSync(path.join(repoRoot, relative), 'utf8')
      if (name === CONTROL_PLAN || source.includes(CONTROL_PLAN)) found.push(relative)
    }
  }
  return found.sort()
}

const discovered = discoverStackPlans()
// 下限断言：发现机制失效时响亮失败，不静默跳过（解析不出任何一份本栈计划就当作违规）。
assert.ok(
  // 控制计划在栈进行中位于 active/，随栈顶归档后位于 completed/：两处都算发现到，不能两处都没有。
  discovered.length >= 1 && PLAN_DIRS.some((dir) => discovered.includes(path.posix.join(dir, CONTROL_PLAN))),
  '栈内计划事实守卫没有发现到控制计划本身：发现规则失效时不能当作通过',
)

const plans = discovered.map((docPath) => ({ path: docPath, source: readFileSync(path.join(repoRoot, docPath), 'utf8') }))

/** 行号从 1 起，报错时能直接定位。 */
const numbered = (doc) => doc.source.split('\n').map((text, index) => ({ lineNo: index + 1, text }))

test('栈内计划事实一致性：不写字面 Closes #N（唯一权威是 GitHub 的 closingIssuesReferences）', () => {
  const violations = []
  for (const doc of plans) {
    for (const { lineNo, text } of numbered(doc)) {
      // GitHub 的关闭关键字大小写不敏感，且不止 Closes 一个：按它的整张关键字表判定，不按作者的习惯写法。
      if (!CLOSING_KEYWORD.test(text)) continue
      if (text.includes(CLOSES_ESCAPE)) continue
      violations.push(doc.path + ':' + lineNo + ' → ' + text.trim().slice(0, 120))
    }
  }
  assert.deepEqual(violations, [],
    '计划里出现了字面 Closes #N：它只有 GitHub 能判定（gh pr view <n> --json closingIssuesReferences）。'
      + '要写就写 Refs，并在同一行给出回读命令或写明理由')
})

test('栈内计划事实一致性：体量基线不写成值，除非同一行标注它是观察时刻快照', () => {
  const SHA = /size\s+[0-9a-f]{7,40}/
  const BRANCH = /size\s+(?:feature|fix|docs|chore|test|project-management)\//
  const violations = []
  for (const doc of plans) {
    for (const { lineNo, text } of numbered(doc)) {
      if (!SHA.test(text) && !BRANCH.test(text)) continue
      if (SNAPSHOT_MARKERS.some((marker) => text.includes(marker))) continue
      violations.push(doc.path + ':' + lineNo + ' → ' + text.trim().slice(0, 120))
    }
  }
  assert.deepEqual(violations, [],
    '体量基线写成了值（SHA 或工作分支名）：它只在那一次写入时为真。改成'
      + ' BASE=$(gh pr view <n> -R <repo> --json baseRefOid -q .baseRefOid)，或就地标注「观察时刻快照 / 不可复跑」')
})

test('栈内计划事实一致性：反引号、链接与代码块里的 docs/ 路径必须在本检出内可解析，或说明它属于未来层', () => {
  // 三种写法都要看：反引号、Markdown 链接目标、围栏代码块里的裸路径——只认反引号时，同一个悬空引用换个写法就放行。
  const PATH_TOKEN = /`(docs\/[^`\s]*[.]md)`/g
  const LINK_TARGET = /\]\((docs\/[^)\s]*[.]md)\)/g
  const BARE_PATH = /(?<![\w/.-])(docs\/[^\s`'")\]]*[.]md)/g
  const violations = []
  for (const doc of plans) {
    let fenced = false
    for (const { lineNo, text } of numbered(doc)) {
      if (/^\s*```/.test(text)) { fenced = !fenced; continue }
      const tokens = fenced ? text.matchAll(BARE_PATH) : [...text.matchAll(PATH_TOKEN), ...text.matchAll(LINK_TARGET)]
      for (const match of tokens) {
        const referenced = match[1]
        if (existsSync(path.join(repoRoot, referenced))) continue
        if (FORWARD_MARKERS.some((marker) => text.includes(marker))) continue
        violations.push(doc.path + ':' + lineNo + ' → ' + referenced)
      }
    }
  }
  assert.deepEqual(violations, [],
    '计划引用了本检出里不存在的 docs/ 路径，而且没有说明它属于哪一层：栈自下而上合并，'
      + '栈底文档引用只在上一层存在的文件，等于让 main 指向一个不存在的依据。改成指向 PR，或写明「该层计划拥有 / 未来层将新建」')
})
