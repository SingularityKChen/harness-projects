import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { startExecutionServer } from '../fixtures/execution-drawer-browser.mjs'
import { startTableGeometryServer } from '../fixtures/table-geometry-browser.mjs'

const output=process.env.PLANNING_TIMELINE_EVIDENCE_OUT
const control=async(server,action,value)=>(await fetch(server.url+'/control',{method:'POST',body:JSON.stringify({action,value})})).json()
const timeline=page=>page.getByRole('button',{name:'时间线',exact:true}).click()
async function scenario(t,start,run) {
  let server,browser,page
  try {
    server=await start(); browser=await chromium.launch({timeout:7000})
    page=await browser.newPage({viewport:{width:1440,height:900}}); page.setDefaultTimeout(7000)
    const errors=[],outside=[]
    page.on('pageerror',error=>errors.push(error.message))
    await page.route('**/*',route=>new URL(route.request().url()).origin===server.url?route.continue():(outside.push(route.request().url()),route.abort()))
    await page.clock.install({time:new Date('2026-11-10T15:59:30Z')})
    await page.goto(server.url); await run(page,server)
    assert.deepEqual(errors,[]); assert.deepEqual(outside,[])
  } catch(error) {
    const dir='test-results/planning-timeline/'+t.name.replace(/[^a-z0-9-]/gi,'-')
    await mkdir(dir,{recursive:true}); await page?.screenshot({path:dir+'/failure.png'}).catch(()=>{})
    throw error
  } finally { await control(server,'release').catch(()=>{}); await browser?.close(); await server?.close() }
}
async function capture(page,name) {
  if(!output)return
  await mkdir(output,{recursive:true}); await page.screenshot({path:output+'/'+name+'.png'})
  await writeFile(output+'/'+name+'.json',JSON.stringify({identity:name.startsWith('reference')?'synthetic safe read → production WorkItemApp; v3 palette/data/clock':'native Fake Provider → Core/SQLite → Host/remote/client/store → production apply',...await page.evaluate(()=>({source:location.pathname+location.search,width:innerWidth,height:innerHeight,theme:document.documentElement.className||document.documentElement.dataset.theme,font:getComputedStyle(document.documentElement).font,scroll:document.querySelector('.hp-timeline-scroll')?.scrollTop}))},null,2))
}
async function geometry(page) {
  return page.locator('.hp-timeline').evaluate(el=>{
    const bounds=node=>node.getBoundingClientRect(), cells=[...el.querySelectorAll('thead th')].slice(1).map(bounds)
    const markers=[...el.querySelectorAll('.hp-timeline-marker')].map(marker=>{
      const point=bounds(marker),row=bounds(marker.closest('tr')),track=bounds(marker.closest('td'))
      const date=marker.nextElementSibling.textContent,header=cells.find((cell,i)=>el.querySelectorAll('thead th')[i+1].textContent===date.slice(5).replace('-','/'))
      return {inside:point.top>=row.top&&point.bottom<=row.bottom,offset:header?Math.abs((point.left+point.right)/2-(header.left+header.right)/2):null,track:track.width}
    })
    const scroll=el.querySelector('.hp-timeline-scroll')
    const bands=[...el.querySelectorAll('.hp-timeline-band')].map(node=>{
      const band=bounds(node),row=bounds(node.closest('tr')),track=bounds(node.closest('td'))
      return {inside:band.top>=row.top&&band.bottom<=row.bottom&&band.left>=track.left&&band.right<=track.right+1,width:band.width,track:track.width}
    })
    const rowBounds=[...el.querySelectorAll('tbody tr')].map(node=>({top:bounds(node).top,height:bounds(node).height}))
    return {page:document.documentElement.scrollWidth,viewport:innerWidth,cells:cells.length,markers,bands,rowBounds,rows:el.querySelectorAll('tbody tr').length,nodes:el.querySelectorAll('*').length,graph:getComputedStyle(el.querySelector('tbody td')).display,scroll:{height:scroll.clientHeight,content:scroll.scrollHeight},rowOverflow:[...el.querySelectorAll('tbody th')].some(node=>node.scrollHeight>node.clientHeight+1),textOverflow:[...el.querySelectorAll('tbody th')].some(node=>node.scrollWidth>node.clientWidth+1)}
  })
}

