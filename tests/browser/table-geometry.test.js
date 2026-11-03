import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { startTableGeometryServer } from '../fixtures/table-geometry-browser.mjs'

// 删除局部高度、sticky 或标题窄宽夹紧，都会破坏这些实际 DOM 断言。
async function allColumns(page) {
  if (!await page.locator('.hp-table-controls').count()) return
  const menu=page.getByText('选择显示列',{exact:true});await menu.click()
  for (const name of ['内容身份','来源','新鲜度']) await page.getByRole('checkbox',{name,exact:true}).check()
  await menu.click()
}
async function measure(page) {
  return page.evaluate(() => {
    const surface=document.querySelector('.hp-list-scroll'), box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,right:r.right}}
    const header=[...document.querySelectorAll('thead th')], cells=[...document.querySelector('tbody tr').children]
    return {surface:box(surface),clientWidth:surface.clientWidth,clientHeight:surface.clientHeight,scrollWidth:surface.scrollWidth,scrollHeight:surface.scrollHeight,
      top:surface.scrollTop,left:surface.scrollLeft,header:header.map(box),cells:cells.map(box),
      overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,
      body:document.body.innerText,html:document.querySelector('tbody').innerHTML}
  })
}
async function withPage(t, run, classicScrollbars=false) {
  const server=await startTableGeometryServer();t.after(()=>server.close())
  const browser=await chromium.launch(classicScrollbars?{ignoreDefaultArgs:['--hide-scrollbars'],args:['--disable-features=OverlayScrollbar,OverlayScrollbars']}:{});t.after(()=>browser.close())
  const page=await browser.newPage({hasTouch:true});page.setDefaultTimeout(6000)
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',route=>new URL(route.request().url()).origin===server.url?route.continue():route.abort())
  await run(page,server.url)
  assert.deepEqual(errors,[])
}
test('bounded XY surface freezes header/title with shared column geometry across narrow/short/text/theme matrix', async t => {
  await withPage(t,async(page,url)=>{
    const evidence=[]
    for(const width of [320,640,1024,1200,1440]) for(const zoom of [false,true]) for(const dark of [false,true]) for(const height of [320,480,720]) {
      await page.setViewportSize({width,height})
      await page.goto(url+'/?'+(zoom?'zoom&':'')+(dark?'dark':''));await page.locator('tbody tr').last().waitFor();await allColumns(page)
      await page.locator('[data-workspace-setup]').evaluate(el=>{el.scrollTop=el.scrollHeight})
      const before=await measure(page), context=JSON.stringify({width,height,zoom,dark})
      assert.ok(before.surface.y>=0&&before.surface.bottom<=height+1,context+' scroll surface fits actual slot')
      assert.equal(before.overflow,false,context+' page X overflow')
      assert.ok(before.scrollHeight>before.clientHeight+100,context+' table must own bounded Y scroll')
      assert.ok(before.scrollWidth>before.clientWidth+1,context+' table must own X scroll')
      assert.ok(before.cells[0].w<=before.clientWidth-96,context+' frozen title preserves other columns')
      assert.ok(before.cells[0].w>=Math.min(160,before.clientWidth-112)-1,context+' title remains readable')
      before.header.forEach((h,i)=>assert.ok(Math.abs(h.x-before.cells[i].x)<=1&&Math.abs(h.w-before.cells[i].w)<=1,context+' header/body column '+i))
      assert.doesNotMatch(before.html,/CANARY-|2099-12-31/)
      assert.match(before.body,/SourceWithoutSpacesSourceWithoutSpaces/);assert.match(before.body,/IterationWithoutSpacesIterationWithoutSpaces/)
      assert.match(before.body,/Issue/);assert.match(before.body,/PR/);assert.match(before.body,/2026-11-03/)
      await page.locator('.hp-list-scroll').evaluate(el=>{el.scrollTop=400;el.scrollLeft=400})
      const after=await measure(page)
      assert.ok(after.top>0&&after.left>0,context+' actual scroll offsets')
      assert.ok(Math.abs(after.header[0].x-before.header[0].x)<=1,context+' corner X')
      assert.ok(Math.abs(after.cells[0].x-before.cells[0].x)<=1,context+' title X')
      assert.ok(Math.abs(after.header[0].y-(after.surface.y+1))<=1,context+' header Y')
      assert.ok(Math.abs(before.cells[1].x-after.cells[1].x-after.left)<=1,context+' body really moved')
      const layers=await page.evaluate(()=>{
        const s=document.querySelector('.hp-list-scroll').getBoundingClientRect(), h=document.querySelector('thead th').getBoundingClientRect()
        return [document.elementFromPoint(s.x+8,s.y+8)?.closest('th')?.scope,document.elementFromPoint(s.x+8,h.bottom+8)?.closest('th')?.scope]
      })
      assert.deepEqual(layers,['col','row'],context+' fixed layers remain above scrolling cells')
      assert.equal(await page.locator('td').evaluateAll(cells=>cells.some(c=>c.scrollWidth>c.clientWidth+1)),false,context+' long facts wrap inside their own cells')
      const last=page.locator('tbody').getByRole('link').last();await last.focus()
      const focus=await last.evaluate(el=>{const a=el.getBoundingClientRect(),s=el.closest('.hp-list-scroll').getBoundingClientRect(),h=document.querySelector('thead th').getBoundingClientRect();return {top:a.top,bottom:a.bottom,sBottom:s.bottom,hBottom:h.bottom}})
      assert.ok(focus.top>=focus.hBottom-1&&focus.bottom<=focus.sBottom+1,context+' focused title not hidden behind sticky header')
      const {body:beforeBody,html:beforeHtml,...beforeGeometry}=before, {body:afterBody,html:afterHtml,...afterGeometry}=after
      evidence.push({width,height,zoom,dark,before:beforeGeometry,after:afterGeometry,focus})
      if(process.env.TABLE_GEOMETRY_EVIDENCE_OUT&&width===320&&height===480&&dark) {
        await mkdir(process.env.TABLE_GEOMETRY_EVIDENCE_OUT,{recursive:true})
        await page.screenshot({path:process.env.TABLE_GEOMETRY_EVIDENCE_OUT+'/narrow-'+(zoom?'200':'100')+'.png'})
      }
    }
    if(process.env.TABLE_GEOMETRY_EVIDENCE_OUT) await writeFile(process.env.TABLE_GEOMETRY_EVIDENCE_OUT+'/matrix.json',JSON.stringify(evidence,null,2))
  })
})
test('classic scrollbar gutter preserves narrow context and final title focus at native and 200% text', async t => {
  await withPage(t,async(page,url)=>{
    await page.setViewportSize({width:320,height:320})
    for(const zoom of [false,true]) for(const dark of [false,true]) {
      await page.goto(url+'/?'+(zoom?'zoom&':'')+(dark?'dark':''));await page.locator('tbody tr').last().waitFor();await allColumns(page)
      await page.addStyleTag({content:'::-webkit-scrollbar {width:16px;height:16px}'})
      await page.locator('[data-workspace-setup]').evaluate(el=>{el.scrollTop=el.scrollHeight})
      await page.locator('.hp-list-scroll').evaluate(el=>{el.scrollTop=400;el.scrollLeft=400})
      await page.locator('tbody').getByRole('link').last().focus()
      const focus=await page.evaluate(()=>{
        const s=document.querySelector('.hp-list-scroll'),box=s.getBoundingClientRect(),a=document.activeElement.getBoundingClientRect(),h=document.querySelector('thead th').getBoundingClientRect(),titleWidth=document.querySelector('tbody th').getBoundingClientRect().width
        return {top:a.top,bottom:a.bottom,headerBottom:h.bottom,surfaceTop:box.top,surfaceBottom:box.bottom,clientBottom:box.top+s.clientTop+s.clientHeight,gutter:s.offsetHeight-s.clientHeight,inlineGutter:s.offsetWidth-s.clientWidth,clientWidth:s.clientWidth,titleWidth,context:s.clientWidth-titleWidth}
      })
      assert.ok(focus.gutter>=16&&focus.inlineGutter>=16,'regression must allocate real classic scrollbar gutters in both axes')
      assert.ok(focus.context>=96,JSON.stringify(focus)+' classic gutter retains 96px of other-column context after focus')
      assert.ok(focus.surfaceTop>=0&&focus.surfaceBottom<=320,'local scroll owner remains reachable in short Host')
      assert.ok(focus.top>=focus.headerBottom-1&&focus.bottom<=focus.clientBottom+1,JSON.stringify(focus)+' focused title stays in usable content viewport')
    }
  },true)
})
test('full title remains available through focus, navigation and standalone touch disclosure', async t => {
  await withPage(t,async(page,url)=>{
    await page.setViewportSize({width:320,height:640});await page.goto(url);await page.locator('tbody tr').last().waitFor();await allColumns(page)
    const link=page.locator('tbody tr').first().getByRole('link'), name=await link.textContent()
    assert.ok(name.length>250);assert.match(await link.getAttribute('href'),/items\/item-0$/)
    await link.focus()
    assert.equal(await link.evaluate(el=>el.scrollHeight<=el.clientHeight+1),true,'focus exposes full title')
    await link.click();assert.equal(await page.getByRole('dialog').getByRole('heading',{name,exact:true}).count(),1)
    await page.keyboard.press('Escape');assert.equal(await link.evaluate(el=>el===document.activeElement),true)
    await page.goto(url+'/?standalone');await page.locator('tbody tr').last().waitFor();await allColumns(page)
    const summary=page.locator('tbody tr').first().locator('summary');await summary.tap()
    assert.equal(await summary.evaluate(el=>el.parentElement.open),true,'native disclosure opens by click/touch')
    assert.equal(await page.getByRole('columnheader').count(),8)
    assert.equal(await page.locator('caption').textContent(),'工作项列表')
  })
})

