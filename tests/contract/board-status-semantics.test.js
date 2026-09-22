// `Status` 的语义在仓库里只能有一个事实源，且被推翻的那套读法不能悄悄活回来。
//
// 为什么需要它：2026-09-22 实测发现同一个字段在仓库里同时有两套互不相容的定义——
// `docs/product/board-semantics.md` §2 说它是规划轴，`docs/project-management/README.md`
// §1 说它「与 PR 生命周期对齐」。issue #55 的验收标准是 `grep -rn '开发做完没' docs/`
// 输出为空；它**通过了**，因为活下来的那份定义用的是另一组词。这是本仓库反复警惕的
// 假绿：检查看得见的字面量，看不见同一个断言的另一种写法（issue #112）。
//
// 因此本文件按**断言**而不是按**文件清单**设防，并且把「历史记录」与「活定义」分开：
// 只有显式白名单里的文件可以引用旧读法，新文件命中即红。

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

const BOARD_SEMANTICS = 'docs/product/board-semantics.md'
const PROJECT_MANAGEMENT = 'docs/project-management/README.md'
const WORKFLOW = 'docs/development/workflow.md'

const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8')

function markdownFiles(relativeDir) {
  const found = []
  for (const entry of readdirSync(path.join(ROOT, relativeDir), { withFileTypes: true })) {
    const relative = path.posix.join(relativeDir, entry.name)
    if (entry.isDirectory()) found.push(...markdownFiles(relative))
    else if (entry.name.endsWith('.md')) found.push(relative)
  }
  return found
}

/**
 * 被 issue #55 与 `2026-09-18-rule-semantics-and-checker-convergence.md` D1 推翻的
 * 那套读法。按**断言的结构**列，不按措辞列——漏掉一种说法就是漏掉一整套定义。
 *
 * 演进：第一版是三个字面短语（`与 PR 生命周期对齐`、`PR 已提交待评审`、`──提交 PR──▶`），
 * 评审指出被删掉的那句话有两个子句（`In Review` 与 `Done`），而 `Done` 那一半没有约束。
 * 第二版改成「取值名 + 定义算子 + 短窗口内的工程词」，2026-09-22 复核实测出两个缺口：
 *
 * - **误报**：`PR` 只要求落在窗口里，不要求它是**被定义项**。于是
 *   `` `In Review` 表示工程侧已交付，等规划所有者验收；PR 已合并不等于接受 ``
 *   这句在**陈述新语义**的话会命中，而失败文案让作者把它加进白名单——白名单是按整文件
 *   豁免的，等于让一份写对的文档退出棘轮。
 * - **漏报**：`代表` 类算子、工程事实在前的语序、`保持同步` 这类同义替换都不命中。
 *
 * 第三版按**子句**求值，并显式声明三条边界：
 *
 * 1. 只在同一行、同一子句内判定（换行与 `；`、`。` 等句读处截断），窗口不跨句；
 * 2. 子句里出现否定（`不等于` / `不推进` / `不改` …）即整句跳过——**否定旧读法的句子不是旧读法**；
 * 3. 工程事实必须是**被定义项**：`In Review` 要求 `PR 提交/待评审` 或「已提交 … 评审」，
 *    `Done` 要求 `合并` / `已验收`。因此「工程侧已提交，等验收」这类新语义措辞不会命中。
 *
 * 已知边界（刻意不覆盖，见计划「遗留问题与技术债务」）：不用 `PR` 字面、也不含「待评审」
 * 的旧读法；以及语义等价但完全换用另一组词的表述。棘轮的作用是抬高回归成本，不是证明
 * 语义等价——后者不可判定。
 */
const SENTENCE_BREAK = /[；。！？\n]/

/** 否定旧读法的句子不是旧读法（`In Review` 不等于 PR 待评审）。 */
const NEGATED = /不等于|不代表|不是|不推进|不改|不改变|不因|并非|而非|不写|不设/

/**
 * 明确标注为历史的句子是历史记录，不是活定义。
 * `docs/` 里的活文档必须能解释自己改过什么——`project-management/README.md` 就要写
 * 「本表曾经把它说成由 PR 生命周期驱动的工程口径」。把它判成违规，等于逼文档删掉改前状态。
 */
const HISTORICAL = /曾经|此前|原先|已被推翻|已推翻|旧读法|原读法/

const SKIP = new RegExp(NEGATED.source + '|' + HISTORICAL.source)

