# PR #472 具名负控重放定义

2026-11-02 SGT，产品source `a1a3a88c46f9dadf679b7c421af17ebce9c1d7a1`；下表保留id、路径、完整anchor、replacement与killedBy，不依赖本机路径或ignored日志。三个来源分别计算，不把重复职责相加为独立产品能力。当前最终文档head的产品与该source逐字一致。

## 来源与历史执行归属

- 作者原十三项在ignored Core/UI副本执行；原command使用Node `--import`重定向到同source副本，再运行下列五个正式测试文件。十三项均具名KILLED；父Planning两项映射至SharedDisposition/round寿命，postwrite映射到已claim之后许可版本，不假称旧anchor仍可施加。
- 作者新增五项同副本、同正式测试集合执行，五项具名KILLED。初次fullread观察控被其它时间戳失败遮蔽后，保留原始失败并加强正式同版本rollback对照；最终指定用例确实RED，归因修正后才记有效。
- 独立评审六项在完整source归档使用 `node scripts/review-mutate.mjs <causal-spec.json> --root <snapshot>`，spec原command为 `node --test --test-reporter=tap --test-timeout=30000 tests/integration/runtime-delivery-access.test.js tests/integration/reviewer-c1.test.mjs tests/integration/reviewer-c2-double.test.mjs tests/integration/reviewer-causal-controls.test.mjs`。后三个是评审临时探针；六项具名KILLED，805文件还原一致。下方六项保留同id/anchor/replacement，仅把LOCAL-MASK与FRESH-PROOF-RELEASE的killedBy从原探针名映射到等价正式case，其它四名不变；两项原→新killedBy为 `actual guarded repository reads` → `delayed committed marker acknowledgement`，以及 `two failed actual denial settlements` → `after two failed actual refusals`。这是可公开正式重放版，不冒称独立评审当时用了此新command。

## 在隔离归档重放

不要在产品owner工作树执行。于检出 `fix/operation-runtime-browser` 的工作树根先 `git archive HEAD` 导出到独立快照，复制各JSON代码块为该快照中的 `author-thirteen.json`、`author-five.json`、`reviewer-six.json`，并在快照根运行 `pnpm install --frozen-lockfile`。工作区依赖必须解析到该快照，不能链接回owner。

三份spec的共同command如下；JSON里保留完整argv，因此`review-mutate.mjs`不经过shell。各项anchor必须恰好匹配一次，基线GREEN、每项指定用例KILLED、逐字还原后GREEN才有效，NOT_APPLIED/KILLED_OTHER均不当成功。

    node scripts/review-mutate.mjs author-thirteen.json --root .
    node scripts/review-mutate.mjs author-five.json --root .
    node scripts/review-mutate.mjs reviewer-six.json --root .

## 作者旧十三项：当前语义映射

