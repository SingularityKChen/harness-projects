/**
 * 源码扫描不计构建产物的回归（issue #350、ExecPlan 2026-10-21-scans-skip-build-output）。
 *
 * 保护的不变量：按文档跑过 `pack:plugin` 之后，被忽略的实际 `pack:plugin` 输出目录留在原地，源码扫描仍只看到应扫描的源码。
 * CI 从不在真实树上构建，所以这里在 mkdtemp 里真实构建一次，再用共享 helper 扫描——不碰开发者自己的产物目录。
 * 两个对照让断言有判别力：阳性对照证明产物里确实有调用点模式（否则「扫不到」可能只是构建没产出）；
 * 阴性对照证明去掉输出目录的忽略规则后产物就成为第二个调用点（否则「只剩一处」可能只是模式没命中）。
 */
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { build } from '../../apps/harness-plugin/scripts/build.mjs'
import { callSites, ignoredDirectoryNames } from '../fixtures/source-tree.mjs'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const CALL = /\.putDeliveryFacts\(/
const pluginManifest = JSON.parse(readFileSync(path.join(repoRoot, 'apps/harness-plugin/package.json'), 'utf8'))
const packDirectory = /\bpnpm\s+--dir\s+([^\s]+)\s+pack\b/.exec(pluginManifest.scripts['pack:plugin'])?.[1]
if (packDirectory === undefined || path.posix.basename(packDirectory) !== 'package') {
  throw new Error('Cannot derive pack:plugin output directory from apps/harness-plugin/package.json')
}
const buildOutputDirectory = path.posix.dirname(packDirectory)

test('I1 pack:plugin 配置指向被忽略目录时扫描只报被跟踪写者；移除规则后产物成为第二个调用点', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'source-scan-build-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  copyFileSync(path.join(repoRoot, '.gitignore'), path.join(root, '.gitignore'))
  mkdirSync(path.join(root, 'packages/core/src'), { recursive: true })
  writeFileSync(path.join(root, 'packages/core/src/delivery-facts.ts'), 'tx.putDeliveryFacts(record)\n')
  assert.ok(
    ignoredDirectoryNames(repoRoot).has(path.posix.basename(buildOutputDirectory)),
    `pack:plugin output ${buildOutputDirectory} must be covered by a root .gitignore directory rule`,
  )
  const outDir = path.join(root, 'apps/harness-plugin', buildOutputDirectory)
  await build({ outDir })

  assert.match(readFileSync(path.join(outDir, 'package/lib/index.js'), 'utf8'), CALL, '阳性对照：打包产物里确实带着调用点模式')
  assert.deepEqual(callSites(root, ['packages', 'apps'], CALL), ['core/src/delivery-facts.ts'], '输出目录被忽略：只剩源代码写者')

  writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n')
  assert.deepEqual(
    callSites(root, ['packages', 'apps'], CALL),
    ['core/src/delivery-facts.ts', path.posix.join('harness-plugin', buildOutputDirectory, 'package/lib/index.js')],
    '阴性对照：pack:plugin 的输出目录不再被忽略，产物就是第二个调用点——这正是修复前 delivery-lineage 红的原因',
  )
})
