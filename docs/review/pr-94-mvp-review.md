# PR #94 MVP review

- Locked head: `b9d6faf1bb940c1ef03a325cea5b8e08b5e260a5`
- Base: `feat/core-start-work`
- Issue: #78
- First-review correction: the prior pass accepted the positive lineage test and did not run the negative “no bootstrap/startWork” state-machine path.

## Risk matrix

| Severity | Code | Product closure | Architecture | Tests | Issue / acceptance | Result |
|---|---|---|---|---|---|---|
| P0 | No destructive external write found | No irreversible side effect demonstrated | No provider/UI boundary escape found | No main-breaking path found | Scope is bounded | None |
| P1 | `getDeliveryProjection()` records every `chainEdges(facts)` edge, including `observed=false` chain skeletons | A never-observed delivery chain is presented as existing lineage; MVP-0 nodes 6/7 can pass without bootstrap/startWork | Inferred topology crosses the fact/observation boundary and becomes stored relation state | Positive tests cover a completed chain; no negative empty-chain test on this head | #78 acceptance must require no hops/relations before real observations | **BLOCKER** |
| P2 | No separate issue found | — | — | — | — | None |
| P3 | No actionable cosmetic issue | — | — | — | — | None |

## Evidence

At `packages/core/src/delivery.ts:131–133`, `chainEdges(facts)` is passed directly to `recordEdges`. The later #95 fix filters `edge.artifact.observed`; that repair is absent from this locked #94 head. The negative path must assert a fresh core with no bootstrap/startWork returns no observed lineage and stores no skeleton relations.

## Review decision

One P1 inline blocker is submitted at `packages/core/src/delivery.ts:132`. Filter unobserved skeletons before recording/returning them and add the negative MVP-0 regression test. Do not merge #94 or its dependents until fixed and rechecked.