```json
{
  "command": [
    "node",
    "--test",
    "--test-timeout=30000",
    "tests/integration/runtime-planning-access.test.js",
    "tests/integration/runtime-operation-access.test.js",
    "tests/integration/runtime-delivery-access.test.js",
    "tests/integration/harness-plugin-runtime-access.test.js",
    "tests/contract/ui-start-work.test.js"
  ],
  "mutants": [
    {
      "id": "P-current-readonly",
      "file": "packages/core/src/start-work.ts",
      "anchor": "if (access.error) return access.error",
      "replacement": "// Mutant: ignore shared Planning read-only disposition.",
      "killedBy": "last-cursor revalidates offline admission"
    },
    {
      "id": "P-separate-versions",
      "file": "packages/core/src/runtime-access.ts",
      "anchor": "endPlanning(round: number) { ownedPlanning.delete(round) }",
      "replacement": "endPlanning(round: number) { ownedPlanning.delete(round); epoch++ }",
      "killedBy": "older denial fences an already running ordinary offline"
    },
    {
      "id": "O-shared-actual-read",
      "file": "packages/core/src/git-provisioning.ts",
      "anchor": "const ticket = key === CapabilityKey.DevelopmentRepositoryRead ? context.runtimeAccess.captureDelivery(binding, key, target) : undefined",
      "replacement": "const ticket = undefined",
      "killedBy": "operation read denial shares durable Delivery health"
    },
    {
      "id": "O-full-facts-ack",
      "file": "packages/core/src/delivery-facts.ts",
      "anchor": "settleDelivery(ticket, false, scope.workItemId, tx)",
      "replacement": "settleDelivery(ticket, false, undefined, tx)",
      "killedBy": "recovers only after facts ack"
    },
    {
      "id": "O-current-refusal",
      "file": "packages/core/src/runtime-access.ts",
      "anchor": "currentOperationRead: (ticket: DeliveryReadTicket) => (delivery.get(address(ticket))?.denialVersion ?? 0) === (ticket.denialVersion ?? 0) && observation(ticket) === (ticket.observation ?? 0),",
      "replacement": "currentOperationRead: (_ticket: DeliveryReadTicket) => true,",
      "killedBy": "late getRepository ack obeys a newer actual refusal"
    },
    {
      "id": "O-pending-survives",
      "file": "packages/core/src/runtime-access.ts",
      "anchor": "if (supersede) health.version++",
      "replacement": "if (supersede) { health.version++; health.pending = 0 }",
      "killedBy": "operation read marker failure and late Delivery success"
    },
    {
      "id": "O-owned-cohort",
      "file": "packages/core/src/runtime-access.ts",
      "anchor": "const ownership = (ticket: DeliveryReadTicket) => JSON.stringify([address(ticket), ticket.cohort ?? cohort(delivery.get(address(ticket)))])",
      "replacement": "const ownership = (ticket: DeliveryReadTicket) => address(ticket)",
      "killedBy": "older owned read cannot hide another owner marker"
    },
    {
      "id": "O-confirmed-proof",
      "file": "packages/core/src/runtime-access.ts",
      "anchor": "if (scope !== undefined) health.confirmedVersion = health.version",
      "replacement": "// omit complete facts proof",
      "killedBy": "late actual denial versus newer facts proof"
    },
    {
      "id": "O-begin-is-not-confirmation",
      "file": "packages/core/src/runtime-access.ts",
      "anchor": "if (denied && health.confirmedVersion > (ticket.started ?? ticket.version)) return health",
      "replacement": "if (denied && health.version !== ticket.started) return health",
      "killedBy": "late actual denial versus newer operation proof"
    },
    {
      "id": "R472-M2-current-operation-denial",
      "file": "packages/core/src/runtime-access.ts",
      "anchor": "        return projectError(layer === 'permission' ? ProjectErrorCode.PermissionDenied : ProjectErrorCode.NotSupported, reason)",
      "replacement": "        return undefined // Mutant: ignore current declared denial.",
      "killedBy": "current development.branch.create rejects next I/O after preflightWorktree ack and preserves earlier facts"
    },
    {
      "id": "R472-M3-old-ack-recovers-denial",
      "file": "packages/core/src/runtime-access.ts",
      "anchor": "else if (version === current && operations.get(location)?.reason)",
      "replacement": "else if (operations.get(location)?.reason)",
      "killedBy": "late createBranch ack obeys a newer actual refusal"
    },
    {
      "id": "R472-M4-metadata-erases-intent",
      "file": "packages/ui/src/start-work-section.ts",
      "anchor": "    setOptions(undefined); setFailedRead(false); setValidated(false)",
      "replacement": "    setResult(undefined); setPending(false); setOptions(undefined); setFailedRead(false); setValidated(false)",
      "killedBy": "Unknown and Pending survive access metadata changes and retain original-key readback eligibility"
    },
    {
      "id": "O-post-write-permission-epoch",
      "file": "packages/core/src/start-work.ts",
      "anchor": "firstWrite ? request.workItemId : undefined",
      "replacement": "request.workItemId",
      "killedBy": "planning.item.read permits admitted work after createBranch ack"
    }
  ]
}
```

## 作者新增五项：本地观察义务

```json
{
  "command": [
    "node",
    "--test",
    "--test-timeout=30000",
    "tests/integration/runtime-planning-access.test.js",
    "tests/integration/runtime-operation-access.test.js",
    "tests/integration/runtime-delivery-access.test.js",
    "tests/integration/harness-plugin-runtime-access.test.js",
    "tests/contract/ui-start-work.test.js"
  ],
  "mutants": [
    {
      "id": "R10-no-local-mask",
      "file": "packages/core/src/runtime-access.ts",
      "anchor": "        if (readDenials.get(address({ bindingId: binding.ref.bindingId, key: entry.key, target }))?.cause !== undefined) return { ...entry, access: AccessLevel.Unavailable, reason: deliveryDeniedReason(entry.key) }",
      "replacement": "        // Mutant: ignore local actual refusal before its durable ack.",
      "killedBy": "delayed committed marker acknowledgement"
    },
    {
      "id": "R10-operation-observation-ABA",
      "file": "packages/core/src/runtime-access.ts",
      "anchor": "    currentOperationRead: (ticket: DeliveryReadTicket) => (delivery.get(address(ticket))?.denialVersion ?? 0) === (ticket.denialVersion ?? 0) && observation(ticket) === (ticket.observation ?? 0),",
      "replacement": "    currentOperationRead: (ticket: DeliveryReadTicket) => (delivery.get(address(ticket))?.denialVersion ?? 0) === (ticket.denialVersion ?? 0),",
      "killedBy": "without reviving an older operation"
    },
    {
      "id": "R10-fullread-observation-ABA",
      "file": "packages/core/src/runtime-access.ts",
      "anchor": "  const current = (ticket: DeliveryReadTicket) => (delivery.get(address(ticket))?.version ?? 0) === ticket.version && observation(ticket) === (ticket.observation ?? 0)",
      "replacement": "  const current = (ticket: DeliveryReadTicket) => (delivery.get(address(ticket))?.version ?? 0) === ticket.version",
      "killedBy": "older full read with the same durable version"
    },
    {
      "id": "R10-observation-token",
      "file": "packages/core/src/runtime-access.ts",
      "anchor": "      versions.push(...[...readDenials].filter(([key]) => JSON.parse(key)[2] === target).map(([key, value]) => [key, `observed:${value.observation}`]))",
      "replacement": "      // Mutant: omit uncommitted refusal generation from access token.",
      "killedBy": "operation read marker failure and late Delivery success"
    },
    {
      "id": "R10-begin-never-republishes",
      "file": "packages/core/src/runtime-access.ts",
      "anchor": "        const health = await load(ticket, tx)",
      "replacement": "        const health = await load(ticket, tx)\n        if (supersede) { health.confirmedVersion = 0; health.scopes.clear() }",
      "killedBy": "after two failed actual refusals"
    }
  ]
}
```

