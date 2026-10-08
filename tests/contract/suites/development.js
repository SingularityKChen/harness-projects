/**
 * Development 契约套件：接受任意 DevelopmentProvider 适配器 `{ label, makeProvider(scenario), expect }`。
 * scenario 由本套件定义，适配器负责翻译成自己的构造参数：`{}` 全能力无故障；
 * `{ capabilities: { branchCreate: false } }` 可选能力未启用；`{ faults: { permissionDenied: true } }`
 * 权限被拒；`{ faults: { offline: true } }` 离线；`{ faults: { ambiguousCreate: true } }` 创建结果不确定。
 * `expect`：`{ repository, baseBranch, headCommit, pageSize, worktreePath, worktreeBranch?, worktreeRef?, worktreeRefBranch?,
 * worktreeDupBranch?, objects }`。能力子集从
 * `describeCapabilities()` 推导，不接受适配器另报一份事实。**判定一律按被测方法自己的 capability key**：
 * 同一族的读与写是两个独立键，「能读不能建」（只读凭据）是合法形态。未声明的能力不是「跳过用例」：套件
 * 仍会断言结构化 `not_supported`、`retryable === false`、调用前后对象集合不变（`expect.objects`，必填；
 * 比较用 `node:assert/strict` 的 `deepEqual`，即 `deepStrictEqual`，不是宽松比较），方法缺失时则要求
 * 快照**不得**声明该能力可用——跳过会让子集 provider 的假绿变得不可见。工作树移除是破坏性能力，由
 * `development.worktree.remove` 单独声明：未声明时不要求 provider 实现它。
 *
 * 本套件只建模**能力声明**（键可用 / 不可用），不建模 `permission` 与 `degraded`：凭据权限不足时写调用答
 * `permission_denied`（core 的 `gateCommand` 把 `read_only` 翻成它）是另一种形态，不在判定范围内。五个可选
 * 方法各按**自己的** key 判定（同族读 / 写是独立键，「能建不能读」也是合法形态）；`expect.worktreeBranch` /
 * `worktreeRef` 是测试预置对象身份——创建能力不可用时读取与谱系用例真实读回它们，而不是跳过。objects 钩子
 * 必须每次反映已知写入（旧快照与重读不同，抓「恒定假快照」）；套件注册时把钩子包成「每次调用都
 * `structuredClone`」，比较两侧都是克隆后的数据，钩子返回内部状态引用或 class 实例也不改变判定。
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

/** 可选方法各自对应的 capability key：**判定一律按方法自己的键**，不用家族级的替代键。 */
const METHOD_KEY = {
  createBranch: CapabilityKey.DevelopmentBranchCreate,
  createWorktree: CapabilityKey.DevelopmentWorktreeCreate,
  getWorktree: CapabilityKey.DevelopmentWorktreeRead,
  createChangeRequest: CapabilityKey.DevelopmentChangeRequestCreate,
  getChangeRequest: CapabilityKey.DevelopmentChangeRequestRead,
  listChangeRequests: CapabilityKey.DevelopmentChangeRequestRead,
  removeWorktree: CapabilityKey.DevelopmentWorktreeRemove,
}

/** 方法标识：每条失败信息都同时点名方法与 key，坏适配器的红才可定位。 */
const labelOf = (method) => `${method}（${METHOD_KEY[method]}）`