test('composed Host Timeline preserves source dates, query, unique detail and revocation across a held old baseline', {timeout:60000}, async t=>{
  await scenario(t,()=>startExecutionServer({seed:'timeline'}),async(page,server)=>{
    await page.getByRole('link',{name:'Timeline both',exact:true}).waitFor()
    const before=await control(server,'inspect')
    await timeline(page)
    assert.equal(await page.locator('.hp-timeline-calendar').isVisible(),true,'display day and explicit calendar are visible without opening a disclosure')
    assert.match(await page.locator('.hp-timeline-calendar').innerText(),/今天 2026-11-10.*Asia\/Singapore/)
    assert.equal(await page.locator('.hp-timeline-marker').count(),20)
    assert.equal(await page.locator('.hp-timeline-band').count(),1)
    await page.getByText('所属迭代：Timeline sprint · 2026-11-09 → 2026-11-15',{exact:true}).waitFor()
    const measured=await geometry(page)
    assert.equal(measured.rows,28)
    assert.equal(await page.getByRole('button',{name:'定位日期',exact:true}).count(),2,'only the two outside source dates offer useful positioning')
    assert.ok(measured.rows>20&&measured.nodes<700,JSON.stringify(measured))
    assert.ok(measured.markers.every(marker=>marker.inside&&marker.offset<1),JSON.stringify(measured))
    assert.ok(measured.bands.every(band=>band.inside&&Math.abs(band.width-band.track)<1),JSON.stringify(measured))
    assert.ok(measured.scroll.content>measured.scroll.height)
    const opener=page.getByRole('link',{name:'Timeline both',exact:true})
    assert.match(await page.locator('.hp-timeline-row').filter({has:opener}).ariaSnapshot(),/来源目标日：2026-11-11.*所属迭代：Timeline sprint · 2026-11-09 → 2026-11-15/s)
    for(let i=0;i<80&&!(await opener.evaluate(el=>el===document.activeElement));i++)await page.keyboard.press('Tab')
    assert.equal(await opener.evaluate(el=>el===document.activeElement),true)
    await page.keyboard.press('Enter'); assert.equal(await page.getByRole('dialog').count(),1)
    await page.keyboard.press('Escape'); assert.equal(await opener.evaluate(el=>el===document.activeElement),true)
    await page.getByRole('searchbox').fill('Timeline far')
    assert.equal(await page.locator('.hp-timeline-row').count(),1)
    const hit=await page.locator('.hp-timeline-row').evaluate(row=>{
      const link=row.querySelector('a').getBoundingClientRect(),button=row.querySelector('button').getBoundingClientRect()
      return {link:link.height,button:button.height,overlap:link.left<button.right&&link.right>button.left&&link.top<button.bottom&&link.bottom>button.top}
    })
    assert.ok(hit.link>=44&&hit.button>=44&&!hit.overlap,JSON.stringify(hit))
    await page.getByRole('button',{name:'定位日期',exact:true}).click()
    assert.match(await page.locator('.hp-timeline-window').innerText(),/9999-12-27/)
    assert.equal(await page.getByRole('button',{name:'后一周'}).isDisabled(),true)
    assert.ok((await geometry(page)).nodes<100)
    await page.getByRole('searchbox').fill('Timeline both')
    assert.match(await page.locator('.hp-timeline-window').innerText(),/9999-12-27/,'filtering an authorized origin out does not withdraw the window')
    await page.getByRole('searchbox').fill('Timeline far')
    await page.getByRole('button',{name:'工作项',exact:true}).click(); await timeline(page)
    assert.match(await page.locator('.hp-timeline-window').innerText(),/9999-12-27/,'ordinary view return retains the located week')
    await page.getByRole('searchbox').fill('Timeline early')
    await page.getByRole('button',{name:'定位日期',exact:true}).click()
    assert.match(await page.locator('.hp-timeline-window').innerText(),/0001-01-01/)
    assert.equal(await page.getByRole('button',{name:'前一周'}).isDisabled(),true)
    await page.getByRole('button',{name:'本周'}).click()
    await page.getByRole('button',{name:'工作项',exact:true}).click(); assert.equal(await page.getByRole('searchbox').inputValue(),'Timeline early')
    await timeline(page); await page.getByRole('searchbox').fill('')
    await page.clock.runFor(60000)
    assert.equal(await page.locator('.hp-timeline-calendar').isVisible(),true)
    assert.match(await page.locator('.hp-timeline-calendar').innerText(),/今天 2026-11-11.*Asia\/Singapore/)
    await page.locator('.hp-timeline-calendar').click()
    await page.locator('.hp-timeline-guide p').waitFor()
    await page.locator('.hp-timeline-calendar').click()
    const local=await control(server,'inspect'); assert.deepEqual(local.calls,before.calls); assert.deepEqual(local.external,before.external)
    await capture(page,'composed-source-1440-light')
    await control(server,'disconnect',true)
    await page.getByText(/与宿主的连接已中断/).first().waitFor()
    assert.equal(await page.locator('.hp-timeline-marker').count(),20)
    await capture(page,'composed-authorized-offline')
    await control(server,'disconnect',false)
    await page.waitForFunction(()=>!document.body.innerText.includes('连接已中断'))
    await page.getByRole('searchbox').fill('Timeline far')
    await page.getByRole('button',{name:'定位日期',exact:true}).click()
    const nativeFar=server.byDomain.planning.state.items.find(item=>item.content.workItem?.title==='Timeline far'), farContent=nativeFar.content
    nativeFar.content={kind:'redacted',reason:'unavailable'}
    await page.getByRole('button',{name:'刷新规划',exact:true}).click()
    await page.waitForFunction(()=>!document.body.innerText.includes('Timeline far'))
    await page.getByRole('searchbox').fill('')
    assert.match(await page.locator('.hp-timeline-window').innerText(),/2026-11-09/,'withdrawing the located item clears its derived header while other rows stay readable')
    nativeFar.content=farContent
    await page.getByRole('button',{name:'刷新规划',exact:true}).click()
    await page.getByRole('link',{name:'Timeline far',exact:true}).waitFor()
    await page.getByRole('searchbox').fill('Timeline far')
    await page.getByRole('button',{name:'定位日期',exact:true}).click()
    await control(server,'hold',{domain:'watch',method:'baseline',enabled:true})
    await control(server,'disconnect',true); await control(server,'disconnect',false)
    await page.waitForFunction(async()=>(await window.fixture.command('inspect')).held>0)
    await control(server,'hold',{domain:'watch',method:'baseline',enabled:false})
    await control(server,'permission',{domain:'planning',key:'planning.item.read',enabled:false})
    await page.evaluate(()=>window.fixture.remote.bootstrapWorkspace({kind:'user'},'timeline-denial'))
    await page.waitForFunction(()=>!document.querySelector('.hp-timeline')&&!document.body.innerText.includes('Timeline far'))
    await control(server,'release')
    await page.waitForFunction(async()=>(await window.fixture.command('inspect')).held===0)
    assert.doesNotMatch(await page.locator('body').innerHTML(),/Timeline both|Timeline sprint|9999-12-31|hp-timeline-marker/)
    assert.doesNotMatch(await page.locator('body').ariaSnapshot(),/Timeline both|Timeline sprint|显示 28 项|共 28 项/)
    const after=await control(server,'inspect'); assert.deepEqual(after.external,before.external)
    assert.deepEqual(Object.entries(after.calls).filter(([key])=>key.startsWith('write:')),[])
    await capture(page,'composed-denied')
  })
})

