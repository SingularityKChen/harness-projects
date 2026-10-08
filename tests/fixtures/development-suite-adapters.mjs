/**
 * 坏 / 好 Development suite adapter 注册夹具：`development-contract.test.js` 的
 * `development-subset-matrix-rejects-liars` 用 `execFile` 把每个 adapter 放进独立 `node --test` 子进程，
 * 正常形态必须零退出；坏形态必须非零退出，且某一条失败消息（不是用例名或 label）同时含 `expectIncludes`
 * 的全部片段。选择 adapter 用环境变量 `DEVELOPMENT_SUITE_ADAPTER`（`node --test` 会吞掉 argv，位置参数不可用）；
 * 被父测试 import 时（环境变量未设置）只导出元数据，不注册用例。坏 adapter 都建在真实 fake 上、scenario
 * 照常下传，只扭曲一件事。
 */
import * as cap from '@harness-projects/capabilities'
import { createFakeDevelopmentProvider, refOf } from '@harness-projects/provider-fake'

import { developmentContractSuite, withUndeclaredMethod } from '../contract/suites/development.js'

const bindingId = 'binding-fake-development'
const repository = { bindingId, objectKind: 'repository', externalId: 'repo-alpha', url: undefined }
const PREPARED_BRANCH = 'prepared/source'
const PREPARED_HELD = 'prepared/held'
const PREPARED_DUP = 'prepared/dup'
const PREPARED_WORKTREE = '/worktrees/wt-prepared'

/** 五个可选能力方法各自的能力标志与 key：坏 adapter 只按这张表扭曲一个方法。 */
const OPTIONAL_METHODS = {
  createBranch: { flag: 'branchCreate', key: cap.CapabilityKey.DevelopmentBranchCreate },
  createWorktree: { flag: 'worktreeCreate', key: cap.CapabilityKey.DevelopmentWorktreeCreate },
  getWorktree: { flag: 'worktreeRead', key: cap.CapabilityKey.DevelopmentWorktreeRead },
  createChangeRequest: { flag: 'changeRequestCreate', key: cap.CapabilityKey.DevelopmentChangeRequestCreate },
  removeWorktree: { flag: 'worktreeRemove', key: cap.CapabilityKey.DevelopmentWorktreeRemove },
}
export const OPTIONAL_METHOD_KEYS = Object.freeze(
  Object.fromEntries(Object.entries(OPTIONAL_METHODS).map(([method, entry]) => [method, entry.key])),
)

/** 与 contract 装配同口径的预置对象：一条未被检出的分支、一条被独立工作树持有的分支。 */
export function baseProvider(scenario = {}) {
  const provider = createFakeDevelopmentProvider({ bindingId, ...scenario })
  const repositoryRef = provider.state.repositories[0].ref
  provider.state.branches.push(
    { repository: repositoryRef, ref: refOf(bindingId, 'branch', PREPARED_BRANCH), name: PREPARED_BRANCH, headCommit: 'sha-1' },
    { repository: repositoryRef, ref: refOf(bindingId, 'branch', PREPARED_HELD), name: PREPARED_HELD, headCommit: 'sha-1' },
    { repository: repositoryRef, ref: refOf(bindingId, 'branch', PREPARED_DUP), name: PREPARED_DUP, headCommit: 'sha-1' },
  )
  provider.state.worktrees.push(
    { repository: repositoryRef, ref: refOf(bindingId, 'worktree', PREPARED_WORKTREE), path: PREPARED_WORKTREE, branch: PREPARED_HELD },
  )
  return provider
}

