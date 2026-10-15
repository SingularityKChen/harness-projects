// 新进程重启夹具（#132 验收 5，`node --test` 不执行它）：以生产目录组合 Host，把执行上下文视图的 JSON 写到 stdout。
// argv：<dataPath> <workspaceId> <workItemId> <repositoryId>。
import { createHostComposition } from '../../../apps/harness-plugin/src/host-composition.ts'
import { PROVIDER_CATALOG } from '../../../apps/harness-plugin/src/host-providers.ts'

const [dataPath, workspaceId, workItemId, repositoryId] = process.argv.slice(2)
const host = await createHostComposition({ dataPath, workspaceId, catalog: PROVIDER_CATALOG, resolveCredential: async () => undefined })
try {
  process.stdout.write(JSON.stringify(await host.controller.queries.getExecutionContext({ workItemId, repositoryId }) ?? null))
} finally { host.dispose() }