/** 定义算子：等号、冒号、系词，以及表格竖线（`| \`Done\` | 已合并 |`）。 */
const DEFINE_OPERATOR = /[=＝:：]|表示|是|指|代表|即|\|/

/** 取值名 + 定义算子 + 短窗口内的工程事实。窗口不跨句读——否则会把下一句里的 `PR` 当成被定义项。 */
const defines = (value, fact) =>
  new RegExp(
    '`?' + value + '`?[^\\n；。！？]{0,8}(?:' + DEFINE_OPERATOR.source + ')[^\\n|；。！？]{0,24}(?:' + fact.source + ')',
  )

/**
 * 按子句求值：句读与换行处截断，跳过否定句与标注为历史的句子，命中时返回该子句
 * （失败文案要能看见它）。返回 `null` 表示未命中。
 */
function clauseMatch(source, pattern) {
  for (const clause of source.split(SENTENCE_BREAK)) {
    if (SKIP.test(clause)) continue
    if (pattern.test(clause)) return clause.trim()
  }
  return null
}

const LEGACY = [
  {
    label: '把 Status 整体绑到 PR 生命周期',
    match: (source) => clauseMatch(source, /PR\s*生命周期\s*(?:保持)?(?:对齐|一致|同步|绑定|挂钩|跟随|驱动)/),
  },
  {
    label: '把 In Review 定义成 PR 提交 / 待评审',
    match: (source) =>
      clauseMatch(source, defines('In Review', /PR\s*(?:已提交|提交|待评审|评审)|已提交[^\n]{0,12}评审|待评审/)),
  },
  {
    label: '把 Done 定义成合并 / 验收事实',
    match: (source) => clauseMatch(source, defines('Done', /合并|已验收/)),
  },
  {
    label: '旧状态机用工程事件做转移标签',
    match: (source) => clauseMatch(source, /──[^\n]{0,12}(?:提交 PR|合并|评审)[^\n]{0,12}──▶/),
  },
  {
    label: '工程事实在前、Status 取值在后的推进句式',
    match: (source) =>
      clauseMatch(
        source,
        /(?:PR|合并|评审|CI)[^\n]{0,24}(?:改成|改为|置为|设为|变成|推进到|同步|对齐|驱动)[^\n]{0,12}`?(?:Todo|In Progress|In Review|Done)`?/,
      ),
  },
]

/**
 * 允许引用旧读法的文件——它们记录的是"改前"状态，不是当前生效的定义。
 *
 * 这份清单不是"第二份权威副本"（`scripts/board-workflow-check.mjs` 明确拒绝的那种），
 * 它不表达任何语义，只表达"这个文件在讲历史"。
 *
 * **按 basename 而不是完整路径匹配**：`AGENTS.md` §3 要求完成的 ExecPlan 从
 * `docs/exec-plan/active/` 移到 `docs/exec-plan/completed/`，而本计划文件自身含旧读法
 * （它记录了改前状态），归档后仍然需要豁免——只是路径变了。写死路径会让归档那次 PR
 * 必然变红，且失败文案会指向错误的修法。
 */
const LEGACY_ALLOWED = new Set([
  '2026-09-17-repo-collaboration-setup.md',
  '2026-09-22-status-field-writer.md',
])

const basename = (file) => file.split('/').pop()

const section = (source, prefix) => source.split('\n## ').find((part) => part.startsWith(prefix))

test('字段表只登记 Status，不复述它的定义', () => {
  const row = read(PROJECT_MANAGEMENT).split('\n').find((line) => line.startsWith('| Status |'))
  assert.ok(row, '字段表里必须有 Status 行')
  assert.match(row, /board-semantics\.md/, 'Status 行必须指向权威定义，而不是在本表里再写一份')

  // 只断言"有链接"看不见"链接旁边又抄了一份定义"。评审实测：本行曾同时写着
  // 「回答「规划所有者是否接受这个工作项完成」」与「本表只登记字段、不复述定义」——
  // 一份丢了「由**人**拥有」的改写副本，而测试全绿。这里按**断言**而不是按措辞设防：
  // 权威定义 §1 的判别性措辞一旦出现在本行，就是复述。
  assert.doesNotMatch(
    row,
    /规划所有者|是否接受|由\s*\*{0,2}人\*{0,2}\s*拥有/,
    'Status 行只能指向权威定义；出现 §1 的判别性措辞即视为复述',
  )
})