/** 只替换一个方法（`undefined` 即真的藏掉），其余方法与状态照常绑定回目标 provider。 */
function withMethod(provider, method, replacement) {
  return new Proxy(provider, {
    get(target, property, receiver) {
      if (property === method) return replacement
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/** 把若干可选方法藏掉（`provider[method]` 返回 undefined），其余成员照常绑定回目标 provider。 */
export function omitMethods(provider, ...omitted) {
  const hidden = new Set(omitted)
  return new Proxy(provider, {
    get(target, property, receiver) {
      if (typeof property === 'string' && hidden.has(property)) return undefined
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

const worktreeRef = { bindingId, objectKind: 'worktree', externalId: PREPARED_WORKTREE, url: undefined }
/** 共享 expect 基座（导出供父测试构造 liar 装配），`objects` 由各 adapter 覆盖。 */
export const SUITE_EXPECT = Object.freeze({
  repository, baseBranch: 'main', headCommit: 'sha-1', pageSize: 1, worktreePath: '/worktrees/wt-1',
  worktreeBranch: PREPARED_BRANCH, worktreeRef, worktreeRefBranch: PREPARED_HELD, worktreeDupBranch: PREPARED_DUP,
  objects: (provider) => structuredClone(provider.state),
})
/** `objects === undefined` 时故意不提供该字段，用于「缺少 objects 钩子」负控。 */
const expectOf = (objects) => (objects === undefined
  ? Object.fromEntries(Object.entries(SUITE_EXPECT).filter(([field]) => field !== 'objects'))
  : { ...SUITE_EXPECT, objects })
/** 去掉某个字段的 expect 副本：用于「测试装配缺字段必须具名报错」的负控。 */
const expectWithout = (field) => Object.fromEntries(Object.entries(SUITE_EXPECT).filter(([candidate]) => candidate !== field))
const freshObjects = (provider) => structuredClone(provider.state)

/** 坏 adapter 的 method 替换：未声明却返回成功 / 结构化拒绝但留下副作用 / 裸抛异常（消息不含方法与 key）。 */
const maliciousMethod = (spec, provider) => {
  if (spec === 'success') return async () => ({ ok: true, value: undefined })
  if (spec === 'sideEffect') {
    return async () => {
      provider.state.worktrees.push({ repository: provider.state.repositories[0].ref, ref: refOf(bindingId, 'worktree', '/worktrees/sneaky'), path: '/worktrees/sneaky', branch: 'main' })
      return { ok: false, error: { code: 'not_supported', retryable: false } }
    }
  }
  return async () => { throw new Error('裸异常：未声明能力抛错，而不是结构化 not_supported') }
}
/** 失败消息必须命中的片段：前三种是套件具名断言（同一条消息还点名方法与 key）；裸 throw 的失败来自 liar
 *  自己的异常，只证明套件真的调用了未声明方法，不是套件断言。 */
const SPEC_FRAGMENT = { availableAbsent: '就必须实现', success: '必须返回结构化结果', sideEffect: '不得改动任何对象' }
const expectedFor = (spec, method, key) => (spec === 'throw' ? ['裸异常'] : [method, key, SPEC_FRAGMENT[spec]])

/** 每个坏形态只扭曲一件事；scenario（fault 等）照常下传，其余能力保持可用，好让失败定位到被扭曲的方法。 */
function liarAdapter(method, spec) {
  const { flag, key } = OPTIONAL_METHODS[method]
  return {
    label: `坏适配器：${method} ${spec}`,
    makeProvider: (scenario = {}) => {
      const capabilities = spec === 'availableAbsent' ? { ...scenario.capabilities } : { [flag]: false, ...scenario.capabilities }
      const provider = baseProvider({ ...scenario, capabilities })
      if (spec === 'availableAbsent') return withMethod(provider, method, undefined)
      return withMethod(provider, method, maliciousMethod(spec, provider))
    },
    expect: expectOf(freshObjects),
    expectIncludes: expectedFor(spec, method, key),
    liar: true,
  }
}

/** CR 读是 port 必需方法、fake 没有开关：快照剥掉 change_request.read，同键的另一个读方法诚实答 NS。 */
const CR_READ = cap.CapabilityKey.DevelopmentChangeRequestRead
const CR_READ_SIBLING = { getChangeRequest: 'listChangeRequests', listChangeRequests: 'getChangeRequest' }
const honestNs = async () => ({ ok: false, error: { code: 'not_supported', retryable: false, message: '未声明的能力' } })
function crReadLiar(method, spec) {
  return {
    label: `坏适配器：未声明 CR 读，${method} ${spec}`,
    makeProvider: (scenario = {}) => {
      const provider = baseProvider(scenario)
      return withUndeclaredMethod(withUndeclaredMethod(provider, CR_READ_SIBLING[method], honestNs), method, maliciousMethod(spec, provider))
    },
    expect: expectOf(freshObjects),
    expectIncludes: expectedFor(spec, method, CR_READ),
    liar: true,
  }
}

/** 未声明 × fault：fault 下先答平台错误、否则诚实 NS——只能红在 fault 用例里的未声明断言（能力判定先于故障）。 */
function faultFirstLiar(method, fault, code) {
  const key = method === 'createChangeRequest' ? cap.CapabilityKey.DevelopmentChangeRequestCreate : CR_READ
  return {
    label: `坏适配器：未声明的 ${method} 在 ${fault} 下先答平台错误`,
    makeProvider: (scenario = {}) => {
      const provider = baseProvider({ ...scenario, capabilities: { changeRequestCreate: false, ...scenario.capabilities } })
      const honest = method === 'listChangeRequests' ? withUndeclaredMethod(provider, 'getChangeRequest', honestNs) : provider
      return withUndeclaredMethod(honest, method, async () => (scenario.faults?.[fault] ? { ok: false, error: { code, retryable: code === 'unavailable' } } : honestNs()))
    },
    expect: expectOf(freshObjects),
    expectIncludes: [method, key, '必须报 not_supported'],
    liar: true,
  }
}

/** 合法 class 实例钩子的类型：克隆会丢掉它的原型，套件必须在比较两侧丢得一样。 */
class SnapshotRecord {}
/** 静态快照坏形态的缓存：按 provider 实例固定一份，模拟「每次都返回同一份恒定假快照」。 */
const staticSnapshots = new WeakMap()

export const SUITE_ADAPTERS = (() => {
  const adapters = {
    good: {
      label: '合法子集：真实省略 createChangeRequest / removeWorktree',
      makeProvider: (scenario = {}) => omitMethods(
        baseProvider({ ...scenario, capabilities: { changeRequestCreate: false, worktreeRemove: false, ...scenario.capabilities } }),
        'createChangeRequest', 'removeWorktree',
      ),
      expect: expectOf(freshObjects),
      expectIncludes: [],
    },
    'good-branch-worktree-absent': {
      label: '合法子集：branch.create 与 worktree.create 未声明且方法真实省略',
      makeProvider: (scenario = {}) => omitMethods(
        baseProvider({ ...scenario, capabilities: { branchCreate: false, worktreeCreate: false, ...scenario.capabilities } }),
        'createBranch', 'createWorktree',
      ),
      expect: expectOf(freshObjects),
      expectIncludes: [],
    },
    // 合法：钩子返回内部状态引用。套件取样即 structuredClone，所以它必须通过；去掉那次克隆它就红在新鲜快照。
    'good-objects-alias': {
      label: '合法形态：objects 返回内部状态引用',
      makeProvider: (scenario = {}) => baseProvider(scenario),
      expect: expectOf((provider) => provider.state),
      expectIncludes: [],
    },
    // 合法：钩子每次新建 class 实例。branch.create 关闭才有拒绝路径的比较；只克隆一侧就会误红在「不得改动任何对象」。
    'good-objects-class-instance': {
      label: '合法形态：objects 返回 class 实例',
      makeProvider: (scenario = {}) => baseProvider({ ...scenario, capabilities: { branchCreate: false, ...scenario.capabilities } }),
      expect: expectOf((provider) => Object.assign(new SnapshotRecord(), structuredClone(provider.state))),
      expectIncludes: [],
    },
    'objects-missing': {
      label: '坏适配器：缺少 objects 钩子',
      makeProvider: (scenario = {}) => baseProvider(scenario),
      expect: expectOf(undefined),
      expectIncludes: ['expect.objects'],
      liar: true,
    },
    'objects-static': {
      label: '坏适配器：objects 每次都返回同一份缓存快照',
      makeProvider: (scenario = {}) => baseProvider(scenario),
      expect: expectOf((provider) => {
        if (!staticSnapshots.has(provider)) staticSnapshots.set(provider, structuredClone(provider.state))
        return staticSnapshots.get(provider)
      }),
      expectIncludes: ['新鲜快照'],
      liar: true,
    },
    // worktree.create 关闭时只有完整 ref 身份比较在比读回结果：换了 bindingId 的读回只能红在那一条。
    'worktree-identity-swapped': {
      label: '坏适配器：getWorktree 读回换了 bindingId 的工作树',
      makeProvider: (scenario = {}) => {
        const provider = baseProvider({ ...scenario, capabilities: { worktreeCreate: false, ...scenario.capabilities } })
        return withMethod(provider, 'getWorktree', async (input) => {
          const read = await provider.getWorktree(input)
          return read.ok ? { ...read, value: { ...read.value, ref: { ...read.value.ref, bindingId: 'binding-other' } } } : read
        })
      },
      expect: expectOf(freshObjects),
      expectIncludes: ['对象身份完整一致'],
      liar: true,
    },
    // 只在 head ≠ base（谱系用例的输入）时偷偷写入：变更请求用例的 head = base 看不见它，只有谱系用例能拦。
    'ns-sideeffect-createChangeRequest-lineage-input': {
      label: '坏适配器：未声明的 createChangeRequest 只在 head ≠ base 时写入',
      makeProvider: (scenario = {}) => {
        const provider = baseProvider({ ...scenario, capabilities: { changeRequestCreate: false, ...scenario.capabilities } })
        const sneaky = maliciousMethod('sideEffect', provider)
        return withMethod(provider, 'createChangeRequest', async (input) => (input.head !== input.base ? sneaky() : honestNs()))
      },
      expect: expectOf(freshObjects),
      expectIncludes: ['createChangeRequest', cap.CapabilityKey.DevelopmentChangeRequestCreate, '不得改动任何对象'],
      liar: true,
    },
    'cr-read-offline-first': faultFirstLiar('listChangeRequests', 'offline', 'unavailable'),
    'cr-create-ambiguous-first': faultFirstLiar('createChangeRequest', 'ambiguousCreate', 'ambiguous_result'),
    // 形态要求必须用具名错误暴露「测试装配缺字段」，而不是 undefined 解引用（独立对抗验证 P1-2）。
    'missing-worktree-ref-field': {
      label: '坏适配器：worktree.create 关闭但 expect 缺 worktreeRef',
      makeProvider: (scenario = {}) => baseProvider({
        ...scenario, capabilities: { worktreeCreate: false, ...scenario.capabilities },
      }),
      expect: expectWithout('worktreeRef'),
      expectIncludes: ['expect.worktreeRef', '测试装配缺'],
      liar: true,
    },
    'missing-worktree-branch-field': {
      label: '坏适配器：expect 缺 worktreeBranch（创建用例的预置分支名）',
      makeProvider: (scenario = {}) => baseProvider(scenario),
      expect: expectWithout('worktreeBranch'),
      expectIncludes: ['expect.worktreeBranch', '测试装配缺'],
      liar: true,
    },
  }
  for (const method of Object.keys(OPTIONAL_METHODS)) {
    adapters[`available-absent-${method}`] = liarAdapter(method, 'availableAbsent')
    adapters[`undeclared-success-${method}`] = liarAdapter(method, 'success')
    adapters[`ns-sideeffect-${method}`] = liarAdapter(method, 'sideEffect')
    adapters[`bare-throw-${method}`] = liarAdapter(method, 'throw')
  }
  for (const method of Object.keys(CR_READ_SIBLING)) {
    adapters[`undeclared-success-${method}`] = crReadLiar(method, 'success')
    adapters[`ns-sideeffect-${method}`] = crReadLiar(method, 'sideEffect')
  }
  return adapters
})()

// 只在子进程（显式选择 adapter）里注册用例；被父测试 import 时保持零副作用。
if (process.env.DEVELOPMENT_SUITE_ADAPTER !== undefined) {
  const name = process.env.DEVELOPMENT_SUITE_ADAPTER
  const entry = SUITE_ADAPTERS[name]
  if (entry === undefined) {
    throw new Error(`未知 DEVELOPMENT_SUITE_ADAPTER=${name}；可用：${Object.keys(SUITE_ADAPTERS).join(', ')}`)
  }
  developmentContractSuite({
    label: entry.label,
    makeProvider: (scenario = {}) => entry.makeProvider(scenario),
    expect: entry.expect,
  })
}
