/** Browser parser 的 VM 边界：同一 React runtime；只模拟实体解码器实际使用的 detached <i> DOM 面。 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
const { build } = createRequire(new URL('../../apps/harness-plugin/package.json', import.meta.url))('esbuild')
const uiRequire = createRequire(new URL('../../packages/ui/package.json', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
let decoderRequire = createRequire(uiRequire.resolve('react-markdown'))
for (const name of ['remark-parse', 'mdast-util-from-markdown']) decoderRequire = createRequire(decoderRequire.resolve(name))
const { decodeNamedCharacterReference } = await import(pathToFileURL(decoderRequire.resolve('decode-named-character-reference')).href)
export const markdownDocument = { createElement(tag) {
  assert.equal(tag, 'i', 'VM DOM only supports the parser entity decoder')
  return { set innerHTML(value) { assert.match(value, /^&[^;]+;$/); this.textContent = decodeNamedCharacterReference(value.slice(1, -1)) || value }, textContent: '' }
} }
export const markdownRequire = id => {
  assert.ok(['react', 'react/jsx-runtime'].includes(id), `unexpected require: ${id}`)
  return uiRequire(id)
}

/** 独立依赖根的精确可达图；不放行任意 node_modules 或新增工作区层。 */
export async function markdownDependencyInputs() {
  const result = await build({ stdin: { contents: "export {default as Markdown} from 'react-markdown'; export {default as gfm} from 'remark-gfm'", resolveDir: fileURLToPath(new URL('../../packages/ui', import.meta.url)) },
    absWorkingDir: repoRoot, bundle: true, platform: 'browser', format: 'cjs', external: ['react'], write: false, metafile: true })
  return new Set(Object.keys(result.metafile.inputs).filter(file => file.startsWith('node_modules/')))
}

/** 浏览器 fixture 使用官方 JSX runtime，React 仍从页面唯一 UMD 获取。 */
export async function jsxRuntimeScript() {
  const result = await build({ entryPoints: [uiRequire.resolve('react/jsx-runtime')], bundle: true, platform: 'browser', format: 'cjs', external: ['react'], write: false })
  return `(function(){const module={exports:{}};const exports=module.exports;const require=id=>{if(id==='react')return window.React;throw Error(id)};${result.outputFiles[0].text}\nwindow.ReactJSX=module.exports;})()`
}
