/** 绑定前只读验证；Core 仍是挂载、仓库与 identity 的唯一事务写者。 */
import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { DevelopmentProvider, Storage } from './host-providers.ts'
import type { BindRepositoryInput, CommandResult } from './host-composition.ts'
import { ProjectErrorCode, projectError, type ConnectorAccountId, type ProviderBindingId } from '@harness-projects/domain'
import { BindingRefused, type ProviderBuildInput, type ProviderCatalog } from './host-providers.ts'
const execute = promisify(execFile)
const invalid = () => new BindingRefused(ProjectErrorCode.InvalidInput, '仓库选择不一致或本地检出不可读')
export async function preflightRepositoryBinding(input: BindRepositoryInput, storage: Storage, catalog: ProviderCatalog, env: Pick<ProviderBuildInput, 'worktreesDir' | 'fetch'> & { resolveCredential(handle: string): Promise<string | undefined> }): Promise<BindRepositoryInput | CommandResult<never>> {
  try {
    const refs = input.references, local = refs.find((r) => r.implementationKey === 'development.local-git'), github = refs.find((r) => r.implementationKey === 'development.github'), actions = refs.find((r) => r.implementationKey === 'github-actions')
    if (refs.length !== 3 || !local || !github || !actions || local.domain !== 'development' || github.domain !== 'development' || actions.domain !== 'delivery' || local.accountId !== undefined) throw invalid()
    const owner = github.configuration?.repositoryOwner, name = github.configuration?.repositoryName
    if (typeof owner !== 'string' || typeof name !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(owner) || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(name)
      || input.repositoryId !== `github.com/${owner}/${name}` || refs.some((r) => r.configuration?.repositoryExternalId !== input.repositoryId)
      || actions.configuration?.repositoryOwner !== owner || actions.configuration?.repositoryName !== name || !github.accountId || github.accountId !== actions.accountId) throw invalid()
    const account = await storage.getConnectorAccount(github.accountId as ConnectorAccountId)
    if (account?.platformOrigin !== 'https://github.com' || account.platformFamily !== 'github' || account.secretHandle === undefined) throw invalid()
    const raw = local.configuration?.repositoryPath
    if (typeof raw !== 'string' || !path.isAbsolute(raw) || raw !== raw.trim() || /[\u0000-\u001f\u007f]/.test(raw) || raw.split(/[/\\]+/).includes('..')) throw invalid()
    const repositoryPath = await realpath(raw).catch(() => { throw invalid() })
    const normalized = { ...input, references: refs.map((r) => r === local ? { ...r, configuration: { ...r.configuration, repositoryPath } } : r) }
    // catalog 与正式装配使用同一输出根守卫；probe id 不落库，也不承担实体身份。
    for (const reference of normalized.references.filter((r) => r.domain === 'development')) {
      const entry = catalog.get(reference.implementationKey)
      if (!entry) throw new BindingRefused(ProjectErrorCode.NotSupported, '宿主尚不支持仓库绑定')
      const id = 'repository-binding-probe' as ProviderBindingId
      const provider = await entry.create({ binding: { id, workspaceId: input.workspaceId, domain: reference.domain, implementationKey: reference.implementationKey, enabled: true, isDefault: false }, configuration: reference.configuration ?? {}, account: reference.accountId ? account : undefined,
        credential: () => env.resolveCredential(account.secretHandle!), ...env }) as DevelopmentProvider
      if (reference.implementationKey === 'development.local-git') {
        const probe = await execute('git', ['-C', repositoryPath, 'rev-parse', '--is-inside-work-tree'], { timeout: 30_000, maxBuffer: 65536 }).catch(() => { throw invalid() })
        if (probe.stdout.trim() !== 'true') throw invalid()
      }
      const result = await provider.getRepository({ bindingId: id, objectKind: 'repository', externalId: input.repositoryId, url: undefined })
      if (!result.ok) throw new BindingRefused(result.error.rawClass === 'http_404' ? ProjectErrorCode.NotFound : Object.values(ProjectErrorCode).includes(result.error.code as ProjectErrorCode) ? result.error.code as ProjectErrorCode : ProjectErrorCode.Unavailable, '仓库暂时不可读，请按恢复提示检查')
    }
    return normalized
  } catch (error) {
    return { writeState: 'failed', saving: false, authoritative: false, value: undefined, error: projectError(error instanceof BindingRefused ? error.code : ProjectErrorCode.Unavailable, '无法绑定仓库，请检查路径、仓库名称或宿主授权') }
  }
}