test('negative controls expose unbounded surface, lost frozen header and title consuming the narrow context', async t => {
  await withPage(t,async(page,url)=>{
    await page.setViewportSize({width:320,height:640})
    const open=async()=>{await page.goto(url);await page.locator('tbody tr').last().waitFor();await allColumns(page)}
    await open()
    await page.addStyleTag({content:'.hp-work-items .hp-list-scroll {flex:none!important;block-size:auto!important;max-block-size:none!important}'})
    const unbounded=await measure(page)
    assert.equal(unbounded.scrollHeight,unbounded.clientHeight,'removing bound loses real Y scroll')
    await open()
    await page.addStyleTag({content:'.hp-work-items thead th {position:static!important}'})
    await page.locator('.hp-list-scroll').evaluate(el=>{el.scrollTop=400})
    const unfrozen=await measure(page)
    assert.ok(unfrozen.header[0].y<unfrozen.surface.y-100,'lost sticky is visible in browser coordinates')
    await open()
    await page.addStyleTag({content:'.hp-work-items .hp-list-scroll {--hp-title-width:320px!important}'})
    const swallowed=await measure(page)
    assert.ok(swallowed.cells[0].w>swallowed.clientWidth-96,'removed title clamp consumes context')
    await open()
    const surface=page.locator('.hp-list-scroll');await surface.focus();await page.keyboard.press('ArrowDown')
    await page.waitForFunction(()=>document.querySelector('.hp-list-scroll').scrollTop>0)
    assert.ok((await measure(page)).top>0,'keyboard scroll reaches actual local Y owner')
  })
})
