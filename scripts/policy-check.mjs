#!/usr/bin/env node
// Policy check for issues and pull requests.
//
//   node scripts/policy-check.mjs issue <number>
//   node scripts/policy-check.mjs pr <number>
//   node scripts/policy-check.mjs areas
//
// The rules are documented in docs/development/repository-rules.md §4. They are advisory: the workflow publishes a check named
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
  if (!AREAS.includes(area)) problems.push(`unknown area \`${area}\`; see docs/development/repository-rules.md §4 or run node scripts/policy-check.mjs areas`)
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

/**
 * Strip HTML comments. A comment renders to nothing, so a reference inside one
 * is invisible to every reader of the pull request and creates no link — yet
 * before this it satisfied the check. The realistic form is a reviewer
 * commenting a line out as a note to self, or §8.4's own template copied with
 * `N` replaced by a real number but the line left inside the comment.
 *
 * Note this is a different statement from "`<!-- Closes #N -->` is rejected":
 * that holds only because the literal `N` is not a digit, which says nothing
 * about comments being understood. A real number needed this step.
 *
 * An unclosed `<!--` runs to the end of the input rather than not matching at
 * all, matching CommonMark/GitHub rendering: on GitHub an unterminated
 * comment swallows the rest of the body (nothing after it renders), and
 * "commenting a line out mid-edit and not finishing the close" is a common
 * real instance of exactly this. `(?:-->|$)` lets the lazy scan stop at a real
 * close when one exists — unchanged from before — and fall through to
 * end-of-string when one never comes.
 */
function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
}

/**
 * Strip inline code spans, for the same reason as fences: a code span renders
 * as literal text, so it *shows* the string rather than *declaring* a link.
 *
 * Bounded to a single line and to balanced backtick runs, so an odd stray
 * backtick cannot swallow the rest of the body. That direction is deliberate:
 * over-stripping would drop a real link and turn the check red on a conforming
 * pull request, which is the failure mode §8.3.7 warns trains people to ignore
 * an advisory check. The cost this buys: CommonMark allows a code span to
 * span a newline, so one that does (`` `Closes\n#12` ``) is a false green here
 * — the reference inside still counts as linked — which is accepted rather
 * than fixed because the check is advisory and the miss is narrow.
 */
