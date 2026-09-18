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
import { readdirSync } from 'node:fs'
import path from 'node:path'

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

export function requiredAreas(rootDir) {
  const packageAreas = readdirSync(path.join(rootDir, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  const docsAreas = readdirSync(path.join(rootDir, 'docs'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  return [...new Set([...packageAreas, 'apps', 'tests', 'docs', ...docsAreas, ...PROCESS_AREAS])]
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

/** Same-repository issue references found in a pull request body. */
export function linkedIssues(body) {
  const closes = []
  const refs = []
  for (const [, keyword, number] of body.matchAll(/\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\s+#(\d+)/gi)) {
    const key = keyword.toLowerCase()
    const target = key.startsWith('ref') ? refs : closes
    if (!target.includes(Number(number))) target.push(Number(number))
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
 * @returns {string[]} one message per violation; empty means conforming.
 */
export function checkPullRequestBody(body) {
  const { closes, refs } = linkedIssues(body ?? '')
  if (closes.length + refs.length === 0) {
    return [
      'pull request body must link the issue it delivers — add `Closes #<n>` (or `Refs #<n>` when it does not complete the issue)',
    ]
  }
  return []
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' })
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

function fetchIssue(repo, number) {
  return JSON.parse(
    gh(['api', `repos/${repo}/issues/${number}`, '--jq', '{number, title, labels: [.labels[].name]}']),
  )
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
    let meta
    try {
      meta = JSON.parse(raw)
    } catch (error) {
      // An unparseable response means the pull request was never read. Fail
      // loudly rather than reporting it as the contributor's policy violation.
      console.error(`could not read pull request #${number}: ${error.message}`)
      process.exit(3)
    }

    const exemption = linkRuleExemption(meta)
    if (exemption.exempt) {
      console.log(`#${number} skipped: ${exemption.reason}`)
      return
    }

    const body = meta.body
    const problems = checkPullRequestBody(body)
    if (problems.length > 0) fail(problems)

    const { closes, refs } = linkedIssues(body)
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

if (process.argv[1]?.endsWith('policy-check.mjs')) main(process.argv.slice(2))
