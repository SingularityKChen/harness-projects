/**
 *
 */
import {
  ProjectErrorCode, projectError, providerRegistry,
  type AccessLevel, type CapabilityKey, type ExternalObjectRef, type ProviderRegistry, type Storage,
} from '@harness-projects/capabilities'
import {
  StatusPolicy, newEntityId, newExternalIdentityId, newRelationId, newWorkspaceId,
  type EntityId, type ExternalIdentityId, type RelationId, type WorkspaceId,
} from '@harness-projects/domain'
import { bootstrapWorkspace, type BootstrapResult } from './bootstrap.ts'
import { startWorkUnavailable, type StartWorkRequest, type StartWorkResult } from './execution-context.ts'
import { createQueries, type CoreQueries } from './queries.ts'
import { registerBindings, type CoreProviderTable } from './registry.ts'
import { startWork } from './start-work.ts'

export interface IdFactory {
  readonly entityId: () => EntityId
  readonly externalIdentityId: () => ExternalIdentityId
  readonly relationId: () => RelationId
}

export const defaultIdFactory: IdFactory = {
  entityId: newEntityId, externalIdentityId: newExternalIdentityId, relationId: newRelationId,
}

export interface CoreWorkspaceInput {
  /** 重启恢复要让新 core 读同一份工作区投影，必须复用同一 id。 */
  readonly id?: WorkspaceId
  readonly name: string
  readonly statusPolicy?: StatusPolicy
  /** 可选显式规划项目范围；不传时由 bootstrap 从 provider 观察中发现。 */
  readonly project?: ExternalObjectRef
}

export interface CoreDeps {
  readonly workspace: CoreWorkspaceInput
  readonly providers: CoreProviderTable
  readonly storage?: Storage
  readonly clock?: () => string
  readonly ids?: IdFactory
  readonly policy?: Readonly<Partial<Record<CapabilityKey, AccessLevel>>>
}

export interface CoreContext {
  readonly storage: Storage
  readonly workspaceId: WorkspaceId
  readonly registry: ProviderRegistry
  readonly clock: () => string
  readonly ids: IdFactory
  readonly policy: Readonly<Partial<Record<CapabilityKey, AccessLevel>>>
  /** bootstrap 成功解析后回填；重启的实例靠 provider 观察重新发现。 */
  projectRef: ExternalObjectRef | undefined
}

export interface CoreCommands {
  bootstrapWorkspace(): Promise<BootstrapResult>
  startWork(request: StartWorkRequest): Promise<StartWorkResult>
}

/**
 */
export type CoreNamespace<T> = T & (() => T)

export interface CoreApi {
  readonly queries: CoreNamespace<CoreQueries>
  readonly commands: CoreNamespace<CoreCommands>
}

function namespace<T extends object>(members: T): CoreNamespace<T> {
  return Object.assign(() => members, members)
}

/** storage 缺失时返回 undefined，由 composeCore 转成结构化不可用。 */
export async function createContext(deps: CoreDeps): Promise<CoreContext | undefined> {
  const storage = deps.storage ?? deps.providers.storage
  if (storage === undefined) return undefined
  const workspaceId = deps.workspace.id ?? newWorkspaceId()
  await storage.putWorkspace({
    id: workspaceId,
    name: deps.workspace.name,
    statusPolicy: deps.workspace.statusPolicy ?? StatusPolicy.ProviderAuthoritative,
  })
  const policy = deps.policy ?? {}
  const bindings = await registerBindings({ storage, workspaceId, providers: deps.providers, policy })
  return {
    storage, workspaceId, registry: providerRegistry(bindings),
    clock: deps.clock ?? (() => new Date().toISOString()),
    ids: deps.ids ?? defaultIdFactory, policy,
    projectRef: deps.workspace.project,
  }
}

/** 装配 CoreApi：组合时做一次首轮水合，查询随后保持纯本地只读（D5）。 */
export async function composeCore(deps: CoreDeps): Promise<CoreApi> {
  const context = await createContext(deps)
  if (context === undefined) return unavailableCore('没有可用的 storage 绑定')
  try {
    await bootstrapWorkspace(context)
  } catch {
    // port 契约要求失败是结构化 ProviderResult；裸异常只阻断本次水合，降级交给游标状态表达。
  }
  return {
    queries: namespace(createQueries(context)),
    commands: namespace({
      bootstrapWorkspace: () => bootstrapWorkspace(context),
      startWork: (request: StartWorkRequest) => startWork(context, request),
    }),
  }
}

function unavailableCore(reason: string): CoreApi {
  const error = projectError(ProjectErrorCode.NotSupported, reason)
  const queries: CoreQueries = {
    listProviderBindings: async () => [],
    listPlanningItems: async () => [],
    getItemDetail: async () => undefined,
    getExecutionContext: async () => undefined,
  }
  const commands: CoreCommands = {
    bootstrapWorkspace: async () => ({
      ok: false, entities: 0, workItems: 0, changeRequests: 0, revision: 0, degraded: true, error,
    }),
    startWork: async () => startWorkUnavailable(error),
  }
  return { queries: namespace(queries), commands: namespace(commands) }
}
