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


for (const [failure, message] of [
  ['not_supported', '当前连接不支持负责人候选'],
  ['permission_denied', '负责人候选读取被拒绝，请检查连接权限后重试'],
  ['unavailable', '负责人候选读取不完整或暂时不可用，请重试'],
]) test(`candidate ${failure} feedback crosses production carrier and clears selection`, { timeout: 60000 }, async t => {
  await scene(t, async ({ h, page }) => {
    await start(page); h.platform.assignment.more = true; await createPr(page); await visible(page, 'PR 已确认')
    const picker = page.getByRole('checkbox', { name: 'browser-assignee', exact: true })
    await picker.check(); h.platform.assignment.failure = failure
    const failedPage = page.waitForResponse(response => response.url().endsWith('/remote') && response.request().postDataJSON()?.name === 'listChangeRequestAssigneeOptions')
    await page.getByRole('button', { name: '加载更多负责人', exact: true }).click(); await (await failedPage).finished()
    const retry = page.getByRole('button', { name: '重新读取负责人候选', exact: true }); await visible(page, message)
    assert.match(await page.locator('body').innerText(), new RegExp(message), 'candidate failure must name the matching recovery action')
    assert.equal(await picker.count(), 0); assert.equal(await page.getByRole('button', { name: '添加负责人', exact: true }).isDisabled(), true)
    assert.doesNotMatch(await page.locator('body').innerText(), /candidate-private-canary/)
    const reads = h.requests.filter(request => request.name === 'listChangeRequestAssigneeOptions').length
    const refreshed = page.waitForResponse(response => response.url().endsWith('/remote') && response.request().postDataJSON()?.name === 'getDeliveryProjection')
    await page.getByRole('button', { name: '刷新交付谱系', exact: true }).click(); await (await refreshed).finished(); await visible(page, message)
    assert.equal(h.requests.filter(request => request.name === 'listChangeRequestAssigneeOptions').length, reads, 'delivery observation must not remount and auto-read the denied picker')
    const retried = page.waitForResponse(response => response.url().endsWith('/remote') && response.request().postDataJSON()?.name === 'listChangeRequestAssigneeOptions')
    await retry.click(); const response = await retried; await response.finished(); const result = await response.json()
    if (result.ok === false) {
      assert.equal(failure, 'permission_denied'); assert.deepEqual(result, { ok: false, error: 'Host unavailable' })
      await visible(page, '本次读取尚未确认，请重新读取'); assert.match(await page.locator('body').innerText(), /最后已知失败：/)
    } else assert.equal(result.value.error, failure)
    await visible(page, message)
    if (failure !== 'permission_denied') {
      h.platform.assignment.failure = ''; h.platform.assignment.more = false
      await retry.click(); await picker.waitFor(); assert.equal(await picker.isChecked(), false)
    }
    assert.equal(h.platform.assignment.adds, 0); assert.equal(h.platform.prCreates, 1)
  })
})

for (const late of [false, true]) test(`cross-caller directory denial masks selection and fences late success=${late}`, { timeout: 60000 }, async t => {
  await scene(t, async ({ h, page }) => {
    await start(page); await createPr(page); await visible(page, 'PR 已确认')
    const picker = page.getByRole('checkbox', { name: 'browser-assignee', exact: true })
    if (!late) {
      await picker.check(); await page.getByRole('button', { name: '添加负责人', exact: true }).click(); await visible(page, '负责人最后确认')
    }
    h.platform.assignment.more = true; await page.reload(); await page.getByRole('link', { name: TITLE, exact: true }).click(); await picker.check()
    let release, accepted = false, held = false, staged
    const captured = new Promise(resolve => { staged = resolve })
    await page.route('**/remote', async route => {
      const request = route.request().postDataJSON()
      if (late && !held && request.name === 'listChangeRequestAssigneeOptions' && request.input.cursor) {
        held = true; const response = await route.fetch(); assert.equal((await response.json()).value.items[0].id, 'U_browser'); await new Promise(resolve => { release = resolve; staged() }); return route.fulfill({ response })
      }
      return route.continue()
    })
    const oldReply = late ? page.waitForResponse(response => response.url().endsWith('/remote') && response.request().postDataJSON()?.input?.cursor) : undefined
    if (late) { h.platform.assignment.more = false; await page.getByRole('button', { name: '加载更多负责人', exact: true }).click(); await captured }
    const reads = h.requests.filter(request => request.name === 'listChangeRequestAssigneeOptions').length
    const metadata = page.waitForEvent('console', { predicate: message => { if (!message.text().includes('[harness-projects] watch metadata')) return false; accepted = true; return true } })
    const projection = page.waitForResponse(response => accepted && response.url().endsWith('/remote') && response.request().postDataJSON()?.name === 'getDeliveryProjection')
    try {
      h.platform.assignment.failure = 'permission_denied'
      const denied = await page.evaluate(workItemId => window.fixture.remote.listChangeRequestAssigneeOptions({ kind: 'user' }, workItemId, 'local-repository', undefined, 50), h.itemId)
      assert.equal(denied.value.error, 'permission_denied'); await metadata; await (await projection).finished()
      assert.equal(await picker.count(), 0); assert.equal(await page.getByRole('button', { name: '添加负责人', exact: true }).isDisabled(), true)
      assert.doesNotMatch(await page.locator('body').innerText(), /负责人最后确认/)
      if (late) { release(); await (await oldReply).finished(); await page.evaluate(() => new Promise(requestAnimationFrame)); assert.equal(await picker.count(), 0) }
      assert.equal(h.requests.filter(request => request.name === 'listChangeRequestAssigneeOptions').length, reads + 1, 'access invalidation must wait for manual retry')
      assert.equal(h.platform.assignment.adds, late ? 0 : 1); assert.equal(h.platform.prCreates, 1)
    } finally { release?.() }
  })
})

