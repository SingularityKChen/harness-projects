/**
 * Gate E1 证据一致性契约（离线）。
 *
 * 保护的不变量：E1 的证据文件集合（沙箱定义、`docs/architecture/gate-e1-*.md` 记录、承载它们的
 * ExecPlan）在**内容**上互相一致——
 * (i) 记录集合里出现的每个 id 字面量都能在沙箱定义里找到，且同一个 id 只绑定一个变量名。判定取
 *     三类合法来源的并集：§2.3 夹具 / §2.4 字段（沙箱对象）、§2.5 清单外的 id（观测期间临时创建并
 *     已删除的临时对象、转换动作产生的 id、内置字段、另一个 project 的字段）、§2.6 构造的输入；
 * (ii) 记录集合里每一条「规划字段值」行引用同一条「只计用户可写」的定义，且汇总表（alpha / beta /
 *      gamma 那一行）的三个数与逐实验行逐一相等；
 * (iii) 文档里「N 个 `fieldValues`（…枚举…）」的原始计数等于括号里枚举出的项数。
 *
 * 为什么需要它：本批次的验证命令只查结构计数（grep 计数、体量、发布面扫描、空白），对文档内容没有
 * 判别力——第二轮评审的 P1（汇总表 beta 格写 0，而实验 2 自己的行是 1）正是从它们眼皮下过去的。
 * 规则写进计划只是声明，强制点在能失败的检查里（ExecPlan D8 的 R1）。
 *
 * 为什么记录必须按集合发现：把记录硬编码成一份，等于让 (i) 对其余记录只是**声明**——实测 E1-2 的
 * 记录有 2 个、E1-3 的记录有 4 个 id 字面量不在旧版沙箱定义里，而旧测试照样全绿。发现到的记录数不足
 * 下限时响亮失败，不静默跳过。
 *
 * 离线：只读仓库内的文档，不触网、不读凭据、不调用 gh。
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const ARCHITECTURE_DIR = 'docs/architecture'
const SANDBOX_DOC = `${ARCHITECTURE_DIR}/gate-e1-sandbox.md`
// ExecPlan 完成后会从 active/ 移到 completed/，两个位置都发现，避免文件搬家造成无关失败。
const PLAN_DIRS = ['docs/exec-plan/active', 'docs/exec-plan/completed']
// 记录 = `docs/architecture/gate-e1-*.md`；沙箱定义是 id 的注册表，不是记录，要排除。
const RECORD_FILE = /^gate-e1-.+\.md$/
// ExecPlan 文件名带日期前缀（`2026-09-21-gate-e1-…`），因此按名字里出现 `gate-e1-` 发现。
const E1_PLAN_FILE = /gate-e1-.+\.md$/

// 下限都是「解析失效时不能当作通过」的强制点，不是对文档规模的期望值。
const MIN_RECORD_DOCS = 3
const MIN_PLAN_DOCS = 1
const MIN_SANDBOX_IDS = 20
const MIN_IDS_PER_RECORD = 3
const MIN_IDS_ACROSS_PLANS = 4
const MIN_PLANNING_FIELD_ROWS = 3

const readDoc = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8')

/** 按文件名模式发现一组文档；目录缺失时响亮失败（fail closed），不返回空集合。 */
function listDocs(relative, pattern, excludedBasenames = []) {
  const directory = path.join(repoRoot, relative)
  assert.ok(existsSync(directory), `证据目录缺失：${relative}`)
  return readdirSync(directory)
    .filter((name) => pattern.test(name) && !excludedBasenames.includes(name))
    .sort()
    .map((name) => ({ path: `${relative}/${name}`, source: readDoc(`${relative}/${name}`) }))
}

const sandbox = readDoc(SANDBOX_DOC)

