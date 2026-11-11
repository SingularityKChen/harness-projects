import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { startTableGeometryServer } from '../fixtures/table-geometry-browser.mjs'

async function exposeIdentity(page) {
  if (!await page.locator('.hp-table-controls').count()) return
  const menu=page.getByText('显示选项',{exact:true});await menu.click()
  await page.getByRole('checkbox',{name:'内容身份',exact:true}).check();await menu.click()
  await page.locator('[data-workspace-setup]').evaluate(el=>{el.scrollTop=el.scrollHeight})
}
async function reset(page) { const menu=page.getByText('显示选项',{exact:true});if (!await menu.evaluate(el=>el.parentElement.open)) await menu.click();await page.getByRole('button',{name:'重置列宽',exact:true}).click();await menu.click() }
async function scene(t,run,{width=1440,height=900,query=''}={}) {
  const server=await startTableGeometryServer()
  let browser,closing
  const close=()=>closing??=(async()=>{await browser?.close();await server.close()})()
  t.after(close)
  try {
    browser=await chromium.launch()
    const page=await browser.newPage({viewport:{width,height},hasTouch:true});page.setDefaultTimeout(5000)
    const errors=[];page.on('pageerror',e=>errors.push(e.message))
    await page.route('**/*',route=>new URL(route.request().url()).origin===server.url?route.continue():route.abort())
    await page.goto(server.url+'/?'+query);await page.locator('tbody tr').last().waitFor();await exposeIdentity(page)
    await run(page);assert.deepEqual(errors,[])
  } finally {await close()}
}
const handle=(page,name='内容身份')=>page.getByRole('slider',{name:'调整'+name+'列宽',exact:true})
const width=(page,index=1)=>page.locator('thead th').nth(index).evaluate(el=>el.getBoundingClientRect().width)
async function drag(page,control,delta) {
  const r=await control.boundingBox()
  await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2+delta,r.y+r.height/2,{steps:4})
}
// Removing capture/ID isolation/cancel rollback/propagation guards breaks these real event + geometry assertions.
test('pointer changes actual geometry; cancel, capture loss and unmount have deterministic cleanup without navigation',async t=>{
  await scene(t,async page=>{
    const control=handle(page);await control.waitFor()
    assert.equal(await width(page),104)
    await page.locator('.hp-list-scroll').evaluate(el=>{el.scrollTop=350;el.dataset.identity='original'})
    await page.evaluate(()=>{window.resizeParentClicks=0})
    await drag(page,control,70)
    assert.equal(await width(page),174)
    const capture=await control.evaluate(el=>({active:el.classList.contains('hp-resizing'),captured:el.hasPointerCapture(1)}))
    assert.deepEqual(capture,{active:true,captured:true})
    await control.dispatchEvent('pointermove',{pointerId:88,clientX:2000,isPrimary:true})
    assert.equal(await width(page),174,'wrong pointer cannot change width')
    await control.dispatchEvent('pointercancel',{pointerId:88,isPrimary:true});await control.dispatchEvent('pointerup',{pointerId:88,isPrimary:true})
    assert.equal(await width(page),174,'wrong pointer cannot end active resize')
    await control.dispatchEvent('pointercancel',{pointerId:1,isPrimary:true})
    assert.equal(await width(page),104,'cancel restores drag start')
    await page.mouse.up();assert.equal(await control.evaluate(el=>el.classList.contains('hp-resizing')),false)
    await drag(page,control,90);await control.evaluate(el=>el.releasePointerCapture(1));await page.mouse.move(2,2)
    assert.equal(await width(page),104,'lost capture restores drag start')
    assert.equal(await control.evaluate(el=>el.classList.contains('hp-resizing')),false)
    await page.mouse.up()
    await drag(page,control,40);await page.keyboard.press('Escape');assert.equal(await width(page),104,'Escape rolls back drag');await page.mouse.up()
    await page.evaluate(()=>{window.resizeParentClicks=0})
    await drag(page,control,500);await page.mouse.up()
    assert.equal(await width(page),240,'maximum applies to real colgroup')
    assert.equal(await page.locator('tbody tr').first().locator('td').first().evaluate(el=>el.getBoundingClientRect().width),240)
    assert.equal(await page.locator('.hp-list-scroll').getAttribute('data-identity'),'original','scroll owner is retained')
    assert.equal(await page.locator('.hp-list-scroll').evaluate(el=>el.scrollTop),350,'resize preserves local scroll offset')
    assert.equal(await page.getByRole('dialog').count(),0)
    assert.equal(await page.evaluate(()=>window.resizeParentClicks),0,'resize click is isolated from React action ancestors')
    await control.click();assert.equal(await page.evaluate(()=>window.resizeParentClicks),0)
    await page.locator('.hp-column-label').nth(1).click();assert.equal(await page.evaluate(()=>window.resizeParentClicks),1,'ancestor probe has a positive control')
    await control.dispatchEvent('pointerdown',{pointerId:2,isPrimary:false,button:0,clientX:0});await control.dispatchEvent('pointermove',{pointerId:2,isPrimary:false,clientX:999})
    assert.equal(await width(page),240,'secondary pointer ignored')
    await control.dispatchEvent('pointerdown',{pointerId:3,isPrimary:true,button:2,clientX:0});await control.dispatchEvent('pointermove',{pointerId:3,isPrimary:true,clientX:999})
    assert.equal(await width(page),240,'non-left pointer ignored')
    await drag(page,control,-50);await page.evaluate(()=>window.tableFixture.unmount());await page.mouse.up();await page.evaluate(()=>window.tableFixture.mount());await page.locator('tbody tr').last().waitFor();await exposeIdentity(page)
    await handle(page).waitFor();assert.equal(await width(page),104,'unmount clears active session')
    assert.equal(await page.locator('.hp-resizing').count(),0)
    const fresh=handle(page);await drag(page,fresh,50);await page.getByRole('button',{name:'重置列宽',exact:true,includeHidden:true}).evaluate(el=>el.click());await page.mouse.up()
    assert.equal(await width(page),104);assert.equal(await page.locator('.hp-resizing').count(),0,'reset terminates captured resize')
    await drag(page,handle(page),50);await page.evaluate(()=>window.tableFixture.scope('ws-1','bind-2'));await exposeIdentity(page);await page.mouse.up()
    assert.equal(await width(page),104);assert.equal(await page.locator('.hp-resizing').count(),0,'scope change terminates captured resize')
  })
})
test('keyboard and reset share bounds; same scope refresh preserves widths and workspace/binding change reset them',async t=>{
  await scene(t,async page=>{
    const control=handle(page);await control.waitFor();await control.focus()
    assert.equal(await control.getAttribute('aria-valuemin'),'96');assert.equal(await control.getAttribute('aria-valuemax'),'240')
    await page.keyboard.press('ArrowRight');assert.equal(await width(page),112)
    await page.keyboard.press('Shift+ArrowRight');assert.equal(await width(page),144)
    await page.keyboard.press('Home');assert.equal(await width(page),96)
    await page.keyboard.press('End');assert.equal(await width(page),240);assert.equal(await control.getAttribute('aria-valuenow'),'240')
    await page.keyboard.press('ArrowRight');assert.equal(await width(page),240)
    await page.getByRole('button',{name:'刷新规划',exact:true}).click();assert.equal(await width(page),240,'same workspace refresh retains local width')
    await page.evaluate(()=>window.tableFixture.scope('ws-1','bind-2'));await exposeIdentity(page);await page.waitForFunction(()=>document.querySelector('thead th:nth-child(2)').getBoundingClientRect().width===104)
    await control.focus();await page.keyboard.press('End');await page.evaluate(()=>window.tableFixture.scope('ws-2','bind-2'));await exposeIdentity(page)
    await page.waitForFunction(()=>document.querySelector('thead th:nth-child(2)').getBoundingClientRect().width===104)
    await control.focus();await page.keyboard.press('End')
    await page.evaluate(()=>window.tableFixture.scope('ws-1','bind-1'));await exposeIdentity(page);await page.waitForFunction(()=>document.querySelector('thead th:nth-child(2)').getBoundingClientRect().width===104)
    await control.focus();await page.keyboard.press('End')
    await reset(page);assert.equal(await width(page),104)
    await reset(page);assert.equal(await width(page),104,'reset is idempotent')
  })
})
test('narrow and 200% reset retain dynamic title limit and reachable independent focus targets',async t=>{
  for(const zoom of [false,true]) await scene(t,async page=>{
    await page.locator('[data-workspace-setup]').evaluate(el=>{el.scrollTop=el.scrollHeight})
    const title=handle(page,'工作项');await title.focus();await page.keyboard.press('End')
    const before=await width(page,0),client=await page.locator('.hp-list-scroll').evaluate(el=>el.clientWidth)
    assert.ok(before<=client-96)
    const target=await title.boundingBox();assert.ok(target.width>=24&&target.height>=44)
    await reset(page)
    assert.ok(await width(page,0)<=client-96,'reset restores host clamp')
    await handle(page,'工作项').focus();assert.equal(await handle(page,'工作项').evaluate(el=>el===document.activeElement),true)
    assert.equal(await page.getByRole('dialog').count(),0)
    const identity=handle(page);await identity.focus();await page.keyboard.press('End')
    const focus=await identity.boundingBox(),surface=await page.locator('.hp-list-scroll').boundingBox(),corner=await page.locator('thead th').first().boundingBox()
    assert.ok(focus.x>=corner.x+corner.width-1&&focus.x+focus.width<=surface.x+surface.width+1,'resized keyboard focus remains in visible context window')
  },{width:320,height:480,query:zoom?'zoom&dark':'dark'})
})