/** 未声明的能力：方法必须存在时回答结构化 not_supported，且不产生任何对象（不是 skip）。 */
function assertNotSupported(result, what) {
  assert.equal(result.ok, false, `${what} 未声明能力时必须返回结构化结果，而不是抛错或静默成功`)
  assert.equal(result.error.code, 'not_supported', `${what} 未声明能力时必须报 not_supported`)
  assert.equal(result.error.retryable, false, `${what} 的 not_supported 必须转人工流程，不是可重试的平台错误`)
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
  assertNotSupported(await fn.call(provider, input), labelOf(method))
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

/** 已知写入后的 freshness 判别：调用前快照与重新读取不同，拒绝「每次返回同一份恒定假快照」。 */
async function assertFreshAfterWrite(provider, expected, before, what) {
  assert.notDeepEqual(await expected.objects(provider), before, `${what}：objects 钩子每次都必须返回反映已知写入的新鲜快照`)
}

/** 拒绝路径：完整对象集合必须原样，不是只看数组长度。 */
async function assertObjectsUnchanged(provider, expected, before, what) {
  assert.deepEqual(await expected.objects(provider), before, `被拒的 ${what} 不得改动任何对象`)
}

/** 装配字段校验：字段缺失是**测试装配**问题，必须在断言里点名，而不是让 undefined 解引用到处炸。 */
export function needExpectField(expected, field, why) {
  assert.notEqual(expected[field], undefined, `测试装配缺 expect.${field}：${why}`)
  return expected[field]
}

/**
 * 未声明方法的**完整判定**：结构化 `not_supported` + 完整对象集合不变。导出给主用例路径
 * （`development-contract.test.js`）对「未声明」liar 做具名自检——这两个共享文件的断言若被改成
 * no-op，主用例必须红，而不是只剩子进程矩阵还在拦。`expected.objects` 必须每次返回独立快照（套件
 * 注册时已包成克隆；主用例自检用的 `SUITE_EXPECT` 钩子本身就克隆）。
 */
export async function assertUndeclaredRejected(provider, method, input, expected) {
  const before = await expected.objects(provider)
  await assertUndeclared(provider, method, input)
  await assertObjectsUnchanged(provider, expected, before, labelOf(method))
}

/**
 * 可选方法的统一判定：声明可用则真的调用（方法缺失即具名失败）；未声明则方法存在时真调用并断言结构化
 * `not_supported` 与零副作用，方法缺失时不索取。返回 `{ declared, result }`。「方法能用而快照说不可用」
 * 的反方向判别就在这里：未声明却成功会红在 `assertNotSupported`，调用点不再另做同义反复的快照断言。
 */
async function expectOptional(provider, method, input, expected) {
  if (await declares(provider, method)) return { declared: true, result: await implemented(provider, method)(input) }
  return { declared: false, result: await assertUndeclaredRejected(provider, method, input, expected) }
}

/** 调用一个可选方法并按能力声明解读结果：只要方法存在就**真的调用**，不做 flag 分支。 */
async function probeOptional(provider, method, input) {
  if (await declares(provider, method)) return { declared: true, result: await implemented(provider, method)(input) }
  const fn = provider[method]
  return { declared: false, result: fn === undefined ? undefined : await fn.call(provider, input) }
}

/**
 * 构造「快照不声明某方法，但方法存在」的 provider（测试 proxy），用它给主用例路径的未声明判别做
 * 具名自检：`call(target, input)` 决定这个方法返回什么、是否偷偷写入。快照同时删掉 capability 与
 * permission 里的 key，`declares()` 因此判定为未声明。
 */
export function withUndeclaredMethod(provider, method, call) {
  const key = METHOD_KEY[method]
  const withoutKey = (record) => Object.fromEntries(Object.entries(record).filter(([candidate]) => candidate !== key))
  const original = provider.describeCapabilities.bind(provider)
  return new Proxy(provider, {
    get(target, property, receiver) {
      if (property === 'describeCapabilities') {
        return async () => {
          const snapshot = await original()
          return { ...snapshot, capability: withoutKey(snapshot.capability), permission: withoutKey(snapshot.permission) }
        }
      }
      if (property === method) return async (input) => call(target, input)
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

export function developmentContractSuite(adapter) {
  const { label, makeProvider } = adapter
  // 无副作用不是"没人看见"：适配器必须能给出"本 provider 现在持有哪些外部对象"，套件比较调用前后
  // （`node:assert/strict` 的 `deepEqual` 就是 `deepStrictEqual`，不是宽松比较）。
  assert.equal(typeof adapter.expect.objects, 'function', '适配器必须提供 expect.objects(provider)：否则"被拒的调用没有副作用"无从断言')
  // 取样与重读都经这一次 structuredClone：两侧丢掉同样的原型与 symbol 键，alias 也改不动已取的样；
  // 之后直接调用 `expected.objects` 的用例同样安全。由合法 `good-objects-alias` / `good-objects-class-instance` 钉住。
  const expected = { ...adapter.expect, objects: async (provider) => structuredClone(await adapter.expect.objects(provider)) }
  const repository = expected.repository
  /** 声明了的能力对外来 binding 必须 not_found；未声明的能力对任何输入都是 not_supported。 */
  const refusalCode = (declared) => (declared ? 'not_found' : 'not_supported')
  // 必填身份字段与形态所需的预置对象字段都在这里具名校验：缺字段必须说"测试装配缺 X"，而不是 undefined 解引用。
  const need = (field, why) => needExpectField(expected, field, why)
  for (const field of ['repository', 'baseBranch', 'headCommit', 'pageSize', 'worktreePath']) {
    need(field, '请在 developmentContractSuite 的 expect 里补齐')
  }

  test(`${label}：创建分支后可读回，并继承起点分支的头部提交`, async () => {
    const provider = makeProvider({})
    const before = await expected.objects(provider)
    const { declared: canCreate, result: created } = await expectOptional(
      provider, 'createBranch', { repository, name: 'feature/one', fromRef: expected.baseBranch }, expected,
    )
    if (canCreate) {
      assert.equal(created.ok, true)
      assert.equal(created.value.headCommit, expected.headCommit)
      await assertFreshAfterWrite(provider, expected, before, '分支创建')
    }
    const found = await provider.getRepository(repository)
    assert.equal(found.ok, true, '仓库身份必须能按外部 id 读回')
    assert.equal(accessOf(await provider.describeCapabilities(), CapabilityKey.DevelopmentRepositoryRead), 'available', '仓库能读回时快照必须声明 repository.read 可用')
    assert.equal(found.value.defaultBranch, expected.baseBranch)
    const listed = await provider.listBranches({ repository, cursor: undefined, limit: 100 })
    assert.equal(listed.ok, true, '分支必须能列出')
    if (canCreate) {
      assert.ok(listed.value.items.some((branch) => branch.ref.externalId === created.value.ref.externalId))
    }
  })

  test(`${label}：分支列表逐页读完恰好枚举每个分支一次，最后一页 nextCursor 为 undefined（分页契约）`, async () => {
    const provider = makeProvider({})
    // 能建分支时先建三条，让遍历在 pageSize 下至少跨三页；不能建的（只读 provider）就遍历既有数据
    // ——预置分支由适配器提供，分页遍历不因此失去判别力，也不是 skip。
    if (await declares(provider, 'createBranch')) {
      for (const name of ['feature/page-a', 'feature/page-b', 'feature/page-c']) {
        const created = await implemented(provider, 'createBranch')({ repository, name, fromRef: expected.baseBranch })
        assert.equal(created.ok, true, `${name} 必须建得出来，否则分页遍历没有足够的分支`)
      }
    }
    const whole = await provider.listBranches({ repository, cursor: undefined, limit: 1000 })
    assert.equal(whole.ok, true)
    assert.equal(whole.value.nextCursor, undefined, '一次大页装得下全部分支时 nextCursor 必须为 undefined')
    const wholeNames = whole.value.items.map((branch) => branch.name)
    // 循环自带上界：坏 provider 的游标不结束时，测试以断言失败告终而不是挂住。
    const pageBound = wholeNames.length + 2
    const seen = []
    let cursor
    let pages = 0
    do {
      assert.ok(pages < pageBound, `游标必须在 ${pageBound} 页之内结束（实际已读 ${pages} 页）`)
      const page = await provider.listBranches({ repository, cursor, limit: expected.pageSize })
      assert.equal(page.ok, true)
      seen.push(...page.value.items.map((branch) => branch.name))
      cursor = page.value.nextCursor
      pages += 1
    } while (cursor !== undefined)
    assert.deepEqual([...seen].sort(), [...wholeNames].sort(), '逐页遍历必须与一次大页读到同一个分支集合')
    assert.equal(new Set(seen).size, seen.length, '无并发写入时每个分支恰好出现一次，不得重复')
    if (wholeNames.length > expected.pageSize) assert.ok(pages > 1, '分支多于 pageSize 时必须真的分页')
  })

  test(`${label}：工作树创建 / 读取 / 移除各按自己的键，未声明时结构化拒绝`, async () => {
    const provider = makeProvider({})
    // 工作树创建需要 `worktreeBranch` 指向的分支未被任何工作树检出；读取需要 `worktreeRef` 指向的预置对象。
    const createBranchName = need('worktreeBranch', '工作树创建用例需要一个未被检出的预置分支名')
    const beforeCreate = await expected.objects(provider)
    const { declared: canCreate, result: created } = await expectOptional(
      provider, 'createWorktree', { repository, path: expected.worktreePath, branch: createBranchName }, expected,
    )
    if (canCreate) {
      assert.equal(created.ok, true)
      assert.equal(created.value.branch, createBranchName)
      assert.equal(created.value.path, expected.worktreePath)
      await assertFreshAfterWrite(provider, expected, beforeCreate, '工作树创建')
    }
    // 读取可用但创建不可用时读**预置**工作树：这不是跳过，而是另一种合法形态。
    const target = created?.ok === true
      ? created.value.ref
      : need('worktreeRef', 'worktree.create 不可用时读取用例必须能读回一个预置工作树定位子')
    const preparedRef = target
    const read = await expectOptional(provider, 'getWorktree', { worktree: target }, expected)
    if (read.declared) {
      assert.equal(read.result.ok, true, '声明工作树读能力时必须读回存在的工作树')
      // 对象身份必须**完整**一致：只比较 externalId 或 path 会漏掉「换了 objectKind / bindingId 的假对象」。
      assert.deepEqual(read.result.value.ref, target, '读回的工作树必须与请求的对象身份完整一致')
      if (created?.ok === true) assert.deepEqual(read.result.value, created.value)
      else {
        // 完整 ref 身份比较是这条的判别点：只比 externalId 会漏掉「换了 objectKind / bindingId 的假对象」。
        // 路径相等在替身上是构造等价的（path 就是 externalId），对 Local Git 则是磁盘真实路径，保留作可读证据。
        assert.equal(read.result.value.path, preparedRef.externalId, '预置工作树必须读回它的磁盘路径')
        assert.equal(read.result.value.branch, need('worktreeRefBranch', '预置工作树必须声明它被检出的分支'), '预置工作树必须读回它被检出的分支')
      }
    }
    // 移除是**破坏性**能力：能不能移除必须由快照声明，不能由"方法在不在"决定（AGENTS.md §7 破坏性删除
    // 默认不做）。未声明时不是跳过用例，而是走完整的 `assertUndeclaredRejected`：真调用（方法存在时）
    // 必须结构化 not_supported、retryable false，且完整对象集合不变。
    if (!await declares(provider, 'removeWorktree')) {
      await assertUndeclaredRejected(provider, 'removeWorktree', { worktree: target }, expected)
      return
    }
    const remove = implemented(provider, 'removeWorktree')
    const beforeRemove = await expected.objects(provider)
    assert.equal((await remove({ worktree: target })).ok, true, '声明移除能力时必须真的移除存在的工作树')
    await assertFreshAfterWrite(provider, expected, beforeRemove, '工作树移除')
    const again = await remove({ worktree: target })
    assert.equal(again.ok, false)
    assert.equal(again.error.code, 'not_found')
  })

  test(`${label}：变更请求的每个方法按**自己**声明的能力——可用则真的走通，不可用则结构化 not_supported`, async () => {
    const provider = makeProvider({})
    const before = await expected.objects(provider)
    const { declared: canCreate, result: created } = await expectOptional(
      provider, 'createChangeRequest', crInput(repository, expected.baseBranch, expected.baseBranch), expected,
    )
    if (canCreate) {
      assert.equal(created.ok, true, '声明了 change_request.create 就必须真的能创建')
      await assertFreshAfterWrite(provider, expected, before, '变更请求创建')
      assert.equal(created.value.ref.objectKind, 'change_request')
      assert.ok(created.value.number > 0, '变更请求必须带编号')
    } else {
      await assertObjectsUnchanged(provider, expected, before, labelOf('createChangeRequest'))
      // 子集不得影响已声明的分支能力：分支能力也按自己的键判定，不能被 CR 的缺失连带跳过。
      const branch = await expectOptional(
        provider, 'createBranch', { repository, name: 'feature/cr-subset', fromRef: expected.baseBranch }, expected,
      )
      if (branch.declared) {
        assert.equal(branch.result.ok, true)
        const listed = await provider.listBranches({ repository, cursor: undefined, limit: 100 })
        assert.ok(listed.value.items.some((item) => item.ref.externalId === branch.result.value.ref.externalId))
      }
    }
    // 读方法各自按自己的键：声明了 read 就必须真的读（有对象读回同一份，没有对象报 not_found），
    // 未声明就走完整判定（结构化 not_supported + 对象集合不变）——只读凭据（read 有、create 无）在这里得到支持。
    const target = created?.ok === true ? created.value.ref : refFor(repository, 'change_request', 'cr-absent')
    const read = await expectOptional(provider, 'getChangeRequest', target, expected)
    if (read.declared) {
      assert.equal(read.result.ok, created?.ok === true, '声明了 change_request.read 就必须真的读，而不是被能力门挡住')
      if (created?.ok === true) assert.deepEqual(read.result.value, created.value)
      else assert.equal(read.result.error.code, 'not_found', '读得到能力但对象不存在时必须是 not_found')
    }
    const listed = await expectOptional(provider, 'listChangeRequests', { repository, cursor: undefined, limit: 100 }, expected)
    if (listed.declared) {
      assert.equal(listed.result.ok, true, '声明了 change_request.read 就必须能列出')
      assert.equal(listed.result.value.items.some((item) => item.ref.externalId === target.externalId), created?.ok === true)
    }
  })

  test(`${label}：原生谱系——分支头部提交按外部 id 找回，变更请求版本锚定或按子集拒答`, async () => {
    const provider = makeProvider({})
    const { declared: canCreateBranch, result: branch } = await expectOptional(
      provider, 'createBranch', { repository, name: 'feature/lineage', fromRef: expected.baseBranch }, expected,
    )
    if (canCreateBranch) assert.equal(branch.ok, true)
    // 分支创建不可用时以预置分支的身份继续读回谱系，而不是跳过：预置分支的头部提交就是 headCommit。
    const head = canCreateBranch ? branch.value.headCommit : expected.headCommit
    const headName = canCreateBranch ? branch.value.ref.externalId : need('worktreeBranch', '分支创建不可用时谱系用例以预置分支继续')
    const commit = await provider.getCommit(refFor(repository, 'commit', head))
    assert.equal(commit.ok, true, '分支头部提交必须能按外部 id 读回，不需要重新识别')
    assert.equal(commit.value.sha, head)
    const cr = await expectOptional(provider, 'createChangeRequest', crInput(repository, headName, expected.baseBranch), expected)
    if (!cr.declared) return
    assert.equal(cr.result.ok, true)
    assert.equal(cr.result.value.sourceVersion, head, '变更请求的 source version 必须就是它头部的提交')
    // 读回按 read 自己的键：「能建、读未声明」时沿创建结果里的版本走，不调用未声明的读方法（它的未声明
    // 判定由变更请求用例的 `expectOptional` 承担）。
    const sourceVersion = await declares(provider, 'getChangeRequest')
      ? (await provider.getChangeRequest(cr.result.value.ref)).value.sourceVersion
      : cr.result.value.sourceVersion
    const alongCr = await provider.getCommit(refFor(repository, 'commit', sourceVersion))
    assert.equal(alongCr.ok, true, '沿变更请求版本必须能读到同一个提交，不需要重新识别')
    assert.equal(alongCr.value.sha, head)
  })

  test(`${label}：外来 binding 的仓库引用被拒绝，不读也不写`, async () => {
    const provider = makeProvider({})
    const foreign = { ...repository, bindingId: `${repository.bindingId}-foreign` }
    const foreignWorktree = { ...foreign, objectKind: 'worktree', externalId: expected.worktreeRef?.externalId ?? expected.worktreePath }
    const foreignCr = { ...foreign, objectKind: 'change_request', externalId: 'cr-foreign' }
    const attempts = [
      [labelOf('getRepository'), { declared: true, result: await provider.getRepository(foreign) }],
      [labelOf('listBranches'), { declared: true, result: await provider.listBranches({ repository: foreign, cursor: undefined, limit: 10 }) }],
      [labelOf('listChangeRequests'), await probeOptional(provider, 'listChangeRequests', { repository: foreign, cursor: undefined, limit: 10 })],
      [labelOf('getCommit'), { declared: true, result: await provider.getCommit({ ...foreign, objectKind: 'commit', externalId: expected.headCommit }) }],
      // 写路径串行：前一次被拒后不得留下任何能被下一次复用的对象，否则谱系会被外来 binding 污染。
      [labelOf('createBranch'), await probeOptional(provider, 'createBranch', { repository: foreign, name: 'feature/foreign', fromRef: expected.baseBranch })],
      [labelOf('createWorktree'), await probeOptional(provider, 'createWorktree', { repository: foreign, path: expected.worktreePath, branch: expected.worktreeBranch })],
      [labelOf('createChangeRequest'), await probeOptional(provider, 'createChangeRequest', crInput(foreign, expected.headCommit, expected.baseBranch))],
      [labelOf('getWorktree'), await probeOptional(provider, 'getWorktree', { worktree: foreignWorktree })],
      [labelOf('removeWorktree'), await probeOptional(provider, 'removeWorktree', { worktree: foreignWorktree })],
      [labelOf('getChangeRequest'), await probeOptional(provider, 'getChangeRequest', foreignCr)],
    ]
    for (const [what, { declared, result }] of attempts) {
      if (result === undefined) continue
      assert.equal(result.ok, false, `${what}：外来仓库引用必须结构化失败，而不是静默空页或静默写入`)
      assert.equal(result.error.code, refusalCode(declared), declared
        ? `${what}：外来 binding 的引用必须 not_found`
        : `${what}：未声明的能力对任何输入（含外来引用）都必须是 not_supported`)
    }
    // **能力判定先于身份判定**：未声明的能力对任何输入（含外来引用）都答 not_supported——能力整体不存在时
    // 结论与输入无关。这条同时钉住 port 契约里写明的顺序，也是这条规则唯一的判别性证据。
    const off = makeProvider({ capabilities: { branchCreate: false } })
    const offCreate = off.createBranch
    if (offCreate !== undefined) {
      const offForeign = await offCreate.call(off, { repository: foreign, name: 'feature/foreign', fromRef: expected.baseBranch })
      assert.equal(offForeign.ok, false)
      assert.equal(offForeign.error.code, 'not_supported', '未声明的能力对含外来引用的任何输入都必须 not_supported')
    }
    const branches = await provider.listBranches({ repository, cursor: undefined, limit: 100 })
    assert.equal(branches.value.items.some((branch) => branch.name === 'feature/foreign'), false, '被拒的外来写入不得落进本 binding 的仓库')
  })

  test(`${label}：同一路径重复创建工作树返回 conflict，不静默复用`, async () => {
    const provider = makeProvider({})
    // 这条用例必须用**自己的**路径与分支：套件的用例共用适配器的仓库，而上一条用例留下的工作树不会被
    // 清掉——共用会让这条用例变成"分支已被检出"或"路径已登记但分支不同"，不再测重复创建。
    const duplicatePath = `${expected.worktreePath}-dup`
    // 能建分支时用自己现建的分支；不能建时用适配器预置的 `worktreeDupBranch`（与其它用例的分支互不占用）。
    const ownBranch = await declares(provider, 'createBranch')
    const duplicateBranch = ownBranch ? 'feature/wt-dup' : need('worktreeDupBranch', 'branch.create 不可用时重复创建用例需要一个独立的预置分支')
    if (ownBranch) {
      const created = await implemented(provider, 'createBranch')({ repository, name: duplicateBranch, fromRef: expected.baseBranch })
      assert.equal(created.ok, true, '重复创建用例自己的分支必须建得出来')
    }
    const first = await expectOptional(provider, 'createWorktree', { repository, path: duplicatePath, branch: duplicateBranch }, expected)
    if (!first.declared) return
    assert.equal(first.result.ok, true, '重复创建的前一次必须成功（分支已就绪且未被其它用例检出）')
    const again = await implemented(provider, 'createWorktree')({ repository, path: duplicatePath, branch: duplicateBranch })
    assert.equal(again.ok, false)
    assert.equal(again.error.code, 'conflict', '第二次创建必须报冲突，而不是把两次创建折成同一条记录')
  })

  test(`${label}：未启用的可选能力报 unavailable，调用后是结构化 not_supported 且无副作用`, async () => {
    const provider = makeProvider({ capabilities: { branchCreate: false } })
    assert.equal(accessOf(await provider.describeCapabilities(), CapabilityKey.DevelopmentBranchCreate), 'unavailable')
    const fn = provider.createBranch
    if (fn === undefined) return
    const result = await fn.call(provider, { repository, name: 'feature/off', fromRef: expected.baseBranch })
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
    // 未声明的 change_request.read 对任何输入（含离线）都答 not_supported——能力整体不存在时结论与输入无关
    // （副作用由无故障的变更请求用例判定）。fake 永远声明 CR 读，走到 else 的是 Local Git 这类 provider。未验收的
    // 交叉组合是 fake 的 offline / permissionDenied × 先过 `gate.blocked` 的未声明可选方法（四个写方法与 getWorktree）。
    if (await declares(offline, 'listChangeRequests')) {
      const crRead = await offline.listChangeRequests({ repository, cursor: undefined, limit: 10 })
      assert.equal(crRead.ok, false)
      assert.equal(crRead.error.code, 'unavailable')
      assert.equal(crRead.error.retryable, true)
    } else {
      await assertUndeclared(offline, 'listChangeRequests', { repository, cursor: undefined, limit: 10 })
    }
  })

  test(`${label}：创建结果不确定返回 ambiguous_result，且不改动状态`, async () => {
    const provider = makeProvider({ faults: { ambiguousCreate: true } })
    // 预置分支名与请求名不同，避免「拒绝后仍不得留下对象」这条断言被预置对象污染。未声明的
    // change_request.create 在 ambiguousCreate 下也必须 not_supported（fake 先查能力再查 ambiguous）。
    if (await declares(provider, 'createBranch')) {
      const branch = await implemented(provider, 'createBranch')({ repository, name: 'feature/dup', fromRef: expected.baseBranch })
      assert.equal(branch.ok, false)
      assert.equal(branch.error.code, 'ambiguous_result')
      assert.equal(branch.error.retryable, false, '结果不确定必须先 reconcile，不能原样重发')
    } else {
      assert.notEqual(expected.worktreeBranch, 'feature/dup', '适配器预置分支不得占用这条用例请求的名字')
    }
    if (await declares(provider, 'createChangeRequest')) {
      const cr = await implemented(provider, 'createChangeRequest')(crInput(repository, expected.baseBranch, expected.baseBranch))
      assert.equal(cr.error.code, 'ambiguous_result')
    } else {
      await assertUndeclared(provider, 'createChangeRequest', crInput(repository, expected.baseBranch, expected.baseBranch))
    }
    const listed = await provider.listBranches({ repository, cursor: undefined, limit: 100 })
    assert.equal(listed.value.items.some((b) => b.name === 'feature/dup'), false, '结果不确定的创建不得留下分支')
  })
}