test('manual candidate retry keeps safe history distinct from a fenced unknown result', { timeout: 60000 }, async t => scene(t, async ({ h, page }) => {
  await start(page); h.platform.assignment.more = true; await createPr(page); await visible(page, 'PR 已确认')
  const picker = page.getByRole('checkbox', { name: 'browser-assignee', exact: true }); await picker.check()
  let accepted = false
  const metadata = page.waitForEvent('console', { predicate: message => { if (!message.text().includes('[harness-projects] watch metadata')) return false; accepted = true; return true } })
  const projection = page.waitForResponse(response => accepted && response.url().endsWith('/remote') && response.request().postDataJSON()?.name === 'getDeliveryProjection')
  h.platform.assignment.failure = 'permission_denied'; await page.getByRole('button', { name: '加载更多负责人', exact: true }).click(); await metadata; await (await projection).finished()
  const denial = '负责人候选读取被拒绝，请检查连接权限后重试'; await visible(page, denial)
  const list = h.host.controller.commands.listChangeRequestAssigneeOptions.bind(h.host.controller.commands), errors = []
  h.host.controller.commands.listChangeRequestAssigneeOptions = async input => { try { return await list(input) } catch (error) { errors.push(error.code); throw error } }
  await page.evaluate(() => window.fixture.command('hold', { domain: 'watch', method: 'metadata', enabled: true }))
  try {
    const reply = page.waitForResponse(response => response.url().endsWith('/remote') && response.request().postDataJSON()?.name === 'listChangeRequestAssigneeOptions')
    await page.getByRole('button', { name: '重新读取负责人候选', exact: true }).click(); const response = await reply; await response.finished()
    assert.deepEqual(await response.json(), { ok: false, error: 'Host unavailable' }); assert.deepEqual(errors, ['stale_revision'])
    await page.evaluate(() => new Promise(requestAnimationFrame))
    assert.match(await page.locator('body').innerText(), /最后已知失败：/); await visible(page, denial); await visible(page, '本次读取尚未确认，请重新读取')
    let changed = false
    const next = page.waitForEvent('console', { predicate: message => { if (!message.text().includes('[harness-projects] watch metadata')) return false; changed = true; return true } })
    const reread = page.waitForResponse(response => changed && response.url().endsWith('/remote') && response.request().postDataJSON()?.name === 'getDeliveryProjection')
    await page.evaluate(() => window.fixture.command('release')); await next; await (await reread).finished()
    await visible(page, denial); await visible(page, '本次读取尚未确认，请重新读取'); assert.equal(await picker.count(), 0)
    assert.equal(await page.getByRole('button', { name: '添加负责人', exact: true }).isDisabled(), true); assert.equal(h.platform.assignment.adds, 0)
    const classified = page.waitForResponse(response => response.url().endsWith('/remote') && response.request().postDataJSON()?.name === 'listChangeRequestAssigneeOptions')
    await page.getByRole('button', { name: '重新读取负责人候选', exact: true }).click(); assert.equal((await (await classified).json()).value.error, 'permission_denied'); await visible(page, denial)
    assert.doesNotMatch(await page.locator('body').innerText(), /最后已知失败：|本次读取尚未确认/)
  } finally { await page.evaluate(() => window.fixture.command('release')).catch(() => {}) }
}))
