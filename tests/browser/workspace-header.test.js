import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {startTableGeometryServer} from '../fixtures/table-geometry-browser.mjs'
const out=process.env.HEADER_EVIDENCE_OUT
async function scene(t,run,timeZone='Asia/Singapore'){
 const server=await startTableGeometryServer(),browser=await chromium.launch();t.after(()=>server.close());t.after(()=>browser.close())
 const page=await browser.newPage({timezoneId:timeZone});page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await run(page,server.url);assert.deepEqual(errors,[])
}
test('one identity and toolbar in document flow; native disclosure, settings and detail restore focus',async t=>{
 await scene(t,async(page,url)=>{
  await page.setViewportSize({width:1200,height:900});await page.goto(url+'/?header');await page.locator('tbody tr').last().waitFor()
  assert.equal(await page.getByRole('heading',{name:'工作项',exact:true}).count(),1)
  const summary=page.locator('.hp-status-summary summary');assert.equal(await summary.count(),1,'status has a native keyboard disclosure');await page.keyboard.press('Tab');assert.equal(await summary.evaluate(el=>el===document.activeElement),true);assert.notEqual(await summary.evaluate(el=>getComputedStyle(el).outlineStyle),'none');await page.keyboard.press('Enter')
  assert.equal(await page.locator('.hp-status-summary details').evaluate(el=>el.open),true)
  assert.equal(await page.getByText('Table workspace',{exact:true}).count(),1)
  const time=page.locator('.hp-status-summary time');assert.equal(await time.getAttribute('datetime'),'2026-11-03T01:00:00.000Z');assert.match(await time.textContent(),/09:00:00.*Asia\/Singapore/)
  await summary.focus();await page.keyboard.press('Space');assert.equal(await page.locator('.hp-status-summary details').evaluate(el=>el.open),false)
  const settings=page.getByRole('button',{name:'连接设置',exact:true});await settings.click();await page.getByRole('button',{name:'返回工作区',exact:true}).click()
  assert.equal(await settings.evaluate(el=>el===document.activeElement),true)
  const link=page.locator('tbody tr').first().getByRole('link');await link.click();assert.equal(await link.getAttribute('aria-current'),'true');assert.equal(await link.locator('..').locator('..').getAttribute('data-selected'),'true');await page.keyboard.press('Escape');assert.equal(await link.getAttribute('aria-current'),null);assert.equal(await link.evaluate(el=>el===document.activeElement),true)
 })
})
test('collapsed status retains transport, partial/unknown reads, pending/error and clears revoked source evidence',async t=>{
 await scene(t,async(page,url)=>{
  await page.goto(url+'/?header');await page.locator('tbody tr').last().waitFor()
  const row=page.locator('.hp-status-summary'),live=row.locator('[aria-live=polite]');assert.equal(await row.locator('summary').count(),1,'exception observations share the persistent disclosure row')
  for(const [extra,operation,want] of [[{connection:{connected:false}},{pending:false},'连接中断'],[{connection:{connected:true},reason:'RAW-REASON-CANARY'},{pending:false},'读取不完整'],[{reason:undefined,capabilities:[]},{pending:false},'读取状态未知'],[{capabilities:[{key:'planning.item.read',access:'read_only'}]},{pending:true},'正在刷新规划'],[{}, {pending:false,error:'safe refresh failure'},'规划刷新未完成']]){
   await page.evaluate(([extra,operation])=>window.headerFixture.state(extra,operation),[extra,operation]);await page.getByText(want,{exact:false}).first().waitFor();assert.match(await row.evaluate(el=>[el.querySelector('summary').innerText,...[...el.querySelectorAll(':scope > p')].map(p=>p.innerText)].join(' ')),new RegExp(want))
  }
  await page.evaluate(()=>window.headerFixture.setupState({error:{code:'result_unknown',message:'RAW-OPERATION-CANARY'}}));assert.match((await row.locator(':scope > p').allInnerTexts()).join(' '),/工作区设置结果未知/);assert.doesNotMatch(await row.textContent(),/RAW-REASON-CANARY|RAW-OPERATION-CANARY/);await page.evaluate(()=>window.headerFixture.setupState({error:undefined}))
  await page.evaluate(()=>window.headerFixture.state({reconciledAt:'2026-11-03T02:00:00Z'},{pending:false}));await page.waitForFunction(()=>document.querySelector('.hp-status-announcement').textContent.includes('当前读取已确认'))
  const announced=await live.textContent();await page.evaluate(()=>window.headerFixture.state({reconciledAt:'2026-11-03T03:00:00Z'}));assert.equal(await live.textContent(),announced)
  await row.locator('summary').click();await page.evaluate(()=>window.headerFixture.state({reason:'permission_denied',planningSource:undefined,capabilities:[{key:'planning.item.read',access:'unavailable'}]}))
  await page.waitForFunction(()=>!document.querySelector('.hp-status-summary').textContent.includes('SourceWithoutSpaces'));assert.equal(await row.locator('time').count(),0)
  await page.evaluate(()=>window.queryFixture.scope('new-workspace','new-binding'));await page.waitForFunction(()=>document.querySelector('.hp-status-announcement').textContent==='');assert.equal(await live.textContent(),'')
 })
})
test('settings unmounts list announcements and scope/revocation replaces all old source evidence before return',async t=>{
 await scene(t,async(page,url)=>{
  await page.goto(url+'/?header');await page.locator('tbody tr').last().waitFor()
  await page.evaluate(()=>{window.headerFixture.long('WORKSPACE-CANARY');window.headerFixture.state({planningSource:{bindingId:'bind-1',name:'SOURCE-CANARY'},reconciledAt:'2026-10-01T07:59:00.000Z'})})
  await page.getByRole('button',{name:'连接设置',exact:true}).click();assert.equal(await page.locator('.hp-work-items').count(),0,'no hidden list live region or tab targets')
  await page.evaluate(()=>window.headerFixture.state({planningSource:undefined,reconciledAt:undefined,reason:'permission_denied',capabilities:[{key:'planning.item.read',access:'unavailable'}]}))
  await page.waitForFunction(()=>!document.getElementById('app').textContent.includes('SOURCE-CANARY'))
  assert.doesNotMatch(await page.locator('#app').textContent(),/SOURCE-CANARY|2026-10-01T07:59:00/)
  await page.evaluate(()=>{window.headerFixture.state({workspace:{id:'new-workspace',name:'New workspace'},planningSource:{bindingId:'new-binding',name:'New source'},reason:undefined,capabilities:[{key:'planning.item.read',access:'read_only'}]});window.queryFixture.scope('new-workspace','new-binding')})
  await page.waitForFunction(()=>!document.getElementById('app').textContent.includes('WORKSPACE-CANARY'))
  await page.getByRole('button',{name:'返回工作区',exact:true}).click();await page.locator('tbody tr').last().waitFor()
  assert.equal(await page.getByRole('button',{name:'连接设置',exact:true}).evaluate(el=>el===document.activeElement),true)
  assert.doesNotMatch(await page.locator('#app').textContent(),/SOURCE-CANARY|WORKSPACE-CANARY|2026-10-01T07:59:00/)
 })
})
test('observed time uses UTC and invalid values never invent an observation',async t=>{
 await scene(t,async(page,url)=>{await page.goto(url+'/?header');await page.locator('tbody tr').last().waitFor();assert.equal(await page.locator('.hp-status-summary summary').count(),1);await page.locator('.hp-status-summary summary').click();assert.match(await page.locator('.hp-status-summary time').textContent(),/01:00:00.*UTC/);await page.evaluate(()=>window.headerFixture.state({reconciledAt:'invalid'}));await page.getByText('时间未知',{exact:true}).waitFor();assert.equal(await page.locator('.hp-status-summary time').count(),0)},'UTC')
})
test('bounded header matrix preserves table XY, readable content and visible action geometry',async t=>{
 await scene(t,async(page,url)=>{const evidence=[]
  for(const width of [1440,1200,1024,320])for(const zoom of [false,true])for(const dark of [false,true]){
   await page.setViewportSize({width,height:900});await page.goto(url+'/?header'+(zoom?'&zoom':'')+(dark?'&dark':''));await page.locator('tbody tr').last().waitFor()
   assert.equal(await page.locator('.hp-list-toolbar').count(),1,'list owns a single toolbar');const measure=()=>page.evaluate(()=>{const box=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}},status=document.querySelector('.hp-status-summary'),toolbar=document.querySelector('.hp-list-toolbar'),table=document.querySelector('.hp-list-scroll');return {status:box(status),toolbar:box(toolbar),actionsInToolbar:[...document.querySelectorAll('.hp-project button.hp-action')].every(el=>el.closest('.hp-list-toolbar')===toolbar),actions:[...toolbar.querySelectorAll('button')].map(box),heading:box(toolbar.querySelector('h2')),observations:[...status.querySelectorAll('summary span')].filter(el=>/^(宿主|来源)：/.test(el.textContent)).map(box),table:box(table),x:table.scrollWidth>table.clientWidth,y:table.scrollHeight>table.clientHeight,overflow:document.documentElement.scrollWidth>innerWidth+1}})
   for(const long of [false,true]){if(long){await page.evaluate(()=>window.headerFixture.long());await page.waitForFunction(()=>document.querySelector('.hp-status-summary').textContent.includes('WorkspaceWithoutSpaces'))}
    const m=await measure(),context=JSON.stringify({width,zoom,dark,long});assert.equal(m.overflow,false,context);assert.equal(m.actionsInToolbar,true,context+' refresh and settings belong to heading toolbar');m.observations.forEach(a=>assert.ok(a.bottom<=m.status.bottom,context+' transport/read remains visible beside long identity'));assert.ok(m.table.height>=140&&m.y&&(width>320||m.x),context+JSON.stringify(m));m.actions.forEach(a=>assert.ok(a.height>=44&&a.left>=0&&a.right<=width,context));if(width>=1024&&!zoom&&!long){assert.ok(m.status.height>=40&&m.status.height<=48,context);m.actions.forEach(a=>assert.ok(Math.abs(a.top-m.heading.top)<5,context+' toolbar actions share heading row'));assert.ok(m.toolbar.top-m.status.bottom<35,context+' no empty refresh row')}
    for(const button of await page.locator('.hp-list-actions button').all()){await button.focus();assert.equal(await button.evaluate(el=>{const a=el.getBoundingClientRect(),c=el.closest('.hp-list-context').getBoundingClientRect();return a.top>=c.top-1&&a.bottom<=c.bottom+1}),true,context+' keyboard reaches every complete toolbar action')}
    evidence.push({width,zoom,dark,long,...m});if(out){await mkdir(out,{recursive:true});if(!long||width===320)await page.screenshot({path:out+'/'+[width,zoom?200:100,dark?'dark':'light',long?'long':'normal'].join('-')+'.png'})}
   }
  }
  if(out)await writeFile(out+'/matrix.json',JSON.stringify(evidence,null,2))
 })
})

