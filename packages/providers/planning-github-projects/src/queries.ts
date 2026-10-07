/**
 * 查询文本是契约：改动它就要重录夹具（夹具带着文本哈希，见 tests/contract）。
 *
 * 参数白名单（R7）：`PlanningProject` / `PlanningItems` / `PlanningFields` 只发项目 node id 与分页游标；
 * `PlanningItemFields` 额外发**本次项目列表刚读到的成员关系 id**，用来读该条目的字段值续页——从不拿
 * 内容 id、历史 Draft id 或内容别名回查平台。
 *
 * 字段读取只取字段身份、选项与迭代配置：不取 creator、assignees、login 一类个人字段。
 */
const PLANNING_PROJECT = `query PlanningProject($project: ID!) {
  node(id: $project) { __typename ... on ProjectV2 { id title url updatedAt } }
}`

/** 条目列表：每个条目自带**字段值首页**（带 pageInfo），值超过一页时由 `PlanningItemFields` 续读。 */
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

/** 字段定义与迭代配置：一次扫完所有页；`node` 必须是 ProjectV2。 */
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

/** 单个成员关系的字段值续页：`node` 必须是 ProjectV2Item，且返回的 project id 与成员关系 id 都要核对。 */
const PLANNING_ITEM_FIELDS = `query PlanningItemFields($item: ID!, $first: Int!, $after: String) {
  node(id: $item) {
    __typename
    ... on ProjectV2Item {
      id
      project { id }
      fieldValues(first: $first, after: $after) {
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
}`

export const PLANNING_QUERIES = {
  PlanningProject: PLANNING_PROJECT, PlanningItems: PLANNING_ITEMS,
  PlanningFields: PLANNING_FIELDS, PlanningItemFields: PLANNING_ITEM_FIELDS,
} as const
