/**
 * Gate E1 证据一致性契约（离线）。
 *
 * 保护的不变量：三份 E1 文档（沙箱定义、内容身份记录、承载它的 ExecPlan）在**内容**上互相一致——
 * (i) 记录文件里出现的每个 id 字面量都能在沙箱定义的对象清单里找到，且同一个 id 只绑定一个变量名；
 * (ii) 三处实验的「规划字段值」行引用同一条「只计用户可写」的定义，且汇总表（alpha / beta / gamma
 *      那一行）的三个数与三处实验各自的行数逐一相等；
 * (iii) 文档里「N 个 `fieldValues`（…枚举…）」的原始计数等于括号里枚举出的项数。
 *
 * 为什么需要它：本批次的验证命令只查结构计数（grep 计数、体量、发布面扫描、空白），对文档内容没有
 * 判别力——第二轮评审的 P1（汇总表 beta 格写 0，而实验 2 自己的行是 1）正是从它们眼皮下过去的。
 * 规则写进计划只是声明，强制点在能失败的检查里（ExecPlan D8 的 R1）。
 *
 * 离线：只读仓库内的三份文档，不触网、不读凭据、不调用 gh。
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const SANDBOX_DOC = 'docs/architecture/gate-e1-sandbox.md'
const RECORD_DOC = 'docs/architecture/gate-e1-content-identities.md'
// ExecPlan 完成后会从 active/ 移到 completed/，两个位置都认，避免文件搬家造成无关失败。
const PLAN_DOC_CANDIDATES = [
  'docs/exec-plan/active/2026-09-21-gate-e1-content-identities.md',
  'docs/exec-plan/completed/2026-09-21-gate-e1-content-identities.md',
]

const readDoc = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8')

const planDoc = PLAN_DOC_CANDIDATES.find((candidate) => existsSync(path.join(repoRoot, candidate)))
assert.ok(planDoc, `E1 ExecPlan 缺失：${PLAN_DOC_CANDIDATES.join(' 与 ')} 都不存在`)

const sandbox = readDoc(SANDBOX_DOC)
const record = readDoc(RECORD_DOC)
const plan = readDoc(planDoc)

// 「两份记录文件」：内容身份记录与承载它的 ExecPlan；沙箱定义是 id 的清单来源。
const RECORD_DOCS = [
  { path: RECORD_DOC, source: record, minimumIds: 8 },
  { path: planDoc, source: plan, minimumIds: 4 },
]

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

/** 取某个二级标题到下一个二级标题之间的正文。 */
function docSection(source, headingPattern) {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => headingPattern.test(line))
  if (start < 0) return undefined
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/.test(lines[index])) {
      end = index
      break
    }
  }
  return lines.slice(start, end).join('\n')
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