test('same-scope retained metadata is sanitized by unknown/unavailable presentation; authorized offline/partial remains readable',async t=>{
 await scene(t,async(page,url)=>{
  await page.goto(url+'/?header');await page.locator('tbody tr').last().waitFor();const row=page.locator('.hp-status-summary');await row.locator('summary').click()
  const metadata={bindingId:'bind-1',name:'RETAINED-SOURCE-CANARY',mappingOrigin:'user'},at='2026-10-31T03:04:05.000Z',report=[]
  for(const access of ['available','read_only','degraded'])for(const connected of [true,false]){
   await page.evaluate(({access,connected,metadata,at})=>window.headerFixture.state({planningSource:metadata,reconciledAt:at,capabilities:[{key:'planning.item.read',access}],connection:{connected},reason:'permission_denied'}),{access,connected,metadata,at})
   await row.getByText('RETAINED-SOURCE-CANARY',{exact:true}).waitFor();assert.match(await row.textContent(),/用户配置/);assert.equal(await row.locator('time').getAttribute('datetime'),at)
   if(out&&!connected){await mkdir(out,{recursive:true});await page.screenshot({path:out+'/authorized-offline-'+access+'.png'})}
  }
  for(const access of [undefined,'unavailable'])for(const connected of [true,false]){
   await page.evaluate(({access,connected,metadata,at})=>window.headerFixture.state({planningSource:metadata,reconciledAt:at,capabilities:access?[{key:'planning.item.read',access}]:[],connection:{connected},reason:'permission_denied'}),{access,connected,metadata,at})
   await page.waitForFunction(want=>document.querySelector('.hp-status-summary summary').textContent.includes(want),access?'读取不可用':'读取状态未知')
   assert.doesNotMatch(await row.textContent(),/RETAINED-SOURCE-CANARY|用户配置|2026-10-31T03:04:05/);assert.equal(await row.locator('time').count(),0)
   assert.equal(await row.locator('[aria-live=polite]').count(),1);assert.doesNotMatch(await page.locator('#app').textContent(),/RETAINED-SOURCE-CANARY|用户配置|2026-10-31T03:04:05/)
   await page.waitForFunction(want=>document.querySelector('.hp-status-announcement').textContent===want,(connected?'已连接':'连接中断')+'。'+(access?'读取不可用':'读取状态未知')+'。')
   report.push({access:access??'unknown',connected,status:await row.innerText(),timeCount:await row.locator('time').count()})
   if(out){await mkdir(out,{recursive:true});await page.screenshot({path:out+'/residual-'+(access??'unknown')+'-'+(connected?'online':'offline')+'.png'})}
   const announcement=await row.locator('[aria-live=polite]').textContent();await page.evaluate(()=>window.headerFixture.state({reconciledAt:'2026-10-31T05:06:07.000Z'}));assert.equal(await row.locator('[aria-live=polite]').textContent(),announcement)
  }
  if(out)await writeFile(out+'/permission-matrix.json',JSON.stringify(report,null,2))
 })
})