## 独立评审六项：正式测试重放版

```json
{
  "command": [
    "node",
    "--test",
    "--test-timeout=30000",
    "tests/integration/runtime-planning-access.test.js",
    "tests/integration/runtime-operation-access.test.js",
    "tests/integration/runtime-delivery-access.test.js",
    "tests/integration/harness-plugin-runtime-access.test.js",
    "tests/contract/ui-start-work.test.js"
  ],
  "mutants": [
    {
      "id": "CAUSAL-LOCAL-MASK",
      "anchor": "if (readDenials.get(address({ bindingId: binding.ref.bindingId, key: entry.key, target }))?.cause !== undefined)",
      "replacement": "if (false)",
      "killedBy": "delayed committed marker acknowledgement",
      "file": "packages/core/src/runtime-access.ts"
    },
    {
      "id": "CAUSAL-FRESH-PROOF-RELEASE",
      "anchor": "health.confirmedVersion > local.cause",
      "replacement": "false",
      "killedBy": "after two failed actual refusals",
      "file": "packages/core/src/runtime-access.ts"
    },
    {
      "id": "CAUSAL-OBSERVATION-MONOTONE",
      "anchor": "delete local.cause; deliveryEpoch++",
      "replacement": "readDenials.delete(address(ticket)); deliveryEpoch++",
      "killedBy": "complete proof clears a failed refusal mask without reviving an older operation",
      "file": "packages/core/src/runtime-access.ts"
    },
    {
      "id": "CAUSAL-OPERATION-CONSUMER",
      "anchor": "(delivery.get(address(ticket))?.denialVersion ?? 0) === (ticket.denialVersion ?? 0) && observation(ticket) === (ticket.observation ?? 0)",
      "replacement": "(delivery.get(address(ticket))?.denialVersion ?? 0) === (ticket.denialVersion ?? 0)",
      "killedBy": "complete proof clears a failed refusal mask without reviving an older operation",
      "file": "packages/core/src/runtime-access.ts"
    },
    {
      "id": "CAUSAL-FACT-CONSUMER",
      "anchor": "(delivery.get(address(ticket))?.version ?? 0) === ticket.version && observation(ticket) === (ticket.observation ?? 0)",
      "replacement": "(delivery.get(address(ticket))?.version ?? 0) === ticket.version",
      "killedBy": "failed actual refusal invalidates an older full read with the same durable version",
      "file": "packages/core/src/runtime-access.ts"
    },
    {
      "id": "CAUSAL-METADATA-TOKEN",
      "anchor": "versions.push(...[...readDenials].filter(([key]) => JSON.parse(key)[2] === target).map(([key, value]) => [key, `observed:${value.observation}`]))",
      "replacement": "versions.push(...[])",
      "killedBy": "operation read marker failure and late Delivery success preserve newer denied health",
      "file": "packages/core/src/runtime-access.ts"
    }
  ]
}
```

## 版本和结果门

2026-11-02 SGT，在产品与source a1逐字一致的 `62aa2da` 隔离完整归档中，owner按本页三份正式重放版JSON分别实际运行：13/13、5/5、6/6均具名KILLED，每批基线与逐字还原GREEN，三命令exit0。此项是文档归档后的新执行，不是把原作者13/5或独立6旧日志改称新结果；三个来源仍分别归属。产品完整3380+7、独立MMP及最终headCI各按其来源记录。
