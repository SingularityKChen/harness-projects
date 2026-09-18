// 看板工作流运行时 adapter 的契约：只负责取一份完整快照、调用唯一的纯函数判定，
// 并把任何不可信输入或 finding 变成非零退出码。测试全程注入 fetch，不访问网络。

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { parse as parseYaml } from 'yaml'

const SCRIPT_URL = new URL('../../scripts/check-board-workflows-live.mjs', import.meta.url)
const WORKFLOW_URL = new URL('../../.github/workflows/board-invariants.yml', import.meta.url)

const validEnv = {
  PROJECTS_TOKEN: 'test-token',
  PROJECT_OWNER: 'octo-user',
  PROJECT_NUMBER: '10',
}

const conforming = () => [
  { name: 'Auto-add sub-issues to project', enabled: true },
  { name: 'Item added to project', enabled: true },
  { name: 'Item closed', enabled: false },
  { name: 'Item reopened', enabled: false },
  { name: 'Pull request linked to issue', enabled: false },
  { name: 'Code review approved', enabled: false },
  { name: 'Code changes requested', enabled: false },
  { name: 'Pull request merged', enabled: false },
  { name: 'Auto-close issue', enabled: false },
]

function graphqlBody(nodes = conforming(), totalCount = nodes.length) {
  return { data: { user: { projectV2: { workflows: { nodes, totalCount } } } } }
}

function response(body, { ok = true, status = 200, jsonError } = {}) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Forbidden',
    json: async () => {
      if (jsonError) throw jsonError
      return body
    },
  }
}

async function run({ env = validEnv, fetchImpl = async () => response(graphqlBody()) } = {}) {
  const { runBoardWorkflowCheck } = await import(SCRIPT_URL)
  const output = []
  const exitCode = await runBoardWorkflowCheck({ env, fetchImpl, write: (line) => output.push(line) })
  return { exitCode, output: output.join('\n') }
}

test('九条完整且合规时 exit 0，并向 GraphQL 传显式 owner / project number', async () => {
  let request
  const result = await run({
    fetchImpl: async (url, init) => {
      request = { url, init }
      return response(graphqlBody())
    },
  })

  assert.equal(result.exitCode, 0)
  assert.match(result.output, /9 条.*全部符合/)
  assert.equal(request.url, 'https://api.github.com/graphql')
  assert.equal(request.init.method, 'POST')
  assert.equal(request.init.headers.authorization, 'Bearer test-token')
  const payload = JSON.parse(request.init.body)
  assert.deepEqual(payload.variables, { owner: 'octo-user', number: 10 })
  assert.match(payload.query, /workflows\(first: 100\)/)
  assert.match(payload.query, /totalCount/)
})

test('任一权威判定 finding 都 exit 1，并输出可行动诊断', async () => {
  const nodes = conforming().map((item) =>
    item.name === 'Pull request merged' ? { ...item, enabled: true } : item,
  )
  const result = await run({ fetchImpl: async () => response(graphqlBody(nodes)) })

  assert.equal(result.exitCode, 1)
  assert.match(result.output, /::error::\[should-be-disabled\] Pull request merged/)
})

test('三个必需环境变量缺失或 project number 非正整数时 fail-closed', async (t) => {
  for (const [name, env] of [
    ['PROJECTS_TOKEN', { PROJECT_OWNER: 'octo-user', PROJECT_NUMBER: '10' }],
    ['PROJECT_OWNER', { PROJECTS_TOKEN: 'test-token', PROJECT_NUMBER: '10' }],
    ['PROJECT_NUMBER', { PROJECTS_TOKEN: 'test-token', PROJECT_OWNER: 'octo-user' }],
    ['PROJECT_NUMBER invalid', { ...validEnv, PROJECT_NUMBER: '1.5' }],
    ['PROJECT_NUMBER zero', { ...validEnv, PROJECT_NUMBER: '0' }],
  ]) {
    await t.test(name, async () => {
      const result = await run({ env })
      assert.equal(result.exitCode, 1)
      assert.match(result.output, /::error::/)
    })
  }
})

test('传输与响应故障全部 fail-closed', async (t) => {
  const cases = [
    ['network', async () => Promise.reject(new Error('socket closed'))],
    ['HTTP', async () => response({}, { ok: false, status: 403 })],
    ['non-JSON', async () => response(undefined, { jsonError: new SyntaxError('unexpected token') })],
    ['GraphQL errors', async () => response({ errors: [{ message: 'denied' }] })],
    ['data null', async () => response({ data: null })],
    ['user null', async () => response({ data: { user: null } })],
    ['project null', async () => response({ data: { user: { projectV2: null } } })],
    [
      'nodes missing',
      async () => response({ data: { user: { projectV2: { workflows: { totalCount: 9 } } } } }),
    ],
    ['totalCount invalid', async () => response(graphqlBody(conforming(), -1))],
    ['incomplete page', async () => response(graphqlBody(conforming().slice(0, 8), 9))],
  ]

  for (const [name, fetchImpl] of cases) {
    await t.test(name, async () => {
      const result = await run({ fetchImpl })
      assert.equal(result.exitCode, 1)
      assert.match(result.output, /::error::/)
    })
  }
})

test('CLI 缺配置时 exit 1，而不是因未处理 rejection 偶然失败', () => {
  const result = spawnSync(process.execPath, [SCRIPT_URL.pathname], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
  })

  assert.equal(result.status, 1)
  assert.match(result.stdout, /::error::.*PROJECTS_TOKEN/)
  assert.equal(result.stderr, '')
})

test('带 PAT 的 workflow 只有 schedule 入口，且 token 只进入 adapter 步骤', async () => {
  const workflow = parseYaml(await readFile(WORKFLOW_URL, 'utf8'))
  assert.deepEqual(Object.keys(workflow.on), ['schedule'])

  const job = workflow.jobs['board-workflows']
  assert.deepEqual(job.env, { PROJECT_OWNER: 'SingularityKChen', PROJECT_NUMBER: 10 })
  assert.equal(job.if, undefined)
  assert.equal(job.steps[0].uses, 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1')
  assert.equal(job.steps[1].uses, 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020')

  const runStep = job.steps.find((step) => step.run)
  assert.equal(runStep.run, 'node scripts/check-board-workflows-live.mjs')
  assert.deepEqual(runStep.env, { PROJECTS_TOKEN: '${{ secrets.PROJECTS_TOKEN }}' })
  assert.equal(job.env.PROJECTS_TOKEN, undefined)
})
