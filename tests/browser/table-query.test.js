import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {mkdir,writeFile} from 'node:fs/promises'
import { chromium } from 'playwright'
import { startExecutionServer } from '../fixtures/execution-drawer-browser.mjs'
import { startTableGeometryServer } from '../fixtures/table-geometry-browser.mjs'
const clear=page=>page.getByRole('button',{name:'清除条件并恢复默认显示列',exact:true})
const titles=page=>page.locator('tbody th').allTextContents()
async function withBrowser(t,start,run){const server=await start();let browser;try{browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1200,height:800}});page.setDefaultTimeout(6000);const errors=[],outside=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).origin===server.url?route.continue():(outside.push(route.request().url()),route.abort()));await page.goto(server.url);await run(page,server);assert.deepEqual(errors,[]);assert.deepEqual(outside,[])}finally{await browser?.close();await server.close()}}
const control=async(server,action,value)=>{const r=await fetch(server.url+'/control',{method:'POST',body:JSON.stringify({action,value})});assert.equal(r.status,200);return r.json()}
test('production Provider→SQLite→Host→App safe query changes local rows and columns without Provider writes',async t=>{
  await withBrowser(t,()=>startExecutionServer({seed:'query'}),async(page,server)=>{
    await page.getByRole('link',{name:'Query 000',exact:true}).waitFor()
    const before=await control(server,'inspect')
    assert.match(await page.locator('.hp-work-items').innerText(),/共 124 项/)
    assert.equal(await page.getByRole('columnheader').count(),5)
    await page.getByRole('searchbox',{name:'搜索标题'}).fill('query 00')
    assert.deepEqual((await titles(page)).filter(x=>x.startsWith('Query')).sort(),Array.from({length:10},(_,i)=>'Query 00'+i));assert.equal((await titles(page)).length,11)
    await page.getByRole('button',{name:'按工作项排序',exact:true}).click();await page.getByRole('button',{name:'按工作项排序',exact:true}).click()
    assert.equal((await titles(page))[0],'Query 009');assert.equal(await page.locator('[aria-sort="descending"]').count(),1)
    await page.getByRole('searchbox').fill('not loaded title');await page.getByText('当前已加载可读条目没有匹配项，请调整或清除条件。',{exact:true}).waitFor()
    assert.equal((await titles(page)).length,1);assert.doesNotMatch(await page.locator('.hp-work-items').innerText(),/当前快照没有工作项/)
    await clear(page).click();assert.equal((await titles(page)).length,125)
    await page.getByText('选择显示列',{exact:true}).click();await page.getByRole('checkbox',{name:'来源',exact:true}).check();assert.equal(await page.getByRole('columnheader').count(),6)
    await clear(page).click();assert.equal(await page.getByRole('columnheader').count(),5)
    const after=await control(server,'inspect');assert.deepEqual(Object.entries(after.calls).filter(([key])=>key.startsWith('write:')),[])
    assert.deepEqual(after.requests.slice(before.requests.length).filter(r=>!['baseline','getWorkspaceSetup'].includes(r.name)),[],'local controls issue no remote command')
    await page.getByRole('searchbox').fill('Query 000');await page.getByRole('button',{name:'刷新规划',exact:true}).click();assert.equal(await page.getByRole('searchbox').inputValue(),'Query 000')
    await control(server,'permission',{domain:'planning',key:'planning.item.read',enabled:false})
    await fetch(server.url+'/remote',{method:'POST',body:JSON.stringify({name:'refreshPlanning',input:{actorRef:{kind:'user'}}})})
    await page.waitForFunction(()=>!document.querySelector('tbody'))
    assert.doesNotMatch(await page.locator('body').innerText(),/Query 000|内容不可见/)
    assert.ok((await control(server,'inspect')).calls['planning.listPlanningItems']>0,'rights go through actual Provider read path')
  })
})
test('App safe projection synchronously clears revoked facets, retains valid refresh state and resets identity scopes',async t=>{
  await withBrowser(t,startTableGeometryServer,async page=>{
    const search=page.getByRole('searchbox',{name:'搜索标题'});await search.waitFor()
    const initial=await page.locator('.hp-work-items').innerHTML();await page.evaluate(()=>window.queryFixture.hidden());assert.equal(await page.locator('.hp-work-items').innerHTML(),initial,'raw hidden mutations do not affect any DOM')
    const iteration=page.getByRole('combobox',{name:'迭代筛选'}),value=(await iteration.locator('option').allTextContents()).find(x=>x.startsWith('Iteration'))
    await iteration.selectOption({label:value})
    await page.evaluate(()=>window.queryFixture.revokeFacet())
    await page.getByText(/部分筛选条件已不可用，已清除/).waitFor()
    assert.equal(await iteration.inputValue(),'all');assert.doesNotMatch(await page.locator('.hp-work-items').innerHTML(),/IterationWithoutSpaces|OTHER-HIDDEN|CANARY-/)
    await page.evaluate(()=>window.queryFixture.restore());assert.equal(await iteration.inputValue(),'all','restored facet must not revive revoked condition')
    await search.fill('Work item 3');await page.getByRole('button',{name:'刷新规划',exact:true}).click();assert.equal(await search.inputValue(),'Work item 3')
    await page.evaluate(()=>window.queryFixture.scope('ws-1','bind-2'));assert.equal(await search.inputValue(),'')
    await search.fill('same name');await page.evaluate(()=>window.queryFixture.scope('ws-2','bind-2'));assert.equal(await search.inputValue(),'')
    await page.evaluate(()=>window.queryFixture.empty());await page.getByText('当前快照没有工作项',{exact:true}).waitFor();assert.doesNotMatch(await page.locator('.hp-work-items').innerText(),/没有匹配项/)
    await page.evaluate(()=>window.queryFixture.unknown());await page.getByText(/工作项读取能力尚未确认/).waitFor();assert.equal(await search.count(),0)
  })
})

