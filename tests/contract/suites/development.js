/**
 * Development 契约套件：接受任意 DevelopmentProvider 适配器 `{ label, makeProvider(scenario), expect }`。
 * scenario 由本套件定义，适配器负责翻译成自己的构造参数：`{}` 全能力无故障；
 * `{ capabilities: { branchCreate: false } }` 可选能力未启用；`{ faults: { permissionDenied: true } }`
 * 权限被拒；`{ faults: { offline: true } }` 离线；`{ faults: { ambiguousCreate: true } }` 创建结果不确定。
 * `expect`：`{ repository, baseBranch, headCommit, pageSize, worktreePath, objects }`。能力子集从
 * `describeCapabilities()` 推导，不接受适配器另报一份事实。**判定一律按被测方法自己的 capability key**：
 * 同一族的读与写是两个独立键，「能读不能建」（只读凭据）是合法形态。未声明的能力不是「跳过用例」：套件
 * 仍会断言结构化 `not_supported`、`retryable === false`、调用前后对象集合不变（`expect.objects`，必填；
 * 比较用 `node:assert/strict` 的 `deepEqual`，即 `deepStrictEqual`，不是宽松比较），方法缺失时则要求
 * 快照**不得**声明该能力可用——跳过会让子集 provider 的假绿变得不可见。工作树移除是破坏性能力，由
 * `development.worktree.remove` 单独声明：未声明时不要求 provider 实现它。
 *
 * 本套件只建模**能力声明**（键可用 / 不可用），不建模 `permission` 与 `degraded`：「只能读、不能建」在这里
 * 的形态是「未声明 create 键」；凭据权限不足时写调用答 `permission_denied`（core 的 `gateCommand` 把
 * `read_only` 翻成它）是另一种形态，不在本套件的判定范围内。分支与工作树创建目前仍按「已声明」使用
 * （issue #205 验收 2 的剩余部分）。
 *
 * 看护的不变量（tests/README.md §2.5、§3）：分支与工作树创建后可读回；变更请求创建后可读回；原生
 * 谱系——变更请求的 sourceVersion 就是它头部提交的 sha，所以 工作树→分支→提交→变更请求 一路都能
 * 按外部 id 读回，调用方不需要重新识别对象；失败是结构化结果而不是裸错误。两个身份闸门同样是契约：
 * 外来 binding 的仓库引用必须 not_found 而不是静默空页 / 静默创建（未声明的能力对任何输入都回答
 * not_supported——能力整体不存在时结论与输入无关）；同一路径重复创建工作树必须 conflict 而不是静默复用。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { CapabilityKey, effectiveCapabilities } from '@harness-projects/capabilities'

const accessOf = (snapshot, key) => effectiveCapabilities(snapshot).find((c) => c.key === key)?.access ?? 'unavailable'
const refFor = (repository, objectKind, externalId) => ({ ...repository, objectKind, externalId })
const crInput = (repository, head, base) => ({ repository, head, base, title: '标题占位', body: '正文占位' })

/** 未声明的能力：方法必须存在、回答结构化 not_supported，且不产生任何对象（不是 skip）。 */
function assertNotSupported(result, what) {
  assert.equal(result.ok, false, `${what} 未声明能力时必须返回结构化结果，而不是抛错或静默成功`)
  assert.equal(result.error.code, 'not_supported', `${what} 未声明能力时必须报 not_supported`)
  assert.equal(result.error.retryable, false, 'not_supported 必须转人工流程，不是可重试的平台错误')
}

/** 可选方法各自对应的 capability key：**判定一律按方法自己的键**，不用家族级的替代键。 */
const METHOD_KEY = {
  createChangeRequest: CapabilityKey.DevelopmentChangeRequestCreate,
  getChangeRequest: CapabilityKey.DevelopmentChangeRequestRead,
  listChangeRequests: CapabilityKey.DevelopmentChangeRequestRead,
  removeWorktree: CapabilityKey.DevelopmentWorktreeRemove,
}

