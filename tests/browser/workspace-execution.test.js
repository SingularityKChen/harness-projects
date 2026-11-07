import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { mkdir } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { chromium } from 'playwright'
import { startExecutionServer } from '../fixtures/execution-drawer-browser.mjs'

const REPOSITORY = 'local-repository', TITLE = '规划项 issue-1'
const visible = (page, text) => page.getByText(text, { exact: true }).filter({ visible: true }).first().waitFor()
function rows(h, table) {
  assert.ok(['execution_context', 'execution_run', 'mutation_attempt'].includes(table))
  const db = new DatabaseSync(h.dataPath, { readOnly: true })
  try { return db.prepare(`SELECT * FROM ${table}`).all() } finally { db.close() }
}
async function tabTo(page, target, label) {
  await target.waitFor()
  for (let count = 0; count < 80; count++) {
    if (await target.evaluate(element => element === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  assert.fail(`Tab order cannot reach ${label}`)
}
async function scene(t, run, keyboard = false) {
  let h, browser, context, page, closing = false, cleaning
  const releases = [], outside = [], errors = []
  const close = () => {
    closing = true; t.signal.removeEventListener('abort', onAbort)
    return cleaning ??= (async () => {
      const failures = []
      while (releases.length) { try { await releases.pop()() } catch (error) { failures.push(error) } }
      if (failures.length) throw new AggregateError(failures, 'Scenario cleanup failed')
    })()
  }
  const onAbort = () => { void close().catch(() => {}) }
  const adopt = async (open, release) => {
    t.signal.throwIfAborted(); const value = await open()
    if (closing || t.signal.aborted) { await release(value); t.signal.throwIfAborted(); throw Error('Scenario closed') }
    releases.push(() => release(value)); return value
  }
  t.after(close); t.signal.addEventListener('abort', onAbort, { once: true })
  try {
    h = await adopt(() => startExecutionServer({ seed: 'execution' }), value => value.close())
    browser = await adopt(() => chromium.launch({ timeout: 7000 }), value => value.close())
    context = await adopt(() => browser.newContext(), value => value.close())
    page = await adopt(() => context.newPage(), async value => { await value.evaluate(() => window.fixture?.unmount()).catch(() => {}); await value.close() })
    page.setDefaultTimeout(7000)
    await context.route('**/*', route => { if (new URL(route.request().url()).origin === h.url) return route.continue(); outside.push(route.request().url()); return route.abort() })
    page.on('pageerror', error => errors.push(error.message)); await context.tracing.start({ screenshots: true, snapshots: true })
    await page.goto(h.url); await visible(page, TITLE)
    assert.equal(rows(h, 'execution_context').length, 0, 'execution seed must not pre-create the result under test')
    assert.equal(rows(h, 'execution_run').length, 0)
    assert.deepEqual(h.platform.effects(), { branches: 0, worktrees: 0, primary: 0, manual: 0, prs: 0 })
    const opener = page.getByRole('link', { name: TITLE, exact: true })
    if (keyboard) { await tabTo(page, opener, 'Issue drawer opener'); await page.keyboard.press('Enter') }
    else await opener.click()
    await run({ h, page })
    assert.deepEqual(outside, []); assert.deepEqual(errors, [])
  } catch (error) {
    const dir = 'test-results/composed-browser/' + t.name.replace(/[^a-z0-9-]/gi, '-')
    await mkdir(dir, { recursive: true }); await page?.screenshot({ path: dir + '/failure.png', fullPage: true }).catch(() => {})
    await context?.tracing.stop({ path: dir + '/trace.zip' }).catch(() => {}); throw error
  } finally { await close() }
}
async function start(page, keyboard = false) {
  const opener = page.getByRole('button', { name: '开始工作', exact: true })
  const repository = page.getByLabel('已绑定仓库', { exact: true }), branch = page.getByLabel('分支名（可留空）')
  if (keyboard) {
    await tabTo(page, opener, '开始工作'); await page.keyboard.press('Space')
    await repository.waitFor(); await page.keyboard.press('Shift+Tab')
    await tabTo(page, repository, 'native repository select')
    await page.keyboard.press('KeyL'); await page.keyboard.press('Tab')
    assert.equal(await repository.inputValue(), REPOSITORY, 'native select accepts the keyboard-selected repository')
    await tabTo(page, branch, 'branch input'); await page.keyboard.type('feature/topic')
    assert.equal(await branch.inputValue(), 'feature/topic')
  } else {
    await opener.click(); await repository.selectOption(REPOSITORY); await branch.fill('feature/topic')
  }
  await page.getByLabel('执行任务', { exact: true }).fill('Synthetic explicit browser task')
  const submit = page.getByRole('button', { name: '提交开始工作', exact: true })
  if (keyboard) await tabTo(page, submit, 'Start Work submit')
  const acknowledgement = page.waitForResponse(response => response.url().endsWith('/remote') && response.request().postDataJSON()?.name === 'startWork')
  if (keyboard) await page.keyboard.press('Enter'); else await submit.click()
  await (await acknowledgement).finished()
}
async function createPr(page, draft = false) {
  await page.getByLabel('目标分支', { exact: true }).fill('main')
  await page.getByLabel('标题', { exact: true }).fill('Browser native PR')
  await page.getByLabel('正文', { exact: true }).fill('  原请求 λ\n\n正文  ')
  const checkbox = page.getByRole('checkbox', { name: '创建为草稿', exact: true })
  assert.equal(await checkbox.isChecked(), false)
  if (draft) await checkbox.check()
  await page.getByRole('button', { name: draft ? '创建草稿 PR' : '创建 PR', exact: true }).click()
}
describe('production composed browser execution', { timeout: 120000 }, () => {
  test('Start Work dispatch creates one actual Git worktree and run; replay preserves source and keyboard focus', { timeout: 60000 }, async t => {
    await scene(t, async ({ h, page }) => {
      await start(page, true)
      const record = rows(h, 'execution_context')[0]
      assert.equal(rows(h, 'execution_context').length, 1); assert.equal(rows(h, 'execution_run').length, 1)
      await visible(page, '开始工作已确认')
      const disk = await h.platform.gitFacts(); assert.equal(disk.branch, 'feature/topic'); assert.equal(disk.worktrees, 2)
      assert.equal(disk.path, record.worktree_external_id)
      await page.getByRole('button', { name: '提交开始工作', exact: true }).click(); await visible(page, '开始工作已确认')
      assert.deepEqual(h.platform.effects(), { branches: 1, worktrees: 1, primary: 1, manual: 0, prs: 0 })
      assert.equal(h.requests.filter(r => r.name === 'startWork').length, 2)
      assert.ok(h.requests.filter(r => r.name === 'startWork').every(r => r.input.workItemId === h.itemId))
      await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' })
      assert.equal(await page.getByRole('link', { name: TITLE, exact: true }).evaluate(el => el === document.activeElement), true)
    }, true)
  })
  test('manual fallback uses actual human issuer only after definite refusal; uncertain primary never starts a human run', { timeout: 60000 }, async t => {
    for (const mode of ['unavailable', 'unknown']) await scene(t, async ({ h, page }) => {
      h.platform.flags.execution = mode; await start(page)
      await visible(page, mode === 'unavailable' ? '人工处理，可在工作树继续' : /结果未知，请先读回并恢复/)
      const run = rows(h, 'execution_run')[0]
      assert.equal(rows(h, 'execution_run').length, 1)
      assert.equal(h.platform.effects().manual, mode === 'unavailable' ? 1 : 0)
      assert.equal(h.platform.effects().primary, 1); assert.equal((await h.platform.gitFacts()).worktrees, 2)
      if (mode === 'unavailable') {
        assert.equal(run.fallback, 1); assert.match(run.provider_ref_json, /manual-run:/)
        await page.getByRole('button', { name: '提交开始工作', exact: true }).click(); await visible(page, '人工处理，可在工作树继续')
        assert.equal(h.platform.effects().manual, 1)
      } else {
        assert.equal(run.status, 'unknown'); assert.equal(await page.getByText('开始工作已确认', { exact: true }).count(), 0)
        await page.getByRole('button', { name: '读回并恢复', exact: true }).click(); await visible(page, /结果未知，请先读回并恢复/)
        assert.equal(h.platform.effects().primary, 1); assert.equal(h.platform.effects().manual, 0)
        assert.equal(rows(h, 'execution_run').length, 1)
      }
    })
  })
  test('lost PR acknowledgement recovers the original intent after SQLite reopen and a new Host peer without duplicate creation', { timeout: 60000 }, async t => {
    await scene(t, async ({ h, page }) => {
      await start(page); await visible(page, '开始工作已确认')
      h.platform.flags.dropAck = true; await createPr(page, true)
      await visible(page, '已保存原请求，请读回原操作确认')
      const original = rows(h, 'mutation_attempt').find(row => row.command_name === 'createChangeRequest')
      assert.equal(JSON.parse(original.external_intent_json).input.draft, true)
      assert.deepEqual(JSON.parse(original.external_intent_json).issueSelection, { relation: 'none' }, 'unsupported source must preserve an explicit no-association intent')
      assert.equal(original.state, 'unknown'); assert.equal(h.platform.effects().prs, 1)
      assert.match(JSON.parse(original.external_intent_json).input.body, /^  原请求 λ\n\n正文  \n<!-- harness-pr-operation:[a-f0-9]{64} -->$/)
      assert.match(original.request_fingerprint, /execution-peer-1/)
      assert.equal(await page.getByText('PR 已确认', { exact: true }).count(), 0)
      await page.getByRole('button', { name: '读回原操作', exact: true }).click(); await visible(page, '已保存原请求，请读回原操作确认')
      assert.equal(h.platform.effects().prs, 1); assert.equal(h.platform.prCreates, 1)
      const oldStorage = h.storage, oldHost = h.host, peer = h.platform.peer
      await page.evaluate(() => window.fixture.unmount()); await h.rebuild()
      assert.notEqual(h.storage, oldStorage); assert.notEqual(h.host, oldHost); assert.notEqual(h.platform.peer, peer)
      await assert.rejects(() => oldStorage.getWorkspace(h.workspaceId))
      h.platform.flags.dropAck = false
      await page.reload(); await page.getByRole('link', { name: TITLE, exact: true }).click()
      await visible(page, '已保存原请求（草稿 PR）：Browser native PR；feature/topic → main；不关联 Issue')
      const recovered = await h.installed.service.getChangeRequestOperation({ kind: 'user' }, h.itemId, REPOSITORY)
      assert.equal(recovered.operation.issueRelation, 'none'); assert.equal(recovered.operation.issueTarget, undefined)
      assert.equal(recovered.operation.state, 'unknown', 'reload summary alone cannot confirm the previously lost acknowledgement')
      assert.equal(await page.getByRole('button', { name: '创建 PR', exact: true }).count(), 0)
      await page.getByRole('button', { name: '读回原操作', exact: true }).click(); await visible(page, 'PR 已确认')
      const saved = rows(h, 'mutation_attempt').find(row => row.id === original.id)
      assert.equal(saved.state, 'saved'); assert.equal(saved.request_fingerprint, original.request_fingerprint)
      for (const key of ['input', 'issueSelection', 'ownerGeneration', 'worktree', 'bindingId']) assert.deepEqual(JSON.parse(saved.external_intent_json)[key], JSON.parse(original.external_intent_json)[key])
      assert.equal(h.platform.effects().prs, 1)
      assert.equal(h.requests.filter(r => r.name === 'createChangeRequest').length, 1); assert.equal(h.platform.prCreates, 1)
      assert.ok(h.requests.filter(r => r.name === 'resumeChangeRequest').length >= 2)
    })
  })
  test('Delivery refresh keeps failed unknown stale and foreign success distinct from a positive same-scope passed result', { timeout: 60000 }, async t => {
    await scene(t, async ({ h, page }) => {
      await start(page); await visible(page, '开始工作已确认'); await createPr(page); await visible(page, 'PR 已确认')
      const section = page.getByRole('region', { name: '交付谱系', exact: true })
      for (const [mode, state] of [['failed', 'failed'], ['unknown', 'unknown'], ['passed', 'passed'], ['stale', 'stale']]) {
        h.platform.delivery(mode)
        await section.getByRole('button', { name: '刷新交付谱系', exact: true }).click()
        for (const kind of ['pipeline_run', 'check_run']) {
          await section.locator(`[data-position="${kind}"] [data-state="${state}"]`).waitFor()
          if (mode !== 'passed') assert.equal(await section.locator(`[data-position="${kind}"] [data-state="passed"]`).count(), 0)
        }
        assert.doesNotMatch(await section.innerText(), /foreign-success/)
      }
      assert.ok(h.requests.filter(r => r.name === 'refreshDeliveryFacts').length >= 4)
      assert.equal(h.platform.effects().prs, 1)
      await page.keyboard.press('Escape'); await page.getByRole('link', { name: '规划项 issue-2', exact: true }).click()
      await section.locator('[data-position="pipeline_run"] [data-reason="not_started"]').waitFor()
      assert.equal(await section.locator('[data-state="passed"]').count(), 0)
      assert.equal(rows(h, 'execution_context').length, 1)
    })
  })
})

test('confirmed PR can select add and reconcile assignees through production carrier', { timeout: 60000 }, async t => {
  await scene(t, async ({ h, page }) => {
    await start(page); await visible(page, '开始工作已确认'); await createPr(page); await visible(page, 'PR 已确认')
    const picker = page.getByRole('checkbox', { name: 'browser-assignee', exact: true })
    await tabTo(page, picker, 'assignee'); await page.keyboard.press('Space'); assert.equal(await picker.isChecked(), true)
    h.platform.assignment.drop = true
    const add = page.getByRole('button', { name: '添加负责人', exact: true }); await tabTo(page, add, 'add assignee'); await page.keyboard.press('Enter')
    await visible(page, '负责人分配尚未确认'); assert.equal(h.platform.assignment.adds, 1)
    const original = rows(h, 'mutation_attempt').find(r => r.command_name === 'addChangeRequestAssignees'); assert.equal(original.state, 'unknown')
    assert.doesNotMatch(original.external_intent_json, /browser-assignee/)
    await page.evaluate(() => window.fixture.unmount()); await h.rebuild(); h.platform.assignment.drop = false
    await page.reload(); await page.getByRole('link', { name: TITLE, exact: true }).click()
    await page.getByRole('button', { name: '核对原 PR 分配', exact: true }).click(); await visible(page, '负责人最后确认')
    assert.equal(rows(h, 'mutation_attempt').find(r => r.id === original.id).state, 'saved'); assert.equal(h.platform.assignment.adds, 1); assert.equal(h.platform.prCreates, 1)
  })
})