test('pointer and keyboard geometry stay usable across Host widths, text zoom and themes',async t=>{
  const records=[]
  for(const viewportWidth of [320,640,1024,1200,1440]) for(const zoom of [false,true]) for(const dark of [false,true]) {
    await scene(t,async page=>{
      await page.locator('[data-workspace-setup]').evaluate(el=>{el.scrollTop=el.scrollHeight})
      const control=handle(page);await control.waitFor()
      await drag(page,control,16);await page.mouse.up();assert.equal(await width(page),120)
      await control.focus();await page.locator('.hp-list-scroll').evaluate(el=>{el.scrollTop=300})
      await page.keyboard.press('End')
      const sample=await control.evaluate(el=>{
        const s=el.closest('.hp-list-scroll'),box=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}}
        return {value:el.getAttribute('aria-valuenow'),focus:box(el),surface:box(s),corner:box(document.querySelector('thead th')),top:s.scrollTop,left:s.scrollLeft,
          header:[...document.querySelectorAll('thead th')].map(box),body:[...document.querySelector('tbody tr').children].map(box),
          overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}
      })
      assert.equal(sample.value,'240');assert.equal(sample.top,300,'keyboard width update preserves Y')
      assert.ok(sample.focus.x>=sample.corner.right-1&&sample.focus.right<=sample.surface.right+1)
      assert.equal(sample.overflow,false)
      sample.header.forEach((h,i)=>assert.ok(Math.abs(h.x-sample.body[i].x)<=1&&Math.abs(h.width-sample.body[i].width)<=1,'resized header/body stay aligned'))
      assert.equal(await page.getByRole('dialog').count(),0)
      records.push({viewportWidth,zoom,dark,...sample})
      if(process.env.TABLE_RESIZE_EVIDENCE_OUT&&viewportWidth===320&&dark) {
        await mkdir(process.env.TABLE_RESIZE_EVIDENCE_OUT,{recursive:true})
        await page.screenshot({path:process.env.TABLE_RESIZE_EVIDENCE_OUT+'/narrow-'+(zoom?'200':'100')+'.png'})
      }
    },{width:viewportWidth,height:480,query:(zoom?'zoom&':'')+(dark?'dark':'')})
  }
  if(process.env.TABLE_RESIZE_EVIDENCE_OUT) await writeFile(process.env.TABLE_RESIZE_EVIDENCE_OUT+'/matrix.json',JSON.stringify(records,null,2))
})