test('query controls remain keyboard reachable with bounded columns across narrow/zoom/theme matrix',async t=>{
  await withBrowser(t,startTableGeometryServer,async(page,server)=>{
    const evidence=[]
    for(const width of [320,640,1024,1200,1440]) for(const zoom of [false,true]) for(const dark of [false,true]) {
      await page.setViewportSize({width,height:480});await page.goto(server.url+'/?'+(zoom?'zoom&':'')+(dark?'dark':''))
      const search=page.getByRole('searchbox');await search.fill('Work item 3');await search.press('Tab')
      assert.equal(await page.getByRole('combobox',{name:'规划状态筛选'}).evaluate(el=>el===document.activeElement),true)
      await page.getByRole('combobox',{name:'排序',exact:true}).selectOption('title:desc')
      assert.equal((await titles(page))[0],'Work item 39')
      await page.getByText('选择显示列',{exact:true}).click()
      await page.getByRole('checkbox',{name:'来源',exact:true}).check();await page.getByRole('checkbox',{name:'新鲜度',exact:true}).check()
      assert.equal(await page.getByRole('columnheader').count(),7);assert.equal(await page.locator('colgroup col').count(),7);assert.equal(await page.locator('tbody tr').evaluateAll(rows=>rows.every(row=>row.children.length===7)),true);assert.equal(await page.getByRole('checkbox',{name:'工作项（必显）',exact:true}).isDisabled(),true)
      const sizes=await page.locator('.hp-list-context').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,page:document.documentElement.scrollWidth,viewport:innerWidth}))
      assert.ok(sizes.scroll<=sizes.width+1,'query context has no second X scroll owner');assert.ok(sizes.page<=sizes.viewport+1)
      await page.evaluate(()=>window.queryFixture.stale());assert.deepEqual(await page.locator('tbody tr').evaluateAll(rows=>rows.map(row=>row.lastElementChild.textContent)),[...Array(11).fill('最后已知值'),'—'])
      await clear(page).click();assert.equal(await search.inputValue(),'');assert.equal(await page.getByRole('columnheader').count(),5)
      evidence.push({width,zoom,dark,sizes})
      if(process.env.TABLE_QUERY_EVIDENCE_OUT&&width===320&&dark){await mkdir(process.env.TABLE_QUERY_EVIDENCE_OUT,{recursive:true});await page.screenshot({path:process.env.TABLE_QUERY_EVIDENCE_OUT+'/narrow-'+(zoom?'200':'100')+'.png'})}
    }
    if(process.env.TABLE_QUERY_EVIDENCE_OUT) await writeFile(process.env.TABLE_QUERY_EVIDENCE_OUT+'/matrix.json',JSON.stringify(evidence,null,2))
  })
})