// `gate-e1-*.md` 里不只有实验记录，还有裁决书（`gate-e1-ruling.md`）这类同样引用证据、但
// 没有九字段实验结构的文档。发现必须分两层，否则模板断言会对裁决书误报：
//   - gateDocs：全部 E1 文档 → id 不变量 (i) 对它们都跑（引用到的 id 一样要能追溯）；
//   - recordDocs：**有实验节**的那些 → 九字段模板断言 (b0) / (ii) 只对它们跑。
const gateDocs = listDocs(ARCHITECTURE_DIR, RECORD_FILE, [path.basename(SANDBOX_DOC)])
const recordDocs = gateDocs.filter((doc) => /^###\s*实验\s/m.test(doc.source))
assert.ok(
  gateDocs.length >= MIN_RECORD_DOCS,
  `只发现 ${gateDocs.length} 份 E1 文档（下限 ${MIN_RECORD_DOCS}）：`
    + `${gateDocs.map((doc) => doc.path).join(', ') || '（无）'}；`
    + 'E1 的证据分散在多份文档里，(i) 必须对每一份都跑，发现不到文档不能当作通过',
)
assert.ok(
  recordDocs.length >= MIN_RECORD_DOCS,
  `只发现 ${recordDocs.length} 份带实验节的 E1 记录（下限 ${MIN_RECORD_DOCS}）：`
    + `${recordDocs.map((doc) => doc.path).join(', ') || '（无）'}；`
    + '九字段模板断言只对带实验节的记录跑，发现不到不能当作通过。'
    + '若某份记录被改了实验节标题，要改的是标题而不是放宽这条下限',
)

const planDocs = PLAN_DIRS.flatMap((directory) => listDocs(directory, E1_PLAN_FILE))
assert.ok(
  planDocs.length >= MIN_PLAN_DOCS,
  `只发现 ${planDocs.length} 份 E1 ExecPlan（下限 ${MIN_PLAN_DOCS}）：`
    + `${planDocs.map((doc) => doc.path).join(', ') || '（无）'}`,
)

// 全部 E1 文档（含裁决书）+ 承载它们的 ExecPlan：id 不变量与 fieldValues 计数对整个集合跑。
// 这里刻意用 gateDocs 而不是 recordDocs——裁决书引用的 id 同样要能追溯，它只是不适用九字段模板。
const evidenceDocs = [...gateDocs, ...planDocs]

/**
 * id 字面量的形状。记号边界包含 `-`：沙箱定义里的 item id 形如 `PVTI_...k-I`。
 * 长度下限把正文里的**前缀写法**（`I_*`、`PVTI_*`、`DI_*`）排除掉，它们不是观测值。
 */
const ID_PREFIXES = ['PVTI_', 'PVTSSF_', 'PVTIF_', 'PVTF_', 'PVT_', 'I_kw', 'PR_kw', 'DI_', 'R_kg']
const ID_SHAPE = /[A-Za-z0-9_-]+/g
const MIN_ID_LENGTH = 10
const MIN_ID_SUFFIX = 5

function isIdLiteral(token) {
  const prefix = ID_PREFIXES.find((candidate) => token.startsWith(candidate))
  if (prefix === undefined) return false
  if (token.length < MIN_ID_LENGTH) return false
  return token.length - prefix.length >= MIN_ID_SUFFIX
}

function extractIds(source) {
  const ids = new Set()
  for (const token of source.match(ID_SHAPE) ?? []) {
    if (isIdLiteral(token)) ids.add(token)
  }
  return ids
}

/** 变量绑定：行首 `NAME=ID` 形式，只取值为 id 字面量的那些。 */
function extractBindings(source) {
  const bindings = new Map()
  for (const match of source.matchAll(/^([A-Z][A-Z0-9_]*)=([A-Za-z0-9_-]+)/gm)) {
    const [, name, value] = match
    if (!isIdLiteral(value)) continue
    if (!bindings.has(name)) bindings.set(name, new Set())
    bindings.get(name).add(value)
  }
  return bindings
}

/**
 * 取某个标题到下一个**同级或更高级**标题之间的正文。
 * 按标题级别截断，`### 2.5` 这类三级小节才不会吞掉紧随其后的 `### 2.6`。
 */
function docSection(source, headingPattern) {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => headingPattern.test(line))
  if (start < 0) return undefined
  const level = (lines[start].match(/^#+/)?.[0] ?? '#').length
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#+)\s/)
    if (heading !== null && heading[1].length <= level) {
      end = index
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

/** 一节里出现的 id 字面量；标题缺失时记在 missing 里，由调用方响亮失败。 */
function sectionIds(source, headingPatterns) {
  const ids = new Set()
  const missingHeadings = []
  for (const pattern of headingPatterns) {
    const section = docSection(source, pattern)
    if (section === undefined) {
      missingHeadings.push(pattern.source)
      continue
    }
    for (const id of extractIds(section)) ids.add(id)
  }
  return { ids, missingHeadings }
}

/** 按 `### 实验 N` 切分记录文件；下一个二级标题结束本节。 */
function experimentSections(source) {
  const sections = []
  let current
  for (const line of source.split('\n')) {
    const heading = line.match(/^###\s*实验\s*(\d+)/)
    if (heading !== null) {
      current = { index: Number(heading[1]), title: line.replace(/^#+\s*/, '').trim(), lines: [] }
      sections.push(current)
      continue
    }
    if (current !== undefined && /^##\s/.test(line)) {
      current = undefined
      continue
    }
    if (current !== undefined) current.lines.push(line)
  }
  return sections
}

/** 「本地应有行」表里以「规划字段值」开头的那一行，按 `|` 拆成单元格。 */
function planningFieldRow(section) {
  for (const line of section.lines) {
    if (!/^\|\s*规划字段值\s*\|/.test(line)) continue
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
    if (cells.length < 4) continue
    return { key: cells[1], countCell: cells[2], contentCell: cells[3] }
  }
  return undefined
}

/** 「行数」列里的整数，如 `1` → [1]、`1 / 1 / 1` → [1, 1, 1]。 */
function numbersIn(cell) {
  return (cell.match(/\d+/g) ?? []).map(Number)
}

/**
 * 该行内容列声称的「用户可写规划字段」个数：取最后一个「只有 …」子句里列出的反引号记号数，
 * 在第一个括号或逗号处截断（「（`Title` 是内容字段，不计入）」这类排除说明不算数）。
 * 解析不到就返回 undefined，由调用方 skip。
 */
function writableFieldCount(contentCell) {
  const marker = contentCell.lastIndexOf('只有')
  if (marker < 0) return undefined
  const tail = contentCell.slice(marker + '只有'.length)
  const stop = tail.search(/[（(，,。;；]/)
  const clause = stop < 0 ? tail : tail.slice(0, stop)
  const tokens = clause.match(/`[^`]+`/g) ?? []
  return tokens.length > 0 ? tokens.length : undefined
}

/** 文档里「N 个 `fieldValues`（…枚举…）」的两种语序。 */
const FIELD_VALUE_COUNT_PATTERNS = [
  /(\d+)\s*个\s*`fieldValues`\s*（([^）\n]*)）/g,
  /`fieldValues`[^\n。；]{0,6}?(\d+)\s*个\s*（([^）\n]*)）/g,
]

function fieldValueCounts(source) {
  const counts = []
  for (const pattern of FIELD_VALUE_COUNT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const [, rawCount, rawItems] = match
      const items = rawItems.split(/[、,，]/).map((item) => item.trim()).filter((item) => item.length > 0)
      // 只认真正的枚举：至少两项、每项都点名一个反引号记号，且没有「不计入」这类排除说明。
      const enumerable = items.length >= 2
        && items.every((item) => /`[^`]+`/.test(item))
        && !items.some((item) => /不计入|不含|除外/.test(item))
      if (!enumerable) continue
      counts.push({ count: Number(rawCount), items, raw: match[0] })
    }
  }
  return counts
}

/**
 * id 的三类合法来源。判定本身取整个沙箱定义文件的并集（见第一个 test 里的 `sandboxIds`），
 * 这里逐节解析只是为了证明三类都真的登记了 id：否则「并集判定」会静默退化成「只认 §2.3 / §2.4」，
 * §2.5 / §2.6 登记的非「沙箱对象」id 又会变回声明。
 */
const ID_SOURCES = [
  { label: '沙箱对象（§2.3 夹具 + §2.4 字段）', headings: [/^###\s*2\.3/, /^###\s*2\.4/] },
  { label: '清单外的 id（§2.5 临时对象 / 转换产物 / 内置字段 / 另一个 project 的字段）', headings: [/^###\s*2\.5/] },
  { label: '构造的输入（§2.6）', headings: [/^###\s*2\.6/] },
]

test('E1 证据一致性：每份记录里的 id 字面量都在沙箱定义清单里，且一个 id 只绑定一个变量名', (t) => {
  const sandboxIds = extractIds(sandbox)
  assert.ok(
    sandboxIds.size >= MIN_SANDBOX_IDS,
    `沙箱定义应列出至少 ${MIN_SANDBOX_IDS} 个 id 字面量（对象清单 + 探针实测），实际 ${sandboxIds.size} 个；解析可能失效`,
  )

  // 解析下限：记录里 id 密集，解析失效时不能当作通过。
  for (const doc of recordDocs) {
    const ids = extractIds(doc.source)
    assert.ok(
      ids.size >= MIN_IDS_PER_RECORD,
      `${doc.path} 只解析出 ${ids.size} 个 id 字面量（下限 ${MIN_IDS_PER_RECORD}）；解析失效时不能当作通过`,
    )
  }
  const planIds = new Set(planDocs.flatMap((doc) => [...extractIds(doc.source)]))
  assert.ok(
    planIds.size >= MIN_IDS_ACROSS_PLANS,
    `ExecPlan 集合只解析出 ${planIds.size} 个 id 字面量（下限 ${MIN_IDS_ACROSS_PLANS}）；解析失效时不能当作通过`,
  )

  // 核心不变量：整个记录集合一次算完再断言，一次跑就能看到所有记录的缺口（实测 E1-2 缺 2 个、
  // E1-3 缺 4 个 id 字面量，只报第一份记录会把其余缺口藏在后面）。
  const missing = []
  for (const doc of evidenceDocs) {
    for (const id of [...extractIds(doc.source)].filter((candidate) => !sandboxIds.has(candidate)).sort()) {
      missing.push(`${doc.path} → ${id}`)
    }
  }
  assert.deepEqual(
    missing,
    [],
    '记录集合里出现沙箱定义里没有的 id 字面量（观测值必须能在 §2.3 / §2.4 对象清单、'
      + `§2.5 清单外登记或 §2.6 构造输入里找到）：${missing.join('；')}`,
  )

  // 三类来源都必须在沙箱定义里实际登记 id；缺一节就说明并集判定少了一条腿。
  // 放在核心不变量之后：并集判定失效时，先报「哪些 id 找不到」，再报「哪一类来源没登记」。
  const sources = ID_SOURCES.map((source) => ({ ...source, ...sectionIds(sandbox, source.headings) }))
  for (const source of sources) {
    assert.deepEqual(
      source.missingHeadings,
      [],
      `沙箱定义里找不到「${source.label}」这一节的标题：${source.missingHeadings.join(' / ')}`,
    )
    assert.ok(
      source.ids.size >= 1,
      `沙箱定义的「${source.label}」没有登记任何 id：三类合法来源都要有实际内容，`
        + '否则「并集判定」会退化成单类声明（若这一类确实不再需要，请连同本断言一起删掉，而不是留一个空节）',
    )
  }
  const objectIds = sources[0].ids
  const offObjectIds = new Set(sources.slice(1).flatMap((source) => [...source.ids]))
  let coveredOnlyByOffObject = 0
  for (const doc of evidenceDocs) {
    for (const id of extractIds(doc.source)) {
      if (!objectIds.has(id) && offObjectIds.has(id)) coveredOnlyByOffObject += 1
    }
  }
  // 诊断而不是断言：来源分类会随记录演进，这里只把「§2.5 / §2.6 承担了多少」写进输出。
  t.diagnostic(`记录集合里有 ${coveredOnlyByOffObject} 个 id 只能靠 §2.5 / §2.6 才落在沙箱定义内`)

  const bindings = extractBindings(sandbox)
  assert.ok(bindings.size >= 6, `沙箱定义 §2.1 应绑定至少 6 个 id 变量，实际 ${bindings.size} 个`)

  const namesById = new Map()
  for (const [name, values] of bindings) {
    for (const value of values) {
      if (!namesById.has(value)) namesById.set(value, new Set())
      namesById.get(value).add(name)
    }
  }
  const duplicated = [...namesById]
    .filter(([, names]) => names.size > 1)
    .map(([id, names]) => `${id} → ${[...names].sort().join(' / ')}`)
  assert.deepEqual(
    duplicated,
    [],
    `同一个 id 被绑定到多个变量名（「变量赋值只有一处」失效）：${duplicated.join('；')}`,
  )

  const renamed = [...bindings]
    .filter(([, values]) => values.size > 1)
    .map(([name, values]) => `${name} → ${[...values].sort().join(' / ')}`)
  assert.deepEqual(renamed, [], `同一个变量名被赋了两个不同 id：${renamed.join('；')}`)

  // 记录集合里写成 `$VAR` = `ID` 的，必须与沙箱定义的绑定逐字相同。
  const stated = []
  for (const doc of evidenceDocs) {
    for (const match of doc.source.matchAll(/`\$([A-Z][A-Z0-9_]*)`\s*=\s*`([A-Za-z0-9_-]+)`/g)) {
      const [, name, value] = match
      if (isIdLiteral(value)) stated.push({ path: doc.path, name, value })
    }
  }
  // 下限断言，与另外两条 skip 路径同一纪律：解析失效时必须响亮失败，不能让这条子断言静默消失。
  assert.ok(
    stated.length >= 1,
    '记录集合里都没有解析到 `$VAR` = `ID` 形式的写法；解析失效时不能当作通过',
  )
  for (const entry of stated) {
    assert.ok(bindings.has(entry.name), `${entry.path} 引用了沙箱定义里没有赋值的变量 $${entry.name}`)
    assert.deepEqual(
      [...bindings.get(entry.name)],
      [entry.value],
      `${entry.path} 里 $${entry.name} 写成 ${entry.value}，与沙箱定义的绑定不一致`,
    )
  }
})

test('E1 证据一致性：记录集合的「规划字段值」行引用同一条定义，且汇总表的三个数与逐实验行相等', (t) => {
  // (a) 模板里那条定义存在，且在沙箱定义 §6（九字段记录模板）里。
  const template = docSection(sandbox, /^##\s*6\./)
  assert.ok(template !== undefined, '沙箱定义里找不到 §6 九字段记录模板')
  const definitionLines = template.split('\n').filter((line) => line.includes('只计用户可写'))
  assert.ok(
    definitionLines.length >= 1,
    '沙箱定义 §6 必须定义「规划字段值」行的计数口径（只计用户可写的规划字段值）',
  )
  assert.ok(
    definitionLines.some((line) => line.includes('规划字段值')),
    '沙箱定义 §6 里「只计用户可写」这句必须就是「规划字段值」行的口径定义',
  )

  // (b) 记录集合里每一行「规划字段值」都必须引用这条定义（同一份文件、同一节）。
  const rowsByDoc = new Map()
  let rowCount = 0
  for (const doc of recordDocs) {
    const sections = experimentSections(doc.source)
    const rows = sections
      .map((section) => ({ section, row: planningFieldRow(section) }))
      .filter((entry) => entry.row !== undefined)
    rowsByDoc.set(doc.path, { sections, rows })
    rowCount += rows.length
  }
  assert.ok(
    rowCount >= MIN_PLANNING_FIELD_ROWS,
    `记录集合里只解析到 ${rowCount} 行「规划字段值」（下限 ${MIN_PLANNING_FIELD_ROWS}）；解析失效时不能当作通过`,
  )

  // (b0) 每一份记录都必须**存在**「规划字段值」行——只校验"存在的行形状对不对"是不够的：
  // 把行改名（或拆成物理表名行）会让 (b) 的循环空转、静默通过，而这正是第二轮评审抓到的形态。
  // 豁免是显式的、带日期的；删掉豁免项就会重新变红，不允许把豁免写成通配。
  const PLANNING_ROW_EXEMPT = new Map([
    [
      'docs/architecture/gate-e1-membership-and-draft.md',
      '2026-09-23 豁免：该记录把规划状态落在 WorkspaceProjection 上（E1-2 的模型选择），'
        + '它的 field 5 用领域结构名而不是模板行名，补行需要先判定"该实验有几个用户可写规划字段值"，'
        + '那是模型决策、属 E1-4（#25）的裁决范围，不在 #107 里替它决定。见 ExecPlan D6 的剩余清单。',
    ],
  ])
  for (const doc of recordDocs) {
    const entry = rowsByDoc.get(doc.path)
    if (PLANNING_ROW_EXEMPT.has(doc.path)) {
      t.diagnostic(`「规划字段值」行缺失，已按显式豁免跳过：${doc.path} —— ${PLANNING_ROW_EXEMPT.get(doc.path)}`)
      continue
    }
    assert.ok(
      entry.rows.length >= 1,
      `${doc.path} 的「本地应有行」里没有任何「规划字段值」行（模板行名被改名或被拆开了）。`
        + '§6 固定了这一行的名字与计数口径；改名会让 (b) 的逐行校验空转。'
        + `确实要豁免就写进 PLANNING_ROW_EXEMPT 并给出日期与理由，不要靠改名绕过。`,
    )
  }
  for (const [docPath, { rows }] of rowsByDoc) {
    for (const { section, row } of rows) {
      const where = `${docPath} 的「${section.title}」的「规划字段值」行内容列`
      assert.ok(row.contentCell.includes('gate-e1-sandbox.md'), `${where} 必须引用沙箱定义文件里的定义`)
      assert.match(row.contentCell, /§\s*6/, `${where} 必须指向定义所在的 §6（九字段记录模板）`)
      assert.ok(
        row.contentCell.includes('行数') && row.contentCell.includes('定义'),
        `${where} 必须说明「行数」按该定义计，不能换成别的口径`,
      )
    }
  }

  // (c) 汇总行 = 「行数」列含多个数的那一行；这样的记录应恰好一份（alpha / beta / gamma 三夹具）。
  const summaryDocs = [...rowsByDoc].filter(([, { rows }]) => (
    rows.some(({ row }) => numbersIn(row.countCell).length > 1)
  ))
  assert.equal(
    summaryDocs.length,
    1,
    `记录集合里应恰好有一份记录给出 alpha / beta / gamma 汇总（行数列含多个数），实际 ${summaryDocs.length} 份`,
  )
  const [summaryPath, summaryDoc] = summaryDocs[0]
  const summaryRows = summaryDoc.rows
  // 原来的 E1-1 保证：3 节实验（alpha / beta / gamma 各一节），每节都有一条「规划字段值」行。
  assert.equal(
    summaryDoc.sections.length,
    summaryRows.length,
    `${summaryPath} 的每一节实验都必须有「规划字段值」行：${summaryDoc.sections.length} 节实验 / ${summaryRows.length} 行`,
  )
  assert.equal(
    summaryRows.length,
    3,
    `${summaryPath} 应有 3 节实验各一行「规划字段值」（alpha / beta / gamma 各一节），实际 ${summaryRows.length} 行`,
  )
  const counts = summaryRows.map(({ row }) => numbersIn(row.countCell))
  const summaryIndex = counts.findIndex((list) => list.length > 1)
  const summary = counts[summaryIndex]
  assert.equal(summary.length, 3, `汇总行应给出 alpha / beta / gamma 三个数，实际 ${summary.join(' / ')}`)
  assert.match(
    summaryRows[summaryIndex].row.contentCell,
    /alpha\s*\/\s*beta\s*\/\s*gamma/,
    '汇总行的内容列必须写明三个数分别对应 alpha / beta / gamma',
  )

  const perExperiment = counts.map((list, index) => {
    if (index === summaryIndex) return undefined
    assert.equal(list.length, 1, `${summaryPath} 实验 ${index + 1} 的「规划字段值」行应只有一个数，实际 ${list.join(' / ')}`)
    return list[0]
  })

  // 本轮 P1 的强制点：汇总表每一格必须等于对应实验自己的行数。
  const labels = ['alpha', 'beta', 'gamma']
  for (let index = 0; index < summary.length; index += 1) {
    const own = perExperiment[index]
    if (own === undefined) continue // gamma 的独立锚点见下方「只有 … 可写」枚举
    assert.equal(
      summary[index],
      own,
      `汇总表 ${labels[index]} 格是 ${summary[index]}，而实验 ${index + 1} 自己的「规划字段值」行是 ${own}：两处必须逐行相等`,
    )
  }

  // 每一行的数字还必须等于该行自己枚举出的用户可写字段数。这是 gamma 唯一的独立锚点（实验 3 的
  // 「本地应有行」表本身就是三夹具汇总，没有单独的 gamma 数字），也顺带覆盖其它记录的同类行。
  let parsed = 0
  for (const [docPath, { rows }] of rowsByDoc) {
    for (const { section, row } of rows) {
      const writable = writableFieldCount(row.contentCell)
      if (writable === undefined) {
        t.diagnostic(`${docPath} 的「${section.title}」的「规划字段值」行没有「只有 … 可写」枚举，跳过该行的口径核对`)
        continue
      }
      parsed += 1
      for (const value of numbersIn(row.countCell)) {
        assert.equal(
          value,
          writable,
          `${docPath} 的「${section.title}」的「规划字段值」行写 ${value}，但内容列枚举出的用户可写字段是 ${writable} 个`,
        )
      }
    }
  }
  assert.ok(
    parsed >= MIN_PLANNING_FIELD_ROWS,
    `记录集合里可解析「只有 … 可写」枚举的「规划字段值」行只有 ${parsed} 行（下限 ${MIN_PLANNING_FIELD_ROWS}），口径核对已失效`,
  )
})

test('E1 证据一致性：文档里的原始 fieldValues 计数与括号里枚举出的项数相等', (t) => {
  const checked = []
  for (const doc of evidenceDocs) {
    for (const entry of fieldValueCounts(doc.source)) {
      checked.push({ path: doc.path, ...entry })
    }
  }
  if (checked.length < 2) {
    t.diagnostic(`只解析到 ${checked.length} 处「N 个 fieldValues（…枚举…）」表述，低于本批次记录的 2 处`)
  }
  assert.ok(
    checked.length >= 2,
    `「N 个 fieldValues（…枚举…）」的表述只解析到 ${checked.length} 处（下限 2）；解析失效时不能当作通过`,
  )
  for (const entry of checked) {
    assert.equal(
      entry.count,
      entry.items.length,
      `${entry.path} 写「${entry.count} 个 fieldValues」，但括号里枚举了 ${entry.items.length} 项：${entry.items.join(' / ')}`,
    )
  }
})
