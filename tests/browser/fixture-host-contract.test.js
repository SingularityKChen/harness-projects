import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {chromium} from 'playwright'
import {startTableGeometryServer} from '../fixtures/table-geometry-browser.mjs'
import {startWorkspaceFrameServer} from '../fixtures/workspace-frame-browser.mjs'

async function scene(start,run){const server=await start(),browser=await chromium.launch();try{const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));await run(page,server.url);assert.deepEqual(errors,[])}finally{await browser.close();await server.close()}}
// The parser composition imports this official module; returning only React or bundling a second React fails.
test('table fixture binds official JSX runtime to its single React UMD and rejects unknown modules',async()=>{
 await scene(startTableGeometryServer,async(page,url)=>{
  await page.goto(url);await page.locator('tbody tr').last().waitFor()
  const result=await page.evaluate(()=>{
   const runtime=window.require('react/jsx-runtime'),owner=React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,previous=owner.current,marker={}
   let shared;try{owner.current=marker;shared=runtime.jsx('span',{})._owner===marker}finally{owner.current=previous}
   let rejected=false;try{window.require('fixture/not-declared')}catch{rejected=true}
   const target=document.createElement('div');target.dataset.runtimeProbe='true';document.body.append(target)
   function Probe(){const [value]=React.useState('official-runtime-hook');return runtime.jsx('output',{children:value})}
   ReactDOM.createRoot(target).render(runtime.jsx(Probe,{}))
   return {shared,rejected}
  })
  assert.deepEqual(result,{shared:true,rejected:true});await page.locator('[data-runtime-probe] output').waitFor();assert.equal(await page.locator('[data-runtime-probe] output').textContent(),'official-runtime-hook')
 })
})
// Restoring an unbounded fixture slot must reproduce the collapsed Project root; production rules stay intact.
test('workspace frame supplies an actual bounded Host slot for the unchanged reflow probe',async()=>{
 await scene(startWorkspaceFrameServer,async(page,url)=>{
  for(const [width,height,font] of [[1440,900,100],[640,320,200],[320,480,200]]){
   await page.setViewportSize({width,height});await page.goto(url+'/?scenario=long&detail=1&font='+font)
   await page.getByRole('dialog').waitFor();const report=await page.evaluate(()=>module.exports.measureDetailReflow())
   assert.ok(report.root.height>100,'Host slot must not collapse the production flex root');assert.deepEqual(report.failures,[])
  }
  await page.addStyleTag({content:'#app{height:auto!important}'})
  await page.waitForFunction(()=>module.exports.measureDetailReflow().failures.length>0)
  const collapsed=await page.evaluate(()=>module.exports.measureDetailReflow())
  assert.ok(collapsed.root.height<100,'removing slot height collapses the measured root');assert.ok(collapsed.failures.length>0,'the unchanged probe rejects the collapsed slot')
 })
})
