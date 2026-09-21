#!/usr/bin/env node

import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const API = 'https://api.github.com'
const SIGNAL_JOB_NAMES = new Set(['signal', 'Accept trusted reviewer signal'])

export function classifySignalRun({ jobs }) {
  if (!Array.isArray(jobs) || jobs.length === 0) throw new Error('触发 run 的 jobs 为空')
  const signalJobs = jobs.filter((job) => job?.id === 'signal' || SIGNAL_JOB_NAMES.has(job?.name))
  if (signalJobs.length !== 1) throw new Error('找不到唯一的 signal job')
  const conclusion = signalJobs[0]?.conclusion
  if (conclusion === 'skipped') {
    return { decision: 'noop', reason: 'signal job 被准入控制跳过，无需 reconcile' }
  }
  if (conclusion === 'success') {
    return { decision: 'reconcile', reason: 'signal job 成功完成，执行 reconcile' }
  }
  throw new Error(`signal job conclusion 无法接受：${String(conclusion)}`)
}

export function selectAssociatedPullRequest({ pullRequests }) {
  if (!Array.isArray(pullRequests) || pullRequests.length !== 1) {
    throw new Error(`触发 run 必须恰好关联一个 pull request，实际为 ${Array.isArray(pullRequests) ? pullRequests.length : '非数组'}`)
  }
  const number = pullRequests[0]?.number
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`关联 pull request number 必须是正整数：${String(number)}`)
  }
  return number
}

function parseRepository(value) {
  const parts = String(value ?? '').split('/')
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new Error('GITHUB_REPOSITORY 必须是非空 owner/repo')
  }
  return { owner: parts[0], repo: parts[1] }
}

async function getJson({ fetchImpl, url, token, label }) {
  let response
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
      },
    })
  } catch (error) {
    throw new Error(`${label} 网络请求失败：${error.message}`, { cause: error })
  }
  if (!response?.ok) throw new Error(`${label} HTTP ${response?.status ?? 'unknown'}`)
  let body
  try {
    body = await response.json()
  } catch (error) {
    throw new Error(`${label} 响应不是合法 JSON：${error.message}`, { cause: error })
  }
  return body
}

function parsePullRequestsJson(value) {
  if (value === undefined || value === '') return []
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new Error(`PULL_REQUESTS_JSON 不是合法 JSON：${error.message}`, { cause: error })
  }
  if (!Array.isArray(parsed)) throw new Error('PULL_REQUESTS_JSON 必须是数组')
  return parsed
}

export async function main({ env = process.env, fetchImpl = fetch, writeOutput = (line) => appendFileSync(env.GITHUB_OUTPUT, `${line}\n`), log = console.log } = {}) {
  if (!env.GITHUB_REPOSITORY) throw new Error('未配置 GITHUB_REPOSITORY')
  if (!env.RUN_ID) throw new Error('未配置 RUN_ID')
  if (!env.GITHUB_TOKEN) throw new Error('未配置 GITHUB_TOKEN')
  if (!env.GITHUB_OUTPUT) throw new Error('未配置 GITHUB_OUTPUT')
  const { owner, repo } = parseRepository(env.GITHUB_REPOSITORY)
  const base = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(env.RUN_ID)}`

  const jobsBody = await getJson({ fetchImpl, url: `${base}/jobs`, token: env.GITHUB_TOKEN, label: 'jobs API' })
  if (!jobsBody || !Array.isArray(jobsBody.jobs)) throw new Error('jobs API 响应缺少 jobs 数组')
  const decision = classifySignalRun({ jobs: jobsBody.jobs })

  let pullRequests = parsePullRequestsJson(env.PULL_REQUESTS_JSON)
  if (pullRequests.length === 0) {
    const runBody = await getJson({ fetchImpl, url: base, token: env.GITHUB_TOKEN, label: 'run API' })
    if (!runBody || !Array.isArray(runBody.pull_requests)) throw new Error('run API 响应缺少 pull_requests 数组')
    pullRequests = runBody.pull_requests
  }
  const number = selectAssociatedPullRequest({ pullRequests })
  writeOutput(`decision=${decision.decision}`)
  writeOutput(`number=${number}`)
  if (decision.decision === 'noop') log(`::notice::${decision.reason}`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.log(`::error::${error.message}`)
    process.exit(1)
  })
}
