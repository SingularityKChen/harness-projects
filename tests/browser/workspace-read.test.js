import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { mkdir } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { chromium } from 'playwright'
import { startExecutionServer } from '../fixtures/execution-drawer-browser.mjs'

const TITLE = '规划项 issue-1', BODY = 'issue-1 正文占位'
const post = async (h, action, value) => {
  const response = await fetch(h.url + '/control', { method: 'POST', body: JSON.stringify({ action, value }) })
  assert.equal(response.status, 200); return response.json()
}
const visible = (page, text) => page.getByText(text, { exact: true }).filter({ visible: true }).first().waitFor({ state: 'visible' })
function createLifetime(signal, beforeClose = async () => {}) {
  const releases = []
  let closing = false, cleaning
  const close = () => {
    closing = true
    signal.removeEventListener('abort', onAbort)
    return cleaning ??= (async () => {
      const errors = []
      try { await beforeClose() } catch (error) { errors.push(error) }
      for (const release of releases.splice(0).reverse()) {
        try { await release() } catch (error) { errors.push(error) }
      }
      if (errors.length) throw new AggregateError(errors, 'Scenario cleanup failed')
    })()
  }
  const onAbort = () => { void close().catch(() => {}) }
  signal.addEventListener('abort', onAbort, { once: true })
  return { close, async adopt(open, release) {
    signal.throwIfAborted()
    if (closing) throw new Error('Scenario lifetime is closed')
    const resource = await open()
    if (closing || signal.aborted) {
      await release(resource)
      signal.throwIfAborted()
      throw new Error('Scenario closed during acquisition')
    }
    releases.push(() => release(resource))
    return resource
  } }
}
async function scenario(t, seed, run, pathname = '/') {
  const outside = [], errors = []
  let h, browser, context, page
  const lifetime = createLifetime(t.signal, async () => { if (h) await post(h, 'release') })
  t.after(lifetime.close)
  try {
    h = await lifetime.adopt(() => startExecutionServer({ seed }), value => value.close())
    browser = await lifetime.adopt(() => chromium.launch({ timeout: 7000 }), value => value.close())
    context = await lifetime.adopt(() => browser.newContext(), value => value.close())
    page = await lifetime.adopt(() => context.newPage(), async value => {
      await value.evaluate(() => window.fixture?.unmount()).catch(() => {})
      await value.close()
    })
    page.setDefaultTimeout(7000)
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === h.url) return route.continue()
      outside.push(route.request().url()); return route.abort()
    })
    page.on('pageerror', error => errors.push(error.message))
    await context.tracing.start({ screenshots: true, snapshots: true })
    await page.goto(h.url + pathname)
    await page.waitForFunction(() => !!window.fixture)
    await run({ h, page, control: (a, v) => post(h, a, v) })
    assert.deepEqual(outside, [], 'browser must never reach a business network')
    assert.deepEqual(errors, [], 'uncaught UI errors cannot pass')
  } catch (error) {
    const dir = 'test-results/composed-browser/' + t.name.replace(/[^a-z0-9-]/gi, '-')
    await mkdir(dir, { recursive: true })
    await page?.screenshot({ path: dir + '/failure.png', fullPage: true }).catch(() => {})
    await context?.tracing.stop({ path: dir + '/trace.zip' }).catch(() => {})
    throw error
  } finally {
    await lifetime.close()
  }
}
describe('production composed browser', { timeout: 120000 }, () => {
  test('create workspace from an empty SQLite database', { timeout: 60000 }, async t => {
    await scenario(t, 'empty', async ({ h, page, control }) => {
      assert.equal(await h.storage.getWorkspace(h.workspaceId), undefined)
      await visible(page, '工作区名称')
      await page.getByRole('button', { name: '创建工作区', exact: true }).click()
      assert.equal((await control('inspect')).requests.filter(r => r.name === 'createWorkspace').length, 0)
      await page.getByLabel('工作区名称', { exact: true }).fill('Browser created workspace')
      await page.getByRole('button', { name: '创建工作区', exact: true }).click()
      await visible(page, '当前工作区：Browser created workspace')
      assert.equal((await h.storage.getWorkspace(h.workspaceId)).name, 'Browser created workspace')
      assert.equal((await h.installed.service.getWorkspaceSetup()).workspace.name, 'Browser created workspace')
      const database = new DatabaseSync(h.dataPath, { readOnly: true })
      try { assert.equal(database.prepare('SELECT count(*) AS n FROM workspace').get().n, 1) } finally { database.close() }
      assert.equal((await control('inspect')).requests.filter(r => r.name === 'createWorkspace').length, 1)
    })
  })
  test('nonempty read/detail focus uses Issue Draft and redacted Provider records', { timeout: 60000 }, async t => {
    await scenario(t, 'read', async ({ h, page, control }) => {
      await visible(page, TITLE)
      await visible(page, '规划项 draft-1')
      await visible(page, '内容不可见')
      const opener = page.getByRole('link', { name: TITLE, exact: true })
      await opener.click()
      await visible(page, BODY)
      assert.match(await page.getByRole('dialog').innerText(), /Issue issue-1/)
      assert.equal(await page.getByRole('dialog').getByRole('heading', { name: TITLE }).evaluate(el => el === document.activeElement), true)
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      assert.equal(await opener.evaluate(el => el === document.activeElement), true)
      await page.getByRole('link', { name: '规划项 draft-1', exact: true }).click()
      assert.match(await page.getByRole('dialog').innerText(), /Draft item-new-6/)
      assert.ok((await control('inspect')).requests.some(r => r.name === 'getWorkspaceSetup'))
      assert.ok((await h.installed.service.baseline()).entities.length > 0)
      await page.keyboard.press('Escape'); await page.getByRole('button', { name: '刷新规划', exact: true }).click()
      await page.waitForFunction(async () => (await window.fixture.command('inspect')).calls['planning.listPlanningItems'] > 0)
    })
  })
  test('canonical history deep link reload and scope rejection share the Host stream', { timeout: 60000 }, async t => {
    await scenario(t, 'read', async ({ h, page }) => {
      await visible(page, TITLE)
      const opener = page.getByRole('link', { name: TITLE, exact: true }), href = await opener.getAttribute('href')
      assert.equal(href, `/projects/${h.workspaceId}/items/${h.itemId}`)
      await opener.click(); await visible(page, BODY); assert.equal(new URL(page.url()).pathname, href)
      await page.goBack(); await page.getByRole('dialog').waitFor({ state: 'detached' })
      await page.goForward(); await visible(page, BODY)
      await page.reload(); await visible(page, BODY)
      await page.keyboard.press('Escape'); assert.equal(new URL(page.url()).pathname, `/projects/${h.workspaceId}/items`)
      await page.goto(h.url + href); await visible(page, BODY)
      await page.goto(h.url + '/projects/another-workspace/items/' + h.itemId)
      await visible(page, '链接无效，或不属于当前工作区。')
      assert.equal(await page.getByRole('link').count(), 0)
      assert.doesNotMatch(await page.locator('body').innerText(), /issue-1 正文占位|规划项 issue-1/)
    }, '/projects/00000000-0000-4000-8000-000000000282/items')
  })
  test('disconnect reconnect retains nonempty stale list and detail without revision rollback', { timeout: 60000 }, async t => {
    await scenario(t, 'read', async ({ page, control }) => {
      await page.getByRole('link', { name: TITLE, exact: true }).click(); await visible(page, BODY)
      const before = await control('inspect'), accepted = await page.evaluate(() => window.fixture.observations().length)
      await control('disconnect', true)
      await page.getByRole('dialog').getByText(/连接已中断/).waitFor()
      assert.match(await page.getByRole('dialog').innerText(), /最后已知值/)
      await page.keyboard.press('Escape'); await visible(page, TITLE)
      assert.match(await page.locator('body').innerText(), /当前结果尚未确认/)
      await control('disconnect', false)
      await page.getByRole('button', { name: '刷新规划', exact: true }).waitFor()
      await page.waitForFunction(() => !document.body.innerText.includes('连接已中断'))
      await page.waitForFunction(n => window.fixture.observations().length > n, accepted)
      const after = await page.evaluate(() => window.fixture.observations().at(-1))
      assert.equal(after.generation, before.generation); assert.ok(after.revision >= before.revision)
    })
  })
  test('held Provider response drains before the rebuilt Host generation is accepted', { timeout: 60000 }, async t => {
    await scenario(t, 'read', async ({ page, control }) => {
      await visible(page, TITLE)
      const before = await control('inspect')
      await control('hold', { domain: 'planning', method: 'listPlanningItems', enabled: true })
      await page.getByRole('button', { name: '刷新规划', exact: true }).click()
      await page.waitForFunction(async () => (await window.fixture.command('inspect')).held > 0)
      const rebuilding = control('rebuild')
      await control('release'); await rebuilding
      await page.waitForFunction(generation => window.fixture.observations().some(frame => frame.generation !== generation), before.generation)
      const after = await page.evaluate(() => window.fixture.observations().at(-1))
      assert.notEqual(after.generation, before.generation)
      await page.getByRole('link', { name: TITLE, exact: true }).click(); await visible(page, BODY)
      await page.waitForFunction(() => !document.body.innerText.includes('连接已中断'))
    })
  })
  test('permission withdrawal hides the late canary through Back reopen and reconnect', { timeout: 60000 }, async t => {
    await scenario(t, 'read', async ({ page, control, h }) => {
      await page.getByRole('link', { name: TITLE, exact: true }).click(); await visible(page, BODY)
      await control('hold', { domain: 'watch', method: 'baseline', enabled: true })
      await control('disconnect', true); await control('disconnect', false)
      await page.waitForFunction(async () => (await window.fixture.command('inspect')).held > 0)
      await control('hold', { domain: 'watch', method: 'baseline', enabled: false })
      await control('permission', { domain: 'planning', key: 'planning.item.read', enabled: false })
      const refresh = await fetch(h.url + '/remote', { method: 'POST', body: JSON.stringify({ name: 'refreshPlanning', input: { actorRef: { kind: 'user' } } }) })
      assert.equal((await refresh.json()).ok, true)
      await control('disconnect', true); await control('disconnect', false)
      await page.waitForFunction(() => !document.body.innerText.includes('issue-1 正文占位') && !document.body.innerText.includes('规划项 issue-1'))
      await control('release')
      await page.waitForFunction(async () => (await window.fixture.command('inspect')).held === 0)
      assert.doesNotMatch(await page.locator('body').ariaSnapshot(), /issue-1 正文占位|规划项 issue-1/)
      await page.keyboard.press('Escape'); await page.goBack(); await page.goForward()
      await page.goto(h.url + `/projects/${h.workspaceId}/items/${h.itemId}`)
      await page.getByRole('dialog').waitFor()
      const accepted = await page.evaluate(() => window.fixture.observations().length)
      await control('disconnect', true); await control('disconnect', false)
      await page.waitForFunction(n => window.fixture.observations().length > n, accepted)
      assert.doesNotMatch(await page.locator('body').innerText(), /issue-1 正文占位|规划项 issue-1/)
      await control('permission', { domain: 'planning', key: 'planning.item.read', enabled: true })
      assert.doesNotMatch(await page.locator('body').innerText(), /issue-1 正文占位/)
      await page.getByRole('dialog').getByRole('button', { name: '刷新规划', exact: true }).click()
      await visible(page, BODY)
    }, '/projects/00000000-0000-4000-8000-000000000282/items')
  })


  test('abort closes late server browser context and page acquisitions without creating descendants', { timeout: 60000 }, async t => {
    for (const stage of ['server', 'browser', 'context', 'page']) {
      const abort = new AbortController(), lifetime = createLifetime(AbortSignal.any([abort.signal, t.signal]))
      t.after(lifetime.close)
      let acquired, resume, target, pending, descendants = 0
      const entered = new Promise(resolve => { acquired = resolve }), barrier = new Promise(resolve => { resume = resolve })
      t.signal.addEventListener('abort', () => resume(), { once: true })
      const own = (open) => lifetime.adopt(open, value => value.close())
      try {
        let browser, context
        if (['context', 'page'].includes(stage)) browser = await own(() => chromium.launch({ timeout: 7000 }))
        if (stage === 'page') context = await own(() => browser.newContext())
        const open = { server: () => startExecutionServer({ seed: 'empty' }), browser: () => chromium.launch({ timeout: 7000 }), context: () => browser.newContext(), page: () => context.newPage() }[stage]
        pending = own(async () => { target = await open(); acquired(); await barrier; return target }).then(() => { descendants++ })
        pending.catch(() => {})
        await Promise.race([entered, pending])
        abort.abort(); await lifetime.close(); resume()
        await assert.rejects(pending, { name: 'AbortError' })
        assert.equal(descendants, 0, stage + ' must not start the next acquisition')
        if (stage === 'server') await assert.rejects(fetch(target.url))
        if (stage === 'browser') assert.equal(target.isConnected(), false)
        if (stage === 'context') assert.equal(browser.contexts().length, 0)
        if (stage === 'page') assert.equal(target.isClosed(), true)
      } finally { resume(); await pending?.catch(() => {}); await lifetime.close() }
    }
  })
})