test('one effective width map fills the Host and freezes siblings on first resize, with complete auto rollback', async t => {
  const server=await startTableGeometryServer(),browser=await chromium.launch()
  t.after(()=>server.close())
  t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:1200,height:900}})
  await page.goto(server.url+'/?header&reference')
  await page.locator('tbody tr').last().waitFor()
  const geometry=()=>page.evaluate(()=>({
    client:document.querySelector('.hp-list-scroll').clientWidth,
    table:document.querySelector('table').getBoundingClientRect().width,
    columns:[...document.querySelectorAll('thead th')].map(el=>({
      width:el.getBoundingClientRect().width, right:el.getBoundingClientRect().right,
      aria:Number(el.querySelector('[role=slider]').getAttribute('aria-valuenow')),
    })),
  }))
  for (const viewport of [1200,1440]) {
    await page.setViewportSize({width:viewport,height:900})
    await page.waitForFunction(()=>Math.abs(document.querySelector('table').getBoundingClientRect().width-document.querySelector('.hp-list-scroll').clientWidth)<=1)
    const g=await geometry()
    g.columns.forEach(c=>assert.ok(Math.abs(c.width-c.aria)<=1))
  }
  const control=handle(page,'规划状态'),before=await geometry()
  await drag(page,control,24)
  await page.mouse.up()
  const after=await geometry()
  after.columns.forEach((c,i)=>assert.ok(Math.abs(c.width-before.columns[i].width-(i===1?24:0))<=1))
  assert.ok(Math.abs(after.columns[1].right-before.columns[1].right-24)<=1)
  await page.getByText('显示选项',{exact:true}).click()
  await page.getByRole('button',{name:'重置列宽',exact:true}).click()
  await page.getByText('显示选项',{exact:true}).click()
  await page.setViewportSize({width:1200,height:900})
  await page.waitForFunction(()=>Math.abs(document.querySelector('table').getBoundingClientRect().width-document.querySelector('.hp-list-scroll').clientWidth)<=1)
  const keyBefore=await geometry()
  await control.focus()
  await page.keyboard.press('ArrowRight')
  const keyboard=await geometry()
  keyboard.columns.forEach((c,i)=>assert.ok(Math.abs(c.width-keyBefore.columns[i].width-(i===1?8:0))<=1))
  assert.ok(Math.abs(keyboard.columns[1].right-keyBefore.columns[1].right-8)<=1)
  await page.getByText('显示选项',{exact:true}).click()
  await page.getByRole('button',{name:'重置列宽',exact:true}).click()
  await page.getByText('显示选项',{exact:true}).click()
  await drag(page,control,24)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await page.setViewportSize({width:1440,height:900})
  await page.waitForFunction(()=>Math.abs(document.querySelector('table').getBoundingClientRect().width-document.querySelector('.hp-list-scroll').clientWidth)<=1)
  await page.setViewportSize({width:320,height:480})
  await page.waitForFunction(()=>Number(document.querySelector('thead th [role=slider]').getAttribute('aria-valuemax'))<=document.querySelector('.hp-list-scroll').clientWidth-96)
  const narrow=await geometry(),title=handle(page,'工作项')
  assert.ok(Math.abs(narrow.columns[0].width-Number(await title.getAttribute('aria-valuenow')))<=1)
  assert.ok(Number(await title.getAttribute('aria-valuemax'))<=narrow.client-96)
  await page.setViewportSize({width:1440,height:900})
  await page.waitForFunction(()=>Number(document.querySelector('thead th [role=slider]').getAttribute('aria-valuemax'))===640)
  await title.focus()
  await page.keyboard.press('End')
  await page.setViewportSize({width:320,height:480})
  await page.waitForFunction(()=>Number(document.querySelector('thead th [role=slider]').getAttribute('aria-valuemax'))<320)
  await control.focus()
  await page.keyboard.press('ArrowRight')
  await page.setViewportSize({width:1440,height:900})
  await page.waitForFunction(()=>Math.abs(document.querySelector('thead th').getBoundingClientRect().width-640)<=1)
  const manual=await geometry()
  await drag(page,control,24)
  await control.dispatchEvent('pointercancel',{pointerId:1,isPrimary:true})
  await page.mouse.up()
  const restored=await geometry()
  restored.columns.forEach((c,i)=>assert.ok(Math.abs(c.width-manual.columns[i].width)<=1))
})