/**
 * 未声明的可选方法：方法缺失就是「不提供该能力」的正常形态，没有可调用的东西；方法存在时必须回答
 * 结构化 `not_supported`。副作用由调用方用 `expect.objects` 的前后快照断言。
 *
 * 「方法缺失时快照不得声明可用」**不在这里断言**：每个调用点都先经 `declares()` 确认了「未声明」才走到
 * 这里，在这里再查一遍是同义反复。它由已声明路径上的 `implemented()` 钉住——声明了却没实现，失败信息
 * 直接指向那个方法，而不是一个 `TypeError`。
 */
async function assertUndeclared(provider, method, input) {
  const fn = provider[method]
  if (fn === undefined) return
  assertNotSupported(await fn.call(provider, input), method)
}

/** 已声明可用的可选方法必须真的实现（port 义务 3 的判别点）：取出绑定到 provider 的方法。 */
function implemented(provider, method) {
  assert.equal(typeof provider[method], 'function', `快照声明了 ${METHOD_KEY[method]} 可用，${method} 就必须实现`)
  return provider[method].bind(provider)
}

/** 某个可选方法是否被声明为可用。**逐方法取键**：`change_request.read` 可用而 `change_request.create`
 *  未声明（只能读、不能建的能力子集）是合法形态，用 read 当 create 的门会让这个形态过不了套件——那正是
 *  本套件要支持的那类「诚实地声明更小能力子集」的 provider。 */
async function declares(provider, method) {
  return accessOf(await provider.describeCapabilities(), METHOD_KEY[method]) === 'available'
}