test('E1 证据一致性：记录文件里的 id 字面量都在沙箱定义清单里，且一个 id 只绑定一个变量名', () => {
  const sandboxIds = extractIds(sandbox)
  assert.ok(
    sandboxIds.size >= 20,
    `沙箱定义应列出至少 20 个 id 字面量（对象清单 + 探针实测），实际 ${sandboxIds.size} 个；解析可能失效`,
  )

  for (const doc of RECORD_DOCS) {
    const ids = extractIds(doc.source)
    assert.ok(
      ids.size >= doc.minimumIds,
      `${doc.path} 只解析出 ${ids.size} 个 id 字面量（下限 ${doc.minimumIds}）；解析失效时不能当作通过`,
    )
    const missing = [...ids].filter((id) => !sandboxIds.has(id)).sort()
    assert.deepEqual(
      missing,
      [],
      `${doc.path} 出现沙箱定义里没有的 id 字面量（观测值必须能在对象清单里找到）：${missing.join(', ')}`,
    )
  }

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

  // 记录文件里写成 `$VAR` = `ID` 的，必须与沙箱定义的绑定逐字相同。
  const stated = []
  for (const doc of RECORD_DOCS) {
    for (const match of doc.source.matchAll(/`\$([A-Z][A-Z0-9_]*)`\s*=\s*`([A-Za-z0-9_-]+)`/g)) {
      const [, name, value] = match
      if (isIdLiteral(value)) stated.push({ path: doc.path, name, value })
    }
  }
  // 下限断言，与另外两条 skip 路径同一纪律（:325 的 parsed >= 1、:339 的 checked.length >= 2）：
  // 解析失效时必须响亮失败，不能让这条子断言静默消失。
  assert.ok(
    stated.length >= 1,
    '两份记录文件里都没有解析到 `$VAR` = `ID` 形式的写法；解析失效时不能当作通过',
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

test('E1 证据一致性：三处「规划字段值」行引用同一条定义，且汇总表的三个数与三处实验逐行相等', (t) => {
  const sections = experimentSections(record)
  assert.equal(sections.length, 3, `记录文件应有 3 节实验（每条实验一条记录），实际 ${sections.length} 节`)

  const rows = sections.map((section) => {
    const row = planningFieldRow(section)
    assert.ok(row !== undefined, `${section.title} 的「本地应有行」缺少「规划字段值」行`)
    return row
  })

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

  // (b) 三处实验的「规划字段值」行必须引用这条定义（同一个文件、同一节）。
  for (const [index, row] of rows.entries()) {
    const where = `实验 ${index + 1} 的「规划字段值」行内容列`
    assert.ok(row.contentCell.includes('gate-e1-sandbox.md'), `${where} 必须引用沙箱定义文件里的定义`)
    assert.match(row.contentCell, /§\s*6/, `${where} 必须指向定义所在的 §6（九字段记录模板）`)
    assert.ok(
      row.contentCell.includes('行数') && row.contentCell.includes('定义'),
      `${where} 必须说明「行数」按该定义计，不能换成别的口径`,
    )
  }

  // (c) 汇总行 = 「行数」列含多个数的那一行；其余实验各自只有一个数。
  const counts = rows.map((row) => numbersIn(row.countCell))
  const summaryIndexes = counts.map((list, index) => (list.length > 1 ? index : -1)).filter((index) => index >= 0)
  assert.equal(
    summaryIndexes.length,
    1,
    `「规划字段值」行里应恰好有一行是 alpha / beta / gamma 汇总（行数列含多个数），实际 ${summaryIndexes.length} 行`,
  )
  const summaryIndex = summaryIndexes[0]
  const summary = counts[summaryIndex]
  assert.equal(summary.length, 3, `汇总行应给出 alpha / beta / gamma 三个数，实际 ${summary.join(' / ')}`)
  assert.match(
    rows[summaryIndex].contentCell,
    /alpha\s*\/\s*beta\s*\/\s*gamma/,
    '汇总行的内容列必须写明三个数分别对应 alpha / beta / gamma',
  )

  const perExperiment = counts.map((list, index) => {
    if (index === summaryIndex) return undefined
    assert.equal(list.length, 1, `实验 ${index + 1} 的「规划字段值」行应只有一个数，实际 ${list.join(' / ')}`)
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

  // 每一行的数字还必须等于该行自己枚举出的用户可写字段数（这是 gamma 唯一的独立锚点：
  // 实验 3 的「本地应有行」表本身就是三夹具汇总，没有单独的 gamma 数字）。
  let parsed = 0
  for (const [index, row] of rows.entries()) {
    const writable = writableFieldCount(row.contentCell)
    if (writable === undefined) {
      t.diagnostic(`实验 ${index + 1} 的「规划字段值」行没有「只有 … 可写」枚举，跳过该行的口径核对`)
      continue
    }
    parsed += 1
    for (const value of counts[index]) {
      assert.equal(
        value,
        writable,
        `实验 ${index + 1} 的「规划字段值」行写 ${value}，但内容列枚举出的用户可写字段是 ${writable} 个`,
      )
    }
  }
  assert.ok(parsed >= 1, '三处「规划字段值」行都没有可解析的「只有 … 可写」枚举，口径核对已失效')
})

test('E1 证据一致性：文档里的原始 fieldValues 计数与括号里枚举出的项数相等', (t) => {
  const documents = [{ path: RECORD_DOC, source: record }, { path: planDoc, source: plan }]
  const checked = []
  for (const doc of documents) {
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