test('narrow Host slot keeps identity readable below observations in a wide window',async t=>{
 await scene(t,async(page,url)=>{const evidence=[]
  for(const width of [1200,320])for(const zoom of [false,true]){
   await page.setViewportSize({width,height:420});await page.goto(url+'/?header'+(zoom?'&zoom':''));await page.locator('tbody tr').last().waitFor()
   await page.locator('#app').evaluate(el=>el.style.width='320px')
   for(const long of [false,true]){
    if(long){await page.evaluate(()=>window.headerFixture.long());await page.waitForFunction(()=>document.querySelector('.hp-status-summary').textContent.includes('WorkspaceWithoutSpaces'))}
    const m=await page.locator('.hp-status-summary').evaluate(status=>{
     const box=el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}}
     const [identity,transport,source]=status.querySelector('.hp-status-line').children
     return {status:box(status),identity:box(identity),transport:box(transport),source:box(source),overflow:document.documentElement.scrollWidth>innerWidth+1}
    }),context=JSON.stringify({width,slot:320,zoom,long,...m})
    assert.ok(m.identity.width>=(zoom?220:250),context+' identity uses a readable row inside the Host slot')
    assert.ok(m.identity.top>=Math.max(m.transport.bottom,m.source.bottom)-1,context+' transport and source remain before identity')
    for(const observation of [m.transport,m.source])assert.ok(observation.bottom<=m.status.bottom,context+' observations remain visible')
    assert.equal(m.overflow,false,context);assert.ok(m.status.height<=211,context+' status stays within half the short Host')
    if(!zoom&&!long){assert.ok(m.status.height<=100,context+' ordinary identity stays compact');assert.ok(m.identity.bottom<=m.status.bottom,context+' ordinary identity is visible without scrolling')}
    evidence.push({width,slot:320,zoom,long,...m})
    if(out){await mkdir(out,{recursive:true});await page.screenshot({path:out+'/slot-'+[width,zoom?200:100,long?'long':'normal'].join('-')+'.png'})}
   }
  }
  if(out)await writeFile(out+'/slot-matrix.json',JSON.stringify(evidence,null,2))
 })
})

