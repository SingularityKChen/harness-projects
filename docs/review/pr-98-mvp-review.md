# PR #98 MVP review

- PR: https://github.com/SingularityKChen/harness-projects/pull/98
- Locked head: `594893e5c2d09fdc70b32474c0d60dae9943a4`
- Base: `main`
- Scope: #96 — use each PR's declared base for Rule checks
- Review mode: complete matrix before one GitHub review submission

## Risk matrix

| Severity | Code | Product closure | Architecture | Tests | Issue / acceptance | Result |
|---|---|---|---|---|---|---|
| P0 | No destructive write, release corruption, or main-breaking path found | Advisory Rule checks do not mutate planning or provider state | Base selection is explicit and remains in workflow -> script contract; no provider or UI boundary crossed | Full contract suite for the changed checker passes | #96 scope is coherent and independently reversible | None |
| P1 | `size` uses three-dot PR range; `disclosure` uses tree three-dot plus commit two-dot scan; base output is self-describing | Stacked PRs are measured against their own declared base; base-not-main PRs now receive Rule checks | Removing `branches` decouples trigger admission from measurement baseline; host remains authority and checks remain advisory | 51/51 rule-check tests, real-git base-advance test, workflow-check, CI green | #96 acceptance items 1–8 and adversarial checks are evidenced; item 9 correctly remains post-merge | None |
| P2 | No concrete defect with MVP impact found | `ci.yml` still limits Verify/Fast Gate to base `main`; this is explicitly out of #98 scope and remains a separate delivery risk | `normalizeBaseRef` is display-only and does not change judgement; no boundary break demonstrated | No missing test that invalidates the implemented invariant | The known stacked CI gate gap must remain visible and must not be read as “green” | Follow-up, not blocker |
| P3 | Documentation is large but within the documented limit and records limitations | Historical run/API caveats are useful for reproducibility | No dependency-direction violation | Local `pnpm verify` unavailable because detached worktree lacks `node_modules`; GitHub CI is current evidence | Post-merge base-not-main event validation remains pending | Informational |

## Evidence

- `node --test tests/contract/rule-checks.test.js`: 51/51 passed.
- `node scripts/workflow-check.mjs`: no findings.
- `node scripts/rule-checks.mjs size origin/main`: 310 code / 298 docs, within limits.
- `node scripts/rule-checks.mjs disclosure origin/main`: mechanical scan passed.
- `git diff --check origin/main...HEAD`: passed.
- GitHub current checks for the locked head: Verify, PR Fast Gate, PR size, Disclosure scan, and Issue policy passed.
- Local `pnpm verify` could not start because `tsc` is unavailable in the detached worktree; this is an environment limitation, not a code failure.

## Review decision

No P0/P1/P2 inline finding is submitted. The PR is reviewable for merge after the repository's normal human approval and the documented post-merge base-not-main event readback. The remaining stacked `ci.yml` gate gap is a separate issue and should not be silently folded into #98.
