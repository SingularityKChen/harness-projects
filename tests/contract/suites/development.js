/**
 * Development 契约套件：接受任意 DevelopmentProvider 适配器 `{ label, makeProvider(scenario), expect }`。
 * scenario 由本套件定义，适配器负责翻译成自己的构造参数：`{}` 全能力无故障；
 * `{ capabilities: { branchCreate: false } }` 可选能力未启用；`{ faults: { permissionDenied: true } }`
 * 权限被拒；`{ faults: { offline: true } }` 离线；`{ faults: { ambiguousCreate: true } }` 创建结果不确定。
 * `expect`：`{ repository, baseBranch, headCommit, pageSize, worktreePath }`。
 *
 * 看护的不变量（tests/README.md §2.5、§3）：分支与工作树创建后可读回；变更请求创建后可读回；原生
 * 谱系——变更请求的 sourceVersion 就是它头部提交的 sha，所以 工作树→分支→提交→变更请求 一路都能
 * 按外部 id 读回，调用方不需要重新识别对象；失败是结构化结果而不是裸错误。两个身份闸门同样是契约：
 * 外来 binding 的仓库引用必须 not_found 而不是静默空页 / 静默创建；同一路径重复创建工作树必须
 * conflict 而不是静默复用。
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { CapabilityKey, effectiveCapabilities } from '@harness-projects/capabilities'

const accessOf = (snapshot, key) => effectiveCapabilities(snapshot).find((c) => c.key === key)?.access ?? 'unavailable'
const refFor = (repository, objectKind, externalId) => ({ ...repository, objectKind, externalId })
const crInput = (repository, head, base) => ({ repository, head, base, title: '标题占位', body: '正文占位' })

export function developmentContractSuite(adapter) {
  const { label, makeProvider, expect: expected } = adapter
  const repository = expected.repository

  test(`${label}：创建分支后可读回，并继承起点分支的头部提交`, async () => {
    const provider = makeProvider({})
    const created = await provider.createBranch({ repository, name: 'feature/one', fromRef: expected.baseBranch })
    assert.equal(created.ok, true)
    assert.equal(created.value.headCommit, expected.headCommit)
    const found = await provider.getRepository(repository)
    assert.equal(found.ok, true, '仓库身份必须能按外部 id 读回')
    assert.equal(found.value.defaultBranch, expected.baseBranch)
    const listed = await provider.listBranches({ repository, cursor: undefined, limit: 100 })
    assert.ok(listed.value.items.some((branch) => branch.ref.externalId === created.value.ref.externalId))
  })

  test(`${label}：工作树创建后可定位，移除后查不到而不是静默成功`, async () => {
    const provider = makeProvider({})
    await provider.createBranch({ repository, name: 'feature/wt', fromRef: expected.baseBranch })
    const created = await provider.createWorktree({ repository, path: expected.worktreePath, branch: 'feature/wt' })
    assert.equal(created.ok, true)
    assert.equal(created.value.branch, 'feature/wt')
    assert.equal(created.value.path, expected.worktreePath)
    assert.equal((await provider.removeWorktree({ worktree: created.value.ref })).ok, true)
    const again = await provider.removeWorktree({ worktree: created.value.ref })
    assert.equal(again.ok, false)
    assert.equal(again.error.code, 'not_found')
  })

  test(`${label}：变更请求创建后可读回并进入列表`, async () => {
    const provider = makeProvider({})
    const created = await provider.createChangeRequest(crInput(repository, expected.baseBranch, expected.baseBranch))
    assert.equal(created.ok, true)
    assert.equal(created.value.ref.objectKind, 'change_request')
    assert.ok(created.value.number > 0, '变更请求必须带编号')
    assert.deepEqual((await provider.getChangeRequest(created.value.ref)).value, created.value)
    const listed = await provider.listChangeRequests({ repository, cursor: undefined, limit: 100 })
    assert.ok(listed.value.items.some((item) => item.ref.externalId === created.value.ref.externalId))
  })

  test(`${label}：原生谱系——变更请求版本锚定头部提交，可沿分支找回`, async () => {
    const provider = makeProvider({})
    const branch = await provider.createBranch({ repository, name: 'feature/lineage', fromRef: expected.baseBranch })
    const created = await provider.createChangeRequest(crInput(repository, 'feature/lineage', expected.baseBranch))
    assert.equal(created.ok, true)
    assert.equal(created.value.sourceVersion, branch.value.headCommit, '变更请求的 source version 必须就是它头部的提交')
    const cr = await provider.getChangeRequest(created.value.ref)
    const commit = await provider.getCommit(refFor(repository, 'commit', cr.value.sourceVersion))
    assert.equal(commit.ok, true, '沿变更请求版本必须能读到同一个提交，不需要重新识别')
    assert.equal(commit.value.sha, branch.value.headCommit)
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
      await provider.createBranch({ repository: foreign, name: 'feature/foreign', fromRef: expected.baseBranch }),
      await provider.createWorktree({ repository: foreign, path: expected.worktreePath, branch: 'feature/foreign' }),
      await provider.createChangeRequest(crInput(foreign, expected.headCommit, expected.baseBranch)),
    ]
    for (const result of [...reads, ...writes]) {
      assert.equal(result.ok, false, '外来仓库引用必须结构化失败，而不是静默空页或静默写入')
      assert.equal(result.error.code, 'not_found')
    }
    const branches = await provider.listBranches({ repository, cursor: undefined, limit: 100 })
    assert.equal(branches.value.items.some((branch) => branch.name === 'feature/foreign'), false, '被拒的外来写入不得落进本 binding 的仓库')
  })

  test(`${label}：同一路径重复创建工作树返回 conflict，不静默复用`, async () => {
    const provider = makeProvider({})
    await provider.createBranch({ repository, name: 'feature/wt-dup', fromRef: expected.baseBranch })
    const first = await provider.createWorktree({ repository, path: expected.worktreePath, branch: 'feature/wt-dup' })
    assert.equal(first.ok, true)
    const again = await provider.createWorktree({ repository, path: expected.worktreePath, branch: 'feature/wt-dup' })
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
      offline.listChangeRequests({ repository, cursor: undefined, limit: 10 }),
    ])
    for (const result of reads) {
      assert.equal(result.ok, false)
      assert.equal(result.error.code, 'unavailable')
      assert.equal(result.error.retryable, true)
    }
  })

  test(`${label}：创建结果不确定返回 ambiguous_result，且不改动状态`, async () => {
    const provider = makeProvider({ faults: { ambiguousCreate: true } })
    const branch = await provider.createBranch({ repository, name: 'feature/dup', fromRef: expected.baseBranch })
    assert.equal(branch.ok, false)
    assert.equal(branch.error.code, 'ambiguous_result')
    assert.equal(branch.error.retryable, false, '结果不确定必须先 reconcile，不能原样重发')
    const cr = await provider.createChangeRequest(crInput(repository, expected.baseBranch, expected.baseBranch))
    assert.equal(cr.error.code, 'ambiguous_result')
    const listed = await provider.listBranches({ repository, cursor: undefined, limit: 100 })
    assert.equal(listed.value.items.some((b) => b.name === 'feature/dup'), false)
  })
}
