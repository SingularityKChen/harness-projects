#!/usr/bin/env node
// Policy check for issues and pull requests.
//
//   node scripts/policy-check.mjs issue <number>
//   node scripts/policy-check.mjs pr <number>
//   node scripts/policy-check.mjs areas
//
// The rules are documented in AGENTS.md §8.7. They are advisory: the workflow publishes a check named
// "Issue policy" that is deliberately not part of branch protection.
//
// The pure functions are exported so tests/contract/issue-policy.test.js can
// exercise the rules without calling GitHub.

import { execFileSync } from 'node:child_process'
import { readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Title kinds; each maps to exactly one `kind:*` label. */
export const KINDS = ['feat', 'fix', 'docs', 'chore', 'refactor', 'test']

/**
 * Title areas. Every one of them is a real place in this repository: a package
 * under packages/ or apps/, a directory under docs/, or a process area.
 */
export const AREAS = [
  'domain',
  'capabilities',
  'core',
  'controller',
  'client',
  'ui-model',
  'ui',
  'providers',
  'storage',
  'apps',
  'tests',
  'docs',
  'adr',
  'architecture',
  'product',
  'exec-plan',
  'project-management',
  'review',
  'development',
  'ci',
  'repo',
]

export const PROCESS_AREAS = ['ci', 'repo']

/** Gate label values; §8.7 restricts `gate:*` to these two milestone markers. */
export const GATES = ['E1', 'R1']

// The TITLE regex's area group only ever accepts this shape. A directory
// whose name doesn't match it (a dotdir like `.vitepress`, an underscore
// name like `ui_kit`) can never appear in a conforming title, so it must not
// be counted as something AREAS is required to cover either — otherwise
// `missingAreas` and the "every AREAS entry parses" title test contradict
// each other: adding the dirty name to AREAS turns the title test red,
// leaving it out turns the coverage test red, and neither fixes the other.
const AREA_NAME = /^[a-z0-9-]+$/

export function requiredAreas(rootDir) {
  const packageAreas = readdirSync(path.join(rootDir, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  const docsAreas = readdirSync(path.join(rootDir, 'docs'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  return [...new Set([...packageAreas, 'apps', 'tests', 'docs', ...docsAreas, ...PROCESS_AREAS])].filter((area) =>
    AREA_NAME.test(area),
  )
}

export function missingAreas(rootDir) {
  return requiredAreas(rootDir).filter((area) => !AREAS.includes(area))
}

// Deliberately wider than KINDS: an unknown kind should be reported as such
// rather than as a malformed title.
const TITLE = /^([a-z][a-z0-9-]*)\(([a-z0-9-]+)\): (\S.*)$/
const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/

/**
 * Check an issue title against `<kind>(<area>): <imperative English summary>`.
 * @returns {string[]} one message per violation; empty means conforming.
 */
export function checkTitle(title) {
  const problems = []
  const match = TITLE.exec(title.trim())

  if (match === null) {
    problems.push(
      `title must match \`<kind>(<area>): <summary>\` — e.g. \`feat(storage): add the SQLite schema\` (got: ${JSON.stringify(title)})`,
    )
    return problems
  }

  const [, kind, area, summary] = match
  if (!KINDS.includes(kind)) problems.push(`unknown kind \`${kind}\`; expected one of ${KINDS.join(', ')}`)
  if (!AREAS.includes(area)) problems.push(`unknown area \`${area}\`; see AGENTS.md §8.7 or run node scripts/policy-check.mjs areas`)
  if (CJK.test(title)) problems.push('title must be written in English (CJK characters found)')
  if (summary.endsWith('.')) problems.push('summary must not end with a period')
  if (summary.length > 80) problems.push(`summary is ${summary.length} characters; keep it under 80`)

  return problems
}

/** The kind and area a title declares, or undefined when the title is unusable. */
export function titleParts(title) {
  const match = TITLE.exec(title.trim())
  return match === null ? undefined : { kind: match[1], area: match[2] }
}

/**
 * Check the label set: exactly one `kind:*`, at least one `area:*`, at most one
 * `gate:*`, and agreement with the prefixes the title declares.
 * @returns {string[]} one message per violation; empty means conforming.
 */
export function checkLabels(labels, title) {
  const problems = []
  const list = labels.map((label) => (typeof label === 'string' ? label : label.name))
  const of = (prefix) => list.filter((label) => label.startsWith(`${prefix}:`))

  const kinds = of('kind')
  if (kinds.length !== 1) {
    problems.push(`expected exactly one \`kind:*\` label, found ${kinds.length}${kinds.length ? ` (${kinds.join(', ')})` : ''}`)
  } else if (!KINDS.includes(kinds[0].slice('kind:'.length))) {
    problems.push(`unknown label \`${kinds[0]}\`; expected one of ${KINDS.map((k) => `kind:${k}`).join(', ')}`)
  }

  const areas = of('area')
  if (areas.length === 0) problems.push('expected at least one `area:*` label')
  for (const area of areas) {
    if (!AREAS.includes(area.slice('area:'.length))) problems.push(`unknown label \`${area}\``)
  }

  const gates = of('gate')
  if (gates.length > 1) problems.push(`expected at most one \`gate:*\` label, found ${gates.length} (${gates.join(', ')})`)
  for (const gate of gates) {
    if (!GATES.includes(gate.slice('gate:'.length))) {
      problems.push(`unknown label \`${gate}\`; expected one of ${GATES.map((g) => `gate:${g}`).join(', ')}`)
    }
  }

  for (const label of list) {
    const namespace = label.split(':')[0]
    if (!['kind', 'area', 'gate'].includes(namespace)) {
      problems.push(`label \`${label}\` is outside the vocabulary (kind:*, area:*, gate:*)`)
    }
  }

  const parts = titleParts(title)
  if (parts !== undefined) {
    if (kinds.length === 1 && kinds[0] !== `kind:${parts.kind}`) {
      problems.push(`title says kind \`${parts.kind}\` but the label is \`${kinds[0]}\``)
    }
    if (areas.length > 0 && !areas.includes(`area:${parts.area}`)) {
      problems.push(`title says area \`${parts.area}\` but no label says \`area:${parts.area}\``)
    }
  }

  return problems
}

/**
 * Strip ```-fenced code blocks so literal boilerplate inside them — a pasted
 * draft, a quoted example, §8.4's own PR template — never counts as a real
 * link. Non-greedy so multiple separate fences are each removed on their own.
 */
function stripFencedCodeBlocks(text) {
  return text.replace(/```[\s\S]*?```/g, '')
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Same-repository issue references found in a pull request body.
 *
 * Matches `#<n>` and, when `repo` (the current `<owner>/<repo>`) is given,
 * GitHub's full-URL closing syntax pointed at that same repository. A
 * cross-repo `owner/repo#12`, or a full URL to a *different* repository, is
 * deliberately not a match — a closing keyword only closes issues in the
 * repository the pull request lives in, and `#0` is never a real issue.
 *
 * @param {string} body
 * @param {string} [repo] current `<owner>/<repo>`; enables the URL form
 */
export function linkedIssues(body, repo) {
  const closes = []
  const refs = []
  const text = stripFencedCodeBlocks(body ?? '')
  const keyword = String.raw`(close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)`
  const hashRef = String.raw`#(?<hashNumber>\d+)`
  const urlRef = repo ? String.raw`https://github\.com/${escapeRegExp(repo)}/issues/(?<urlNumber>\d+)` : null
  const alternation = urlRef ? `(?:${hashRef}|${urlRef})` : hashRef
  const pattern = new RegExp(String.raw`\b${keyword}\s+${alternation}`, 'gi')

  for (const match of text.matchAll(pattern)) {
    const number = Number(match.groups.hashNumber ?? match.groups.urlNumber)
    if (!Number.isInteger(number) || number <= 0) continue // #0 is not a real issue
    const key = match[1].toLowerCase()
    const target = key.startsWith('ref') ? refs : closes
    if (!target.includes(number)) target.push(number)
  }
  return { closes, refs }
}

/**
 * Whether the link-an-issue rule (§8.3.7) applies to a pull request's author.
 *
 * The rule exists so that a change traces back to a *planned* work item. A
 * machine-opened pull request has no planned work item — the upstream release
 * is the trigger, and the pull request is the work item. Requiring an issue
 * would mean a human files one afterwards to justify a bot's change, restating
 * the pull request body. That is ceremony with no information gain, and worse:
 * the check would be permanently red on a recurring class of pull request,
 * which trains people to ignore it. An advisory check whose red is meaningless
 * is the mirror image of the "green means checked" illusion §9.2 warns about.
 *
 * Keyed on GitHub's `user.type`, not on a list of bot names: a name list is one
 * more vocabulary that has to be kept in sync by hand, which is the class of
 * problem §8.7 removed for areas.
 *
 * @returns {{exempt: boolean, reason?: string}}
 */
export function linkRuleExemption({ authorType, authorLogin }) {
  if (authorType === 'Bot') {
    return { exempt: true, reason: `author ${authorLogin ?? '<unknown>'} is a bot (§8.3.7 exemption)` }
  }
  return { exempt: false }
}

/**
 * Check a pull request body: it must name at least one same-repository issue.
 * @param {string} body
 * @param {string} [repo] current `<owner>/<repo>`; forwarded to `linkedIssues`
 *   so its full-URL closing syntax can be recognized.
 * @returns {string[]} one message per violation; empty means conforming.
 */
export function checkPullRequestBody(body, repo) {
  const { closes, refs } = linkedIssues(body ?? '', repo)
  if (closes.length + refs.length === 0) {
    return [
      'pull request body must link the issue it delivers — add `Closes #<n>` (or `Refs #<n>` when it does not complete the issue)',
    ]
  }
  return []
}

/**
 * Whether fetched pull-request metadata actually names an author.
 *
 * Every real pull request has one. A value that lacks it means the response
 * was never actually fetched — empty stdout, a response stripped by a
 * missing scope, a `--jq` filter that matched nothing — not that the author
 * genuinely left those fields blank (GitHub does not allow an authorless
 * pull request). Collapsing that into "did not write `Closes #N`" would
 * blame the contributor for a fetch failure the checker itself hit, so
 * `main()`'s `pr` branch gives it a distinct exit code instead.
 *
 * @returns {boolean}
 */
export function hasPullRequestMetadata(meta) {
  return typeof meta?.authorType === 'string' && typeof meta?.authorLogin === 'string'
}

// ── CLI ─────────────────────────────────────────────────────────────────────

/**
 * Run `gh`, exiting with the internal-error code (3) instead of letting a
 * thrown `execFileSync` reach `main()` as a bare Node stack trace under the
 * same exit code (1) as a rule violation. A non-zero `gh` exit — expired
 * auth, rate limiting, a network failure, or a pull request that links an
 * issue which was deleted or transferred — is an infrastructure failure the
 * checker hit, not something the contributor did wrong. Mirrors
 * `parseFetchedJson`'s sibling case (output received but unparseable). Real
 * repro: `node scripts/policy-check.mjs issue 999999` → `gh` exits non-zero
 * with `gh: Not Found (HTTP 404)`.
 */
function gh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8' })
  } catch (error) {
    console.error(`could not run gh ${args.join(' ')}: ${error.message}`)
    process.exit(3)
  }
}

function repository() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY
  // Prefer the checkout over an API round trip: this must work offline and the
  // answer is already in .git/config. Handles both SSH and HTTPS remotes.
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
    const match = /(?:[:/])([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url)
    if (match) return match[1]
  } catch {
    // fall through to the API
  }
  return gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).trim()
}

/**
 * Parse a `gh` response, exiting with the internal-error code (3) instead of
 * throwing a raw stack trace when it can't be parsed — empty stdout (a
 * missing scope, a `--jq` miss) and garbage output both land here rather
 * than being reported as a rule violation, so CI can tell "could not check"
 * apart from "non-conforming" (see `hasPullRequestMetadata` for the other
 * half: a response that parses fine but is missing the fields it should
 * always have).
 */
function parseFetchedJson(raw, description) {
  try {
    return JSON.parse(raw)
  } catch (error) {
    console.error(`could not read ${description}: ${error.message}`)
    process.exit(3)
  }
}

function fetchIssue(repo, number) {
  const raw = gh(['api', `repos/${repo}/issues/${number}`, '--jq', '{number, title, labels: [.labels[].name]}'])
  return parseFetchedJson(raw, `issue #${number}`)
}

function fail(messages) {
  for (const message of messages) console.error(`::error::${message}`)
  console.error(`\n${messages.length} problem(s) found. See AGENTS.md §8.7 or run node scripts/policy-check.mjs areas.`)
  process.exit(1)
}

function main(argv) {
  const [mode, number] = argv

  if (mode === 'areas' && number === undefined) {
    for (const area of [...AREAS].sort()) console.log(area)
    return
  }

  const repo = repository()

  if (mode === 'issue' && number) {
    const issue = fetchIssue(repo, number)
    const problems = [...checkTitle(issue.title), ...checkLabels(issue.labels, issue.title)]
    if (problems.length > 0) fail(problems)
    console.log(`#${issue.number} conforms: ${issue.title}`)
    return
  }

  if (mode === 'pr' && number) {
    const raw = gh(['api', `repos/${repo}/pulls/${number}`, '--jq', '{body: .body, authorType: .user.type, authorLogin: .user.login}'])
    const meta = parseFetchedJson(raw, `pull request #${number}`)

    if (!hasPullRequestMetadata(meta)) {
      // Parsed fine but has no author — every real pull request has one, so
      // this is a response that was never actually fetched (empty stdout, a
      // missing scope, a `--jq` miss), not a contributor who wrote nothing.
      console.error(`could not read pull request #${number}: response is missing author metadata`)
      process.exit(3)
    }

    const exemption = linkRuleExemption(meta)
    if (exemption.exempt) {
      console.log(`#${number} skipped: ${exemption.reason}`)
      return
    }

    const body = meta.body
    const problems = checkPullRequestBody(body, repo)
    if (problems.length > 0) fail(problems)

    const { closes, refs } = linkedIssues(body, repo)
    const nested = []
    for (const linked of closes) {
      const issue = fetchIssue(repo, linked)
      nested.push(...checkTitle(issue.title).map((p) => `linked issue #${linked}: ${p}`))
      nested.push(...checkLabels(issue.labels, issue.title).map((p) => `linked issue #${linked}: ${p}`))
    }
    if (nested.length > 0) fail(nested)

    const named = [...closes.map((n) => `Closes #${n}`), ...refs.map((n) => `Refs #${n}`)].join(', ')
    console.log(`#${number} conforms: links ${named}`)
    return
  }

  console.error('usage: node scripts/policy-check.mjs areas | issue <number> | pr <number>')
  process.exit(2)
}

/**
 * Whether this file is being executed directly as a CLI, not merely imported.
 *
 * `process.argv[1]?.endsWith('policy-check.mjs')` fails open on any rename:
 * copy the script to an extensionless name and both `areas` and a no-argument
 * invocation silently exit 0 instead of running or printing usage, because
 * the guard never calls `main()`. Compare realpaths instead, mirroring
 * scripts/workflow-check.mjs's `invokedDirectly()`.
 */
function invokedDirectly() {
  const entry = process.argv[1]
  if (entry === undefined) return false

  const self = fileURLToPath(import.meta.url)
  try {
    return realpathSync(entry) === realpathSync(self)
  } catch {
    return path.basename(entry) === path.basename(self)
  }
}

if (invokedDirectly()) main(process.argv.slice(2))
