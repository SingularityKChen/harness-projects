# GitHub review runner

How a pull request marked **ready for review** turns into a read-only DSH review session on this machine — without exposing anything to the internet.

Step 7 of [`docs/review/README.md`](README.md) describes the same capability through a public webhook: GitHub pushes an HTTPS request to a URL you register. That route needs an inbound path (a tunnel or reverse proxy). This document describes the route actually in use here, which needs none.

## 1. Why this shape

The two directions are not interchangeable:

| | Who initiates | Needs an inbound route? |
|---|---|---|
| Self-hosted CI runner | The runner polls GitHub over an outbound long-poll and receives jobs | No |
| Webhook | GitHub POSTs to a URL you register | Yes |

DSH ships only the webhook half: a loopback endpoint that waits to be called (its webhook runtime has no polling, no queue and no replay). A self-hosted Actions runner supplies the missing half — it holds the outbound connection, and the job it receives posts the event to that loopback endpoint. GitHub never has to reach this machine.

## 2. The path

```text
PR marked ready for review
  → GitHub event (outbound long-poll already held by the runner)
  → self-hosted runner executes .github/workflows/github-review.yml
  → signed POST to http://127.0.0.1:3081/github
  → DSH webhook endpoint verifies the signature, schedules the rule call
  → rule matches repository + action, returns a session request
  → read-only review session in the repository workspace
```

Trigger details that matter:

- `pull_request_target` with `types: [ready_for_review]`: the workflow definition always comes from the default branch, so a pull request cannot change what runs on the machine. The pull request's code is never checked out and never executed.
- The job is restricted to pull requests **from this repository** (`head.repo.full_name == github.repository`); an outside contribution cannot make this machine start sessions.
- The event payload is signed byte-for-byte from `github.event_path` — the endpoint verifies the signature over the exact request body.
- `202` means "signature and JSON accepted, rule call scheduled". It does **not** mean the rule matched or that a session was created. A wrong repository or a different action is accepted and then ignored.

## 3. Components on this machine

| Piece | Location | Notes |
|---|---|---|
| Runner | `~/actions-runner-dsh/` | Registered to `SingularityKChen/harness-projects` with labels `self-hosted,macos,arm64,dsh`; runs as a launchd service |
| Webhook secret | `~/.dsh/.credentials.yaml` (`refs.DSH_GITHUB_WEBHOOK_SECRET`) and the repository secret of the same name | The two must hold the same value: the workflow signs with the repository secret, the endpoint verifies with the local credential |
| Overlay | `~/.dsh/profiles/web/github-review.overlay.yml` + `github-ready-review-rule.mjs` beside it | Pins the repository, the workspace path and port 3081; values are literals, no `!!js` |
| Workflow | `.github/workflows/github-review.yml` | Forwards the event to the local endpoint |

The rule itself is upstream's `github-ready-review-rule.mjs`, unmodified: the repository is configuration, not code, so the file can be replaced when upstream changes it.

## 4. Operating it

```bash
# Is the runner online?
gh api repos/SingularityKChen/harness-projects/actions/runners \
  --jq '.runners[] | "\(.name)\t\(.status)\tlabels=\([.labels[].name]|join(","))"'

# Is the local endpoint listening? Expect 400/415 for a malformed request;
# 000 or "connection refused" means the overlay is not loaded.
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3081/github

# Start DSH with the overlay (the endpoint only exists while this is running)
dsh web --patch ~/.dsh/profiles/web/github-review.overlay.yml

# Runner service, if it stops
cd ~/actions-runner-dsh && ./svc.sh status   # or: ./svc.sh start | stop
```

**Failure modes worth knowing**

- Endpoint down (DSH not running with the overlay): the workflow fails with a clear message naming the endpoint. Nothing else is affected — the runner is not a gate, and no PR check depends on it.
- Runner offline: the event is queued by GitHub while the runner is disconnected, then delivered on reconnect.
- Signature mismatch (local credential and repository secret out of step): the endpoint answers `401` and the workflow fails.
- The session is created in a repository workspace; the endpoint accepts an absolute path only, and the workspace is created on first use.

## 5. Security posture

- **No inbound exposure.** Nothing is listening on a public interface; the runner talks out, the workflow talks to loopback.
- **The workflow cannot be replaced by a pull request.** `pull_request_target` keeps the definition on the default branch, and the job never checks out or runs pull-request code — it only reads the event payload.
- **Scope of the secret.** `DSH_GITHUB_WEBHOOK_SECRET` authenticates the local endpoint only. It grants no outbound GitHub access, and the review session it starts runs under the `read-only` permission preset.
- **The session never writes.** The prompt forbids modifying files, branches, the pull request or GitHub state, and marks the event payload as untrusted metadata that must be refreshed from live data.
- **Self-hosted runners on a public repository** are the risk to respect: any workflow change that reaches this runner executes on this machine. That is why the trigger is `pull_request_target` (default-branch definition), why the same-repository guard is present, and why repository settings should keep *Require approval for all outside collaborators* on the runner's fork-pull-request policy.