export function developmentContractSuite(adapter) {
  const { label, makeProvider, expect: expected } = adapter
  const repository = expected.repository
  /** 声明了的能力对外来 binding 必须 not_found；未声明的能力对任何输入都是 not_supported。 */
  const refusalCode = (declared) => (declared ? 'not_found' : 'not_supported')
  // 无副作用不是"没人看见"：适配器必须能给出"本 provider 现在持有哪些外部对象"，套件比较调用前后
  // （`node:assert/strict` 的 `deepEqual` 就是 `deepStrictEqual`，不是宽松比较）。
  assert.equal(typeof expected.objects, 'function', '适配器必须提供 expect.objects(provider)：否则"被拒的调用没有副作用"无从断言')

  test(`${label}：创建分支后可读回，并继承起点分支的头部提交`, async () => {
    const provider = makeProvider({})
    const before = await expected.objects(provider)
    const created = await provider.createBranch({ repository, name: 'feature/one', fromRef: expected.baseBranch })
    assert.notDeepEqual(await expected.objects(provider), before, 'objects 钩子每次都必须返回反映已知写入的新鲜快照')
    assert.equal(created.ok, true)
    assert.equal(created.value.headCommit, expected.headCommit)
    // 双向断言：方法可用而快照说不可用，与谎报可用一样是假绿（评审 [15] 的反方向）。
    assert.equal(accessOf(await provider.describeCapabilities(), CapabilityKey.DevelopmentBranchCreate), 'available', '分支能创建时快照必须声明 branch.create 可用')
    const found = await provider.getRepository(repository)
    assert.equal(found.ok, true, '仓库身份必须能按外部 id 读回')
    assert.equal(accessOf(await provider.describeCapabilities(), CapabilityKey.DevelopmentRepositoryRead), 'available', '仓库能读回时快照必须声明 repository.read 可用')
    assert.equal(found.value.defaultBranch, expected.baseBranch)
    const listed = await provider.listBranches({ repository, cursor: undefined, limit: 100 })
    assert.ok(listed.value.items.some((branch) => branch.ref.externalId === created.value.ref.externalId))
  })

  test(`${label}：工作树创建后可定位；移除按声明的能力——可读回消失，或结构化 not_supported`, async () => {
    const provider = makeProvider({})
    await provider.createBranch({ repository, name: 'feature/wt', fromRef: expected.baseBranch })
    const beforeCreate = await expected.objects(provider)
    const created = await provider.createWorktree({ repository, path: expected.worktreePath, branch: 'feature/wt' })
    assert.equal(created.ok, true)
    assert.notDeepEqual(await expected.objects(provider), beforeCreate, 'objects 钩子必须反映工作树的写入')
    assert.equal(accessOf(await provider.describeCapabilities(), CapabilityKey.DevelopmentWorktreeCreate), 'available', '工作树能创建时快照必须声明 worktree.create 可用')
    assert.equal(created.value.branch, 'feature/wt')
    assert.equal(created.value.path, expected.worktreePath)
    const worktreeRead = accessOf(await provider.describeCapabilities(), CapabilityKey.DevelopmentWorktreeRead)
    if (worktreeRead === 'available') {
      const read = await provider.getWorktree({ worktree: created.value.ref })
      assert.equal(read.ok, true, '声明工作树读能力时必须读回创建后的工作树')
      assert.deepEqual(read.value, created.value)
    }
    // 移除是**破坏性**能力：能不能移除必须由快照声明，不能由"方法在不在"决定（AGENTS.md §7 破坏性删除
    // 默认不做）。未声明时不是跳过用例，而是断言方法缺失或结构化 not_supported，且不得留下副作用。
    if (accessOf(await provider.describeCapabilities(), CapabilityKey.DevelopmentWorktreeRemove) !== 'available') {
      const before = await expected.objects(provider)
      await assertUndeclared(provider, 'removeWorktree', { worktree: created.value.ref })
      assert.deepEqual(await expected.objects(provider), before, '被拒的移除不得留下任何副作用')
      return
    }
    const remove = implemented(provider, 'removeWorktree')
    const beforeRemove = await expected.objects(provider)
    assert.equal((await remove({ worktree: created.value.ref })).ok, true)
    assert.notDeepEqual(await expected.objects(provider), beforeRemove, 'objects 钩子必须反映工作树的移除')
    const again = await remove({ worktree: created.value.ref })
    assert.equal(again.ok, false)
    assert.equal(again.error.code, 'not_found')
  })

  test(`${label}：变更请求的每个方法按**自己**声明的能力——可用则真的走通，不可用则结构化 not_supported`, async () => {
    const provider = makeProvider({})
    const before = await expected.objects(provider)
    const canCreate = await declares(provider, 'createChangeRequest')
    const created = canCreate
      ? await implemented(provider, 'createChangeRequest')(crInput(repository, expected.baseBranch, expected.baseBranch))
      : undefined
    if (canCreate) {
      assert.equal(created.ok, true, '声明了 change_request.create 就必须真的能创建')
      assert.notDeepEqual(await expected.objects(provider), before, 'objects 钩子必须反映变更请求的写入')
      assert.equal(created.value.ref.objectKind, 'change_request')
      assert.ok(created.value.number > 0, '变更请求必须带编号')
    } else {
      await assertUndeclared(provider, 'createChangeRequest', crInput(repository, expected.baseBranch, expected.baseBranch))
      assert.deepEqual(await expected.objects(provider), before, '被拒的变更请求不得留下任何副作用')
      // 子集不得影响已声明的分支能力。
      const branch = await provider.createBranch({ repository, name: 'feature/cr-subset', fromRef: expected.baseBranch })
      assert.equal(branch.ok, true)
      const listed = await provider.listBranches({ repository, cursor: undefined, limit: 100 })
      assert.ok(listed.value.items.some((item) => item.ref.externalId === branch.value.ref.externalId))
    }
    // 读方法各自按自己的键：声明了 read 就必须真的读（有对象读回同一份，没有对象报 not_found），
    // 未声明就必须结构化 not_supported——只读凭据（read 有、create 无）在这里得到支持。
    const target = created?.ok === true ? created.value.ref : refFor(repository, 'change_request', 'cr-absent')
    if (await declares(provider, 'getChangeRequest')) {
      const read = await provider.getChangeRequest(target)
      assert.equal(read.ok, created?.ok === true, '声明了 change_request.read 就必须真的读，而不是被能力门挡住')
      if (created?.ok === true) assert.deepEqual(read.value, created.value)
      else assert.equal(read.error.code, 'not_found', '读得到能力但对象不存在时必须是 not_found')
    } else {
      await assertUndeclared(provider, 'getChangeRequest', target)
    }
    if (await declares(provider, 'listChangeRequests')) {
      const listed = await provider.listChangeRequests({ repository, cursor: undefined, limit: 100 })
      assert.equal(listed.ok, true, '声明了 change_request.read 就必须能列出')
      assert.equal(listed.value.items.some((item) => item.ref.externalId === target.externalId), created?.ok === true)
    } else {
      await assertUndeclared(provider, 'listChangeRequests', { repository, cursor: undefined, limit: 100 })
    }
  })

  test(`${label}：原生谱系——分支头部提交按外部 id 找回，变更请求版本锚定或按子集拒答`, async () => {
    const provider = makeProvider({})
    const branch = await provider.createBranch({ repository, name: 'feature/lineage', fromRef: expected.baseBranch })
    assert.equal(branch.ok, true)
    const commit = await provider.getCommit(refFor(repository, 'commit', branch.value.headCommit))
    assert.equal(commit.ok, true, '分支头部提交必须能按外部 id 读回，不需要重新识别')
    assert.equal(commit.value.sha, branch.value.headCommit)
    if (!await declares(provider, 'createChangeRequest')) {
      const before = await expected.objects(provider)
      await assertUndeclared(provider, 'createChangeRequest', crInput(repository, 'feature/lineage', expected.baseBranch))
      assert.deepEqual(await expected.objects(provider), before, '被拒的变更请求不得留下任何副作用')
      return
    }
    const created = await implemented(provider, 'createChangeRequest')(crInput(repository, 'feature/lineage', expected.baseBranch))
    assert.equal(created.ok, true)
    assert.equal(created.value.sourceVersion, branch.value.headCommit, '变更请求的 source version 必须就是它头部的提交')
    // 读回按 read 自己的键：「能建、读未声明」时沿创建结果里的版本走，不向未声明的读方法索取。
    const sourceVersion = await declares(provider, 'getChangeRequest')
      ? (await provider.getChangeRequest(created.value.ref)).value.sourceVersion
      : created.value.sourceVersion
    const alongCr = await provider.getCommit(refFor(repository, 'commit', sourceVersion))
    assert.equal(alongCr.ok, true, '沿变更请求版本必须能读到同一个提交，不需要重新识别')
    assert.equal(alongCr.value.sha, branch.value.headCommit)
  })

  test(`${label}：外来 binding 的仓库引用被拒绝，不读也不写`, async () => {
    const provider = makeProvider({})
    const foreign = { ...repository, bindingId: `${repository.bindingId}-foreign` }
    const reads = await Promise.all([
      provider.getRepository(foreign),
      provider.listBranches({ repository: foreign, cursor: undefined, limit: 10 }),
      provider.listChangeRequests({ repository: foreign, cursor: undefined, limit: 10 }),
    ])
    // 写路径串行：前一次被拒后不得留下任何能被下一次复用的对象，否则谱系会被外来 binding 污染。
    const writes = [
      [await provider.createBranch({ repository: foreign, name: 'feature/foreign', fromRef: expected.baseBranch }), true],
      [await provider.createWorktree({ repository: foreign, path: expected.worktreePath, branch: 'feature/foreign' }), true],
    ]
    if (await declares(provider, 'createChangeRequest')) {
      writes.push([await implemented(provider, 'createChangeRequest')(crInput(foreign, expected.headCommit, expected.baseBranch)), true])
    } else {
      await assertUndeclared(provider, 'createChangeRequest', crInput(foreign, expected.headCommit, expected.baseBranch))
    }
    const results = [
      [reads[0], true], [reads[1], true], [reads[2], await declares(provider, 'listChangeRequests')], ...writes,
    ]
    for (const [result, declared] of results) {
      assert.equal(result.ok, false, '外来仓库引用必须结构化失败，而不是静默空页或静默写入')
      assert.equal(result.error.code, refusalCode(declared), declared
        ? '外来 binding 的引用必须 not_found'
        : '未声明的能力对任何输入（含外来引用）都必须是 not_supported')
    }
    // **能力判定先于身份判定**：未声明的能力对任何输入（含外来引用）都答 not_supported——能力整体不存在时
    // 结论与输入无关。这条同时钉住 port 契约里写明的顺序，也是这条规则唯一的判别性证据。
    const off = makeProvider({ capabilities: { branchCreate: false } })
    const offForeign = await off.createBranch({ repository: foreign, name: 'feature/foreign', fromRef: expected.baseBranch })
    assert.equal(offForeign.ok, false)
    assert.equal(offForeign.error.code, 'not_supported', '未声明的能力对含外来引用的任何输入都必须 not_supported')
    const branches = await provider.listBranches({ repository, cursor: undefined, limit: 100 })
    assert.equal(branches.value.items.some((branch) => branch.name === 'feature/foreign'), false, '被拒的外来写入不得落进本 binding 的仓库')
  })

  test(`${label}：同一路径重复创建工作树返回 conflict，不静默复用`, async () => {
    const provider = makeProvider({})
    await provider.createBranch({ repository, name: 'feature/wt-dup', fromRef: expected.baseBranch })
    // 这条用例必须用**自己的**路径：套件的用例共用适配器的仓库，而移除现在是可选能力，上一条用例留下的
    // 工作树不会被清掉——共用路径会让这条用例在前一条之后变成"路径已登记但分支不同"，不再测重复创建。
    const duplicatePath = `${expected.worktreePath}-dup`
    const first = await provider.createWorktree({ repository, path: duplicatePath, branch: 'feature/wt-dup' })
    assert.equal(first.ok, true)
    const again = await provider.createWorktree({ repository, path: duplicatePath, branch: 'feature/wt-dup' })
    assert.equal(again.ok, false)
    assert.equal(again.error.code, 'conflict', '第二次创建必须报冲突，而不是把两次创建折成同一条记录')
  })

  test(`${label}：未启用的可选能力报 unavailable，调用后是结构化 not_supported 且无副作用`, async () => {
    const provider = makeProvider({ capabilities: { branchCreate: false } })
    assert.equal(accessOf(await provider.describeCapabilities(), CapabilityKey.DevelopmentBranchCreate), 'unavailable')
    const result = await provider.createBranch({ repository, name: 'feature/off', fromRef: expected.baseBranch })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'not_supported')
    assert.equal(result.error.retryable, false, 'not_supported 必须转人工流程，不是可重试的平台错误')
    const listed = await provider.listBranches({ repository, cursor: undefined, limit: 100 })
    assert.equal(listed.value.items.some((b) => b.name === 'feature/off'), false, '被拒的能力不得留下副作用')
  })

  test(`${label}：权限被拒与离线都是结构化失败`, async () => {
    const denied = await makeProvider({ faults: { permissionDenied: true } }).listBranches({ repository, cursor: undefined, limit: 10 })
    assert.equal(denied.ok, false)
    assert.equal(denied.error.code, 'permission_denied')
    assert.equal(denied.error.retryable, false)

    const offline = makeProvider({ faults: { offline: true } })
    const reads = await Promise.all([
      offline.getRepository(repository),
      offline.getCommit(refFor(repository, 'commit', expected.headCommit)),
    ])
    for (const result of reads) {
      assert.equal(result.ok, false)
      assert.equal(result.error.code, 'unavailable')
      assert.equal(result.error.retryable, true)
    }
    const crRead = await offline.listChangeRequests({ repository, cursor: undefined, limit: 10 })
    if (await declares(offline, 'listChangeRequests')) {
      assert.equal(crRead.ok, false)
      assert.equal(crRead.error.code, 'unavailable')
      assert.equal(crRead.error.retryable, true)
    } else {
      await assertUndeclared(offline, 'listChangeRequests', { repository, cursor: undefined, limit: 10 })
    }
  })

  test(`${label}：创建结果不确定返回 ambiguous_result，且不改动状态`, async () => {
    const provider = makeProvider({ faults: { ambiguousCreate: true } })
    const branch = await provider.createBranch({ repository, name: 'feature/dup', fromRef: expected.baseBranch })
    assert.equal(branch.ok, false)
    assert.equal(branch.error.code, 'ambiguous_result')
    assert.equal(branch.error.retryable, false, '结果不确定必须先 reconcile，不能原样重发')
    if (await declares(provider, 'createChangeRequest')) {
      const cr = await implemented(provider, 'createChangeRequest')(crInput(repository, expected.baseBranch, expected.baseBranch))
      assert.equal(cr.error.code, 'ambiguous_result')
    } else {
      await assertUndeclared(provider, 'createChangeRequest', crInput(repository, expected.baseBranch, expected.baseBranch))
    }
    const listed = await provider.listBranches({ repository, cursor: undefined, limit: 100 })
    assert.equal(listed.value.items.some((b) => b.name === 'feature/dup'), false)
  })
}
