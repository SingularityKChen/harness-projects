import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from 'playwright'
import { startNativeDetailServer } from '../fixtures/native-link-detail-browser.mjs'
import { dump } from '../integration/fixtures/host-seed.js'
const wait = (page, text) => page.getByRole('dialog').getByText(text, { exact: true }).waitFor()
test('production Host remote → strict reader → safe model → unique drawer shows native links without execution writes', { timeout: 60000 }, async t => {
  const h = await startNativeDetailServer(); let browser
  t.after(async () => { await browser?.close(); await h.close() })
  browser = await chromium.launch()
  const context = await browser.newContext(), page = await context.newPage(), errors = [], outside = []
  page.setDefaultTimeout(7000); page.on('pageerror', error => errors.push(error.message))
  await context.route('**/*', route => { if (new URL(route.request().url()).origin === h.url) return route.continue(); outside.push(route.request().url()); return route.abort() })
  await page.goto(h.url); await page.waitForFunction(() => !!window.fixture)
  const back = page.getByRole('button', { name: '返回工作区', exact: true }); if (await back.count()) await back.click()
  await page.getByRole('link', { name: h.item.content.title, exact: true }).click()
  await page.getByRole('region', { name: '来源关联的 PR', exact: true }).waitFor()
  await wait(page, '来源关联读取已完成')
  const section = page.getByRole('region', { name: '来源关联的 PR', exact: true })
  assert.match(await section.innerText(), new RegExp(h.repository.name)); assert.match(await section.innerText(), /合并时关闭/)
  assert.equal(await section.getByRole('link', { name: h.rawPr.title, exact: true }).getAttribute('href'), h.rawPr.url)
  assert.equal(await section.getByRole('link').getAttribute('rel'), 'noopener noreferrer')
  await section.getByRole('link').focus(); await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement?.textContent), '刷新来源关联')
  const counts = () => h.operations.filter(op => op === 'refreshIssueClosingLinks').length
  assert.equal(counts(), 1)
  for (const colorScheme of ['light', 'dark']) { await page.emulateMedia({ colorScheme }); await page.setViewportSize({ width: 360, height: 760 }); assert.equal(await section.evaluate(node => node.scrollWidth <= node.clientWidth), true) }
  assert.equal(counts(), 1, 'theme/geometry do not reread native source'); const native = (await h.service.getIssueClosingLinks(h.item.entityId)).observation
  assert.equal((await h.service.getExecutionContext(h.item.entityId, native.links[0].repositoryId)).context, null)
  for (const file of ['packages/client/src/issue-closing-links-reader.ts', 'packages/ui-model/src/issue-closing-links-view.ts', 'packages/ui/src/issue-closing-links-section.ts', 'apps/harness-plugin/src/client.ts']) assert.ok(h.inputs.includes(file), file)
  h.flags.partial = true; await section.getByRole('button').click(); await wait(page, '来源关联读取不完整，以下仅为已获准观察的记录'); assert.doesNotMatch(await section.innerText(), /已确认无|共\s*\d/)
  h.flags.partial = false; h.flags.offline = true; await section.getByRole('button').click(); await wait(page, '最后已知值，当前来源结果尚未确认'); assert.equal(await section.getByRole('link').count(), 1)
  h.flags.offline = false; h.flags.deny = 'DevelopmentChangeRequest'; await section.getByRole('button').click(); await wait(page, '来源关联读取被拒绝，请恢复授权后刷新')
  assert.doesNotMatch(await section.ariaSnapshot(), new RegExp(h.rawPr.title)); assert.equal(await section.getByRole('link').count(), 0)
  h.flags.deny = undefined; await section.getByRole('button').click(); await wait(page, '来源关联读取已完成'); assert.equal(await section.getByRole('link').count(), 1)
  h.flags.empty = true; await section.getByRole('button').click(); await wait(page, '来源已确认无原生引用或关闭关联'); assert.equal(await section.getByRole('link').count(), 0)
  h.flags.empty = false; h.flags.pages = true; await section.getByRole('button').click(); await wait(page, '来源关联读取已完成'); assert.ok(h.requests.some(r => r.operationName === 'PlanningIssueClosingLinks' && r.variables.after === 'second'))
  h.flags.hold = true; await section.getByRole('button').click(); await page.waitForFunction(() => document.body.innerText.includes('正在读取来源关联'))
  await page.keyboard.press('Escape'); h.release(); await page.getByRole('link', { name: h.item.content.title, exact: true }).click(); await wait(page, '来源关联读取已完成')
  assert.deepEqual(dump(h.dataPath), h.before)
  const opened = counts(); h.flags.hold = true; await h.rebuild(); const rebuiltBefore = dump(h.dataPath)
  await new Promise((resolve, reject) => { const until = Date.now() + 7000; const poll = () => h.held.length ? resolve() : Date.now() > until ? reject(new Error('new Host refresh did not begin')) : setTimeout(poll, 20); poll() })
  assert.ok(counts() > opened, 'new Host generation must refresh the current source')
  assert.equal(await section.getByRole('link').count(), 0, 'new generation hides retired Host facts before its read completes'); h.release(); await wait(page, '来源关联读取已完成')
  assert.equal(h.operations.some(op => ['startWork', 'createChangeRequest', 'bindRepository', 'confirmRelation'].includes(op)), false)
  assert.deepEqual(dump(h.dataPath), rebuiltBefore); assert.deepEqual(outside, []); assert.deepEqual(errors, [])
  await page.evaluate(() => window.fixture.unmount())
})
for (const denial of ['PlanningIssueClosingLinks', 'PlanningIssueReferences', 'DevelopmentChangeRequest']) test('background Issue denial reaches open detail through same-revision metadata without probe loops or late revival: ' + denial, { timeout: 60000 }, async t => {
  const h = await startNativeDetailServer(); let browser
  t.after(async () => { await browser?.close(); await h.close() }); browser = await chromium.launch()
  const page = await browser.newPage(); page.setDefaultTimeout(7000)
  await page.goto(h.url); await page.waitForFunction(() => !!window.fixture)
  const back = page.getByRole('button', { name: '返回工作区', exact: true }); if (await back.count()) await back.click()
  await page.getByRole('link', { name: h.item.content.title, exact: true }).click(); await wait(page, '来源关联读取已完成')
  const section = page.getByRole('region', { name: '来源关联的 PR', exact: true }), other = h.items.find(item => item.entityId !== h.item.entityId), actor = { kind: 'user' }
  const deny = enabled => { if (denial.startsWith('PlanningIssue')) { h.flags.denySource = denial; h.flags.denyIssue = enabled ? other.content.externalId : undefined } else h.flags.deny = enabled ? denial : undefined }
  const native = (await h.service.getIssueClosingLinks(h.item.entityId)).observation.links[0]
  const before = await h.service.baseline(), refreshes = () => h.operations.filter(op => op === 'refreshIssueClosingLinks').length
  const noFacts = async () => { const html = await section.evaluate(node => node.outerHTML); for (const secret of [h.rawPr.title, h.repository.name, h.rawPr.url, native.repositoryId, native.bindingId, native.externalId, 'SECRET']) assert.equal(html.includes(secret), false, secret); assert.equal(await section.getByRole('link').count(), 0); assert.doesNotMatch(await section.ariaSnapshot(), /#\d+|共\s*\d/) }
  // Hold the old authoritative query response after it has left Host, then revoke through another Issue.
  h.flags.holdUi = true; await section.getByRole('button').click()
  const until = async predicate => { for (let i = 0; i < 350; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)) }; assert.fail('fixture barrier timeout') }
  await until(() => h.held.length > 0); const count = refreshes()
  deny(true)
  assert.equal((await h.service.refreshIssueClosingLinks(actor, other.entityId)).value.state, 'denied')
  const denied = await h.service.baseline(); assert.equal(denied.revision, before.revision); assert.notEqual(denied.nativeAccessVersion, before.nativeAccessVersion)
  await page.waitForFunction(version => window.fixture.frames().some(frame => frame.kind === 'metadata' && frame.nativeAccessVersion === version), denied.nativeAccessVersion)
  await wait(page, '来源关联读取被拒绝，请恢复授权后刷新'); await noFacts(); assert.equal(refreshes(), count, 'metadata invalidation is query-only')
  h.release(); await page.waitForTimeout(60); await noFacts()
  await h.service.refreshIssueClosingLinks(actor, other.entityId); assert.equal((await h.service.baseline()).nativeAccessVersion, denied.nativeAccessVersion)
  const settledRequests = h.requests.length; await page.waitForTimeout(100); assert.equal(h.requests.length, settledRequests); assert.equal(refreshes(), count, 'repeated same-key denial cannot drive a probe loop')
  // A late actual Host read must also be unable to repopulate the old epoch.
  deny(false); h.flags.hold = true; h.flags.holdOperation = denial.startsWith('PlanningIssue') ? denial : undefined; const old = h.service.refreshIssueClosingLinks(actor, h.item.entityId); await until(() => h.held.length > 0)
  deny(true); await h.service.refreshIssueClosingLinks(actor, other.entityId); h.release(); assert.deepEqual((await old).value.links, [])
  const requests = h.requests.length, version = (await h.service.baseline()).nativeAccessVersion
  assert.equal((await h.service.getIssueClosingLinks(h.item.entityId)).observation.links.length, 0)
  assert.equal((await h.service.baseline()).nativeAccessVersion, version); await page.waitForTimeout(100); assert.equal(h.requests.length, requests, 'same-key rejection creates no background network loop'); await noFacts()
  deny(false); await section.getByRole('button').click(); await wait(page, '来源关联读取已完成'); assert.equal(await section.getByRole('link').count(), 1)
  assert.equal(refreshes(), count + 1); assert.deepEqual(dump(h.dataPath), h.before); await page.evaluate(() => window.fixture.unmount())
})

