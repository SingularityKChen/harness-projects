/**
 * GitHub review session workflow 契约测试
 *
 * 保护的不变量（issues #65 / #49）：
 *
 * 1. 事件负载路径只从运行器提供的 `GITHUB_EVENT_PATH` 取。`${{ github.event_path }}`
 *    在这台自托管运行器上求值为空字符串，于是 `readFileSync("")` 抛 ENOENT，
 *    job 在第一步崩掉，报错里只有一个空路径——2026-09-20 实测三次运行全部如此。
 * 2. 按 head 提交去重：同一份代码只值一次评审会话。`types: [ready_for_review]`
 *    对每次 draft → ready 都发一个新事件，按 PR 号分组不限制深度，单台运行器会被
 *    排满；按 head SHA 分组 + 取消在先，使深度恒为 1。
 * 3. PR #21 建立的安全姿态不被顺手破坏：不 checkout PR 代码、顶层权限为空、
 *    只接受同仓 PR、workflow 只在默认分支上被采用。
 *
 * 这些性质都是结构性的，所以用契约测试固定，而不是靠 review 时的记忆。
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse } from 'yaml'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'github-review.yml')

async function readWorkflow() {
  return parse(await readFile(workflowPath, 'utf8'))
}

/** 顶层 `on` 在 YAML 里可能被解析成字符串键；两种形状都要能取到。 */
function trigger(workflow) {
  return workflow.on ?? workflow[true]
}

test('触发方式：pull_request_target 的 ready_for_review', async () => {
  const workflow = await readWorkflow()
  const on = trigger(workflow)
  assert.ok(on !== undefined, 'workflow 必须声明 on')
  assert.ok(
    Object.prototype.hasOwnProperty.call(on, 'pull_request_target'),
    '必须使用 pull_request_target：workflow 定义只能来自默认分支，PR 不能改运行内容',
  )
  const types = on.pull_request_target?.types ?? []
  assert.deepEqual(types, ['ready_for_review'])
})

test('安全姿态：顶层权限为空、不 checkout PR 代码、只接受同仓 PR', async () => {
  const workflow = await readWorkflow()
  assert.deepEqual(workflow.permissions, {}, '顶层 permissions 必须是空映射')

  const jobs = Object.values(workflow.jobs ?? {})
  assert.equal(jobs.length, 1, '本 workflow 只应有一个 job；新增 job 必须同步本测试')
  for (const job of jobs) {
    for (const step of job.steps ?? []) {
      if (step.uses === undefined) continue
      assert.ok(
        !String(step.uses).startsWith('actions/checkout'),
        'review session 不得 checkout PR 代码：它只转发事件负载',
      )
    }
    assert.match(
      String(job.if ?? ''),
      /head\.repo\.full_name == github\.repository/,
      'job 必须只对同仓 PR 运行：外部贡献不得让这台机器启动 agent 会话',
    )
  }
})

test('事件负载：只从 GITHUB_EVENT_PATH 读取，且空路径必须响亮失败（issue #65）', async () => {
  const workflow = await readWorkflow()
  const job = Object.values(workflow.jobs)[0]
  const step = (job.steps ?? []).find((candidate) => candidate.run !== undefined)
  assert.ok(step !== undefined, '必须存在转发步骤')

  const script = String(step.run)
  assert.ok(
    !script.includes('github.event_path'),
    '不得使用 ${{ github.event_path }}：它在自托管运行器上求值为空，导致 readFileSync("") 抛 ENOENT',
  )
  for (const [key, value] of Object.entries(step.env ?? {})) {
    assert.ok(
      !String(value).includes('github.event_path'),
      `env ${key} 不得把事件路径经 workflow 表达式传入，只允许由运行器提供的 GITHUB_EVENT_PATH`,
    )
  }
  assert.ok(
    script.includes('GITHUB_EVENT_PATH'),
    '转发步骤必须从运行器提供的 GITHUB_EVENT_PATH 读取负载路径',
  )
  assert.ok(
    /EVENT_PATH="\$\{GITHUB_EVENT_PATH:-\}"/.test(script),
    '负载路径必须先落进一个可校验的变量，缺省为空时才能显式拒绝',
  )
  assert.match(
    script,
    /-z "\$EVENT_PATH"[\s\S]*?::error::[\s\S]*?exit 1/,
    '空路径必须打印 ::error:: 后 exit 1，而不是把 Node 栈留给读日志的人',
  )
  assert.ok(
    script.includes('process.env.GITHUB_EVENT_PATH'),
    '内联 Node 必须读运行器导出的 GITHUB_EVENT_PATH：shell 变量不会继承到子进程',
  )
  assert.ok(
    !script.includes('process.env.EVENT_PATH'),
    '不得让内联 Node 读 EVENT_PATH：它只是 shell 变量，子进程里是 undefined',
  )
})

test('队列上界：按 head 提交分组并取消在先（issue #49）', async () => {
  const workflow = await readWorkflow()
  const concurrency = workflow.concurrency
  assert.ok(concurrency !== undefined, '必须声明 concurrency')
  assert.ok(
    String(concurrency.group).includes('github.event.pull_request.head.sha'),
    '分组键必须是 head SHA：head 未变时反复 draft/ready 应收敛成一次运行',
  )
  assert.ok(
    !String(concurrency.group).includes('pull_request.number'),
    '不得再按 PR 号分组：分组本身不限制队列深度',
  )
  assert.equal(concurrency['cancel-in-progress'], true, 'head 未变时必须取消在先的运行')
})