test('no-op pointer preserves auto layout and active resize uses current title bounds', async t => {
  await scene(t,async page=>{
    const control=handle(page,'工作项'),box=await control.boundingBox()
    await page.mouse.click(box.x+box.width/2,box.y+box.height/2)
    await page.setViewportSize({width:1440,height:900});await page.waitForFunction(()=>document.querySelector('.hp-list-scroll').clientWidth===1392&&Number(document.querySelector('thead [role=slider]').getAttribute('aria-valuemax'))===640)
    await page.waitForFunction(()=>Math.abs(document.querySelector('table').getBoundingClientRect().width-document.querySelector('.hp-list-scroll').clientWidth)<=1)
    await page.setViewportSize({width:390,height:900});await page.waitForFunction(()=>Number(document.querySelector('thead [role=slider]').getAttribute('aria-valuemax'))<390)
    await drag(page,control,-8)
    await page.setViewportSize({width:1440,height:900});await page.waitForFunction(()=>document.querySelector('.hp-list-scroll').clientWidth===1392&&Number(document.querySelector('thead [role=slider]').getAttribute('aria-valuemax'))===640)
    await page.mouse.move(1000,250);await page.mouse.up()
    assert.equal(await control.getAttribute('aria-valuenow'),'640','live bounds allow the widened title maximum')
  },{width:1200,query:'header&reference'})
})
