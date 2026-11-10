import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from 'playwright'
import { startNativeDetailServer } from '../fixtures/native-link-detail-browser.mjs'
import { dump } from '../integration/fixtures/host-seed.js'
const until = async predicate => {
  for (let i = 0; i < 350; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20))
  };
  assert.fail('fixture barrier timeout')
}
for (const heldOperation of ['PlanningProject', 'PlanningIssueBlockedBy']) test('real Host dependency receipt and detail remain safe: ' + heldOperation, { timeout: 60000 }, async t => {
  const h = await startNativeDetailServer(), browser = await chromium.launch()
  t.after(async () => {
    await browser.close();
    await h.close()
  })
  const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(7000)
  await page.goto(h.url);
  await page.waitForFunction(() => !!window.fixture)
  const back = page.getByRole('button', { name: '返回工作区', exact: true });
  if (await back.count()) await back.click()
  const open = item => page.getByRole('link', { name: item.content.title, exact: true }).click()
  await open(h.item)
  const section = page.getByRole('region', { name: '来源 Issue 关系', exact: true })
  await section.waitFor();
  await section.getByText('blockedBy target', { exact: true }).waitFor()
  assert.match(await section.innerText(), /阻塞此 Issue[\s\S]*blockedBy target[\s\S]*此 Issue 阻塞[\s\S]*blocking target/)
  const link = section.getByRole('link', { name: 'blockedBy target', exact: true })
  assert.equal(await link.getAttribute('href'), 'https://github.com/other/project/issues/7');
  assert.equal(await link.getAttribute('rel'), 'noopener noreferrer')
  assert.match(await section.innerText(), /other\/project · #7 · 已关闭/)
  await page.context().route('https://github.com/**', route => route.abort())
  await link.focus()
  const popup = page.waitForEvent('popup'); await page.keyboard.press('Enter'); await (await popup).close()
  const count = () => h.operations.filter(op => op === 'refreshIssueDependencies').length
  const first = count()
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 320, height: 760 });
    assert.ok(await section.evaluate(n => n.scrollWidth <= n.clientWidth))
  }
  assert.equal(count(), first)
  h.flags.dependenciesPages = true;
  await section.getByRole('button').click();
  await link.waitFor()
  for (const op of ['PlanningIssueBlockedBy', 'PlanningIssueBlocking']) assert.ok(h.requests.some(r => r.operationName === op && r.variables.after))
  // A successful wire response held outside Host must disappear when a same-binding actual denial changes metadata.
  h.flags.holdUi = true;
  await section.getByRole('button').click();
  await until(() => h.held.length > 0)
  const other = h.items.find(item => item.entityId !== h.item.entityId), before = await h.service.baseline(), reads = count()
  h.flags.deny = 'PlanningIssueBlockedBy'
  assert.equal((await h.service.refreshIssueDependencies({ kind: 'user' }, other.entityId)).result.value.blockedBy.state, 'denied')
  const denied = await h.service.baseline();
  assert.equal(denied.revision, before.revision);
  assert.notEqual(denied.nativeAccessVersion, before.nativeAccessVersion)
  await page.waitForFunction(v => window.fixture.frames().some(f => f.nativeAccessVersion === v), denied.nativeAccessVersion)
  const noFacts = async () => {
    assert.equal(await section.getByRole('link').count(), 0);
    assert.doesNotMatch(await section.ariaSnapshot(), /blockedBy target|blocking target|other\/project|共\s*\d/)
  }
  await noFacts();
  h.release();
  await page.waitForTimeout(80);
  await noFacts();
  assert.equal(count(), reads)
  h.flags.deny = undefined;
  h.flags.hold = true; h.flags.holdOperation = heldOperation
  const held = h.service.refreshIssueDependencies({ kind: 'user' }, h.item.entityId)
  await until(() => h.held.length > 0)
  h.flags.deny = 'PlanningIssueBlockedBy'; await h.service.refreshIssueDependencies({ kind: 'user' }, other.entityId)
  h.flags.deny = undefined; assert.equal((await h.service.refreshIssueDependencies({ kind: 'user' }, other.entityId)).result.value.blockedBy.state, 'complete')
  h.release(); assert.deepEqual((await held).result.value.blockedBy.items, [], 'B recovery cannot renew held A')
  await noFacts(); await section.getByRole('button').click(); await link.waitFor()
  h.flags.deny = 'PlanningIssueBlockedBy'
  const restored = await h.service.baseline()
  assert.equal((await h.service.refreshIssueDependencies({ kind: 'user' }, other.entityId)).result.value.blockedBy.state, 'denied')
  const repeated = await h.service.baseline(); assert.notEqual(repeated.nativeAccessVersion, restored.nativeAccessVersion)
  await page.waitForFunction(v => window.fixture.frames().some(f => f.nativeAccessVersion === v), repeated.nativeAccessVersion)
  await noFacts(); h.flags.deny = undefined; await section.getByRole('button').click(); await link.waitFor()
  h.flags.dependenciesEmpty = true;
  await section.getByRole('button').click();
  await section.getByText('来源未返回可见的阻塞此项', { exact: true }).waitFor();
  assert.equal(await section.getByRole('link').count(), 0)
  h.flags.dependenciesEmpty = false;
  h.flags.hold = true;
  h.flags.holdOperation = 'PlanningIssueBlockedBy';
  await section.getByRole('button').click();
  await until(() => h.held.length > 0)
  await page.keyboard.press('Escape');
  await open(other);
  await page.keyboard.press('Escape');
  await open(h.item);
  h.release();
  await link.waitFor()
  assert.deepEqual(dump(h.dataPath), h.before)
  const old = count();
  h.flags.hold = true;
  await h.rebuild();
  await until(() => h.held.length > 0);
  const rebuilt = dump(h.dataPath);
  assert.ok(count() > old);
  await noFacts();
  h.release();
  await link.waitFor()
  await link.focus();
  await page.keyboard.press('Tab');
  assert.ok(await section.evaluate(n => n.contains(document.activeElement)))
  assert.deepEqual(dump(h.dataPath), rebuilt);
  h.flags.hold = true
  const retired = h.service.refreshIssueDependencies({ kind: 'user' }, h.item.entityId).then(() => undefined, error => error)
  await until(() => h.held.length > 0); const rebuilding = h.rebuild(); h.release(); await rebuilding
  assert.match((await retired)?.message ?? '', /host 读取已失效/)
  await link.waitFor()
  assert.deepEqual(errors, [])
  assert.ok(!h.operations.some(op => ['confirmRelation', 'createChangeRequest', 'startWork'].includes(op)))
  await page.evaluate(() => window.fixture.unmount())
})