test('board-semantics 把 Status 放在规划轴、Engineering 放在工程轴', () => {
  const source = read(BOARD_SEMANTICS)
  const row = source.split('\n').find((line) => line.startsWith('| 看板字段 |'))
  assert.ok(row, 'board-semantics §2 必须有「看板字段」行')

  // 表头是「| | 规划轴 | 工程轴 |」，所以第 2 列是规划轴、第 3 列是工程轴。
  const cells = row.split('|').map((cell) => cell.trim())
  assert.match(cells[2], /`Status`/, '规划轴那一列必须是 Status')
  assert.match(cells[3], /`Engineering`/, '工程轴那一列必须是 Engineering')
  assert.match(source, /`Status` 只由人写/, '不变量 3 的看板表述必须还在')
})

test('四个取值在规划轴下各自有含义，且不靠工程事件推进', () => {
  const flow = section(read(PROJECT_MANAGEMENT), '2. 状态流转')
  assert.ok(flow, 'project-management/README.md 必须有「2. 状态流转」')

  for (const value of ['`Todo`', '`In Progress`', '`In Review`', '`Done`']) {
    assert.ok(flow.includes(value), `§2 必须给出 ${value} 在规划轴下的含义`)
  }
  assert.match(flow, /工程事件不推进 `Status`/, '§2 必须写明工程事件不推进 Status')
  assert.match(flow, /规划所有者/, '§2 必须写明由谁推进')

  // 2026-09-22 复核：这条规则曾写「七条会写 `Status` 的内置工作流已全部关闭」。会写 `Status`
  // 的 7 条里 `Item added to project` 是**开启**的（§2 的唯一机械例外），而关闭的 7 条里
  // `Auto-close issue` 不写 `Status`。断言点名这个例外，让「全部关闭」那种读法不能悄悄回来。
  const closure = flow.split('\n').find((line) => line.includes('工程事件不推进'))
  assert.ok(closure, '§2 必须有「工程事件不推进 Status」这条规则')
  assert.match(
    closure,
    /Item added to project/,
    '关闭声明必须点名 §2 的唯一机械例外（`Item added to project` 保持开启）',
  )
})

test('交付流程写明合并之后谁推进 Status、以及代理写入的批准要求', () => {
  const source = read(WORKFLOW)
  const part = section(source, '3.2')
  assert.ok(part, 'docs/development/workflow.md 必须有讲 Status 的一节')

  assert.match(part, /board-semantics\.md/, '必须指向权威定义')
  assert.match(part, /规划轴/)
  assert.match(part, /规划所有者/, '必须写明由规划所有者决定')
  assert.match(part, /Decision Log/, '必须写明代理写入的批准要留痕')
  assert.match(part, /repository-rules\.md/, '必须指向代理写入的规则出处')

  // 同 `project-management/README.md` §2：关闭声明必须点名 §2 的唯一机械例外。
  const closure = part.split('\n').find((line) => line.includes('全部关闭'))
  assert.ok(closure, '§3.2 必须写明内置工作流的关闭状态')
  assert.match(
    closure,
    /Item added to project/,
    '关闭声明必须点名 §2 的唯一机械例外（`Item added to project` 保持开启）',
  )
})

test('被推翻的工程轴读法只能作为历史记录存在，新文件命中即红', () => {
  const files = markdownFiles('docs/')
  const offenders = []

  for (const file of files) {
    if (LEGACY_ALLOWED.has(basename(file))) continue
    const source = read(file)
    for (const rule of LEGACY) {
      const excerpt = rule.match(source)
      if (excerpt) offenders.push(`${file} —— ${rule.label}：「${excerpt.slice(0, 60)}」`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `以下文件把已被推翻的工程轴读法写成了活定义（若是在记录历史，请把它的 basename 加进 LEGACY_ALLOWED 并说明理由）：\n${offenders.join('\n')}`,
  )
})

test('白名单不腐烂：每条 basename 都必须有对应文件，且真的命中旧读法', () => {
  const files = markdownFiles('docs/')
  for (const allowed of LEGACY_ALLOWED) {
    const matches = files.filter((file) => basename(file) === allowed)
    assert.ok(
      matches.length > 0,
      `白名单条目没有任何对应文件（改名了？）：${allowed}。注意本清单按 basename 匹配，归档移动目录不会让它失效`,
    )
    assert.ok(
      matches.some((file) => LEGACY.some((rule) => rule.match(read(file)) !== null)),
      `白名单条目已不再命中任何旧读法，应删除：${allowed}`,
    )
  }
})
