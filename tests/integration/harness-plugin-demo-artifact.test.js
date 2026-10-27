import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { before, after, it } from 'node:test'
import { parse } from 'yaml'
import ts from 'typescript'
import { build, isNodeBuiltin } from '../../apps/harness-plugin/scripts/build.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const migrations = ['001_init.sql', '002_identity_membership.sql', '003_control_facts.sql',
  '004_execution_run_identity.sql', '005_source_version_carrier.sql', '006_delivery_facts.sql', '007_planning_sync_round.sql']
const expected = ['LICENSE', 'package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js',
  ...migrations.map(name => `migrations/${name}`)].sort()
let scratch, tarball
function run(command, args, cwd) {
  let result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  // Some local pnpm launchers intentionally rely on a shell instead of a shebang.
  if (command === 'pnpm' && result.error?.code === 'ENOEXEC') {
    const launcher = (process.env.PATH ?? '').split(path.delimiter)
      .map(directory => path.resolve(cwd ?? process.cwd(), directory, 'pnpm'))
      .find(file => {
        try { accessSync(file, constants.X_OK); return statSync(file).isFile() } catch { return false }
      })
    assert.ok(launcher, 'pnpm launcher missing from PATH')
    result = spawnSync('/bin/sh', [launcher, ...args], { cwd, encoding: 'utf8' })
  }
  assert.equal(result.status, 0, `${command} failed (output withheld)`)
  return result.stdout
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

// Parse actual module syntax, including require inside the client's factory wrapper.
function assertRuntimeImports(text) {
  const source = ts.createSourceFile('artifact.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  assert.equal(source.parseDiagnostics.length, 0, 'artifact JavaScript does not parse')
  function visit(node) {
    let specifier
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) specifier = node.arguments[0]
    if (specifier && (ts.isStringLiteral(specifier) || ts.isNoSubstitutionTemplateLiteral(specifier))) {
      assert.ok(!(/\.tsx?(?:[?#].*)?$/.test(specifier.text) ||
        /^(?:file:|workspace:|@harness-projects\/)/.test(specifier.text)), 'artifact imports source')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

// Audit the installed bytes, including ignored outputs; never echo a matched value.
async function audit(file) {
  const entries = run('tar', ['-tzf', file]).trim().split('\n').sort()
  assert.deepEqual(entries, expected.map(name => `package/${name}`).sort(), 'unexpected archive inventory')
  const dest = await mkdtemp(path.join(scratch, 'audit-'))
  run('tar', ['-xzf', file, '-C', dest])
  const bytes = Object.fromEntries(await Promise.all(expected.map(async name =>
    [name, await readFile(path.join(dest, 'package', name))])))
  for (const content of Object.values(bytes)) {
    const text = content.toString()
    for (const local of [root, homedir()]) assert.ok(!text.includes(local), 'artifact contains local path')
    assert.ok(!/(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)/.test(text), 'artifact contains identity path')
    assert.ok(!/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(text), 'artifact contains credential')
    assert.ok(!/sourceMappingURL=/.test(text), 'artifact contains source map')
  }
  for (const file of ['lib/index.js', 'lib/client.js']) assertRuntimeImports(bytes[file].toString())
  const manifest = JSON.parse(bytes['package.json'])
  assert.equal(manifest.name, '@harness-projects/app-harness-plugin')
  assert.equal(manifest.version, '0.1.0-demo.1')
  assert.equal(manifest.private, true)
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.license, 'Apache-2.0')
  assert.equal(manifest.main, './lib/index.js')
  assert.deepEqual(manifest.exports, { '.': './lib/index.js', './client': './lib/client.js',
    './package.json': './package.json', './cordis.patch.yml': './cordis.patch.yml' })
  assert.equal(manifest.dependencies, undefined)
  assert.equal(manifest.scripts, undefined)
  assert.deepEqual(manifest.dsh.bundle, { patch: './cordis.patch.yml' })
  assert.deepEqual(manifest.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar'])
  assert.deepEqual(manifest.peerDependencies, { '@deepseek-ai/cordis': '~4.0.4',
    '@deepseek-ai/dsh-client-ui-slots': '~0.2.0-rc.2', '@deepseek-ai/dsh-client-ui-layout': '~0.2.0-rc.2',
    '@deepseek-ai/dsh-client-ui-sidebar': '~0.2.0-rc.2' })
  assert.deepEqual(bytes['cordis.patch.yml'], await readFile(path.join(root, 'apps/harness-plugin/cordis.patch.yml')))
  assert.ok(parse(bytes['cordis.patch.yml'].toString()))
  assert.deepEqual(bytes.LICENSE, await readFile(path.join(root, 'LICENSE')))
  for (const name of migrations) assert.deepEqual(bytes[`migrations/${name}`],
    await readFile(path.join(root, 'packages/storage/sqlite/migrations', name)), 'migration bytes differ')
  assert.match(bytes['lib/index.js'].toString(), /["']node:sqlite["']/)
  assert.match(bytes['lib/client.js'].toString(), /window\.__ModuleLoader__\.load/)
  return { dest, bytes, sha256: digest(await readFile(file)) }
}

before(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'hp-demo-audit-'))
  const { packageDir } = await build({ outDir: path.join(scratch, 'out') })
  run('pnpm', ['--dir', packageDir, 'pack', '--pack-destination', scratch], root)
  tarball = path.join(scratch, (await readdir(scratch)).find(name => name.endsWith('.tgz')))
})
after(async () => { if (scratch) await rm(scratch, { recursive: true, force: true }) })

it('the packed artifact has a demo identity and complete deployable bytes', async () => {
  assert.equal(JSON.parse(await readFile(path.join(root, 'apps/harness-plugin/package.json'))).version, '0.1.0-demo.1')
  const result = await audit(tarball)
  assert.match(result.sha256, /^[a-f0-9]{64}$/)
})
it('host builtin gate uses complete specifiers, preserving node:sqlite without accepting fake modules', () => {
  for (const [specifier, want] of [['node:sqlite', true], ['node:fs', true], ['fs/promises', true],
    ['sqlite', false], ['node:fs/fake', false], ['fs/fake', false]]) {
    assert.equal(isNodeBuiltin(specifier), want, `builtin decision for ${specifier}`)
  }
})
it('actual tarball mutations are rejected without disclosing injected values', async () => {
  await audit(tarball)
  for (const [name, reason, mutate] of [
    ['path', /identity path/, async dir => writeFile(path.join(dir, 'lib/index.js'), '\n// /' + 'Users/' + 'artifact-canary/private\n', { flag: 'a' })],
    ['credential', /credential/, async dir => writeFile(path.join(dir, 'lib/index.js'), '\n// ghp_' + 'z'.repeat(36), { flag: 'a' })],
    ['migration', /inventory/, async dir => rm(path.join(dir, 'migrations/007_planning_sync_round.sql'))],
    ['source-export', /deep-equal/, async dir => {
      const file = path.join(dir, 'package.json'), manifest = JSON.parse(await readFile(file, 'utf8'))
      manifest.exports['.'] = './src/index.ts'
      await writeFile(file, JSON.stringify(manifest))
    }],
  ]) {
    const dest = await mkdtemp(path.join(scratch, 'mutation-'))
    run('tar', ['-xzf', tarball, '-C', dest])
    await mutate(path.join(dest, 'package'))
    const candidate = path.join(scratch, `${name}.tgz`)
    run('tar', ['-czf', candidate, '-C', dest, ...expected.filter(entry => name !== 'migration' || entry !== 'migrations/007_planning_sync_round.sql').map(entry => `package/${entry}`)])
    await assert.rejects(() => audit(candidate), error => {
      assert.match(error.message, reason)
      assert.ok(!String(error.message).includes('artifact-canary'))
      assert.ok(!String(error.message).includes('z'.repeat(36)))
      return true
    })
  }
})

async function repackJavaScript(name, file, source) {
  const dest = await mkdtemp(path.join(scratch, 'syntax-'))
  run('tar', ['-xzf', tarball, '-C', dest])
  await writeFile(path.join(dest, 'package', file), `\n${source}\n`, { flag: 'a' })
  const candidate = path.join(scratch, `${name}.tgz`)
  run('tar', ['-czf', candidate, '-C', dest, ...expected.map(entry => `package/${entry}`)])
  return candidate
}

for (const [name, file, source] of [
  ['side-effect-ts', 'lib/index.js', "import './source-only.ts'"],
  ['side-effect-tsx', 'lib/index.js', "import './source-only.tsx'"],
  ['template-import-ts', 'lib/index.js', 'void import(`./source-only.ts`)'],
  ['export-from-ts', 'lib/index.js', "export { missing } from './source-only.ts'"],
  ['file-import', 'lib/index.js', 'void import(`file:./source-only.js`)'],
  ['workspace-import', 'lib/index.js', 'void import(`workspace:source-only`)'],
  ['workspace-package-import', 'lib/index.js', 'void import(`@harness-projects/core`)'],
  ['wrapper-require-ts', 'lib/client.js', "window.__ModuleLoader__.load({ id: 'probe', factory: (require) => { require('./source-only.ts') } })"],
  ['wrapper-require-workspace', 'lib/client.js', "window.__ModuleLoader__.load({ id: 'probe', factory: (require) => { require('@harness-projects/core') } })"],
]) {
  it(`actual tarball rejects runtime module reference: ${name}`, async () => {
    await assert.rejects(() => repackJavaScript(name, file, source).then(audit), /artifact (?:imports|contains) (?:source|workspace)/)
  })
}
for (const [name, source] of [
  ['comment', "// documentation example: from './example.ts'\n/* import './example.ts'; */"],
  ['ordinary-string', 'const example = "file:./example.ts"'],
]) {
  it(`actual tarball accepts harmless module examples: ${name}`, async () => {
    await audit(await repackJavaScript(`harmless-${name}`, 'lib/index.js', source))
  })
}
