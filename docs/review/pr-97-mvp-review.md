# PR #97 MVP review

- PR: https://github.com/SingularityKChen/harness-projects/pull/97
- Locked head: `ac946cb09237e3a01676c5294f9072090c438cc4`
- Base: `main`
- Scope: #65 event payload path and #49 review-session concurrency
- Review mode: complete matrix before one GitHub review submission

## Risk matrix

| Severity | Code | Product closure | Architecture | Tests | Issue / acceptance | Result |
|---|---|---|---|---|---|---|
| P0 | No main-breaking, data-loss, or unrecoverable external write found | No evidence of irreversible user or provider corruption | No violation of single planning source, host ownership, or trust boundary | No missing safety gate that makes merge unsafe | No scope expansion beyond #65/#49 | None |
| P1 | Payload is now read from runner env; empty path/file fails closed; HMAC input and posted bytes remain the same | Real payload -> signed POST -> `202` path is closed locally; post-merge real-run readback remains pending by design | `pull_request_target`, empty permissions, no checkout, same-repo guard preserved; head-based dedupe matches stated invariant | 4 contract tests, mutation checks, workflow-check; exact-head CI green | #65/#49 are explicitly closed in PR description; acceptance item 7 is correctly marked post-merge | None |
| P2 | No concrete correctness defect with material MVP impact found | Queue dedupe intentionally trades duplicate PR events for one session per head | Possible cross-PR collision for identical head SHA is consistent with the stated “same code once” policy and not shown to break this product | No additional discriminating test required for current scope | CI/Fast Gate for stacked PRs is a separate known gap, not introduced here | No blocker; follow-up only if product requires per-PR sessions |
| P3 | Comments/docs are verbose but mechanically consistent | Post-merge rehearsal is documented | No boundary drift | Local full `pnpm verify` unavailable because this detached worktree has no `node_modules`; CI is current evidence | Historical failed check exists, but latest same-name check passed | Informational |

## Evidence

- `node --test tests/contract/github-review-workflow.test.js`: 4/4 passed.
- `node scripts/workflow-check.mjs`: no findings.
- `git diff --check origin/main...HEAD`: passed.
- GitHub current checks for the locked head: Verify, PR Fast Gate, PR size, Disclosure scan, and Issue policy passed.
- Local `pnpm verify` could not start because `tsc` is unavailable in the detached worktree; this is an environment limitation, not a code failure.

## Review decision

No P0/P1/P2 inline finding is submitted. The PR is reviewable for merge after the repository's normal human approval and the documented post-merge real-event readback. Do not treat the local `202` rehearsal as proof of the post-merge `pull_request_target` execution; the plan correctly leaves that as a follow-up gate.
