# PR #85 MVP review

- Locked current head: `d5dfbcc7c72257100cf7fbf9f7e27b16306d63c6` before this review.
- Base: `feat/capability-contracts` before #80 merge propagation.
- Issue: #30.

## Risk matrix

| Severity | Code | Product closure | Architecture | Tests | Issue / acceptance | Result |
|---|---|---|---|---|---|---|
| P0 | No destructive external write found | No irreversible provider side effect | No trust-boundary escape found | No main-breaking path demonstrated | Scope is bounded | None |
| P1 | `MemoryStorage.transaction` clones state, awaits, then replaces `this.data`; overlapping commits lose writes | Fake storage can report success while dropping another confirmed write | Violates the storage transaction contract and can corrupt the host-owned fact store model | Existing rollback tests do not cover overlapping transactions; a deterministic concurrency test is missing | Blocks #30 acceptance until fixed and rechecked | **BLOCKER** |
| P2 | No additional issue found | No further product gap isolated | No further boundary gap isolated | Current non-concurrent suite passes | No extra issue action | None |
| P3 | No actionable cosmetic issue | — | — | — | — | None |

## Evidence

At lines 51–55, two overlapping transactions clone the same snapshot and assign their drafts after arbitrary async work. Reproduction: T1 writes A and pauses; T2 writes B and commits; T1 resumes; final state contains A but B is lost. Existing tests cover rollback and persistence shape but not this interleaving.

## Review decision

`REQUEST_CHANGES` submitted with one inline P1 comment at `packages/providers/fake/src/storage.ts:52`. Do not merge #85 or dependent #88 until the transaction mechanism is serialized or stale commits are rejected, with a regression test and current-head checks.
