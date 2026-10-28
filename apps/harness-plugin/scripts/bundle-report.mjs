/** 同生产 build 的字节/图/真实 pack 证据；不改变安装件或 Loader ABI。 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'

const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const BUILD_PATH = 'apps/harness-plugin/scripts/build.mjs'
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
const inside = (root, file) => { const relative = path.relative(root, file); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) }
const reactPackage = /(?:^|\/)node_modules\/(?:react|react-dom)(?:\/|$)/
const reactSpecifier = /^(?:react|react-dom)(?:\/|$)/
function runPnpm(pnpmBin, args, options = {}) {
  try { return execFileSync(pnpmBin, args, options) } catch (error) {
    if (error.code !== 'ENOEXEC' || path.basename(pnpmBin) !== 'pnpm') throw error
    const resolved = realpathSync(execFileSync('which', [pnpmBin], { encoding: 'utf8' }).trim())
    const shim = path.join(path.dirname(resolved), 'bin/pnpm.mjs')
    return execFileSync(process.execPath, [shim, ...args], options)
  }
}

function relativeInput(input) {
  if (path.isAbsolute(input) || /^[A-Za-z]:[\\/]/.test(input)) throw new Error('expected relative input')
  if (input.split(/[\\/]/).includes('..')) throw new Error('input outside source root')
  return input.split(path.sep).join('/')
}

async function outputDirectory(requested, checkouts) {
  const roots = [...checkouts, os.tmpdir(), os.homedir()].sort((a, b) => b.length - a.length)
  const anchor = roots.find((root) => inside(root, requested)) ?? path.parse(requested).root
  const canonicalAnchor = await realpath(anchor)
  const out = path.join(canonicalAnchor, path.relative(anchor, requested))
  const owner = checkouts.filter((root) => inside(root, out)).sort((a, b) => b.length - a.length)[0]
  if (out === path.parse(out).root || out === await realpath(os.tmpdir()) || out === await realpath(os.homedir()) ||
      checkouts.some((root) => inside(out, root)) ||
      (owner && !['apps/harness-plugin/dist', '.superpowers'].some((dir) => inside(path.join(owner, dir), out)))) {
    throw new Error('unsafe output directory: overlaps a protected root or source')
  }
  // Normalize the trusted roots first (including macOS system aliases), then reject task-created redirects.
  for (const target of [out, ...['report.json', 'report.json.tmp', 'package', 'tarball', 'host.metafile.json', 'client.metafile.json'].map((name) => path.join(out, name))]) {
    let current = canonicalAnchor
    for (const part of path.relative(canonicalAnchor, target).split(path.sep).filter(Boolean)) {
      current = path.join(current, part)
      try { if ((await lstat(current)).isSymbolicLink()) throw new Error('unsafe output directory: symbolic link') }
      catch (error) { if (error.code === 'ENOENT') break; throw error }
    }
  }
  return out
}

const sourceIdentity = (root) => ({ head: git(root, 'rev-parse', 'HEAD'), status: git(root, 'status', '--porcelain', '--untracked-files=normal') })

export async function inspectBundle({ metafile, file, sourceRoot, side, baseline = [] }) {
  const outputs = Object.values(metafile.outputs)
  if (outputs.length !== 1) throw new Error(`${side}: expected one output`)
  const inputs = Object.keys(metafile.inputs).sort().map(relativeInput)
  const bundledReact = inputs.filter((input) => reactPackage.test(input))
  if (bundledReact.length) throw new Error(`${side}: bundled React: ${bundledReact.join(', ')}`)
  const externalImports = (outputs[0].imports ?? []).filter((entry) => entry.external).map((entry) => entry.path).sort()
  if (side === 'client' && externalImports.some((name) => reactSpecifier.test(name) && !baseline.includes(name))) {
    throw new Error('unsupported React external')
  }
  for (const input of inputs) {
    if (!inside(sourceRoot, await realpath(path.resolve(sourceRoot, input)))) throw new Error('input outside source root')
  }
  const inputGraph = inputs.map((input) => ({
    path: input, bytes: metafile.inputs[input].bytes,
    imports: (metafile.inputs[input].imports ?? []).map(({ path: imported, kind, external }) => ({
      path: external ? imported : relativeInput(imported), kind, ...(external ? { external: true } : {}),
    })),
  }))
  const bytes = await readFile(file)
  return { file: `lib/${path.basename(file)}`, rawBytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length,
    sha256: sha256(bytes), outputs: outputs.length, inputs, inputGraph, externalImports, bundledReact }
}

const difference = (head, base) => ({ added: head.filter((item) => !base.includes(item)), removed: base.filter((item) => !head.includes(item)) })
export function compareReports(head, base) {
  if (head.source.dirty || base.source.dirty) throw new Error('reports not comparable: dirty source checkout')
  const incompatible = ['schemaVersion', 'gzipLevel', 'toolchain', 'configuration'].filter((key) => JSON.stringify(head[key]) !== JSON.stringify(base[key]))
  if (incompatible.length) throw new Error(`reports not comparable: ${incompatible.join(', ')}`)
  const delta = { baseHead: base.source.head, clientGzipTargetBytes: 20 * 1024 }
  for (const side of ['host', 'client']) {
    delta[side] = { rawBytes: head.bundles[side].rawBytes - base.bundles[side].rawBytes,
      gzipBytes: head.bundles[side].gzipBytes - base.bundles[side].gzipBytes,
      inputs: difference(head.bundles[side].inputs, base.bundles[side].inputs),
      externalImports: difference(head.bundles[side].externalImports, base.bundles[side].externalImports) }
  }
  delta.packBytes = head.pack.bytes - base.pack.bytes
  return delta
}

export async function createReport({ sourceRoot = TOOL_ROOT, outDir, baseReport, pnpmBin = 'pnpm' } = {}) {
  const allowed = git(TOOL_ROOT, 'worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree ')).map((line) => line.slice(9))
  outDir = await outputDirectory(path.resolve(outDir ?? path.join(sourceRoot, 'apps/harness-plugin/dist/bundle-evidence')), allowed)
  const reportFile = path.join(outDir, 'report.json')
  await rm(reportFile, { force: true })
  if (sourceRoot.split(/[\\/]/).includes('..')) throw new Error('source root traversal is not allowed')
  sourceRoot = await realpath(sourceRoot)
  if (!allowed.includes(sourceRoot) || git(sourceRoot, 'rev-parse', '--show-toplevel') !== sourceRoot) throw new Error('source root must be a registered checkout')
  const source = sourceIdentity(sourceRoot)
  await mkdir(outDir, { recursive: true })
  const buildPath = path.join(sourceRoot, BUILD_PATH)
  const buildFile = await realpath(buildPath)
  if (buildFile !== buildPath || !inside(sourceRoot, buildFile)) throw new Error('build entry outside source root or redirected')
  const buildModule = await import(pathToFileURL(buildFile).href)
  const require = createRequire(buildFile)
  const toolchain = { node: process.version, pnpm: runPnpm(pnpmBin, ['--version'], { cwd: sourceRoot, encoding: 'utf8' }).trim(), esbuild: require('esbuild').version }
  const configuration = { buildSha256: sha256(await readFile(buildFile)), clientBaseline: buildModule.CLIENT_BASELINE,
    clientExternal: buildModule.CLIENT_EXTERNAL, hostTarget: buildModule.HOST_NODE_TARGET }
  const result = await buildModule.build({ outDir })
  const bundles = {}
  for (const [side, name] of [['host', 'index.js'], ['client', 'client.js']]) {
    bundles[side] = await inspectBundle({ metafile: result.metafiles[side], file: path.join(result.packageDir, 'lib', name),
      sourceRoot, side, baseline: buildModule.CLIENT_BASELINE })
    await writeFile(path.join(outDir, `${side}.metafile.json`), `${JSON.stringify(result.metafiles[side], null, 2)}\n`)
  }
  const packDir = path.join(outDir, 'tarball')
  await rm(packDir, { recursive: true, force: true })
  await mkdir(packDir)
  try {
    runPnpm(pnpmBin, ['--dir', result.packageDir, 'pack', '--pack-destination', packDir], { cwd: sourceRoot, stdio: 'pipe' })
  } catch { throw new Error('pnpm pack failed; no success report written') }
  const tarballs = (await readdir(packDir)).filter((name) => name.endsWith('.tgz'))
  if (tarballs.length !== 1) throw new Error('expected one tarball from this pack')
  const tarball = await readFile(path.join(packDir, tarballs[0]))
  if (JSON.stringify(sourceIdentity(sourceRoot)) !== JSON.stringify(source)) throw new Error('source changed during build or pack; no success report written')
  const report = { schemaVersion: 1, observedAt: new Date().toISOString(),
    source: { head: source.head, dirty: Boolean(source.status) },
    reportToolHead: git(TOOL_ROOT, 'rev-parse', 'HEAD'), toolchain, configuration, gzipLevel: 9, bundles,
    pack: { file: `tarball/${tarballs[0]}`, bytes: tarball.length, sha256: sha256(tarball) } }
  if (baseReport) report.delta = compareReports(report, JSON.parse(await readFile(baseReport, 'utf8')))
  // 所有步骤成功才发布；失败不会把旧 JSON 当成本轮成功。
  await writeFile(`${reportFile}.tmp`, `${JSON.stringify(report, null, 2)}\n`)
  await rename(`${reportFile}.tmp`, reportFile)
  return report
}

if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { out: { type: 'string' }, 'source-root': { type: 'string' }, 'base-report': { type: 'string' } } })
    const report = await createReport({ sourceRoot: values['source-root'], outDir: values.out, baseReport: values['base-report'] })
    console.log(JSON.stringify(report, null, 2))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