test('production hierarchy detail distinguishes source targets, complete empty, partial and denied', { timeout: 60000 }, async t => {
  const h = await startNativeDetailServer(), browser = await chromium.launch(); t.after(async () => { await browser.close(); await h.close() })
  const page = await browser.newPage(); page.setDefaultTimeout(7000)
  await page.goto(h.url); await page.waitForFunction(() => !!window.fixture)
  const back = page.getByRole('button', { name: '返回工作区', exact: true }); if (await back.count()) await back.click()
  await page.getByRole('link', { name: h.item.content.title, exact: true }).click()
  const parent = page.getByRole('region', { name: '父 Issue', exact: true }), children = page.getByRole('region', { name: '子 Issue', exact: true })
  await parent.getByRole('link', { name: 'parent target', exact: true }).waitFor()
  assert.match(await parent.innerText(), /parent\/project · #7 · 已关闭/); assert.match(await children.innerText(), /other\/project · #7 · 已关闭/)
  const link = children.getByRole('link', { name: 'subIssues target', exact: true }); assert.equal(await link.getAttribute('href'), 'https://github.com/other/project/issues/7')
  assert.equal(await link.getAttribute('rel'), 'noopener noreferrer'); await link.focus(); assert.equal(await link.evaluate(n => n === document.activeElement), true)
  const refresh = page.getByRole('button', { name: '刷新来源 Issue 关系', exact: true })
  h.flags.dependenciesPages = true; h.flags.childrenFailure = true; await refresh.click()
  await children.getByRole('status').filter({ hasText: '读取不完整' }).waitFor(); assert.equal(await link.count(), 1)
  assert.equal(await parent.getByRole('link').count(), 1)
  h.flags.childrenFailure = false; h.flags.dependenciesEmpty = true; await refresh.click()
  await parent.getByRole('status').filter({ hasText: '来源未返回可见父项' }).waitFor()
  await children.getByRole('status').filter({ hasText: '来源未返回可见子项' }).waitFor()
  h.flags.offline = true; await refresh.click(); await children.getByRole('status').filter({ hasText: '暂不可用' }).waitFor()
  assert.equal(await parent.getByRole('link').count(), 0)
  h.flags.offline = false; h.flags.deny = 'PlanningIssueParent'; await refresh.click()
  await parent.getByRole('status').filter({ hasText: /被拒绝|尚未确认/ }).waitFor(); assert.equal((await h.service.refreshIssueDependencies({ kind: 'user' }, h.item.entityId)).result.value.parent.state, 'denied'); assert.doesNotMatch(await parent.ariaSnapshot(), /parent target|parent\/project/)
  h.flags.deny = undefined; h.flags.dependenciesEmpty = false; await refresh.click(); await link.waitFor()
  assert.deepEqual(dump(h.dataPath), h.before); await page.evaluate(() => window.fixture.unmount())
})
