import '../fixtures/resolution-preflight.mjs';

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { test } from 'node:test'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const { build } = createRequire(path.join(repoRoot, 'apps/harness-plugin/package.json'))('esbuild')
const fixture = path.join(repoRoot, 'tests/fixtures/client-browser.mjs')

async function bundle() {
  return build({
    stdin: { contents: `import { drive } from './tests/fixtures/client-browser.mjs'
export { drive }`, resolveDir: repoRoot, loader: 'js' },
    absWorkingDir: repoRoot,
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    write: false,
    metafile: true,
    external: [],
    logLevel: 'silent',
  })
}

test('真实 client factory 入口：浏览器构建触达并可执行 store/sync/transport', async () => {
  const result = await bundle()
  const output = Object.values(result.metafile.outputs)[0]
  const inputs = Object.keys(result.metafile.inputs).filter((file) => file !== '<stdin>')
  const externals = output.imports.filter((entry) => entry.external).map((entry) => entry.path)
  assert.deepEqual(externals, [])
  assert.ok(inputs.some((file) => file.endsWith('packages/client/src/store.ts')))
  assert.ok(inputs.some((file) => file.endsWith('packages/client/src/sync.ts')))
  assert.ok(inputs.some((file) => file.endsWith('packages/client/src/transport.ts')))
  assert.ok(inputs.some((file) => file.endsWith('packages/client/src/workspace-read.ts')))
  assert.ok(inputs.some((file) => file.endsWith('packages/client/src/stream.ts')))
  assert.ok(inputs.some((file) => file.endsWith('packages/controller/src/values.ts')))
  assert.ok(!inputs.some((file) => /packages\/(core|storage|providers)\//.test(file)))
  assert.ok(!inputs.some((file) => /packages\/controller\/src\/(index|wire|commands|queries|watch)\.ts/.test(file)))
  assert.ok(!inputs.some((file) => /packages\/(domain\/src\/(ids|identity|relations)|capabilities\/src\/observation)\.ts/.test(file)))

  const sandbox = { module: { exports: {} } }
  vm.runInNewContext(result.outputFiles[0].text, sandbox)
  const report = await sandbox.module.exports.drive()
  assert.deepEqual(JSON.parse(JSON.stringify(report)), {
    first: 'baseline',
    second: 'delta',
    third: 'gap',
    fourth: 'baseline',
    gapCurrent: false,
    disconnectedCurrent: false,
    disconnectedConnected: false,
    connected: true,
    revision: 3,
    title: 'recovered',
    current: true,
    workspace: 'Browser workspace',
  })
})

test('负控：controller 根入口不是 browser client 依赖', async () => {
  await assert.rejects(
    build({
      stdin: { contents: `import { createController } from '@harness-projects/controller'
export { createController }`, resolveDir: repoRoot, loader: 'js' },
      absWorkingDir: repoRoot,
      bundle: true,
      platform: 'browser',
      format: 'cjs',
      write: false,
      metafile: true,
      external: [],
      logLevel: 'silent',
    }),
    /node:crypto|node:util/,
  )
})
