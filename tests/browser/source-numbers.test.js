import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chromium } from 'playwright'
import { startWorkspaceFrameServer } from '../fixtures/workspace-frame-browser.mjs'

test('default title cells expose scoped native numbers; number search and selected detail agree', async () => {
  const server=await startWorkspaceFrameServer(), browser=await chromium.launch()
  try {
    const page=await browser.newPage({viewport:{width:1280,height:800}}), errors=[]
    page.on('pageerror',e=>errors.push(e.message))
    await page.goto(server.url+'/?scenario=numbers')
    await page.getByText('GitHub example/one#449',{exact:true}).waitFor()
    assert.equal(await page.getByRole('columnheader').count(),5)
    const cells=await page.locator('tbody th').allTextContents()
    assert.ok(cells.some(x=>x.includes('GitHub example/one#449')))
    assert.ok(cells.some(x=>x.includes('GitHub example/two#449')))
    assert.ok(cells.some(x=>x.includes('暂无原生编号')))
    const search=page.getByRole('searchbox')
    for(const [text,count] of [['449',4],['#449',3]]) {
      await search.fill(text)
      assert.equal(await page.locator('tbody tr').count(),count)
    }
    await search.fill(' GitHub MISSING/REPO#449 ')
    assert.equal(await page.locator('tbody tr').count(),1)
    await search.fill(' GitHub EXAMPLE/ONE#449 ')
    assert.equal(await page.locator('tbody tr').count(),2)
    await page.getByRole('link',{name:'可见工作项',exact:true}).click()
    const dialog=page.getByRole('dialog')
    await dialog.getByText('GitHub example/one#449',{exact:true}).waitFor()
    assert.doesNotMatch(await page.locator('body').innerText(),/CANARY-|opaque-/)
    assert.deepEqual(errors,[])
  } finally {await browser.close();await server.close()}
})
