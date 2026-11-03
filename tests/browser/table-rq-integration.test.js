import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {chromium} from 'playwright'
import {startTableGeometryServer} from '../fixtures/table-geometry-browser.mjs'
const handle=p=>p.getByRole('slider',{name:'调整规划状态列宽',exact:true})
const width=p=>handle(p).evaluate(el=>el.parentElement.getBoundingClientRect().width)
async function drag(p,delta){const r=await handle(p).boundingBox();await p.mouse.move(r.x+r.width/2,r.y+r.height/2);await p.mouse.down();await p.mouse.move(r.x+r.width/2+delta,r.y+r.height/2,{steps:3})}
test('R and Q compose independent reset/scope and active-handle visibility cleanup',async()=>{
 const s=await startTableGeometryServer(),b=await chromium.launch(),p=await b.newPage({viewport:{width:1440,height:900}})
 try{await p.goto(s.url);await handle(p).waitFor();await p.getByRole('button',{name:'按规划状态排序',exact:true}).click()
  await drag(p,40);await p.mouse.up();assert.equal(await width(p),184);assert.equal(await p.getByRole('combobox',{name:'排序',exact:true}).inputValue(),'planningStatus:asc');assert.equal(await p.getByRole('dialog').count(),0)
  await p.getByRole('button',{name:'重置列宽',exact:true}).click();assert.equal(await width(p),144);assert.equal(await p.getByRole('combobox',{name:'排序',exact:true}).inputValue(),'planningStatus:asc')
  await handle(p).focus();await p.keyboard.press('End');await p.getByRole('button',{name:'清除条件并恢复默认显示列',exact:true}).click();assert.equal(await width(p),320);assert.equal(await p.getByRole('combobox',{name:'排序',exact:true}).inputValue(),'')
  await p.getByText('选择显示列',{exact:true}).click();await handle(p).focus();await p.keyboard.press('Home');await drag(p,20)
  await p.getByRole('checkbox',{name:'规划状态',exact:true}).evaluate(el=>el.click());await p.mouse.up();assert.equal(await p.locator('.hp-resizing').count(),0);assert.equal(await handle(p).count(),0)
  await p.getByRole('checkbox',{name:'规划状态',exact:true}).check();assert.equal(await width(p),132)
  await p.getByRole('searchbox').fill('Work item 3');await p.evaluate(()=>window.queryFixture.scope('other-workspace','other-binding'));assert.equal(await p.getByRole('searchbox').inputValue(),'');assert.equal(await width(p),144);assert.equal(await p.getByRole('columnheader').count(),5)
 }finally{await b.close();await s.close()}
})
test('actual sort buttons and resize handles stay independent in 20 Host width/theme/text combinations',async()=>{
 const s=await startTableGeometryServer(),b=await chromium.launch(),p=await b.newPage()
 try{for(const w of [320,640,1024,1200,1440])for(const zoom of [false,true])for(const dark of [false,true]){
  await p.setViewportSize({width:w,height:480});await p.goto(s.url+'/?'+(zoom?'zoom&':'')+(dark?'dark':''));await handle(p).waitFor();await p.getByRole('button',{name:'按规划状态排序',exact:true}).focus();await p.keyboard.press('Enter')
  await handle(p).focus();await p.keyboard.press('ArrowRight');await drag(p,16);await p.mouse.up();assert.equal(await width(p),168);assert.equal(await p.getByRole('combobox',{name:'排序',exact:true}).inputValue(),'planningStatus:asc');assert.equal(await p.getByRole('dialog').count(),0)
  await p.getByRole('button',{name:'按工作项排序',exact:true}).focus();await p.keyboard.press('Enter');assert.equal(await width(p),168);assert.equal(await p.locator('.hp-resizing').count(),0)
 }}finally{await b.close();await s.close()}
})
