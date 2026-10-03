// 唯一的 Engineering 全域 writer：每次运行读取目标 Project 的完整快照，按同一份 `expectedFor` 重算全部
// 本仓 Issue；PR/review 事件与 schedule 只是唤醒 hint，不限定范围，所以没有 PR 参数。写前对每个有差异的
// item 新鲜复读，以复读结果为准；ack 匹配才算 confirmed。失败非零退出并如实报告 confirmed / unchanged /
// unknown（已发送但 ack 不明）/ unread（复读失败）/ remaining（未处理）。`--dry-run` 只读。
//
// 用法：PROJECTS_TOKEN=... ENGINEERING_FIELD_ID=... GITHUB_REPOSITORY=owner/repo RECONCILE_ID=... \
//   node scripts/reconcile-engineering-project.mjs [--dry-run]

import { pathToFileURL } from 'node:url'

import { loadIssueEngineeringSnapshot, loadProjectEngineeringSnapshot } from './check-engineering-drift-live.mjs'
import { describeFinding, engineeringDriftFindings } from './engineering-drift.mjs'
import {
  CLEAR, createGraphQLClient, FIELD_NAME, OWNER, PROJECT_NUMBER, parseRepository, resolveProjectField,
  setEngineeringState, writeEngineeringState,
} from './sync-engineering-state.mjs'

const STATUSES = ['confirmed', 'unchanged', 'unknown', 'unread', 'remaining']

export async function main({ env = process.env, argv = process.argv, fetchImpl = fetch, log = console.log } = {}) {
  const started = Date.now()
  const outcome = new Map()
  const finish = (code) => {
    const by = (status) => [...outcome].filter(([, value]) => value === status).map(([finding]) => `#${finding.issue}`)
    log(`reconcile 结果：${STATUSES.map((status) => `${status}=[${by(status)}]`).join(' ')} duration=${Date.now() - started}ms`)
    return code
  }

  try {
    const args = argv.slice(2)
    if (args.length > 1 || (args.length === 1 && args[0] !== '--dry-run')) {
      throw new Error('用法：node scripts/reconcile-engineering-project.mjs [--dry-run]')
    }
    const dryRun = args.length === 1
    if (!env.ENGINEERING_FIELD_ID) throw new Error('未配置 ENGINEERING_FIELD_ID（仓库变量 PROJECTS_ENGINEERING_FIELD_ID）')
    if (!dryRun && !env.RECONCILE_ID) throw new Error('未配置 RECONCILE_ID')
    const repository = parseRepository(env.GITHUB_REPOSITORY)

    let queries = 0
    const send = createGraphQLClient({ token: env.PROJECTS_TOKEN, fetchImpl })
    const gql = (query, variables) => { queries += 1; return send(query, variables) }
    const field = await resolveProjectField({ gql, engineeringFieldId: env.ENGINEERING_FIELD_ID })
    const read = { gql, projectId: field.projectId, fieldId: field.fieldId, repository }
    const snapshot = await loadProjectEngineeringSnapshot({ ...read, owner: OWNER, projectNumber: PROJECT_NUMBER })
    const { findings } = engineeringDriftFindings(snapshot) // 首个 mutation 之前算完全部 expectedFor
    for (const finding of findings) outcome.set(finding, 'remaining')
    log(`::notice::reconcile actor=${env.RECONCILE_ID ?? 'dry-run'} binding=${env.GITHUB_REPOSITORY}->${OWNER}/#${PROJECT_NUMBER}/${field.fieldId} `
      + `dry-run=${dryRun} queries=${queries} pages=${snapshot.counts.pages} referenceEdges=${snapshot.counts.referenceEdges} changed=${findings.length}`)

    for (const finding of findings) {
      if (dryRun) {
        log(`::notice::dry-run ${describeFinding(finding)}`)
        continue
      }
      outcome.set(finding, 'unread')
      const { issueId } = snapshot.items.find((item) => item.itemId === finding.itemId)
      const [current] = engineeringDriftFindings(await loadIssueEngineeringSnapshot({ ...read, itemId: finding.itemId, issueId })).findings
      if (!current) {
        outcome.set(finding, 'unchanged')
        continue
      }
      const clientMutationId = `${env.RECONCILE_ID}:${finding.itemId}`
      outcome.set(finding, 'unknown') // 发送之后的任何失败都不能证明未生效
      const decision = current.expected === null ? CLEAR : setEngineeringState(current.expected)
      await writeEngineeringState({ gql, ...field, itemId: finding.itemId, decision, clientMutationId })
      outcome.set(finding, 'confirmed')
      const basis = current.prNumber === null ? '完整零引用' : `PR #${current.prNumber}`
      // 旧值取自写前复读：Engineering 没有别的历史，首次全域写改掉了什么只记在这一行。
      log(`::notice::confirmed #${finding.issue}: ${FIELD_NAME}=${current.expected ?? 'cleared'}; was=${current.actual ?? 'empty'}; `
        + `依据 ${basis}（规则 ${current.rule}）; item=${finding.itemId}; mutation=${clientMutationId}`)
    }
    return finish(0)
  } catch (error) {
    log(`::error::${error instanceof Error ? error.message : String(error)}`)
    return finish(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main()