test('Timeline aligns v3 reference geometry and falls back to complete dates in narrow containers and 200 percent text', {timeout:60000}, async t=>{
  await scenario(t,startTableGeometryServer,async(page,server)=>{
    const evidence=[]
    for(const width of [1440,1024,390]) for(const dark of [false,true]) for(const zoom of [false,true]) {
      await page.setViewportSize({width,height:900})
      await page.goto(server.url+'/?header&reference'+(dark?'&dark':'')+(zoom?'&zoom':''))
      await timeline(page)
      await page.getByRole('link',{name:'呈现真实规划数据的只读看板',exact:true}).waitFor()
      assert.equal(await page.locator('.hp-timeline-row').count(),7)
      assert.equal(await page.locator('.hp-timeline-calendar').isVisible(),true,'calendar remains visible at every viewport/text size')
      assert.match(await page.locator('.hp-timeline-calendar').innerText(),/Asia\/Singapore/)
      const measured=await geometry(page)
      if(width===1440&&!zoom) {
        assert.ok(measured.rowBounds[0].top<=284,'first row permits one 44px navigation row beyond v3 '+JSON.stringify(measured.rowBounds))
        assert.ok(measured.rowBounds.every(row=>row.height>=68&&row.height<=80),'ordinary short source rows retain v3 density '+JSON.stringify(measured.rowBounds))
      }
      assert.ok(measured.page<=width+1&&!measured.textOverflow&&!measured.rowOverflow,JSON.stringify({width,dark,zoom,measured}))
      if(measured.graph!=='none')assert.ok(measured.markers.every(marker=>marker.inside&&marker.offset<1),JSON.stringify(measured))
      else assert.match(await page.locator('.hp-timeline-source').first().innerText(),/2026-11-13/)
      assert.equal(await page.getByRole('checkbox').count(),0)
      assert.equal(await page.getByRole('button',{name:'重置列宽'}).count(),0)
      await page.getByRole('searchbox').fill('604')
      assert.equal(await page.locator('.hp-timeline-row').count(),1)
      await page.getByRole('button',{name:'工作项',exact:true}).click()
      assert.equal(await page.getByRole('searchbox').inputValue(),'604')
      await timeline(page); await page.getByRole('searchbox').fill('')
      await page.getByRole('heading',{name:'工作项',exact:true}).click()
      await capture(page,'reference-source-'+width+'-'+(dark?'dark':'light')+'-'+(zoom?'200':'100'))
      if(zoom&&width<1440) {
        await page.locator('.hp-timeline-row').first().scrollIntoViewIfNeeded()
        await capture(page,'reference-content-'+width+'-'+(dark?'dark':'light')+'-200')
      }
      evidence.push({width,dark,zoom,measured})
    }
    await page.setViewportSize({width:1440,height:900}); await page.goto(server.url+'/?app&reference')
    await page.getByText('显示选项',{exact:true}).click()
    await page.getByRole('checkbox',{name:'来源',exact:true}).check()
    const titleWidth=()=>page.getByRole('columnheader').first().evaluate(el=>el.getBoundingClientRect().width)
    const original=await titleWidth()
    await page.getByRole('slider',{name:'调整工作项列宽',exact:true}).press('ArrowRight')
    const resized=await titleWidth(); assert.ok(resized>original)
    await page.getByRole('searchbox').fill('604'); await timeline(page)
    await page.getByRole('button',{name:'清除条件',exact:true}).click()
    await page.getByRole('button',{name:'工作项',exact:true}).click()
    assert.equal(await page.getByRole('checkbox',{name:'来源',exact:true}).isChecked(),true)
    assert.equal(await titleWidth(),resized)
    await timeline(page)
    await page.getByRole('searchbox').fill('no match')
    assert.equal(await page.locator('.hp-timeline').count(),0)
    await page.getByRole('searchbox').fill('604')
    await page.getByRole('button',{name:'前一周',exact:true}).click()
    await page.getByRole('button',{name:'定位日期',exact:true}).click()
    await page.evaluate(()=>window.queryFixture.scope('changed','changed-binding'))
    assert.equal(await page.getByRole('searchbox').inputValue(),'')
    await page.evaluate(()=>window.queryFixture.empty())
    await page.getByText('当前快照没有工作项',{exact:true}).waitFor()
    assert.equal(await page.locator('.hp-timeline').count(),0)
    await page.evaluate(()=>window.queryFixture.restore()); await page.evaluate(()=>window.queryFixture.partial())
    assert.match(await page.locator('.hp-work-items').innerText(),/部分条目尚未确认/)
    await page.evaluate(()=>window.queryFixture.unknown())
    await page.getByText(/工作项读取能力尚未确认|尚未确认读取工作项的能力/).waitFor()
    assert.equal(await page.locator('.hp-timeline').count(),0)
    assert.doesNotMatch(await page.locator('body').ariaSnapshot(),/2026-11-13|呈现真实规划数据/)
    await page.evaluate(()=>window.headerFixture.state({capabilities:[{key:'planning.item.read',access:'read_only'}]}))
    await page.getByRole('link',{name:'呈现真实规划数据的只读看板',exact:true}).waitFor()
    assert.match(await page.locator('.hp-timeline-window').innerText(),/2026-11-09/,'restoring the read gate uses the current safe week')
    if(output)await writeFile(output+'/reference-geometry.json',JSON.stringify(evidence,null,2))
  })
})

