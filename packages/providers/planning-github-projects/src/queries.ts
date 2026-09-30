/**
 * 两段查询文本是契约：改动它就要重录夹具（夹具带着文本哈希，见 tests/contract）。
 * 平台查询参数只有 project node id 与分页游标，从不拿内容 id 去问平台（R7）。
 * 不取 creator、assignees、login 一类个人字段；`archivedStates` 用平台默认值。
 */
const PLANNING_PROJECT = `query PlanningProject($project: ID!) {
  node(id: $project) { __typename ... on ProjectV2 { id title url updatedAt } }
}`

const PLANNING_ITEMS = `query PlanningItems($project: ID!, $first: Int!, $after: String) {
  node(id: $project) {
    __typename
    ... on ProjectV2 {
      items(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id type createdAt updatedAt
          content {
            __typename
            ... on Issue { id number title body url updatedAt }
            ... on PullRequest { id number title body url updatedAt }
            ... on DraftIssue { id title body updatedAt }
          }
        }
      }
    }
  }
}`

export const PLANNING_QUERIES = { PlanningProject: PLANNING_PROJECT, PlanningItems: PLANNING_ITEMS } as const
