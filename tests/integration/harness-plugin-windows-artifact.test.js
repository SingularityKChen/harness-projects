import '../fixtures/resolution-preflight.mjs'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { positiveHost } from './harness-plugin-windows-fixture.js'

test('packaged Windows Host uses its bundled native admission with no source fallback', { skip: process.platform !== 'win32' }, async (t) => {
  const { apply } = await import(pathToFileURL(path.resolve('apps/harness-plugin/dist/package/lib/index.js')).href)
  await positiveHost(apply, t)
})