function stripInlineCode(text) {
  return text.replace(/(`+)[^\n]*?\1/g, '')
}

/**
 * Remove the contexts in which an issue reference does not take effect, before
 * the keyword match runs. Exported so each form can be asserted on its own.
 *
 * Order is load-bearing and is asserted by a test:
 *
 *  1. fenced code blocks — a fence is a CommonMark leaf block, so a `<!--` or a
 *     backtick inside one is literal text, not the start of a construct.
 *     Stripping comments first would let an unterminated `<!--` inside a fence
 *     run on to the next real `-->` and swallow a genuine link in between.
 *  2. HTML comments.
 *  3. inline code — its delimiter is a prefix of the fence delimiter, so it has
 *     to run after fences or it would eat the fence markers themselves.
 *
 * Block quotes are deliberately *not* stripped: they render as visible prose
 * and GitHub's closing keywords take effect inside them, so removing them would
 * fail a pull request whose issue GitHub really does close.
 */
export function stripIneffectiveContexts(text) {
  return stripInlineCode(stripHtmlComments(stripFencedCodeBlocks(text ?? '')))
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Same-repository issue references found in a pull request body.
 *
 * Matches `#<n>` and, when `repo` (the current `<owner>/<repo>`) is given,
 * two more forms GitHub recognizes for that *same* repository: the full
 * closing URL and the `owner/repo#<n>` long form. A cross-repo
 * `owner/repo#12`, or a full URL to a *different* repository, is
 * deliberately not a match — a closing keyword only closes issues in the
 * repository the pull request lives in, and `#0` is never a real issue.
 *
 * The keyword may also be followed by a colon: GitHub's "Linking a pull
 * request to an issue" documents "The keywords can be followed by colons or
 * in uppercase" with `Closes: #10`, `CLOSES #10`, and `CLOSES: #10` as its
 * own examples.
 *
 * @param {string} body
 * @param {string} [repo] current `<owner>/<repo>`; enables the URL and
 *   `owner/repo#<n>` forms
 */
export function linkedIssues(body, repo) {
  const closes = []
  const refs = []
  const text = stripIneffectiveContexts(body)
  const keyword = String.raw`(close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)`
  const hashRef = String.raw`#(?<hashNumber>\d+)`
  const urlRef = repo ? String.raw`https://github\.com/${escapeRegExp(repo)}/issues/(?<urlNumber>\d+)` : null
  const longRef = repo ? String.raw`${escapeRegExp(repo)}#(?<longNumber>\d+)` : null
  const alternation = repo ? `(?:${hashRef}|${urlRef}|${longRef})` : hashRef
  const pattern = new RegExp(String.raw`\b${keyword}:?\s+${alternation}`, 'gi')

  for (const match of text.matchAll(pattern)) {
    const number = Number(match.groups.hashNumber ?? match.groups.urlNumber ?? match.groups.longNumber)
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

/**
 * Check the object `issue <n>` names, which must actually be an issue.
 *
 * A pull request number is a legal input to GitHub's issues API — a pull
 * request *is* an issue there, the same endpoint returns it — so `issue 12` on
 * a pull request used to run the title and label rules against it and report
 * violations that can never be fixed: a pull request title is a Chinese
 * summary by convention, so the English rule fires on every one of them, and a
 * pull request that carries no `kind:*` / `area:*` labels adds the other two
 * (measured: three on #12, one on #100 and #103, which do carry them). An
 * advisory check that is permanently red on a whole class of input is the
 * "green means checked" illusion §9.2 warns about, mirrored.
 *
 * The object kind comes from the platform's `pull_request` field, never from
 * the shape of the number: guessing by size or by title language would misfire
 * on real issues.
 *
 * @param {number} number
 * @param {{title: string, labels: string[], isPullRequest?: boolean}} meta
 * @returns {string[]} one message per violation; empty means conforming.
 */
export function checkIssueTarget(number, meta) {
  if (meta?.isPullRequest) {
    return [`#${number} is a pull request, not an issue — use \`pr ${number}\``]
  }
  return [...checkTitle(meta.title), ...checkLabels(meta.labels, meta.title)]
}

/**
 * Check one `Closes #<n>` target of a pull request body: it must be an issue.
 *
 * `Refs #<n>` never reaches this function, on purpose. A reference means
 * "related", and pointing one at another pull request is a legal and common
 * cross reference, so rejecting it would trade this false positive for a
 * second one — and would widen §8.3.7 from "must link an issue" into "must not
 * mention a pull request".
 *
 * @param {number} number
 * @param {{title: string, labels: string[], isPullRequest?: boolean}} meta
 * @returns {string[]} one message per violation; empty means conforming.
 */
export function checkCloserTarget(number, meta) {
  if (meta?.isPullRequest) {
    // Name the whole closing-keyword family rather than `Closes` alone:
    // linkedIssues matches close[sd]?|fix(?:e[sd])?|resolve[sd]?, so a body
    // writing `Fixes #12` would otherwise be told about a keyword it never used
    // — in the one message that is the entire product of this check.
    return [
      `linked #${number} is a pull request; a closing keyword (\`Closes\` / \`Fixes\` / \`Resolves\`) must name an issue — use \`Refs #${number}\` to cross-reference it`,
    ]
  }
  return [
    ...checkTitle(meta.title).map((problem) => `linked issue #${number}: ${problem}`),
    ...checkLabels(meta.labels, meta.title).map((problem) => `linked issue #${number}: ${problem}`),
  ]
}

/**
 * Whether fetched issue metadata is shaped like an issue.
 *
 * Mirrors `hasPullRequestMetadata`. Every real issue carries a title and a
 * labels array, so a response that parses but lacks either was never actually
 * fetched — empty stdout, a missing scope, a `--jq` miss — not an issue that
 * genuinely has neither. The distinction is contractual (exit 3 = could not
 * check, exit 1 = checked and it violates); dereferencing undefined would
 * report a fetch failure as a rule violation and surface as a bare Node stack
 * instead of an `::error::`.
 *
 * @returns {boolean}
 */
export function hasIssueMetadata(meta) {
  return typeof meta?.title === 'string' && Array.isArray(meta?.labels)
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
  const raw = gh([
    'api',
    `repos/${repo}/issues/${number}`,
    '--jq',
    '{number, title, labels: [.labels[].name], isPullRequest: (.pull_request != null)}',
  ])
  return parseFetchedJson(raw, `issue #${number}`)
}

function fail(messages) {
  for (const message of messages) console.error(`::error::${message}`)
  console.error(`\n${messages.length} problem(s) found. See docs/development/repository-rules.md §4 or run node scripts/policy-check.mjs areas.`)
  process.exit(1)
}

/**
 * Report a usage error (exit 2) rather than a rule violation (exit 1): the
 * object under check has nothing wrong with it, the caller asked about the
 * wrong kind of object. Pointing at the title and label rules here would send
 * the reader to fix a title that no rule applies to.
 */
function usageError(messages) {
  for (const message of messages) console.error(`::error::${message}`)
  process.exit(2)
}

/**
 * Report a response that parsed but is not shaped like the object it claims to
 * be (exit 3), rather than letting a missing field become a rule violation.
 */
function unreadable(what) {
  console.error(`could not read ${what}: response is missing issue metadata`)
  process.exit(3)
}

function runIssue(repo, number) {
  const issue = fetchIssue(repo, number)
  if (!hasIssueMetadata(issue)) unreadable(`issue #${number}`)
  const problems = checkIssueTarget(issue.number, issue)
  if (problems.length === 0) {
    console.log(`#${issue.number} conforms: ${issue.title}`)
    return
  }
  if (issue.isPullRequest) usageError(problems)
  fail(problems)
}

/** Check every `Closes #<n>` target; `refs` is deliberately left unchecked. */
function closerProblems(repo, closes) {
  return closes.flatMap((number) => {
    const issue = fetchIssue(repo, number)
    if (!hasIssueMetadata(issue)) unreadable(`linked issue #${number}`)
    return checkCloserTarget(number, issue)
  })
}

function runPullRequest(repo, number) {
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
  const nested = closerProblems(repo, closes)
  if (nested.length > 0) fail(nested)

  const named = [...closes.map((n) => `Closes #${n}`), ...refs.map((n) => `Refs #${n}`)].join(', ')
  console.log(`#${number} conforms: links ${named}`)
}

function main(argv) {
  const [mode, number] = argv

  if (mode === 'areas' && number === undefined) {
    for (const area of [...AREAS].sort()) console.log(area)
    return
  }

  const repo = repository()

  if (mode === 'issue' && number) return runIssue(repo, number)
  if (mode === 'pr' && number) return runPullRequest(repo, number)

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