test('refs-only native event reaches the real Chromium panel with complete independent coverage', { timeout: 60000 }, async t => {
  const h = await startNativeDetailServer(); h.flags.empty = true; h.flags.reference = true; h.flags.referencePages = true
  const browser = await chromium.launch(); t.after(async () => { await browser.close(); await h.close() })
  const page = await browser.newPage(); page.setDefaultTimeout(7000)
  await page.goto(h.url); await page.waitForFunction(() => !!window.fixture)
  const back = page.getByRole('button', { name: '返回工作区', exact: true }); if (await back.count()) await back.click()
  await page.getByRole('link', { name: h.item.content.title, exact: true }).click(); await wait(page, '来源关联读取已完成')
  const section = page.getByRole('region', { name: '来源关联的 PR', exact: true })
  assert.match(await section.innerText(), /仅引用/); assert.doesNotMatch(await section.innerText(), /合并时关闭/)
  assert.equal(await section.getByRole('link', { name: h.rawPr.title, exact: true }).getAttribute('href'), h.rawPr.url)
  const value = (await h.service.getIssueClosingLinks(h.item.entityId)).observation
  assert.deepEqual(value.links[0].relations, ['native_reference']); assert.equal(value.links[0].referenceWillCloseTarget, false)
  assert.equal(value.coverage.native_reference.state, 'complete'); assert.equal(value.coverage.native_closing.state, 'complete')
  assert.deepEqual(h.requests.filter(r => r.operationName === 'PlanningIssueReferences').map(r => r.variables.after), [null, 'reference-second'])
  assert.deepEqual(dump(h.dataPath), h.before); await page.evaluate(() => window.fixture.unmount())
})
