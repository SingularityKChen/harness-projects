import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { build } from '../../apps/harness-plugin/scripts/build.mjs'
import { compareReports, createReport, inspectBundle } from '../../apps/harness-plugin/scripts/bundle-report.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const graph = (inputs = {}, imports = []) => ({ inputs, outputs: { 'lib/client.js': { imports } } })

describe('plugin bundle evidence', () => {
  let tmp, report, fixture
  before(async () => { tmp = await mkdtemp(path.join(os.tmpdir(), 'bundle-evidence-')) })
  after(async () => { await rm(tmp, { recursive: true, force: true }) })

  async function sourceFixture() {
    if (fixture) return fixture
    await mkdir(path.join(root, '.worktrees'), { recursive: true })
    fixture = await mkdtemp(path.join(root, '.worktrees/bundle-report-test-'))
    execFileSync('git', ['-C', root, 'worktree', 'add', '--detach', fixture, 'HEAD'], { stdio: 'pipe' })
    await mkdir(path.join(fixture, 'node_modules/@harness-projects'), { recursive: true })
    for (const name of await readdir(path.join(root, 'node_modules/@harness-projects'))) {
      const target = await realpath(path.join(root, 'node_modules/@harness-projects', name))
      await symlink(path.join(fixture, path.relative(root, target)), path.join(fixture, 'node_modules/@harness-projects', name))
    }
    await mkdir(path.join(fixture, 'apps/harness-plugin/node_modules'), { recursive: true })
    await symlink(await realpath(path.join(root, 'apps/harness-plugin/node_modules/esbuild')), path.join(fixture, 'apps/harness-plugin/node_modules/esbuild'))
    return fixture
  }
  after(() => { if (fixture) execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', fixture], { stdio: 'pipe' }) })

  async function packMutation(name, body) {
    const file = path.join(tmp, name)
    await writeFile(file, `#!/usr/bin/env node\nconst {execFileSync}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');\nif(process.argv[2]==='--version'){console.log('10.28.2');process.exit(0)}\n${body}\nconst pnpm=fs.realpathSync(execFileSync('which',['pnpm'],{encoding:'utf8'}).trim());\ntry{execFileSync(pnpm,process.argv.slice(2))}catch(e){if(e.code!=='ENOEXEC')throw e;execFileSync(process.execPath,[path.join(path.dirname(pnpm),'bin/pnpm.mjs'),...process.argv.slice(2)])}\n`, { mode: 0o755 })
    return file
  }

  it('rejects dirty-to-clean source restoration during pack and does not publish success', async () => {
    const sourceRoot = await sourceFixture(), client = path.join(sourceRoot, 'apps/harness-plugin/src/client.ts')
    const original = await readFile(client, 'utf8'), outDir = path.join(tmp, 'source-restored')
    try {
      await writeFile(client, `${original}\nconsole.info('REVIEW_428_DIRTY_SOURCE_MARKER')\n`)
      const pnpmBin = await packMutation('restore-source', `fs.writeFileSync(${JSON.stringify(client)},${JSON.stringify(original)});`)
      await assert.rejects(createReport({ sourceRoot, outDir, pnpmBin }), /source changed/)
      assert.match(await readFile(path.join(outDir, 'package/lib/client.js'), 'utf8'), /REVIEW_428_DIRTY_SOURCE_MARKER/)
      await assert.rejects(readFile(path.join(outDir, 'report.json')), { code: 'ENOENT' })
    } finally { await writeFile(client, original) }
  })

  it('rejects HEAD drift even when the source tree remains clean', async () => {
    const sourceRoot = await sourceFixture(), outDir = path.join(tmp, 'head-drift')
    const head = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const tree = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim()
    const changed = execFileSync('git', ['-C', sourceRoot, 'commit-tree', tree, '-p', head, '-m', 'test fixture identity'], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } }).trim()
    try {
      const pnpmBin = await packMutation('change-head', `execFileSync('git',['-C',${JSON.stringify(sourceRoot)},'update-ref','HEAD',${JSON.stringify(changed)}]);`)
      await assert.rejects(createReport({ sourceRoot, outDir, pnpmBin }), /source changed/)
      await assert.rejects(readFile(path.join(outDir, 'report.json')), { code: 'ENOENT' })
    } finally { execFileSync('git', ['-C', sourceRoot, 'update-ref', 'HEAD', head]) }
  })

  it('rejects a build entry redirected to a different checkout', async () => {
    const sourceRoot = await sourceFixture(), entry = path.join(sourceRoot, 'apps/harness-plugin/scripts/build.mjs')
    const original = await readFile(entry)
    try {
      await rm(entry)
      await symlink(path.join(root, 'apps/harness-plugin/scripts/build.mjs'), entry)
      await assert.rejects(createReport({ sourceRoot, outDir: path.join(tmp, 'redirected-build') }), /build entry outside source root/)
    } finally { await rm(entry); await writeFile(entry, original) }
  })

  it('rejects output symlinks before deleting a sentinel, including invalid sources and ancestors', async () => {
    const outside = path.join(tmp, 'outside'), link = path.join(tmp, 'output-link')
    await mkdir(outside); await writeFile(path.join(outside, 'report.json'), 'KEEP-ME')
    await mkdir(path.join(outside, 'nested')); await writeFile(path.join(outside, 'nested/report.json'), 'KEEP-ME')
    await symlink(outside, link)
    for (const sourceRoot of [root, tmp]) for (const suffix of ['', 'nested']) {
      await assert.rejects(createReport({ sourceRoot, outDir: path.join(link, suffix) }), /unsafe output/)
      assert.equal(await readFile(path.join(outside, suffix, 'report.json'), 'utf8'), 'KEEP-ME')
    }
  })

  it('rejects dangerous output roots and overlap with tracked source before any cleanup', async () => {
    for (const outDir of [root, path.dirname(root), path.parse(root).root, os.tmpdir(), path.join(root, 'apps'), path.join(root, 'packages/core/src'), path.join(root, '.git')]) {
      await assert.rejects(createReport({ sourceRoot: tmp, outDir }), /unsafe output/)
    }
  })

  it('rejects even one bundled React implementation in either half, including nested package paths', async () => {
    for (const name of ['node_modules/react/cjs/react.production.js', 'node_modules/.pnpm/react-dom@19/node_modules/react-dom/client.js']) {
      for (const side of ['host', 'client']) {
        await assert.rejects(inspectBundle({ metafile: graph({ [name]: {} }), sourceRoot: root, side }), /bundled React/)
      }
    }
  })

  it('rejects multiple outputs, unsupported React externals and escaping input paths', async () => {
    await assert.rejects(inspectBundle({ metafile: { inputs: {}, outputs: { a: {}, b: {} } }, sourceRoot: root, side: 'client' }), /one output/)
    await assert.rejects(inspectBundle({ metafile: graph({}, [{ external: true, path: 'react/cjs/react.production.js' }]), sourceRoot: root, side: 'client', baseline: ['react'] }), /React external/)
    await assert.rejects(inspectBundle({ metafile: graph({ '../elsewhere/src.ts': {} }), sourceRoot: root, side: 'client' }), /outside source root/)
    await assert.rejects(inspectBundle({ metafile: graph({ '/private/source.ts': {} }), sourceRoot: root, side: 'client' }), /relative input/)
  })

  it('rejects symlink escapes and unregistered source roots without retaining success', async () => {
    await symlink(path.join(root, 'package.json'), path.join(tmp, 'escaped.json'))
    await assert.rejects(inspectBundle({ metafile: graph({ 'escaped.json': {} }), sourceRoot: tmp, side: 'client' }), /outside source root/)
    const outDir = path.join(tmp, 'invalid-source')
    await mkdir(outDir)
    await writeFile(path.join(outDir, 'report.json'), '{}')
    await assert.rejects(createReport({ sourceRoot: tmp, outDir }), /registered checkout/)
    await assert.rejects(readFile(path.join(outDir, 'report.json')), { code: 'ENOENT' })
  })

  it('measures real build and pack bytes with reproducible JS and portable graphs', async () => {
    report = await createReport({ sourceRoot: root, outDir: path.join(tmp, 'first') })
    const second = await createReport({ sourceRoot: root, outDir: path.join(tmp, 'second') })
    const direct = await build({ outDir: path.join(tmp, 'direct') })
    for (const [side, filename] of [['client', 'client.js'], ['host', 'index.js']]) {
      const bytes = await readFile(path.join(tmp, 'first/package/lib', filename))
      assert.equal(report.bundles[side].rawBytes, bytes.length)
      assert.equal(report.bundles[side].gzipBytes, gzipSync(bytes, { level: 9 }).length)
      assert.equal(report.bundles[side].sha256, hash(bytes))
      assert.deepEqual(report.bundles[side], second.bundles[side])
      assert.deepEqual(bytes, await readFile(path.join(direct.packageDir, 'lib', filename)))
      assert.equal(report.bundles[side].outputs, 1)
      assert.deepEqual(report.bundles[side].bundledReact, [])
    }
    const tarball = await readFile(path.join(tmp, 'first', report.pack.file))
    assert.equal(report.pack.bytes, tarball.length)
    assert.equal(report.pack.sha256, hash(tarball))
    assert.ok(report.toolchain.node && report.toolchain.pnpm && report.toolchain.esbuild)
    assert.equal(report.gzipLevel, 9)
    assert.doesNotMatch(JSON.stringify(report), /(?:\/Users\/|\/private\/|\/tmp\/|[A-Z]:\\)/)
    assert.deepEqual(JSON.parse(await readFile(path.join(tmp, 'first/report.json'), 'utf8')), report)
    assert.equal(compareReports({ ...second, source: { ...second.source, dirty: false } }, { ...report, source: { ...report.source, dirty: false } }).client.gzipBytes, 0)
  })

  it('refuses deltas across changed configuration, toolchain, gzip or schema', () => {
    report = { ...report, source: { ...report.source, dirty: false } }
    for (const patch of [{ configuration: { buildSha256: 'different' } }, { toolchain: { ...report.toolchain, pnpm: 'other' } }, { gzipLevel: 1 }, { schemaVersion: 99 }]) {
      assert.throws(() => compareReports({ ...report, ...patch }, report), /not comparable/)
    }
    const changed = structuredClone(report)
    changed.bundles.client.gzipBytes += 7
    changed.bundles.client.inputs.push('packages/ui/new.ts')
    const delta = compareReports(changed, report)
    assert.equal(delta.client.gzipBytes, 7)
    assert.deepEqual(delta.client.inputs.added, ['packages/ui/new.ts'])
    assert.throws(() => compareReports({ ...report, source: { ...report.source, dirty: true } }, report), /dirty source/)
    assert.throws(() => compareReports(report, { ...report, source: { ...report.source, dirty: true } }), /dirty source/)
  })

  it('removes stale success when pack fails or produces no tarball', async () => {
    const bin = path.join(tmp, 'bin')
    await mkdir(bin)
    for (const code of [1, 0]) {
      const pnpmBin = path.join(bin, `pnpm-${code}`)
      await writeFile(pnpmBin, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 10.28.2; exit 0; fi\nexit ${code}\n`, { mode: 0o755 })
      const outDir = path.join(tmp, `failure-${code}`)
      await mkdir(outDir)
      await writeFile(path.join(outDir, 'report.json'), '{}')
      await writeFile(path.join(outDir, 'stale.tgz'), 'old')
      await assert.rejects(createReport({ sourceRoot: root, outDir, pnpmBin }), code ? /pack failed/ : /one tarball/)
      await assert.rejects(readFile(path.join(outDir, 'report.json')), { code: 'ENOENT' })
    }
  })
})