test('native source Timeline remains readable and bounded in Host themes at desktop, narrow and enlarged text sizes', {timeout:60000}, async t=>{
  await scenario(t,()=>startExecutionServer({seed:'timeline'}),async(page,server)=>{
    const evidence=[]
    for(const width of [1440,1024,390])for(const dark of [false,true])for(const zoom of [false,true]){
      await page.setViewportSize({width,height:900})
      await page.goto(server.url+'/?roles&theme='+(dark?'dark':'light')+(zoom?'&font=200':''))
      await page.getByRole('link',{name:'Timeline both',exact:true}).waitFor(); await timeline(page)
      const measured=await geometry(page)
      if(measured.graph==='none')assert.equal(await page.getByRole('button',{name:'定位日期',exact:true}).count(),0,'text fallback has no action that only changes hidden geometry')
      assert.ok(measured.rows>20&&measured.nodes<700&&measured.page<=width+1&&!measured.textOverflow&&!measured.rowOverflow,JSON.stringify({width,dark,zoom,measured}))
      assert.equal(await page.locator('.hp-timeline-row a').evaluateAll(nodes=>nodes.every(el=>el.scrollHeight<=el.clientHeight+1)),true)
      await page.getByRole('searchbox').fill('Timeline both')
      await page.getByRole('heading',{name:'工作项',exact:true}).click()
      await capture(page,'composed-source-'+width+'-'+(dark?'dark':'light')+'-'+(zoom?'200':'100'))
      if(zoom||width===390){
        await page.locator('.hp-timeline-row').first().scrollIntoViewIfNeeded()
        await capture(page,'composed-content-'+width+'-'+(dark?'dark':'light')+'-'+(zoom?'200':'100'))
      }
      const row=page.locator('.hp-timeline-row').first()
      assert.match(await row.innerText(),/来源目标日：2026-11-11.*所属迭代：Timeline sprint · 2026-11-09 → 2026-11-15/s)
      evidence.push({width,dark,zoom,measured})
    }
    if(output)await writeFile(output+'/composed-geometry.json',JSON.stringify(evidence,null,2))
  })
})