test('reference roles, current route and permission gates stay distinct from keyboard focus', async t => {
  await scene(t, async (page, url) => {
    for (const dark of [false, true]) {
      await page.setViewportSize({ width:1440, height:900 })
      await page.goto(url+'/?header&reference'+(dark?'&dark':''))
      await page.locator('tbody tr').last().waitFor()
      assert.equal(await page.locator('tbody tr').count(),7)
      assert.equal(await page.locator('.hp-status-done').count(),1)
      const link=page.locator('tbody tr').first().getByRole('link')
      await link.click()
      const row=link.locator('..').locator('..'), selected=await row.evaluate(el=>({ background:getComputedStyle(el.firstElementChild).backgroundColor, edge:getComputedStyle(el.firstElementChild).boxShadow }))
      assert.equal(selected.background,dark?'rgb(33, 33, 35)':'rgb(245, 246, 247)')
      assert.match(selected.edge,/2px/)
      await page.keyboard.press('Escape')
      assert.equal(await page.locator('[aria-current],tr[data-selected]').count(),0)
      await link.focus()
      assert.equal(await link.evaluate(el=>getComputedStyle(el).outlineWidth),'2px')
      await link.click()
      await page.evaluate(()=>window.headerFixture.state({capabilities:[{key:'planning.item.read',access:'unavailable'}],reason:'permission_denied'}))
      await page.waitForFunction(()=>document.querySelectorAll('tbody a[aria-current],tr[data-selected]').length===0)
      assert.doesNotMatch(await page.locator('#app').innerText(),/为新会话保留可恢复的执行身份|example\/project#554/)
    }
    await page.goto(url+'/?header&reference')
    await page.locator('tbody tr').last().waitFor()
    await page.locator('tbody tr').first().getByRole('link').click()
    await page.evaluate(()=>window.queryFixture.scope('other-project','other-source'))
    assert.equal(await page.locator('[aria-current],tr[data-selected]').count(),0)
    await page.goto(url+'/?app&reference&path=/projects/other/items/safe')
    await page.getByRole('button',{name:'回到工作项列表',exact:true}).waitFor()
    const primary=page.getByRole('button',{name:'回到工作项列表',exact:true})
    assert.deepEqual(await primary.evaluate(el=>({color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor})),{color:'rgb(255, 255, 255)',background:'rgb(15, 17, 21)'})
    assert.equal(await page.locator('[aria-current],tr[data-selected]').count(),0)
    await page.goto(url+'/?header&reference&fallback')
    await page.locator('tbody tr').last().waitFor()
    assert.equal(await page.getByRole('searchbox').evaluate(el=>getComputedStyle(el).color),await page.locator('.hp-workspace').first().evaluate(el=>getComputedStyle(el).color))
  })
})

test('same-project binding changes retire the old route while same-binding denial updates the mounted drawer', async t => {
  await scene(t, async (page,url) => {
    await page.goto(url+'/?header&reference')
    await page.locator('tbody tr').last().waitFor()
    const link=page.locator('tbody tr').first().getByRole('link')
    await link.click()
    await page.evaluate(()=>window.queryFixture.scope('ws-1','bind-2'))
    await page.waitForFunction(()=>!document.querySelector('dialog'))
    assert.equal(await page.locator('[aria-current],tr[data-selected]').count(),0)
    await link.click()
    const drawer=await page.getByRole('dialog').elementHandle()
    await page.evaluate(()=>window.headerFixture.state({reason:'permission_denied',capabilities:[{key:'planning.item.read',access:'unavailable'}]}))
    assert.equal(await page.getByRole('dialog').evaluate((el,original)=>el===original,drawer),true)
    assert.equal(await page.locator('[aria-current],tr[data-selected]').count(),0)
    await page.evaluate(()=>window.headerFixture.state({planningSource:undefined}))
    await page.waitForFunction(()=>!document.querySelector('dialog'))
    await page.goto(url+'/?app&reference&path=/projects/ws-1/items/item-0')
    await page.getByRole('dialog').waitFor()
    await page.evaluate(()=>window.headerFixture.reading(true))
    await page.getByRole('dialog').waitFor({state:'detached'})
    await page.evaluate(()=>window.headerFixture.reading(false))
    await page.getByRole('dialog').waitFor()
    assert.equal(await page.locator('tbody a[aria-current=true]').count(),1)
  })
})
