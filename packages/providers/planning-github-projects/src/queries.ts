/**
 * 三段查询文本是契约：改动它就要重录夹具（夹具带着文本哈希，见 tests/contract）。
 * 平台查询参数只有 project node id 与分页游标，从不拿内容 id 去问平台（R7）。
 * 不取 creator、assignees、login 一类个人字段；`archivedStates` 用平台默认值。
 *
 * 字段（#133）：GitHub 一个 Project 至多 50 个字段（含系统字段），所以 `fieldValues` 与 `fields` 按 100 取一页必然读全；
 * 解码遇到 `hasNextPage` 为真即整次失败，不截断发布。`PlanningFields` 保留 `$after` 是为了与录制的查询文本逐字一致。
 */
const PLANNING_PROJECT = `query PlanningProject($project: ID!) {
  node(id: $project) { __typename ... on ProjectV2 { id title url updatedAt } }
}`

/** 条目列表：每个条目带自己的字段值（单选 / 迭代 / 日期三种已实现读取的值类型）。 */
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
          fieldValues(first: 100) {
            pageInfo { hasNextPage endCursor }
            nodes {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue {
                field { ... on ProjectV2SingleSelectField { id name } }
                optionId
                name
              }
              ... on ProjectV2ItemFieldIterationValue {
                field { ... on ProjectV2IterationField { id name } }
                iterationId
                title
                startDate
                duration
              }
              ... on ProjectV2ItemFieldDateValue {
                field { ... on ProjectV2FieldCommon { id name } }
                date
              }
            }
          }
        }
      }
    }
  }
}`

/** 字段定义与迭代配置（含已完成的迭代）。 */
const PLANNING_FIELDS = `query PlanningFields($project: ID!, $first: Int!, $after: String) {
  node(id: $project) {
    __typename
    ... on ProjectV2 {
      fields(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          __typename
          ... on ProjectV2FieldCommon { id name dataType }
          ... on ProjectV2SingleSelectField { options { id name } }
          ... on ProjectV2IterationField {
            configuration {
              iterations { id title startDate duration }
              completedIterations { id title startDate duration }
            }
          }
        }
      }
    }
  }
}`

export const PLANNING_QUERIES = { PlanningProject: PLANNING_PROJECT, PlanningItems: PLANNING_ITEMS, PlanningFields: PLANNING_FIELDS } as const
