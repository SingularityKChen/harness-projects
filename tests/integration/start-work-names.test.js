import '../fixtures/resolution-preflight.mjs'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { Worker } from 'node:worker_threads'
import test from 'node:test'
import { branchNameFor, namesFor, namesProblem, worktreeKeyFor } from '@harness-projects/core'

// 裁剪只移除首尾连字符；内部连字符、点、下划线与默认命名语义不能变化。
test('Start Work names preserve normalization, degenerate rejection and defaults', () => {
  for (const [raw, slug] of [['', undefined], ['---', undefined], ['汉 字', undefined], ['  ', undefined],
    ['---a--b---', 'a--b'], [' !!a / b? ', 'a-b'], ['._-', '._'], ['-a_B.2-', 'a_B.2'], ['a---b', 'a---b']]) {
    const fallback = slug ?? 'work-item'
    assert.equal(branchNameFor(raw), `work/${fallback}`)
    assert.equal(worktreeKeyFor(raw), fallback)
    assert.equal(namesProblem(raw) === undefined, slug !== undefined)
    assert.deepEqual(namesFor({ workItemId: raw }), { branch: `work/${fallback}`, path: undefined, worktreeKey: fallback })
  }
  assert.deepEqual(namesFor({ workItemId: '---item---', branchName: 'explicit/branch', worktreePath: ' explicit/path ' }),
    { branch: 'explicit/branch', path: ' explicit/path ', worktreeKey: 'item' })
})

test('Start Work names finish valid long internal hyphen runs within a bounded worker', async () => {
  const length = 1_000_000
  const source = `import { parentPort } from 'node:worker_threads';
    import { branchNameFor, namesProblem, worktreeKeyFor } from ${JSON.stringify(import.meta.resolve('@harness-projects/core'))};
    parentPort.postMessage('ready');
    parentPort.once('message', (length) => {
      const raw = 'a' + '-'.repeat(length) + 'b';
      const branch = branchNameFor(raw); const key = worktreeKeyFor(raw);
      parentPort.postMessage({ branchLength: branch.length, keyLength: key.length,
        branchStart: branch.slice(0, 6), keyEnd: key.slice(-1), valid: namesProblem(raw) === undefined });
    });`
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`))
  try {
    const [ready] = await once(worker, 'message', { signal: AbortSignal.timeout(10_000) })
    assert.equal(ready, 'ready', 'module startup finishes before the operation deadline begins')
    const done = once(worker, 'message', { signal: AbortSignal.timeout(5_000) })
    worker.postMessage(length)
    const [result] = await done.catch((error) => { throw new Error('valid internal hyphens must finish naming within 5 seconds', { cause: error }) })
    assert.deepEqual(result, { branchLength: length + 7, keyLength: length + 2, branchStart: 'work/a', keyEnd: 'b', valid: true })
  } finally { await worker.terminate() }
})
